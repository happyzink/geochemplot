# GeoPlot 后端与科学计算 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> Qoder 环境若没有这些技能，按下述逐任务实现、验证、记录的流程执行即可，不得因技能不存在停工。当前文件是交给后续执行者的计划，不表示已经启动开发。

**Goal:** 正确读入真实月球工作簿，支持可追溯选样、标准化与四类图解，并生成可复现的论文图。

**Architecture:** 本地 FastAPI 接受导入和 PlotSpec，SQLite 保存版本化规范数据；统一数值内核生成 PlotScene。Matplotlib 只消费冻结的 Scene，浏览器消费相同结果。

**Tech Stack:** Python 3.12、FastAPI、Pydantic、SQLAlchemy/SQLite、openpyxl、NumPy、Matplotlib、pytest；图解可经核实复用 pyrolite 数据。

**Spec:** [产品需求](02_产品需求与交互流程.md)、[数据规则](03_数据模型与科学计算规则.md)、[图解规范](04_图解与论文出图规范.md)、[接口](05_接口与共享契约.md)。

**v2必读：** [主任务书](../../GeoPlot_科研绘图工具_正式任务书_v2.md)、[13内置清单](13_内置数据与参考组成清单_v2.md)、[15合同和新增Q11/Q12](15_v2接口与任务增补.md)、[16新增验收](16_v2交互导出启动验收.md)。本文件列Q01–Q10，完整工作量为Q01–Q12；阶段统一S0–S4，具体前置关系以11为准。

## 全局约束

- 只写backend、contracts、scripts、launcher、packaging、数据包构建、共享合成fixtures和己方进度文件。不要改Trae的界面业务代码；AstroMat排除。
- 原始 XLSX 不覆盖、不重算写回、不上传、不提交公开仓库；运行时 data 加入忽略。
- 字段含义/单位/参考值不靠数值大小猜成已确认；保留原列身份和所有问题。
- 所有开发任务未完成。每任务提交验证证据，再推进；不得以 build 成功替代科学验收。
- 下列命令是实现后的验收命令。使用 `.venv\Scripts\python.exe`，工作目录为 `backend`；由 Q01 建立环境。
- 任务内部先写能发现错误的最小测试，再实现，再跑指定测试；文档/浅层样式修改无需伪造实现镜像测试。

## Q01 / S0：可运行服务与唯一合同

**文件：** 创建 `backend/pyproject.toml`、`app/main.py`、`app/domain/{models,plot_spec,errors}.py`、`contracts/*.json`、`contracts/fixtures/*.json`、`tests/integration/test_contract.py`。更新根 README 的启动说明，保留本任务入口。

**输入/输出：** 输入 05 的合同；输出 GET /health、可验证 PlotSpec/PlotScene schema、Trae 可用的成功/空数据/错误/过期四种 fixture。

- [ ] 检查工作区与原始文件哈希；如果没有Git，初始化并忽略`.venv`、node_modules、data、真实XLSX、Office临时锁文件与私人验收证据；**依赖锁文件必须提交**，不能误忽略。
- [ ] 建 Python 3.12 环境，安装并锁定兼容版本；记录 Python/依赖版本和 Windows 启动方式。
- [ ] 用 Pydantic 判别联合定义 Expression、PlotSpec、PlotScene、错误和 Job，导出 OpenAPI/JSON Schema。
- [ ] 给每种图类型建立一份合法 fixture；补充缺参考值、非法单位、重复层 ID 的拒绝 fixture。
- [ ] 先写 schema 测试：normalized REE 无 reference 必须拒绝；raw REE 可无 reference；scatter 缺 x 必须拒绝。
- [ ] 实现 health、统一异常包装、本地存储初始化和 migration 1；测试数据库隔离。
- [ ] 把 schema_hash 和 fixture_hash 写入 `docs/progress/CONTRACT_CHANGELOG.md`，请 Trae 对照读取。没有 schema 变更不得手改生成的前端类型。

**验证：** `python -m pytest tests/integration/test_contract.py -q`；预期全部PASS；启动后/health返回schema_version=1.1。按14生成真实CONTRACT_READY.json，包含15的全部对象和fixtures，不仅四类图。

## Q02 / S1：只读扫描、公式与导入预览

**文件：** `app/importers/excel_scan.py`、`app/api/routes_imports.py`、`app/storage/{database,repository}.py`、`tests/integration/test_excel_scan.py`。

**接口：** `scan_workbook(path: Path) -> WorkbookPreview`；HTTP scan / preview / jobs/cancel 按 05。

- [ ] 建两次读取（公式与缓存）路径；使用流式读取/分块插入控制内存，不能把全工作簿的几百万 Cell 对象永久留在应用状态。
- [ ] 检测所有 sheet、非空区域、候选表头、重复表头、空表头、数值/字符串/错误/公式比例；保留 Excel 行列号。
- [ ] 原始实验第 75 行识别为重复表头；没有样品号的 13 行进待确认，不能向下填充名字。
- [ ] 识别 Normalization value 的 A4:A17 与 D4:D17 为候选参考表；解析 A 文本只用有限正则，不执行字符串。
- [ ] 测试有缓存公式、缓存错误、缺缓存公式、含外部链接公式；只报告，不执行外部链接或任意公式。
- [ ] 工作簿缓存错误统计应为嫦娥主表 2,943、trace 表 60；每个错误定位到单元格。
- [ ] scan 使用后台任务，取消后清理本任务未提交临时产物，保留可重试的上传副本；重启能解释中断状态。

**测试样例：** 实际文件测试从环境变量 `GEOPLOT_TEST_WORKBOOK` 取路径，未设置则显式 SKIP；最终验收必须设置，不能用 SKIP 算通过。

```python
def test_real_workbook_scan(real_workbook_path):
    preview = scan_workbook(real_workbook_path)
    assert len(preview.sheets) == 6
    assert preview.sheet("Apollo数据").physical_data_rows == 35802
    assert preview.sheet("嫦娥搜集数据").cached_error_count == 2943
    assert preview.sheet("CE with trace ele").cached_error_count == 60
```

本任务建立 `real_workbook_path` pytest fixture 与 WorkbookPreview.sheet(name) 查询方法，避免仅在文档中存在测试接口。

**验证：** `python -m pytest tests/integration/test_excel_scan.py -q`；保存 scan_report.json 与原文件前后哈希。

## Q03 / S1：规范化、单位、材料与任务分类

**文件：** `app/importers/{csv_scan,mapping,lunar_workbook}.py`、`app/services/{classification,identity}.py`、`app/resources/aliases.json`、`tests/unit/test_classification.py`、`tests/integration/test_lunar_mapping.py`。

**输入/输出：** WorkbookPreview + ColumnMapping → 版本化 Dataset；每行输出 accepted/quarantined/skipped/linked_derived 之一，并保留原始行。

- [ ] 先实现通用整洁宽表映射，再实现当前工作簿 profile；不是把所有逻辑写成只认固定文件名的 if 分支。
- [ ] 列键用 sheet+index；区分 trace 的 Z:AM raw 与 BK:BX normalized；不能按相同 La 表头覆盖。
- [ ] 采用 03 的分类优先级；Apollo G=MINERAL 即使 D=ROCK>>BASALT 仍为矿物。CE 的类型 Basalt 不覆盖明确 Pyroxene。
- [ ] task=LABLE 且 original_name=CE6-118-GLASS - 1：batch=LABLE，mission 候选 CE6；所有规则有证据、置信和确认状态。
- [ ] 解析当前字典和样品号，保留原文；模糊/复杂名字 unknown。不要把 MOUNT-2 变成 CE2。
- [ ] 保存测量浓度、2SE(int)、2SD、两套 LOD 的关联；多同位素通道保留并提示选择。
- [ ] 文献块只在用户确认的范围继承元数据，记录 anchor_cell；空样品号、元素缺失不向下填充。
- [ ] bulk metadata 修订创建新版本；回滚或重新打开旧图仍能读旧版本。

**明确身份测试：** `identify_apollo_sample(name: str) -> SampleIdentity`，SampleIdentity 包含 parent_sample / subsample / confidence。

```python
def test_apollo_subsample_identity():
    a = identify_apollo_sample("74235, 41")
    assert a.parent_sample == "74235"
    assert a.subsample == "41"
    assert identify_apollo_sample("15426/27").parent_sample is None
```

**验证：** `python -m pytest tests/unit/test_classification.py tests/integration/test_lunar_mapping.py -q`。交付逐表映射 JSON 和“接受/待确认/跳过”行数对账，不要求凭未经核实的推断把待确认数压到零。

## Q04 / S1：跨表关系、查询与稳定选样

**文件：** `app/services/{dedup,selections}.py`、`app/api/routes_data.py`、`tests/integration/test_selection.py`、`tests/integration/test_lineage.py`。

**接口：** datasets/query、facets、analyses detail、selections CRUD；selection_hash 根据有序 resolved_ids 和 dataset_versions 计算。

- [ ] 为 mission/material/phase/parent_sample/raw_search_name 建索引，分页只返回当前页；facet 查询以相同过滤上下文计算。
- [ ] 精确/母样品/包含三种搜索必须区分；不要用 SQL LIKE 替代全部模式。
- [ ] 同一 SHA-256 + 同一映射重导幂等；映射不同建立新版本，不覆盖旧记录。
- [ ] 实测 trace 535 行关键字段全匹配主表；两条多候选记录留冲突，不任意取第一条。
- [ ] 默认 trace 作为派生视图不额外加点；自有原始/汇总仅在关系确证后关联，其余疑似不硬删。
- [ ] 跨页选择、全筛选结果选择、排除个别 ID、保存快照/动态选择，均在后端解析完整候选集。
- [ ] 保留同一名字不同文献/方法的多条分析；导入去重和样品聚合是两个操作。

**验证：** Apollo 精确 74235=4，母样品74235=14，材料均为 whole_rock；选择全部过滤结果后只加载第一页，实际 resolved_ids 仍等于完整结果。

运行 `python -m pytest tests/integration/test_selection.py tests/integration/test_lineage.py -q`。交付查询时间、结果 JSON 和冲突示例。

## Q05 / S1：唯一数值内核与参考组成

**文件：** `app/services/{units,calculations}.py`、`app/resources/references/`、`tests/scientific/test_calculations.py`、`tests/scientific/test_references.py`。

**函数合同：**

| 对象/函数 | 必须实现的签名与字段 |
|---|---|
| CalcResult | frozen dataclass，字段value: float或None、unit: str、reasons: list[str] |
| normalize | `(value: float或None, value_unit: str, reference: float或None, reference_unit: str) -> CalcResult` |
| ratio | `(a: float或None, a_unit: str, b: float或None, b_unit: str) -> CalcResult` |

normalized 与 ratio 的成功 unit 为 `dimensionless`。quality_flags 的剔除在 Expression 求值进入标量函数前完成，结果链保留原因。

- [ ] 先写固定数值 oracle，误差容限 rtol=1e-10、atol=1e-12；期待值不能调用被测函数生成。
- [ ] 实现 ppm/ppb/wt% 同化学量转换；元素到氧化物另设显式 transform，保留原子量版本。
- [ ] 实现有限 AST 的 normalize/ratio/add/constant；拒绝层数、节点数超限及任意代码字符串。
- [ ] 将工作簿 14 值作为自定义参考导入；值精确保留，单位/出处不伪造。验证内置 CI 与 PM 逐值来源，保存核对表。
- [ ] 对 raw/normalized 标识检查，阻止二次标准化；未知标准的 normalized 源列不可参与重标准化。
- [ ] 实现零分母、缺值、负值、检出限、错误缓存的 reason_code；实现单位不确认时排除。
- [ ] 原始数据已有 Mg#/An# 只读保存；不要照抄 Excel 的来源指数作为软件标准算法。
- [ ] 支持标准化绝对误差和显式独立误差比值传播；不同类型误差拒绝混算。

```python
def test_normalize_and_units():
    assert normalize(2.37, "ppm", 0.237, "ppm").value == pytest.approx(10)
    assert normalize(2370, "ppb", 0.237, "ppm").value == pytest.approx(10)
    assert ratio(10, "ppm", 100, "ppm").value == pytest.approx(0.1)
    bad = ratio(10, "ppm", 0, "ppm")
    assert bad.value is None and "ZERO_DENOMINATOR" in bad.reasons
```

**验证：** `python -m pytest tests/scientific/test_calculations.py tests/scientific/test_references.py -q`；真实 trace 第2行归一比值应为0.2029152282316839；不得读取 BZ2 当计算结果来通过测试。

## Q06 / S2：REE、散点与共同 PlotScene

**文件：** `app/services/scenes.py`、`app/api/routes_plots.py`、`tests/scientific/test_scenes.py`、`tests/integration/test_compute.py`。

**接口：** `build_scene(spec: PlotSpec, repo: Repository) -> PlotScene`；Repository 提供固定 dataset_version 的 measurements/metadata/selection/reference 查询，禁止 build_scene 内查询“最新版本”。

- [ ] 按冻结 ID 集取数，Expression 求值；所有有效/无效点生成来源链。
- [ ] REE 固定14元素顺序，缺值保留 null，不能挤掉分类位置或越缺值连线。
- [ ] 散点按 analysis_id 对齐 X/Y；不可两列各自 dropna 后用位置拼接。
- [ ] 按不同材料/组生成独立样式 series，count 区分分析、样品和图上点。
- [ ] 轴域自动计算只用当前可见有效层；用户显式范围优先，超界点保留并提示数量。
- [ ] scene_hash 忽略请求时间但包括所有数据/样式/参考快照；空数据回空 scene 与原因。
- [ ] 提供 publication-preview 之前先交给 Trae 真实 compute 接口，实现第一条“导入→选样→REE→悬停”的联调。

**验证：** `python -m pytest tests/scientific/test_scenes.py tests/integration/test_compute.py -q`。构造 X 缺第1条/Y 缺第2条的夹具，验证不会产生跨样品拼接点；缺 Sm 的 REE 断线，不减少 x 轴元素数量。

## Q07 / S3：多元素蛛网与 TAS

**文件：** `app/resources/diagrams/tas_manifest.json`、`app/services/diagrams.py`、`app/resources/references/`、`tests/scientific/test_diagrams.py`。

- [ ] 多元素蛛网复用 REE scene 管线；用户序列、参考表覆盖率、单位和化学式先验证。
- [ ] 参考表缺 Rb 时不能填1或借另一套标准；返回 NORMALIZER_INCOMPLETE，指出 Rb。
- [ ] 注册经核实的 TAS 几何与 manifest；资料不齐不得画近似线冒充正确分区。
- [ ] TAS 从明确的氧化物 wt% 求和，默认 whole_rock；矿物拒绝正式分类，月球用途为 reference。
- [ ] 可选无挥发分重算须有完整项确认、Fe policy，不能缺项按0；原始模式在图注明确。
- [ ] 以相同边界坐标为前端与 Matplotlib 生成几何；几何变更即模型版本变更。

**验证：** `python -m pytest tests/scientific/test_diagrams.py -q`。固定合成点 SiO2=50、Na2O=2、K2O=1，raw 模式必须 x=50、y=3；边界测试用 manifest 中实际坐标，不另编不一致边界。保存坐标与原文献/库版本核对记录。

## Q08 / S3：出版渲染、最终预览和复现包

**文件：** `app/renderers/{matplotlib_renderer,export_bundle}.py`、`app/resources/styles/`、`tests/integration/test_exports.py`、`tests/scientific/test_render_consistency.py`。

**接口：** `render_scene(scene: PlotScene, format: str, output: Path) -> ExportResult`；ExportResult 含路径、尺寸、字体、格式、哈希及预检报告。Renderer 不再查询数据库或计算元素比值。

- [ ] 用固定 mm 画布渲染四类图，布局提前计算，保留上下标、图例和缺值断线。
- [ ] 区分 nature_main_2026 与 thesis_cn；指定字体不存在时记录替代，不静默混用。
- [ ] PDF TrueType 嵌入、SVG 可编辑文本、PNG 真600 dpi；用 XML/PDF 元数据检查实际文件。
- [ ] publication-preview 与最终 export 调用相同 renderer，仅分辨率不同；不要截图前端。
- [ ] 导出冻结 scene_id，包含数据、参考表、质量策略和来源清单；文件名安全、异步任务可取消。
- [ ] 测试 89 mm@600 dpi≈2102 px、183 mm≈4323 px；PDF 页面尺寸匹配，标签无裁切。
- [ ] 提供四张真实样例图的文件与视觉检查证据，给 Trae 检查实际预览及下载。

**验证：** `python -m pytest tests/integration/test_exports.py tests/scientific/test_render_consistency.py -q`。PNG 文件存在不够；核对 scene 和导出 CSV 逐点值/ID相同，SVG有 text，PDF可抽取文本且无 Type3。最终人工目视不得省略。

## Q09 / S2：项目保存、移机复现与恢复

**文件：** `app/services/projects.py`、`app/api/routes_projects.py`、`tests/integration/test_project_roundtrip.py`。

- [ ] 保存源文件哈希、数据版本、映射、参考值版本/快照、选择集、PlotSpec 和可再算 Scene。
- [ ] snapshot 与 dynamic 两种选择保存语义不同；导出永远记录当次 resolved_ids。
- [ ] 导出包含数据的项目包，恢复到新临时目录和新数据库；路径不能依赖 D:\moon 原路径。
- [ ] 可导出不含数据的配置包，但必须标记不自足，打开后给数据缺失列表和重新关联入口。
- [ ] 项目包拒绝路径穿越；用 expected_revision 防止静默覆盖并发编辑。
- [ ] 进程重启后恢复成功/中断任务状态；旧 scene 和已经下载文件不被重试覆盖。

**验证：** `python -m pytest tests/integration/test_project_roundtrip.py -q`。退出程序→恢复包→重算，analysis_ids、参考快照、数值和 scene_hash一致（非确定的文件时间元数据不参加比较）。

## Q10 / S4：运行交付与真实独立验收

**文件：** `scripts/{install,start,verify}.ps1`、`docs/USER_GUIDE.md`、`docs/progress/QODER_FINAL.md`、性能与科学验收记录。

- [ ] 完成Q11内置库、Q12便携包与三按钮启动窗口；交付同一包到有/无Python和Node的Windows10/11，启动/停止/备份步骤明确，不杀其他进程。
- [ ] 前端production build由同源服务提供；解压即能离线运行，普通用户不用装开发依赖。
- [ ] 在干净数据库导入真实文件，按08+16执行全部86项P0；不要用人工整理替代输入。确认Trae T08/T09通过后再定正式版。
- [ ] 跑全套后端测试和性能场景；记录 CPU/RAM、数据量、耗时分位值和失败项。
- [ ] 与 Trae 联调真实 API，修复服务端问题；列出 UI/合同问题归属，不越界重写前端。
- [ ] 核对源文件 SHA-256 未变；生成真实最终交付清单及已知限制。

**结束条件：** 08和16全部P0及性能/人工门槛通过；无未解决的数据覆盖、二次归一化、错误样品合并、写盘或恢复问题；四格环境测试与实际交付文件存在。否则如实保留候选状态。Q11/Q12的逐步清单见15，不能遗漏。
