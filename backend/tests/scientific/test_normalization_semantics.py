"""R01–R06 科学数值正确性（说明书 §6 原 P0 验收，18 明示 R07–R20 不替代本组）。

覆盖 QR02 语义：标准化数值、单位换算、raw/normalized 独立、比值/双参考、
错误显式化、TAS 无挥发分折算。全部走真实 build_scene/evaluate_expression 内核。
"""
from __future__ import annotations

import shutil
import tempfile
import uuid
from pathlib import Path

import pytest

from app.domain.enums import ChartType
from app.domain.expression import (
    ConstantExpr,
    MeasurementExpr,
    NormalizeExpr,
    RatioExpr,
)
from app.domain.plot_spec import PlotSpec
from app.domain.style import LayerSpec, VariablesConfig
from app.services.scenes import (
    Repository,
    _get_measurement_map,
    build_scene,
    evaluate_expression,
)
from app.storage.database import Database

CHONDRITE = {
    "La": 0.237, "Ce": 0.613, "Pr": 0.0928, "Nd": 0.457, "Sm": 0.148,
    "Eu": 0.0563, "Gd": 0.199, "Tb": 0.0361, "Dy": 0.246, "Ho": 0.0546,
    "Er": 0.16, "Tm": 0.0247, "Yb": 0.161, "Lu": 0.0246,
}
REE14 = ["La", "Ce", "Pr", "Nd", "Sm", "Eu", "Gd", "Tb", "Dy", "Ho", "Er", "Tm", "Yb", "Lu"]


@pytest.fixture
def tmp_path():
    """避免 pytest-of-* 目录权限问题：自建临时目录。"""
    d = Path(tempfile.mkdtemp(prefix="normtest_"))
    yield d
    shutil.rmtree(d, ignore_errors=True)


def make_env(tmp_path, reference_versions=None):
    """真实 Database + Repository + 选择集。reference_versions: {version: {analyte: value}}"""
    db = Database(tmp_path / "t.db")
    versions = reference_versions or {"1": CHONDRITE}
    for version, values in versions.items():
        for analyte, value in values.items():
            db.insert_reference_value("Chondrite_MS95", version, analyte, value, "ppm")
    db.insert_analysis("a1", "S1", "1.0", "S1", None, "CE5", "mineral", sheet_name="T", row_number=2)
    db.insert_selection("sel1", "S", "snapshot", ["a1"], "h1", [{"version": "1.0"}])
    repo = Repository(db=db, dataset_versions=["1.0"])
    return db, repo


def add_meas(db, analyte, value, unit, form="element", channel="", state="raw_concentration", aid="a1"):
    db.insert_measurement(f"m_{uuid.uuid4().hex[:10]}", aid, analyte, form, channel, value, unit, state)


def ree_spec(value_mode="normalized", reference_version="1", elements=None):
    return PlotSpec(
        plot_id="p1",
        chart_type=ChartType.REE,
        layers=[LayerSpec(layer_id="L1", label="L", selection_id="sel1")],
        variables=VariablesConfig(
            elements=elements or REE14,
            value_mode=value_mode,
            reference_id="Chondrite_MS95" if value_mode == "normalized" else None,
            reference_version=reference_version if value_mode == "normalized" else None,
        ),
    )


class TestR01Normalization:
    def test_ree_normalized_values(self, tmp_path):
        """La 2.37/Sm .148/Yb .322 → 10/1/2（Chondrite_MS95@1）。"""
        db, repo = make_env(tmp_path)
        add_meas(db, "La", 2.37, "ppm")
        add_meas(db, "Sm", 0.148, "ppm")
        add_meas(db, "Yb", 0.322, "ppm")
        scene = build_scene(ree_spec(), repo)
        y = {p.provenance["element"]: p.y for p in scene.series[0].points}
        assert y["La"] == pytest.approx(10.0)
        assert y["Sm"] == pytest.approx(1.0)
        assert y["Yb"] == pytest.approx(2.0)
        # 缺元素保持缺口（不压缩）
        assert y["Ce"] is None
        assert len(scene.series[0].points) == 14

    def test_spider_normalized_values(self, tmp_path):
        """spider 同样 10/1/2。"""
        db, repo = make_env(tmp_path)
        add_meas(db, "La", 2.37, "ppm")
        add_meas(db, "Sm", 0.148, "ppm")
        add_meas(db, "Yb", 0.322, "ppm")
        spec = PlotSpec(
            plot_id="p2",
            chart_type=ChartType.SPIDER,
            layers=[LayerSpec(layer_id="L1", label="L", selection_id="sel1")],
            variables=VariablesConfig(
                elements=["La", "Sm", "Yb"],
                value_mode="normalized",
                reference_id="Chondrite_MS95",
                reference_version="1",
            ),
        )
        scene = build_scene(spec, repo)
        y = {p.provenance["element"]: p.y for p in scene.series[0].points}
        assert y["La"] == pytest.approx(10.0)
        assert y["Sm"] == pytest.approx(1.0)
        assert y["Yb"] == pytest.approx(2.0)

    def test_2x_reference_halves_values(self, tmp_path):
        """2 倍参考 → 5/.5/1。"""
        dbl = {k: v * 2 for k, v in CHONDRITE.items()}
        db, repo = make_env(tmp_path, reference_versions={"1": CHONDRITE, "2": dbl})
        add_meas(db, "La", 2.37, "ppm")
        add_meas(db, "Sm", 0.148, "ppm")
        add_meas(db, "Yb", 0.322, "ppm")
        scene = build_scene(ree_spec(reference_version="2"), repo)
        y = {p.provenance["element"]: p.y for p in scene.series[0].points}
        assert y["La"] == pytest.approx(5.0)
        assert y["Sm"] == pytest.approx(0.5)
        assert y["Yb"] == pytest.approx(1.0)


class TestR02UnitBinding:
    def test_ppb_and_ppm_same_result(self, tmp_path):
        """La 2370ppb 与 2.37ppm：raw 均 2.37 ppm，La_N 均 10，源单位可查。"""
        db, repo = make_env(tmp_path)
        add_meas(db, "La", 2370.0, "ppb")
        raw_scene = build_scene(ree_spec(value_mode="raw"), repo)
        p = raw_scene.series[0].points[0]
        assert p.y == pytest.approx(2.37)
        assert p.provenance["raw_unit"] == "ppb"
        assert p.provenance["raw_value"] == 2370.0
        norm_scene = build_scene(ree_spec(), repo)
        pn = norm_scene.series[0].points[0]
        assert pn.provenance["element"] == "La"
        assert pn.y == pytest.approx(10.0)


class TestR03ColumnIndependence:
    def test_raw_normalized_error_columns_independent(self, tmp_path):
        """La(raw) / La_N(已标准化) / La_2se(误差列) 互不覆盖；指定 raw 仍 2.37。"""
        db, repo = make_env(tmp_path)
        add_meas(db, "La", 2.37, "ppm")
        add_meas(db, "La_N", 10.0, "ppm", state="normalized")
        add_meas(db, "La_2se", 0.05, "ppm")
        m = _get_measurement_map(repo.get_measurements("a1"))
        assert m["La"]["value"] == 2.37
        assert m["La_N"]["value"] == 10.0
        assert m["La_2se"]["value"] == 0.05
        # 指定 raw：normalize(La) 用 raw 值 2.37 → 10，不取 La_N，不二次标准化
        expr = NormalizeExpr(
            value=MeasurementExpr(analyte="La", chemical_form="element", unit="ppm"),
            reference_id="Chondrite_MS95",
            reference_version="1",
        )
        r = evaluate_expression(expr, m, repo=repo)
        assert r.value == pytest.approx(10.0)
        # 对已标准化记录再标准化 → 显式拒绝
        expr2 = NormalizeExpr(
            value=MeasurementExpr(analyte="La_N", chemical_form="element", unit="ppm"),
            reference_id="Chondrite_MS95",
            reference_version="1",
        )
        r2 = evaluate_expression(expr2, m, repo=repo)
        assert r2.value is None
        assert "ALREADY_NORMALIZED" in r2.reasons


class TestR04RatioAndDualReference:
    def test_scatter_ratio_and_normalized_ratio(self, tmp_path):
        """X=Rb10/Sr100 → 0.1；Y=(La/Yb)N → 5（各自节点参考）。"""
        db, repo = make_env(tmp_path)
        add_meas(db, "Rb", 10.0, "ppm")
        add_meas(db, "Sr", 100.0, "ppm")
        add_meas(db, "La", 2.37, "ppm")
        add_meas(db, "Yb", 0.322, "ppm")
        spec = PlotSpec(
            plot_id="p4",
            chart_type=ChartType.SCATTER,
            layers=[LayerSpec(layer_id="L1", label="L", selection_id="sel1")],
            variables=VariablesConfig(
                x=RatioExpr(
                    numerator=MeasurementExpr(analyte="Rb", chemical_form="element", unit="ppm"),
                    denominator=MeasurementExpr(analyte="Sr", chemical_form="element", unit="ppm"),
                ),
                y=RatioExpr(
                    numerator=NormalizeExpr(
                        value=MeasurementExpr(analyte="La", chemical_form="element", unit="ppm"),
                        reference_id="Chondrite_MS95",
                        reference_version="1",
                    ),
                    denominator=NormalizeExpr(
                        value=MeasurementExpr(analyte="Yb", chemical_form="element", unit="ppm"),
                        reference_id="Chondrite_MS95",
                        reference_version="1",
                    ),
                ),
            ),
        )
        scene = build_scene(spec, repo)
        p = scene.series[0].points[0]
        assert p.x == pytest.approx(0.1)
        assert p.y == pytest.approx(5.0)
        # 两轴各自参考进快照（QR02：节点级 reference 进 reference_snapshots）
        snap_ids = {(s.ref_id, s.version) for s in scene.reference_snapshots}
        assert ("Chondrite_MS95", "1") in snap_ids

    def test_node_level_reference_not_global(self, tmp_path):
        """normalize 节点用 v2 参考，不受 variables 全局 v1 干扰。"""
        dbl = {k: v * 2 for k, v in CHONDRITE.items()}
        db, repo = make_env(tmp_path, reference_versions={"1": CHONDRITE, "2": dbl})
        add_meas(db, "La", 2.37, "ppm")
        m = _get_measurement_map(repo.get_measurements("a1"))
        expr = NormalizeExpr(
            value=MeasurementExpr(analyte="La", chemical_form="element", unit="ppm"),
            reference_id="Chondrite_MS95",
            reference_version="2",
        )
        r = evaluate_expression(expr, m, ref_values=CHONDRITE, ref_units={}, repo=repo)
        assert r.value == pytest.approx(5.0), "节点级 v2 参考必须生效（0.237*2=0.474 → 5）"


class TestR05ExplicitErrors:
    def test_missing_reference_not_raw_fallback(self, tmp_path):
        """缺参考 → NORMALIZER_INCOMPLETE 缺口，绝不回退 raw。"""
        db, repo = make_env(tmp_path)
        add_meas(db, "La", 2.37, "ppm")
        spec = PlotSpec(
            plot_id="p5a",
            chart_type=ChartType.REE,
            layers=[LayerSpec(layer_id="L1", label="L", selection_id="sel1")],
            variables=VariablesConfig(
                elements=["La", "Ce"],
                value_mode="normalized",
                reference_id="NoSuchRef",
                reference_version="1",
            ),
        )
        scene = build_scene(spec, repo)
        p = scene.series[0].points[0]
        assert p.y is None
        assert "NORMALIZER_INCOMPLETE" in p.quality_flags

    def test_unknown_unit_explicit(self, tmp_path):
        """未知单位换算 → 显式 UNSUPPORTED_CONVERSION，不返回原值。"""
        db, repo = make_env(tmp_path)
        add_meas(db, "La", 1.0, "ng/g")
        m = _get_measurement_map(repo.get_measurements("a1"))
        expr = NormalizeExpr(
            value=MeasurementExpr(analyte="La", chemical_form="element", unit="ppm"),
            reference_id="Chondrite_MS95",
            reference_version="1",
        )
        r = evaluate_expression(expr, m, repo=repo)
        assert r.value is None
        assert any("UNSUPPORTED_CONVERSION" in x for x in r.reasons)

    def test_channel_conflict_explicit(self, tmp_path):
        """同 analyte 同通道多值 → CHANNEL_CONFLICT，不静默取首值。"""
        db, repo = make_env(tmp_path)
        add_meas(db, "La", 2.37, "ppm")
        add_meas(db, "La", 3.0, "ppm")
        m = _get_measurement_map(repo.get_measurements("a1"))
        expr = MeasurementExpr(analyte="La", chemical_form="element", unit="ppm")
        r = evaluate_expression(expr, m)
        assert r.value is None
        assert "CHANNEL_CONFLICT" in r.reasons

    def test_zero_denominator_explicit(self, tmp_path):
        """零分母 → ZERO_DENOMINATOR。"""
        m = {
            "Rb": {"value": 10.0, "unit": "ppm", "chemical_form": "element", "value_state": "raw", "channel": ""},
            "Sr": {"value": 0.0, "unit": "ppm", "chemical_form": "element", "value_state": "raw", "channel": ""},
        }
        expr = RatioExpr(
            numerator=MeasurementExpr(analyte="Rb", chemical_form="element", unit="ppm"),
            denominator=MeasurementExpr(analyte="Sr", chemical_form="element", unit="ppm"),
        )
        r = evaluate_expression(expr, m)
        assert r.value is None
        assert "ZERO_DENOMINATOR" in r.reasons

    def test_nonpositive_log_range_rejected(self):
        """log10 轴非正手动范围 → 合同层直接拒绝。"""
        with pytest.raises(Exception):
            PlotSpec(
                plot_id="p5b",
                chart_type=ChartType.SCATTER,
                layers=[LayerSpec(layer_id="L1", label="L", selection_id="sel1")],
                variables=VariablesConfig(
                    x=ConstantExpr(value=1.0, unit="ppm"),
                    y=ConstantExpr(value=1.0, unit="ppm"),
                ),
                axes={
                    "x": {"scale": "log10", "range_mode": "manual", "min": 0.0, "max": 10.0},
                    "y": {"scale": "linear"},
                },
            )


class TestR06TASAnhydrous:
    MAJORS = {
        "SiO2": 50.0, "TiO2": 1.0, "Al2O3": 2.0, "Fe2O3": 3.0, "FeO": 4.0,
        "MnO": 5.0, "MgO": 6.0, "CaO": 6.0, "Na2O": 2.0, "K2O": 1.0,
    }  # 总和 80

    def tas_spec(self, basis):
        return PlotSpec(
            plot_id="p6",
            chart_type=ChartType.TAS,
            layers=[LayerSpec(layer_id="L1", label="L", selection_id="sel1")],
            variables=VariablesConfig(),
            diagram={
                "model_id": "tas_LeMaitre",
                "model_version": "1",
                "mode": "reference",
                "oxide_basis": basis,
                "oxide_set": ["SiO2", "Na2O", "K2O"],
            },
        )

    def test_raw_and_dry(self, tmp_path):
        """总和 80：raw (50,3)，dry (62.5,3.75)。"""
        db, repo = make_env(tmp_path)
        for ox, v in self.MAJORS.items():
            add_meas(db, ox, v, "wt%", form="oxide")
        raw_scene = build_scene(self.tas_spec("raw"), repo)
        p = raw_scene.series[0].points[0]
        assert p.x == pytest.approx(50.0)
        assert p.y == pytest.approx(3.0)
        dry_scene = build_scene(self.tas_spec("anhydrous_100"), repo)
        pd = dry_scene.series[0].points[0]
        assert pd.x == pytest.approx(62.5)
        assert pd.y == pytest.approx(3.75)

    def test_missing_oxide_rejects_dry(self, tmp_path):
        """缺 MnO → 拒绝 dry（不补 0）。"""
        db, repo = make_env(tmp_path)
        for ox, v in self.MAJORS.items():
            if ox == "MnO":
                continue
            add_meas(db, ox, v, "wt%", form="oxide")
        scene = build_scene(self.tas_spec("anhydrous_100"), repo)
        p = scene.series[0].points[0]
        assert p.x is None and p.y is None
        assert "INCOMPLETE_MAJOR_OXIDES" in p.quality_flags or "MISSING_MnO" in p.quality_flags

    def test_iron_not_double_counted(self, tmp_path):
        """FeOT 存在时不重复计入十项总和。"""
        db, repo = make_env(tmp_path)
        for ox, v in self.MAJORS.items():
            add_meas(db, ox, v, "wt%", form="oxide")
        add_meas(db, "FeOT", 7.0, "wt%", form="oxide")  # 干扰项
        scene = build_scene(self.tas_spec("anhydrous_100"), repo)
        p = scene.series[0].points[0]
        assert p.x == pytest.approx(62.5), "FeOT 不得参与十项折算"
        assert p.y == pytest.approx(3.75)
