"""Excel workbook read-only scanner.

Dual-pass reading: formulas and cached values.
Detects errors, duplicate headers, empty headers, and reference candidates.
"""
from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Optional

import openpyxl
from openpyxl.cell.cell import Cell


@dataclass
class CellInfo:
    row: int
    col: int
    value: Any
    cached_value: Any
    is_formula: bool
    is_error: bool
    error_text: Optional[str] = None


@dataclass
class ColumnInfo:
    index: int
    header_raw: str
    header_row: int
    non_empty_count: int = 0
    numeric_count: int = 0
    string_count: int = 0
    error_count: int = 0
    formula_count: int = 0
    sample_values: list[Any] = field(default_factory=list)
    is_duplicate_header: bool = False
    is_empty_header: bool = False


@dataclass
class SheetPreview:
    name: str
    max_row: int
    max_column: int
    header_row: int
    data_start_row: int
    physical_data_rows: int
    columns: list[ColumnInfo] = field(default_factory=list)
    head_rows: list[list[Any]] = field(default_factory=list)
    cached_error_count: int = 0
    formula_count: int = 0
    duplicate_header_count: int = 0
    empty_header_count: int = 0
    duplicate_header_rows: list[int] = field(default_factory=list)
    reference_candidates: list[dict[str, Any]] = field(default_factory=list)


@dataclass
class WorkbookPreview:
    file_path: str
    file_sha256: str
    file_size: int
    sheets: list[SheetPreview] = field(default_factory=list)

    def sheet(self, name: str) -> Optional[SheetPreview]:
        for s in self.sheets:
            if s.name == name:
                return s
        return None


ERROR_PATTERN = re.compile(r"^#(DIV/0|N/A|NAME\?|NULL|NUM|VALUE|REF!)")
DUPLICATE_HEADER_PATTERN = re.compile(r"^\s*$")


def _compute_file_sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def _is_error_value(val: Any) -> bool:
    if val is None:
        return False
    s = str(val).strip()
    return bool(ERROR_PATTERN.match(s))


def _is_formula(val: Any) -> bool:
    if val is None:
        return False
    s = str(val).strip()
    return s.startswith("=") and len(s) > 1


def _detect_header_row(ws, max_scan: int = 20) -> int:
    """Detect the header row by finding the first row with mostly non-empty string cells."""
    best_row = 1
    best_score = 0
    for row_idx in range(1, min(max_scan + 1, (ws.max_row or 1) + 1)):
        cells = []
        for cell in ws[row_idx]:
            if cell.value is not None:
                cells.append(cell.value)
        if not cells:
            continue
        non_empty = sum(1 for c in cells if c is not None and str(c).strip())
        string_headers = sum(1 for c in cells if isinstance(c, str) and c.strip())
        score = string_headers * 2 + non_empty
        if score > best_score:
            best_score = score
            best_row = row_idx
    return best_row


def _is_duplicate_header_row(ws, header_row: int, row_idx: int) -> bool:
    """Check if row_idx is a duplicate of the header row."""
    if row_idx == header_row:
        return False
    header_vals = []
    for cell in ws[header_row]:
        v = cell.value if hasattr(cell, 'value') else None
        header_vals.append(str(v or "").strip())
    row_vals = []
    for cell in ws[row_idx]:
        v = cell.value if hasattr(cell, 'value') else None
        row_vals.append(str(v or "").strip())
    match_count = sum(1 for h, r in zip(header_vals, row_vals) if h and h == r)
    total_headers = sum(1 for h in header_vals if h)
    return total_headers > 0 and match_count >= total_headers * 0.5


def scan_workbook(path: Path | str) -> WorkbookPreview:
    """Scan an Excel workbook read-only, extracting structure and quality metrics.

    Dual-pass: first pass reads formulas (data_only=False), second pass reads
    cached values (data_only=True) to detect cached errors.
    """
    path = Path(path)
    if not path.suffix.lower() in (".xlsx", ".xlsm"):
        raise ValueError(f"Unsupported file format: {path.suffix}")
    if not path.exists():
        raise FileNotFoundError(f"Workbook not found: {path}")

    file_sha256 = _compute_file_sha256(path)
    file_size = path.stat().st_size

    cached_errors_by_sheet = {}
    wb_cached = openpyxl.load_workbook(str(path), read_only=True, data_only=True)
    for sheet_name in wb_cached.sheetnames:
        ws = wb_cached[sheet_name]
        error_count = 0
        for row in ws.iter_rows(values_only=True):
            for val in row:
                if val is not None and _is_error_value(val):
                    error_count += 1
        cached_errors_by_sheet[sheet_name] = error_count
    wb_cached.close()

    wb = openpyxl.load_workbook(str(path), read_only=True, data_only=False)
    previews = []

    for sheet_name in wb.sheetnames:
        ws = wb[sheet_name]
        max_row = ws.max_row or 0
        max_col = ws.max_column or 0

        header_row = _detect_header_row(ws)
        data_start_row = header_row + 1

        columns = {}
        head_rows = []
        cached_error_count = 0
        formula_count = 0
        duplicate_header_rows = []
        reference_candidates = []

        for row_idx, row in enumerate(ws.iter_rows(min_row=1, values_only=False), start=1):
            is_header = row_idx == header_row
            is_dup_header = False

            if row_idx > header_row and row_idx <= header_row + 10:
                is_dup_header = _is_duplicate_header_row(ws, header_row, row_idx)
                if is_dup_header:
                    duplicate_header_rows.append(row_idx)

            if row_idx <= header_row + 5:
                head_rows.append([cell.value if hasattr(cell, 'value') else None for cell in row])

            for cell in row:
                if not hasattr(cell, 'column') or cell.column is None:
                    continue
                col_idx = cell.column - 1
                val = cell.value
                cached_val = val

                is_formula_cell = _is_formula(val)
                is_error_cell = _is_error_value(val)

                if is_formula_cell:
                    formula_count += 1
                if is_error_cell:
                    cached_error_count += 1

                if col_idx not in columns:
                    header_val = ""
                    if is_header:
                        header_val = str(val or "").strip()
                    columns[col_idx] = ColumnInfo(
                        index=col_idx,
                        header_raw=header_val,
                        header_row=header_row,
                        is_empty_header=not header_val,
                    )

                col = columns[col_idx]
                if val is not None and str(val).strip():
                    col.non_empty_count += 1
                    if isinstance(val, (int, float)):
                        col.numeric_count += 1
                    elif isinstance(val, str):
                        col.string_count += 1
                        if _is_error_value(val):
                            col.error_count += 1
                    if is_formula_cell:
                        col.formula_count += 1
                    if len(col.sample_values) < 5:
                        col.sample_values.append(val)

        for col_idx, row in enumerate(ws.iter_rows(min_row=header_row, max_row=header_row, values_only=True)):
            for ci, val in enumerate(row):
                if ci in columns:
                    columns[ci].header_raw = str(val or "").strip()
                    columns[ci].is_empty_header = not columns[ci].header_raw

        header_texts = [c.header_raw for c in columns.values() if c.header_raw]
        seen = set()
        dup_count = 0
        for h in header_texts:
            if h in seen:
                dup_count += 1
            seen.add(h)

        physical_data_rows = max_row - header_row
        for dup_row in duplicate_header_rows:
            physical_data_rows -= (max_row - dup_row + 1)
        physical_data_rows = max(0, physical_data_rows)

        ref_candidates = []
        if "Normalization" in sheet_name or "normalization" in sheet_name.lower():
            row_num = 0
            for row in ws.iter_rows(min_row=1, max_row=min(20, max_row), values_only=True):
                row_num += 1
                if row and row[0] and isinstance(row[0], str):
                    text = row[0].strip()
                    elem_match = re.search(r'"?([A-Z][a-z]?)\s*"?', text)
                    if elem_match:
                        elem = elem_match.group(1)
                        val = None
                        if len(row) > 3 and row[3] is not None:
                            try:
                                val = float(row[3])
                            except (ValueError, TypeError):
                                val = None
                        if val is not None:
                            ref_candidates.append({
                                "element": elem,
                                "value": val,
                                "row": row_num,
                            })

        sorted_cols = sorted(columns.values(), key=lambda c: c.index)
        empty_header_count = sum(1 for c in sorted_cols if c.is_empty_header and c.non_empty_count > 0)

        preview = SheetPreview(
            name=sheet_name,
            max_row=max_row,
            max_column=max_col,
            header_row=header_row,
            data_start_row=data_start_row,
            physical_data_rows=physical_data_rows,
            columns=sorted_cols[:50],
            head_rows=head_rows,
            cached_error_count=cached_errors_by_sheet.get(sheet_name, 0),
            formula_count=formula_count,
            duplicate_header_count=dup_count,
            empty_header_count=empty_header_count,
            duplicate_header_rows=duplicate_header_rows,
            reference_candidates=ref_candidates,
        )
        previews.append(preview)

    wb.close()

    return WorkbookPreview(
        file_path=str(path),
        file_sha256=file_sha256,
        file_size=file_size,
        sheets=previews,
    )
