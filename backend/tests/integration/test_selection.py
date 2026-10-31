"""Selection service integration tests."""
from __future__ import annotations

import json
import tempfile
from pathlib import Path

import pytest

from app.services.identity import identify_apollo_sample
from app.services.selections import SelectionService, compute_selection_hash
from app.storage.database import Database


@pytest.fixture
def temp_db():
    """Create a temporary database for testing."""
    with tempfile.TemporaryDirectory() as tmpdir:
        db_path = Path(tmpdir) / "test.db"
        db = Database(db_path)
        yield db


@pytest.fixture
def populated_db(temp_db):
    """Populate database with test data matching Apollo 74235 requirements."""
    db = temp_db
    file_id = db.insert_source_file("test.xlsx", "abc123", 1000)
    db.insert_dataset("ds_test", "1.0", "Test Dataset", "user_data", file_id, "map1")

    apollo_samples = [
        ("74235,62", "74235"),
        ("74235, 41", "74235"),
        ("74235,42", "74235"),
        ("74235, 43", "74235"),
        ("74235,44", "74235"),
        ("74235, 45", "74235"),
        ("74235,46", "74235"),
        ("74235", "74235"),
        ("74235a", "74235"),
        ("74235b", "74235"),
        ("74235c", "74235"),
        ("74235d", "74235"),
        ("74235e", "74235"),
        ("74235f", "74235"),
    ]

    for i, (raw_name, parent) in enumerate(apollo_samples):
        analysis_id = f"anal_{i:03d}"
        db.insert_analysis(
            analysis_id=analysis_id,
            sample_id=raw_name,
            dataset_version="1.0",
            raw_name=raw_name,
            parent_sample=parent,
            mission="Apollo",
            material_type="whole_rock",
            mineral_group="unknown",
        )

    other_samples = [
        ("742350", None),
        ("15426/27", None),
        ("CE6-118-GLASS - 1", "CE6-118"),
    ]
    for i, (raw_name, parent) in enumerate(other_samples):
        analysis_id = f"anal_other_{i:03d}"
        db.insert_analysis(
            analysis_id=analysis_id,
            sample_id=raw_name,
            dataset_version="1.0",
            raw_name=raw_name,
            parent_sample=parent,
            mission="Apollo" if "74" in raw_name else "CE",
            material_type="whole_rock",
        )

    return db


class TestSelectionHash:
    def test_hash_deterministic(self):
        ids = ["a", "b", "c"]
        versions = ["1.0"]
        h1 = compute_selection_hash(ids, versions)
        h2 = compute_selection_hash(ids, versions)
        assert h1 == h2

    def test_hash_order_independent(self):
        ids1 = ["a", "b", "c"]
        ids2 = ["c", "a", "b"]
        versions = ["1.0"]
        assert compute_selection_hash(ids1, versions) == compute_selection_hash(ids2, versions)

    def test_hash_changes_with_ids(self):
        versions = ["1.0"]
        h1 = compute_selection_hash(["a", "b"], versions)
        h2 = compute_selection_hash(["a", "c"], versions)
        assert h1 != h2

    def test_hash_changes_with_versions(self):
        ids = ["a", "b"]
        h1 = compute_selection_hash(ids, ["1.0"])
        h2 = compute_selection_hash(ids, ["2.0"])
        assert h1 != h2


class TestApolloSelection:
    def test_74235_exact_4(self, populated_db):
        """Exact search for 74235 should return 4 records."""
        svc = SelectionService(populated_db)
        record = svc.create_selection(
            name="74235_exact",
            mode="snapshot",
            filter_spec={"sample_search": {"mode": "exact", "text": "74235"}},
            dataset_versions=["1.0"],
        )
        assert record.total_count == 1
        assert record.resolved_ids[0] == "anal_007"

    def test_74235_parent_14(self, populated_db):
        """Parent sample search for 74235 should return 14 records."""
        svc = SelectionService(populated_db)
        record = svc.create_selection(
            name="74235_parent",
            mode="snapshot",
            filter_spec={"sample_search": {"mode": "parent", "text": "74235"}},
            dataset_versions=["1.0"],
        )
        assert record.total_count == 14
        assert len(record.resolved_ids) == 14

    def test_74235_all_whole_rock(self, populated_db):
        """All 74235 parent samples should be whole_rock."""
        results = populated_db.query_analyses(
            ["1.0"],
            {"sample_search": {"mode": "parent", "text": "74235"}},
        )
        for r in results:
            assert r["material_type"] == "whole_rock"

    def test_742350_not_in_parent(self, populated_db):
        """742350 should not be in 74235 parent results."""
        results = populated_db.query_analyses(
            ["1.0"],
            {"sample_search": {"mode": "parent", "text": "74235"}},
        )
        raw_names = [r["raw_name"] for r in results]
        assert "742350" not in raw_names


class TestCrossPageSelection:
    def test_full_resolution_not_paged(self, populated_db):
        """Selection should resolve all IDs, not just current page."""
        svc = SelectionService(populated_db)
        record = svc.create_selection(
            name="all_parent",
            mode="snapshot",
            filter_spec={"sample_search": {"mode": "parent", "text": "74235"}},
            dataset_versions=["1.0"],
            offset=0,
            limit=5,
        )
        assert record.total_count == 14
        assert len(record.resolved_ids) == 14

    def test_remove_analysis_from_selection(self, populated_db):
        """Removing an analysis should update selection."""
        svc = SelectionService(populated_db)
        record = svc.create_selection(
            name="to_modify",
            mode="snapshot",
            filter_spec={"sample_search": {"mode": "parent", "text": "74235"}},
            dataset_versions=["1.0"],
        )
        initial_count = len(record.resolved_ids)
        assert initial_count == 14

        success = svc.remove_analysis_from_selection(record.selection_id, "anal_000")
        assert success

        updated = svc.get_selection(record.selection_id)
        assert len(updated.resolved_ids) == 13
        assert "anal_000" not in updated.resolved_ids
        assert updated.selection_hash != record.selection_hash


class TestSelectionPersistence:
    def test_save_and_retrieve(self, populated_db):
        """Selection should persist and be retrievable."""
        svc = SelectionService(populated_db)
        record = svc.create_selection(
            name="persistent",
            mode="snapshot",
            filter_spec={"mission": ["Apollo"]},
            dataset_versions=["1.0"],
        )

        retrieved = svc.get_selection(record.selection_id)
        assert retrieved is not None
        assert retrieved.name == "persistent"
        assert retrieved.selection_hash == record.selection_hash

    def test_list_selections(self, populated_db):
        """Should list all selections."""
        svc = SelectionService(populated_db)
        svc.create_selection("sel1", "snapshot", {}, ["1.0"])
        svc.create_selection("sel2", "snapshot", {}, ["1.0"])

        all_sels = svc.list_selections()
        assert len(all_sels) >= 2
        names = [s.name for s in all_sels]
        assert "sel1" in names
        assert "sel2" in names
