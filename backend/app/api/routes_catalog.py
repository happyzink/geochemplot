"""API routes for built-in catalog operations."""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..services.catalog import Catalog, build_catalog, attach_catalog_item, get_builtin_response

router = APIRouter(prefix="/api/v1", tags=["catalog"])

_catalog: Optional[Catalog] = None


def init_catalog_routes():
    global _catalog
    _catalog = build_catalog()


def _get_catalog() -> Catalog:
    if _catalog is None:
        raise HTTPException(500, "Catalog not initialized")
    return _catalog


@router.get("/catalog/builtin")
def get_builtin_catalog():
    """Get built-in catalog items and reference compositions."""
    catalog = _get_catalog()
    return get_builtin_response(catalog)


class AttachRequest(BaseModel):
    project_id: str
    data_id: str


class AttachResponse(BaseModel):
    attached: bool
    data_id: str
    project_id: str


@router.post("/catalog/attach", response_model=AttachResponse)
def attach_item(req: AttachRequest):
    """Attach a built-in catalog item to a project. Idempotent."""
    catalog = _get_catalog()
    success = attach_catalog_item(catalog, req.data_id, req.project_id)
    if not success:
        raise HTTPException(404, f"Catalog item {req.data_id} not found")
    return AttachResponse(attached=True, data_id=req.data_id, project_id=req.project_id)


class ReferenceDetail(BaseModel):
    ref_id: str
    version: str
    citation: str
    doi: str
    elements: dict[str, float]
    units: dict[str, str]
    sha256: str
    source_file: str


@router.get("/catalog/references/{ref_id}", response_model=ReferenceDetail)
def get_reference(ref_id: str):
    """Get full reference composition details."""
    catalog = _get_catalog()
    ref = catalog.get_reference(ref_id)
    if ref is None:
        raise HTTPException(404, f"Reference {ref_id} not found")
    return ReferenceDetail(
        ref_id=ref.ref_id,
        version=ref.version,
        citation=ref.citation,
        doi=ref.doi,
        elements=ref.elements,
        units=ref.units,
        sha256=ref.sha256,
        source_file=ref.source_file,
    )
