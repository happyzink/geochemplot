"""Lineage and dedup integration tests."""
from __future__ import annotations

import tempfile
from pathlib import Path

import pytest

from app.services.dedup import DedupService, ImportMapping
from app.storage.database import Database


@pytest.fixture
def temp_db():
    """Create a temporary database for testing."""
    with tempfile.TemporaryDirectory() as tmpdir:
        db_path = Path(tmpdir) / "test.db"
        db = Database(db_path)
        yield db


@pytest.fixture
def dedup_svc(temp_db):
    return DedupService(temp_db)


class TestImportDedup:
    def test_same_file_same_mapping_is_duplicate(self, dedup_svc):
        """Same SHA-256 + same mapping should be idempotent."""
        mapping = ImportMapping(
            mapping_version="1.0",
            column_map={"sample_id": "A", "La": "B"},
            sheet_config={"Sheet1": {"start_row": 1}},
        )

        result1 = dedup_svc.register_import(
            file_sha256="abc123",
            filename="test.xlsx",
            byte_size=1000,
            mapping=mapping,
            dataset_id="ds_001",
            label="Test",
            role="user_data",
        )
        assert not result1.is_duplicate
        assert result1.dataset_version == "1.0"

        result2 = dedup_svc.register_import(
            file_sha256="abc123",
            filename="test.xlsx",
            byte_size=1000,
            mapping=mapping,
            dataset_id="ds_002",
            label="Test",
            role="user_data",
        )
        assert result2.is_duplicate
        assert result2.dataset_version == result1.dataset_version

    def test_same_file_different_mapping_new_version(self, dedup_svc):
        """Same file + different mapping should create new version."""
        mapping1 = ImportMapping(
            mapping_version="1.0",
            column_map={"sample_id": "A", "La": "B"},
            sheet_config={"Sheet1": {"start_row": 1}},
        )
        mapping2 = ImportMapping(
            mapping_version="1.0",
            column_map={"sample_id": "C", "La": "D"},
            sheet_config={"Sheet1": {"start_row": 1}},
        )

        result1 = dedup_svc.register_import(
            file_sha256="abc123",
            filename="test.xlsx",
            byte_size=1000,
            mapping=mapping1,
            dataset_id="ds_001",
            label="Test",
            role="user_data",
        )
        assert result1.dataset_version == "1.0"

        result2 = dedup_svc.register_import(
            file_sha256="abc123",
            filename="test.xlsx",
            byte_size=1000,
            mapping=mapping2,
            dataset_id="ds_002",
            label="Test",
            role="user_data",
        )
        assert not result2.is_duplicate
        assert result2.dataset_version == "1.1"

    def test_different_file_same_mapping_separate_datasets(self, dedup_svc):
        """Different files should create separate datasets even with same mapping."""
        mapping = ImportMapping(
            mapping_version="1.0",
            column_map={"sample_id": "A"},
            sheet_config={},
        )

        result1 = dedup_svc.register_import(
            file_sha256="abc123",
            filename="file1.xlsx",
            byte_size=1000,
            mapping=mapping,
            dataset_id="ds_001",
            label="Test1",
            role="user_data",
        )

        result2 = dedup_svc.register_import(
            file_sha256="def456",
            filename="file2.xlsx",
            byte_size=2000,
            mapping=mapping,
            dataset_id="ds_002",
            label="Test2",
            role="user_data",
        )

        assert result1.dataset_version == "1.0"
        assert result2.dataset_version == "1.0"
        assert result1.dataset_version == result2.dataset_version
        assert not result2.is_duplicate


class TestMappingHash:
    def test_mapping_hash_deterministic(self):
        """Same mapping should produce same hash."""
        m1 = ImportMapping("1.0", {"a": "b"}, {"s": {}})
        m2 = ImportMapping("1.0", {"a": "b"}, {"s": {}})
        assert m1.compute_hash() == m2.compute_hash()

    def test_mapping_hash_order_independent(self):
        """Column map order should not affect hash."""
        m1 = ImportMapping("1.0", {"a": "1", "b": "2"}, {})
        m2 = ImportMapping("1.0", {"b": "2", "a": "1"}, {})
        assert m1.compute_hash() == m2.compute_hash()

    def test_mapping_hash_changes_with_content(self):
        """Different mappings should have different hashes."""
        m1 = ImportMapping("1.0", {"a": "1"}, {})
        m2 = ImportMapping("1.0", {"a": "2"}, {})
        assert m1.compute_hash() != m2.compute_hash()


class TestVersioning:
    def test_version_increments_for_same_file(self, dedup_svc):
        """Multiple different mappings for same file should increment version."""
        file_sha = "constant_hash"

        for i in range(3):
            mapping = ImportMapping(
                mapping_version="1.0",
                column_map={"col": f"variant_{i}"},
                sheet_config={},
            )
            result = dedup_svc.register_import(
                file_sha256=file_sha,
                filename="test.xlsx",
                byte_size=1000,
                mapping=mapping,
                dataset_id=f"ds_{i}",
                label="Test",
                role="user_data",
            )
            assert result.dataset_version == f"1.{i}"

    def test_different_files_independent_versions(self, dedup_svc):
        """Different files should have independent version sequences."""
        mapping = ImportMapping("1.0", {"a": "b"}, {})

        r1 = dedup_svc.register_import(
            "file1_hash", "f1.xlsx", 100, mapping, "ds1", "L1", "user_data"
        )
        r2 = dedup_svc.register_import(
            "file2_hash", "f2.xlsx", 200, mapping, "ds2", "L2", "user_data"
        )

        assert r1.dataset_version == "1.0"
        assert r2.dataset_version == "1.0"
