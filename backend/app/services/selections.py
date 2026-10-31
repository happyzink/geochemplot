"""Selection service for stable cross-page sample selection."""
from __future__ import annotations

import hashlib
import json
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Optional

from ..storage.database import Database


@dataclass
class SelectionRecord:
    selection_id: str
    name: str
    mode: str  # snapshot | dynamic
    resolved_ids: list[str]
    selection_hash: str
    dataset_versions: list[str]
    created_at: str
    filter_spec: dict = field(default_factory=dict)
    total_count: int = 0


def compute_selection_hash(resolved_ids: list[str], dataset_versions: list[str]) -> str:
    """Compute stable hash from sorted resolved_ids and dataset_versions."""
    canonical = json.dumps({
        "resolved_ids": sorted(resolved_ids),
        "dataset_versions": sorted(dataset_versions),
    }, sort_keys=True)
    return hashlib.sha256(canonical.encode()).hexdigest()


class SelectionService:
    def __init__(self, db: Database):
        self.db = db

    def create_selection(self, name: str, mode: str, filter_spec: dict,
                         dataset_versions: list[str],
                         analysis_ids: Optional[list[str]] = None,
                         offset: int = 0, limit: int = 100) -> SelectionRecord:
        """Create a selection by resolving filter to analysis IDs.

        analysis_ids 优先：显式勾选的快照列表，不做 filter 重解析。
        mode='snapshot': freeze current results
        mode='dynamic': re-resolve on each query (not yet implemented)
        """
        if analysis_ids is not None:
            resolved_ids = list(analysis_ids)
            total_count = len(resolved_ids)
        else:
            resolved = self.db.query_analyses(dataset_versions, filter_spec, offset=0, limit=100000)
            resolved_ids = [r["analysis_id"] for r in resolved]
            total_count = len(resolved_ids)

        if mode == "snapshot" and limit < total_count and analysis_ids is None:
            resolved_ids_page = resolved_ids[offset:offset + limit]
        else:
            resolved_ids_page = resolved_ids

        sel_hash = compute_selection_hash(resolved_ids, dataset_versions)
        selection_id = f"sel_{uuid.uuid4().hex[:12]}"

        self.db.insert_selection(
            selection_id=selection_id,
            name=name,
            mode=mode,
            resolved_ids=resolved_ids,
            selection_hash=sel_hash,
            dataset_versions=[{"version": v} for v in dataset_versions],
        )

        return SelectionRecord(
            selection_id=selection_id,
            name=name,
            mode=mode,
            resolved_ids=resolved_ids,
            selection_hash=sel_hash,
            dataset_versions=dataset_versions,
            created_at=datetime.now(timezone.utc).isoformat(),
            filter_spec=filter_spec,
            total_count=total_count,
        )

    def get_selection(self, selection_id: str) -> Optional[SelectionRecord]:
        """Retrieve a selection by ID."""
        with self.db.connect() as conn:
            row = conn.execute(
                "SELECT * FROM selections WHERE selection_id = ?",
                (selection_id,)
            ).fetchone()
            if not row:
                return None
            row_dict = dict(row)
            return SelectionRecord(
                selection_id=row_dict["selection_id"],
                name=row_dict["name"],
                mode=row_dict["mode"],
                resolved_ids=json.loads(row_dict["resolved_ids"]),
                selection_hash=row_dict["selection_hash"],
                dataset_versions=[d["version"] for d in json.loads(row_dict["dataset_versions"])],
                created_at=row_dict["created_at"],
            )

    def remove_analysis_from_selection(self, selection_id: str, analysis_id: str) -> bool:
        """Remove a single analysis_id from a snapshot selection."""
        sel = self.get_selection(selection_id)
        if not sel or sel.mode != "snapshot":
            return False
        if analysis_id not in sel.resolved_ids:
            return False

        new_ids = [aid for aid in sel.resolved_ids if aid != analysis_id]
        new_hash = compute_selection_hash(new_ids, sel.dataset_versions)

        with self.db.connect() as conn:
            conn.execute(
                """UPDATE selections SET resolved_ids = ?, selection_hash = ?
                   WHERE selection_id = ?""",
                (json.dumps(new_ids), new_hash, selection_id)
            )
        return True

    def list_selections(self) -> list[SelectionRecord]:
        """List all selections."""
        with self.db.connect() as conn:
            rows = conn.execute("SELECT * FROM selections ORDER BY created_at DESC").fetchall()
            results = []
            for row in rows:
                row_dict = dict(row)
                results.append(SelectionRecord(
                    selection_id=row_dict["selection_id"],
                    name=row_dict["name"],
                    mode=row_dict["mode"],
                    resolved_ids=json.loads(row_dict["resolved_ids"]),
                    selection_hash=row_dict["selection_hash"],
                    dataset_versions=[d["version"] for d in json.loads(row_dict["dataset_versions"])],
                    created_at=row_dict["created_at"],
                ))
            return results
