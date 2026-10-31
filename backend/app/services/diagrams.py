"""Diagram services: spider validation and TAS geometry.

Spider reuses REE scene pipeline.
TAS geometry is extracted from locked pyrolite 0.3.8.post1 (LeMaitre model),
provenance in resources/diagrams/tas_manifest.json；渲染端只消费 Scene.diagram_geometry。
"""
from __future__ import annotations

import hashlib
import json
import math
import random
from dataclasses import dataclass, field as dc_field
from pathlib import Path
from typing import Optional

from ..domain.plot_spec import DiagramGeometry, PlotScene, PlotSpec
from ..domain.enums import ChartType


RESOURCES_DIR = Path(__file__).parent.parent / "resources"


@dataclass
class SpiderValidation:
    """Result of spider diagram validation."""
    valid: bool
    missing_elements: list[str]
    coverage: float
    warnings: list[str]


@dataclass
class TASClassification:
    """Result of TAS classification.

    status: inside | on_boundary | out_of_domain
    边界点给全部相邻候选 field，不偏移数据点换取唯一岩名。
    """
    field_name: str
    field_label: str
    x_value: float
    y_value: float
    confidence: str
    status: str = "inside"
    candidate_fields: list[str] = dc_field(default_factory=list)
    boundary_tolerance_wt_pct: float = 0.0


def validate_spider_elements(spec: PlotSpec, reference_values: dict[str, float]) -> SpiderValidation:
    """Validate that spider diagram elements are present in reference.

    Returns validation result with missing elements and coverage.
    """
    if spec.chart_type != ChartType.SPIDER:
        return SpiderValidation(True, [], 1.0, [])

    elements = spec.variables.elements or []
    missing = [e for e in elements if e not in reference_values]
    coverage = (len(elements) - len(missing)) / len(elements) if elements else 0.0

    warnings = []
    if missing:
        warnings.append(f"NORMALIZER_INCOMPLETE: missing {', '.join(missing)}")

    return SpiderValidation(
        valid=len(missing) == 0,
        missing_elements=missing,
        coverage=coverage,
        warnings=warnings,
    )


def load_tas_manifest() -> dict:
    """Load TAS diagram manifest from resources and compute source hash."""
    manifest_path = RESOURCES_DIR / "diagrams" / "tas_manifest.json"
    with open(manifest_path, "r", encoding="utf-8") as f:
        manifest = json.load(f)

    # Compute actual SHA-256 hash of the manifest file
    with open(manifest_path, "rb") as f:
        file_hash = hashlib.sha256(f.read()).hexdigest()

    manifest["computed_source_hash"] = f"sha256:{file_hash}"
    return manifest


def _point_to_segment_distance(px: float, py: float,
                               x1: float, y1: float, x2: float, y2: float) -> float:
    """点到线段的垂直距离（轴数据单位）。"""
    dx, dy = x2 - x1, y2 - y1
    if dx == 0 and dy == 0:
        return math.hypot(px - x1, py - y1)
    t = ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)
    t = max(0.0, min(1.0, t))
    return math.hypot(px - (x1 + t * dx), py - (y1 + t * dy))


def _point_to_polygon_distance(px: float, py: float, polygon: list[list[float]]) -> float:
    """点到多边形边界（各线段）的最小距离。"""
    best = math.inf
    n = len(polygon)
    for i in range(n):
        x1, y1 = polygon[i]
        x2, y2 = polygon[(i + 1) % n]
        best = min(best, _point_to_segment_distance(px, py, x1, y1, x2, y2))
    return best


def classify_tas_point(sio2: float, na2o: float, k2o: float) -> Optional[TASClassification]:
    """Classify a point on the TAS diagram（R11/R12 语义）。

    - inside：严格位于唯一 field 内（ray-casting，与 pyrolite predict 同类判定）；
    - on_boundary：到任一线段距离 <= boundary_tolerance_wt_pct（轴数据单位 wt%），
      返回全部相邻 field 候选（candidate_fields），不偏移点换取唯一岩名；
    - out_of_domain：返回 None（保持既有 API 语义）。
    """
    manifest = load_tas_manifest()
    total_alkali = na2o + k2o
    tolerance = float(manifest.get("boundary_tolerance_wt_pct", 1e-6))

    inside_fields: list[str] = []
    boundary_fields: list[str] = []
    for field_id, field_data in manifest["fields"].items():
        boundary = field_data["boundary"]
        if not boundary or len(boundary) < 3:
            continue  # 空 poly 占位项不参与分类/绘图
        # 边界判定优先：ray-casting 对边上点不稳定，距离判定确定性强
        if _point_to_polygon_distance(sio2, total_alkali, boundary) <= tolerance:
            boundary_fields.append(field_id)
        elif _point_in_polygon(sio2, total_alkali, boundary):
            inside_fields.append(field_id)

    if boundary_fields:
        candidates = sorted(boundary_fields)
        fid = candidates[0]
        label = " | ".join(f"{c}: {manifest['fields'][c]['label']}" for c in candidates)
        return TASClassification(
            field_name=fid,
            field_label=label,
            x_value=sio2,
            y_value=total_alkali,
            confidence="boundary",
            status="on_boundary",
            candidate_fields=candidates,
            boundary_tolerance_wt_pct=tolerance,
        )

    if inside_fields:
        # 正常情况下 field 内部互不重叠；若数值上重叠（浮点跨界）按边界候选处理
        if len(inside_fields) == 1:
            fid = inside_fields[0]
            return TASClassification(
                field_name=fid,
                field_label=manifest["fields"][fid]["label"],
                x_value=sio2,
                y_value=total_alkali,
                confidence="high",
                status="inside",
                candidate_fields=inside_fields,
                boundary_tolerance_wt_pct=tolerance,
            )
        candidates = sorted(inside_fields)
        return TASClassification(
            field_name=candidates[0],
            field_label=" | ".join(f"{c}: {manifest['fields'][c]['label']}" for c in candidates),
            x_value=sio2,
            y_value=total_alkali,
            confidence="boundary",
            status="on_boundary",
            candidate_fields=candidates,
            boundary_tolerance_wt_pct=tolerance,
        )

    return None


def _point_in_polygon(x: float, y: float, polygon: list[list[float]]) -> bool:
    """Ray-casting algorithm for point-in-polygon test."""
    n = len(polygon)
    inside = False

    j = n - 1
    for i in range(n):
        xi, yi = polygon[i]
        xj, yj = polygon[j]

        if ((yi > y) != (yj > y)) and (x < (xj - xi) * (y - yi) / (yj - yi) + xi):
            inside = not inside
        j = i

    return inside


def build_tas_geometry() -> DiagramGeometry:
    """Build TAS diagram geometry from manifest（QR04 结构约束）.

    - 逐 field 独立闭合多边形（保留原始 field_id 与顶点顺序）；空 poly 占位项不绘图；
    - 共享边转规范化无向线段去重（禁止把所有 polygon 顶点连成一条线）；
    - legacy boundary_coordinates/region_labels 置空弃用，防止消费端误连成折线。
    """
    from ..domain.plot_spec import TASPolygon, TASLabel

    manifest = load_tas_manifest()

    polygons = []
    labels = []
    all_segments = []

    for field_id, field_data in manifest["fields"].items():
        boundary = field_data["boundary"]
        label_text = field_data["label"]

        # 空 poly 占位项不绘图（nan/none）
        if not boundary or len(boundary) < 3:
            continue

        # 每个多边形独立闭合（顶点顺序即官方顺序，不重排）
        polygons.append(TASPolygon(
            field_id=field_id,
            label=label_text,
            vertices=[list(v) for v in boundary],
        ))

        # 标签置于质心（显示用火山名）
        cx = sum(p[0] for p in boundary) / len(boundary)
        cy = sum(p[1] for p in boundary) / len(boundary)
        names = field_data.get("names") or label_text.split(" / ")
        labels.append(TASLabel(
            field_id=field_id,
            x=cx,
            y=cy,
            text=str(names[0]).replace("\n", " "),
        ))

        # 共享边 → 规范化无向线段（排序端点元组）全局去重
        for i in range(len(boundary)):
            p1 = tuple(boundary[i])
            p2 = tuple(boundary[(i + 1) % len(boundary)])
            segment = tuple(sorted([p1, p2]))
            all_segments.append(segment)

    unique_segments = sorted(set(all_segments))
    segment_list = [[list(p1), list(p2)] for (p1, p2) in unique_segments]

    return DiagramGeometry(
        model_id=manifest["model_id"],
        model_version=manifest["model_version"],
        source_hash=manifest.get("computed_source_hash"),
        polygons=polygons,
        labels=labels,
        segments=segment_list,
        # deprecated：扁平顶点链会被误连成一条折线，自本版本起不再填充
        boundary_coordinates=[],
        region_labels={},
    )


def validate_tas_oxides(spec: PlotSpec, measurements: dict[str, float]) -> tuple[bool, list[str]]:
    """Validate that TAS diagram has required oxide measurements.

    TAS requires SiO2, Na2O, K2O in wt%.
    Returns (valid, missing_list).
    """
    if spec.chart_type != ChartType.TAS:
        return True, []

    required = ["SiO2", "Na2O", "K2O"]
    missing = [r for r in required if r not in measurements]

    return len(missing) == 0, missing


def check_reference_completeness(elements: list[str], reference: dict[str, float]) -> list[str]:
    """Check which elements are missing from reference composition.

    Returns list of missing element names.
    """
    return [e for e in elements if e not in reference]


def _mpl_contains_point(sio2: float, alkali: float, polygon: list[list[float]]) -> bool:
    """pyrolite predict 同实现判定（matplotlib.patches.Polygon.contains_points）。"""
    from matplotlib.patches import Polygon as MplPolygon
    poly = MplPolygon([list(v) for v in polygon], closed=True)
    return bool(poly.contains_points([[sio2, alkali]])[0])


def verify_tas_classification(random_points: int = 200, seed: int = 20261029) -> dict:
    """Verify TAS classification and geometry (R11/R12).

    - 三个合成点核对 Bs/O3/O3；
    - 随机内点与官方模型判定交叉比对（ray-casting vs matplotlib contains_points，
      后者与 pyrolite predict 同实现）；
    - 共享边界点 on_boundary 候选齐全、外点 out_of_domain；
    - 几何不变量：多边形独立闭合、共享边去重、两次构建稳定。
    """
    test_points = [
        {"sio2": 50, "na2o": 2, "k2o": 2, "expected_field": "Bs", "expected_label": "Subalkalic Basalt"},
        {"sio2": 65, "na2o": 3, "k2o": 2, "expected_field": "O3", "expected_label": "Dacite"},
        {"sio2": 72, "na2o": 2, "k2o": 1.5, "expected_field": "O3", "expected_label": "Dacite"},
    ]

    results = []
    all_passed = True

    for test in test_points:
        classification = classify_tas_point(test["sio2"], test["na2o"], test["k2o"])

        if classification is None:
            results.append({
                "test": test,
                "passed": False,
                "reason": "Point not classified (outside all fields)",
            })
            all_passed = False
        elif classification.field_name != test["expected_field"]:
            results.append({
                "test": test,
                "passed": False,
                "reason": f"Expected {test['expected_field']}, got {classification.field_name}",
                "actual": {
                    "field_name": classification.field_name,
                    "field_label": classification.field_label,
                },
            })
            all_passed = False
        else:
            results.append({
                "test": test,
                "passed": True,
                "actual": {
                    "field_name": classification.field_name,
                    "field_label": classification.field_label,
                    "status": classification.status,
                },
            })

    # ---- 随机内点交叉比对（两种独立实现）----
    manifest = load_tas_manifest()
    real_fields = {k: v["boundary"] for k, v in manifest["fields"].items()
                   if v.get("boundary") and len(v["boundary"]) >= 3}
    rng = random.Random(seed)
    cross_total = 0
    cross_mismatch = 0
    mismatch_samples = []
    for _ in range(random_points):
        x = rng.uniform(35.0, 88.0)
        y = rng.uniform(0.0, 18.0)
        mine = classify_tas_point(x, y / 2, y / 2)  # na2o+k2o == y
        ref_field = None
        for fid, poly in real_fields.items():
            if _mpl_contains_point(x, y, poly):
                ref_field = fid
                break
        if mine is not None and mine.status == "on_boundary":
            # 边界点：官方实现（contains_points）对边上点行为不一，候选一致即通过
            agree = ref_field is None or ref_field in mine.candidate_fields
        else:
            my_field = mine.field_name if (mine and mine.status == "inside") else None
            agree = my_field == ref_field
        if mine is not None or ref_field is not None:
            cross_total += 1
            if not agree:
                cross_mismatch += 1
                if len(mismatch_samples) < 5:
                    mismatch_samples.append({
                        "x": x, "y": y,
                        "mine": mine.field_name if mine else None,
                        "mine_status": mine.status if mine else "out_of_domain",
                        "official": ref_field,
                    })
    cross_check_passed = cross_mismatch == 0

    # ---- 边界点：(52,5) 为 Ba/Bs/O1/S1/S2 共享顶点 ----
    boundary = classify_tas_point(52.0, 2.5, 2.5)
    boundary_ok = (
        boundary is not None
        and boundary.status == "on_boundary"
        and {"Ba", "Bs", "O1", "S1", "S2"}.issubset(set(boundary.candidate_fields))
    )
    # ---- 外点 ----
    outer = classify_tas_point(30.0, 0.1, 0.1)
    outer_ok = outer is None

    # ---- 几何不变量 ----
    geom1 = build_tas_geometry()
    geom2 = build_tas_geometry()
    closure_ok = all(len(p.vertices) >= 3 for p in geom1.polygons)
    ids_ok = {p.field_id for p in geom1.polygons} == set(real_fields.keys())
    # 共享边去重：所有 polygon 边的无向规范化并集 == segments
    edge_set = set()
    for p in geom1.polygons:
        vs = p.vertices
        for i in range(len(vs)):
            edge_set.add(tuple(sorted([tuple(vs[i]), tuple(vs[(i + 1) % len(vs)])])))
    seg_set = {tuple(sorted([tuple(s[0]), tuple(s[1])])) for s in geom1.segments}
    dedup_ok = edge_set == seg_set and len(seg_set) == len(geom1.segments)
    stable_ok = (
        [p.model_dump() for p in geom1.polygons] == [p.model_dump() for p in geom2.polygons]
        and geom1.segments == geom2.segments
        and geom1.source_hash == geom2.source_hash
    )
    # 禁止顶点链：legacy 字段必须为空
    legacy_empty = not geom1.boundary_coordinates and not geom1.region_labels

    geometry_ok = all([closure_ok, ids_ok, dedup_ok, stable_ok, legacy_empty])
    all_passed = all_passed and cross_check_passed and boundary_ok and outer_ok and geometry_ok

    return {
        "all_passed": all_passed,
        "results": results,
        "cross_check": {
            "method": "ray-casting vs matplotlib.path contains_points（pyrolite predict 同实现）",
            "compared_points": cross_total,
            "mismatches": cross_mismatch,
            "mismatch_samples": mismatch_samples,
            "passed": cross_check_passed,
        },
        "boundary_point": {
            "input": {"SiO2": 52.0, "Na2O": 2.5, "K2O": 2.5},
            "status": boundary.status if boundary else "out_of_domain",
            "candidate_fields": boundary.candidate_fields if boundary else [],
            "expected_shared_fields": ["Ba", "Bs", "O1", "S1", "S2"],
            "passed": boundary_ok,
        },
        "outer_point": {
            "input": {"SiO2": 30.0, "Na2O": 0.1, "K2O": 0.1},
            "status": "out_of_domain" if outer is None else outer.status,
            "passed": outer_ok,
        },
        "geometry": {
            "polygon_count": len(geom1.polygons),
            "segment_count": len(geom1.segments),
            "polygons_independently_closed": closure_ok,
            "field_ids_preserved": ids_ok,
            "shared_edges_deduplicated": dedup_ok,
            "two_builds_identical": stable_ok,
            "legacy_flat_vertices_empty": legacy_empty,
            "source_hash": geom1.source_hash,
            "passed": geometry_ok,
        },
        "verification_date": "2026-10-29",
    }
