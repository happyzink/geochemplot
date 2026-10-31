"""Contract validation tests for schema 1.1

Tests that all fixtures validate against the Pydantic models correctly.
Generates OpenAPI/JSON Schema for frontend consumption.
"""
from __future__ import annotations

import json
import hashlib
from pathlib import Path

import pytest

CONTRACTS_DIR = Path(__file__).parent.parent.parent.parent / "contracts"
FIXTURES_DIR = CONTRACTS_DIR / "fixtures"


def load_fixture(name: str) -> dict:
    path = FIXTURES_DIR / name
    assert path.exists(), f"Fixture not found: {path}"
    return json.loads(path.read_text(encoding="utf-8"))


class TestPlotSpecValidation:
    """Validate PlotSpec schema 1.1 against fixtures."""

    def test_scatter_valid(self):
        from app.domain.plot_spec import PlotSpec
        data = load_fixture("scatter_valid.json")
        spec = PlotSpec(**data)
        assert spec.schema_version == "1.1"
        assert spec.chart_type.value == "scatter"
        assert spec.variables.x is not None
        assert spec.variables.y is not None
        assert len(spec.layers) == 1
        layer = spec.layers[0]
        assert layer.style.marker_alpha == 0.0
        assert layer.style.line_alpha == 0.0
        assert layer.style.connect is False

    def test_ree_valid(self):
        from app.domain.plot_spec import PlotSpec
        data = load_fixture("ree_valid.json")
        spec = PlotSpec(**data)
        assert spec.chart_type.value == "ree"
        assert spec.variables.value_mode == "normalized"
        assert spec.variables.reference_id == "Chondrite_MS95"
        assert len(spec.variables.elements) == 14
        assert "Pm" not in spec.variables.elements
        assert spec.axes.y.scale == "log10"
        assert spec.axes.x.scale == "category"
        assert len(spec.layers) == 2
        assert spec.layers[0].style.marker_alpha == 1.0
        assert spec.layers[1].style.marker_alpha == 0.6

    def test_ree_raw_no_reference_valid(self):
        from app.domain.plot_spec import PlotSpec
        data = load_fixture("ree_raw_no_reference_valid.json")
        spec = PlotSpec(**data)
        assert spec.variables.value_mode == "raw"
        assert spec.variables.reference_id is None

    def test_spider_valid(self):
        from app.domain.plot_spec import PlotSpec
        data = load_fixture("spider_valid.json")
        spec = PlotSpec(**data)
        assert spec.chart_type.value == "spider"
        assert len(spec.variables.elements) == 27
        assert spec.variables.reference_id == "PM_SM89"
        assert spec.axes.y.scale == "log10"

    def test_tas_valid(self):
        from app.domain.plot_spec import PlotSpec
        data = load_fixture("tas_valid.json")
        spec = PlotSpec(**data)
        assert spec.chart_type.value == "tas"
        assert spec.diagram is not None
        assert spec.diagram.model_id == "tas_LeMaitre"
        assert spec.diagram.mode == "reference"

    def test_ree_no_reference_rejected(self):
        from app.domain.plot_spec import PlotSpec
        from pydantic import ValidationError
        data = load_fixture("ree_no_reference_reject.json")
        with pytest.raises(ValidationError) as exc_info:
            PlotSpec(**data)
        errors = exc_info.value.errors()
        assert any("reference" in str(e).lower() for e in errors)

    def test_scatter_no_x_rejected(self):
        from app.domain.plot_spec import PlotSpec
        from pydantic import ValidationError
        data = load_fixture("scatter_no_x_reject.json")
        with pytest.raises(ValidationError) as exc_info:
            PlotSpec(**data)
        errors = exc_info.value.errors()
        assert any("x" in str(e).lower() or "expression" in str(e).lower() for e in errors)

    def test_duplicate_layer_rejected(self):
        from app.domain.plot_spec import PlotSpec
        from pydantic import ValidationError
        data = load_fixture("ree_duplicate_layer_reject.json")
        with pytest.raises(ValidationError) as exc_info:
            PlotSpec(**data)
        errors = exc_info.value.errors()
        assert any("duplicate" in str(e).lower() or "layer_id" in str(e).lower() for e in errors)


class TestSchema11Features:
    """Verify schema 1.1 specific features."""

    def test_independent_alpha(self):
        from app.domain.style import LayerStyle
        style = LayerStyle(
            marker_alpha=0.5,
            line_alpha=0.8,
        )
        assert style.marker_alpha == 0.5
        assert style.line_alpha == 0.8
        assert style.marker_alpha != style.line_alpha

    def test_axis_format_object(self):
        from app.domain.style import AxisFormat
        axis = AxisFormat(
            scale="log10",
            range_mode="manual",
            min=0.1,
            max=1000.0,
            reversed=False,
            tick_mode="step",
            log_exponent_step=1,
        )
        assert axis.scale == "log10"
        assert axis.range_mode == "manual"
        assert axis.min == 0.1
        assert axis.max == 1000.0

    def test_log_axis_validation(self):
        from app.domain.style import AxisFormat
        from pydantic import ValidationError
        with pytest.raises(ValidationError):
            AxisFormat(scale="log10", range_mode="manual", min=-1, max=100)

    def test_category_axis(self):
        from app.domain.style import AxisFormat
        axis = AxisFormat(
            scale="category",
            category_order=["La", "Ce", "Pr"],
            visible_categories=["La", "Ce"],
        )
        assert axis.scale == "category"
        assert len(axis.category_order) == 3

    def test_marker_shapes(self):
        from app.domain.enums import MarkerShape
        shapes = [s.value for s in MarkerShape]
        assert "circle" in shapes
        assert "triangle_up" in shapes
        assert "triangle_down" in shapes
        assert "diamond" in shapes
        assert "square" in shapes
        assert "plus" in shapes
        assert "cross" in shapes
        assert "star" in shapes
        assert "hexagon" in shapes
        assert len(shapes) == 9

    def test_plus_cross_fill_forced_open(self):
        from app.domain.style import LayerStyle
        from app.domain.enums import MarkerShape, MarkerFill
        style = LayerStyle(marker_shape=MarkerShape.PLUS, marker_fill=MarkerFill.SOLID)
        assert style.marker_fill == MarkerFill.OPEN

    def test_analysis_style_override(self):
        from app.domain.style import AnalysisStyleOverride
        override = AnalysisStyleOverride(
            marker_fill_color="#0000FF",
            marker_alpha=0.5,
        )
        assert override.marker_fill_color == "#0000FF"
        assert override.marker_alpha == 0.5

    def test_color_validation(self):
        from app.domain.style import LayerStyle
        from pydantic import ValidationError
        with pytest.raises(ValidationError):
            LayerStyle(marker_fill_color="red")
        with pytest.raises(ValidationError):
            LayerStyle(marker_fill_color="#GG0000")

    def test_font_size_range(self):
        from app.domain.style import AxisFormat
        from pydantic import ValidationError
        with pytest.raises(ValidationError):
            AxisFormat(title_font_size_pt=3.0)
        with pytest.raises(ValidationError):
            AxisFormat(title_font_size_pt=37.0)

    def test_marker_size_range(self):
        from app.domain.style import LayerStyle
        from pydantic import ValidationError
        with pytest.raises(ValidationError):
            LayerStyle(marker_size_pt=0.5)
        with pytest.raises(ValidationError):
            LayerStyle(marker_size_pt=21.0)


class TestExpressionAST:
    """Validate Expression discriminated union."""

    def test_measurement_expr(self):
        from app.domain.expression import MeasurementExpr
        expr = MeasurementExpr(analyte="La", chemical_form="element", unit="ppm")
        assert expr.kind == "measurement"

    def test_normalize_expr(self):
        from app.domain.expression import NormalizeExpr, MeasurementExpr
        expr = NormalizeExpr(
            value=MeasurementExpr(analyte="La", chemical_form="element", unit="ppm"),
            reference_id="Chondrite_MS95",
            reference_version="1",
        )
        assert expr.kind == "normalize"

    def test_ratio_expr(self):
        from app.domain.expression import RatioExpr, MeasurementExpr
        expr = RatioExpr(
            numerator=MeasurementExpr(analyte="Rb", chemical_form="element", unit="ppm"),
            denominator=MeasurementExpr(analyte="Sr", chemical_form="element", unit="ppm"),
        )
        assert expr.kind == "ratio"

    def test_add_expr(self):
        from app.domain.expression import AddExpr, MeasurementExpr
        expr = AddExpr(operands=[
            MeasurementExpr(analyte="Na2O", chemical_form="oxide", unit="wt%"),
            MeasurementExpr(analyte="K2O", chemical_form="oxide", unit="wt%"),
        ])
        assert expr.kind == "add"
        assert len(expr.operands) == 2

    def test_expression_tree_depth_limit(self):
        from app.domain.expression import (
            NormalizeExpr, MeasurementExpr, validate_expression_tree,
            MAX_EXPRESSION_DEPTH,
        )
        inner = MeasurementExpr(analyte="La", chemical_form="element", unit="ppm")
        for _ in range(MAX_EXPRESSION_DEPTH + 1):
            inner = NormalizeExpr(
                value=inner,
                reference_id="ref",
                reference_version="1",
            )
        with pytest.raises(ValueError, match="depth"):
            validate_expression_tree(inner)

    def test_expression_tree_node_limit(self):
        from app.domain.expression import (
            AddExpr, MeasurementExpr, validate_expression_tree,
            MAX_EXPRESSION_NODES,
        )
        operands = [
            MeasurementExpr(analyte=f"E{i}", chemical_form="element", unit="ppm")
            for i in range(MAX_EXPRESSION_NODES + 1)
        ]
        expr = AddExpr(operands=operands)
        with pytest.raises(ValueError, match="node"):
            validate_expression_tree(expr)


class TestRecordModels:
    """Validate Figure, Export, Runtime models."""

    def test_figure_model(self):
        from app.domain.records import Figure
        from app.domain.enums import ChartType
        fig = Figure(
            figure_id="fig_001",
            project_id="proj_001",
            name="Test Figure",
            chart_type=ChartType.SCATTER,
        )
        assert fig.metadata_revision == 1
        assert fig.current_revision_id is None

    def test_figure_draft(self):
        from app.domain.records import FigureDraft
        from app.domain.plot_spec import PlotSpec
        spec_data = load_fixture("scatter_valid.json")
        spec = PlotSpec(**spec_data)
        draft = FigureDraft(
            figure_id="fig_001",
            spec=spec,
        )
        assert draft.draft_revision == 1

    def test_export_record_states(self):
        from app.domain.records import ExportRecord
        from app.domain.enums import ExportState
        record = ExportRecord(
            export_id="exp_001",
            figure_id="fig_001",
            revision_id="rev_001",
            scene_id="scene_001",
            scene_hash="abc123",
            export_seq=1,
            formats=[],
            size_mm={"width": 183.0, "height": 110.0},
            dpi=600,
            background="white",
            export_root_id="root_001",
            relative_dir="project/figure/v0001",
        )
        assert record.state == ExportState.QUEUED

    def test_runtime_status(self):
        from app.domain.records import RuntimeStatus
        from app.domain.enums import RuntimeState
        from datetime import datetime, timezone
        status = RuntimeStatus(
            app_id="geoplot",
            app_version="1.0.0",
            profile_id="default",
            instance_id="abc123",
            pid=1234,
            process_started_at=datetime.now(timezone.utc),
            state=RuntimeState.RUNNING,
            base_url="http://127.0.0.1:8765",
        )
        assert status.state == RuntimeState.RUNNING


class TestSchemaGeneration:
    """Generate and validate OpenAPI/JSON Schema output."""

    def test_plot_spec_json_schema(self):
        from app.domain.plot_spec import PlotSpec
        schema = PlotSpec.model_json_schema()
        assert schema is not None
        assert "properties" in schema
        schema_path = CONTRACTS_DIR / "plot-spec.schema.json"
        schema_path.write_text(json.dumps(schema, indent=2, ensure_ascii=False), encoding="utf-8")

    def test_plot_scene_json_schema(self):
        from app.domain.plot_spec import PlotScene
        schema = PlotScene.model_json_schema()
        assert schema is not None
        schema_path = CONTRACTS_DIR / "plot-scene.schema.json"
        schema_path.write_text(json.dumps(schema, indent=2, ensure_ascii=False), encoding="utf-8")


class TestFixtureHashes:
    """Compute and record fixture hashes for CONTRACT_READY.json."""

    def test_fixture_hashes(self):
        hashes = {}
        for f in FIXTURES_DIR.glob("*.json"):
            if f.name == "manifest.json":
                continue
            content = f.read_bytes()
            hashes[f.name] = hashlib.sha256(content).hexdigest()
        manifest_path = FIXTURES_DIR / "hashes.json"
        manifest_path.write_text(json.dumps(hashes, indent=2), encoding="utf-8")
        assert len(hashes) >= 8
