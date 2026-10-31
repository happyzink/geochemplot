"""API routes for data query, selection, and lineage operations."""
from __future__ import annotations

import hashlib
import json
import uuid
from typing import Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from ..services.dedup import DedupService, ImportMapping
from ..services.selections import SelectionService, compute_selection_hash
from ..storage.database import Database

router = APIRouter(prefix="/api/v1", tags=["data"])


class QueryFilter(BaseModel):
    mission: Optional[list[str]] = None
    sample_group: Optional[list[str]] = Field(
        None, description="样品名称前段标号分组（如 14049 / 036 / CE6），分类规则 sample_prefix_v1")
    material_type: Optional[list[str]] = None
    mineral_group: Optional[list[str]] = None
    sample_search: Optional[dict] = Field(None, description="{mode: exact|parent|contains, text: str}")


class QueryRequest(BaseModel):
    dataset_versions: list[str]
    filter: QueryFilter = Field(default_factory=QueryFilter)
    offset: int = Field(0, ge=0)
    limit: int = Field(100, ge=1, le=10000)


class FacetResponse(BaseModel):
    missions: list[dict]
    sample_groups: list[dict]
    material_types: list[dict]
    mineral_groups: list[dict]
    total_count: int


class AnalysisDetail(BaseModel):
    analysis_id: str
    sample_id: str
    raw_name: str
    parent_sample: Optional[str]
    mission: str
    material_type: str
    mineral_group: str
    sample_group: str
    classification_evidence: list[dict]
    measurements: list[dict]


class SelectionCreate(BaseModel):
    name: str
    mode: str = Field("snapshot", description="snapshot|dynamic")
    dataset_versions: list[str]
    # 显式 analysis_id 列表（勾选快照）；与 filter 二选一，优先于 filter
    analysis_ids: Optional[list[str]] = None
    filter: QueryFilter = Field(default_factory=QueryFilter)


class SelectionResponse(BaseModel):
    selection_id: str
    name: str
    mode: str
    resolved_ids: list[str]
    selection_hash: str
    total_count: int


_db: Optional[Database] = None
_selection_svc: Optional[SelectionService] = None
_dedup_svc: Optional[DedupService] = None


def init_routes(db: Database):
    global _db, _selection_svc, _dedup_svc
    _db = db
    _selection_svc = SelectionService(db)
    _dedup_svc = DedupService(db)


def _get_db() -> Database:
    if _db is None:
        raise HTTPException(500, "Database not initialized")
    return _db


@router.post("/datasets/query")
def query_analyses(req: QueryRequest):
    db = _get_db()
    filter_dict = req.filter.model_dump(exclude_none=True)
    results = db.query_analyses(req.dataset_versions, filter_dict, req.offset, req.limit)
    total = db.count_analyses(req.dataset_versions, filter_dict)
    # 分类字段为派生数据（不落库），随行附带
    from ..services.classification import derive_sample_group, mission_class
    for r in results:
        r["sample_group"] = derive_sample_group(r.get("sample_id"))
        r["mission_class"] = mission_class(r.get("mission"), r.get("sample_id"))
    return {"analyses": results, "total": total, "offset": req.offset, "limit": req.limit}


@router.post("/datasets/facets", response_model=FacetResponse)
def get_facets(req: QueryRequest):
    db = _get_db()
    filter_dict = req.filter.model_dump(exclude_none=True)
    # SQL 一次聚合四个分类维度（mission_class 含样品名兜底、sample_group 为前段标号）
    counts = db.facet_counts(req.dataset_versions, filter_dict)

    def buckets(d: dict) -> list[dict]:
        return [{"value": k, "count": v} for k, v in sorted(d.items())]

    return FacetResponse(
        missions=buckets(counts["missions"]),
        sample_groups=buckets(counts["sample_groups"]),
        material_types=buckets(counts["material_types"]),
        mineral_groups=buckets(counts["mineral_groups"]),
        total_count=counts["total"],
    )


@router.get("/analyses/{analysis_id}", response_model=AnalysisDetail)
def get_analysis(analysis_id: str):
    db = _get_db()
    analysis = db.get_analysis(analysis_id)
    if not analysis:
        raise HTTPException(404, f"Analysis {analysis_id} not found")
    measurements = db.get_measurements(analysis_id)
    from ..services.classification import classify_analysis, derive_sample_group
    return AnalysisDetail(
        analysis_id=analysis["analysis_id"],
        sample_id=analysis.get("sample_id", ""),
        raw_name=analysis.get("raw_name", ""),
        parent_sample=analysis.get("parent_sample"),
        mission=analysis.get("mission", "unknown"),
        material_type=analysis.get("material_type", "unknown"),
        mineral_group=analysis.get("mineral_group", "unknown"),
        sample_group=derive_sample_group(analysis.get("sample_id")),
        classification_evidence=classify_analysis(analysis),
        measurements=measurements,
    )


@router.post("/selections", response_model=SelectionResponse)
def create_selection(req: SelectionCreate):
    if _selection_svc is None:
        raise HTTPException(500, "Selection service not initialized")
    filter_dict = req.filter.model_dump(exclude_none=True)
    record = _selection_svc.create_selection(
        name=req.name,
        mode=req.mode,
        filter_spec=filter_dict,
        dataset_versions=req.dataset_versions,
        analysis_ids=req.analysis_ids,
    )
    return SelectionResponse(
        selection_id=record.selection_id,
        name=record.name,
        mode=record.mode,
        resolved_ids=record.resolved_ids,
        selection_hash=record.selection_hash,
        total_count=record.total_count,
    )


@router.get("/selections/{selection_id}", response_model=SelectionResponse)
def get_selection(selection_id: str):
    if _selection_svc is None:
        raise HTTPException(500, "Selection service not initialized")
    record = _selection_svc.get_selection(selection_id)
    if not record:
        raise HTTPException(404, f"Selection {selection_id} not found")
    return SelectionResponse(
        selection_id=record.selection_id,
        name=record.name,
        mode=record.mode,
        resolved_ids=record.resolved_ids,
        selection_hash=record.selection_hash,
        total_count=len(record.resolved_ids),
    )


@router.delete("/selections/{selection_id}/analyses/{analysis_id}")
def remove_from_selection(selection_id: str, analysis_id: str):
    if _selection_svc is None:
        raise HTTPException(500, "Selection service not initialized")
    success = _selection_svc.remove_analysis_from_selection(selection_id, analysis_id)
    if not success:
        raise HTTPException(404, "Selection or analysis not found, or mode is not snapshot")
    return {"removed": True, "selection_id": selection_id, "analysis_id": analysis_id}


@router.get("/selections")
def list_selections():
    if _selection_svc is None:
        raise HTTPException(500, "Selection service not initialized")
    records = _selection_svc.list_selections()
    return [
        SelectionResponse(
            selection_id=r.selection_id,
            name=r.name,
            mode=r.mode,
            resolved_ids=r.resolved_ids,
            selection_hash=r.selection_hash,
            total_count=len(r.resolved_ids),
        )
        for r in records
    ]


class ImportRequest(BaseModel):
    filename: str
    sha256: str
    byte_size: int
    mapping: dict
    dataset_id: Optional[str] = None
    label: str = "Imported dataset"
    role: str = "user_data"


@router.post("/datasets/import")
def import_dataset(req: ImportRequest):
    if _dedup_svc is None:
        raise HTTPException(500, "Dedup service not initialized")

    mapping = ImportMapping(
        mapping_version="1.0",
        column_map=req.mapping.get("column_map", {}),
        sheet_config=req.mapping.get("sheet_config", {}),
    )

    dataset_id = req.dataset_id or f"ds_{uuid.uuid4().hex[:12]}"
    result = _dedup_svc.register_import(
        file_sha256=req.sha256,
        filename=req.filename,
        byte_size=req.byte_size,
        mapping=mapping,
        dataset_id=dataset_id,
        label=req.label,
        role=req.role,
    )

    return {
        "dataset_version": result.dataset_version,
        "file_sha256": result.file_sha256,
        "mapping_hash": result.mapping_hash,
        "is_duplicate": result.is_duplicate,
        "message": result.message,
    }
