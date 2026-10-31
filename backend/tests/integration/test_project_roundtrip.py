"""Project roundtrip integration tests.

Tests project save, export, restore, and consistency.
"""
from __future__ import annotations

import json
import tempfile
from pathlib import Path

import pytest

from app.services.projects import ProjectService
from app.services.selections import SelectionService
from app.storage.database import Database


@pytest.fixture
def temp_env():
    """Create temporary environment with database and project root."""
    with tempfile.TemporaryDirectory() as tmpdir:
        tmpdir = Path(tmpdir)
        db_path = tmpdir / "test.db"
        project_root = tmpdir / "projects"
        project_root.mkdir()

        db = Database(db_path)
        svc = ProjectService(db, project_root)

        yield {
            "db": db,
            "svc": svc,
            "tmpdir": tmpdir,
            "project_root": project_root,
        }


@pytest.fixture
def populated_env(temp_env):
    """Environment with test data populated."""
    db = temp_env["db"]
    file_id = db.insert_source_file("test.xlsx", "abc123def456", 5000)
    db.insert_dataset("ds_001", "1.0", "Test Dataset", "user_data", file_id, "map_v1")

    for i in range(5):
        db.insert_analysis(
            f"anal_{i:03d}", f"S{i}", "1.0", f"Sample {i}",
            f"S{i}", "Apollo", "whole_rock"
        )
        db.insert_measurement(
            f"m_{i}_la", f"anal_{i:03d}", "La", "element", "ch_La",
            10.0 + i, "ppm"
        )

    svc = SelectionService(db)
    svc.create_selection("sel_001", "snapshot", {}, ["1.0"])

    return temp_env


class TestProjectCreate:
    def test_create_project(self, temp_env):
        """Create project should create directory and manifest."""
        svc = temp_env["svc"]
        project_id = svc.create_project("Test Project")

        assert project_id.startswith("proj_")
        project_dir = temp_env["project_root"] / project_id
        assert project_dir.exists()
        assert (project_dir / "manifest.json").exists()

        info = svc.get_project_info(project_id)
        assert info is not None
        assert info["name"] == "Test Project"
        assert info["schema_version"] == "1.1"


class TestProjectExport:
    def test_export_self_contained(self, populated_env):
        """Export with data should be self-contained."""
        db = populated_env["db"]
        svc = populated_env["svc"]

        project_id = svc.create_project("Export Test")
        with db.connect() as conn:
            conn.execute(
                "INSERT INTO figures (figure_id, project_id, name, chart_type, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
                ("fig_001", project_id, "Test Fig", "scatter", "2024-01-01", "2024-01-01")
            )

        export_path = populated_env["tmpdir"] / "export.geoplot"
        result = svc.export_project(project_id, export_path, include_data=True)

        assert result.self_contained is True
        assert result.byte_size > 0
        assert len(result.sha256) == 64
        assert export_path.exists()

    def test_export_without_data(self, populated_env):
        """Export without data should not be self-contained."""
        svc = populated_env["svc"]
        project_id = svc.create_project("Config Only")

        export_path = populated_env["tmpdir"] / "config.geoplot"
        result = svc.export_project(project_id, export_path, include_data=False)

        assert result.self_contained is False
        assert export_path.exists()


class TestProjectRestore:
    def test_restore_self_contained(self, populated_env):
        """Restore self-contained package should recover all data."""
        db = populated_env["db"]
        svc = populated_env["svc"]

        project_id = svc.create_project("Roundtrip Test")
        with db.connect() as conn:
            conn.execute(
                "INSERT INTO figures (figure_id, project_id, name, chart_type, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
                ("fig_rt", project_id, "RT Fig", "ree", "2024-01-01", "2024-01-01")
            )

        export_path = populated_env["tmpdir"] / "roundtrip.geoplot"
        svc.export_project(project_id, export_path, include_data=True)

        restore_dir = populated_env["tmpdir"] / "restored"
        restored_id = svc.restore_project(export_path, restore_dir)

        assert restored_id == project_id
        assert (restore_dir / project_id / "manifest.json").exists()

    def test_restore_validates_package(self, temp_env):
        """Restore should reject invalid packages."""
        svc = temp_env["svc"]

        with pytest.raises(FileNotFoundError):
            svc.restore_project(Path("nonexistent.geoplot"))

        fake_path = temp_env["tmpdir"] / "fake.geoplot"
        fake_path.write_text("not a zip")
        with pytest.raises(ValueError):
            svc.restore_project(fake_path)


class TestPathTraversal:
    def test_rejects_traversal_in_output(self, populated_env):
        """Export should reject path traversal attempts."""
        svc = populated_env["svc"]
        project_id = svc.create_project("Security Test")

        with pytest.raises(ValueError, match="traversal"):
            svc.export_project(project_id, Path("../escape.geoplot"))


class TestVersionConflict:
    def test_no_conflict_on_matching_revision(self, populated_env):
        """No conflict when expected revision matches current."""
        db = populated_env["db"]
        svc = populated_env["svc"]

        project_id = svc.create_project("Conflict Test")
        with db.connect() as conn:
            conn.execute(
                "INSERT INTO figures (figure_id, project_id, name, chart_type, metadata_revision, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
                ("fig_c", project_id, "CFig", "scatter", 3, "2024-01-01", "2024-01-01")
            )

        assert svc.check_version_conflict(project_id, 3) is True

    def test_conflict_on_mismatched_revision(self, populated_env):
        """Conflict detected when expected revision doesn't match."""
        db = populated_env["db"]
        svc = populated_env["svc"]

        project_id = svc.create_project("Conflict Test 2")
        with db.connect() as conn:
            conn.execute(
                "INSERT INTO figures (figure_id, project_id, name, chart_type, metadata_revision, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
                ("fig_c2", project_id, "CFig2", "scatter", 5, "2024-01-01", "2024-01-01")
            )

        assert svc.check_version_conflict(project_id, 3) is False


class TestRoundtripConsistency:
    def test_analysis_ids_preserved(self, populated_env):
        """Roundtrip should preserve analysis IDs."""
        db = populated_env["db"]
        svc = populated_env["svc"]

        project_id = svc.create_project("Consistency Test")

        export_path = populated_env["tmpdir"] / "consistency.geoplot"
        svc.export_project(project_id, export_path, include_data=True)

        restore_dir = populated_env["tmpdir"] / "restored_consistency"
        restored_id = svc.restore_project(export_path, restore_dir)

        assert restored_id == project_id

        restored_manifest = restore_dir / project_id / "manifest.json"
        assert restored_manifest.exists()
        with open(restored_manifest) as f:
            manifest = json.load(f)
        assert manifest["project_id"] == project_id
