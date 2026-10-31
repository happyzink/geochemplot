"""API routes for job management."""
from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from ..storage.database import Database

router = APIRouter(prefix="/api/v1", tags=["jobs"])

_db: Optional[Database] = None


def init_job_routes(db: Database):
    global _db
    _db = db


class JobSummary(BaseModel):
    job_id: str
    status: str
    phase: Optional[str]
    processed: int
    total: int
    created_at: str
    updated_at: str


class JobDetail(JobSummary):
    result: Optional[dict] = None
    error: Optional[dict] = None


class JobListResponse(BaseModel):
    jobs: list[JobSummary]
    total: int


@router.get("/jobs", response_model=JobListResponse)
def list_jobs(
    status: Optional[str] = Query(None),
    limit: int = Query(100, ge=1, le=1000),
    offset: int = Query(0, ge=0),
):
    """List all jobs with optional status filter."""
    if _db is None:
        raise HTTPException(500, "Database not initialized")
    
    with _db.connect() as conn:
        conditions = []
        params = []
        
        if status:
            conditions.append("status = ?")
            params.append(status)
        
        where_clause = " AND ".join(conditions) if conditions else "1=1"
        
        # Count
        count_sql = f"SELECT COUNT(*) as total FROM jobs WHERE {where_clause}"
        total = conn.execute(count_sql, params).fetchone()["total"]
        
        # Get jobs
        sql = f"""
            SELECT * FROM jobs
            WHERE {where_clause}
            ORDER BY created_at DESC
            LIMIT ? OFFSET ?
        """
        params.extend([limit, offset])
        
        rows = conn.execute(sql, params).fetchall()
        
        jobs = [
            JobSummary(
                job_id=row["job_id"],
                status=row["status"],
                phase=row["phase"],
                processed=row["processed"],
                total=row["total"],
                created_at=row["created_at"],
                updated_at=row["updated_at"],
            )
            for row in rows
        ]
        
        return JobListResponse(jobs=jobs, total=total)


@router.get("/jobs/{job_id}", response_model=JobDetail)
def get_job(job_id: str):
    """Get job detail."""
    if _db is None:
        raise HTTPException(500, "Database not initialized")
    
    with _db.connect() as conn:
        row = conn.execute(
            "SELECT * FROM jobs WHERE job_id = ?", (job_id,)
        ).fetchone()
        
        if not row:
            raise HTTPException(404, f"Job {job_id} not found")
        
        result = json.loads(row["result_json"]) if row["result_json"] else None
        error = json.loads(row["error_json"]) if row["error_json"] else None
        
        return JobDetail(
            job_id=row["job_id"],
            status=row["status"],
            phase=row["phase"],
            processed=row["processed"],
            total=row["total"],
            result=result,
            error=error,
            created_at=row["created_at"],
            updated_at=row["updated_at"],
        )


@router.post("/jobs/{job_id}/cancel")
def cancel_job(job_id: str):
    """Cancel a queued or running job."""
    if _db is None:
        raise HTTPException(500, "Database not initialized")
    
    with _db.connect() as conn:
        row = conn.execute(
            "SELECT status FROM jobs WHERE job_id = ?", (job_id,)
        ).fetchone()
        
        if not row:
            raise HTTPException(404, f"Job {job_id} not found")
        
        if row["status"] not in ["queued", "running"]:
            raise HTTPException(400, f"Cannot cancel job in {row['status']} state")
        
        now = datetime.now(timezone.utc).isoformat()
        conn.execute(
            "UPDATE jobs SET status = 'cancelled', updated_at = ? WHERE job_id = ?",
            (now, job_id)
        )
        
        return {"job_id": job_id, "status": "cancelled"}


@router.delete("/jobs/{job_id}")
def delete_job(job_id: str):
    """Delete a job record."""
    if _db is None:
        raise HTTPException(500, "Database not initialized")
    
    with _db.connect() as conn:
        row = conn.execute(
            "SELECT status FROM jobs WHERE job_id = ?", (job_id,)
        ).fetchone()
        
        if not row:
            raise HTTPException(404, f"Job {job_id} not found")
        
        if row["status"] == "running":
            raise HTTPException(400, "Cannot delete running job")
        
        conn.execute("DELETE FROM jobs WHERE job_id = ?", (job_id,))
        
        return {"job_id": job_id, "deleted": True}
