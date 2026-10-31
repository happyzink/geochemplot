"""GeoPlot error codes and exception handling"""
from __future__ import annotations

from typing import Any, Optional

from fastapi import HTTPException, Request
from fastapi.responses import JSONResponse


class GeoPlotError(Exception):
    """Base exception for GeoPlot errors."""
    def __init__(self, code: str, message: str, field_errors: list[dict] | None = None,
                 details: dict | None = None, request_id: str | None = None):
        self.code = code
        self.message = message
        self.field_errors = field_errors or []
        self.details = details or {}
        self.request_id = request_id
        super().__init__(message)


class UnsupportedFileError(GeoPlotError):
    def __init__(self, message: str = "Unsupported file format", **kwargs):
        super().__init__("UNSUPPORTED_FILE", message, **kwargs)


class MappingRequiredError(GeoPlotError):
    def __init__(self, message: str = "Column mapping required", **kwargs):
        super().__init__("MAPPING_REQUIRED", message, **kwargs)


class UnitUnconfirmedError(GeoPlotError):
    def __init__(self, message: str = "Unit not confirmed for calculation", **kwargs):
        super().__init__("UNIT_UNCONFIRMED", message, **kwargs)


class DuplicateColumnError(GeoPlotError):
    def __init__(self, message: str = "Duplicate column detected", **kwargs):
        super().__init__("DUPLICATE_COLUMN", message, **kwargs)


class NormalizerIncompleteError(GeoPlotError):
    def __init__(self, message: str = "Reference composition incomplete for required elements",
                 missing_elements: list[str] | None = None, **kwargs):
        details = kwargs.pop("details", {})
        if missing_elements:
            details["missing_elements"] = missing_elements
        super().__init__("NORMALIZER_INCOMPLETE", message, details=details, **kwargs)


class ReferenceInvalidError(GeoPlotError):
    def __init__(self, message: str = "Invalid reference value", **kwargs):
        super().__init__("REFERENCE_INVALID", message, **kwargs)


class StaleRevisionError(GeoPlotError):
    def __init__(self, message: str = "Revision mismatch - object was modified", **kwargs):
        super().__init__("STALE_REVISION", message, **kwargs)


class EmptySelectionError(GeoPlotError):
    def __init__(self, message: str = "No analyses selected", **kwargs):
        super().__init__("EMPTY_SELECTION", message, **kwargs)


class NoValidPointsError(GeoPlotError):
    def __init__(self, message: str = "No valid points after quality filtering", **kwargs):
        super().__init__("NO_VALID_POINTS", message, **kwargs)


class ExportFailedError(GeoPlotError):
    def __init__(self, message: str = "Export failed", **kwargs):
        super().__init__("EXPORT_FAILED", message, **kwargs)


class ProjectDataMissingError(GeoPlotError):
    def __init__(self, message: str = "Required project data missing", **kwargs):
        super().__init__("PROJECT_DATA_MISSING", message, **kwargs)


ERROR_CODE_TO_STATUS = {
    "UNSUPPORTED_FILE": 415,
    "MAPPING_REQUIRED": 422,
    "UNIT_UNCONFIRMED": 422,
    "DUPLICATE_COLUMN": 422,
    "NORMALIZER_INCOMPLETE": 422,
    "REFERENCE_INVALID": 422,
    "STALE_REVISION": 409,
    "EMPTY_SELECTION": 422,
    "NO_VALID_POINTS": 422,
    "EXPORT_FAILED": 500,
    "PROJECT_DATA_MISSING": 404,
}


async def geoplot_error_handler(request: Request, exc: GeoPlotError) -> JSONResponse:
    status_code = ERROR_CODE_TO_STATUS.get(exc.code, 500)
    return JSONResponse(
        status_code=status_code,
        content={
            "error": {
                "code": exc.code,
                "message": exc.message,
                "field_errors": exc.field_errors,
                "details": exc.details,
                "request_id": exc.request_id,
            }
        },
    )


async def validation_error_handler(request: Request, exc: Exception) -> JSONResponse:
    from pydantic import ValidationError
    if isinstance(exc, ValidationError):
        field_errors = []
        for err in exc.errors():
            field_errors.append({
                "path": ".".join(str(loc) for loc in err["loc"]),
                "message": err["msg"],
            })
        return JSONResponse(
            status_code=422,
            content={
                "error": {
                    "code": "VALIDATION_ERROR",
                    "message": "Request validation failed",
                    "field_errors": field_errors,
                    "details": None,
                    "request_id": None,
                }
            },
        )
    raise exc
