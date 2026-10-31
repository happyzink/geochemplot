"""Scientific tests for PlotScene building.

Key invariants:
- Scatter: X/Y aligned by analysis_id; no positional splicing
- REE: fixed element order; missing values produce gaps, not dropped positions
- scene_hash ignores request_id/creation_time
"""
from __future__ import annotations

import json
import tempfile
from pathlib import Path

import pytest

from app.domain.enums import ChartType, MarkerShape
from app.domain.expression import ConstantExpr, MeasurementExpr
from app.domain.plot_spec import PlotScene, PlotSpec
from app.domain.style import AxisFormat, AxesConfig, LayerSpec, LayerStyle, VariablesConfig
from app.services.scenes import Repository, build_scene
from app.services.selections import SelectionService
from app.storage.database import Database


@pytest.fixture
def temp_db():
    with tempfile.TemporaryDirectory() as tmpdir:
        db_path = Path(tmpdir) / "test.db"
        db = Database(db_path)
        yield db


@pytest.fixture
def scatter_db(temp_db):
    """Database with scatter test data: X missing for anal_0, Y missing for anal_1."""
    db = temp_db
    file_id = db.insert_source_file("scatter.xlsx", "sha1", 1000)
    db.insert_dataset("ds_scatter", "1.0", "Scatter Test", "user_data", file_id, "map1")

    db.insert_analysis("anal_0", "S0", "1.0", "S0", None, "Apollo", "whole_rock")
    db.insert_analysis("anal_1", "S1", "1.0", "S1", None, "Apollo", "whole_rock")
    db.insert_analysis("anal_2", "S2", "1.0", "S2", None, "Apollo", "whole_rock")

    db.insert_measurement("m0_x", "anal_0", "SiO2", "element", "ch1", None, "wt%")
    db.insert_measurement("m0_y", "anal_0", "MgO", "element", "ch2", 5.0, "wt%")

    db.insert_measurement("m1_x", "anal_1", "SiO2", "element", "ch1", 50.0, "wt%")
    db.insert_measurement("m1_y", "anal_1", "MgO", "element", "ch2", None, "wt%")

    db.insert_measurement("m2_x", "anal_2", "SiO2", "element", "ch1", 45.0, "wt%")
    db.insert_measurement("m2_y", "anal_2", "MgO", "element", "ch2", 8.0, "wt%")

    svc = SelectionService(db)
    svc.create_selection("sel_all", "snapshot", {}, ["1.0"])
    return db


@pytest.fixture
def ree_db(temp_db):
    """Database with REE test data: anal_0 missing Sm."""
    db = temp_db
    file_id = db.insert_source_file("ree.xlsx", "sha2", 1000)
    db.insert_dataset("ds_ree", "1.0", "REE Test", "user_data", file_id, "map1")

    db.insert_analysis("anal_a", "RA", "1.0", "RA", None, "Apollo", "whole_rock")
    db.insert_analysis("anal_b", "RB", "1.0", "RB", None, "Apollo", "whole_rock")

    ree_vals_a = {"La": 10, "Ce": 20, "Pr": 3, "Nd": 12, "Gd": 5, "Tb": 0.8,
                  "Dy": 4, "Y": 20, "Ho": 0.8, "Er": 2, "Tm": 0.3, "Yb": 1.8, "Lu": 0.25}
    for elem, val in ree_vals_a.items():
        db.insert_measurement(f"ma_{elem}", "anal_a", elem, "element", f"ch_{elem}", val, "ppm")

    ree_vals_b = {"La": 15, "Ce": 30, "Pr": 4, "Nd": 18, "Sm": 3.5, "Eu": 1.0,
                  "Gd": 6, "Tb": 1.0, "Dy": 5, "Y": 25, "Ho": 1.0, "Er": 2.5,
                  "Tm": 0.35, "Yb": 2.2, "Lu": 0.3}
    for elem, val in ree_vals_b.items():
        db.insert_measurement(f"mb_{elem}", "anal_b", elem, "element", f"ch_{elem}", val, "ppm")

    svc = SelectionService(db)
    svc.create_selection("sel_ree", "snapshot", {}, ["1.0"])
    return db


class TestScatterAlignment:
    def test_no_positional_splicing(self, scatter_db):
        """X/Y must align by analysis_id, not by position after dropna."""
        svc = SelectionService(scatter_db)
        sels = svc.list_selections()
        sel_id = sels[0].selection_id

        spec = PlotSpec(
            plot_id="test_scatter",
            chart_type=ChartType.SCATTER,
            layers=[LayerSpec(
                layer_id="L1",
                label="Test",
                selection_id=sel_id,
                style=LayerStyle(marker_shape=MarkerShape.CIRCLE),
            )],
            variables=VariablesConfig(
                x=MeasurementExpr(analyte="SiO2", chemical_form="oxide", unit="wt%"),
                y=MeasurementExpr(analyte="MgO", chemical_form="oxide", unit="wt%"),
            ),
            axes=AxesConfig(),
        )

        repo = Repository(db=scatter_db, dataset_versions=["1.0"])
        scene = build_scene(spec, repo)

        assert len(scene.series) == 1
        points = scene.series[0].points
        assert len(points) == 3

        p0 = next(p for p in points if p.analysis_id == "anal_0")
        p1 = next(p for p in points if p.analysis_id == "anal_1")
        p2 = next(p for p in points if p.analysis_id == "anal_2")

        assert p0.x is None
        assert p0.y == 5.0
        assert p1.x == 50.0
        assert p1.y is None
        assert p2.x == 45.0
        assert p2.y == 8.0

    def test_excluded_count(self, scatter_db):
        """Points with missing X or Y should be in excluded count."""
        svc = SelectionService(scatter_db)
        sels = svc.list_selections()
        sel_id = sels[0].selection_id

        spec = PlotSpec(
            plot_id="test_excl",
            chart_type=ChartType.SCATTER,
            layers=[LayerSpec(
                layer_id="L1",
                label="Test",
                selection_id=sel_id,
            )],
            variables=VariablesConfig(
                x=MeasurementExpr(analyte="SiO2", chemical_form="oxide", unit="wt%"),
                y=MeasurementExpr(analyte="MgO", chemical_form="oxide", unit="wt%"),
            ),
        )

        repo = Repository(db=scatter_db, dataset_versions=["1.0"])
        scene = build_scene(spec, repo)

        assert scene.counts.excluded_analyses == 2
        assert scene.counts.valid_analyses == 1


class TestREEFixedOrder:
    def test_14_element_order(self, ree_db):
        """REE must use fixed 14-element order."""
        svc = SelectionService(ree_db)
        sels = svc.list_selections()
        sel_id = sels[0].selection_id

        spec = PlotSpec(
            plot_id="test_ree",
            chart_type=ChartType.REE,
            layers=[LayerSpec(
                layer_id="L1",
                label="REE",
                selection_id=sel_id,
                style=LayerStyle(connect=True),
            )],
            variables=VariablesConfig(
                elements=["La", "Ce", "Pr", "Nd", "Sm", "Eu", "Gd", "Tb",
                          "Dy", "Y", "Ho", "Er", "Tm", "Yb", "Lu"],
                value_mode="raw",
            ),
        )

        repo = Repository(db=ree_db, dataset_versions=["1.0"])
        scene = build_scene(spec, repo)

        # B08 fix: one series per analysis (2 analyses = 2 series)
        assert len(scene.series) == 2
        points = scene.series[0].points
        # 15 elements per analysis
        assert len(points) == 15

        # Check that Sm points have MISSING flag for anal_a (which has no Sm)
        sm_points = [p for p in points if p.provenance.get("element") == "Sm"]
        sm_a = next(p for p in sm_points if p.analysis_id == "anal_a")
        assert "MISSING" in sm_a.quality_flags

    def test_missing_sm_breaks_line(self, ree_db):
        """Missing Sm should produce a gap, not reduce x-axis element count."""
        svc = SelectionService(ree_db)
        sels = svc.list_selections()
        sel_id = sels[0].selection_id

        spec = PlotSpec(
            plot_id="test_break",
            chart_type=ChartType.REE,
            layers=[LayerSpec(
                layer_id="L1",
                label="REE",
                selection_id=sel_id,
                style=LayerStyle(connect=True),
            )],
            variables=VariablesConfig(
                elements=["La", "Ce", "Pr", "Nd", "Sm", "Eu", "Gd", "Tb",
                          "Dy", "Y", "Ho", "Er", "Tm", "Yb", "Lu"],
                value_mode="raw",
            ),
        )

        repo = Repository(db=ree_db, dataset_versions=["1.0"])
        scene = build_scene(spec, repo)

        for s in scene.series:
            assert s.break_at_missing is True
            # Each series should have 15 points (one per element)
            assert len(s.points) == 15


class TestSceneHash:
    def test_hash_ignores_request_id(self, scatter_db):
        """Same data+spec should produce same scene_hash regardless of request_id."""
        svc = SelectionService(scatter_db)
        sels = svc.list_selections()
        sel_id = sels[0].selection_id

        spec = PlotSpec(
            plot_id="test_hash",
            chart_type=ChartType.SCATTER,
            layers=[LayerSpec(
                layer_id="L1",
                label="Test",
                selection_id=sel_id,
            )],
            variables=VariablesConfig(
                x=MeasurementExpr(analyte="SiO2", chemical_form="oxide", unit="wt%"),
                y=MeasurementExpr(analyte="MgO", chemical_form="oxide", unit="wt%"),
            ),
        )

        repo = Repository(db=scatter_db, dataset_versions=["1.0"])
        scene1 = build_scene(spec, repo)
        scene2 = build_scene(spec, repo)

        assert scene1.request_id != scene2.request_id
        assert scene1.scene_hash == scene2.scene_hash

    def test_empty_data_returns_empty_scene(self, temp_db):
        """Empty selection should return scene with zero counts."""
        db = temp_db
        file_id = db.insert_source_file("empty.xlsx", "sha_empty", 100)
        db.insert_dataset("ds_empty", "1.0", "Empty", "user_data", file_id, "map1")

        svc = SelectionService(db)
        sel = svc.create_selection("sel_empty", "snapshot", {}, ["1.0"])

        spec = PlotSpec(
            plot_id="test_empty",
            chart_type=ChartType.SCATTER,
            layers=[LayerSpec(
                layer_id="L1",
                label="Empty",
                selection_id=sel.selection_id,
            )],
            variables=VariablesConfig(
                x=MeasurementExpr(analyte="SiO2", chemical_form="oxide", unit="wt%"),
                y=MeasurementExpr(analyte="MgO", chemical_form="oxide", unit="wt%"),
            ),
        )

        repo = Repository(db=db, dataset_versions=["1.0"])
        scene = build_scene(spec, repo)

        assert scene.counts.selected_analyses == 0
        assert scene.counts.plotted_points == 0
