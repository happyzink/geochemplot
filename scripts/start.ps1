# GeoPlot Start Script
# Launches the backend server and optionally the frontend

param(
    [int]$Port = 8765,
    [switch]$NoBrowser,
    [switch]$BackendOnly,
    [switch]$Verbose
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RootDir = Split-Path -Parent $ScriptDir
$BackendDir = Join-Path $RootDir "backend"
$VenvPython = Join-Path $BackendDir ".venv" "Scripts" "python.exe"

Write-Host "GeoPlot Server" -ForegroundColor Cyan
Write-Host "==============" -ForegroundColor Cyan
Write-Host ""

# Check venv
if (-not (Test-Path $VenvPython)) {
    Write-Host "ERROR: Virtual environment not found" -ForegroundColor Red
    Write-Host "Run .\install.ps1 first" -ForegroundColor Yellow
    exit 1
}

# Find available port
function Test-Port {
    param([int]$Port)
    $listener = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, $Port)
    try {
        $listener.Start()
        return $true
    } catch {
        return $false
    } finally {
        $listener.Stop()
    }
}

$actualPort = $Port
for ($i = 0; $i -lt 20; $i++) {
    if (Test-Port $actualPort) {
        break
    }
    $actualPort++
}

if ($actualPort -ne $Port) {
    Write-Host "Port $Port in use, using $actualPort instead" -ForegroundColor Yellow
}

# Start backend
Write-Host "Starting backend on port $actualPort..." -ForegroundColor Yellow
$env:GEOPLOT_PORT = $actualPort
$env:GEOPLOT_HOST = "127.0.0.1"

$backendArgs = @("-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", $actualPort)
if ($Verbose) {
    $backendArgs += "--log-level", "debug"
} else {
    $backendArgs += "--log-level", "warning"
}

$backendJob = Start-Job -ScriptBlock {
    param($VenvPython, $BackendDir, $Args)
    Set-Location $BackendDir
    & $VenvPython @Args
} -ArgumentList $VenvPython, $BackendDir, $backendArgs

Write-Host "Backend PID: $($backendJob.Id)" -ForegroundColor Green

# Wait for health
Write-Host "Waiting for server to start..." -ForegroundColor Yellow
$healthy = $false
for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Seconds 1
    try {
        $response = Invoke-WebRequest -Uri "http://127.0.0.1:$actualPort/health" -TimeoutSec 2 -UseBasicParsing -ErrorAction SilentlyContinue
        if ($response.StatusCode -eq 200) {
            $healthy = $true
            break
        }
    } catch {
        # Not ready yet
    }
}

if (-not $healthy) {
    Write-Host "ERROR: Server did not start within 30 seconds" -ForegroundColor Red
    $jobOutput = Receive-Job $backendJob
    Write-Host $jobOutput
    Stop-Job $backendJob
    Remove-Job $backendJob
    exit 1
}

Write-Host "Server healthy at http://127.0.0.1:$actualPort" -ForegroundColor Green
Write-Host "API docs: http://127.0.0.1:$actualPort/api/docs" -ForegroundColor Green

# Open browser
if (-not $NoBrowser) {
    Write-Host ""
    Write-Host "Opening browser..." -ForegroundColor Yellow
    Start-Process "http://127.0.0.1:$actualPort/api/docs"
}

# Start frontend if not backend-only
if (-not $BackendOnly) {
    $frontendDir = Join-Path $RootDir "frontend"
    if (Test-Path $frontendDir) {
        Write-Host ""
        Write-Host "Starting frontend..." -ForegroundColor Yellow
        $npmCmd = Get-Command npm -ErrorAction SilentlyContinue
        if ($npmCmd) {
            $frontendJob = Start-Job -ScriptBlock {
                param($FrontendDir)
                Set-Location $FrontendDir
                npm run dev
            } -ArgumentList $frontendDir
            Write-Host "Frontend PID: $($frontendJob.Id)" -ForegroundColor Green
        } else {
            Write-Host "WARNING: npm not found, skipping frontend" -ForegroundColor Yellow
        }
    }
}

Write-Host ""
Write-Host "GeoPlot is running" -ForegroundColor Cyan
Write-Host "Press Ctrl+C to stop" -ForegroundColor Yellow
Write-Host ""

# Wait for interrupt
try {
    while ($true) {
        Start-Sleep -Seconds 1
        $jobState = $backendJob | Get-Job | Select-Object -ExpandProperty State
        if ($jobState -ne "Running") {
            Write-Host "Backend stopped unexpectedly" -ForegroundColor Red
            break
        }
    }
} finally {
    Write-Host ""
    Write-Host "Stopping services..." -ForegroundColor Yellow
    Stop-Job $backendJob -ErrorAction SilentlyContinue
    Remove-Job $backendJob -ErrorAction SilentlyContinue
    if (Get-Variable frontendJob -ErrorAction SilentlyContinue) {
        Stop-Job $frontendJob -ErrorAction SilentlyContinue
        Remove-Job $frontendJob -ErrorAction SilentlyContinue
    }
    Write-Host "Stopped" -ForegroundColor Green
}
