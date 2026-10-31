"""API routes for dataset listing and management."""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from ..storage.database import Database

router = APIRouter(prefix="/api/v1", tags=["datasets"])

_db: Optional[Database] = None


def init_dataset_routes(db: Database):
    global _db
    _db = db


class DatasetSummary(BaseModel):
    dataset_id: str
    version: str
    label: str
    role: str
    analysis_count: int
    created_at: str


class DatasetListResponse(BaseModel):
    datasets: list[DatasetSummary]
    total: int


@router.get("/datasets", response_model=DatasetListResponse)
def list_datasets(
    role: Optional[str] = Query(None),
    limit: int = Query(100, ge=1, le=1000),
    offset: int = Query(0, ge=0),
):
    """List all datasets with optional filtering."""
    if _db is None:
        raise HTTPException(500, "Database not initialized")
    
    with _db.connect() as conn:
        # Build query
        conditions = []
        params = []
        
        if role:
            conditions.append("d.role = ?")
            params.append(role)
        
        where_clause = " AND ".join(conditions) if conditions else "1=1"
        
        # Count total
        count_sql = f"SELECT COUNT(*) as total FROM datasets d WHERE {where_clause}"
        total = conn.execute(count_sql, params).fetchone()["total"]
        
        # Get datasets with analysis counts
        sql = f"""
            SELECT d.*, COUNT(a.analysis_id) as analysis_count
            FROM datasets d
            LEFT JOIN analyses a ON a.dataset_version = d.version
            WHERE {where_clause}
            GROUP BY d.dataset_id
            ORDER BY d.created_at DESC
            LIMIT ? OFFSET ?
        """
        params.extend([limit, offset])
        
        rows = conn.execute(sql, params).fetchall()
        
        datasets = [
            DatasetSummary(
                dataset_id=row["dataset_id"],
                version=row["version"],
                label=row["label"],
                role=row["role"],
                analysis_count=row["analysis_count"],
                created_at=row["created_at"],
            )
            for row in rows
        ]
        
        return DatasetListResponse(datasets=datasets, total=total)
