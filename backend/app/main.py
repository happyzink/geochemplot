"""GeoPlot FastAPI application"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .api.routes_catalog import init_catalog_routes
from .api.routes_data import init_routes
from .api.routes_directory import router as directory_router
from .api.routes_datasets import init_dataset_routes, router as datasets_router
from .api.routes_exports import init_export_routes
from .api.routes_figures import init_figure_routes
from .api.routes_imports import init_import_routes
from .api.routes_jobs import init_job_routes, router as jobs_router
from .api.routes_plots import init_plot_routes
from .api.routes_projects import init_project_routes
from .domain.errors import GeoPlotError, geoplot_error_handler, validation_error_handler
from .domain.records import HealthResponse
from .storage.database import Database

APP_VERSION = "1.0.0"
SCHEMA_VERSION = "1.2"

app = FastAPI(
    title="GeoPlot API",
    version=APP_VERSION,
    docs_url="/api/docs",
    openapi_url="/api/openapi.json",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://127.0.0.1:*", "http://localhost:*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.add_exception_handler(GeoPlotError, geoplot_error_handler)
app.add_exception_handler(Exception, validation_error_handler)

from .api.routes_data import router as data_router
app.include_router(data_router)

from .api.routes_plots import router as plot_router
app.include_router(plot_router)

from .api.routes_projects import router as project_router
app.include_router(project_router)

from .api.routes_catalog import router as catalog_router
app.include_router(catalog_router)

from .api.routes_imports import router as import_router
app.include_router(import_router)

from .api.routes_figures import router as figure_router
app.include_router(figure_router)

from .api.routes_exports import router as export_router
app.include_router(export_router)

START_TIME = datetime.now(timezone.utc)
APP_ID = "geoplot-server"
INSTANCE_ID = uuid.uuid4().hex[:16]


@app.get("/health", response_model=HealthResponse)
async def health():
    return HealthResponse(
        status="ok",
        app_version=APP_VERSION,
        schema_version=SCHEMA_VERSION,
    )


@app.get("/api/v1/health", response_model=HealthResponse)
async def health_v1():
    return HealthResponse(
        status="ok",
        app_version=APP_VERSION,
        schema_version=SCHEMA_VERSION,
    )


@app.get("/api/v1/runtime/status")
async def runtime_status():
    import os
    from .domain.enums import RuntimeState
    from .domain.records import RuntimeStatus
    return RuntimeStatus(
        app_id=APP_ID,
        app_version=APP_VERSION,
        profile_id="default",
        instance_id=INSTANCE_ID,
        pid=os.getpid(),
        process_started_at=START_TIME,
        state=RuntimeState.RUNNING,
        base_url="http://127.0.0.1:8765",
        active_jobs=[],
    )


_db: Optional[Database] = None


def get_database() -> Database:
    global _db
    if _db is None:
        db_path = Path("data/geoplot.db")
        db_path.parent.mkdir(parents=True, exist_ok=True)
        _db = Database(db_path)
        init_routes(_db)
        init_plot_routes(_db)
        init_project_routes(_db)
        init_catalog_routes()
        init_import_routes(_db)
        init_figure_routes(_db)
        init_dataset_routes(_db)
        init_job_routes(_db)
        init_export_routes(_db)
        # Include routers（exports_router 已在模块级挂载，避免重复 operationId）
        app.include_router(directory_router)
        app.include_router(datasets_router)
        app.include_router(jobs_router)
    return _db


@app.on_event("startup")
async def startup_event():
    db = get_database()
    # Populate reference_values table from catalog
    from .services.catalog import build_catalog
    catalog = build_catalog()
    for ref_id, ref in catalog.references.items():
        for analyte, value in ref.elements.items():
            unit = ref.units.get(analyte, "ppm")
            db.insert_reference_value(ref_id, ref.version, analyte, value, unit)
