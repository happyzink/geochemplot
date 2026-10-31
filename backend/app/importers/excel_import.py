"""Excel data reader and importer for actual data ingestion.

修复 P0-1：column_map / sheet_config 为空时自动检测真实工作簿表头
（样品编号 / Sample Name / sample、任务(CE5/CE6)、类型、分析对象等），
没有 sample_id 列的表（如 Normalization value 参考表）自动跳过。
单连接批量插入，避免逐行建连。
"""
from __future__ import annotations

import re
import uuid
from pathlib import Path
from typing import Any, Optional

import openpyxl

from ..storage.database import Database

# 自动检测候选（顺序即优先级，子串匹配、大小写不敏感）
DEFAULT_SAMPLE_COLUMNS = ["样品编号", "sample name", "sample_id", "sample no", "sample", "name", "样品"]
DEFAULT_MISSION_COLUMNS = ["任务(ce5/ce6)", "任务", "mission", "sample collect"]
DEFAULT_MATERIAL_COLUMNS = ["样品类型", "类型", "analyzed mater", "material_type", "material"]
DEFAULT_PHASE_COLUMNS = ["分析对象", "analyzed phase", "矿物类型", "phase"]
DEFAULT_CITATION_COLUMNS = ["citation", "doi", "第一作者", "reference"]

# 常见氧化物（列名小写匹配）
OXIDES = {
    "sio2", "tio2", "al2o3", "fe2o3", "feo", "feot", "feo(t)", "fe2o3t",
    "mno", "mgo", "cao", "na2o", "k2o", "p2o5", "cr2o3", "nio", "bao",
}
# 元素符号（精确匹配）
ELEMENTS = {
    "Li", "Be", "B", "Na", "Mg", "Al", "Si", "P", "K", "Ca", "Sc", "Ti", "V",
    "Cr", "Mn", "Fe", "Co", "Ni", "Cu", "Zn", "Ga", "Ge", "As", "Se", "Br",
    "Rb", "Sr", "Y", "Zr", "Nb", "Mo", "Ru", "Rh", "Pd", "Ag", "Cd", "In",
    "Sn", "Sb", "Te", "I", "Cs", "Ba", "La", "Ce", "Pr", "Nd", "Sm", "Eu",
    "Gd", "Tb", "Dy", "Ho", "Er", "Tm", "Yb", "Lu", "Hf", "Ta", "W", "Re",
    "Os", "Ir", "Pt", "Au", "Hg", "Tl", "Pb", "Bi", "Th", "U",
}

# 非测量列（统计量/派生列/元数据）
_SKIP_PATTERNS = ("_2se", "_lod", "_std", "_sd", "_err", "_error", "_median",
                  "_max", "_min", "_n_", "total", "mg#", "an#", "序号", "doi")
# 带单位后缀的列：Li7_ppm_mean / La_ppm / Si29_wt
_UNIT_COLUMN_RE = re.compile(r"^([A-Za-z]+\d*)[_\s]?(ppm|ppb|ppt|wt\.?%?|percent)([_\s]|$)", re.IGNORECASE)


def import_excel_data(
    db: Database,
    file_path: Path,
    dataset_version: str,
    column_map: dict,
    sheet_config: dict,
) -> int:
    """Read Excel file and insert analyses/measurements into database.

    column_map / sheet_config 为空时自动检测；返回导入的 analysis 数。
    """
    wb = openpyxl.load_workbook(file_path, read_only=True, data_only=True)

    total_analyses = 0
    # 单连接批量写入：逐行建连在 3.5 万行工作簿上不可接受
    with db.connect() as conn:
        for sheet_name in wb.sheetnames:
            config = (sheet_config or {}).get(sheet_name)
            if sheet_config and config is None:
                # 提供了 sheet_config 时只处理配置过的表
                continue

            ws = wb[sheet_name]
            header_row = (config or {}).get("header_row", 1)
            start_row = (config or {}).get("start_row", header_row + 1)

            rows = ws.iter_rows(min_row=header_row, values_only=True)
            try:
                header_values = next(rows)
            except StopIteration:
                continue

            headers: dict[int, str] = {
                idx: str(v).strip()
                for idx, v in enumerate(header_values)
                if v is not None and str(v).strip()
            }
            if not headers:
                continue

            sample_col = _find_column(headers, _candidates(column_map, "sample_id", DEFAULT_SAMPLE_COLUMNS))
            if sample_col is None:
                # 无样品列的表（如 Normalization value）不是分析数据，跳过
                continue
            mission_col = _find_column(headers, _candidates(column_map, "mission", DEFAULT_MISSION_COLUMNS))
            material_col = _find_column(headers, _candidates(column_map, "material_type", DEFAULT_MATERIAL_COLUMNS))
            phase_col = _find_column(headers, _candidates(column_map, "phase", DEFAULT_PHASE_COLUMNS))
            citation_col = _find_column(headers, _candidates(column_map, "citation", DEFAULT_CITATION_COLUMNS))

            # 重复表头（如工作簿自带的第二组预标准化 REE 列）按出现次序分配独立通道：
            # 首组为主通道（""），后续组 set2/set3…——保留全部数据、避免同通道假冲突，
            # 默认测量解析取主通道（首组 raw 值）。
            measurement_cols: dict[int, tuple] = {}
            analyte_seen: dict[str, int] = {}
            for idx in sorted(headers):
                header = headers[idx]
                if not _is_measurement_column(header):
                    continue
                analyte, unit, chemical_form = _parse_analyte(header)
                n = analyte_seen.get(analyte, 0) + 1
                analyte_seen[analyte] = n
                channel = "" if n == 1 else f"set{n}"
                measurement_cols[idx] = (analyte, unit, chemical_form, channel)
            if not measurement_cols:
                continue

            analysis_rows: list[tuple] = []
            measurement_rows: list[tuple] = []
            row_idx = header_row
            for values in rows:
                row_idx += 1
                if row_idx < start_row:
                    continue

                sample_id = values[sample_col] if sample_col < len(values) else None
                if sample_id is None:
                    continue
                sample_id = str(sample_id).strip()
                if not sample_id or sample_id.lower() in ("", "n/a", "null", "none"):
                    continue

                def cell(col: Optional[int]) -> Any:
                    return values[col] if col is not None and col < len(values) else None

                analysis_id = f"ana_{uuid.uuid4().hex[:12]}"
                analysis_rows.append((
                    analysis_id,
                    sample_id,
                    dataset_version,
                    sample_id,
                    None,  # parent_sample
                    str(cell(mission_col) or "unknown").strip(),
                    str(cell(material_col) or "unknown").strip(),
                    "unknown",  # mineral_group
                    str(cell(phase_col) or "unknown").strip(),
                    "unknown",  # rock_type
                    str(cell(citation_col) or "").strip(),
                    sheet_name,
                    row_idx,
                ))

                for col_idx, (analyte, unit, chemical_form, channel) in measurement_cols.items():
                    value = cell(col_idx)
                    if value is None:
                        continue
                    try:
                        value_float = float(value)
                    except (ValueError, TypeError):
                        continue
                    measurement_rows.append((
                        f"meas_{uuid.uuid4().hex[:12]}",
                        analysis_id,
                        analyte,
                        chemical_form,
                        channel,
                        value_float,
                        unit,
                        "raw_concentration",
                    ))

                total_analyses += 1

            conn.executemany(
                """INSERT INTO analyses (analysis_id, sample_id, dataset_version, raw_name,
                   parent_sample, mission, material_type, mineral_group, phase, rock_type,
                   citation, sheet_name, row_number, created_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))""",
                analysis_rows,
            )
            conn.executemany(
                """INSERT INTO measurements (measurement_id, analysis_id, analyte,
                   chemical_form, channel, value, unit, value_state)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                measurement_rows,
            )

    wb.close()
    return total_analyses


def _candidates(column_map: dict, key: str, defaults: list[str]) -> list[str]:
    mapped = (column_map or {}).get(key)
    return list(mapped) if mapped else defaults


def _find_column(headers: dict[int, str], candidates: list[str]) -> Optional[int]:
    """Find first column whose header contains any candidate (case-insensitive)."""
    if not candidates:
        return None
    for col_idx in sorted(headers):
        header_lower = headers[col_idx].lower()
        for candidate in candidates:
            if candidate.lower() in header_lower:
                return col_idx
    return None


def _is_measurement_column(header: str) -> bool:
    h = header.strip()
    hl = h.lower()
    if any(pat in hl for pat in _SKIP_PATTERNS):
        return False
    if hl in OXIDES:
        return True
    if h in ELEMENTS:
        return True
    # Li7_ppm_mean / La (ppm) 等带单位列
    m = _UNIT_COLUMN_RE.match(h)
    if m:
        base = m.group(1)
        return base in ELEMENTS or bool(re.fullmatch(r"[A-Za-z]{1,2}\d{1,3}", base))
    return False


def _parse_analyte(header: str) -> tuple[str, str, str]:
    """Return (analyte, unit, chemical_form) for a measurement column."""
    h = header.strip()
    hl = h.lower()
    if hl in OXIDES:
        return (h, "wt%", "oxide")
    if h in ELEMENTS:
        return (h, "ppm", "element")
    m = _UNIT_COLUMN_RE.match(h)
    if m:
        base = m.group(1)
        unit_raw = m.group(2).lower()
        unit = "wt%" if unit_raw.startswith("wt") or unit_raw.startswith("percent") else unit_raw
        # Li7 / Mg25 / Si29 等同位素标记视为元素测量
        form = "element" if base in ELEMENTS or re.fullmatch(r"[A-Za-z]{1,2}\d{1,3}", base) else "element"
        return (base, unit, form)
    return (h, "ppm", "element")
