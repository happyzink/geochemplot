"""Scientific tests for diagram services.

Spider: reuses REE pipeline, validates reference coverage.
TAS: verified geometry, oxide validation, classification.
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from app.domain.enums import ChartType
from app.domain.expression import MeasurementExpr
from app.domain.plot_spec import PlotSpec
from app.domain.style import LayerSpec, VariablesConfig
from app.services.diagrams import (
    TASClassification,
    build_tas_geometry,
    check_reference_completeness,
    classify_tas_point,
    load_tas_manifest,
    validate_spider_elements,
    validate_tas_oxides,
    verify_tas_classification,
)


class TestSpiderValidation:
    def test_complete_reference(self):
        """Spider with complete reference should pass validation."""
        spec = PlotSpec(
            plot_id="spider_ok",
            chart_type=ChartType.SPIDER,
            layers=[LayerSpec(layer_id="L1", label="Spider", selection_id="sel1")],
            variables=VariablesConfig(
                elements=["La", "Ce", "Nd", "Sm", "Eu", "Gd", "Dy", "Yb", "Lu"],
                value_mode="normalized",
                reference_id="Chondrite_MS95",
                reference_version="1",
            ),
        )
        reference = {
            "La": 0.310, "Ce": 0.808, "Nd": 0.600, "Sm": 0.195,
            "Eu": 0.0735, "Gd": 0.259, "Dy": 0.322, "Yb": 0.209, "Lu": 0.0322,
        }

        result = validate_spider_elements(spec, reference)
        assert result.valid is True
        assert result.coverage == 1.0
        assert len(result.missing_elements) == 0

    def test_missing_element_in_reference(self):
        """Spider with missing Rb in reference should fail validation."""
        spec = PlotSpec(
            plot_id="spider_missing",
            chart_type=ChartType.SPIDER,
            layers=[LayerSpec(layer_id="L1", label="Spider", selection_id="sel1")],
            variables=VariablesConfig(
                elements=["Rb", "La", "Ce"],
                value_mode="normalized",
                reference_id="test",
                reference_version="1",
            ),
        )
        reference = {"La": 1.0, "Ce": 2.0}

        result = validate_spider_elements(spec, reference)
        assert result.valid is False
        assert "Rb" in result.missing_elements
        assert result.coverage < 1.0
        assert any("NORMALIZER_INCOMPLETE" in w for w in result.warnings)

    def test_non_spider_always_valid(self):
        """Non-spider chart should always pass validation."""
        spec = PlotSpec(
            plot_id="scatter",
            chart_type=ChartType.SCATTER,
            layers=[LayerSpec(layer_id="L1", label="S", selection_id="sel1")],
            variables=VariablesConfig(
                x=MeasurementExpr(analyte="SiO2", chemical_form="oxide", unit="wt%"),
                y=MeasurementExpr(analyte="MgO", chemical_form="oxide", unit="wt%"),
            ),
        )
        result = validate_spider_elements(spec, {})
        assert result.valid is True


class TestTASGeometry:
    def test_manifest_loads(self):
        """TAS manifest should load from resources."""
        manifest = load_tas_manifest()
        assert manifest["model_id"] == "tas_LeMaitre"
        assert "fields" in manifest
        assert len(manifest["fields"]) > 0

    def test_manifest_provenance_verified(self):
        """R11：来源哈希为真实值且坐标已验证（不再 placeholder）。"""
        manifest = load_tas_manifest()
        source = manifest["source"]
        assert source["package"] == "pyrolite"
        assert source["package_version"] == "0.3.8.post1"
        assert source["license_expression"] == "MIT"
        assert source["file_sha256"].startswith("sha256:")
        assert "placeholder" not in source["file_sha256"]
        assert manifest["verification"]["boundary_coordinates_verified"] is True
        # 版本化提取件与来源哈希一致
        import hashlib
        raw_path = Path(__file__).parent.parent.parent / "app" / "resources" / "diagrams" / "tas_lemaitre_config_pyrolite-0.3.8.post1.json"
        raw_hash = hashlib.sha256(raw_path.read_bytes()).hexdigest()
        assert source["file_sha256"] == f"sha256:{raw_hash}"
        # 旧版资源保留且标 deprecated
        legacy = Path(__file__).parent.parent.parent / "app" / "resources" / "diagrams" / "history" / "tas_manifest.2026-10-28.preverified.deprecated.json"
        assert legacy.exists()

    def test_geometry_builds(self):
        """R12：多边形独立闭合、共享边去重、禁止顶点链。"""
        geom = build_tas_geometry()
        assert geom.model_id == "tas_LeMaitre"
        assert len(geom.polygons) == 17  # 19 fields - nan/none 空占位
        assert all(len(p.vertices) >= 3 for p in geom.polygons)
        # legacy 扁平顶点链必须为空（禁止把所有 polygon 顶点连成一条线）
        assert geom.boundary_coordinates == []
        assert geom.region_labels == {}
        # 共享边去重：segments 数 == 唯一无向边数
        edge_set = set()
        for p in geom.polygons:
            vs = p.vertices
            for i in range(len(vs)):
                edge_set.add(tuple(sorted([tuple(vs[i]), tuple(vs[(i + 1) % len(vs)])])))
        seg_set = {tuple(sorted([tuple(s[0]), tuple(s[1])])) for s in geom.segments}
        assert seg_set == edge_set
        assert len(geom.segments) == len(edge_set)

    def test_geometry_stable_across_builds(self):
        """两次构建几何逐字节一致（冻结可复现）。"""
        g1 = build_tas_geometry()
        g2 = build_tas_geometry()
        assert [p.model_dump() for p in g1.polygons] == [p.model_dump() for p in g2.polygons]
        assert g1.segments == g2.segments
        assert g1.source_hash == g2.source_hash

    def test_subalkalic_basalt_classification(self):
        """SiO2=48, Na2O=1, K2O=0.5 should classify as Bs (Subalkalic Basalt).

        This is the correct classification per official LeMaitre model.
        Old implementation incorrectly used rectangular boundaries.
        """
        result = classify_tas_point(48.0, 1.0, 0.5)
        assert result is not None
        assert result.field_name == "Bs"
        assert "Subalkalic" in result.field_label
        assert result.x_value == 48.0
        assert result.y_value == 1.5

    def test_dacite_classification_high_sio2(self):
        """SiO2=72, Na2O=2, K2O=1.5 should classify as O3 (Dacite).

        This is the correct classification per official LeMaitre model.
        Old implementation incorrectly classified as Rhyolite.
        """
        result = classify_tas_point(72.0, 2.0, 1.5)
        assert result is not None
        assert result.field_name == "O3"
        assert "Dacite" in result.field_label

    def test_dacite_classification_mid_sio2(self):
        """SiO2=65, Na2O=3, K2O=2 should classify as O3 (Dacite).

        This is the correct classification per official LeMaitre model.
        Old implementation incorrectly classified as Trachyte.
        """
        result = classify_tas_point(65.0, 3.0, 2.0)
        assert result is not None
        assert result.field_name == "O3"
        assert "Dacite" in result.field_label

    def test_outside_all_fields(self):
        """Point outside all fields should return None."""
        result = classify_tas_point(30.0, 0.5, 0.1)
        assert result is None

    def test_shared_boundary_point_reports_all_candidates(self):
        """R12：(52,5) 为 Ba/Bs/O1/S1/S2 共享顶点 → on_boundary 候选齐全，不偏移取唯一岩名。"""
        result = classify_tas_point(52.0, 2.5, 2.5)
        assert result is not None
        assert result.status == "on_boundary"
        assert result.confidence == "boundary"
        assert {"Ba", "Bs", "O1", "S1", "S2"}.issubset(set(result.candidate_fields))
        # 容差以轴数据单位记录
        assert result.boundary_tolerance_wt_pct == pytest.approx(1e-6)

    def test_edge_midpoint_on_boundary(self):
        """Bs 顶边中点 (48.5, 3.5) 在边界线上 → on_boundary。"""
        result = classify_tas_point(48.5, 1.75, 1.75)
        assert result is not None
        assert result.status == "on_boundary"
        assert "Bs" in result.candidate_fields

    def test_outer_point_out_of_domain(self):
        """R12：域外点 (30, 0.2) → out_of_domain（None）。"""
        assert classify_tas_point(30.0, 0.1, 0.1) is None

    def test_verify_report_all_passed(self):
        """R11/R12 综合验证：三合成点 + 随机内点交叉比对 + 边界/外点 + 几何不变量。"""
        report = verify_tas_classification(random_points=200)
        assert report["all_passed"] is True, report
        assert report["cross_check"]["mismatches"] == 0
        assert report["boundary_point"]["passed"] is True
        assert report["outer_point"]["passed"] is True
        assert report["geometry"]["passed"] is True
        assert report["geometry"]["polygon_count"] == 17


class TestTASOxideValidation:
    def test_complete_oxides(self):
        """TAS with all required oxides should pass."""
        spec = PlotSpec(
            plot_id="tas_ok",
            chart_type=ChartType.TAS,
            layers=[LayerSpec(layer_id="L1", label="TAS", selection_id="sel1")],
            variables=VariablesConfig(),
            diagram={"model_id": "tas_LeMaitre", "model_version": "1", "mode": "reference",
                     "oxide_basis": "raw", "oxide_set": ["SiO2", "Na2O", "K2O"]},
        )
        measurements = {"SiO2": 50.0, "Na2O": 2.0, "K2O": 1.0}

        valid, missing = validate_tas_oxides(spec, measurements)
        assert valid is True
        assert len(missing) == 0

    def test_missing_k2o(self):
        """TAS without K2O should fail validation."""
        spec = PlotSpec(
            plot_id="tas_missing",
            chart_type=ChartType.TAS,
            layers=[LayerSpec(layer_id="L1", label="TAS", selection_id="sel1")],
            variables=VariablesConfig(),
            diagram={"model_id": "tas_LeMaitre", "model_version": "1", "mode": "reference",
                     "oxide_basis": "raw", "oxide_set": ["SiO2", "Na2O", "K2O"]},
        )
        measurements = {"SiO2": 50.0, "Na2O": 2.0}

        valid, missing = validate_tas_oxides(spec, measurements)
        assert valid is False
        assert "K2O" in missing


class TestReferenceCompleteness:
    def test_all_present(self):
        """All elements present should return empty list."""
        elements = ["La", "Ce", "Nd"]
        reference = {"La": 1.0, "Ce": 2.0, "Nd": 3.0}
        missing = check_reference_completeness(elements, reference)
        assert len(missing) == 0

    def test_some_missing(self):
        """Missing elements should be returned."""
        elements = ["La", "Ce", "Nd", "Sm"]
        reference = {"La": 1.0, "Nd": 3.0}
        missing = check_reference_completeness(elements, reference)
        assert "Ce" in missing
        assert "Sm" in missing
        assert len(missing) == 2
