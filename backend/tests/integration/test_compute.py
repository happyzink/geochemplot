"""Integration tests for plot compute endpoint."""
from __future__ import annotations

import json
import tempfile
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.main import app, get_database
from app.services.selections import SelectionService
from app.storage.database import Database


@pytest.fixture
def client():
    """Create test client with temporary database."""
    with tempfile.TemporaryDirectory() as tmpdir:
        db_path = Path(tmpdir) / "test.db"
        db = Database(db_path)

        import app.main as main_mod
        import app.api.routes_data as routes_data_mod
        import app.api.routes_plots as routes_plots_mod

        old_db = routes_data_mod._db
        old_svc = routes_data_mod._selection_svc
        old_dedup = routes_data_mod._dedup_svc
        old_plot_db = routes_plots_mod._db
        old_main_db = main_mod._db

        routes_data_mod._db = db
        routes_data_mod._selection_svc = SelectionService(db)
        from app.services.dedup import DedupService
        routes_data_mod._dedup_svc = DedupService(db)
        routes_plots_mod._db = db
        main_mod._db = db

        client = TestClient(app)
        client._test_db = db
        yield client

        routes_data_mod._db = old_db
        routes_data_mod._selection_svc = old_svc
        routes_data_mod._dedup_svc = old_dedup
        routes_plots_mod._db = old_plot_db
        main_mod._db = old_main_db


@pytest.fixture
def populated_client(client):
    """Client with test data populated."""
    db = client._test_db
    file_id = db.insert_source_file("test.xlsx", "sha_test", 1000)
    db.insert_dataset("ds_test", "1.0", "Test", "user_data", file_id, "map1")

    db.insert_analysis("a1", "S1", "1.0", "S1", "S1", "Apollo", "whole_rock")
    db.insert_analysis("a2", "S2", "1.0", "S2", "S2", "Apollo", "whole_rock")

    db.insert_measurement("m1_sio2", "a1", "SiO2", "oxide", "ch1", 45.0, "wt%")
    db.insert_measurement("m1_mgo", "a1", "MgO", "oxide", "ch2", 8.0, "wt%")
    db.insert_measurement("m2_sio2", "a2", "SiO2", "oxide", "ch1", 50.0, "wt%")
    db.insert_measurement("m2_mgo", "a2", "MgO", "oxide", "ch2", 5.0, "wt%")

    svc = SelectionService(db)
    sel = svc.create_selection("sel_test", "snapshot", {}, ["1.0"])
    client._selection_id = sel.selection_id
    return client


class TestComputeEndpoint:
    def test_compute_scatter(self, populated_client):
        """POST /plots/compute should return a valid scene (schema 1.2)."""
        sel_id = populated_client._selection_id
        payload = {
            "request_id": "req_test_001",
            "spec": {
                "plot_id": "test1",
                "chart_type": "scatter",
                "layers": [{
                    "layer_id": "L1",
                    "label": "Scatter",
                    "selection_id": sel_id,
                }],
                "variables": {
                    "x": {"kind": "measurement", "analyte": "SiO2", "chemical_form": "oxide", "unit": "wt%"},
                    "y": {"kind": "measurement", "analyte": "MgO", "chemical_form": "oxide", "unit": "wt%"},
                },
            },
        }

        resp = populated_client.post("/api/v1/plots/compute", json=payload)
        assert resp.status_code == 200
        scene = resp.json()  # Schema 1.2: returns PlotScene directly
        assert scene["schema_version"] == "1.2"
        assert scene["request_id"] == "req_test_001"
        assert len(scene["series"]) == 1
        assert scene["counts"]["valid_analyses"] == 2

    def test_compute_ree(self, populated_client):
        """POST /plots/compute should handle REE chart type (schema 1.2)."""
        db = populated_client._test_db
        db.insert_analysis("a_ree", "REE1", "1.0", "REE1", "REE1", "Apollo", "whole_rock")
        for elem in ["La", "Ce", "Nd", "Sm", "Eu", "Gd", "Dy", "Yb", "Lu"]:
            db.insert_measurement(f"mr_{elem}", "a_ree", elem, "element", f"ch_{elem}", 1.0, "ppm")

        svc = SelectionService(db)
        sel = svc.create_selection("sel_ree", "snapshot", {}, ["1.0"])

        payload = {
            "request_id": "req_test_ree",
            "spec": {
                "plot_id": "test_ree",
                "chart_type": "ree",
                "layers": [{
                    "layer_id": "L1",
                    "label": "REE",
                    "selection_id": sel.selection_id,
                    "style": {"connect": True},
                }],
                "variables": {
                    "elements": ["La", "Ce", "Pr", "Nd", "Sm", "Eu", "Gd", "Tb",
                                 "Dy", "Ho", "Er", "Tm", "Yb", "Lu"],  # 14 elements, no Y
                    "value_mode": "raw",
                },
            },
        }

        resp = populated_client.post("/api/v1/plots/compute", json=payload)
        assert resp.status_code == 200
        scene = resp.json()  # Schema 1.2: returns PlotScene directly
        assert scene["schema_version"] == "1.2"
        assert scene["counts"]["selected_analyses"] >= 1

    def test_validate_spec(self, populated_client):
        """POST /plots/validate should validate without computing."""
        sel_id = populated_client._selection_id
        payload = {
            "plot_id": "val_test",
            "chart_type": "scatter",
            "layers": [{
                "layer_id": "L1",
                "label": "Test",
                "selection_id": sel_id,
            }],
            "variables": {
                "x": {"kind": "measurement", "analyte": "SiO2", "chemical_form": "oxide", "unit": "wt%"},
                "y": {"kind": "measurement", "analyte": "MgO", "chemical_form": "oxide", "unit": "wt%"},
            },
        }

        resp = populated_client.post("/api/v1/plots/validate", json=payload)
        assert resp.status_code == 200
        data = resp.json()
        assert data["valid"] is True
        assert "spec_hash" in data


class TestComputeEdgeCases:
    def test_missing_selection_warning(self, populated_client):
        """Missing selection should produce warning, not error (schema 1.2)."""
        payload = {
            "request_id": "req_test_miss",
            "spec": {
                "plot_id": "test_miss",
                "chart_type": "scatter",
                "layers": [{
                    "layer_id": "L1",
                    "label": "Missing",
                    "selection_id": "sel_nonexistent",
                }],
                "variables": {
                    "x": {"kind": "measurement", "analyte": "SiO2", "chemical_form": "oxide", "unit": "wt%"},
                    "y": {"kind": "measurement", "analyte": "MgO", "chemical_form": "oxide", "unit": "wt%"},
                },
            },
        }

        resp = populated_client.post("/api/v1/plots/compute", json=payload)
        assert resp.status_code == 200
        scene = resp.json()  # Schema 1.2: returns PlotScene directly
        assert len(scene["warnings"]) > 0
        assert scene["counts"]["plotted_points"] == 0
