"""Project persistence, export, and restore service."""
from __future__ import annotations

import hashlib
import json
import shutil
import uuid
import zipfile
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from ..domain.plot_spec import PlotScene, PlotSpec
from ..storage.database import Database


@dataclass
class ProjectManifest:
    """Project package manifest."""
    project_id: str
    name: str
    created_at: str
    geoplot_version: str
    schema_version: str
    self_contained: bool
    source_files: list[dict]
    datasets: list[dict]
    selections: list[dict]
    figures: list[dict]
    references: list[dict]
    missing_data: list[str] = field(default_factory=list)


@dataclass
class ProjectExportResult:
    """Result of project export."""
    package_path: Path
    manifest: ProjectManifest
    byte_size: int
    sha256: str
    self_contained: bool


class ProjectService:
    """Handles project save, export, and restore operations."""

    def __init__(self, db: Database, project_root: Path):
        self.db = db
        self.project_root = Path(project_root)
        self.project_root.mkdir(parents=True, exist_ok=True)

    def create_project(self, name: str) -> str:
        """Create a new project and return its ID."""
        project_id = f"proj_{uuid.uuid4().hex[:12]}"
        project_dir = self.project_root / project_id
        project_dir.mkdir(parents=True, exist_ok=True)
        (project_dir / "data").mkdir(exist_ok=True)
        (project_dir / "exports").mkdir(exist_ok=True)

        manifest = {
            "project_id": project_id,
            "name": name,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "geoplot_version": "1.0.0",
            "schema_version": "1.1",
        }
        with open(project_dir / "manifest.json", "w", encoding="utf-8") as f:
            json.dump(manifest, f, indent=2)

        return project_id

    def export_project(self, project_id: str, output_path: Path,
                       include_data: bool = True) -> ProjectExportResult:
        """Export project to a .geoplot package.

        If include_data=True, package is self-contained.
        If include_data=False, package references external data.
        """
        output_path = Path(output_path)
        self._validate_output_path(output_path)

        project_dir = self.project_root / project_id
        if not project_dir.exists():
            raise ValueError(f"Project {project_id} not found")

        with self.db.connect() as conn:
            source_files = [dict(r) for r in conn.execute(
                "SELECT * FROM source_files"
            ).fetchall()]
            datasets = [dict(r) for r in conn.execute(
                "SELECT * FROM datasets"
            ).fetchall()]
            selections = [dict(r) for r in conn.execute(
                "SELECT * FROM selections"
            ).fetchall()]
            figures = [dict(r) for r in conn.execute(
                "SELECT * FROM figures WHERE project_id = ?", (project_id,)
            ).fetchall()]

        manifest = ProjectManifest(
            project_id=project_id,
            name=project_id,
            created_at=datetime.now(timezone.utc).isoformat(),
            geoplot_version="1.0.0",
            schema_version="1.1",
            self_contained=include_data,
            source_files=[{"file_id": sf["file_id"], "filename": sf["filename"],
                          "sha256": sf["sha256"]} for sf in source_files],
            datasets=[{"dataset_id": ds["dataset_id"], "version": ds["version"]}
                     for ds in datasets],
            selections=[{"selection_id": s["selection_id"], "name": s["name"],
                        "mode": s["mode"]} for s in selections],
            figures=[{"figure_id": f["figure_id"], "name": f["name"],
                     "chart_type": f["chart_type"]} for f in figures],
            references=[],
        )

        with zipfile.ZipFile(output_path, "w", zipfile.ZIP_DEFLATED) as zf:
            manifest_dict = {
                "project_id": manifest.project_id,
                "name": manifest.name,
                "created_at": manifest.created_at,
                "geoplot_version": manifest.geoplot_version,
                "schema_version": manifest.schema_version,
                "self_contained": manifest.self_contained,
                "source_files": manifest.source_files,
                "datasets": manifest.datasets,
                "selections": manifest.selections,
                "figures": manifest.figures,
                "references": manifest.references,
                "missing_data": manifest.missing_data,
            }
            zf.writestr("manifest.json", json.dumps(manifest_dict, indent=2))

            if include_data:
                db_path = self.db.db_path
                if Path(db_path).exists():
                    zf.write(db_path, "data/geoplot.db")

                for sf in source_files:
                    src_file = project_dir / "data" / sf["filename"]
                    if src_file.exists():
                        zf.write(src_file, f"data/{sf['filename']}")

        byte_size = output_path.stat().st_size
        sha256 = hashlib.sha256(output_path.read_bytes()).hexdigest()

        return ProjectExportResult(
            package_path=output_path,
            manifest=manifest,
            byte_size=byte_size,
            sha256=sha256,
            self_contained=include_data,
        )

    def restore_project(self, package_path: Path, target_dir: Optional[Path] = None) -> str:
        """Restore project from .geoplot package to new directory.

        Returns project_id of restored project.
        """
        package_path = Path(package_path)
        self._validate_package_path(package_path)

        if target_dir is None:
            target_dir = self.project_root / f"restored_{uuid.uuid4().hex[:8]}"
        target_dir = Path(target_dir)
        target_dir.mkdir(parents=True, exist_ok=True)

        with zipfile.ZipFile(package_path, "r") as zf:
            manifest_json = zf.read("manifest.json")
            manifest = json.loads(manifest_json)

            project_id = manifest["project_id"]
            (target_dir / project_id).mkdir(exist_ok=True)

            zf.extractall(target_dir / project_id)

        if manifest.get("self_contained") and (target_dir / project_id / "data" / "geoplot.db").exists():
            restored_db_path = target_dir / project_id / "data" / "geoplot.db"
            restored_db = Database(restored_db_path)

            with restored_db.connect() as conn:
                count = conn.execute("SELECT COUNT(*) FROM analyses").fetchone()[0]

        return project_id

    def _validate_output_path(self, path: Path):
        """Validate output path to prevent path traversal."""
        path_str = str(path)
        if ".." in path_str:
            raise ValueError("Path traversal not allowed")
        resolved = path.resolve()
        try:
            resolved.relative_to(self.project_root.resolve())
        except ValueError:
            pass

    def _validate_package_path(self, path: Path):
        """Validate package path exists and is a zip file."""
        if not path.exists():
            raise FileNotFoundError(f"Package not found: {path}")
        if not zipfile.is_zipfile(path):
            raise ValueError(f"Not a valid zip package: {path}")

    def get_project_info(self, project_id: str) -> Optional[dict]:
        """Get project metadata."""
        project_dir = self.project_root / project_id
        manifest_path = project_dir / "manifest.json"
        if not manifest_path.exists():
            return None
        with open(manifest_path, "r", encoding="utf-8") as f:
            return json.load(f)

    def check_version_conflict(self, project_id: str, expected_revision: int) -> bool:
        """Check if project revision matches expected (optimistic locking).

        Returns True if no conflict, False if conflict detected.
        """
        with self.db.connect() as conn:
            row = conn.execute(
                "SELECT MAX(metadata_revision) as max_rev FROM figures WHERE project_id = ?",
                (project_id,)
            ).fetchone()
            current = row["max_rev"] if row and row["max_rev"] else 0
            return current == expected_revision
