# 基于pyrolite的绘图内核返工任务书

日期：2026-10-29。执行：Qoder负责数据/计算/场景/出版输出，Trae负责真实接口/交互显示。现状见[17审计报告](17_pyrolite对照审计与问题定位.md)。**本文件是v2需求的缺陷修复增补，绘图合同以本增补为准；上传、选样、历史、实际导出、双环境Windows交付等原P0要求继续有效。** 不处理AstroMat，不重写一套应用。

## 1. 要交付的结果

REE、蛛网、TAS和比值散点的科学结果正确，浏览器与保存文件一致。必须交付修复后的真实应用流程，以及同输入的pyrolite基准图、应用图、逐点/逐边界对照表。只“安装pyrolite”、换配色或生成一张独立示例图不算完成。

产品要求的默认REE固定La Ce Pr Nd Sm Eu Gd Tb Dy Ho Er Tm Yb Lu，14项。Y不是镧系元素；若未来支持REE+Y，另存模板并要求参考覆盖Y，不暗改默认序列。REE横轴首版为等距元素顺序；离子半径模式暂不扩展。蛛网继续采用13文档的27元素序列和PM_SM89，不因pyrolite示例用了另一套参考而换掉用户设置。

## 2. 固定架构与pyrolite边界

```text
原始测量与元数据
  → 映射/单位/材料/通道/质量确认
  → typed measurements + 固定selection版本
  → ScientificEngine（参考快照、单位、AST；可调用pyrolite）
  → PlotScene 1.2（数值、类别、每条analysis、轴、样式、TAS几何全部冻结）
      → PlotlyAdapter：浏览器交互
      → PublicationRenderer：Matplotlib + pyrolite适配
  → 本机PNG/PDF/SVG + 复现包 + 导出记录
```

- 使用明确版本的pyrolite，记录`importlib.metadata.version("pyrolite")`、Python/NumPy/Pandas/Matplotlib版本、wheel哈希和许可。当前`.venv`实际为Python3.14.4，不能用任务书中写过3.12当作已测试环境证据。先在隔离的项目环境证明依赖兼容，再固定构建解释器和锁文件；不修改用户全局环境。
- 命名参考仍固定Chondrite_MS95@1、PM_SM89@1；安装库中的值先转换到ppm，再与13的CSV逐值核对。出现差异必须记录并解决，不静默更新历史标准。
- 科学层可调用`get_reference_composition`、`set_units`、`normalize_to`；必须先明确输入字段真实单位/化学形态。源已标准化且无raw的记录，不允许再标准化或换标准。
- 出版层优先使用pyrolite的`spider`/`REE`入口完成常规曲线，`TAS(which_model="LeMaitre")`用于官方模板与基准。renderer只接受Scene，不能再次按最新数据库或最新参考库重算。
- TAS生产几何从锁定版本模型提取成版本化资源；浏览器与导出绘制同一快照。不能导出时偷偷重新读未经冻结的manifest。历史资源版本改变时保留旧版，当前错误几何标记为deprecated且不得继续作为已验证模板。
- 不复制整套pyrolite源码到项目。把版本相关读取封装成一个adapter；安装/打包后通过实际资源加载测试。运行时不得联网下载库、字体或TAS资源。

官方依据：[标准化](https://pyrolite.readthedocs.io/en/main/examples/geochem/normalization.html)、[REE模式](https://pyrolite.readthedocs.io/en/main/examples/plotting/REE_v_radii.html)、[蛛网示例](https://pyrolite.readthedocs.io/en/main/examples/plotting/spider.html)、[TAS模型](https://pyrolite.readthedocs.io/en/main/examples/util/TAS.html)。这些页面可能展示开发版；以实际锁定版本和验证结果为交付依据。

## 3. 必须先统一的合同（schema 1.2）

### HTTP

`POST /api/v1/plots/compute`请求固定为`{request_id, spec}`，响应200直接返回PlotScene。后端从spec中selection_id读取冻结dataset_id+version，不再要求前端另传与选择集可能矛盾的dataset_versions。保存/导出引用scene_id与spec_hash；非法请求按05的统一错误体返回。Trae不能把`{scene,status}`强行当Scene。

### PlotScene必须包含

| 字段 | 明确语义 |
|---|---|
| schema_version | 1.2；Spec、Scene、OpenAPI、fixtures和生成类型同步升级 |
| chart_type | scatter / ree / spider / tas；缺失或不支持即拒绝渲染，不默认scatter |
| variables | 解析后的轴表达式、elements顺序、value_mode、参考ID/版本及自动标签；无相关字段用null |
| axes.x/y | 原量纲range、ticks/ticktext、类别顺序/可见范围、reversed、格式、字号、网格、标题、单位；不让renderer回读可变Spec |
| series | REE/spider严格每个(layer_id,analysis_id)一个series；散点每层可分样式组，每point带稳定analysis_id和resolved_style |
| diagram_geometry | TAS时必填model_id/version、source_hash、polygons[{field_id,label,vertices}]、labels[{field_id,x,y,text}]、已去重的segments；其他图null |
| resolved_selections | 保存所有选择的ID及dataset_id+version；渲染series只含可见层，隐藏层仍可从此处恢复选择 |
| reference_snapshots | 数值/单位/ID/版本/真实hash/出处/验证等级，禁止hash="builtin"或伪verified |
| layout/legend/font_manifest | 已解析的可复现版式/图例和实际字体可用性，不预写available=true |
| counts/exclusions/provenance | 分清分析、物理样品未知、曲线点、质量排除、范围外和样式透明，错误原因及原单元格可回查 |

Scene hash包含影响科学结果和输出的所有字段，包括chart_type、variables、geometry、layout、legend、fonts、各层最终样式；排除request_id、scene_id、生成时间等随机元数据。同输入重算稳定，改布局/模型/参考必须改变hash。

保留schema1.1历史对象，只能在信息齐全时显式迁移；没有图类型、参考快照或几何来源的旧图不能无提示补成“已核实”，显示需重算并创建新保存版本。

## 4. Qoder返工任务

每项交付代码、测试、实测结果路径。路径相对D:\moon；现有文件修改，新模块确有职责才创建。

### QR01：锁定pyrolite、建立独立正确性基准

**文件：** backend/pyproject.toml及依赖锁文件、backend/app/services/pyrolite_adapter.py、backend/tests/scientific/test_pyrolite_reference.py、scripts/export_pyrolite_oracles.py。

- [ ] 在隔离环境安装兼容版本，记录精确版本与资源来源；先确保TAS、参考组成、REE、spider入口实际可运行。
- [ ] 从安装包生成Chondrite_MS95/PM_SM89核对表和LeMaitre几何快照，含原文件/规范化JSON两类哈希，不用审计网页快照冒充安装包原文件。
- [ ] 以独立DataFrame生成明确SYNTHETIC基准：REE14值、27元素蛛网、三个TAS错分点、Rb/Sr与(La/Yb)N散点。基准不调用应用build_scene，不从应用输出反推期待值。
- [ ] 输出oracle_input.csv、oracle_values.csv、pyrolite_reference.png/pdf/svg、environment.json、resource_manifest.json；原子量、参考版本同时记录。

**验证：** 在backend执行`python -m pytest tests/scientific/test_pyrolite_reference.py -q`，随后实际打开基准图。若安装版本模型与网页快照不同，逐项报告差异和适用版本，不能选择性删掉反例。

### QR02：修复测量解析、单位、标准化和AST

**前置：** QR01参考基准。**文件：** services/scenes.py、calculations.py、必要的measurements.py、domain/expression.py及科学测试。

- [ ] 删除以analyte单键扁平化测量的计算入口；按analysis_id、analyte、chemical_form、value_state、channel选量。多候选无明确通道策略时返回冲突，不能取最后一个。
- [ ] value与source_unit保持绑定；expr.unit只是目标单位，不得把原值直接贴新单位。确认状态与质量flag在求值前执行。
- [ ] 对REE/spider的raw和normalized路径都建立测试；normalized逐项C/R，单位统一后再算。参考缺项立即给NORMALIZER_INCOMPLETE，不悄悄画raw。
- [ ] AST中normalize通过其measurement子节点确定元素；遍历各节点解析各自reference_id/version，不能读不存在的expr.analyte，也不能只依赖variables.reference_id。
- [ ] ratio先独立求两操作数，再做量纲校验；add必须保留兼容量纲。raw/normalized同名列不覆盖；负值/LOD/零分母按03处理。
- [ ] 修复TAS原始/无挥发分两路径和材料筛选，十项总和80固定算例为(62.5,3.75)；缺项不填0，铁不重复计入。

**验证：** 创建`tests/scientific/test_measurement_resolution.py`和`test_normalized_scene.py`；覆盖本书第6节R01–R06，真实trace第2行数值仍按原oracle，不能用其Excel派生结果当期待值。

### QR03：补全Scene、曲线身份、轴与真实HTTP合同

**前置：** QR02，合同设计可与QR01并行。**文件：** domain/plot_spec.py、style.py、api/routes_plots.py、services/scenes.py、contracts、tests/integration/test_compute.py。

- [ ] 实施第3节schema1.2，生成真实OpenAPI/JSON Schema/TypeScript输入fixtures；通知Trae读取更新后的hash。
- [ ] REE/spider每analysis一series，固定元素顺序，缺值保留null；各样品之间不靠null技巧混成一条大曲线。14元素默认不带Y。
- [ ] 将layer和analysis覆盖样式解析进Scene；隐藏层不进入渲染series，选择快照保留；范围外点仍在投图数据。
- [ ] 对数轴仅用正有效值；在log空间算自动padding后还原。类别轴携带文本，手动范围/反转/格式全部保留；无有效值给明确空场景。
- [ ] 正确冻结数据/参考版本，修复hash缺布局等问题。按实际AST推导标签，禁止raw数据标normalized或无量纲标ppm。
- [ ] 真实HTTP按本书合同返回；request_id由客户端传入并回显，用于丢弃旧结果。

**验证：** 真实后端返回的JSON写入`contracts/fixtures/scene-1.2/`作为Trae测试输入；覆盖R07–R10、R18。不能只手写一个看起来完整的mock Scene。

### QR04：替换错误TAS资源并建立共享几何

**前置：** QR01、QR03。**文件：** services/diagrams.py、resources/diagrams、科学测试test_diagrams.py。

- [ ] 用锁定pyrolite LeMaitre模型资源替换现有错误边界；保留原始field_id，不根据英文名重新凭空拼polygon。空poly占位项不绘图。
- [ ] 先独立闭合各多边形，再把共享边转成规范化无向线段去重；禁止把所有polygon顶点连成一条线。
- [ ] 三个合成点分别核对Bs/O3/O3；随机内点与官方模型交叉比对。边界用点到线段距离定义on_boundary，容差记录为轴数据单位；不靠点偏移获得唯一岩名。
- [ ] 图注说明LeMaitre变体、来源与月球参考用途；用户改视野不改几何。用冻结几何生成两端图形，不从最新磁盘manifest覆盖旧Scene。

**验证：** R11/R12，保存几何坐标差异报告，显示模型版本/来源/哈希。当前`verified=true`不得沿用到未核验资源。

### QR05：出版渲染正确性与pyrolite适配

**前置：** QR02–QR04。**文件：** renderers/matplotlib_renderer.py、必要的pyrolite_renderer.py、tests/scientific/test_render_consistency.py、tests/integration/test_exports.py。

- [ ] chart_type严格分派，缺值断线采用完整长度数组中的NaN；线与scatter分开，使孤立点可见。禁止filter掉缺失值后连线。
- [ ] 调用pyrolite时明确元素顺序，不启用默认不相容性重排；给它已冻结的结果矩阵，不再normalize第二次。传line_kw/scatter_kw时独立分配样式，检查库版本实际生效。
- [ ] Matplotlib scatter面积用marker_size_pt²；点的填充/边框/alpha和线alpha独立；采用最终resolved_style，空心透明而不是白填充。
- [ ] 所有轴类型都应用手动范围、反转、刻度、标题和网格；之后不被TAS固定范围或REE默认log重置。图例、注释和字体来自Scene。
- [ ] 固定183×110mm等画布，不用tight bbox改变最终尺寸；在画布内部解决长标签。PDF设置TrueType并实测，SVG保留text，PNG核对实际尺寸与DPI。
- [ ] 出版预览和实际写盘调用同一路径，renderer不查询最新数据；多格式原子落盘/历史按原任务书继续验收。

**验证：** R13–R17及原D06/D07/V20–V28。实际比较pyrolite基准、应用出版预览与落盘文件，不要求不同字体抗锯齿像素完全一致，但数值/几何/断点必须一致。

### QR06：纠正示例、完成报告与发布证据

**前置：** QR05、TR03。**文件：** generate_demo_plots.py、demo_plots、docs/progress、便携构建脚本。

- [ ] 示例使用显式SYNTHETIC名字，不再给造出的数据取真实Apollo编号；若演示真实样品则从实际工作簿读取并附源表行列。
- [ ] 四图由真实应用计算→冻结→renderer路径产生，不能单独写正确脚本绕开错误应用。保存Scene、投图CSV、标准化参考和原始量。
- [ ] 修正名为14元素却实际断言15的测试；期待值不能照当前错误结构改。更新完成报告，区分实现/通过/未验证，不再写“后端完成”覆盖失败证据。
- [ ] pyrolite及数据资源纳入便携包，验证有/无Python和Node的Windows10/11四格。当前环境未构建通过前不声称兼容。

**验证：** 本增补R01–R20与原86项P0，真实Excel→选择→四图→编辑→写盘→重启恢复。所有反例清零后再发正式包。

## 5. Trae返工任务

### TR01：真实合同与失败状态

**可立即开始合同审阅；实现接入依赖QR03。文件：** src/lib/api/http.ts、api/index.ts、generated/types.ts、tests/unit/contract.test.ts。

- [ ] 改为本书第3节真实请求/响应；类型由schema1.2生成，不手写扩展类型来掩盖后端没字段。
- [ ] production/live模式无法连接或合同校验失败时显示错误并保留草稿，禁止自动mock。演示必须用户显式进入，界面醒目标记，导出文件名也标DEMO。
- [ ] 以真实后端fixture做渲染测试；从HTTP拿到的Scene运行时校验，不只TypeScript强转。

### TR02：按冻结Scene正确显示四图

**前置：** QR03；TAS依赖QR04。**文件：** src/lib/sceneToPlotly.ts、features/plot/InteractivePlot.tsx及轴/系列面板。

- [ ] 一analysis一曲线，connect=false时不强行连接；缺值connectgaps=false，跨样品不得连线。默认14REE与标签一致。
- [ ] 渲染Scene.diagram_geometry为独立矢量path/trace和标签；不画一张TAS背景图片，不把field顶点串连，不重新分类数据。
- [ ] 非正log边界报合同错误，不用Number.MIN_VALUE修饰。只转换轴range至log10，点值不取log；临时视野提交时逆变换。
- [ ] 可见性和最终样式按Scene，不混入编辑中未计算完成的Spec；元素可见范围、点形/空心/颜色/大小/alpha、独立边框和覆盖值都一致。
- [ ] 真正以物理画布大小计算预览缩放系数；Plotly px随该比例变化，导出pt保持不变。
- [ ] 悬停/详情展示raw值与单位、参考值、normalized值、analysis_id与来源。禁止只写“标准化”但不给分母和参考版本。

### TR03：真实交互与图像一致性验收

**前置：** QR05、TR01/TR02。**文件：** frontend/tests/e2e/pyrolite-parity.spec.ts、docs/progress/TRAE_PYROLITE_REWORK.md。

- [ ] 关闭mock，从真实上传/内置库选择进入；分别选CE5/CE6/Apollo与材料。取两条analysis验证两条曲线，不只是mock样式截图。
- [ ] 同输入比较浏览器、后端出版预览、PDF/SVG/PNG及CSV；按本书R19/R20逐项记录。
- [ ] 修改轴范围、隐藏一层、给单analysis改蓝色6pt/50%透明，真实落盘后核对并重启恢复。
- [ ] 检查在不同浏览器画布宽度下pt物理含义和导出比例不漂移；缺字段、未知参考、断线均显示可处理错误。

## 6. 本轮必须通过的20项验收

| ID | 输入/操作 | 期待结果 |
|---|---|---|
| R01 | La2.37、Sm.148、Yb.322；参考.237/.148/.161，ppm | REE和spider都为10/1/2；换成2倍参考为5/.5/1 |
| R02 | La2370ppb与La2.37ppm分别导入 | raw ppm均2.37，La_N均10，源单位仍可查 |
| R03 | raw La=2.37与已有La_N=10同名列、另有误差列 | 三者独立；指定raw仍2.37，不覆盖/二次标准化 |
| R04 | X=Rb10/Sr100，Y=(La2.37/Yb.322)N | 散点(0.1,5)，无AttributeError；两轴各自参考版本正确 |
| R05 | 缺参考、未知单位、通道冲突、非正log值、零分母 | 明确排除/配置错误，不画raw冒充normalized，不补0或epsilon |
| R06 | TAS完整十项总和80且SiO2/Na2O/K2O=50/2/1 | raw(50,3)，dry(62.5,3.75)；缺项时拒绝dry |
| R07 | 同层两analysis、每条14REE | 两个series/两条独立曲线；没有A的Lu→B的La连线；默认无Y/Pm |
| R08 | 缺Sm，另有两个缺值之间的孤立有效点 | 缺口断线，孤立点可见；每元素位置不被压缩 |
| R09 | 收到实际HTTP Scene | 含schema1.2、chart_type、variables、完整axes/样式；后端请求和前端解析同合同 |
| R10 | log值.01和100；手设.1–1000；反转；类别截取 | 自动下界>0；Plotly范围[-1,3]但点值原样；导出/重开同义 |
| R11 | TAS(50,4)/(65,5)/(72,3.5) | 锁定LeMaitre模型对应Bs/O3/O3；保存模型版本与坐标证据 |
| R12 | TAS内点、共享边界点、外点；两端绘图 | 内点与官方模型一致，边界on_boundary、外点out_of_domain；几何顶点/线段相同 |
| R13 | REE/spider/TAS Scene分别导出 | 调用正确renderer；无图类型时拒绝；TAS有分区、REE有元素名 |
| R14 | 隐藏一层；给选中analysis覆盖蓝色；换层底色 | 隐藏层不画且不影响自动轴；覆盖保留；图例/计数/导出一致 |
| R15 | 6pt，点alpha.2、线alpha.8、空心与边框 | Matplotlib s=36pt²；点线独立且alpha只一次；空心中心透明 |
| R16 | 线性X0–.5、Y0–10，反转与注释、图例位置 | 所有输出保留设置，不被默认范围覆盖；图例与实际样式一致 |
| R17 | 183×110mm、600dpi PNG+PDF+SVG | PNG约4323×2598±1px；PDF无Type3、尺寸准确；SVG文字/图元可编辑 |
| R18 | 同数据重算；分别改布局/模型/参考 | 同配置scene_hash稳定，影响输出的变更改变hash；历史快照不被最新资源覆盖 |
| R19 | production/live连接失败，真实API字段不合法 | 显示错误、保留状态，不能回落mock伪装结果；真实后端fixture测试覆盖 |
| R20 | 真实Excel四图：选样→编辑→写盘→退出重开 | 逐点值/IDs/参考/样式/图件/导出记录一致；普通用户两类环境均可运行 |

R01–R20是对原验收的针对性补强，不能用通过这20项替代原86项P0。验收材料放`docs/progress/pyrolite-rework/`，每条附测试名、命令、实际值、图文件和来源快照。

## 7. 同步开工与复制指令

**现在可同时开工：** Qoder做QR01/QR02和schema1.2设计，Trae做TR01合同审阅及TR02图形适配框架。QR03冻结合同并产出真实Scene fixture后联调；QR04完成几何后接TAS；QR05完成出版渲染后才做TR03和正式打包。不要等全后端完工才第一次联调。

Qoder：

```text
请在D:\moon按docs/geochem-plotter/17_pyrolite对照审计与问题定位.md和18_pyrolite绘图内核返工任务书.md返工，不要重新搭一套应用。现有REE/spider漏标准化、单位/原始派生状态丢失、NormalizeExpr异常、TAS边界错误已有可重复证据；刷新审计22项中2项通过、20项失败，图类型字段和正常渲染分派已修复，须保留回归测试。执行QR01–QR06，使用锁定pyrolite作科学基准与适配层，先修数据/计算再补Scene1.2和真实HTTP合同，再修出版渲染。不得只修generate_demo_plots绕开应用；不处理AstroMat。把真实Scene fixture和合同hash交给Trae，最后用R01–R20及原P0验证。更新完成报告时必须附实际数值、文件、版本和失败/未验证项，不能以既往“139通过”或verified=true代替证据。
```

Trae：

```text
请先读D:\moon\docs\geochem-plotter\17_pyrolite对照审计与问题定位.md和18_pyrolite绘图内核返工任务书.md，执行TR01–TR03。不要在前端另算标准化、单位或TAS边界。与Qoder统一Scene1.2及真实HTTP合同，关闭生产自动mock，测试必须消费真实后端fixture。保证一analysis一曲线、缺值断线、TAS共享矢量几何、正数log范围和最终样式；不要靠Number.MIN_VALUE隐藏后端轴错误。Qoder出版路径修复后，逐项比较浏览器/预览/PNG/PDF/SVG/CSV和重启恢复，交R01–R20中前端证据。不处理AstroMat，不只交美化截图。
```

文件所有权沿用09：Qoder改backend/contracts/构建，Trae改frontend；合同请求写TRAE_CONTRACT_REQUESTS，Qoder单独维护变更日志。共同使用同一候选包和同一输入快照。

## 8. 本任务书自查与执行边界

- 已纠正过时状态：不能把初查的“22项均失败、现有测试2项失败”写成最新结果；当前为探针20项失败/2项通过，现有科学测试38项通过。以17及其证据快照为准。继续工作前核对source hash，外部修改后按相关用例复验。
- 已明确合同优先级：18只覆盖绘图计算/Scene/渲染相关条款；schema1.2是待实施版本，不能宣称现有软件已升级。05/15示例保留为历史基线。
- 已避免依赖假定：本轮未安装执行pyrolite，网页模型快照只能诊断；QR01必须补精确版本、安装包资源与基准输出，才能构成最终对照。
- 已明确测试盲区：检查MISSING标志不等于验证渲染断线；38个旧测试通过不抵消20个探针失败。R08要求检查实际绘制路径与孤立点。
- 已保留发布门槛：真实HTTP全链路、完整工作簿交互、Windows四格环境尚需执行者验证；本任务书的文档检查PASS不代表软件验收PASS。
- 9项返工任务与20项补充用例均有依赖/期待值；不承诺工期或预写通过。科学层未完成前，Trae可做框架及合同审阅，不能用演示结果替代真实接入。
