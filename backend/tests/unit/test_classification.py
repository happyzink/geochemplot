"""数据分类单元测试：sample_prefix_v1 / mission_class_v1 规则与查询过滤。"""
from __future__ import annotations

import shutil
import tempfile
from pathlib import Path

import pytest

from app.services.classification import (
    classify_analysis,
    derive_sample_group,
    mission_class,
)
from app.storage.database import Database


class TestSampleGroupRule:
    def test_pure_numeric_code(self):
        assert derive_sample_group("14049") == "14049"

    def test_dashed_sample_takes_leading_token(self):
        assert derive_sample_group("036-004-py-2") == "036"
        assert derive_sample_group("CE6-4-3") == "CE6"
        assert derive_sample_group("EGP03-10-PX-1") == "EGP03"

    def test_underscore_and_space_separators(self):
        assert derive_sample_group("14049 12") == "14049"
        assert derive_sample_group("74235_a") == "74235"

    def test_empty_is_unknown(self):
        assert derive_sample_group("") == "unknown"
        assert derive_sample_group(None) == "unknown"
        assert derive_sample_group("-x") == "unknown"


class TestMissionClassRule:
    def test_field_priority(self):
        assert mission_class("CE5", "whatever") == "CE5"
        assert mission_class("CE6", "whatever") == "CE6"
        assert mission_class("Apollo", "14049") == "Apollo"

    def test_fallback_from_sample_name(self):
        assert mission_class("unknown", "CE6-4-3") == "CE6"
        assert mission_class(None, "CE 5-118") == "CE5"
        assert mission_class("", "ce6-x") == "CE6"

    def test_no_signal_is_unknown(self):
        assert mission_class("unknown", "14049") == "unknown"
        assert mission_class(None, None) == "unknown"

    def test_field_variants_normalized(self):
        assert mission_class("CE 6", "x") == "CE6"


class TestClassifyEvidence:
    def test_evidence_shape(self):
        ev = classify_analysis({"sample_id": "14049", "mission": "unknown"})
        fields = {e["field"]: e for e in ev}
        assert fields["sample_group"]["normalized_value"] == "14049"
        assert fields["sample_group"]["rule_id"] == "sample_prefix_v1"
        assert fields["mission_class"]["normalized_value"] == "unknown"
        assert fields["mission_class"]["confirmed"] is False


@pytest.fixture
def db(tmp_path_factory):
    d = Path(tempfile.mkdtemp(prefix="clsdb_"))
    database = Database(d / "t.db")
    rows = [
        ("a1", "14049", "unknown"),      # Apollo 编号，无任务字段
        ("a2", "036-004-py-2", "CE5"),   # 字段分类 + 前缀 036
        ("a3", "CE6-4-3", "unknown"),    # 名称兜底 CE6 + 前缀 CE6
        ("a4", "74235", "Apollo"),
    ]
    for aid, sid, mission in rows:
        database.insert_analysis(aid, sid, "1.0", sid, None, mission, "whole_rock")
    yield database
    shutil.rmtree(d, ignore_errors=True)


class TestQueryFilters:
    def test_sample_group_filter(self, db):
        got = db.query_analyses(["1.0"], {"sample_group": ["14049", "036"]})
        assert sorted(r["analysis_id"] for r in got) == ["a1", "a2"]
        assert db.count_analyses(["1.0"], {"sample_group": ["14049", "036"]}) == 2

    def test_mission_filter_includes_name_fallback(self, db):
        got = db.query_analyses(["1.0"], {"mission": ["CE6"]})
        assert [r["analysis_id"] for r in got] == ["a3"]
        got = db.query_analyses(["1.0"], {"mission": ["CE5", "CE6"]})
        assert sorted(r["analysis_id"] for r in got) == ["a2", "a3"]

    def test_combined_filters_agree_between_query_and_count(self, db):
        f = {"mission": ["CE5"], "sample_group": ["036"]}
        assert db.count_analyses(["1.0"], f) == len(db.query_analyses(["1.0"], f)) == 1
