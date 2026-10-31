import { useWorkspace } from '../../state/workspaceStore';
import type { LayoutSpec } from '../../lib/generated/types';

const PRESETS: Array<{ key: LayoutSpec['preset']; label: string; width: number; height: number }> = [
  { key: 'nature_main_2026', label: 'Nature 主图 2026（183×110 mm）', width: 183, height: 110 },
  { key: 'thesis_cn', label: '中文论文单栏（170×120 mm）', width: 170, height: 120 },
  { key: 'custom', label: '自定义尺寸', width: 183, height: 110 },
];

const FONTS = ['Arial', 'Helvetica', 'Times New Roman', 'SimSun', 'Microsoft YaHei', 'Noto Sans CJK SC'];

/** 版面设置：纸张尺寸、字体、刻度字号、图例与注释入口写回 PlotSpec.layout。 */
export function LayoutPanel() {
  const layout = useWorkspace((s) => s.spec.layout);
  const setLayout = useWorkspace((s) => s.setLayout);
  const setLegendEditor = useWorkspace((s) => s.setLegendEditor);

  const applyPreset = (preset: LayoutSpec['preset']) => {
    const definition = PRESETS.find((item) => item.key === preset);
    setLayout({
      preset,
      ...(definition
        ? { width_mm: definition.width, height_mm: definition.height }
        : {}),
    });
  };

  return (
    <div>
      <div className="field">
        <label>版面预设</label>
        <select value={layout.preset} onChange={(event) => applyPreset(event.target.value as LayoutSpec['preset'])}>
          {PRESETS.map((preset) => (
            <option key={preset.key} value={preset.key}>
              {preset.label}
            </option>
          ))}
        </select>
      </div>

      <div className="row">
        <div className="field grow">
          <label>宽度（mm）</label>
          <input
            type="number"
            min={40}
            max={400}
            value={layout.width_mm}
            onChange={(event) => setLayout({ width_mm: Number(event.target.value), preset: 'custom' })}
          />
        </div>
        <div className="field grow">
          <label>高度（mm）</label>
          <input
            type="number"
            min={40}
            max={400}
            value={layout.height_mm}
            onChange={(event) => setLayout({ height_mm: Number(event.target.value), preset: 'custom' })}
          />
        </div>
      </div>

      <div className="field">
        <label>字体</label>
        <select value={layout.font_family} onChange={(event) => setLayout({ font_family: event.target.value })}>
          {FONTS.map((font) => (
            <option key={font} value={font}>
              {font}
            </option>
          ))}
        </select>
        <div className="small muted" style={{ marginTop: 4 }}>
          导出时由后端检查字体是否可用；缺失字体在 Scene 的 font_manifest 中标记替代字体。
        </div>
      </div>

      <div className="row">
        <div className="field grow">
          <label>正文字号（pt）</label>
          <input
            type="number"
            min={5}
            max={24}
            value={layout.font_size_pt}
            onChange={(event) => setLayout({ font_size_pt: Number(event.target.value) })}
          />
        </div>
        <div className="field grow">
          <label>刻度字号（pt）</label>
          <input
            type="number"
            min={5}
            max={24}
            value={layout.tick_font_size_pt}
            onChange={(event) => setLayout({ tick_font_size_pt: Number(event.target.value) })}
          />
        </div>
      </div>

      <div className="field">
        <label>
          图例位置 <span className="value">{layout.legend.position}</span>
        </label>
        <button className="btn block" onClick={() => setLegendEditor(true)}>
          编辑图例与注释…
        </button>
      </div>

      <div className="chip-list">
        <span className="chip">{layout.annotations.length} 条注释</span>
        <span className="chip">
          {layout.width_mm}×{layout.height_mm} mm
        </span>
      </div>
    </div>
  );
}
