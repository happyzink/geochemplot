"""PlotSpec and PlotScene - schema 1.1"""
from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from typing import Any, Literal, Optional

from pydantic import BaseModel, Field, field_validator, model_validator

from .enums import ChartType
from .expression import Expression
from .style import (
    AxesConfig,
    AxisFormat,
    LayerSpec,
    LayoutConfig,
    QualityPolicy,
    TASDiagram,
    VariablesConfig,
)


class PlotSpec(BaseModel):
    """Plot specification - schema 1.1.

    This is the mutable configuration that describes what to plot.
    """
    schema_version: Literal["1.1"] = "1.1"
    plot_id: str = Field(..., min_length=1)
    revision: int = Field(1, ge=1)
    chart_type: ChartType
    layers: list[LayerSpec] = Field(..., min_length=1)
    variables: VariablesConfig
    quality_policy: QualityPolicy = Field(default_factory=QualityPolicy)
    axes: AxesConfig = Field(default_factory=AxesConfig)
    layout: LayoutConfig = Field(default_factory=LayoutConfig)
    diagram: Optional[TASDiagram] = None
    channel_policy_id: Optional[str] = None

    @field_validator("layers")
    @classmethod
    def unique_layer_ids(cls, v: list[LayerSpec]) -> list[LayerSpec]:
        ids = [layer.layer_id for layer in v]
        if len(ids) != len(set(ids)):
            raise ValueError("Duplicate layer_id found in layers")
        return v

    @model_validator(mode="after")
    def validate_chart_type_requirements(self):
        if self.chart_type == ChartType.SCATTER:
            if self.variables.x is None or self.variables.y is None:
                raise ValueError("scatter chart_type requires both x and y expressions")
        elif self.chart_type in (ChartType.REE, ChartType.SPIDER):
            if not self.variables.elements:
                raise ValueError(f"{self.chart_type.value} requires elements list")
            if self.variables.value_mode == "normalized":
                if not self.variables.reference_id or not self.variables.reference_version:
                    raise ValueError(
                        "normalized value_mode requires reference_id and reference_version"
                    )
        elif self.chart_type == ChartType.TAS:
            if self.diagram is None:
                raise ValueError("tas chart_type requires diagram configuration")
        return self

    def compute_spec_hash(self) -> str:
        canonical = self.model_dump_json(exclude={"revision", "plot_id"})
        return hashlib.sha256(canonical.encode()).hexdigest()


class ResolvedSelection(BaseModel):
    selection_id: str
    selection_hash: str
    analysis_ids: list[str]
    dataset_versions: list[dict[str, str]]


class ReferenceSnapshot(BaseModel):
    ref_id: str
    version: str
    hash: str
    values: dict[str, float]
    units: dict[str, str]
    citation: str
    verification_status: str


class AxisScene(BaseModel):
    label: str
    unit: Optional[str] = None
    scale: str
    range: list[float] = Field(..., min_length=2, max_length=2)
    ticks: list[float]
    # 18 §3：轴设置全部冻结进 Scene（格式/字号/网格/反转/类别可见范围），renderer 不回读 Spec
    reversed: Optional[bool] = None
    number_format: Optional[str] = None
    decimal_places: Optional[int] = None
    significant_digits: Optional[int] = None
    tick_mode: Optional[str] = None
    tick_step: Optional[float] = None
    log_exponent_step: Optional[int] = None
    title_font_size_pt: Optional[float] = None
    tick_font_size_pt: Optional[float] = None
    major_grid: Optional[bool] = None
    minor_ticks: Optional[bool] = None
    tick_direction: Optional[str] = None
    category_order: Optional[list[str]] = None
    visible_categories: Optional[list[str]] = None


class ScenePoint(BaseModel):
    point_id: str
    analysis_id: str
    x: Optional[float] = None
    y: Optional[float] = None
    x_error: Optional[float] = None
    y_error: Optional[float] = None
    quality_flags: list[str] = Field(default_factory=list)
    provenance: dict[str, Any] = Field(default_factory=dict)
    resolved_style: Optional[dict[str, Any]] = None


class SceneSeries(BaseModel):
    series_id: str
    layer_id: str
    analysis_ids: list[str]
    sample_ids: list[str]
    label: str
    style: dict[str, Any]
    points: list[ScenePoint]
    break_at_missing: bool = True


class TASPolygon(BaseModel):
    """Single TAS field polygon."""
    field_id: str
    label: str
    vertices: list[list[float]]


class TASLabel(BaseModel):
    """Label position for TAS field."""
    field_id: str
    x: float
    y: float
    text: str


class DiagramGeometry(BaseModel):
    """Diagram geometry for specialized chart types (TAS, etc.)."""
    model_id: str
    model_version: str
    source_hash: Optional[str] = None
    polygons: list[TASPolygon] = Field(default_factory=list)
    labels: list[TASLabel] = Field(default_factory=list)
    segments: list[list[list[float]]] = Field(default_factory=list)
    # Legacy fields for backward compatibility
    boundary_coordinates: list[list[float]] = Field(default_factory=list)
    region_labels: dict[str, list[list[float]]] = Field(default_factory=dict)


class SceneCounts(BaseModel):
    selected_analyses: int
    valid_analyses: int
    excluded_analyses: int
    distinct_samples: int
    physical_identity_unknown: int
    plotted_points: int
    out_of_view: int
    hidden_by_style: int


class Exclusion(BaseModel):
    analysis_id: str
    analyte: Optional[str] = None
    reason_code: str
    source_cells: list[str] = Field(default_factory=list)


class FontManifest(BaseModel):
    primary: str
    fallback: list[str]
    available: bool
    substituted_with: Optional[str] = None


class PlotScene(BaseModel):
    """Frozen computation result - all rendering adapters consume this.

    Scene hash ignores request_id and creation time; same config+data yields same hash.
    """
    scene_id: str
    schema_version: Literal["1.1", "1.2"] = "1.2"
    request_id: str
    spec_hash: str
    scene_hash: str
    plot_revision: int
    chart_type: ChartType

    resolved_selections: list[ResolvedSelection]
    reference_snapshots: list[ReferenceSnapshot]

    variables: VariablesConfig
    axes: dict[str, AxisScene]
    series: list[SceneSeries]

    diagram_geometry: Optional[DiagramGeometry] = None
    legend: dict[str, Any] = Field(default_factory=dict)
    layout: LayoutConfig
    font_manifest: FontManifest

    warnings: list[str] = Field(default_factory=list)
    counts: SceneCounts
    exclusions: list[Exclusion] = Field(default_factory=list)

    software_version: str

    def compute_scene_hash(self) -> str:
        # 18 §3：hash 覆盖影响科学结果与输出的全部字段（含 chart_type/variables/geometry/layout），
        # 排除 request_id/scene_id/生成时间等随机元数据。
        data = {
            "chart_type": str(self.chart_type),
            "variables": self.variables.model_dump() if hasattr(self.variables, "model_dump") else self.variables,
            "diagram_geometry": self.diagram_geometry.model_dump() if self.diagram_geometry else None,
            "resolved_selections": [s.model_dump() for s in self.resolved_selections],
            "reference_snapshots": [r.model_dump() for r in self.reference_snapshots],
            "axes": {k: v.model_dump() for k, v in self.axes.items()},
            "series": [s.model_dump() for s in self.series],
            "layout": self.layout.model_dump() if self.layout else None,
            "legend": self.legend.model_dump() if hasattr(self.legend, "model_dump") else self.legend,
            "font_manifest": self.font_manifest.model_dump() if hasattr(self.font_manifest, "model_dump") else self.font_manifest,
            "counts": self.counts.model_dump(),
            "exclusions": [e.model_dump() for e in self.exclusions],
        }
        canonical = json.dumps(data, sort_keys=True, default=str)
        return hashlib.sha256(canonical.encode()).hexdigest()


PlotSpec.model_rebuild()
PlotScene.model_rebuild()
