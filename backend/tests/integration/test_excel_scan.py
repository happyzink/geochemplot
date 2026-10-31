"""Excel scan integration tests.

Tests use the real workbook: GEOPLOT_TEST_WORKBOOK env var, or auto-discovered
at the repo root (月球样品数据汇总_all-0910.xlsx) so real-data verification
runs by default instead of silently skipping.
"""
from __future__ import annotations

import os
from pathlib import Path

import pytest

from app.importers.excel_scan import scan_workbook


REPO_ROOT = Path(__file__).resolve().parents[3]
_DEFAULT_WORKBOOK = REPO_ROOT / "月球样品数据汇总_all-0910.xlsx"
WORKBOOK_PATH = os.environ.get("GEOPLOT_TEST_WORKBOOK") or (
    str(_DEFAULT_WORKBOOK) if _DEFAULT_WORKBOOK.exists() else ""
)


@pytest.fixture
def real_workbook_path():
    if not WORKBOOK_PATH:
        pytest.skip("GEOPLOT_TEST_WORKBOOK not set and no workbook at repo root")
    p = Path(WORKBOOK_PATH)
    if not p.exists():
        pytest.skip(f"Workbook not found: {p}")
    return p


@pytest.fixture
def preview(real_workbook_path):
    return scan_workbook(real_workbook_path)


class TestWorkbookScan:
    def test_six_sheets(self, preview):
        assert len(preview.sheets) == 6

    def test_apollo_physical_rows(self, preview):
        apollo = None
        for s in preview.sheets:
            if "Apollo" in s.name:
                apollo = s
                break
        assert apollo is not None, "Apollo sheet not found"
        assert apollo.physical_data_rows == 35802

    def test_ce_main_physical_rows(self, preview):
        ce = None
        for s in preview.sheets:
            if "搜集" in s.name or "嫦娥" in s.name:
                ce = s
                break
        if ce is None:
            for s in preview.sheets:
                if s.max_row == 8349:
                    ce = s
                    break
        assert ce is not None, "CE main sheet not found"
        assert ce.physical_data_rows == 8348

    def test_trace_physical_rows(self, preview):
        trace = None
        for s in preview.sheets:
            if "trace" in s.name.lower():
                trace = s
                break
        assert trace is not None, "Trace sheet not found"
        assert trace.physical_data_rows == 535

    def test_summary_physical_rows(self, preview):
        summary = None
        for s in preview.sheets:
            if s.max_row == 260 and s.max_column == 55:
                summary = s
                break
        assert summary is not None, "Summary sheet not found"
        assert summary.physical_data_rows == 259

    def test_raw_physical_rows(self, preview):
        raw = None
        for s in preview.sheets:
            if s.max_row == 375 and s.max_column >= 300:
                raw = s
                break
        assert raw is not None, "Raw sheet not found"
        assert raw.physical_data_rows == 374

    def test_normalization_reference_candidates(self, preview):
        norm = None
        for s in preview.sheets:
            if "Normalization" in s.name or "normalization" in s.name.lower():
                norm = s
                break
        assert norm is not None, "Normalization sheet not found"
        assert len(norm.reference_candidates) == 14
        elements = [c["element"] for c in norm.reference_candidates]
        assert "La" in elements
        assert "Lu" in elements

    def test_file_sha256(self, preview):
        assert len(preview.file_sha256) == 64
        expected = "1b1e5410e98bcb6983198cfce9303c9c3653070bcccb950876e8e3e81b185386"
        assert preview.file_sha256 == expected

    def test_file_size(self, preview):
        assert preview.file_size == 6754030

    def test_cached_errors_detected(self, preview):
        total_errors = sum(s.cached_error_count for s in preview.sheets)
        assert total_errors > 0, "Should detect cached errors"

    def test_apollo_headers(self, preview):
        apollo = None
        for s in preview.sheets:
            if "Apollo" in s.name:
                apollo = s
                break
        assert apollo is not None
        header_texts = [c.header_raw for c in apollo.columns if c.header_raw]
        assert "Sample Name" in header_texts
        assert "Analyzed Material" in header_texts


class TestScanEdgeCases:
    def test_missing_file(self):
        with pytest.raises(FileNotFoundError):
            scan_workbook("/nonexistent/path.xlsx")

    def test_unsupported_format(self):
        with pytest.raises(ValueError, match="Unsupported"):
            scan_workbook(Path("test.csv"))
