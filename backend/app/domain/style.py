"""Style models - schema 1.1 with independent point/line alpha"""
from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, Field, field_validator, model_validator

from .enums import LineDash, MarkerFill, MarkerShape


class LayerStyle(BaseModel):
    """Complete style for a data layer. Schema 1.1: independent marker_alpha and line_alpha."""
    marker_shape: MarkerShape = MarkerShape.CIRCLE
    marker_fill: MarkerFill = MarkerFill.SOLID
    marker_fill_color: str = Field("#D55E00", pattern=r"^#[0-9A-Fa-f]{6}$")
    marker_edge_color: str = Field("#D55E00", pattern=r"^#[0-9A-Fa-f]{6}$")
    marker_size_pt: float = Field(3.5, ge=1.0, le=20.0, description="Nominal diameter in points")
    marker_edge_width_pt: float = Field(0.35, ge=0.0, le=3.0)
    marker_alpha: float = Field(1.0, ge=0.0, le=1.0, description="0=opaque, 1=transparent")
    line_color: str = Field("#D55E00", pattern=r"^#[0-9A-Fa-f]{6}$")
    line_width_pt: float = Field(0.8, ge=0.1, le=5.0)
    line_dash: LineDash = LineDash.SOLID
    line_alpha: float = Field(1.0, ge=0.0, le=1.0, description="Independent from marker_alpha")
    connect: bool = Field(False, description="True for REE/spider curves")

    @field_validator("marker_fill")
    @classmethod
    def validate_fill_for_shape(cls, v: MarkerFill, info) -> MarkerFill:
        shape = info.data.get("marker_shape")
        if shape in (MarkerShape.PLUS, MarkerShape.CROSS) and v == MarkerFill.SOLID:
            return MarkerFill.OPEN
        return v


class AnalysisStyleOverride(BaseModel):
    """Partial style override for specific analysis points within a layer."""
    marker_shape: Optional[MarkerShape] = None
    marker_fill: Optional[MarkerFill] = None
    marker_fill_color: Optional[str] = Field(None, pattern=r"^#[0-9A-Fa-f]{6}$")
    marker_edge_color: Optional[str] = Field(None, pattern=r"^#[0-9A-Fa-f]{6}$")
    marker_size_pt: Optional[float] = Field(None, ge=1.0, le=20.0)
    marker_edge_width_pt: Optional[float] = Field(None, ge=0.0, le=3.0)
    marker_alpha: Optional[float] = Field(None, ge=0.0, le=1.0)
    line_color: Optional[str] = Field(None, pattern=r"^#[0-9A-Fa-f]{6}$")
    line_width_pt: Optional[float] = Field(None, ge=0.1, le=5.0)
    line_dash: Optional[LineDash] = None
    line_alpha: Optional[float] = Field(None, ge=0.0, le=1.0)
    connect: Optional[bool] = None


class LayerSpec(BaseModel):
    """A data layer in the plot specification."""
    layer_id: str = Field(..., min_length=1)
    label: str = Field(..., min_length=1)
    selection_id: str = Field(..., min_length=1)
    visible: bool = True
    aggregation: Literal["none"] = "none"
    style: LayerStyle = Field(default_factory=LayerStyle)
    analysis_style_overrides: dict[str, AnalysisStyleOverride] = Field(default_factory=dict)


class AxisFormat(BaseModel):
    """Axis format - schema 1.1 replaces flat x_scale/y_scale/x_range/y_range."""
    scale: str = Field("linear", description="linear|log10|category")
    range_mode: str = Field("auto", description="auto|manual")
    min: Optional[float] = None
    max: Optional[float] = None
    reversed: bool = False
    tick_mode: str = Field("auto", description="auto|step")
    tick_step: Optional[float] = Field(None, gt=0)
    log_exponent_step: Optional[int] = Field(None, ge=1, le=6)
    number_format: str = Field("auto", description="auto|fixed|scientific")
    decimal_places: Optional[int] = Field(None, ge=0, le=8)
    significant_digits: Optional[int] = Field(None, ge=1, le=8)
    title_override: Optional[str] = None
    title_font_size_pt: float = Field(7.0, ge=4.0, le=36.0)
    tick_font_size_pt: float = Field(6.0, ge=4.0, le=36.0)
    major_grid: bool = False
    minor_ticks: bool = False
    tick_direction: str = Field("out", description="in|out")
    category_order: Optional[list[str]] = None
    visible_categories: Optional[list[str]] = None

    @model_validator(mode="after")
    def validate_log_axis(self):
        if self.scale == "log10" and self.range_mode == "manual":
            if self.min is not None and self.min <= 0:
                raise ValueError("log10 axis requires min > 0")
            if self.max is not None and self.max <= 0:
                raise ValueError("log10 axis requires max > 0")
            if self.min is not None and self.max is not None and self.min >= self.max:
                raise ValueError("log10 axis requires min < max")
        if self.range_mode == "manual" and self.min is not None and self.max is not None:
            if self.min >= self.max:
                raise ValueError("axis requires min < max")
        return self


class AxesConfig(BaseModel):
    """Container for X and Y axis formats."""
    x: AxisFormat = Field(default_factory=AxisFormat)
    y: AxisFormat = Field(default_factory=AxisFormat)


class LegendConfig(BaseModel):
    position: str = Field("right", description="right|inside|custom")
    anchor_x: Optional[float] = Field(None, ge=0.0, le=1.0)
    anchor_y: Optional[float] = Field(None, ge=0.0, le=1.0)


class Annotation(BaseModel):
    id: str
    text: str
    anchor_x: float = Field(..., ge=0.0, le=1.0)
    anchor_y: float = Field(..., ge=0.0, le=1.0)
    font_size_pt: float = Field(7.0, ge=4.0, le=36.0)
    color: str = Field("#000000", pattern=r"^#[0-9A-Fa-f]{6}$")


class LayoutConfig(BaseModel):
    width_mm: float = Field(183.0, ge=20.0, le=500.0)
    height_mm: float = Field(110.0, ge=20.0, le=500.0)
    preset: str = Field("nature_main_2026", description="nature_main_2026|thesis_cn|custom")
    font_family: str = "Arial"
    font_size_pt: float = Field(7.0, ge=4.0, le=36.0)
    tick_font_size_pt: float = Field(6.0, ge=4.0, le=36.0)
    legend: LegendConfig = Field(default_factory=LegendConfig)
    legend_show_counts: bool = True
    annotations: list[Annotation] = Field(default_factory=list)


class QualityPolicy(BaseModel):
    censored: str = Field("exclude", description="exclude|include")
    nonpositive_log: str = Field("exclude", description="exclude|include")
    missing_spider: str = Field("gap", description="gap|drop")
    unconfirmed_unit: str = Field("exclude", description="exclude|include")


class TASDiagram(BaseModel):
    model_id: str = "tas_LeMaitre"
    model_version: str = "1"
    mode: Literal["reference"] = "reference"
    oxide_basis: str = Field("raw", description="raw|anhydrous_100")
    oxide_set: list[str] = Field(default_factory=list)
    iron_policy: Optional[str] = Field(None, description="FeOT|FeO_Fe2O3")


class VariablesConfig(BaseModel):
    """Variables configuration - differs by chart type."""
    x: Optional["Expression"] = None
    y: Optional["Expression"] = None
    elements: Optional[list[str]] = None
    value_mode: Optional[str] = Field(None, description="raw|normalized")
    reference_id: Optional[str] = None
    reference_version: Optional[str] = None


from .expression import Expression

VariablesConfig.model_rebuild()
LayerSpec.model_rebuild()
