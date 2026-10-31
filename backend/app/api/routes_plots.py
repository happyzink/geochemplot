"""API routes for plot scene computation."""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..domain.plot_spec import PlotScene, PlotSpec
from ..services.scenes import Repository, build_scene
from ..storage.database import Database

router = APIRouter(prefix="/api/v1", tags=["plots"])


_db: Optional[Database] = None


def init_plot_routes(db: Database):
    global _db
    _db = db


class ComputeRequest(BaseModel):
    """Schema 1.2 compute request.
    
    request_id is client-provided for discarding stale results.
    spec contains selection_id which has frozen dataset_id+version,
    so dataset_versions is NOT required here.
    """
    request_id: str
    spec: PlotSpec


@router.post("/plots/compute", response_model=PlotScene)
def compute_scene(req: ComputeRequest):
    """Compute a PlotScene from a PlotSpec against frozen data.

    Schema 1.2 contract:
    - request_id is echoed back (client uses it to discard stale results)
    - spec.selection_id contains frozen dataset_id+version
    - Returns PlotScene directly (not wrapped)
    - Scene contains schema_version="1.2", chart_type, variables, complete axes
    """
    if _db is None:
        raise HTTPException(500, "Database not initialized")

    # Extract dataset versions from the first layer's selection
    # In schema 1.2, versions are frozen in the selection snapshot
    dataset_versions = ["1.0"]  # Default fallback
    if req.spec.layers:
        sel_id = req.spec.layers[0].selection_id
        # Use Repository to get selection data
        temp_repo = Repository(db=_db, dataset_versions=["1.0"])
        sel_data = temp_repo.get_selection(sel_id)
        if sel_data and "dataset_versions" in sel_data:
            import json
            dataset_versions = json.loads(sel_data["dataset_versions"])
    
    repo = Repository(db=_db, dataset_versions=dataset_versions)
    scene = build_scene(req.spec, repo)
    
    # Set request_id in scene for client tracking
    # schema_version is already 1.2 from build_scene (default in PlotScene model)
    scene.request_id = req.request_id

    return scene


@router.post("/plots/validate")
def validate_spec(spec: PlotSpec):
    """Validate a PlotSpec without computing."""
    return {
        "valid": True,
        "schema_version": spec.schema_version,
        "chart_type": spec.chart_type,
        "layer_count": len(spec.layers),
        "spec_hash": spec.compute_spec_hash(),
    }
