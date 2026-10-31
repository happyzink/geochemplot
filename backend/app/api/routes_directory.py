"""API routes for directory operations."""
from __future__ import annotations

import os
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter(prefix="/api/v1/directory", tags=["directory"])


class ChooseDirectoryRequest(BaseModel):
    path: str


class ChooseDirectoryResponse(BaseModel):
    path: str
    exists: bool
    writable: bool


class OpenFolderRequest(BaseModel):
    path: str


class OpenFolderResponse(BaseModel):
    path: str
    success: bool
    message: str = ""


class ReexportRequest(BaseModel):
    source_path: str
    target_path: str


class ReexportResponse(BaseModel):
    source_path: str
    target_path: str
    success: bool
    message: str = ""


@router.post("/choose", response_model=ChooseDirectoryResponse)
def choose_directory(req: ChooseDirectoryRequest):
    """Validate and choose a directory path."""
    path = Path(req.path).resolve()
    
    exists = path.exists()
    writable = False
    
    if exists:
        if path.is_dir():
            # Test writability
            test_file = path / ".geoplot_write_test"
            try:
                test_file.touch()
                test_file.unlink()
                writable = True
            except Exception:
                writable = False
        else:
            raise HTTPException(400, f"Path is not a directory: {path}")
    
    return ChooseDirectoryResponse(
        path=str(path),
        exists=exists,
        writable=writable,
    )


@router.post("/open-folder", response_model=OpenFolderResponse)
def open_folder(req: OpenFolderRequest):
    """Open a folder in system file manager."""
    path = Path(req.path).resolve()
    
    if not path.exists():
        return OpenFolderResponse(
            path=str(path),
            success=False,
            message=f"Path does not exist: {path}",
        )
    
    if not path.is_dir():
        return OpenFolderResponse(
            path=str(path),
            success=False,
            message=f"Path is not a directory: {path}",
        )
    
    # Open in system file manager
    try:
        import subprocess
        import sys
        
        if sys.platform == "win32":
            os.startfile(str(path))
        elif sys.platform == "darwin":
            subprocess.run(["open", str(path)], check=True)
        else:
            subprocess.run(["xdg-open", str(path)], check=True)
        
        return OpenFolderResponse(
            path=str(path),
            success=True,
            message="Folder opened",
        )
    except Exception as e:
        return OpenFolderResponse(
            path=str(path),
            success=False,
            message=f"Failed to open folder: {e}",
        )


@router.post("/reexport", response_model=ReexportResponse)
def reexport(req: ReexportRequest):
    """Re-export files from source to target directory."""
    source = Path(req.source_path).resolve()
    target = Path(req.target_path).resolve()
    
    if not source.exists():
        return ReexportResponse(
            source_path=str(source),
            target_path=str(target),
            success=False,
            message=f"Source does not exist: {source}",
        )
    
    if not target.exists():
        try:
            target.mkdir(parents=True, exist_ok=True)
        except Exception as e:
            return ReexportResponse(
                source_path=str(source),
                target_path=str(target),
                success=False,
                message=f"Failed to create target directory: {e}",
            )
    
    # Copy files
    try:
        import shutil
        
        if source.is_file():
            shutil.copy2(source, target / source.name)
        else:
            # Copy directory contents
            for item in source.iterdir():
                dest = target / item.name
                if item.is_file():
                    shutil.copy2(item, dest)
                else:
                    shutil.copytree(item, dest, dirs_exist_ok=True)
        
        return ReexportResponse(
            source_path=str(source),
            target_path=str(target),
            success=True,
            message="Re-export completed",
        )
    except Exception as e:
        return ReexportResponse(
            source_path=str(source),
            target_path=str(target),
            success=False,
            message=f"Re-export failed: {e}",
        )
