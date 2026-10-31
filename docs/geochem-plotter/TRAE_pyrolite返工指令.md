# TRAE：pyrolite绘图返工指令

更新：2026-10-29。复制下面整段给TRAE，在现有项目中返工。

```text
请先读D:\moon\docs\geochem-plotter\17_pyrolite对照审计与问题定位.md和18_pyrolite绘图内核返工任务书.md，执行TR01–TR03。不要在前端另算标准化、单位或TAS边界。与Qoder统一Scene1.2及真实HTTP合同，关闭生产自动mock，测试必须消费真实后端fixture。保证一analysis一曲线、缺值断线、TAS共享矢量几何、正数log范围和最终样式；不要靠Number.MIN_VALUE隐藏后端轴错误。Qoder出版路径修复后，逐项比较浏览器/预览/PNG/PDF/SVG/CSV和重启恢复，交R01–R20中前端证据。不处理AstroMat，不只交美化截图。
```

依据：[审计报告](17_pyrolite对照审计与问题定位.md)、[完整返工任务书](18_pyrolite绘图内核返工任务书.md)。

可同时准备；真实联调等待QR03合同及fixture，TAS等待QR04，最终图像一致性验收等待QR05。原86项P0和有/无Python、Node的Windows便携交付要求仍有效。
