"""Figure, Export, and Runtime record models - schema 1.1"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Optional

from pydantic import BaseModel, Field

from .enums import (
    ChartType,
    ExportBackground,
    ExportFormat,
    ExportState,
    JobStatus,
    RuntimeState,
)
from .plot_spec import PlotSpec


class Figure(BaseModel):
    """A figure in the workspace - mutable metadata with immutable revisions."""
    figure_id: str
    project_id: str
    name: str
    chart_type: ChartType
    thumbnail_artifact_id: Optional[str] = None
    current_revision: Optional[int] = None
    current_revision_id: Optional[str] = None
    metadata_revision: int = 1
    archived: bool = False
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class FigureDraft(BaseModel):
    """Mutable editing draft - 3-second debounce save."""
    figure_id: str
    draft_revision: int = 1
    expected_revision: Optional[int] = None
    spec: PlotSpec
    selection_snapshots: dict[str, Any] = Field(default_factory=dict)
    saved_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class FigureRevision(BaseModel):
    """Immutable saved version of a figure."""
    figure_id: str
    revision_id: str
    revision_number: int
    spec: PlotSpec
    scene_id: str
    source_versions: dict[str, str] = Field(default_factory=dict)
    reference_snapshots: list[dict[str, Any]] = Field(default_factory=list)
    resolved_analysis_ids: list[str] = Field(default_factory=list)
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    content_hash: str = ""


class OperationRecord(BaseModel):
    """Audit log for figure operations."""
    operation_id: str
    figure_id: str
    draft_or_revision: str
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    action: str
    changed_fields: list[str] = Field(default_factory=list)
    before_summary: Optional[dict[str, Any]] = None
    after_summary: Optional[dict[str, Any]] = None
    request_id: Optional[str] = None


class ExportFile(BaseModel):
    """A single exported file."""
    artifact_id: str
    filename: str
    format: ExportFormat
    byte_size: int
    sha256: str
    absolute_path: str
    exists: bool = True


class ExportRecord(BaseModel):
    """Export job record with state machine."""
    export_id: str
    figure_id: str
    revision_id: str
    scene_id: str
    scene_hash: str
    export_seq: int
    formats: list[ExportFormat]
    size_mm: dict[str, float]
    dpi: int
    background: ExportBackground
    export_root_id: str
    relative_dir: str
    state: ExportState = ExportState.QUEUED
    files: list[ExportFile] = Field(default_factory=list)
    error: Optional[dict[str, Any]] = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class ExportRoot(BaseModel):
    """User-selected export root directory."""
    export_root_id: str
    absolute_path: str
    display_name: str
    selected_by_user_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    writable_check: bool = True


class Job(BaseModel):
    """Background job status."""
    job_id: str
    status: JobStatus
    phase: Optional[str] = None
    processed: int = 0
    total: int = 0
    result: Optional[dict[str, Any]] = None
    error: Optional[dict[str, Any]] = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class RuntimeStatus(BaseModel):
    """Application runtime status."""
    app_id: str
    app_version: str
    profile_id: str
    instance_id: str
    pid: int
    process_started_at: datetime
    state: RuntimeState
    base_url: str
    active_jobs: list[str] = Field(default_factory=list)


class HealthResponse(BaseModel):
    status: str = "ok"
    app_version: str
    schema_version: str = "1.1"
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class ErrorResponse(BaseModel):
    code: str
    message: str
    field_errors: list[dict[str, str]] = Field(default_factory=list)
    details: Optional[dict[str, Any]] = None
    request_id: Optional[str] = None
