"""SQLite storage layer for GeoPlot.

Versioned data storage with migration support.
"""
from __future__ import annotations

import hashlib
import json
import sqlite3
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional


class Database:
    def __init__(self, db_path: Path | str):
        self.db_path = str(db_path)
        self._init_db()

    def _init_db(self):
        with self.connect() as conn:
            conn.executescript(SCHEMA_SQL)

    @contextmanager
    def connect(self):
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA foreign_keys=ON")
        # 分类派生函数（services.classification）注册为 SQL 函数，供筛选/分面使用
        from ..services.classification import derive_sample_group, mission_class
        conn.create_function("sample_group", 1, lambda s: derive_sample_group(s),
                             deterministic=True)
        conn.create_function("mission_class", 2,
                             lambda mission, sample: mission_class(mission, sample),
                             deterministic=True)
        try:
            yield conn
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

    def insert_source_file(self, filename: str, sha256: str, byte_size: int) -> str:
        file_id = f"sf_{uuid.uuid4().hex[:12]}"
        with self.connect() as conn:
            conn.execute(
                "INSERT INTO source_files (file_id, filename, sha256, byte_size, imported_at) VALUES (?, ?, ?, ?, ?)",
                (file_id, filename, sha256, byte_size, datetime.now(timezone.utc).isoformat()),
            )
        return file_id

    def insert_dataset(self, dataset_id: str, version: str, label: str, role: str,
                       file_id: str, mapping_version: str) -> str:
        with self.connect() as conn:
            conn.execute(
                "INSERT INTO datasets (dataset_id, version, label, role, file_id, mapping_version, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
                (dataset_id, version, label, role, file_id, mapping_version, datetime.now(timezone.utc).isoformat()),
            )
        return dataset_id

    def insert_analysis(self, analysis_id: str, sample_id: str, dataset_version: str,
                        raw_name: str, parent_sample: Optional[str],
                        mission: str, material_type: str,
                        mineral_group: str = "unknown",
                        phase: str = "unknown",
                        rock_type: str = "unknown",
                        citation: str = "",
                        sheet_name: str = "", row_number: int = 0) -> str:
        with self.connect() as conn:
            conn.execute(
                """INSERT INTO analyses (analysis_id, sample_id, dataset_version, raw_name,
                   parent_sample, mission, material_type, mineral_group, phase, rock_type,
                   citation, sheet_name, row_number, created_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (analysis_id, sample_id, dataset_version, raw_name, parent_sample,
                 mission, material_type, mineral_group, phase, rock_type,
                 citation, sheet_name, row_number, datetime.now(timezone.utc).isoformat()),
            )
        return analysis_id

    def insert_measurement(self, measurement_id: str, analysis_id: str,
                           analyte: str, chemical_form: str, channel: str,
                           value: Optional[float], unit: str,
                           value_state: str = "raw_concentration") -> str:
        with self.connect() as conn:
            conn.execute(
                """INSERT INTO measurements (measurement_id, analysis_id, analyte,
                   chemical_form, channel, value, unit, value_state)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                (measurement_id, analysis_id, analyte, chemical_form, channel,
                 value, unit, value_state),
            )
        return measurement_id

    def _filter_conditions(self, dataset_versions: list[str], filter_spec: dict) -> tuple[list[str], list]:
        """query/count 共用的筛选条件构造。

        mission 匹配有效任务分类 mission_class(mission, sample_id)（字段优先、样品名兜底）；
        sample_group 匹配样品名称前段标号 sample_group(sample_id)（分类规则见 services.classification）。
        """
        conditions = ["a.dataset_version IN ({})".format(",".join("?" * len(dataset_versions)))]
        params: list = list(dataset_versions)

        if filter_spec.get("mission"):
            conditions.append("mission_class(a.mission, a.sample_id) IN ({})".format(
                ",".join("?" * len(filter_spec["mission"]))))
            params.extend(filter_spec["mission"])
        if filter_spec.get("sample_group"):
            conditions.append("sample_group(a.sample_id) IN ({})".format(
                ",".join("?" * len(filter_spec["sample_group"]))))
            params.extend(filter_spec["sample_group"])
        if filter_spec.get("material_type"):
            conditions.append("a.material_type IN ({})".format(",".join("?" * len(filter_spec["material_type"]))))
            params.extend(filter_spec["material_type"])
        if filter_spec.get("mineral_group"):
            conditions.append("a.mineral_group IN ({})".format(",".join("?" * len(filter_spec["mineral_group"]))))
            params.extend(filter_spec["mineral_group"])
        if filter_spec.get("sample_search"):
            mode = filter_spec["sample_search"].get("mode", "exact")
            text = filter_spec["sample_search"].get("text", "")
            if mode == "exact":
                conditions.append("a.raw_name = ?")
                params.append(text)
            elif mode == "parent":
                conditions.append("a.parent_sample = ?")
                params.append(text)
            elif mode == "contains":
                conditions.append("a.raw_name LIKE ?")
                params.append(f"%{text}%")
        return conditions, params

    def query_analyses(self, dataset_versions: list[str], filter_spec: dict,
                       offset: int = 0, limit: int = 100) -> list[dict]:
        conditions, params = self._filter_conditions(dataset_versions, filter_spec)
        where = " AND ".join(conditions)
        sql = f"""SELECT a.* FROM analyses a WHERE {where}
                  ORDER BY a.analysis_id LIMIT ? OFFSET ?"""
        params.extend([limit, offset])

        with self.connect() as conn:
            rows = conn.execute(sql, params).fetchall()
            return [dict(r) for r in rows]

    def count_analyses(self, dataset_versions: list[str], filter_spec: dict) -> int:
        conditions, params = self._filter_conditions(dataset_versions, filter_spec)
        where = " AND ".join(conditions)
        sql = f"SELECT COUNT(*) FROM analyses a WHERE {where}"

        with self.connect() as conn:
            return conn.execute(sql, params).fetchone()[0]

    def facet_counts(self, dataset_versions: list[str], filter_spec: dict) -> dict:
        """SQL 一次聚合计数四个分类维度（比全表取回 Python 循环快一个量级）。

        返回 {missions: {k: n}, sample_groups: {...}, material_types: {...}, mineral_groups: {...}, total: int}
        """
        conditions, params = self._filter_conditions(dataset_versions, filter_spec)
        where = " AND ".join(conditions)
        sql = f"""SELECT mission_class(a.mission, a.sample_id) AS m,
                         sample_group(a.sample_id) AS g,
                         a.material_type AS mt, a.mineral_group AS mg,
                         COUNT(*) AS n
                  FROM analyses a WHERE {where}
                  GROUP BY m, g, mt, mg"""
        result = {"missions": {}, "sample_groups": {},
                  "material_types": {}, "mineral_groups": {}, "total": 0}
        with self.connect() as conn:
            for row in conn.execute(sql, params).fetchall():
                n = row["n"]
                result["total"] += n
                for key, value in (("missions", row["m"]), ("sample_groups", row["g"]),
                                   ("material_types", row["mt"]), ("mineral_groups", row["mg"])):
                    bucket = result[key]
                    bucket[value if value is not None else "unknown"] = \
                        bucket.get(value if value is not None else "unknown", 0) + n
        return result

    def get_analysis(self, analysis_id: str) -> Optional[dict]:
        with self.connect() as conn:
            row = conn.execute("SELECT * FROM analyses WHERE analysis_id = ?", (analysis_id,)).fetchone()
            return dict(row) if row else None

    def get_measurements(self, analysis_id: str) -> list[dict]:
        with self.connect() as conn:
            rows = conn.execute("SELECT * FROM measurements WHERE analysis_id = ?", (analysis_id,)).fetchall()
            return [dict(r) for r in rows]

    def insert_selection(self, selection_id: str, name: str, mode: str,
                         resolved_ids: list[str], selection_hash: str,
                         dataset_versions: list[dict]) -> str:
        with self.connect() as conn:
            conn.execute(
                """INSERT INTO selections (selection_id, name, mode, resolved_ids,
                   selection_hash, dataset_versions, created_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?)""",
                (selection_id, name, mode, json.dumps(resolved_ids),
                 selection_hash, json.dumps(dataset_versions),
                 datetime.now(timezone.utc).isoformat()),
            )
        return selection_id

    def insert_figure(self, figure_id: str, project_id: str, name: str,
                      chart_type: str, spec_json: str) -> str:
        with self.connect() as conn:
            conn.execute(
                """INSERT INTO figures (figure_id, project_id, name, chart_type,
                   metadata_revision, created_at, updated_at)
                   VALUES (?, ?, ?, ?, 1, ?, ?)""",
                (figure_id, project_id, name, chart_type,
                 datetime.now(timezone.utc).isoformat(), datetime.now(timezone.utc).isoformat()),
            )
        return figure_id

    def insert_export_record(self, export_id: str, figure_id: str, revision_id: str,
                             scene_id: str, scene_hash: str, export_seq: int,
                             formats: list[str], state: str, export_root_id: str,
                             relative_dir: str) -> str:
        with self.connect() as conn:
            conn.execute(
                """INSERT INTO export_records (export_id, figure_id, revision_id,
                   scene_id, scene_hash, export_seq, formats, state, export_root_id,
                   relative_dir, created_at, updated_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (export_id, figure_id, revision_id, scene_id, scene_hash, export_seq,
                 json.dumps(formats), state, export_root_id, relative_dir,
                 datetime.now(timezone.utc).isoformat(), datetime.now(timezone.utc).isoformat()),
            )
        return export_id

    def insert_reference_value(self, ref_id: str, version: str, analyte: str,
                               value: float, unit: str = "ppm") -> None:
        with self.connect() as conn:
            conn.execute(
                """INSERT OR REPLACE INTO reference_values (ref_id, version, analyte, value, unit)
                   VALUES (?, ?, ?, ?, ?)""",
                (ref_id, version, analyte, value, unit),
            )


SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS source_files (
    file_id TEXT PRIMARY KEY,
    filename TEXT NOT NULL,
    sha256 TEXT NOT NULL,
    byte_size INTEGER NOT NULL,
    imported_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS datasets (
    dataset_id TEXT PRIMARY KEY,
    version TEXT NOT NULL,
    label TEXT NOT NULL,
    role TEXT NOT NULL,
    file_id TEXT REFERENCES source_files(file_id),
    mapping_version TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS analyses (
    analysis_id TEXT PRIMARY KEY,
    sample_id TEXT,
    dataset_version TEXT NOT NULL,
    raw_name TEXT,
    parent_sample TEXT,
    mission TEXT DEFAULT 'unknown',
    material_type TEXT DEFAULT 'unknown',
    mineral_group TEXT DEFAULT 'unknown',
    phase TEXT DEFAULT 'unknown',
    rock_type TEXT DEFAULT 'unknown',
    citation TEXT DEFAULT '',
    sheet_name TEXT DEFAULT '',
    row_number INTEGER DEFAULT 0,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_analyses_mission ON analyses(mission);
CREATE INDEX IF NOT EXISTS idx_analyses_material ON analyses(material_type);
CREATE INDEX IF NOT EXISTS idx_analyses_mineral ON analyses(mineral_group);
CREATE INDEX IF NOT EXISTS idx_analyses_parent ON analyses(parent_sample);
CREATE INDEX IF NOT EXISTS idx_analyses_raw_name ON analyses(raw_name);
CREATE INDEX IF NOT EXISTS idx_analyses_dataset ON analyses(dataset_version);

CREATE TABLE IF NOT EXISTS measurements (
    measurement_id TEXT PRIMARY KEY,
    analysis_id TEXT REFERENCES analyses(analysis_id),
    analyte TEXT NOT NULL,
    chemical_form TEXT NOT NULL,
    channel TEXT DEFAULT '',
    value REAL,
    unit TEXT NOT NULL,
    value_state TEXT DEFAULT 'raw_concentration'
);

CREATE INDEX IF NOT EXISTS idx_measurements_analysis ON measurements(analysis_id);
CREATE INDEX IF NOT EXISTS idx_measurements_analyte ON measurements(analyte);

CREATE TABLE IF NOT EXISTS selections (
    selection_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    mode TEXT NOT NULL DEFAULT 'snapshot',
    resolved_ids TEXT NOT NULL,
    selection_hash TEXT NOT NULL,
    dataset_versions TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS figures (
    figure_id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    name TEXT NOT NULL,
    chart_type TEXT NOT NULL,
    metadata_revision INTEGER DEFAULT 1,
    current_revision_id TEXT,
    archived INTEGER DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS figure_revisions (
    revision_id TEXT PRIMARY KEY,
    figure_id TEXT REFERENCES figures(figure_id),
    revision_number INTEGER NOT NULL,
    spec_json TEXT NOT NULL,
    scene_id TEXT,
    content_hash TEXT,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS export_records (
    export_id TEXT PRIMARY KEY,
    figure_id TEXT REFERENCES figures(figure_id),
    revision_id TEXT,
    scene_id TEXT,
    scene_hash TEXT,
    export_seq INTEGER NOT NULL,
    formats TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'queued',
    export_root_id TEXT,
    relative_dir TEXT,
    error_json TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS export_roots (
    export_root_id TEXT PRIMARY KEY,
    absolute_path TEXT NOT NULL,
    display_name TEXT,
    selected_by_user_at TEXT NOT NULL,
    writable_check INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS jobs (
    job_id TEXT PRIMARY KEY,
    status TEXT NOT NULL DEFAULT 'queued',
    phase TEXT,
    processed INTEGER DEFAULT 0,
    total INTEGER DEFAULT 0,
    result_json TEXT,
    error_json TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS reference_values (
    ref_id TEXT NOT NULL,
    version TEXT NOT NULL,
    analyte TEXT NOT NULL,
    value REAL NOT NULL,
    unit TEXT NOT NULL DEFAULT 'ppm',
    PRIMARY KEY (ref_id, version, analyte)
);

CREATE INDEX IF NOT EXISTS idx_reference_values_ref ON reference_values(ref_id, version);
CREATE INDEX IF NOT EXISTS idx_reference_values_analyte ON reference_values(analyte);
"""
