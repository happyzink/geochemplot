"""数据分类：样品标号组（sample_group）与任务分类（mission_class）。

分类规则（rule_id: sample_prefix_v1 / mission_class_v1）：
- sample_group：样品名称前段标号。取首个分隔符（- _ / . 空格）之前的字母数字段：
  14049 → 14049；036-004-py-2 → 036；CE6-4-3 → CE6；EGP03-10-PX-1 → EGP03。
- mission_class：数据自带分类优先（任务(CE5/CE6) 列 → mission 字段）；
  mission 缺失/unknown 时从样品名兜底识别 CE5/CE6（如 "CE6-4-3" → CE6）。

分类为派生数据，不落库、不改 Schema；查询/分面/API 层统一走本模块。
"""
from __future__ import annotations

import re

SAMPLE_GROUP_RE = re.compile(r"^([A-Za-z0-9]+)")
MISSION_IN_NAME_RE = re.compile(r"CE[\s_\-]*([56])\b", re.IGNORECASE)

KNOWN_MISSIONS = ("CE5", "CE6", "Apollo")


def derive_sample_group(sample_id: str | None) -> str:
    """样品名称前段标号（sample_prefix_v1）。空/无字母数字 → unknown。"""
    if not sample_id:
        return "unknown"
    m = SAMPLE_GROUP_RE.match(str(sample_id).strip())
    return m.group(1) if m else "unknown"


def mission_class(mission: str | None, sample_id: str | None) -> str:
    """有效任务分类（mission_class_v1）：mission 字段优先，样品名兜底 CE5/CE6。"""
    if mission:
        value = str(mission).strip()
        if value and value.lower() != "unknown":
            # 归一 "CE 5"/"ce5" 等写法
            m = MISSION_IN_NAME_RE.search(value)
            if m:
                return f"CE{m.group(1)}"
            return value
    if sample_id:
        m = MISSION_IN_NAME_RE.search(str(sample_id))
        if m:
            return f"CE{m.group(1)}"
    return "unknown"


def classify_analysis(record: dict) -> list[dict]:
    """返回 classification_evidence（前端 AnalysisDetail 合同形态）。"""
    sample_id = record.get("sample_id") or record.get("raw_name") or ""
    mission = record.get("mission")
    group = derive_sample_group(sample_id)
    mclass = mission_class(mission, sample_id)

    evidence = [
        {
            "field": "sample_group",
            "raw_value": str(sample_id),
            "normalized_value": group,
            "rule_id": "sample_prefix_v1",
            "evidence_cells": ["sample_id"],
            "confidence": 1.0 if group != "unknown" else 0.0,
            "confirmed": True,
        },
        {
            "field": "mission_class",
            "raw_value": str(mission or ""),
            "normalized_value": mclass,
            "rule_id": "mission_class_v1",
            "evidence_cells": ["mission", "sample_id"],
            "confidence": 1.0 if (mission and str(mission).strip().lower() != "unknown") else (
                0.8 if mclass != "unknown" else 0.0),
            "confirmed": mclass != "unknown",
        },
    ]
    return evidence
