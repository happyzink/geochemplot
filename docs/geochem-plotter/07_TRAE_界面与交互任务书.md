# GeoPlot 界面与交互 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> Trae 环境若无这些技能，直接按本清单逐项实现、验证并记录。禁止把技能缺失当成不交付理由。

**Goal:** 让地球化学研究者从 Excel 上传、按任务/材料/样品选择到论文导出，在一个清楚的中文工作台完成。

**Architecture:** React 管理交互状态与 PlotSpec；所有数值、筛选全集及绘图 Scene 来自 Qoder 后端。Plotly 用于交互，出版预览调用后端 renderer。

**Tech Stack:** React、TypeScript、Vite、Plotly.js、TanStack Table/Virtual、Vitest、Playwright；选择轻量状态管理并固定版本。

**Spec:** [需求](02_产品需求与交互流程.md)、[科学规则](03_数据模型与科学计算规则.md)、[图稿规范](04_图解与论文出图规范.md)、[接口](05_接口与共享契约.md)。

**v2必读：** [主任务书](../../GeoPlot_科研绘图工具_正式任务书_v2.md)、[13内置清单](13_内置数据与参考组成清单_v2.md)、[15合同和新增T10/T11](15_v2接口与任务增补.md)、[16新增验收](16_v2交互导出启动验收.md)。完整工作量为T01–T11，阶段采用S0–S4；AstroMat排除。

## 全局约束

- 只写 frontend、前端 tests、自己的进度/视觉证据；合同和后端由 Qoder 维护。
- 不在前端算标准化、比值、样品分类、独立样本数；不把 mock 数据当真实数据交付。
- 页面默认中文浅色；科研图白底、克制配色、图例清楚；不能用管理系统大数字卡片代替作图区。
- 已选择记录按 analysis_id 存储，表格行号/分页索引不能作身份。
- 整个应用状态可恢复，所有关键按钮有 loading/disabled/error/success 状态；后端失败保留用户选择。
- 下述命令均在 `frontend` 执行，由 T01 建好 package scripts；尚未执行，不预标通过。

## T01 / S0：导航骨架与合同适配

**文件：** `frontend/package.json`、`src/App.tsx`、`src/lib/{api,generated}.ts` 或 generated 目录、`src/state/workspaceStore.ts`、`tests/unit/contract.test.ts`。

**输入/输出：** 消费 Q01 schemas/fixtures；输出上传、样品、作图、项目四个可导航页面和一致状态模型。

- [ ] 读取01–05/15，列页面需要的字段；缺口写入TRAE_CONTRACT_REQUESTS.md，由Qoder更新CONTRACT_CHANGELOG，避免两人同时写共享日志。
- [ ] 建 Vite+React+TypeScript 项目、格式检查、Vitest、Playwright 与 `generate:api` 脚本；锁定依赖。
- [ ] 从 OpenAPI/JSON Schema 生成类型；测试合法/非法 fixture。schema 缺失时先画结构，用隔离 mock 模块，不把临时类型散落到组件。
- [ ] 建通用 API 错误、Job轮询/取消、request_id 失效处理；卸载组件终止请求。
- [ ] 布局使用顶栏+可折叠双侧栏+中央画布+底部数据表；提供1366/1440/1920三种桌面尺寸检查。
- [ ] 明确状态边界：projects、datasets、filters、selectionSets、plotSpec、latestScene、viewOnlySelection、pendingJobs。

**验证：** `npm run test -- tests/unit/contract.test.ts`、`npm run build`。mock 模式界面显示“演示数据”，生产默认真实 API；打包不得将 mock 开关静默开启。

## T02 / S1：四步导入向导

**文件：** `src/features/import/{UploadWizard,SheetPicker,MappingTable,ImportIssues,ImportResult}.tsx`、`tests/e2e/import.spec.ts`。

- [ ] 拖拽/选择 .xlsx，检测扩展名/大小，展示文件名、上传状态；锁文件和不支持格式给可理解提示。
- [ ] 子表选择展示6表角色、行数、是否导入；Normalization value 提议参考表，trace提议派生视图；用户可改。
- [ ] 表头行与数据起始行可调整；逐列显示“列字母+原表头+数据例子+规范量+单位+状态”。Z:La 和 BK:La 在界面绝不合成一个选项。
- [ ] 单位/任务/材料提供批量确认；LABLE 与 CE6 推断冲突说明来源，不让用户逐个点几千行。
- [ ] 文献块继承范围有起止行预览；默认不填样品号或浓度。
- [ ] 问题页按严重性/类型统计，能筛选Excel错误、空名、未知单位、多通道、重复关系，点击定位表和单元格。
- [ ] 呈现 trace 535 行重叠证据；两条多候选不能假装已解决，默认主表投图。
- [ ] commit时显示进度和取消；成功显示行数对账以及“进入选样”；失败保留映射，可返回修正。

**验证：** 用真实Excel扫描一次和合成重复表头/未知单位输入一次；截图 MappingTable，能看到两种La状态；错误单元格显示数量而非浏览器崩溃。运行 `npx playwright test tests/e2e/import.spec.ts`。

## T03 / S1：筛选树、搜索和稳定选择

**文件：** `src/features/samples/{FilterTree,SampleTable,SelectionBar,SampleDetail}.tsx`、`tests/unit/selection-state.test.ts`、`tests/e2e/selection.spec.ts`。

- [ ] 筛选分面分别调用 facets/query；任务、材料和矿物同屏可见，unknown单列。
- [ ] 搜索模式明确为精确名字/母样品/包含关键词；去抖300ms并丢弃旧请求回包。
- [ ] 表格虚拟化，分页/排序稳定，支持查看原名、母样品、文献和分析对象；长文献在详情展开。
- [ ] 勾选用analysis_id；页码变化不清选择；表头全选菜单区分当前页与全部筛选结果。
- [ ] 展示已选分析数、独立样品数、待确认数，不用总行数冒充样品数。
- [ ] 选择集可命名、复制、更新；动态与固定快照要有简短说明，默认固定。
- [ ] 从列表点开任一分析，查看来源表行、原始值、单位、误差/检出限和分类证据。

**验证：** 精确74235→4条；母样品74235→14条；跨页选择保留；换筛选只改可见结果，不暗改图上ID。操作过程中颜色和勾选不因排序漂移。

**状态测试边界：** selection reducer 只做集合操作；测试同一ID重复勾选不重复、跨页取消一个ID仅影响该ID、清空全部与清空当前筛选不同。不要用 DOM 快照代替行为断言。

运行 `npm run test -- tests/unit/selection-state.test.ts` 和 `npx playwright test tests/e2e/selection.spec.ts`。

## T04 / S1：变量编辑器与四图入口

**文件：** `src/features/plots/{PlotWorkspace,VariablePicker,ReferencePicker,DiagramPicker}.tsx`、`tests/unit/expression-builder.test.ts`、`tests/e2e/variables.spec.ts`。

- [ ] 提供散点、REE、蛛网、TAS入口；不通过隐藏子菜单让常用图难找。
- [ ] 变量选项显示化学量、单位、通道、raw/normalized标志和覆盖率；原始Si与SiO2分开。
- [ ] 比值编辑器两个操作数，标准化编辑器显示参考名和版本；构建05规定的AST。
- [ ] 参考值可展开完整表；未知出处明确为自定义；单位未确认时禁用相关计算并提供修正入口。
- [ ] REE固定默认14元素、蛛网用户可重排序列；缺参考元素显示列表，不自动填值。
- [ ] TAS默认全岩和参考模式，显式切换玻璃参考/无挥发分模式时说明输入要求；不显示“矿物岩石分类结果”。
- [ ] 区分源提供的Mg#/An#和软件新表达式；表达式编辑器不暴露任意脚本框。

**验证：** 构建 `(La/Yb)_N` 的AST是 normalize(La)/normalize(Yb)，不是 normalize(La/Yb)除以某单一参考值；更换参考组成使spec_hash变化、旧预览标失效。运行 `npm run test -- tests/unit/expression-builder.test.ts`。

## T05 / S2：图层对比、点表联动与渲染适配

**文件：** `src/features/plots/{LayerPanel,InteractivePlot,PointInspector}.tsx`、`src/lib/sceneToPlotly.ts`、`tests/unit/scene-adapter.test.ts`、`tests/e2e/comparison.spec.ts`。

- [ ] 图层独立绑定选择集/颜色/点形/透明度/显隐；支持自有CE6+文献CE5+文献CE6+Apollo四组。
- [ ] sceneToPlotly只做渲染适配，禁止除参考值、对数据值取log10、重排缺失点；仅Plotly对数轴range按官方API转换为指数，回写视野时还原原量纲，规则见15。
- [ ] REE/spider connectgaps=false；x刻度按Scene固定元素序列；log axis输入是未取log的正数。
- [ ] 默认每条分析一条曲线。大量曲线提示筛选或分组，不静默只画前100条；预览栅格/WebGL优化不改变投图ID。
- [ ] 悬停显示原名、任务、材料、元素/比值、原始/转换值和文献；点开详情可定位原表行列。
- [ ] 框选/套索只高亮；“把高亮加入/替换选择集”才修改投图。取消高亮恢复原视图。
- [ ] 图例点击显隐会更新layer visible并纳入导出配置；临时hover不保存。
- [ ] 处理请求A慢、B快的竞态，不能让A覆盖B；后台计算时旧图带旧版本标志，导出禁用。

**验证：** scene-adapter固定输出点ID/数值/断点；测试同一scene前后转换数据不变。点击图例隐藏Apollo后出版预览和导出也隐藏；数据表仍可查看其选择集。

运行 `npm run test -- tests/unit/scene-adapter.test.ts`、`npx playwright test tests/e2e/comparison.spec.ts`。

## T06 / S3：样式编辑、最终预览和导出

**文件：** `src/features/plots/StylePanel.tsx`、`src/features/export/{ExportDialog,PublicationPreview,ExportPreflight}.tsx`、`tests/e2e/export.spec.ts`。

- [ ] 所有科研样式用pt/mm输入，不用CSS像素表示论文单位；普通工作台字体与图稿字体分开。
- [ ] 应用nature_main_2026、thesis_cn预设，用户改动显示“自定义”；可另存样式到项目。
- [ ] 坐标范围、对数开关、刻度、图例位置、长名称换行、标记大小和透明度可编辑；保存/撤销可恢复。
- [ ] 前端缩放默认临时，“使用当前视野导出”明确写入spec后重新计算Scene。
- [ ] “最终版式预览”请求后端renderer；显示目标物理尺寸、字体替代、排除点数、标准来源。
- [ ] 导出可选PDF/SVG/PNG、dpi、是否带复现包；nature主图推荐矢量，PNG标通用预览/其他用途。
- [ ] 用户选择本机目录后，后端实际写盘并核验；UI显示真实路径和打开文件夹，下载副本另走artifact_id。失败/取消/重试和记录按15；禁止截图替代论文图。
- [ ] 正在导出时记录固定scene_id；用户继续调整后，新图与正在导出图分别标版本。

**验证：** 四图真实落盘和下载副本；比较PDF/SVG和预览的最终尺寸/文字/上下标，至少一张含长标签、负指数刻度和两种材料。运行`npx playwright test tests/e2e/export.spec.ts`，保存路径/哈希与人工检查；编辑细则T10、历史T11不可遗漏。

## T07 / S3：项目保存、撤销与恢复

**文件：** `src/features/projects/{ProjectLibrary,RestoreDialog}.tsx`、`src/state/history.ts`、`tests/e2e/project.spec.ts`。

- [ ] 项目列表显示名称、最近修改、数据集数量、图数量；保存使用expected_revision。
- [ ] 撤销重做支持选样、变量、图层和样式，不撤销已经入库的源文件；至少保留最近50步。
- [ ] 保存后刷新/关浏览器重开，样品选择、图层显隐、标准版本、样式和轴域一致。
- [ ] 导入项目包显示数据包含/缺失情况；缺文件不自动替换成同名新文件。
- [ ] 断线/409冲突时保留本地草稿，给“重新载入/另存副本”，不可覆盖他方更新。
- [ ] 在无网络环境验证已安装应用可正常使用；字体或库不依赖在线CDN。

**验证：** `npx playwright test tests/e2e/project.spec.ts`；记录保存前后scene_hash/IDs一致，撤销图层隐藏后计数和样式恢复。

## T08 / S4：真实 API 联调与性能

**文件：** `tests/e2e/real-workbook.spec.ts`、`docs/progress/TRAE_INTEGRATION.md`。

- [ ] 关闭所有mock，清空测试项目，按真实工作簿从上传开始完成全过程。
- [ ] 分别跑CE5/CE6分组、Apollo74235母样品、全岩/矿物/玻璃分开选样、原始/标准化数据不混用。
- [ ] 取一条真实curve/point，把悬停、表格、CSV和Scene数值对照；不能只截图页面。
- [ ] 测量35,802行Apollo筛选和分页性能；不能把几万行一次渲染为DOM。
- [ ] 记录500条×14元素REE切换、2,000个散点交互耗时，数值和样本数不因优化变少。
- [ ] API问题记录完整request_id和最小复现交Qoder；UI问题本任务修复。

浏览器完整路径示例（T02/T03必须提供相同可访问名称）：

```typescript
import { test, expect } from '@playwright/test';

test('Apollo母样品选择保留14条分析', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', {name:'打开验收项目', exact:true}).click();
  await page.getByRole('tab', {name:'样品', exact:true}).click();
  await page.getByLabel('数据来源', {exact:true}).selectOption('Apollo');
  await page.getByLabel('搜索模式', {exact:true}).selectOption('parent');
  await page.getByLabel('样品搜索', {exact:true}).fill('74235');
  await expect(page.getByTestId('query-total')).toHaveText('14');
  await page.getByRole('button', {name:'选择全部筛选结果', exact:true}).click();
  await expect(page.getByTestId('selected-analysis-count')).toHaveText('14');
});
```

“打开验收项目”只出现在测试环境，测试setup先通过真实导入API创建固定验收项目；生产项目列表使用真实名称。若UI组件不使用原生select，可把selectOption改为等价用户操作，但不得跳过数据来源/搜索/批量选择路径。测试setup必须由本任务实现并记录，不能依赖手工残留项目。

运行 `npx playwright test tests/e2e/real-workbook.spec.ts`。SKIP不等于通过。

## T09 / S4：视觉验收与用户说明

**文件：** `tests/visual/`、`docs/progress/TRAE_FINAL.md`、`docs/USER_GUIDE.md` 中界面章节（与Qoder分段协作）。

- [ ] 在1440×900、1920×1080检查主工作区，1366×768检查折叠布局，无页面横向溢出和遮挡。
- [ ] 验证空项目、0有效点、单位未确认、后端断线、导出失败五种状态，操作仍可恢复。
- [ ] 四种图的最终文件逐一人工检查；正常色/灰度下主要组可区分，图例、单位、上/下标正确。
- [ ] 测试键盘进入样品搜索、复选框、导出对话框；提供可访问名称和明显焦点。
- [ ] 使用文档写成研究者操作步骤：第一次导入、74235全子样、CE5/CE6分开选、对比矿物与全岩、切标准、保存与导出。
- [ ] 运行frontend测试/build和全套Playwright；输出失败/未覆盖项清单及下一步，不写空泛“全部正常”。

**结束条件：** 使用Q12候选便携包，完成真实端到端、图文件/历史/恢复、08+16相关P0和四格环境配合检查；生产无mock。T10/T11清单见15。美化截图不能替代证据。
