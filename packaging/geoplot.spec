"""PyInstaller spec：单文件 GeoPlot.exe（后端 + 前端 dist + 中文字体 + 参考数据）。

构建：pyinstaller packaging/geoplot.spec --noconfirm --distpath release --workpath build_tmp
"""
from pathlib import Path

import PyInstaller  # noqa: F401  (确保 spec 在打包环境内执行)

ROOT = Path(SPECPATH).resolve().parent
BACKEND = ROOT / "backend"
FRONTEND_DIST = ROOT / "frontend" / "dist"

if not (FRONTEND_DIST / "index.html").is_file():
    raise SystemExit(f"缺少前端构建产物：{FRONTEND_DIST}（先运行 npm run build）")

datas = [
    (str(BACKEND / "app" / "resources"), "app/resources"),
    (str(BACKEND / "app" / "renderers" / "fonts"), "app/renderers/fonts"),
    (str(FRONTEND_DIST), "web"),
]

hiddenimports = [
    "uvicorn.logging",
    "uvicorn.loops",
    "uvicorn.loops.auto",
    "uvicorn.protocols",
    "uvicorn.protocols.http",
    "uvicorn.protocols.http.auto",
    "uvicorn.protocols.websockets",
    "uvicorn.protocols.websockets.auto",
    "uvicorn.lifespan",
    "uvicorn.lifespan.on",
    "app.api.routes_directory",
    "app.api.routes_datasets",
    "app.api.routes_jobs",
    "sqlalchemy.dialects.sqlite",
    "sqlalchemy.dialects.sqlite.pysqlite",
    "matplotlib.backends.backend_agg",
    "matplotlib.backends.backend_pdf",
    "matplotlib.backends.backend_svg",
    "openpyxl",
]

a = Analysis(
    [str(ROOT / "packaging" / "app_entry.py")],
    pathex=[str(BACKEND)],
    binaries=[],
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.zipfiles,
    a.datas,
    [],
    name="GeoPlot",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    runtime_tmpdir=None,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
