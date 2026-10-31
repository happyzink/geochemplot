"""API routes for figures lifecycle management with SQLite persistence."""
from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from ..domain.plot_spec import PlotScene, PlotSpec
from ..services.scenes import Repository, build_scene
from ..storage.database import Database

router = APIRouter(prefix="/api/v1", tags=["figures"])

_db: Optional[Database] = None


def init_figure_routes(db: Database):
    global _db
    _db = db


class FigureCreateRequest(BaseModel):
    project_id: str = ""  # revise 时可缺省（沿用图件既有项目）
    plot_spec: PlotSpec
    # 可缺省：从 spec.layers[].selection_id 解析冻结版本（与 compute 同语义）
    dataset_versions: Optional[list[str]] = None
    label: str = ""


def _dataset_versions_for_spec(db: Database, spec: PlotSpec) -> list[str]:
    import json as _json
    versions: set[str] = set()
    with db.connect() as conn:
        for layer in spec.layers:
            row = conn.execute(
                "SELECT dataset_versions FROM selections WHERE selection_id = ?",
                (layer.selection_id,),
            ).fetchone()
            if row:
                for item in _json.loads(row["dataset_versions"] or "[]"):
                    if isinstance(item, dict) and item.get("version"):
                        versions.add(str(item["version"]))
    return sorted(versions) or ["1.0"]


class FigureCreateResponse(BaseModel):
    figure_id: str
    project_id: str
    scene_hash: str
    created_at: str
    status: str = "draft"


class FigureInfo(BaseModel):
    figure_id: str
    project_id: str
    label: str
    chart_type: str = "scatter"
    status: str
    scene_hash: str
    created_at: str
    revised_at: Optional[str] = None
    revision_count: int = 0


class RenderRequest(BaseModel):
    figure_id: str
    format: str = "png"
    dpi: int = 300


class RenderResponse(BaseModel):
    figure_id: str
    format: str
    path: str
    byte_size: int
    sha256: str


@router.post("/figures", response_model=FigureCreateResponse)
def create_figure(req: FigureCreateRequest):
    """Create a new figure (draft) from a PlotSpec."""
    if _db is None:
        raise HTTPException(500, "Database not initialized")

    figure_id = f"fig_{uuid.uuid4().hex[:12]}"
    now = datetime.now(timezone.utc).isoformat()

    # Build scene
    dataset_versions = req.dataset_versions or _dataset_versions_for_spec(_db, req.plot_spec)
    repo = Repository(db=_db, dataset_versions=dataset_versions)
    scene = build_scene(req.plot_spec, repo)
    
    # Insert into database
    spec_json = json.dumps(req.plot_spec.model_dump())
    with _db.connect() as conn:
        conn.execute(
            """INSERT INTO figures (figure_id, project_id, name, chart_type,
               metadata_revision, current_revision_id, archived, created_at, updated_at)
               VALUES (?, ?, ?, ?, 1, ?, 0, ?, ?)""",
            (figure_id, req.project_id, req.label, req.plot_spec.chart_type,
             figure_id + "_r1", now, now)
        )
        
        # Create first revision
        revision_id = figure_id + "_r1"
        conn.execute(
            """INSERT INTO figure_revisions (revision_id, figure_id, revision_number,
               spec_json, scene_id, content_hash, created_at)
               VALUES (?, ?, 1, ?, ?, ?, ?)""",
            (revision_id, figure_id, spec_json, scene.scene_id, scene.scene_hash, now)
        )

    return FigureCreateResponse(
        figure_id=figure_id,
        project_id=req.project_id,
        scene_hash=scene.scene_hash,
        created_at=now,
    )


@router.get("/figures/{figure_id}", response_model=FigureInfo)
def get_figure(figure_id: str):
    """Get figure metadata."""
    if _db is None:
        raise HTTPException(500, "Database not initialized")
    
    with _db.connect() as conn:
        row = conn.execute(
            """SELECT f.*, fr.content_hash as scene_hash, fr.created_at as revised_at
               FROM figures f
               LEFT JOIN figure_revisions fr ON f.current_revision_id = fr.revision_id
               WHERE f.figure_id = ?""",
            (figure_id,)
        ).fetchone()
        
        if not row:
            raise HTTPException(404, f"Figure {figure_id} not found")
        
        # Count revisions
        rev_count = conn.execute(
            "SELECT COUNT(*) as cnt FROM figure_revisions WHERE figure_id = ?",
            (figure_id,)
        ).fetchone()["cnt"]
        
        return FigureInfo(
            figure_id=row["figure_id"],
            project_id=row["project_id"],
            label=row["name"],
            chart_type=row["chart_type"] or "scatter",
            status="published" if not row["archived"] else "archived",
            scene_hash=row["scene_hash"] or "",
            created_at=row["created_at"],
            revised_at=row["revised_at"],
            revision_count=rev_count,
        )


@router.get("/figures")
def list_figures(project_id: Optional[str] = None):
    """List figures, optionally filtered by project."""
    if _db is None:
        raise HTTPException(500, "Database not initialized")
    
    with _db.connect() as conn:
        if project_id:
            rows = conn.execute(
                """SELECT f.*, fr.content_hash as scene_hash, fr.created_at as revised_at
                   FROM figures f
                   LEFT JOIN figure_revisions fr ON f.current_revision_id = fr.revision_id
                   WHERE f.project_id = ?
                   ORDER BY f.created_at DESC""",
                (project_id,)
            ).fetchall()
        else:
            rows = conn.execute(
                """SELECT f.*, fr.content_hash as scene_hash, fr.created_at as revised_at
                   FROM figures f
                   LEFT JOIN figure_revisions fr ON f.current_revision_id = fr.revision_id
                   ORDER BY f.created_at DESC"""
            ).fetchall()
        
        figures = []
        for row in rows:
            rev_count = conn.execute(
                "SELECT COUNT(*) as cnt FROM figure_revisions WHERE figure_id = ?",
                (row["figure_id"],)
            ).fetchone()["cnt"]
            
            figures.append(FigureInfo(
                figure_id=row["figure_id"],
                project_id=row["project_id"],
                label=row["name"],
                chart_type=row["chart_type"] or "scatter",
                status="published" if not row["archived"] else "archived",
                scene_hash=row["scene_hash"] or "",
                created_at=row["created_at"],
                revised_at=row["revised_at"],
                revision_count=rev_count,
            ))
        
        return figures


@router.post("/figures/{figure_id}/revise")
def revise_figure(figure_id: str, req: FigureCreateRequest):
    """Create a new revision of an existing figure."""
    if _db is None:
        raise HTTPException(500, "Database not initialized")
    
    with _db.connect() as conn:
        # Get current revision number
        row = conn.execute(
            "SELECT MAX(revision_number) as max_rev FROM figure_revisions WHERE figure_id = ?",
            (figure_id,)
        ).fetchone()
        
        if not row or row["max_rev"] is None:
            raise HTTPException(404, f"Figure {figure_id} not found")
        
        new_rev_num = row["max_rev"] + 1
        revision_id = f"{figure_id}_r{new_rev_num}"
        now = datetime.now(timezone.utc).isoformat()

        # Build new scene
        dataset_versions = req.dataset_versions or _dataset_versions_for_spec(_db, req.plot_spec)
        repo = Repository(db=_db, dataset_versions=dataset_versions)
        scene = build_scene(req.plot_spec, repo)
        
        spec_json = json.dumps(req.plot_spec.model_dump())
        
        # Insert new revision
        conn.execute(
            """INSERT INTO figure_revisions (revision_id, figure_id, revision_number,
               spec_json, scene_id, content_hash, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (revision_id, figure_id, new_rev_num, spec_json, scene.scene_id, scene.scene_hash, now)
        )
        
        # Update figure to point to new revision
        conn.execute(
            """UPDATE figures SET current_revision_id = ?, name = ?, 
               metadata_revision = ?, updated_at = ?
               WHERE figure_id = ?""",
            (revision_id, req.label, new_rev_num, now, figure_id)
        )

    return {
        "figure_id": figure_id,
        "scene_hash": scene.scene_hash,
        "revision": new_rev_num,
        "revised_at": now,
    }


@router.post("/figures/{figure_id}/publish")
def publish_figure(figure_id: str):
    """Publish a figure (transition from draft to published)."""
    if _db is None:
        raise HTTPException(500, "Database not initialized")
    
    with _db.connect() as conn:
        row = conn.execute(
            "SELECT archived FROM figures WHERE figure_id = ?",
            (figure_id,)
        ).fetchone()
        
        if not row:
            raise HTTPException(404, f"Figure {figure_id} not found")
        
        now = datetime.now(timezone.utc).isoformat()
        conn.execute(
            "UPDATE figures SET archived = 0, updated_at = ? WHERE figure_id = ?",
            (now, figure_id)
        )
        
        # Get scene hash
        rev_row = conn.execute(
            """SELECT fr.content_hash FROM figures f
               JOIN figure_revisions fr ON f.current_revision_id = fr.revision_id
               WHERE f.figure_id = ?""",
            (figure_id,)
        ).fetchone()
        
        return {
            "figure_id": figure_id,
            "status": "published",
            "scene_hash": rev_row["content_hash"] if rev_row else "",
        }


@router.delete("/figures/{figure_id}")
def delete_figure(figure_id: str):
    """Delete a figure and all its revisions."""
    if _db is None:
        raise HTTPException(500, "Database not initialized")
    
    with _db.connect() as conn:
        row = conn.execute(
            "SELECT figure_id FROM figures WHERE figure_id = ?",
            (figure_id,)
        ).fetchone()
        
        if not row:
            raise HTTPException(404, f"Figure {figure_id} not found")
        
        # Delete revisions first
        conn.execute("DELETE FROM figure_revisions WHERE figure_id = ?", (figure_id,))
        # Delete figure
        conn.execute("DELETE FROM figures WHERE figure_id = ?", (figure_id,))
        
        return {"deleted": True, "figure_id": figure_id}


class FigurePatchRequest(BaseModel):
    name: Optional[str] = None
    archived: Optional[bool] = None


@router.patch("/figures/{figure_id}")
def patch_figure(figure_id: str, req: FigurePatchRequest):
    """Rename or archive a figure without creating a revision."""
    if _db is None:
        raise HTTPException(500, "Database not initialized")

    with _db.connect() as conn:
        row = conn.execute(
            "SELECT figure_id FROM figures WHERE figure_id = ?", (figure_id,)
        ).fetchone()
        if not row:
            raise HTTPException(404, f"Figure {figure_id} not found")
        now = datetime.now(timezone.utc).isoformat()
        if req.name is not None:
            conn.execute(
                "UPDATE figures SET name = ?, updated_at = ? WHERE figure_id = ?",
                (req.name, now, figure_id),
            )
        if req.archived is not None:
            conn.execute(
                "UPDATE figures SET archived = ?, updated_at = ? WHERE figure_id = ?",
                (1 if req.archived else 0, now, figure_id),
            )

    return get_figure(figure_id)


@router.post("/figures/{figure_id}/render", response_model=RenderResponse)
def render_figure(figure_id: str, req: RenderRequest):
    """Render a figure to PNG/PDF/SVG."""
    if _db is None:
        raise HTTPException(500, "Database not initialized")
    
    with _db.connect() as conn:
        row = conn.execute(
            """SELECT fr.spec_json FROM figures f
               JOIN figure_revisions fr ON f.current_revision_id = fr.revision_id
               WHERE f.figure_id = ?""",
            (figure_id,)
        ).fetchone()
        
        if not row:
            raise HTTPException(404, f"Figure {figure_id} not found")
        
        spec_dict = json.loads(row["spec_json"])
        plot_spec = PlotSpec(**spec_dict)
        
        # Build scene
        repo = Repository(db=_db, dataset_versions=_dataset_versions_for_spec(_db, plot_spec))
        scene = build_scene(plot_spec, repo)
        scene_dict = scene.model_dump()

    from ..renderers.matplotlib_renderer import render_scene

    output_dir = Path("data/renders")
    output_dir.mkdir(parents=True, exist_ok=True)
    output_path = output_dir / f"{figure_id}.{req.format}"

    result = render_scene(scene_dict, output_path, fmt=req.format, dpi=req.dpi)

    return RenderResponse(
        figure_id=figure_id,
        format=req.format,
        path=str(result.path),
        byte_size=result.byte_size,
        sha256=result.sha256,
    )


@router.get("/figures/{figure_id}/versions")
def list_figure_versions(figure_id: str):
    """List all versions of a figure."""
    if _db is None:
        raise HTTPException(500, "Database not initialized")
    
    with _db.connect() as conn:
        rows = conn.execute(
            """SELECT revision_id, revision_number, scene_id, content_hash, created_at, spec_json
               FROM figure_revisions
               WHERE figure_id = ?
               ORDER BY revision_number DESC""",
            (figure_id,)
        ).fetchall()

        if not rows:
            raise HTTPException(404, f"Figure {figure_id} not found")

        versions = [
            {
                "revision_id": row["revision_id"],
                "revision_number": row["revision_number"],
                "scene_id": row["scene_id"],
                "scene_hash": row["content_hash"],
                "created_at": row["created_at"],
                "spec": json.loads(row["spec_json"]) if row["spec_json"] else None,
            }
            for row in rows
        ]

        return {"figure_id": figure_id, "versions": versions, "total": len(versions)}


@router.post("/figures/{figure_id}/restore")
def restore_figure_version(figure_id: str, revision_id: str):
    """Restore a figure to a previous version."""
    if _db is None:
        raise HTTPException(500, "Database not initialized")
    
    with _db.connect() as conn:
        # Verify revision exists
        row = conn.execute(
            "SELECT revision_number FROM figure_revisions WHERE revision_id = ? AND figure_id = ?",
            (revision_id, figure_id)
        ).fetchone()
        
        if not row:
            raise HTTPException(404, f"Revision {revision_id} not found")
        
        now = datetime.now(timezone.utc).isoformat()
        conn.execute(
            "UPDATE figures SET current_revision_id = ?, updated_at = ? WHERE figure_id = ?",
            (revision_id, now, figure_id)
        )
        
        return {
            "figure_id": figure_id,
            "restored_to": revision_id,
            "revision_number": row["revision_number"],
            "restored_at": now,
        }
