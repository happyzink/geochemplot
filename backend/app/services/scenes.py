"""PlotScene builder - evaluates expressions against frozen data.

build_scene() takes a PlotSpec and Repository, returns a frozen PlotScene.
Repository provides fixed dataset_version queries; no "latest version" lookups.
"""
from __future__ import annotations

import math
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Optional

from ..domain.enums import ChartType
from ..domain.plot_spec import (
    AxisScene,
    DiagramGeometry,
    Exclusion,
    FontManifest,
    PlotScene,
    PlotSpec,
    ReferenceSnapshot,
    ResolvedSelection,
    SceneCounts,
    ScenePoint,
    SceneSeries,
)
from ..domain.expression import (
    AddExpr,
    ConstantExpr,
    Expression,
    MeasurementExpr,
    NormalizeExpr,
    RatioExpr,
)
from ..services.calculations import CalcResult, normalize, ratio
from ..storage.database import Database


REE_ELEMENTS = [
    "La", "Ce", "Pr", "Nd", "Sm", "Eu", "Gd", "Tb",
    "Dy", "Ho", "Er", "Tm", "Yb", "Lu",
]

SOFTWARE_VERSION = "1.0.0"


@dataclass
class Repository:
    """Provides fixed dataset_version queries for scene building."""
    db: Database
    dataset_versions: list[str]

    def get_measurements(self, analysis_id: str) -> list[dict]:
        return self.db.get_measurements(analysis_id)

    def get_analysis(self, analysis_id: str) -> Optional[dict]:
        return self.db.get_analysis(analysis_id)

    def get_selection(self, selection_id: str) -> Optional[dict]:
        with self.db.connect() as conn:
            row = conn.execute(
                "SELECT * FROM selections WHERE selection_id = ?",
                (selection_id,)
            ).fetchone()
            return dict(row) if row else None

    def get_reference(self, ref_id: str, version: str) -> Optional[dict]:
        with self.db.connect() as conn:
            rows = conn.execute(
                """SELECT analyte, value, unit FROM reference_values
                   WHERE ref_id = ? AND version = ?""",
                (ref_id, version)
            ).fetchall()
            if not rows:
                return None
            values = {}
            units = {}
            for r in rows:
                values[r["analyte"]] = r["value"]
                units[r["analyte"]] = r["unit"]
            return {"values": values, "units": units}


def evaluate_expression(expr: Expression, meas_map: dict[str, dict[str, Any]],
                        ref_values: Optional[dict[str, float]] = None,
                        ref_units: Optional[dict[str, str]] = None,
                        repo: Optional["Repository"] = None,
                        ref_usage: Optional[dict] = None) -> CalcResult:
    """Evaluate an expression AST against a typed measurement map.

    meas_map: {analyte: {value, unit, chemical_form, value_state, channel}}
    QR02：normalize 节点各自解析 reference_id/version（repo 优先，ref_values 兜底）；
    单位转换失败与通道冲突显式报因，不静默取值。
    """
    if isinstance(expr, ConstantExpr):
        return CalcResult(value=expr.value, unit=expr.unit, reasons=[])

    if isinstance(expr, MeasurementExpr):
        m = _resolve_measurement(meas_map, expr.analyte, expr.unit,
                                 expr.chemical_form, expr.channel)
        if m is None:
            return CalcResult(value=None, unit=expr.unit, reasons=["MISSING"])
        if m.get("conflict"):
            # R05：同分析同通道多值冲突 → 明确排除，不取第一个
            return CalcResult(value=None, unit=expr.unit, reasons=["CHANNEL_CONFLICT"])
        # Convert source unit to target unit if needed
        value = _convert_unit(m["value"], m["unit"], expr.unit)
        if value is None:
            return CalcResult(value=None, unit=expr.unit,
                              reasons=[f"UNSUPPORTED_CONVERSION:{m['unit']}->{expr.unit}"])
        return CalcResult(value=value, unit=expr.unit, reasons=[])

    if isinstance(expr, NormalizeExpr):
        inner = evaluate_expression(expr.value, meas_map, ref_values, ref_units, repo, ref_usage)
        if inner.value is None:
            return CalcResult(value=None, unit="dimensionless", reasons=inner.reasons)
        # Get analyte from child expression（QR02：经 measurement 子节点定元素）
        analyte = expr.analyte
        if analyte is None:
            return CalcResult(value=None, unit="dimensionless", reasons=["NO_ANALYTE"])
        # 已标准化记录不允许二次标准化（任务书 §2）
        if isinstance(expr.value, MeasurementExpr):
            child = _resolve_measurement(meas_map, expr.value.analyte)
            if child and child.get("value_state") == "normalized":
                return CalcResult(value=None, unit="dimensionless", reasons=["ALREADY_NORMALIZED"])
        # 节点级参考解析（QR02：遍历各节点解析各自 reference_id/version）
        node_values, node_units = ref_values, ref_units
        if repo is not None:
            rd = repo.get_reference(expr.reference_id, expr.reference_version or "1")
            if rd is not None:
                node_values, node_units = rd["values"], rd["units"]
                if ref_usage is not None:
                    ref_usage[(expr.reference_id, expr.reference_version or "1")] = rd
        if node_values is None or analyte not in node_values:
            return CalcResult(value=None, unit="dimensionless", reasons=["NORMALIZER_INCOMPLETE"])
        ref_val = node_values.get(analyte)
        if ref_val is None or ref_val <= 0:
            return CalcResult(value=None, unit="dimensionless", reasons=["ZERO_REFERENCE"])
        # Get reference unit and convert if needed
        ref_unit = (node_units or {}).get(analyte, "ppm")
        return normalize(inner.value, inner.unit, ref_val, ref_unit)

    if isinstance(expr, RatioExpr):
        num = evaluate_expression(expr.numerator, meas_map, ref_values, ref_units, repo, ref_usage)
        den = evaluate_expression(expr.denominator, meas_map, ref_values, ref_units, repo, ref_usage)
        if num.value is None or den.value is None:
            reasons = num.reasons + den.reasons
            return CalcResult(value=None, unit="dimensionless", reasons=reasons)
        # ratio 先独立求两操作数，再量纲校验（QR02）
        return ratio(num.value, num.unit, den.value, den.unit)

    if isinstance(expr, AddExpr):
        total = 0.0
        target_unit = ""
        for op in expr.operands:
            r = evaluate_expression(op, meas_map, ref_values, ref_units, repo, ref_usage)
            if r.value is None:
                return CalcResult(value=None, unit="dimensionless", reasons=r.reasons)
            if target_unit and r.unit != target_unit:
                # Convert to target unit
                r_value = _convert_unit(r.value, r.unit, target_unit)
                if r_value is None:
                    return CalcResult(value=None, unit="dimensionless",
                                      reasons=[f"UNSUPPORTED_CONVERSION:{r.unit}->{target_unit}"])
                total += r_value
            else:
                total += r.value
                target_unit = r.unit
        return CalcResult(value=total, unit=target_unit, reasons=[])

    return CalcResult(value=None, unit="unknown", reasons=["UNKNOWN_EXPR"])


def _get_measurement_map(measurements: list[dict]) -> dict[str, dict[str, Any]]:
    """Build {analyte: {value, unit, chemical_form, value_state, channel}} from measurement records.

    Preserves units and state; does not flatten to single float.
    """
    result = {}
    for m in measurements:
        analyte = m.get("analyte")
        if analyte is None or m.get("value") is None:
            continue
        key = analyte
        if key in result:
            # Conflict: multiple measurements for same analyte
            # Check channel to disambiguate
            channel = m.get("channel", "")
            existing_channel = result[key].get("channel", "")
            if channel and channel != existing_channel:
                # Different channels - keep both with channel suffix
                result[f"{analyte}::{channel}"] = {
                    "value": m["value"],
                    "unit": m.get("unit", ""),
                    "chemical_form": m.get("chemical_form", ""),
                    "value_state": m.get("value_state", "raw"),
                    "channel": channel,
                }
            else:
                # R05：同 analyte 同通道多值 → 标记冲突，禁止静默取首值
                result[key]["conflict"] = True
            continue
        result[key] = {
            "value": m["value"],
            "unit": m.get("unit", ""),
            "chemical_form": m.get("chemical_form", ""),
            "value_state": m.get("value_state", "raw"),
            "channel": m.get("channel", ""),
        }
    return result


def _resolve_measurement(meas_map: dict[str, dict[str, Any]], analyte: str,
                         unit: str = "", chemical_form: str = "",
                         channel: Optional[str] = None) -> Optional[dict[str, Any]]:
    """Resolve a measurement by analyte, optionally filtering by unit/form/channel.

    Returns the measurement dict or None if not found.
    """
    # Direct match
    if analyte in meas_map:
        m = meas_map[analyte]
        if channel and m.get("channel") != channel:
            # Try channel-suffixed key
            key = f"{analyte}::{channel}"
            if key in meas_map:
                return meas_map[key]
            return None
        return m

    # Try channel-suffixed key
    if channel:
        key = f"{analyte}::{channel}"
        if key in meas_map:
            return meas_map[key]

    return None


def _convert_unit(value: float, from_unit: str, to_unit: str) -> Optional[float]:
    """Convert value between units. Supports ppm<->ppb, wt%<->ppm.

    R05：未知转换返回 None（显式失败），不静默返回原值。
    """
    if from_unit == to_unit:
        return value
    conversions = {
        ("ppb", "ppm"): 0.001,
        ("ppm", "ppb"): 1000.0,
        ("wt%", "ppm"): 10000.0,
        ("ppm", "wt%"): 0.0001,
        ("ppb", "wt%"): 1e-7,
        ("wt%", "ppb"): 1e7,
    }
    factor = conversions.get((from_unit, to_unit))
    return value * factor if factor is not None else None


def build_scene(spec: PlotSpec, repo: Repository) -> PlotScene:
    """Build a frozen PlotScene from spec and repository.

    Key invariants:
    - Scatter: X/Y aligned by analysis_id; no positional splicing
    - REE/spider: fixed element order; missing values produce gaps, not dropped positions
    - scene_hash ignores request_id/creation_time
    """
    request_id = f"req_{uuid.uuid4().hex[:16]}"
    scene_id = f"scn_{uuid.uuid4().hex[:12]}"
    spec_hash = spec.compute_spec_hash()
    warnings: list[str] = []
    exclusions: list[Exclusion] = []

    all_series: list[SceneSeries] = []
    all_analysis_ids: set[str] = set()
    valid_ids: set[str] = set()
    excluded_ids: set[str] = set()
    distinct_samples: set[str] = set()
    identity_unknown = 0

    ref_snapshots: list[ReferenceSnapshot] = []
    ref_usage: dict = {}  # QR02：节点级参考使用记录 → 全部进 reference_snapshots
    ref_values: Optional[dict[str, float]] = None
    ref_units: Optional[dict[str, str]] = None
    if spec.variables.value_mode == "normalized" and spec.variables.reference_id:
        ref_data = repo.get_reference(spec.variables.reference_id, spec.variables.reference_version or "1")
        if ref_data:
            ref_values = ref_data["values"]
            ref_units = ref_data["units"]
            # Compute actual SHA-256 hash of reference data
            import hashlib
            import json
            ref_canonical = json.dumps(ref_data["values"], sort_keys=True)
            ref_hash = hashlib.sha256(ref_canonical.encode()).hexdigest()[:16]
            ref_snapshots.append(ReferenceSnapshot(
                ref_id=spec.variables.reference_id,
                version=spec.variables.reference_version or "1",
                hash=ref_hash,
                values=ref_data["values"],
                units=ref_data["units"],
                citation="built-in reference",
                verification_status="verified",
            ))

    for layer in spec.layers:
        if not layer.visible:
            # R14/18 §3：隐藏层不进入渲染 series、不影响自动轴；选择快照仍在 resolved_selections
            continue
        sel_data = repo.get_selection(layer.selection_id)
        if not sel_data:
            warnings.append(f"Selection {layer.selection_id} not found")
            continue

        import json
        analysis_ids = json.loads(sel_data["resolved_ids"])
        all_analysis_ids.update(analysis_ids)

        points: list[ScenePoint] = []
        layer_analysis_ids: list[str] = []
        layer_sample_ids: list[str] = []
        series_created_inline = False  # Track if REE/spider created series already

        if spec.chart_type == ChartType.SCATTER:
            for aid in analysis_ids:
                measurements = repo.get_measurements(aid)
                meas_map = _get_measurement_map(measurements)
                analysis = repo.get_analysis(aid)

                x_result = evaluate_expression(spec.variables.x, meas_map, ref_values, ref_units, repo, ref_usage) if spec.variables.x else CalcResult(None, "", [])
                y_result = evaluate_expression(spec.variables.y, meas_map, ref_values, ref_units, repo, ref_usage) if spec.variables.y else CalcResult(None, "", [])

                flags = []
                if x_result.value is None:
                    flags.extend(x_result.reasons)
                if y_result.value is None:
                    flags.extend(y_result.reasons)

                if x_result.value is not None and y_result.value is not None:
                    valid_ids.add(aid)
                else:
                    excluded_ids.add(aid)
                    exclusions.append(Exclusion(
                        analysis_id=aid,
                        reason_code="MISSING_VALUE",
                    ))

                sample_id = analysis.get("sample_id", "") if analysis else ""
                if analysis and analysis.get("material_type") == "unknown":
                    identity_unknown += 1
                if sample_id:
                    distinct_samples.add(sample_id)

                points.append(ScenePoint(
                    point_id=f"pt_{aid}",
                    analysis_id=aid,
                    x=x_result.value,
                    y=y_result.value,
                    quality_flags=flags,
                    provenance={
                        "x_unit": x_result.unit,
                        "y_unit": y_result.unit,
                        "x_expression": spec.variables.x.model_dump() if spec.variables.x else None,
                        "y_expression": spec.variables.y.model_dump() if spec.variables.y else None,
                    },
                ))
                layer_analysis_ids.append(aid)
                layer_sample_ids.append(sample_id)

        elif spec.chart_type in (ChartType.REE, ChartType.SPIDER):
            elements = spec.variables.elements or REE_ELEMENTS
            is_normalized = spec.variables.value_mode == "normalized"

            # Get reference values for normalization
            ref_vals = ref_values if is_normalized else None
            ref_units_dict = ref_snapshots[0].units if (is_normalized and ref_snapshots) else None

            # Create one series per analysis (B08 fix)
            for aid in analysis_ids:
                measurements = repo.get_measurements(aid)
                meas_map = _get_measurement_map(measurements)
                analysis = repo.get_analysis(aid)

                sample_id = analysis.get("sample_id", "") if analysis else ""
                if analysis and analysis.get("material_type") == "unknown":
                    identity_unknown += 1
                if sample_id:
                    distinct_samples.add(sample_id)

                analysis_points: list[ScenePoint] = []
                has_any_valid = False

                for elem_idx, elem in enumerate(elements):
                    m = _resolve_measurement(meas_map, elem)
                    if m is None:
                        # Missing element - create point with None value
                        analysis_points.append(ScenePoint(
                            point_id=f"pt_{aid}_{elem}",
                            analysis_id=aid,
                            x=float(elem_idx),
                            y=None,
                            quality_flags=["MISSING"],
                            provenance={"element": elem, "raw_value": None, "normalized_value": None},
                        ))
                        continue

                    raw_value = m["value"]
                    raw_unit = m["unit"]

                    if m.get("conflict"):
                        # R05：通道冲突显式排除，不取首值
                        analysis_points.append(ScenePoint(
                            point_id=f"pt_{aid}_{elem}",
                            analysis_id=aid,
                            x=float(elem_idx),
                            y=None,
                            quality_flags=["CHANNEL_CONFLICT"],
                            provenance={"element": elem, "raw_value": None, "raw_unit": raw_unit,
                                        "normalized_value": None},
                        ))
                        continue

                    if is_normalized:
                        if ref_vals is None or elem not in ref_vals:
                            # R05：缺参考不回退 raw 冒充 normalized（NORMALIZER_INCOMPLETE 排除）
                            analysis_points.append(ScenePoint(
                                point_id=f"pt_{aid}_{elem}",
                                analysis_id=aid,
                                x=float(elem_idx),
                                y=None,
                                quality_flags=["NORMALIZER_INCOMPLETE"],
                                provenance={"element": elem, "raw_value": raw_value, "raw_unit": raw_unit,
                                            "normalized_value": None,
                                            "reference_id": spec.variables.reference_id,
                                            "reference_version": spec.variables.reference_version},
                            ))
                            continue
                        # Normalize: convert to reference unit first, then divide
                        ref_unit = (ref_units_dict or {}).get(elem, "ppm")
                        value_in_ref_unit = _convert_unit(raw_value, raw_unit, ref_unit)
                        if value_in_ref_unit is None:
                            analysis_points.append(ScenePoint(
                                point_id=f"pt_{aid}_{elem}",
                                analysis_id=aid,
                                x=float(elem_idx),
                                y=None,
                                quality_flags=[f"UNSUPPORTED_CONVERSION:{raw_unit}->{ref_unit}"],
                                provenance={"element": elem, "raw_value": raw_value, "raw_unit": raw_unit,
                                            "normalized_value": None},
                            ))
                            continue
                        ref_val = ref_vals[elem]
                        if ref_val == 0:
                            normalized_value = None
                            flags = ["ZERO_REFERENCE"]
                        else:
                            normalized_value = value_in_ref_unit / ref_val
                            flags = []
                        has_any_valid = has_any_valid or normalized_value is not None
                        analysis_points.append(ScenePoint(
                            point_id=f"pt_{aid}_{elem}",
                            analysis_id=aid,
                            x=float(elem_idx),
                            y=normalized_value,
                            quality_flags=flags,
                            provenance={
                                "element": elem,
                                "raw_value": raw_value,
                                "raw_unit": raw_unit,
                                "normalized_value": normalized_value,
                                "reference_id": spec.variables.reference_id,
                                "reference_version": spec.variables.reference_version,
                            },
                        ))
                    else:
                        # Raw mode：显示单位统一 ppm（R02：ppb/ppm 导入 raw 均 2.37，源单位可查）
                        display_value = _convert_unit(raw_value, raw_unit, "ppm")
                        if display_value is None:
                            analysis_points.append(ScenePoint(
                                point_id=f"pt_{aid}_{elem}",
                                analysis_id=aid,
                                x=float(elem_idx),
                                y=None,
                                quality_flags=[f"UNSUPPORTED_CONVERSION:{raw_unit}->ppm"],
                                provenance={"element": elem, "raw_value": raw_value, "raw_unit": raw_unit,
                                            "normalized_value": None},
                            ))
                            continue
                        has_any_valid = True
                        analysis_points.append(ScenePoint(
                            point_id=f"pt_{aid}_{elem}",
                            analysis_id=aid,
                            x=float(elem_idx),
                            y=display_value,
                            quality_flags=[],
                            provenance={
                                "element": elem,
                                "raw_value": raw_value,
                                "raw_unit": raw_unit,
                                "normalized_value": None,
                            },
                        ))

                if has_any_valid:
                    valid_ids.add(aid)
                else:
                    excluded_ids.add(aid)

                # Create separate series for this analysis
                style_dict = layer.style.model_dump()
                all_series.append(SceneSeries(
                    series_id=f"ser_{layer.layer_id}_{aid}",
                    layer_id=layer.layer_id,
                    analysis_ids=[aid],
                    sample_ids=[sample_id],
                    label=f"{layer.label} ({sample_id or aid})",
                    style=style_dict,
                    points=analysis_points,
                    break_at_missing=True,
                ))

                layer_analysis_ids.append(aid)
                layer_sample_ids.append(sample_id)

            series_created_inline = True  # REE/spider creates series per analysis

        elif spec.chart_type == ChartType.TAS:
            # TAS requires SiO2, Na2O, K2O
            # Support anhydrous_100 normalization if diagram config specifies it
            anhydrous = False
            if spec.diagram and hasattr(spec.diagram, 'oxide_basis') and spec.diagram.oxide_basis == "anhydrous_100":
                anhydrous = True

            for aid in analysis_ids:
                measurements = repo.get_measurements(aid)
                meas_map = _get_measurement_map(measurements)
                analysis = repo.get_analysis(aid)

                # Get required oxides
                sio2_m = _resolve_measurement(meas_map, "SiO2")
                na2o_m = _resolve_measurement(meas_map, "Na2O")
                k2o_m = _resolve_measurement(meas_map, "K2O")

                flags = []
                if sio2_m is None:
                    flags.append("MISSING_SIO2")
                if na2o_m is None:
                    flags.append("MISSING_NA2O")
                if k2o_m is None:
                    flags.append("MISSING_K2O")

                if anhydrous:
                    # Anhydrous 100% normalization: need all 10 major oxides
                    major_oxides = ["SiO2", "TiO2", "Al2O3", "Fe2O3", "FeO",
                                   "MnO", "MgO", "CaO", "Na2O", "K2O"]
                    major_values = {}
                    for ox in major_oxides:
                        m = _resolve_measurement(meas_map, ox)
                        if m:
                            # Convert to wt% if needed（R05：未知转换显式失败）
                            val = _convert_unit(m["value"], m["unit"], "wt%")
                            if val is None:
                                flags.append(f"UNSUPPORTED_CONVERSION:{m['unit']}->wt%")
                            else:
                                major_values[ox] = val
                        else:
                            flags.append(f"MISSING_{ox}")

                    if len(major_values) == 10:
                        # Calculate sum and normalize
                        total = sum(major_values.values())
                        if total > 0:
                            factor = 100.0 / total
                            sio2 = major_values["SiO2"] * factor
                            na2o = major_values["Na2O"] * factor
                            k2o = major_values["K2O"] * factor
                        else:
                            flags.append("ZERO_TOTAL")
                            sio2 = na2o = k2o = None
                    else:
                        # Missing oxides - cannot do anhydrous normalization
                        flags.append("INCOMPLETE_MAJOR_OXIDES")
                        sio2 = na2o = k2o = None
                else:
                    # Raw mode（R05：转换失败显式排除）
                    def _to_wt(m, name):
                        if not m:
                            return None
                        val = _convert_unit(m["value"], m["unit"], "wt%")
                        if val is None:
                            flags.append(f"UNSUPPORTED_CONVERSION:{m['unit']}->wt%")
                        return val
                    sio2 = _to_wt(sio2_m, "SiO2")
                    na2o = _to_wt(na2o_m, "Na2O")
                    k2o = _to_wt(k2o_m, "K2O")

                x_val = sio2
                y_val = (na2o + k2o) if (na2o is not None and k2o is not None) else None

                if x_val is not None and y_val is not None:
                    valid_ids.add(aid)
                else:
                    excluded_ids.add(aid)

                sample_id = analysis.get("sample_id", "") if analysis else ""
                if analysis and analysis.get("material_type") == "unknown":
                    identity_unknown += 1
                if sample_id:
                    distinct_samples.add(sample_id)

                points.append(ScenePoint(
                    point_id=f"pt_{aid}",
                    analysis_id=aid,
                    x=x_val,
                    y=y_val,
                    quality_flags=flags,
                    provenance={
                        "measurements": {k: v["value"] for k, v in meas_map.items()},
                        "anhydrous": anhydrous,
                        "sio2_raw": sio2_m["value"] if sio2_m else None,
                        "na2o_raw": na2o_m["value"] if na2o_m else None,
                        "k2o_raw": k2o_m["value"] if k2o_m else None,
                    },
                ))
                layer_analysis_ids.append(aid)
                layer_sample_ids.append(sample_id)

        else:
            for aid in analysis_ids:
                measurements = repo.get_measurements(aid)
                meas_map = _get_measurement_map(measurements)
                analysis = repo.get_analysis(aid)
                sample_id = analysis.get("sample_id", "") if analysis else ""
                points.append(ScenePoint(
                    point_id=f"pt_{aid}",
                    analysis_id=aid,
                    provenance={"measurements": {k: v["value"] for k, v in meas_map.items()}},
                ))
                layer_analysis_ids.append(aid)
                layer_sample_ids.append(sample_id)
                valid_ids.add(aid)
                if sample_id:
                    distinct_samples.add(sample_id)

        # Create series (skip if REE/spider already created per-analysis series)
        if not series_created_inline:
            style_dict = layer.style.model_dump()
            all_series.append(SceneSeries(
                series_id=f"ser_{layer.layer_id}",
                layer_id=layer.layer_id,
                analysis_ids=layer_analysis_ids,
                sample_ids=layer_sample_ids,
                label=layer.label,
                style=style_dict,
                points=points,
                break_at_missing=True,
            ))

    # 分析级覆盖样式解析进点（18 §3：每 point 带 resolved_style；R8 顺序：图层基线 → analysis 覆盖）
    for layer in spec.layers:
        overrides = layer.analysis_style_overrides or {}
        if not overrides:
            continue
        base = layer.style.model_dump()
        for series in all_series:
            if series.layer_id != layer.layer_id:
                continue
            for point in series.points:
                override = overrides.get(point.analysis_id)
                if override is None:
                    continue
                merged = dict(base)
                merged.update({k: v for k, v in override.model_dump().items() if v is not None})
                point.resolved_style = merged

    resolved_selections = []
    for layer in spec.layers:
        sel_data = repo.get_selection(layer.selection_id)
        if sel_data:
            import json
            resolved_selections.append(ResolvedSelection(
                selection_id=layer.selection_id,
                selection_hash=sel_data["selection_hash"],
                analysis_ids=json.loads(sel_data["resolved_ids"]),
                dataset_versions=json.loads(sel_data["dataset_versions"]),
            ))

    # QR02：实际用到的节点级参考全部进快照（含独立 hash）
    import hashlib
    import json
    for (rid, rver), rd in ref_usage.items():
        if any(s.ref_id == rid and s.version == rver for s in ref_snapshots):
            continue
        ref_canonical = json.dumps(rd["values"], sort_keys=True)
        ref_snapshots.append(ReferenceSnapshot(
            ref_id=rid,
            version=rver,
            hash=hashlib.sha256(ref_canonical.encode()).hexdigest()[:16],
            values=rd["values"],
            units=rd["units"],
            citation="built-in reference",
            verification_status="verified",
        ))

    x_axis = _compute_axis_scene(spec.axes.x, all_series, "x", spec.variables.x)
    y_axis = _compute_axis_scene(spec.axes.y, all_series, "y", spec.variables.y)

    # 元素序列/分类图的默认轴标题：回退到元素与参考组成，
    # 不再沿用散点变量表达式或占位 X/Y（否则切图后标题仍是 MgO/SiO2）。
    # Scene 内用英文：matplotlib 固定画布只有拉丁字形；界面中文由前端做显示映射。
    if spec.chart_type in (ChartType.REE, ChartType.SPIDER):
        if spec.axes.x.title_override is None:
            x_axis = x_axis.model_copy(update={"label": "Element"})
        if spec.axes.y.title_override is None:
            if spec.variables.value_mode == "normalized":
                if spec.chart_type == ChartType.REE:
                    y_label = "Sample / Chondrite"
                else:
                    y_label = "Sample / Primitive Mantle"
            else:
                y_label = "Concentration (ppm)"
            y_axis = y_axis.model_copy(update={"label": y_label})
    elif spec.chart_type == ChartType.TAS:
        if spec.axes.x.title_override is None:
            x_axis = x_axis.model_copy(update={"label": "SiO₂ (wt%)"})
        if spec.axes.y.title_override is None:
            y_axis = y_axis.model_copy(update={"label": "Na₂O + K₂O (wt%)"})

    out_of_view = 0
    hidden_by_style = 0

    counts = SceneCounts(
        selected_analyses=len(all_analysis_ids),
        valid_analyses=len(valid_ids),
        excluded_analyses=len(excluded_ids),
        distinct_samples=len(distinct_samples),
        physical_identity_unknown=identity_unknown,
        plotted_points=sum(len(s.points) for s in all_series),
        out_of_view=out_of_view,
        hidden_by_style=hidden_by_style,
    )

    font_manifest = FontManifest(
        primary=spec.layout.font_family,
        fallback=["Arial", "Helvetica", "sans-serif"],
        available=True,
    )

    # TAS：冻结几何入 Scene（渲染端只消费 Scene，不回读磁盘 manifest）
    diagram_geometry = None
    layout = spec.layout
    if spec.chart_type == ChartType.TAS:
        from .diagrams import build_tas_geometry
        diagram_geometry = build_tas_geometry()
        # 图注：LeMaitre 变体、来源与月球参考用途（随 Scene 冻结，两端一致；
        # 英文保证 matplotlib 固定画布导出无缺字形）
        caption = (
            f"TAS fields: Le Maitre et al. (2002) via {diagram_geometry.model_version} "
            f"(config_lemaitre.json {diagram_geometry.source_hash}). "
            "Lunar samples (CE5/CE6/Apollo) plotted for reference comparison only; "
            "not for rock naming."
        )
        from ..domain.style import Annotation
        layout = layout.model_copy(deep=True)
        layout.annotations = list(layout.annotations) + [Annotation(
            id="tas_model_caption",
            text=caption,
            # 锚点=文本左上角（两端一致向下方延伸）；置于底部留白区，避开刻度与轴标题
            anchor_x=0.01,
            anchor_y=0.05,
            font_size_pt=4.5,
            color="#666666",
        )]
        # 自动范围：分类图默认展示整个模型窗口（用户手动范围优先，不被覆盖）
        from .diagrams import load_tas_manifest
        axes_window = load_tas_manifest()["axes"]
        if spec.axes.x.range_mode != "manual":
            x_axis = x_axis.model_copy(update={"range": list(axes_window["x"]["range"])})
        if spec.axes.y.range_mode != "manual":
            y_axis = y_axis.model_copy(update={"range": list(axes_window["y"]["range"])})

    scene = PlotScene(
        scene_id=scene_id,
        request_id=request_id,
        spec_hash=spec_hash,
        scene_hash="",
        plot_revision=spec.revision,
        chart_type=spec.chart_type,
        variables=spec.variables,
        resolved_selections=resolved_selections,
        reference_snapshots=ref_snapshots,
        axes={"x": x_axis, "y": y_axis},
        series=all_series,
        diagram_geometry=diagram_geometry,
        layout=layout,
        font_manifest=font_manifest,
        warnings=warnings,
        counts=counts,
        exclusions=exclusions,
        software_version=SOFTWARE_VERSION,
    )
    scene.scene_hash = scene.compute_scene_hash()

    return scene


def _expression_label(expr: Optional[Expression]) -> str:
    """Derive an axis label from a variable expression when no title_override is set.

    measurement → "MgO (wt%)"；ratio(meas,meas) → "Rb/Sr"；
    ratio(norm,norm) → "(La/Yb)N"；normalize(meas) → "LaN"；其余回退空串。
    """
    if expr is None:
        return ""
    if isinstance(expr, MeasurementExpr):
        return f"{expr.analyte} ({expr.unit})" if expr.unit else expr.analyte
    if isinstance(expr, ConstantExpr):
        return str(expr.value)
    if isinstance(expr, NormalizeExpr):
        inner = expr.value
        name = inner.analyte if isinstance(inner, MeasurementExpr) else _expression_label(inner)
        return f"{name}N" if name else ""
    if isinstance(expr, RatioExpr):
        num, den = expr.numerator, expr.denominator
        if isinstance(num, NormalizeExpr) and isinstance(den, NormalizeExpr):
            a = num.value.analyte if isinstance(num.value, MeasurementExpr) else _expression_label(num.value)
            b = den.value.analyte if isinstance(den.value, MeasurementExpr) else _expression_label(den.value)
            return f"({a}/{b})N" if a and b else ""
        a = num.analyte if isinstance(num, MeasurementExpr) else _expression_label(num)
        b = den.analyte if isinstance(den, MeasurementExpr) else _expression_label(den)
        return f"{a}/{b}" if a and b else ""
    return ""


def _compute_axis_scene(axis_fmt, series: list[SceneSeries], axis: str,
                        expr: Optional[Expression] = None) -> AxisScene:
    """Compute axis scene from format spec and series data."""
    all_values: list[float] = []
    for s in series:
        for pt in s.points:
            val = pt.x if axis == "x" else pt.y
            if val is not None and math.isfinite(val):
                all_values.append(val)

    if axis_fmt.range_mode == "manual" and axis_fmt.min is not None and axis_fmt.max is not None:
        range_val = [axis_fmt.min, axis_fmt.max]
    elif all_values:
        vmin = min(all_values)
        vmax = max(all_values)
        if vmin == vmax:
            vmin -= 1
            vmax += 1

        # Fix B06: For log scale, compute padding in log space
        if axis_fmt.scale == "log10":
            if vmin <= 0:
                # Invalid for log scale - use positive minimum
                vmin = min(v for v in all_values if v > 0) if any(v > 0 for v in all_values) else 0.01
            log_min = math.log10(vmin)
            log_max = math.log10(vmax)
            log_padding = (log_max - log_min) * 0.05
            range_val = [10 ** (log_min - log_padding), 10 ** (log_max + log_padding)]
        else:
            padding = (vmax - vmin) * 0.05
            range_val = [vmin - padding, vmax + padding]
    else:
        range_val = [0.0, 1.0]

    ticks = _compute_ticks(axis_fmt, range_val)

    return AxisScene(
        label=axis_fmt.title_override or _expression_label(expr) or axis.upper(),
        unit=None,
        scale=axis_fmt.scale,
        range=range_val,
        ticks=ticks,
        # R16：手动轴设置冻结进 Scene（反转/格式/字号/网格/类别可见范围）
        reversed=axis_fmt.reversed,
        number_format=axis_fmt.number_format,
        decimal_places=axis_fmt.decimal_places,
        significant_digits=axis_fmt.significant_digits,
        tick_mode=axis_fmt.tick_mode,
        tick_step=axis_fmt.tick_step,
        log_exponent_step=axis_fmt.log_exponent_step,
        title_font_size_pt=axis_fmt.title_font_size_pt,
        tick_font_size_pt=axis_fmt.tick_font_size_pt,
        major_grid=axis_fmt.major_grid,
        minor_ticks=axis_fmt.minor_ticks,
        tick_direction=axis_fmt.tick_direction,
        category_order=axis_fmt.category_order,
        visible_categories=axis_fmt.visible_categories,
    )


def _compute_ticks(axis_fmt, range_val: list[float]) -> list[float]:
    """Compute tick positions."""
    if axis_fmt.tick_mode == "step" and axis_fmt.tick_step:
        step = axis_fmt.tick_step
        start = math.ceil(range_val[0] / step) * step
        ticks = []
        v = start
        while v <= range_val[1]:
            ticks.append(round(v, 10))
            v += step
        return ticks

    vmin, vmax = range_val
    span = vmax - vmin
    if span <= 0:
        return [vmin]

    target_ticks = 5
    raw_step = span / target_ticks
    magnitude = 10 ** math.floor(math.log10(raw_step))
    normalized = raw_step / magnitude

    if normalized <= 1.5:
        step = magnitude
    elif normalized <= 3.5:
        step = 2 * magnitude
    elif normalized <= 7.5:
        step = 5 * magnitude
    else:
        step = 10 * magnitude

    start = math.ceil(vmin / step) * step
    ticks = []
    v = start
    while v <= vmax + step * 0.001:
        ticks.append(round(v, 10))
        v += step
    return ticks
