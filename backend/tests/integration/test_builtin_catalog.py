"""Built-in catalog tests."""
from __future__ import annotations

import pytest

from app.services.catalog import build_catalog, attach_catalog_item, get_builtin_response


class TestCatalog:
    def test_six_items(self):
        catalog = build_catalog()
        assert len(catalog.items) == 6

    def test_data_ids(self):
        catalog = build_catalog()
        ids = [item.data_id for item in catalog.items]
        assert "lunar_apollo_0910" in ids
        assert "lunar_ce_0910" in ids
        assert "own_summary_0910" in ids
        assert "own_raw_0910" in ids
        assert "ce_trace_view_0910" in ids
        assert "workbook_custom_ree_v1" in ids

    def test_apollo_rows(self):
        catalog = build_catalog()
        apollo = catalog.get_item("lunar_apollo_0910")
        assert apollo is not None
        assert apollo.physical_rows == 35802

    def test_ce_rows(self):
        catalog = build_catalog()
        ce = catalog.get_item("lunar_ce_0910")
        assert ce is not None
        assert ce.physical_rows == 8348

    def test_trace_rows(self):
        catalog = build_catalog()
        trace = catalog.get_item("ce_trace_view_0910")
        assert trace is not None
        assert trace.physical_rows == 535

    def test_summary_rows(self):
        catalog = build_catalog()
        summary = catalog.get_item("own_summary_0910")
        assert summary is not None
        assert summary.physical_rows == 259

    def test_raw_rows(self):
        catalog = build_catalog()
        raw = catalog.get_item("own_raw_0910")
        assert raw is not None
        assert raw.physical_rows == 374

    def test_custom_ree_rows(self):
        catalog = build_catalog()
        custom = catalog.get_item("workbook_custom_ree_v1")
        assert custom is not None
        assert custom.physical_rows == 14


class TestReferences:
    def test_two_references(self):
        catalog = build_catalog()
        assert len(catalog.references) == 2

    def test_chondrite_14_elements(self):
        catalog = build_catalog()
        chondrite = catalog.get_reference("Chondrite_MS95")
        assert chondrite is not None
        assert len(chondrite.elements) == 14
        assert "La" in chondrite.elements
        assert "Lu" in chondrite.elements
        assert "Pm" not in chondrite.elements

    def test_chondrite_values(self):
        catalog = build_catalog()
        chondrite = catalog.get_reference("Chondrite_MS95")
        assert chondrite.elements["La"] == pytest.approx(0.237)
        assert chondrite.elements["Yb"] == pytest.approx(0.161)
        assert chondrite.elements["Lu"] == pytest.approx(0.0246)

    def test_pm_27_elements(self):
        catalog = build_catalog()
        pm = catalog.get_reference("PM_SM89")
        assert pm is not None
        assert len(pm.elements) == 27
        assert "Cs" in pm.elements
        assert "Lu" in pm.elements
        assert "Ti" in pm.elements

    def test_pm_values(self):
        catalog = build_catalog()
        pm = catalog.get_reference("PM_SM89")
        assert pm.elements["Cs"] == pytest.approx(0.032)
        assert pm.elements["Ti"] == pytest.approx(1300.0)
        assert pm.elements["Sr"] == pytest.approx(21.1)

    def test_reference_sha256(self):
        catalog = build_catalog()
        chondrite = catalog.get_reference("Chondrite_MS95")
        assert len(chondrite.sha256) == 64
        pm = catalog.get_reference("PM_SM89")
        assert len(pm.sha256) == 64
        assert chondrite.sha256 != pm.sha256

    def test_reference_citation(self):
        catalog = build_catalog()
        chondrite = catalog.get_reference("Chondrite_MS95")
        assert "McDonough" in chondrite.citation
        assert "1995" in chondrite.citation
        pm = catalog.get_reference("PM_SM89")
        assert "Sun" in pm.citation
        assert "1989" in pm.citation


class TestAttach:
    def test_attach_idempotent(self):
        catalog = build_catalog()
        assert attach_catalog_item(catalog, "lunar_apollo_0910", "proj_1")
        assert attach_catalog_item(catalog, "lunar_apollo_0910", "proj_1")
        assert len([k for k in catalog.attached if k.startswith("proj_1")]) == 1

    def test_attach_unknown(self):
        catalog = build_catalog()
        assert not attach_catalog_item(catalog, "nonexistent", "proj_1")


class TestBuiltinResponse:
    def test_response_structure(self):
        catalog = build_catalog()
        resp = get_builtin_response(catalog)
        assert "catalog_items" in resp
        assert "references" in resp
        assert len(resp["catalog_items"]) == 6
        assert len(resp["references"]) == 2
