"""GeoPlot backend domain models - schema 1.1"""
from __future__ import annotations

import hashlib
import json
import uuid
from datetime import datetime
from enum import Enum
from typing import Annotated, Any, Literal, Optional, Union

from pydantic import BaseModel, Field, field_validator, model_validator


def generate_id(prefix: str = "") -> str:
    uid = uuid.uuid4().hex[:12]
    return f"{prefix}{uid}" if prefix else uid


class QualityFlag(str, Enum):
    MISSING = "missing"
    NON_NUMERIC = "non_numeric"
    EXCEL_ERROR = "excel_error"
    BELOW_DETECTION = "below_detection"
    ZERO = "zero"
    NEGATIVE = "negative"
    UNIT_UNCONFIRMED = "unit_unconfirmed"
    CHANNEL_CONFLICT = "channel_conflict"
    NORMALIZATION_UNKNOWN = "normalization_unknown"
    METADATA_CONFLICT = "metadata_conflict"


class ValueState(str, Enum):
    RAW_CONCENTRATION = "raw_concentration"
    NORMALIZED = "normalized"
    DERIVED_RATIO = "derived_ratio"
    SOURCE_INDEX = "source_index"
    UNCERTAINTY = "uncertainty"
    DETECTION_LIMIT = "detection_limit"


class ChemicalForm(str, Enum):
    ELEMENT = "element"
    OXIDE = "oxide"
    ISOTOPE_RATIO = "isotope_ratio"
    INDEX = "index"


class ChartType(str, Enum):
    SCATTER = "scatter"
    REE = "ree"
    SPIDER = "spider"
    TAS = "tas"


class MarkerShape(str, Enum):
    CIRCLE = "circle"
    SQUARE = "square"
    TRIANGLE_UP = "triangle_up"
    TRIANGLE_DOWN = "triangle_down"
    DIAMOND = "diamond"
    PLUS = "plus"
    CROSS = "cross"
    STAR = "star"
    HEXAGON = "hexagon"


class MarkerFill(str, Enum):
    SOLID = "solid"
    OPEN = "open"


class LineDash(str, Enum):
    SOLID = "solid"
    DASH = "dash"
    DOT = "dot"
    DASHDOT = "dashdot"


class AxisScale(str, Enum):
    LINEAR = "linear"
    LOG10 = "log10"
    CATEGORY = "category"


class RangeMode(str, Enum):
    AUTO = "auto"
    MANUAL = "manual"


class TickMode(str, Enum):
    AUTO = "auto"
    STEP = "step"


class NumberFormat(str, Enum):
    AUTO = "auto"
    FIXED = "fixed"
    SCIENTIFIC = "scientific"


class TickDirection(str, Enum):
    IN = "in"
    OUT = "out"


class MaterialType(str, Enum):
    WHOLE_ROCK = "whole_rock"
    MINERAL = "mineral"
    GLASS = "glass"
    SOIL = "soil"
    CLAST = "clast"
    SEPARATE = "separate"
    LEACHATE = "leachate"
    RESIDUE = "residue"
    MATRIX = "matrix"
    GROUNDMASS = "groundmass"
    VEIN = "vein"
    MELT_INCLUSION = "melt_inclusion"
    UNKNOWN = "unknown"


class MineralGroup(str, Enum):
    PYROXENE = "pyroxene"
    PLAGIOCLASE = "plagioclase"
    OLIVINE = "olivine"
    OXIDE = "oxide"
    PHOSPHATE = "phosphate"
    OTHER = "other"
    UNKNOWN = "unknown"


class Mission(str, Enum):
    CE5 = "CE5"
    CE6 = "CE6"
    APOLLO = "Apollo"
    UNKNOWN = "unknown"


class DatasetRole(str, Enum):
    OWN = "own"
    LITERATURE = "literature"
    COMPARISON = "comparison"
    DERIVED_VIEW = "derived_view"


class SelectionMode(str, Enum):
    SNAPSHOT = "snapshot"
    DYNAMIC = "dynamic"


class ExportState(str, Enum):
    QUEUED = "queued"
    RENDERING = "rendering"
    VERIFYING = "verifying"
    COMMITTING = "committing"
    SUCCEEDED = "succeeded"
    FAILED = "failed"
    CANCELLED = "cancelled"
    INTERRUPTED = "interrupted"


class JobStatus(str, Enum):
    QUEUED = "queued"
    RUNNING = "running"
    SUCCEEDED = "succeeded"
    FAILED = "failed"
    CANCELLED = "cancelled"
    INTERRUPTED = "interrupted"


class RuntimeState(str, Enum):
    NOT_STARTED = "not_started"
    STARTING = "starting"
    RUNNING = "running"
    STOPPING = "stopping"
    STOPPED = "stopped"
    FAILED = "failed"


class LegendPosition(str, Enum):
    RIGHT = "right"
    INSIDE = "inside"
    CUSTOM = "custom"


class ExportFormat(str, Enum):
    PNG = "png"
    PDF = "pdf"
    SVG = "svg"


class ExportBackground(str, Enum):
    WHITE = "white"
    TRANSPARENT = "transparent"
