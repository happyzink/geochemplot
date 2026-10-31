# 复制以下内容给Qoder（v2）

> 2026-10-29更新：以下为初建基线/交接模板，非当前验收状态。已有代码按[18返工任务书](18_pyrolite绘图内核返工任务书.md)执行；绘图合同以该增补为准，不从零重建。当前复制指令见[Qoder](QODER_pyrolite返工指令.md)和[Trae](TRAE_pyrolite返工指令.md)。

请在 D:\moon 开发GeoPlot。先读根目录 GeoPlot_科研绘图工具_正式任务书_v2.md；再读docs/geochem-plotter下01、03、04、05、06、13、15、16、08、09和11。以主任务书和schema1.1增补为准，不沿用旧opacity或扁平axes字段。

你的范围：backend、contracts、launcher、scripts、packaging、本地数据包、构建和最终整合；Trae负责frontend。不要替Trae另建第二套前端。原Excel只读，不处理AstroMat，不扫描/导入/打包其目录或压缩包，不上传研究数据到外部服务。

先执行Q01：把合同写成Pydantic/OpenAPI/JSON Schema和合成fixtures，包含Figure/Revision/Export、独立点/线alpha、轴格式和RuntimeStatus。通过契约校验后生成docs/progress/CONTRACT_READY.json，填真实schema/fixtures哈希与验证命令，再执行Q02–Q12。合同变更写CONTRACT_CHANGELOG.md并更新fixtures，不只改后端字段。

必须完成：六项内置目录、两套固定参考值、真实多表导入与分类选样、标准化和比值唯一后端计算、四图Scene、PNG/PDF/SVG本机实际保存、图件版本与导出记录、重启恢复。74235精确4条/母样品14条；不能跨analysis拼比值、重复计入派生表、把Si(ppm)当SiO2(wt%)。

启动器必须是可双击GeoPlotLauncher.exe，含启动程序/停止程序/打开绘图界面。交付同一便携包，在有Python/Node及没有Python/Node的Windows10/11 x64上均可离线运行；使用自带运行依赖，隔离系统环境，不修改PATH/全局包。源码开发脚本可以另交，但不替代便携包。生产前端为本地静态资源，不依赖npm或CDN。

按照11的依赖执行；可先做启动器骨架，等真实前后端闭环后打候选包。最终Q10需要Trae T08/T09证据，不能仅凭自己的后端测试宣布交付。必须检查08+16共86项P0；C16是P1，其余既定P0不能删减。无虚拟机条件时如实标明四格测试未完成，不冒称已通过。

每完成一项记录改动文件、命令/结果、输出文件路径和哈希、已知限制、下一项到docs/progress/QODER_HANDOFF.md；先做再勾选。最终交付便携包、源码锁文件、手册、四类示例图及可复现数据、真实验收证据。禁止以截图/mock/HTTP200代替可用功能和磁盘文件。

并行阶段、准备好信号和注意事项详见[14_工具指令与同步开工说明](14_工具指令与同步开工说明_v2.md)。
