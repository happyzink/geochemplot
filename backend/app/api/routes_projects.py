"""API routes for project operations."""
from __future__ import annotations

import tempfile
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, HTTPException, UploadFile, File
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from ..services.projects import ProjectService
from ..storage.database import Database

router = APIRouter(prefix="/api/v1/projects", tags=["projects"])


_db: Optional[Database] = None
_project_svc: Optional[ProjectService] = None
_project_root: Optional[Path] = None


def init_project_routes(db: Database, project_root: Path = Path("data/projects")):
    global _db, _project_svc, _project_root
    _db = db
    _project_root = project_root
    _project_svc = ProjectService(db, project_root)


class CreateProjectRequest(BaseModel):
    name: str = Field(..., min_length=1)


class CreateProjectResponse(BaseModel):
    project_id: str
    name: str
    created_at: str


class ExportProjectRequest(BaseModel):
    project_id: str
    include_data: bool = True


class ExportProjectResponse(BaseModel):
    package_path: str
    byte_size: int
    sha256: str
    self_contained: bool
    manifest: dict


class RestoreProjectResponse(BaseModel):
    project_id: str
    status: str = "restored"


class ProjectInfoResponse(BaseModel):
    project_id: str
    name: str
    created_at: str
    geoplot_version: str
    schema_version: str


@router.post("/", response_model=CreateProjectResponse)
def create_project(req: CreateProjectRequest):
    """Create a new project."""
    if _project_svc is None:
        raise HTTPException(500, "Project service not initialized")
    project_id = _project_svc.create_project(req.name)
    info = _project_svc.get_project_info(project_id)
    return CreateProjectResponse(
        project_id=project_id,
        name=info["name"] if info else req.name,
        created_at=info["created_at"] if info else "",
    )


@router.post("/export", response_model=ExportProjectResponse)
def export_project(req: ExportProjectRequest):
    """Export project to .geoplot package."""
    if _project_svc is None:
        raise HTTPException(500, "Project service not initialized")

    try:
        with tempfile.TemporaryDirectory() as tmpdir:
            output_path = Path(tmpdir) / f"{req.project_id}.geoplot"
            result = _project_svc.export_project(
                req.project_id, output_path, req.include_data
            )

            return ExportProjectResponse(
                package_path=str(result.package_path),
                byte_size=result.byte_size,
                sha256=result.sha256,
                self_contained=result.self_contained,
                manifest={
                    "project_id": result.manifest.project_id,
                    "name": result.manifest.name,
                    "self_contained": result.manifest.self_contained,
                },
            )
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        raise HTTPException(500, f"Export failed: {str(e)}")


@router.post("/restore", response_model=RestoreProjectResponse)
async def restore_project(file: UploadFile = File(...)):
    """Restore project from uploaded .geoplot package."""
    if _project_svc is None:
        raise HTTPException(500, "Project service not initialized")

    with tempfile.TemporaryDirectory() as tmpdir:
        package_path = Path(tmpdir) / file.filename
        with open(package_path, "wb") as f:
            content = await file.read()
            f.write(content)

        try:
            project_id = _project_svc.restore_project(package_path)
            return RestoreProjectResponse(project_id=project_id, status="restored")
        except (ValueError, FileNotFoundError) as e:
            raise HTTPException(400, str(e))
        except Exception as e:
            raise HTTPException(500, f"Restore failed: {str(e)}")


@router.get("/{project_id}", response_model=ProjectInfoResponse)
def get_project(project_id: str):
    """Get project metadata."""
    if _project_svc is None:
        raise HTTPException(500, "Project service not initialized")

    info = _project_svc.get_project_info(project_id)
    if not info:
        raise HTTPException(404, f"Project {project_id} not found")

    return ProjectInfoResponse(
        project_id=info["project_id"],
        name=info["name"],
        created_at=info["created_at"],
        geoplot_version=info["geoplot_version"],
        schema_version=info["schema_version"],
    )


@router.get("/{project_id}/check-conflict")
def check_conflict(project_id: str, expected_revision: int):
    """Check for version conflict (optimistic locking)."""
    if _project_svc is None:
        raise HTTPException(500, "Project service not initialized")

    no_conflict = _project_svc.check_version_conflict(project_id, expected_revision)
    return {
        "project_id": project_id,
        "expected_revision": expected_revision,
        "conflict": not no_conflict,
    }


@router.get("/")
def list_projects():
    """List all projects with names (from manifests) and figure counts."""
    import json as _json
    if _db is None:
        raise HTTPException(500, "Database not initialized")

    with _db.connect() as conn:
        fig_rows = conn.execute(
            """SELECT project_id, COUNT(*) AS n, MIN(created_at) AS created_at
               FROM figures GROUP BY project_id"""
        ).fetchall()
        fig_map = {r["project_id"]: dict(r) for r in fig_rows}

    projects = []
    seen = set()
    if _project_root and _project_root.exists():
        for manifest_path in sorted(_project_root.glob("*/manifest.json")):
            try:
                manifest = _json.loads(manifest_path.read_text(encoding="utf-8"))
            except Exception:
                continue
            pid = manifest.get("project_id", manifest_path.parent.name)
            seen.add(pid)
            info = fig_map.get(pid, {})
            projects.append({
                "project_id": pid,
                "name": manifest.get("name", pid),
                "created_at": manifest.get("created_at", info.get("created_at", "")),
                "figure_count": info.get("n", 0),
            })
    # 无 manifest 但已有图件的项目（容错）
    for pid, info in fig_map.items():
        if pid not in seen:
            projects.append({
                "project_id": pid,
                "name": pid,
                "created_at": info.get("created_at", ""),
                "figure_count": info.get("n", 0),
            })

    return {"projects": projects, "total": len(projects)}


class SaveProjectRequest(BaseModel):
    name: Optional[str] = None


@router.post("/{project_id}/save")
def save_project(project_id: str, req: Optional[SaveProjectRequest] = None):
    """Save project (flush pending changes); optionally rename."""
    import json as _json
    if _project_svc is None:
        raise HTTPException(500, "Project service not initialized")

    info = _project_svc.get_project_info(project_id)
    if not info:
        raise HTTPException(404, f"Project {project_id} not found")

    if req and req.name:
        manifest_path = _project_root / project_id / "manifest.json"
        if manifest_path.exists():
            manifest = _json.loads(manifest_path.read_text(encoding="utf-8"))
            manifest["name"] = req.name
            manifest_path.write_text(_json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")

    return {"project_id": project_id, "status": "saved", "name": req.name if req and req.name else info.get("name", "")}


@router.get("/{project_id}/figures")
def list_project_figures(project_id: str):
    """List all figures in a project."""
    if _db is None:
        raise HTTPException(500, "Database not initialized")
    
    with _db.connect() as conn:
        rows = conn.execute(
            """SELECT figure_id, name, chart_type, metadata_revision, 
                      current_revision_id, archived, created_at, updated_at
               FROM figures
               WHERE project_id = ?
               ORDER BY created_at DESC""",
            (project_id,)
        ).fetchall()
        
        figures = [
            {
                "figure_id": row["figure_id"],
                "name": row["name"],
                "chart_type": row["chart_type"],
                "metadata_revision": row["metadata_revision"],
                "current_revision_id": row["current_revision_id"],
                "archived": bool(row["archived"]),
                "created_at": row["created_at"],
                "updated_at": row["updated_at"],
            }
            for row in rows
        ]
        
        return {"figures": figures, "total": len(figures)}
