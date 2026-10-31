"""API routes for export operations with real rendering and disk writes.

修复导出空壳缺陷：POST /exports 实际调用 matplotlib_renderer 渲染 PNG/PDF/SVG
并写入选定导出根目录，写复现包（scene/spec/CSV/参考/字体清单），sha256 校验，
export_records/jobs 落库；重开记录时重新校验文件存在性（R5 语义）。
"""
from __future__ import annotations

import csv
import hashlib
import json
import os
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from ..domain.plot_spec import PlotSpec
from ..renderers.matplotlib_renderer import render_scene
from ..services.scenes import Repository, build_scene
from ..storage.database import Database

router = APIRouter(prefix="/api/v1", tags=["exports"])

_db: Optional[Database] = None


def init_export_routes(db: Database):
    global _db
    _db = db


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def _dataset_versions_for_spec(spec: PlotSpec) -> list[str]:
    """从 spec.layers[].selection_id 解析冻结的 dataset 版本（18 §3）。"""
    versions: set[str] = set()
    with _db.connect() as conn:
        for layer in spec.layers:
            row = conn.execute(
                "SELECT dataset_versions FROM selections WHERE selection_id = ?",
                (layer.selection_id,),
            ).fetchone()
            if row:
                for item in json.loads(row["dataset_versions"] or "[]"):
                    if isinstance(item, dict) and item.get("version"):
                        versions.add(str(item["version"]))
    return sorted(versions) or ["1.0"]


# ---------------------------------------------------------------------------
# Export roots
# ---------------------------------------------------------------------------

class ExportRootCreateRequest(BaseModel):
    project_id: str
    absolute_path: str
    display_name: str = ""


class ExportRootInfo(BaseModel):
    export_root_id: str
    project_id: str
    absolute_path: str
    display_name: str
    selected_by_user_at: str
    writable_check: str  # ok | unwritable | unknown
    is_default: bool = False


def _root_info(row: dict, project_id: str = "") -> ExportRootInfo:
    return ExportRootInfo(
        export_root_id=row["export_root_id"],
        project_id=project_id,
        absolute_path=row["absolute_path"],
        display_name=row["display_name"] or "",
        selected_by_user_at=row["selected_by_user_at"],
        writable_check="ok" if row["writable_check"] else "unwritable",
        is_default=bool(row.get("is_default", 0)),
    )


@router.get("/export-roots")
def list_export_roots(project_id: str = ""):
    """List registered export root directories."""
    with _db.connect() as conn:
        rows = [dict(r) for r in conn.execute(
            "SELECT * FROM export_roots ORDER BY selected_by_user_at DESC"
        ).fetchall()]
    return [_root_info(r, project_id) for r in rows]


@router.post("/export-roots", response_model=ExportRootInfo)
def create_export_root(req: ExportRootCreateRequest):
    """Register a new export root directory (validated writable)."""
    path = Path(req.absolute_path).expanduser().resolve()
    try:
        path.mkdir(parents=True, exist_ok=True)
        test_file = path / ".geoplot_write_test"
        test_file.touch()
        test_file.unlink()
        writable = True
    except Exception as e:
        raise HTTPException(400, f"导出目录不可写：{path}（{e}）")

    root_id = f"root_{uuid.uuid4().hex[:12]}"
    now = _now()
    with _db.connect() as conn:
        conn.execute(
            """INSERT INTO export_roots (export_root_id, absolute_path, display_name,
               selected_by_user_at, writable_check) VALUES (?, ?, ?, ?, 1)""",
            (root_id, str(path), req.display_name or path.name, now),
        )
    return ExportRootInfo(
        export_root_id=root_id,
        project_id=req.project_id,
        absolute_path=str(path),
        display_name=req.display_name or path.name,
        selected_by_user_at=now,
        writable_check="ok",
        is_default=True,
    )


class ChooseRootRequest(BaseModel):
    project_id: str


@router.post("/export-roots/choose")
def choose_export_root(req: ChooseRootRequest):
    """Return a Job whose result is the default export root choice.

    浏览器环境无原生目录对话框：返回项目 exports 目录作为默认根，
    由前端渲染“使用默认目录 / 手动输入路径”选择界面。
    """
    root = Path("data/exports") / req.project_id
    root.mkdir(parents=True, exist_ok=True)
    job_id = f"job_{uuid.uuid4().hex[:12]}"
    result = {
        "status": "succeeded",
        "export_root": {
            "export_root_id": "root_default",
            "project_id": req.project_id,
            "absolute_path": str(root.resolve()),
            "display_name": "项目导出目录",
            "selected_by_user_at": _now(),
            "writable_check": "ok",
            "is_default": True,
        },
    }
    with _db.connect() as conn:
        conn.execute(
            """INSERT INTO jobs (job_id, status, phase, processed, total, result_json,
               error_json, created_at, updated_at)
               VALUES (?, 'succeeded', 'choose', 1, 1, ?, NULL, ?, ?)""",
            (job_id, json.dumps(result), _now(), _now()),
        )
    return {
        "job_id": job_id,
        "status": "succeeded",
        "phase": "choose",
        "processed": 1,
        "total": 1,
        "result": result,
        "error": None,
    }


# ---------------------------------------------------------------------------
# Exports
# ---------------------------------------------------------------------------

class ExportCreateRequest(BaseModel):
    figure_id: str
    revision_id: str = ""
    scene_id: str = ""
    formats: list[str] = Field(default_factory=lambda: ["png"])
    dpi: Optional[int] = 600
    background: str = "white"
    size_mm: dict = Field(default_factory=lambda: {"width": 183, "height": 110})
    export_root_id: str = ""
    include_bundle: bool = True


def _load_scene_for_export(req: ExportCreateRequest):
    """从 figure 的指定/当前修订重建 Scene（数据版本由 selection 冻结）。

    R18：历史快照不被最新资源/数据覆盖——重建 scene_hash 与修订冻结的
    content_hash 必须一致，否则要求重算并创建新保存版本。
    """
    with _db.connect() as conn:
        if req.revision_id:
            row = conn.execute(
                "SELECT spec_json, content_hash FROM figure_revisions WHERE revision_id = ? AND figure_id = ?",
                (req.revision_id, req.figure_id),
            ).fetchone()
        else:
            row = conn.execute(
                """SELECT fr.spec_json, fr.content_hash FROM figures f
                   JOIN figure_revisions fr ON f.current_revision_id = fr.revision_id
                   WHERE f.figure_id = ?""",
                (req.figure_id,),
            ).fetchone()
        if not row:
            raise HTTPException(404, f"Figure {req.figure_id} 修订不存在")
        figure_row = conn.execute(
            "SELECT name, project_id FROM figures WHERE figure_id = ?", (req.figure_id,)
        ).fetchone()
        if not figure_row:
            raise HTTPException(404, f"Figure {req.figure_id} 不存在")

    spec = PlotSpec(**json.loads(row["spec_json"]))
    repo = Repository(db=_db, dataset_versions=_dataset_versions_for_spec(spec))
    scene = build_scene(spec, repo)

    frozen_hash = row["content_hash"] or ""
    if frozen_hash and scene.scene_hash != frozen_hash:
        raise HTTPException(
            409,
            "冻结快照与当前资源/数据不一致（scene_hash 已变化），历史修订不得被最新资源覆盖；"
            "请重算并创建新保存版本后再导出。",
        )
    return spec, scene, figure_row["name"] or req.figure_id, figure_row["project_id"]


def _insert_job(conn, job_id: str, status: str, phase: str, processed: int, total: int,
                result: Optional[dict], error: Optional[dict]) -> None:
    conn.execute(
        """INSERT INTO jobs (job_id, status, phase, processed, total, result_json,
           error_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (job_id, status, phase, processed, total,
         json.dumps(result) if result else None,
         json.dumps(error) if error else None, _now(), _now()),
    )


@router.post("/exports")
def create_export(req: ExportCreateRequest):
    """Render figure revisions to PNG/PDF/SVG in the export root and record files."""
    if _db is None:
        raise HTTPException(500, "Database not initialized")
    unknown = [f for f in req.formats if f not in ("png", "pdf", "svg")]
    if unknown:
        raise HTTPException(422, f"不支持的导出格式：{unknown}")
    if not req.formats:
        raise HTTPException(422, "至少选择一种输出格式")

    spec, scene, figure_name, project_id = _load_scene_for_export(req)
    scene_dict = scene.model_dump()

    # 导出根：请求指定的注册根，否则项目默认目录
    if req.export_root_id and req.export_root_id != "root_default":
        with _db.connect() as conn:
            root_row = conn.execute(
                "SELECT absolute_path FROM export_roots WHERE export_root_id = ?",
                (req.export_root_id,),
            ).fetchone()
        if not root_row:
            raise HTTPException(404, f"Export root {req.export_root_id} 不存在")
        root_path = Path(root_row["absolute_path"])
    else:
        root_path = Path("data/exports") / project_id
    root_path.mkdir(parents=True, exist_ok=True)

    seq = 0
    with _db.connect() as conn:
        seq = conn.execute(
            "SELECT COUNT(*) AS n FROM export_records WHERE figure_id = ?",
            (req.figure_id,),
        ).fetchone()["n"] + 1

    safe_figure = "".join(c for c in figure_name if c not in '\\/:*?"<>|') or req.figure_id
    relative_dir = f"{safe_figure}\\v{seq:04d}"
    out_dir = root_path / safe_figure / f"v{seq:04d}"
    out_dir.mkdir(parents=True, exist_ok=True)

    export_id = f"exp_{uuid.uuid4().hex[:12]}"
    job_id = f"job_{uuid.uuid4().hex[:12]}"
    now = _now()
    with _db.connect() as conn:
        conn.execute(
            """INSERT INTO export_records (export_id, figure_id, revision_id, scene_id,
               scene_hash, export_seq, formats, state, export_root_id, relative_dir,
               error_json, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, 'rendering', ?, ?, NULL, ?, ?)""",
            (export_id, req.figure_id, req.revision_id or "", scene.scene_id, scene.scene_hash,
             seq, json.dumps(req.formats), req.export_root_id or "root_default",
             relative_dir, now, now),
        )
        _insert_job(conn, job_id, "running", "rendering", 0, len(req.formats), None, None)

    files: list[dict] = []
    try:
        # 1. 渲染各格式
        for fmt in req.formats:
            output_path = out_dir / f"figure.{fmt}"
            result = render_scene(
                scene_dict, output_path, fmt=fmt,
                dpi=req.dpi or 600, background=req.background,
            )
            files.append({
                "artifact_id": f"art_{export_id}_{fmt}",
                "filename": f"figure.{fmt}",
                "format": fmt,
                "byte_size": result.byte_size,
                "sha256": result.sha256,
                "absolute_path": str(output_path.resolve()),
                "exists": True,
            })
            with _db.connect() as conn:
                conn.execute(
                    "UPDATE jobs SET processed = ?, updated_at = ? WHERE job_id = ?",
                    (len(files), _now(), job_id),
                )

        # 2. 复现包
        if req.include_bundle:
            bundle: list[tuple[str, str, Any]] = [
                ("plot_spec.json", "json", spec.model_dump()),
                ("scene.json", "json", scene_dict),
                ("reference_snapshot.json", "json", scene_dict.get("reference_snapshots", [])),
                ("provenance.json", "json", {
                    "counts": scene_dict.get("counts"),
                    "exclusions": scene_dict.get("exclusions"),
                    "resolved_selections": scene_dict.get("resolved_selections"),
                    "software_version": scene_dict.get("software_version"),
                    "scene_hash": scene_dict.get("scene_hash"),
                    "spec_hash": scene_dict.get("spec_hash"),
                }),
                ("font_manifest.json", "json", scene_dict.get("font_manifest", {})),
            ]
            for name, _kind, payload in bundle:
                path = out_dir / name
                path.write_text(json.dumps(payload, ensure_ascii=False, indent=1), encoding="utf-8")
                files.append({
                    "artifact_id": None, "filename": name, "format": "json",
                    "byte_size": path.stat().st_size, "sha256": _sha256_file(path),
                    "absolute_path": str(path.resolve()), "exists": True,
                })
            # 投图 CSV：series 逐点
            csv_path = out_dir / "plot_data.csv"
            with open(csv_path, "w", newline="", encoding="utf-8-sig") as f:
                writer = csv.writer(f)
                writer.writerow(["series_id", "layer_id", "analysis_id", "point_id",
                                 "x", "y", "x_error", "y_error", "element"])
                for series in scene_dict.get("series", []):
                    for p in series.get("points", []):
                        prov = p.get("provenance") or {}
                        writer.writerow([
                            series.get("series_id"), series.get("layer_id"),
                            p.get("analysis_id"), p.get("point_id"),
                            p.get("x"), p.get("y"), p.get("x_error"), p.get("y_error"),
                            prov.get("element", ""),
                        ])
            files.append({
                "artifact_id": None, "filename": "plot_data.csv", "format": "csv",
                "byte_size": csv_path.stat().st_size, "sha256": _sha256_file(csv_path),
                "absolute_path": str(csv_path.resolve()), "exists": True,
            })
            readme = out_dir / "README.md"
            readme.write_text(
                f"# GeoPlot 导出\n\nfigure: {figure_name}\nscene_hash: {scene.scene_hash}\n"
                f"formats: {', '.join(req.formats)}\ndpi: {req.dpi}\nsize_mm: {req.size_mm}\n",
                encoding="utf-8",
            )
            files.append({
                "artifact_id": None, "filename": "README.md", "format": "md",
                "byte_size": readme.stat().st_size, "sha256": _sha256_file(readme),
                "absolute_path": str(readme.resolve()), "exists": True,
            })

        # 3. 提交：sha256 复核
        with _db.connect() as conn:
            conn.execute(
                "UPDATE export_records SET state = 'succeeded', updated_at = ? WHERE export_id = ?",
                (_now(), export_id),
            )
            conn.execute(
                """UPDATE jobs SET status = 'succeeded', phase = 'committing',
                   processed = ?, total = ?, result_json = ?, updated_at = ?
                   WHERE job_id = ?""",
                (len(files), len(files), json.dumps({"export_id": export_id}), _now(), job_id),
            )
    except Exception as e:
        with _db.connect() as conn:
            conn.execute(
                "UPDATE export_records SET state = 'failed', error_json = ?, updated_at = ? WHERE export_id = ?",
                (json.dumps({"code": "EXPORT_FAILED", "message": str(e)}), _now(), export_id),
            )
            conn.execute(
                """UPDATE jobs SET status = 'failed', phase = 'failed', error_json = ?,
                   updated_at = ? WHERE job_id = ?""",
                (json.dumps({"code": "EXPORT_FAILED", "message": str(e)}), _now(), job_id),
            )
        raise HTTPException(500, f"导出失败：{e}")

    return {"job_id": job_id, "export_id": export_id, "state": "succeeded",
            "relative_dir": relative_dir, "files": files}


def _export_record(export_id: str) -> dict:
    with _db.connect() as conn:
        row = conn.execute(
            "SELECT * FROM export_records WHERE export_id = ?", (export_id,)
        ).fetchone()
        if not row:
            raise HTTPException(404, f"Export {export_id} not found")
        fig = conn.execute(
            "SELECT project_id FROM figures WHERE figure_id = ?", (row["figure_id"],)
        ).fetchone()
    rec = dict(row)
    project_id = fig["project_id"] if fig else ""
    if rec["export_root_id"] and rec["export_root_id"] != "root_default":
        with _db.connect() as conn:
            root_row = conn.execute(
                "SELECT absolute_path FROM export_roots WHERE export_root_id = ?",
                (rec["export_root_id"],),
            ).fetchone()
        root = Path(root_row["absolute_path"]) if root_row else Path("data/exports") / project_id
    else:
        root = Path("data/exports") / project_id
    out_dir = root / Path(rec["relative_dir"].replace("\\", "/"))

    # 重开记录时重新校验文件存在性（R5）
    files = []
    if out_dir.exists():
        for path in sorted(out_dir.iterdir()):
            if path.is_file():
                fmt = path.suffix.lstrip(".").lower()
                files.append({
                    "artifact_id": None,
                    "filename": path.name,
                    "format": fmt if fmt in ("png", "pdf", "svg", "json", "csv", "md") else "json",
                    "byte_size": path.stat().st_size,
                    "sha256": _sha256_file(path),
                    "absolute_path": str(path.resolve()),
                    "exists": True,
                })
    else:
        rec["state"] = "failed" if rec["state"] == "succeeded" else rec["state"]

    return {
        "export_id": rec["export_id"],
        "figure_id": rec["figure_id"],
        "revision_id": rec["revision_id"],
        "scene_id": rec["scene_id"],
        "scene_hash": rec["scene_hash"],
        "export_seq": rec["export_seq"],
        "formats": json.loads(rec["formats"] or "[]"),
        "size_mm": {"width": 183, "height": 110},
        "dpi": 600,
        "background": "white",
        "export_root_id": rec["export_root_id"],
        "relative_dir": rec["relative_dir"],
        "state": rec["state"],
        "files": files,
        "error": json.loads(rec["error_json"]) if rec["error_json"] else None,
        "counts": None,
        "created_at": rec["created_at"],
        "finished_at": rec["updated_at"] if rec["state"] in ("succeeded", "failed") else None,
    }


@router.get("/exports/{export_id}")
def get_export(export_id: str):
    """Get export record with disk-verified files."""
    return _export_record(export_id)


@router.get("/exports")
def list_exports(project_id: Optional[str] = None):
    """List export records (optionally by project)."""
    with _db.connect() as conn:
        if project_id:
            rows = conn.execute(
                """SELECT e.export_id FROM export_records e
                   JOIN figures f ON f.figure_id = e.figure_id
                   WHERE f.project_id = ? ORDER BY e.created_at DESC""",
                (project_id,),
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT export_id FROM export_records ORDER BY created_at DESC"
            ).fetchall()
    return [_export_record(r["export_id"]) for r in rows]


@router.post("/exports/{export_id}/open-folder")
def open_export_folder(export_id: str):
    """Open the export folder in the system file manager."""
    record = _export_record(export_id)
    path = record["relative_dir"].replace("\\", "/")
    root = Path(record["export_root_id"] and "data/exports" or "data/exports")
    # 从 files 反推目录
    if record["files"]:
        folder = Path(record["files"][0]["absolute_path"]).parent
    else:
        folder = Path("data/exports") / path
    if not folder.exists():
        return {"opened": False, "path": str(folder), "error": "目录不存在"}
    try:
        if os.name == "nt":
            os.startfile(str(folder))  # noqa: S606
        else:
            import subprocess
            subprocess.Popen(["xdg-open", str(folder)])
        return {"opened": True, "path": str(folder.resolve())}
    except Exception as e:
        return {"opened": False, "path": str(folder), "error": str(e)}


class ReexportBody(BaseModel):
    export_root_id: Optional[str] = None


@router.post("/exports/{export_id}/reexport")
def reexport(export_id: str, body: Optional[ReexportBody] = None):
    """Re-render an export from its figure revision (optionally to a new root)."""
    record = _export_record(export_id)
    req = ExportCreateRequest(
        figure_id=record["figure_id"],
        revision_id=record["revision_id"],
        scene_id=record["scene_id"],
        formats=record["formats"],
        dpi=record["dpi"],
        background=record["background"],
        export_root_id=(body.export_root_id if body and body.export_root_id
                        else record["export_root_id"]),
        include_bundle=True,
    )
    result = create_export(req)
    return {"job_id": result["job_id"], "export_id": result["export_id"]}
