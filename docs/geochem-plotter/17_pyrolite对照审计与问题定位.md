# pyrolite对照审计：当前投图为什么不对

首次检查：2026-10-28；刷新实测：2026-10-29。**结论：当前版本需要返工，不能按现有完成报告认定科研绘图已通过。** 本次核对实际代码、已有示例PNG、合成数值探针和pyrolite官方文档/模型数据；没有修改业务代码或原Excel。AstroMat不在本次范围。

执行方案见[18_pyrolite绘图内核返工任务书](18_pyrolite绘图内核返工任务书.md)。本报告说明缺陷，18说明谁修、怎么修、如何验证。

## 1. 已取得的证据

- [独立探针](../../.review/pyrolite-20261028/audit_plotting.py)调用当前实际计算和渲染函数；[结果JSON](../../.review/pyrolite-20261028/audit_results.json)记录22个针对性检查，刷新后2个通过、20个未满足预期。P04图类型/变量保留、P13正确分派REE已经通过，不应继续登记为未修复。这些是定位已发现问题的检查，并非随机测试通过率，也不等于22个彼此独立的根因。
- 2026-10-29重跑现有三个科学测试文件，结果为**38 passed**，见[原始测试输出](../../.review/pyrolite-20261028/scientific_tests_20261029.txt)。此前36通过/2失败已过时；最新测试把同层两analysis×15元素断言为30点，仍没有验证标准化正确、默认14元素或实际渲染断线。因此38通过与20个针对性探针失败可以同时成立。
- 已有demo图和完成报告仅作排错线索，不能证明当前路径正确。本轮重新生成的[实际REE路径输出](../../.review/pyrolite-20261028/actual_pipeline_ree.png)及数值JSON是刷新后的证据。
- [TAS边界对照图](../../.review/pyrolite-20261028/tas_geometry_comparison.png)：左为当前JSON，右为官方LeMaitre模型坐标；测试点是合成点，不能解释为月球观测数据。
- 刷新探针覆盖111个业务/测试/合同文件，运行前后哈希相同；原工作簿哈希未变。工作区在两次审计之间已有外部修改，因此不能将两次文件总数或状态混用。探针只在`.review/pyrolite-20261028`产生证据文件。

**核实边界：** 当前项目环境为Python3.14.4，未安装pyrolite，本次没有运行pyrolite库。官方TAS对照来自其公开JSON，经解析后用Matplotlib显示；它不是已安装pyrolite的输出，也不是最终产品资源。官方`main`文档各页面版本标签有差异，返工必须锁定实际安装版本，不能混用文档版本。HTTP集成探针在本环境未完成，不据此宣称端到端已验证；下面接口不一致由代码直接确认。

## 2. 计算和数据问题

| 编号 | 代码位置（相对项目根目录） | 当前行为及实测 | 正确要求 |
|---|---|---|---|
| B01 | backend/app/services/scenes.py:229–260 | REE/spider直接y=原浓度。La/Sm/Yb=2.37/.148/.322，参考.237/.148/.161，仍输出原值 | 标准化结果10/1/2；换成2倍参考后5/.5/1。探针P01–P03 |
| B02 | services/scenes.py:128及evaluate_expression | 先压扁成analyte→float，单位/通道/化学形态/原始派生状态丢失；2370ppb被当2370ppm，后来的La_N覆盖raw La | 以带单位和状态的测量对象求值，先选通道再换单位；P06/P07 |
| B03 | services/scenes.py:101；domain/expression.py | NormalizeExpr没有analyte属性，求值却读expr.analyte；触发AttributeError；嵌套参考也未独立解析 | 从子表达式取得化学量，按每个AST节点的参考ID/版本解析；P05 |
| B04 | services/scenes.py:40；generate_demo_plots.py:132 | 默认REE混入Y成为15项；示例raw模式却写Chondrite/PM-normalized且仍标ppm | 默认La→Lu的14镧系REE；含Y须另列REE+Y模式；raw标ppm，normalized无量纲 |
| B05 | services/scenes.py:267 | TAS的anhydrous_100选项未实施，完整十项总和80的合成数据仍为(50,3) | 应为(62.5,3.75)，保留总和/系数，缺项拒绝；P22 |
| B06 | services/scenes.py:397 | 对log轴也用线性padding，.01至100得到负下界-4.9895 | 正数域内取log计算边距再还原；不许前端用极小正数掩盖；P11 |

标准化应该先明确参考组成和单位，再得到标准化数组，绘图本身不会替用户补这一流程。pyrolite官方[Normalization示例](https://pyrolite.readthedocs.io/en/main/examples/geochem/normalization.html)分别展示参考组成、单位设置、normalize_to和绘图。

## 3. 场景、交互与导出问题

| 编号 | 代码位置 | 证据/后果 | 修复方向 |
|---|---|---|---|
| B07 | backend/app/domain/plot_spec.py:152；renderers/matplotlib_renderer.py:88 | 刷新后PlotScene已有chart_type/variables；P04/P13通过，REE调用1次、scatter调用0次。renderer仍保留缺字段默认scatter | 已修复字段丢失和正常分派；保留回归测试，并拒绝不完整输入 |
| B08 | services/scenes.py:329；frontend/src/lib/sceneToPlotly.ts:143 | 两条analysis被放进一个series；前端每series画一条连续曲线，会连接A末端与B起点 | 一analysis一series，样品间绝不连线；P08 |
| B09 | matplotlib_renderer.py:236–237、284–285 | 删除缺失y后才连线；直接调用REE渲染时把(0,1)与(2,3)跨缺失点连接 | 保留NaN断点，孤立有效元素单独标记；P14 |
| B10 | scenes.py；renderer | 后端忽略visible及analysis_style_overrides；前端按Spec藏层，但导出场景仍含隐藏层；指定点覆盖样式丢失 | 可见性及最终样式冻结进Scene；两个渲染器同样处理；P09/P10 |
| B11 | domain/plot_spec.py:89；scenes.py:397 | AxisScene只剩label/unit/scale/range/ticks，反转/格式/类别等丢失；线性导出不设置手动范围 | 场景带完整解析轴，渲染统一应用；P12/P17 |
| B12 | matplotlib_renderer.py:185、222–246 | 将pt先乘96/72再传Matplotlib面积；6pt实际s=64而非36；点alpha用line_alpha覆盖 | Matplotlib按pt、Plotly按px适配；点/线透明度独立；P15/P16 |
| B13 | matplotlib_renderer.py:144 | bbox_inches=tight改变固定输出尺寸；183×110mm@600dpi实测4298×2575，而非约4323×2598 | 固定画布内布局，导出校验真实尺寸；P18 |
| B14 | matplotlib_renderer.py | 当前输出PDF检测到Type3，与完成报告的TrueType声明不符 | 配置并验证实际字体嵌入，不能靠文字声明；P19 |
| B15 | frontend/src/lib/api/http.ts:132；backend/app/api/routes_plots.py:24–44 | 前端发{spec}且期待直接Scene，后端必需dataset_versions且返回{scene,status} | 统一真实HTTP合同后再联调，不能只测mock |
| B16 | frontend/src/lib/api/index.ts；tests/unit/sceneToPlotly.test.ts | 服务不可用、schema不合或缺端点时自动回落mock并显示原因；适配器测试主要用mock生成的Scene | 正式live失败必须显示失败；测试消费真实后端Scene |

官方[spider接口](https://pyrolite.readthedocs.io/en/main/api/plot/spider.html)提供独立线与标记配置、缺值处理和对数轴；它不能修复应用在送入图形库前已经丢失的单位、样品身份或数据类型。

## 4. TAS边界已经出现科学差异

当前`backend/app/resources/diagrams/tas_manifest.json`写`boundary_coordinates_verified=true`，但没有可复核坐标来源哈希，描述还混合LeMaitre与Middlemost。其大量矩形边界不等于官方LeMaitre模型。下面测试点远离边界，用官方JSON多边形判断，不涉及边界数值容差争议。

| SiO2，Na2O+K2O（wt%） | 当前实现 | 官方LeMaitre数据所在区 |
|---|---|---|
| 50，4 | Trachybasalt | Bs：Subalkalic Basalt |
| 65，5 | Trachyte | O3：Dacite |
| 72，3.5 | Rhyolite | O3：Dacite |

依据：[官方TAS示例](https://pyrolite.readthedocs.io/en/main/examples/util/TAS.html)、[官方LeMaitre模型JSON](https://raw.githubusercontent.com/morganjwilliams/pyrolite/main/pyrolite/data/models/TAS/config_lemaitre.json)。本次模型含17个非空多边形及2个空占位项；不要把空项当岩石分区。当前图形Scene还没有填diagram_geometry，前端适配器也没有绘制该几何，P21已复现。

![当前TAS坐标与官方模型对照](../../.review/pyrolite-20261028/tas_geometry_comparison.png)

此图为排错证据，不是用于发表的月球TAS图。月球材料继续按参考投图处理，不自动给正式岩石定名。

## 5. 如何使用pyrolite才有效

1. 直接使用锁定版本`TAS(which_model="LeMaitre")`的模型资源和标准绘图作为基准；不要自己凭截图或印象画分区。
2. 使用参考组成API核验命名表；输入先按真实单位统一，标准化只做一次。应用自己的参考快照、原始单元格和质量策略仍必须保留。
3. REE默认14元素等距，显式设置index="elements"。pyrolite另有[index="radii"示例](https://pyrolite.readthedocs.io/en/main/examples/plotting/REE_v_radii.html)，不能把离子半径横坐标与元素等距坐标混用。
4. 出版渲染可调用pyrolite的spider/REE工具，但传入的是已冻结的标准化矩阵；浏览器继续用Plotly。两者逐点值、断点、几何和样式必须相同。
5. pyrolite负责专业计算/图解能力，Excel导入、材料筛选、来源追踪、图件管理、真实写盘与便携启动仍由本应用完成。

## 6. 可重复核查命令与限制

在项目根目录使用现有环境：

```powershell
.\.venv\Scripts\python.exe -X utf8 .\.review\pyrolite-20261028\audit_plotting.py
```

该脚本的进程退出0只代表审计成功运行；产品状态看JSON中的`application_status`及各项passed。未来修复可能改变函数接口，执行者应把探针中的科学不变量迁入正式测试，不能简单删除失败检查。

现有测试复跑范围：`tests/scientific/test_scenes.py`、`test_diagrams.py`、`test_calculations.py`，使用工作区临时目录和`-p no:cacheprovider`。本次未声称完成完整业务端到端、真实工作簿全流程或四格打包验收。
