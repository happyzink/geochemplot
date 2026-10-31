# GeoPlot Installation Script
# Sets up Python virtual environment and installs dependencies

param(
    [string]$PythonPath = "python",
    [switch]$SkipVenv
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RootDir = Split-Path -Parent $ScriptDir
$BackendDir = Join-Path $RootDir "backend"
$VenvDir = Join-Path $BackendDir ".venv"

Write-Host "GeoPlot Installation" -ForegroundColor Cyan
Write-Host "===================" -ForegroundColor Cyan
Write-Host ""

# Check Python
Write-Host "Checking Python..." -ForegroundColor Yellow
try {
    $pyVersion = & $PythonPath --version 2>&1
    Write-Host "Found: $pyVersion" -ForegroundColor Green
} catch {
    Write-Host "ERROR: Python not found at '$PythonPath'" -ForegroundColor Red
    Write-Host "Install Python 3.10+ or specify path: .\install.ps1 -PythonPath 'C:\Python312\python.exe'" -ForegroundColor Yellow
    exit 1
}

# Create venv
if (-not $SkipVenv) {
    if (Test-Path $VenvDir) {
        Write-Host "Virtual environment already exists at $VenvDir" -ForegroundColor Yellow
        $overwrite = Read-Host "Recreate? (y/N)"
        if ($overwrite -eq 'y') {
            Remove-Item -Recurse -Force $VenvDir
        } else {
            Write-Host "Keeping existing venv" -ForegroundColor Yellow
        }
    }

    if (-not (Test-Path $VenvDir)) {
        Write-Host "Creating virtual environment..." -ForegroundColor Yellow
        & $PythonPath -m venv $VenvDir
        if ($LASTEXITCODE -ne 0) {
            Write-Host "ERROR: Failed to create virtual environment" -ForegroundColor Red
            exit 1
        }
        Write-Host "Created: $VenvDir" -ForegroundColor Green
    }
}

# Install dependencies
Write-Host ""
Write-Host "Installing dependencies..." -ForegroundColor Yellow
$venvPython = Join-Path $VenvDir "Scripts" "python.exe"
& $venvPython -m pip install --upgrade pip --quiet
& $venvPython -m pip install -e "$BackendDir[dev]" --quiet

if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Failed to install dependencies" -ForegroundColor Red
    exit 1
}

Write-Host "Dependencies installed" -ForegroundColor Green

# Create data directory
$dataDir = Join-Path $RootDir "data"
if (-not (Test-Path $dataDir)) {
    New-Item -ItemType Directory -Path $dataDir | Out-Null
    Write-Host "Created data directory: $dataDir" -ForegroundColor Green
}

# Verify installation
Write-Host ""
Write-Host "Verifying installation..." -ForegroundColor Yellow
& $venvPython -c "import fastapi, pydantic, sqlalchemy, openpyxl, numpy, matplotlib; print('All packages OK')"
if ($LASTEXITCODE -ne 0) {
    Write-Host "WARNING: Some packages may be missing" -ForegroundColor Yellow
} else {
    Write-Host "Installation verified" -ForegroundColor Green
}

Write-Host ""
Write-Host "Installation complete!" -ForegroundColor Cyan
Write-Host "Run .\start.ps1 to launch GeoPlot" -ForegroundColor Yellow
