# GeoPlot 一键回归验收脚本
# 环境检查 → 后端全量测试（含真实工作簿集成）→ 前端测试/类型/构建 → 合同哈希门禁 → live 冒烟（可选）
# 用法: .\scripts\verify.ps1 [-Quick] [-SkipFrontend] [-SkipLive]

param(
    [switch]$Quick,          # 后端只跑非集成测试（约 10s，跳过真实工作簿）
    [switch]$SkipFrontend,   # 跳过前端测试/构建
    [switch]$SkipLive        # 跳过 live 服务冒烟
)

# PS 5.1 下 Stop 会把原生命令 stderr（如 pytest 警告）误判为终止错误；脚本显式检查 $LASTEXITCODE
$ErrorActionPreference = "Continue"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RootDir = Split-Path -Parent $ScriptDir
$BackendDir = Join-Path $RootDir "backend"
$FrontendDir = Join-Path $RootDir "frontend"
$VenvPython = Join-Path $RootDir ".venv\Scripts\python.exe"

$failures = @()
$warnings = @()

Write-Host "GeoPlot 一键回归验收" -ForegroundColor Cyan
Write-Host "====================" -ForegroundColor Cyan

# [1] 环境
Write-Host "`n[1/6] 环境检查" -ForegroundColor Yellow
if (-not (Test-Path $VenvPython)) {
    Write-Host "  缺少虚拟环境 $VenvPython（先运行 .\scripts\install.ps1）" -ForegroundColor Red
    exit 1
}
$pyVersion = & $VenvPython --version 2>&1
Write-Host "  $pyVersion" -ForegroundColor Green

$workbook = Join-Path $RootDir "月球样品数据汇总_all-0910.xlsx"
if (Test-Path $workbook) {
    Write-Host "  真实工作簿存在（集成测试将执行）" -ForegroundColor Green
} else {
    $warnings += "真实工作簿缺失，Excel 集成测试将跳过"
}

# [2] 后端测试
Write-Host "`n[2/6] 后端测试" -ForegroundColor Yellow
Push-Location $BackendDir
try {
    if ($Quick) {
        $testArgs = @("-m", "pytest", "tests/", "-q", "--ignore=tests/integration")
    } else {
        $testArgs = @("-m", "pytest", "tests/", "-q")
    }
    $out = & $VenvPython @testArgs 2>&1
    $code = $LASTEXITCODE
    $summary = ($out | Select-String "passed|failed" | Select-Object -Last 1).ToString()
    if ($code -eq 0) {
        Write-Host "  $summary" -ForegroundColor Green
    } else {
        Write-Host "  $summary" -ForegroundColor Red
        $failures += "后端测试失败（详细：cd backend; ..\.venv\Scripts\python.exe -m pytest tests/ -q）"
        $out | Select-String "FAILED|ERROR" | ForEach-Object { Write-Host "    $_" -ForegroundColor Red }
    }
} finally {
    Pop-Location
}

# [3] 前端测试 / 类型 / 构建
if (-not $SkipFrontend) {
    Write-Host "`n[3/6] 前端测试 / 类型检查 / 构建" -ForegroundColor Yellow
    Push-Location $FrontendDir
    try {
        foreach ($step in @(@("test", "单元测试"), @("typecheck", "类型检查"), @("build", "构建"))) {
            $out = & npm run $step[0] 2>&1
            if ($LASTEXITCODE -eq 0) {
                Write-Host "  $($step[1]) OK" -ForegroundColor Green
            } else {
                $failures += "前端 $($step[1]) 失败（npm run $($step[0])）"
                Write-Host "  $($step[1]) 失败" -ForegroundColor Red
            }
        }
    } finally {
        Pop-Location
    }
} else {
    Write-Host "`n[3/6] 前端（已跳过）" -ForegroundColor Yellow
}

# [4] 合同哈希门禁
Write-Host "`n[4/6] 合同哈希门禁" -ForegroundColor Yellow
$hashCheck = & $VenvPython -c @"
import hashlib, json, pathlib, sys
root = pathlib.Path(r'$RootDir')
ready = json.loads((root / 'docs/progress/CONTRACT_READY.json').read_text(encoding='utf-8'))
pairs = [
    ('contracts/plot-spec.schema.json', 'schema_sha256'),
    ('contracts/plot-scene.schema.json', 'plot_scene_schema_sha256'),
    ('contracts/openapi.json', 'openapi_sha256'),
    ('contracts/fixtures/manifest.json', 'fixture_manifest_sha256'),
]
bad = []
for f, k in pairs:
    h = hashlib.sha256((root / f).read_bytes()).hexdigest()
    if h != ready.get(k):
        bad.append(f'{f}: 实际 {h[:12]}... != 签发 {str(ready.get(k))[:12]}...')
for name, expect in ready.get('fixture_hashes', {}).items():
    h = hashlib.sha256((root / 'contracts/fixtures' / name).read_bytes()).hexdigest()
    if h != expect:
        bad.append(f'fixture {name} 哈希漂移')
if bad:
    print('DRIFT')
    [print('  ' + b) for b in bad]
    sys.exit(1)
print('OK')
"@ 2>&1
if ($hashCheck -match "OK") {
    Write-Host "  合同哈希零漂移" -ForegroundColor Green
} else {
    Write-Host "  合同哈希漂移：" -ForegroundColor Red
    $hashCheck | ForEach-Object { Write-Host "    $_" -ForegroundColor Red }
    $failures += "合同哈希与 CONTRACT_READY.json 不一致（需按实际文件重签）"
}

# [5] live 冒烟
if (-not $SkipLive) {
    Write-Host "`n[5/6] live 服务冒烟" -ForegroundColor Yellow
    try {
        $health = Invoke-RestMethod "http://127.0.0.1:8765/health" -TimeoutSec 3
        if ($health.status -eq "ok" -and $health.schema_version -eq "1.2") {
            Write-Host "  /health OK (schema $($health.schema_version))" -ForegroundColor Green
        } else {
            $failures += "live /health 状态异常"
        }
        $smoke = & $VenvPython -c @"
import json, pathlib, urllib.request
root = pathlib.Path(r'$RootDir')
live = json.loads(urllib.request.urlopen('http://127.0.0.1:8765/api/openapi.json', timeout=5).read())
signed = json.loads((root / 'contracts/openapi.json').read_bytes())
print('EQUAL' if live == signed else 'DIFFER')
"@ 2>&1
        if ($smoke -match "EQUAL") {
            Write-Host "  live openapi 与合同结构一致" -ForegroundColor Green
        } else {
            $failures += "live openapi 与签发合同不一致"
        }
    } catch {
        $warnings += "live 服务未运行（跳过冒烟；启动：.\scripts\start.ps1）"
        Write-Host "  服务未运行，跳过" -ForegroundColor DarkYellow
    }
} else {
    Write-Host "`n[5/6] live 冒烟（已跳过）" -ForegroundColor Yellow
}

# [6] 汇总
Write-Host "`n[6/6] 汇总" -ForegroundColor Yellow
if ($warnings.Count -gt 0) {
    Write-Host "警告:" -ForegroundColor DarkYellow
    $warnings | ForEach-Object { Write-Host "  - $_" -ForegroundColor DarkYellow }
}
if ($failures.Count -gt 0) {
    Write-Host "失败项:" -ForegroundColor Red
    $failures | ForEach-Object { Write-Host "  - $_" -ForegroundColor Red }
    Write-Host "`n验收未通过" -ForegroundColor Red
    exit 1
}
Write-Host "全部通过 ✔" -ForegroundColor Green
exit 0
