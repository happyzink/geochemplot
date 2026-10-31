# Trae：GeoPlot 核查问题修改任务书

> 执行者：Trae，全栈负责。按任务逐项实施和验收；若环境提供 executing-plans 技能，可使用该技能执行。用户此次授权的是依据现有核查清单修复已有项目，不能仅回复计划或修改完成报告。

**目标：** 修复 2026-10-30 独立审查的 14 项问题，使图件保存、历史恢复、真实导出、项目备份恢复和 Windows 启动交付能够连续工作。

**实现原则：** 保留 FastAPI + SQLite + React 的现有结构，以服务端持久化事实为准统一前后端合同。将文件输出、数据库快照、版本更新做成可验证的完整操作；复用现有科学内核，不重写整套应用。

**技术栈：** Python/FastAPI/Pydantic/SQLite/Matplotlib；React/TypeScript/Zustand/Vite；pytest/Vitest/Playwright；Windows 启动器和 PyInstaller。GeoPlot-Lite 为单独的 Streamlit 应用，使用其自身虚拟环境。

**依据：** [项目独立审查_2026-10-30.md](D:/moon/项目独立审查_2026-10-30.md)。工作目录：`D:\moon`。本文路径在未注明时均相对此目录；代码行号见原审查，仅作为定位线索，执行前按函数名核实。

## 一、开始前必须明确的边界

1. 后端、前端、合同、数据库迁移、测试、启动器和打包都由 Trae 完成，不再以“等待 Qoder”作为停止理由。
2. 本任务书是修复入口。旧的“后端已完成”等文档不能覆盖本次实测问题；保留旧文档为历史材料，不删改审计证据。
3. 不覆盖原始 Excel、不删除用户数据、不清空数据库解决兼容问题。测试使用临时数据库、临时项目和临时导出目录。
4. 不新建一套替代应用，不开展无关 UI 重设计或框架升级。GeoPlot-Lite 的修复限定在单位和本次发现的绘图环境/字体问题。
5. 不用 mock、写死成功响应、手工篡改哈希或删除测试绕过验收。API 变更时同步更新合同、生成类型、客户端、fixture 和测试。
6. 可以合理调整内部实现，但必须满足全部验收行为；若某项已被其他人修好，先验证，再记录证据，不重复改动。
7. 常规实施连续推进；遇到确实缺少的外部环境，明确记录阻塞条件并继续其他独立任务。不能把“尚未验证”写成“通过”。

## 二、必须读取的证据与当前基线

- `项目独立审查_2026-10-30.md`
- `.review/audit_20261030.py`
- `.review/audit-results-20261030.json`
- `.review/probe-unrestricted-20261030.log`
- `.review/backend-audit-unrestricted-20261030.log`
- `.review/frontend-audit-20261030.log`
- `.review/build-audit-20261030.log`
- `.review/lite-agg-audit-20261030.log`

审查时：后端 194 项通过、前端 64 项通过、前端构建通过；Lite 在 Agg 下 23 项通过。但新增隔离复现确认了数据覆盖、备份遗漏等缺陷。这些旧的通过数字是基线，不是修复验收结果。

**不要直接重跑原审计脚本覆盖历史结果。** 原脚本是缺陷探针，不是完整的通过/失败测试：有些错误行为以 true 表示，阻止非法恢复后它还可能在预期异常处中止。先将场景转成带正确断言的回归测试，新增结果放在 `docs/progress/trae-fix-20261030/`。

## 三、执行顺序与问题映射

| 阶段 | 对应原问题 | 交付目标 |
|---|---|---|
| T0 | 工程管理缺口 | 建立基线、隔离验证和进度记录 |
| T1 | 01、11 | 图件导出不覆盖，尺寸/参数/哈希真实 |
| T2 | 02、09 | 一致性备份、安全恢复边界 |
| T3 | 03、04、05、12 | 草稿、修订、恢复、并发和导出状态一致 |
| T4 | 06、07、08 | 项目包可获取、可恢复、可继续编辑 |
| T5 | 10、14 | 对数轴和单位处理正确 |
| T6 | 13、字体与环境缺口 | 完整启动包和可移植绘图 |
| T7 | 测试与文档缺口 | 真实浏览器闭环、最终门禁和交付证据 |

顺序执行 T0→T1→T2→T3→T4→T5→T6→T7。每阶段先用回归用例重现原问题，再实施，检查通过后提交。原审查中“静态链路确认”的问题，尤其 03 和 12，必须先补真实调用复现。

## T0：建立可回退的修复基线

**读取/修改：** `.gitignore`、`scripts/verify.ps1`。
**新增：** `docs/progress/trae-fix-20261030/进度.md`、`接续记录.md`。

- [ ] 检查 `git status --short` 和 `git log -1`，确认是否已有新提交及其他工具正在写文件；保留已有改动。
- [ ] 如果仍无提交，先检查忽略规则和待跟踪清单，再对源码、合同、必要配置和文档建立本地基线提交。禁止 `git add .` 将虚拟环境、真实数据库、私密配置、原始大数据及构建缓存整体纳入。无需推送远端。
- [ ] 新建 `codex/trae-audit-fixes-20261030` 或遵循用户已有分支命名；已有工作分支则沿用，不强制切换或重置。
- [ ] 记录源码基线、现有测试结果和环境版本。创建阶段进度表，初始状态一律“未验证”。

```powershell
Set-Location D:\moon
git status --short
git log -1 --oneline
git diff --stat
```

**验收：** 有可识别的基线提交/工作区差异、隔离测试目录和接续记录；没有数据清空或无关文件回滚。

## T1：修复图件导出、参数记录和文件完整性（01、11）

**修改：** `backend/app/api/routes_exports.py`、`backend/app/storage/database.py`、`backend/app/migrations/`、`backend/app/renderers/matplotlib_renderer.py`、`frontend/src/features/exports/ExportDialog.tsx`、`frontend/src/features/exports/ExportsPage.tsx`、相关合同与类型。
**新增测试：** `backend/tests/integration/test_export_integrity.py`。

**输出合同：** 每条导出记录持久化 `export_id / figure_id / revision_id / scene_hash / size_mm / dpi / background / files`；files 保存生成时的文件名、字节数、SHA256 和位置。检查实际文件时不能替换原始哈希。旧记录无法恢复的字段表示未知，不能假装为默认值。

- [ ] 编写两个同名图件首次导出的用例，证明当前目录碰撞；增加名称清洗后同名及并发调用场景。
- [ ] 使用不可冲突目录，例如 `root/<figure_id>/<export_id>/`，名称只作展示。导出先写 staging，完成并核验后发布；失败时保留失败状态，不对外标记成功。
- [ ] 迁移新增参数和文件清单存储，迁移可重复运行。保留旧文件和旧记录；旧记录缺少基准哈希时提示“无法验证历史完整性”。
- [ ] 在冻结 Scene 的独立副本上应用导出宽高，再渲染 PNG/PDF/SVG；不要修改已保存修订。记录原 scene_hash 和实际导出设置，复现包同时保存实际采用的版式。
- [ ] 将用户请求的 DPI、背景、尺寸真实持久化；重导读取原记录参数。修正前端展示，不再固定 600 dpi/白底/默认尺寸。
- [ ] 删除一个输出文件或修改字节后，记录应明确指出缺失或校验失败；不能仅检查目录存在、不能用重算哈希掩盖损坏。
- [ ] 运行新测试和既有渲染一致性测试后提交。

**关键断言模板**（变量由测试创建的真实导出结果提供）：

```python
assert first_directory != second_directory
assert first_sha_after_second_export == first_sha_before
assert abs(png_width - 100 / 25.4 * 72) <= 1
assert abs(png_height - 80 / 25.4 * 72) <= 1
assert record['size_mm'] == {'width': 100, 'height': 80}
assert record['dpi'] == 72
assert record['background'] == 'transparent'
```

**验收：** 同名/并发不覆盖；100×80 mm 的 PNG 像素误差不超过 1 px，PDF 页面物理尺寸、SVG 尺寸正确；透明背景真实存在；重启后参数不变；损坏可检出；重导保留原参数。

## T2：一致性备份与恢复路径防护（02、09）

**修改：** `backend/app/services/projects.py`、`backend/app/api/routes_projects.py`。
**新增测试：** `backend/tests/integration/test_project_package_safety.py`。

- [ ] 用独立连接保持数据库打开，在 WAL 中提交新行；导出并打开包内数据库，断言新行存在。该测试应在旧实现失败。
- [ ] 用 SQLite 在线备份 API 生成暂存快照，再打包快照；不得直接复制活动 `.db` 或简单拼接 WAL 文件。manifest、计数和包内内容必须来自同一快照。

```python
with sqlite3.connect(source_db_path) as source:
    with sqlite3.connect(snapshot_path) as target:
        source.backup(target)
```

- [ ] 服务端生成上传临时文件名，不使用上传者给出的路径。对 manifest.project_id 限制安全 ID，拒绝绝对路径、盘符、UNC、父级跳转和路径分隔符。
- [ ] 归档先完整验证，再解压至 staging；逐成员验证最终解析路径仍在 staging 内。拒绝符号链接条目等可绕过目录边界的内容；验证失败不能留下部分导入的数据库记录。
- [ ] 验证 manifest 必填字段、包版本和声明内容；损坏或不支持版本返回明确 4xx，不产生“恢复成功”。

```python
base = staging_dir.resolve()
destination = (base / member_name).resolve()
if destination != base and not destination.is_relative_to(base):
    raise ValueError('Archive member escapes restore directory')
```

上述路径检查仅是包含关系示例，不能代替 Windows 路径、manifest ID 和归档链接校验。

**验收：** 活跃 WAL 场景新提交数据进入备份；跨表关系一致；`../escaped`、绝对路径、盘符和归档成员跳转全部拒绝，恢复目录外无新增文件。

## T3：统一图件草稿、修订与冲突合同（03、04、05、12）

**修改：** `backend/app/api/routes_figures.py`、数据库及迁移、`frontend/src/lib/api/client.ts`、`frontend/src/lib/api/http.ts`、`frontend/src/state/workspaceStore.ts`、图件库页面、合同及生成类型。
**新增测试：** `backend/tests/integration/test_figure_lifecycle.py`、`frontend/tests/unit/figureLifecycle.test.ts`；浏览器用例放入 T7 的 live 测试。

**本阶段统一语义：**

- `draft_revision`：草稿每次成功修改后单调增加，是草稿乐观锁，不是展示版本号。
- `metadata_revision`：名称/归档等元数据的乐观锁；名称只由明确的重命名操作改变。
- `current_revision_id`：当前选定的已保存修订，未保存时可为 null；由服务端返回，前端不能拼造。
- 保存草稿不冒充发布不可变版本；保存版本必须返回数据库里真实存在的 revision_id、revision_number、spec 和 scene_hash。
- 恢复 r1 时，当前修订和可编辑草稿来自 r1，同时保留 r2 历史。恢复后的草稿锁令牌继续递增，不能回退为历史编号。

- [ ] 先编写真实 HTTP 回归：新建→改样式自动保存→保存版本→导出；确认旧实现哪里断开。
- [ ] 为草稿提供明确的持久化实体（建议 `figure_drafts` 表及迁移）；已有修订全部保留。迁移从 current_revision_id 对应的 spec 初始化草稿，不取最高版本号代替当前版本。
- [ ] 新建、详情、保存版本、恢复接口返回一致的图件状态。详情包含 current_revision_id、draft_revision、metadata_revision；版本对象返回真实存储值。
- [ ] 移除客户端 `_published`、固定 revision_number=1、getFigure 中无条件 revisions[0] 等替代逻辑。保存/恢复响应同步更新当前 state.figure，而非只刷新列表。
- [ ] saveDraft 请求不发送空 label；后端也不能把缺省 label 当成重命名。重命名走明确接口，校验空名称。
- [ ] 草稿、元数据和恢复操作携带对应 expected revision；服务端在同一事务中检查令牌并写入。两个窗口相同令牌提交，仅一个成功，另一个返回 HTTP 409 和稳定错误码 `STALE_REVISION`。
- [ ] 保存不可变版本时核对草稿版本与 Scene 的来源，避免用户继续编辑时冻结了另一份内容；旧版本 spec 和 hash 不允许原地更改。
- [ ] 前端冲突时保留本地修改，显示重载/另存为选择，不自动覆盖。防止切换图件后旧的异步保存响应写入新图件状态。
- [ ] 更新合同和类型，再运行新增后端/客户端测试，提交本阶段。

**关键行为断言：**

```python
assert name_after_autosave == '命名图件'
assert saved_revision_id in database_revision_ids
assert restored_current_revision_id == revision_r1_id
assert restored_draft_spec == revision_r1_spec
assert revision_r2_spec_after_restore == revision_r2_spec_before_restore
assert sorted([window_a_status, window_b_status]) == [200, 409]
```

**验收：** 新建→保存后立即可导出；r1/r2 使用不同轴变量、颜色和尺寸，恢复 r1 后页面、重开、重算和导出均对应 r1；名称保留；双窗口冲突可复现且无静默丢失。

## T4：完成项目导出/恢复闭环（06、07、08）

**依赖：** T2 快照和安全边界、T3 版本实体。
**修改：** `backend/app/services/projects.py`、`backend/app/api/routes_projects.py`、相关存储/迁移、`frontend/src/features/projects/ProjectsPage.tsx`、API client/http、合同。
**新增/加强测试：** `backend/tests/integration/test_project_roundtrip.py`、`backend/tests/integration/test_project_restore_live.py`。

- [ ] 将项目导出改为受管理目录中的持久包，并提供可用下载接口；明确 package_id、byte_size、sha256。若选择流式下载，须确保响应完成后才清理文件，且前端接收二进制。不得只返回马上失效的临时路径。
- [ ] 定义并实现项目包版本：包含 manifest、图件元数据、草稿、不可变修订、选择定义/快照、数据版本引用、参考组成快照及其必要依赖。
- [ ] 自包含包带有可恢复的数据快照；配置包不带测量数据，但完整保留 PlotSpec、样式、轴、图层、修订和可定位的外部数据引用。不能仅导出图件摘要。
- [ ] 将恢复结果注册到当前应用可访问的项目索引和数据库。推荐事务导入到当前数据存储；若改为项目独立数据库，须同步实现项目切换和全部 API 路由绑定，不能只解压后打开一次。
- [ ] 在空环境恢复后项目可列出、可打开、数据可查、图件可编辑。重复导入/ID 冲突不能覆盖既有项目：采用明确冲突响应或生成新项目 ID，并一致重映射关联 ID。
- [ ] 恢复失败回滚 staging 和本次新增记录，不破坏已有项目。配置包缺数据时允许查看和编辑配置，但阻止伪造计算结果，列出缺失依赖和重新关联入口。
- [ ] 前端项目页提供真实项目包导出、下载、上传恢复入口；显示真实服务结果，恢复后刷新项目列表并能切换到恢复项目。
- [ ] 重写原来仅断言 manifest 的测试，比较实际分析 ID、测量值、选择集、图件配置、修订和 Scene；恢复后再次导出并验证数值一致。

**验收断言：**

```python
assert downloaded_bytes_sha256 == advertised_sha256
assert restored_project_id in listed_project_ids
assert restored_analysis_ids == expected_analysis_ids
assert restored_measurements == expected_measurements
assert restored_spec == original_spec
assert restored_scene_numeric_values == original_scene_numeric_values
```

如果 ID 冲突导致合法重映射，通过记录的映射比较语义对应关系，不能删掉一致性断言。配置包另断言：有完整 spec/选择引用、没有原始测量数据、缺失依赖明确可见。

## T5：修复对数轴和单位处理（10、14）

**修改：** `backend/app/services/scenes.py`、相关表达式/质量策略；`GeoPlot-Lite/data_io.py`。
**新增测试：** `backend/tests/scientific/test_log_quality_policy.py`、`GeoPlot-Lite/tests/test_unit_conversion_regression.py`。

- [ ] 散点图计算后、轴范围统计前，根据对数轴过滤非正数和非有限数，写明排除原因；valid/excluded 数量与渲染点集一致。
- [ ] 全部值不可绘制时返回结构化“无可绘制数据”结果或明确 4xx，前端给出提示，不调用 log10(0/负数)，不显示上一次图形冒充当前结果。
- [ ] 覆盖 X/Y 单独及同时为 log10、全负、全零、正负混合、单个正值、手动范围和空选择。若策略设为 include，不得把非正数伪造为极小正值，应明确该配置无法在对数轴展示。
- [ ] Lite 的单位入口统一识别 `ppm`、`ppb`、`%`、`wt%`（清理大小写/外侧空格）；未知单位返回明确错误。空单位只有用户已明确确认默认单位时才能转换，不能静默当 ppm。
- [ ] 用等价浓度和混合单位比值验证标准化；同浓度不同单位的最终值必须相同。

```python
import pytest
from data_io import convert_to_ppm

@pytest.mark.parametrize('value,unit', [
    (1.0, 'wt%'), (1.0, '%'), (10000.0, 'ppm'), (10000000.0, 'ppb'),
])
def test_equivalent_concentrations(value, unit):
    assert convert_to_ppm(value, unit) == pytest.approx(10000.0)
```

**验收：** 原始 La=-1/Ce=5 的对数轴复现不再抛内部异常；混合数据有效数量正确；1 wt%=10000 ppm；未知单位明确失败；不改动原始观测值掩盖问题。

## T6：启动、打包和字体可移植性（13）

**修改：** `launcher/main.py`、`packaging/geoplot.spec`、`backend/app/main.py`、`scripts/start.ps1`、`scripts/install.ps1`、前端 API 基址配置、两套应用的字体/渲染初始化。
**新增：** `packaging/build.ps1`、`docs/progress/trae-fix-20261030/便携包验收.md`。

- [ ] 建立唯一可复现构建入口：先构建前端，将 frontend/dist 和后端必要资源带入候选包；明确 Server 的入口与产物。不能只构建 Launcher 却依赖未生成的 GeoPlotServer.exe。
- [ ] 后端在应用根路径提供绘图前端，API 保持独立路径。启动器“打开绘图界面”访问真实应用页面，不访问 /api/docs。
- [ ] 开发脚本、启动器、打包进程使用一致的路径策略；核对现有脚本对根目录 `.venv` 与 `backend/.venv` 的不同假设。冻结版不得回退依赖系统 Python/Node。
- [ ] 后端选用非默认端口时，前端请求同一实例；解决硬编码代理端口问题。启动器只管理自己启动的进程，停止后可正常重启。
- [ ] 主应用与 Lite 的非交互导出采用 Agg，避免依赖 Tk 窗口；不影响 Streamlit 的显示。
- [ ] 中文、英文和下标使用实际可用字体；中文按论文预设使用仿宋，英文/数字/符号采用 Times New Roman 或预设要求。缺字时明确回退并记录字体，不能声称字体已满足却输出方框。
- [ ] 生成含“真实样品”、SiO₂、R²、中文图例的 PNG/PDF/SVG 并检查。检查文字裁切、下标、透明度及可编辑 SVG；保存输出样例。
- [ ] 在无 Python/Node 的 Windows 测试环境启动候选包，完成启动、绘图、保存、导出、停止、重启恢复，记录系统环境和包 SHA256。无法取得该环境时明确标为“待外部验收”，其余工作继续完成。

**验收：** 用户双击即可打开绘图界面；无需系统开发依赖；端口变化、带空格/中文路径和重启场景可用；中文/下标输出无缺字。

## T7：将真实验收纳入门禁并交付

**修改：** `scripts/verify.ps1`、`frontend/playwright.config.ts`、`frontend/tests/e2e/pyrolite-parity.spec.ts`、任务总入口和当前交接文档、ProjectsPage 内过时责任文案。
**新增：** `frontend/tests/e2e/audit-fixes-live.spec.ts`、`docs/progress/trae-fix-20261030/验收报告.md`、`验收结果.json`。

- [ ] 新增专门的 live 浏览器测试，以真实后端和隔离数据运行，不带 demo=1，不拦截 API 返回假数据。
- [ ] 浏览器连续完成：导入/选择样品→散点/REE/蛛网/TAS→新建命名图件→改样式自动保存→保存 r1/r2→恢复 r1→导出 PNG/PDF/SVG→项目备份下载→全新环境恢复→编辑和重导。
- [ ] 增加双窗口冲突、同名图件、导出尺寸和重启恢复用例；校验真实文件和数据库内容，不只校验 toast 文案。
- [ ] 门禁明确分出开发快速检查与正式交付检查；正式检查中 live 测试跳过、服务未启动、产物缺失必须阻止“全部通过”。
- [ ] 由最终实现生成 OpenAPI/JSON schema/TypeScript 类型和 fixtures，再签发哈希。不得只更新签发文件掩盖合同漂移。
- [ ] 清理当前入口的旧分工文案，写清 Trae 全栈负责和实际剩余事项。保留历史报告原文及日期。
- [ ] 在报告中逐项映射 01–14，记录代码、测试名、命令、运行时间、结果、证据文件和提交 ID；任何未执行项写“未验证”及原因。

**运行命令参考**（以最终脚本的明确参数为准；所有服务必须使用隔离数据库/输出路径）：

```powershell
Set-Location D:\moon\backend
..\.venv\Scripts\python.exe -m pytest tests -q

Set-Location D:\moon\frontend
npm test
npm run build
$env:GEOPLOT_LIVE = '1'
npm run test:e2e -- audit-fixes-live.spec.ts

Set-Location D:\moon\GeoPlot-Lite
$env:MPLBACKEND = 'Agg'
.\.venv\Scripts\python.exe -m pytest tests -q
```

运行原生命令后检查 `$LASTEXITCODE`；保存完整日志，不能因后续 Get-Content 成功而将失败测试判为成功。TestClient 如再次卡在 Windows socket 初始化，应先区分环境阻塞并记录，不删测试、不改业务逻辑迎合沙箱。

## 四、最终交付清单

- [ ] 14 项修复逐条可追踪，旧用户数据库可迁移且数据保留。
- [ ] 完整源码改动、迁移和必要合同更新；每阶段有清晰提交。
- [ ] 新增回归用例包含原审计复现数据，并在真实实现上通过。
- [ ] 前后端测试、构建、合同校验、live 浏览器结果及导出文件检查证据。
- [ ] 可运行候选便携包、构建命令、包 SHA256 和干净环境验收结果；若未具备外部环境，明确区分“候选包已生成”和“正式交付验收通过”。
- [ ] `验收报告.md` 说明已修复/未完成/未验证，不沿用旧的通过数量充当当前结果。
- [ ] 更新 `接续记录.md`，使另一个执行者无需重读聊天即可继续。

### 中断时的接续记录格式

```text
当前阶段：Tn
已完成问题：原报告编号及对应提交
正在修改：文件、接口/迁移变化
最后执行命令：完整命令、退出码、日志路径
尚未通过的断言：输入、预期、实际
下一步：具体文件与具体操作
运行中的测试服务：PID、端口、隔离数据目录
不得覆盖的用户文件与历史证据：路径
外部阻塞：所缺环境及最小解锁条件；没有则写无
```

## 五、可直接复制给 Trae 的启动指令

> 请先完整阅读 `D:\moon\docs\superpowers\plans\2026-10-30-trae-fixes.md`、`D:\moon\项目独立审查_2026-10-30.md` 和任务书列出的审计证据。你现在负责整个项目的前后端、数据库、测试及打包，请按 T0–T7 连续执行修复，不等待 Qoder。保留用户数据和原始证据，先补复现测试再修代码；重点先解决同名导出覆盖、WAL 备份遗漏、恢复路径越界，随后打通草稿/版本/恢复/导出和项目迁移。每阶段留下日志、提交和接续记录。全部 14 项按实际行为验收，不用单元测试通过或完成文档代替真实闭环；无法执行的干净机器验收明确标注，不虚报完成。
