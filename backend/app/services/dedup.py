"""Deduplication service for idempotent re-import."""
from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from typing import Optional


@dataclass
class ImportMapping:
    """Represents a column mapping configuration."""
    mapping_version: str
    column_map: dict  # {target_field: source_column}
    sheet_config: dict  # {sheet_name: {start_row, header_row, ...}}

    def compute_hash(self) -> str:
        """Compute stable hash of this mapping."""
        canonical = json.dumps({
            "column_map": self.column_map,
            "sheet_config": self.sheet_config,
        }, sort_keys=True, default=str)
        return hashlib.sha256(canonical.encode()).hexdigest()[:16]


@dataclass
class ImportResult:
    """Result of an import operation."""
    dataset_version: str
    file_sha256: str
    mapping_hash: str
    analysis_count: int = 0
    is_duplicate: bool = False
    message: str = ""


class DedupService:
    """Handles import deduplication and versioning."""

    def __init__(self, db):
        self.db = db

    def check_import_duplicate(self, file_sha256: str, mapping: ImportMapping) -> Optional[str]:
        """Check if this file+mapping combo already exists.

        Returns existing dataset_version if duplicate, None otherwise.
        """
        mapping_hash = mapping.compute_hash()
        with self.db.connect() as conn:
            row = conn.execute(
                """SELECT d.version FROM datasets d
                   JOIN source_files sf ON d.file_id = sf.file_id
                   WHERE sf.sha256 = ? AND d.mapping_version = ?
                   LIMIT 1""",
                (file_sha256, mapping_hash)
            ).fetchone()
            return row["version"] if row else None

    def register_import(self, file_sha256: str, filename: str, byte_size: int,
                        mapping: ImportMapping, dataset_id: str,
                        label: str, role: str) -> ImportResult:
        """Register a new import, checking for duplicates first.

        If same file + same mapping exists, returns duplicate result.
        If same file + different mapping, creates new version.
        If new file, creates new dataset.
        """
        mapping_hash = mapping.compute_hash()
        existing_version = self.check_import_duplicate(file_sha256, mapping)

        if existing_version:
            return ImportResult(
                dataset_version=existing_version,
                file_sha256=file_sha256,
                mapping_hash=mapping_hash,
                analysis_count=0,
                is_duplicate=True,
                message=f"Import already exists as version {existing_version}",
            )

        existing_file = self._get_file_by_sha256(file_sha256)
        if existing_file:
            file_id = existing_file["file_id"]
            version = self._next_version_for_file(file_id)
        else:
            file_id = self.db.insert_source_file(filename, file_sha256, byte_size)
            version = "1.0"

        self.db.insert_dataset(
            dataset_id=dataset_id,
            version=version,
            label=label,
            role=role,
            file_id=file_id,
            mapping_version=mapping_hash,
        )

        return ImportResult(
            dataset_version=version,
            file_sha256=file_sha256,
            mapping_hash=mapping_hash,
            analysis_count=0,
            is_duplicate=False,
            message=f"New dataset version {version} created",
        )

    def _get_file_by_sha256(self, sha256: str) -> Optional[dict]:
        with self.db.connect() as conn:
            row = conn.execute(
                "SELECT * FROM source_files WHERE sha256 = ?", (sha256,)
            ).fetchone()
            return dict(row) if row else None

    def _next_version_for_file(self, file_id: str) -> str:
        with self.db.connect() as conn:
            row = conn.execute(
                "SELECT MAX(version) as max_v FROM datasets WHERE file_id = ?",
                (file_id,)
            ).fetchone()
            if row and row["max_v"]:
                parts = row["max_v"].split(".")
                if len(parts) == 2:
                    major, minor = int(parts[0]), int(parts[1])
                    return f"{major}.{minor + 1}"
            return "1.0"
