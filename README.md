# GeoPlot

月球与地球化学数据的科研绘图工作台：导入 Excel 样品数据，检索、筛选、建选择集，生成 REE 标准化 / TAS 分类 / 元素相关图等图件，并导出 PNG / PDF / SVG 与可复现数据包。

- 后端：FastAPI + SQLAlchemy + SQLite（本地文件数据库）
- 前端：React 18 + TypeScript + Vite + Plotly.js + Zustand
- 渲染：matplotlib（服务端出图，中文字体随包分发）
- 桌面版：PyInstaller 单文件 `GeoPlot.exe`，双击即用，无需 Python / Node 环境

## 功能

- Excel 工作簿扫描与导入（多表、多通道列隔离、重复数据去重）
- 数据集查询、筛选与分面（任务分类、样品标号组、物性、矿相）
- 选择集快照（冻结分析 ID 集合，保证复现一致性）
- 图件计算与冻结：`POST /api/v1/plots/compute` 返回 schema 1.2 的 Scene 契约
- 图件创建 / 修订 / 发布 / 版本恢复，渲染 PNG / PDF / SVG
- 导出复现包：Scene、PlotSpec、参考值快照、溯源信息、字体清单、绘图数据 CSV
- 契约门禁：`contracts/plot-scene.schema.json` + fixture 哈希 + `docs/progress/CONTRACT_READY.json`

## 目录结构

```
backend/          FastAPI 服务、领域模型、导入/计算/渲染、pytest 测试
frontend/         React + TS 前端（Vite 构建产物在 frontend/dist）
contracts/        Scene JSON Schema 与契约 fixture
packaging/        桌面版打包入口（app_entry.py）与 PyInstaller spec
launcher/         早期 Tkinter 启动器（当前桌面版方案未使用）
scripts/          字体获取等辅助脚本
docs/             任务书、进度与契约门禁记录
```

## 本地开发

后端（默认 `http://127.0.0.1:8765`）：

```powershell
cd backend
python -m venv .venv
.venv\Scripts\pip install -e ".[dev]"
.venv\Scripts\python -m uvicorn app.main:app --port 8765
```

前端（开发端口 5173，`/api` 代理到 8765）：

```powershell
cd frontend
npm install
npm run dev
```

测试：

```powershell
cd backend  && .venv\Scripts\python -m pytest        # 后端单测 / 集成 / 科学一致性
cd frontend && npm run test && npm run typecheck      # vitest + tsc
```

## 打包 Windows 单文件 exe

产物：`release/GeoPlot.exe`（约 63 MB，含前端、中文字体与参考数据，构建产物不入库）。

```powershell
cd frontend && npm run build
.venv-build\Scripts\pyinstaller.exe packaging\geoplot.spec --noconfirm --distpath release --workpath build_tmp
```

使用方式：

1. 双击 `GeoPlot.exe`，控制台窗口显示服务地址，浏览器自动打开界面
2. 用户数据（数据库、项目、导出图件）保存在 `%LOCALAPPDATA%\GeoPlot`
3. 关闭控制台窗口即退出程序；端口 8765 被占用时自动顺延
4. 可选环境变量：`GEOPLOT_DATA_DIR`（数据目录）、`GEOPLOT_PORT`（起始端口）、`GEOPLOT_WEB_DIR`（前端目录）

## 说明

- 随包中文字体 `backend/app/renderers/fonts/NotoSansCJKsc-Regular.otf`（约 16 MB）通过 Git LFS 存储，克隆时需安装 Git LFS
- 参考值与 TAS 图形元数据位于 `backend/app/resources/`
- 本仓库仅包含源码与契约资产，运行期数据、构建产物与报告副本不入库
