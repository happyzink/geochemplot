"""API routes for import workflow: scan, preview, commit."""
from __future__ import annotations

import json
import tempfile
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, HTTPException, UploadFile, File
from pydantic import BaseModel, Field

from ..importers.excel_scan import scan_workbook, WorkbookPreview
from ..importers.excel_import import import_excel_data
from ..services.dedup import DedupService, ImportMapping
from ..storage.database import Database

router = APIRouter(prefix="/api/v1", tags=["imports"])

_db: Optional[Database] = None
_dedup_svc: Optional[DedupService] = None
_scan_cache: dict[str, tuple[WorkbookPreview, Path]] = {}  # scan_id -> (preview, temp_path)


def init_import_routes(db: Database):
    global _db, _dedup_svc
    _db = db
    _dedup_svc = DedupService(db)


class ScanResponse(BaseModel):
    scan_id: str
    file_sha256: str
    file_size: int
    sheets: list[dict]
    job_id: str = ""


class PreviewResponse(BaseModel):
    scan_id: str
    file_sha256: str
    sheets: list[dict]
    total_rows: int
    total_columns: int


class CommitRequest(BaseModel):
    scan_id: Optional[str] = None  # 与路径参数重复；以路径为准
    dataset_id: Optional[str] = None
    label: str = "Imported dataset"
    role: str = "user_data"
    column_map: dict = Field(default_factory=dict)
    sheet_config: dict = Field(default_factory=dict)


class CommitResponse(BaseModel):
    dataset_version: str
    file_sha256: str
    mapping_hash: str
    is_duplicate: bool
    message: str
    job_id: str = ""
    analysis_count: int = 0


@router.post("/imports/scan", response_model=ScanResponse)
async def scan_import(file: UploadFile = File(...)):
    """Scan an uploaded Excel workbook and return structure preview."""
    if not file.filename or not file.filename.lower().endswith(('.xlsx', '.xlsm')):
        raise HTTPException(400, "Only .xlsx and .xlsm files are supported")

    scan_id = f"scan_{uuid.uuid4().hex[:12]}"

    # Keep temp file for later import
    temp_dir = Path(tempfile.gettempdir()) / "geoplot_imports"
    temp_dir.mkdir(exist_ok=True)
    temp_path = temp_dir / f"{scan_id}.xlsx"
    
    content = await file.read()
    temp_path.write_bytes(content)

    try:
        preview = scan_workbook(temp_path)
        _scan_cache[scan_id] = (preview, temp_path)

        # 任务记录（前端轮询用；扫描同步完成即 succeeded，result.preview_id 供取预览）
        job_id = f"job_{uuid.uuid4().hex[:12]}"
        now = datetime.now(timezone.utc).isoformat()
        with _db.connect() as conn:
            conn.execute(
                """INSERT INTO jobs (job_id, status, phase, processed, total, result_json,
                   error_json, created_at, updated_at)
                   VALUES (?, 'succeeded', 'scan', 1, 1, ?, NULL, ?, ?)""",
                (job_id, json.dumps({"preview_id": scan_id}), now, now),
            )

        return ScanResponse(
            scan_id=scan_id,
            file_sha256=preview.file_sha256,
            file_size=preview.file_size,
            job_id=job_id,
            sheets=[
                {
                    "name": s.name,
                    "max_row": s.max_row,
                    "max_column": s.max_column,
                    "header_row": s.header_row,
                    "physical_data_rows": s.physical_data_rows,
                    "formula_count": s.formula_count,
                    "cached_error_count": s.cached_error_count,
                }
                for s in preview.sheets
            ],
        )
    except Exception as e:
        temp_path.unlink(missing_ok=True)
        raise HTTPException(500, f"Failed to scan workbook: {e}")


@router.get("/imports/{scan_id}/preview", response_model=PreviewResponse)
def get_preview(scan_id: str):
    """Get detailed preview of a scanned workbook."""
    if scan_id not in _scan_cache:
        raise HTTPException(404, f"Scan {scan_id} not found")

    preview, _ = _scan_cache[scan_id]
    total_rows = sum(s.physical_data_rows for s in preview.sheets)
    total_cols = sum(s.max_column for s in preview.sheets)

    return PreviewResponse(
        scan_id=scan_id,
        file_sha256=preview.file_sha256,
        sheets=[
            {
                "name": s.name,
                "columns": [
                    {
                        "index": c.index,
                        "header": c.header_raw,
                        "non_empty_count": c.non_empty_count,
                        "numeric_count": c.numeric_count,
                        "string_count": c.string_count,
                        "error_count": c.error_count,
                        "sample_values": c.sample_values[:5],
                    }
                    for c in s.columns
                ],
                "head_rows": s.head_rows[:5],
                "reference_candidates": s.reference_candidates,
            }
            for s in preview.sheets
        ],
        total_rows=total_rows,
        total_columns=total_cols,
    )


@router.post("/imports/{scan_id}/commit", response_model=CommitResponse)
def commit_import(scan_id: str, req: CommitRequest):
    """Commit a scanned workbook to create a dataset version and import data."""
    if _dedup_svc is None:
        raise HTTPException(500, "Dedup service not initialized")
    if scan_id not in _scan_cache:
        raise HTTPException(404, f"Scan {scan_id} not found")

    preview, temp_path = _scan_cache[scan_id]
    dataset_id = req.dataset_id or f"ds_{uuid.uuid4().hex[:12]}"

    mapping = ImportMapping(
        mapping_version="1.0",
        column_map=req.column_map,
        sheet_config=req.sheet_config,
    )

    # Register import metadata
    result = _dedup_svc.register_import(
        file_sha256=preview.file_sha256,
        filename=preview.file_path,
        byte_size=preview.file_size,
        mapping=mapping,
        dataset_id=dataset_id,
        label=req.label,
        role=req.role,
    )

    # Actually import data if not duplicate
    analysis_count = 0
    if not result.is_duplicate and temp_path.exists():
        try:
            analysis_count = import_excel_data(
                db=_db,
                file_path=temp_path,
                dataset_version=result.dataset_version,
                column_map=req.column_map,
                sheet_config=req.sheet_config,
            )
            result.analysis_count = analysis_count
            result.message = f"New dataset version {result.dataset_version} created with {analysis_count} analyses"
        except Exception as e:
            # Clean up on error
            temp_path.unlink(missing_ok=True)
            raise HTTPException(500, f"Failed to import data: {e}")

    # Clean up temp file
    temp_path.unlink(missing_ok=True)
    del _scan_cache[scan_id]

    # 任务记录（前端轮询用；导入同步完成即 succeeded）
    job_id = f"job_{uuid.uuid4().hex[:12]}"
    now = datetime.now(timezone.utc).isoformat()
    with _db.connect() as conn:
        conn.execute(
            """INSERT INTO jobs (job_id, status, phase, processed, total, result_json,
               error_json, created_at, updated_at)
               VALUES (?, 'succeeded', 'import', ?, ?, ?, NULL, ?, ?)""",
            (job_id, analysis_count or 1, analysis_count or 1,
             json.dumps({"dataset_version": result.dataset_version,
                         "analysis_count": analysis_count}), now, now),
        )

    return CommitResponse(
        dataset_version=result.dataset_version,
        file_sha256=result.file_sha256,
        mapping_hash=result.mapping_hash,
        is_duplicate=result.is_duplicate,
        message=result.message,
        job_id=job_id,
        analysis_count=analysis_count,
    )
