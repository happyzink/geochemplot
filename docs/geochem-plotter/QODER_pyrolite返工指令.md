# QODER：pyrolite绘图返工指令

更新：2026-10-29。复制下面整段给QODER，在现有项目中返工。

```text
请在D:\moon按docs/geochem-plotter/17_pyrolite对照审计与问题定位.md和18_pyrolite绘图内核返工任务书.md返工，不要重新搭一套应用。现有REE/spider漏标准化、单位/原始派生状态丢失、NormalizeExpr异常、TAS边界错误已有可重复证据；刷新审计22项中2项通过、20项失败，图类型字段和正常渲染分派已修复，须保留回归测试。执行QR01–QR06，使用锁定pyrolite作科学基准与适配层，先修数据/计算再补Scene1.2和真实HTTP合同，再修出版渲染。不得只修generate_demo_plots绕开应用；不处理AstroMat。把真实Scene fixture和合同hash交给Trae，最后用R01–R20及原P0验证。更新完成报告时必须附实际数值、文件、版本和失败/未验证项，不能以既往“139通过”或verified=true代替证据。
```

依据：[审计报告](17_pyrolite对照审计与问题定位.md)、[完整返工任务书](18_pyrolite绘图内核返工任务书.md)。

可同时准备；真实联调等待QR03合同及fixture，TAS等待QR04，最终图像一致性验收等待QR05。原86项P0和有/无Python、Node的Windows便携交付要求仍有效。
