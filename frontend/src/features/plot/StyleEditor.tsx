import type { LayerStyle, LineDash } from '../../lib/generated/types';
import { alphaToUiTransparency, MARKER_SHAPES, markerGlyph, uiTransparencyToAlpha } from '../../lib/expressions';
import { LINE_DASH_LABEL } from '../../lib/labels';

interface Props {
  style: LayerStyle;
  onChange: (patch: Partial<LayerStyle>) => void;
  showLine?: boolean;
}

function SliderRow(props: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  onChange: (value: number) => void;
}) {
  return (
    <div className="field">
      <label>
        {props.label}
        <span className="value">
          {Number(props.value.toFixed(2))}
          {props.unit ?? ''}
        </span>
      </label>
      <div className="row" style={{ gap: 8, flexWrap: 'nowrap' }}>
        <input
          type="range"
          min={props.min}
          max={props.max}
          step={props.step ?? 0.5}
          value={props.value}
          onChange={(event) => props.onChange(Number(event.target.value))}
          style={{ flex: 1 }}
        />
        <input
          type="number"
          min={props.min}
          max={props.max}
          step={props.step ?? 0.5}
          value={props.value}
          onChange={(event) => props.onChange(Number(event.target.value))}
          style={{ width: 62 }}
        />
      </div>
    </div>
  );
}

export function StyleEditor({ style, onChange, showLine = true }: Props) {
  return (
    <div className="style-editor">
      <div className="field">
        <label>点形状（9 种）</label>
        <div className="shape-grid">
          {MARKER_SHAPES.map((shape) => (
            <button
              key={shape.value}
              className={`shape-btn ${style.marker_shape === shape.value ? 'active' : ''}`}
              onClick={() => onChange({ marker_shape: shape.value })}
              title={shape.label}
            >
              {markerGlyph(shape.value)}
            </button>
          ))}
        </div>
      </div>

      <div className="field">
        <label>填充</label>
        <div className="segmented">
          <button className={style.marker_fill === 'solid' ? 'active' : ''} onClick={() => onChange({ marker_fill: 'solid' })}>
            实心
          </button>
          <button className={style.marker_fill === 'open' ? 'active' : ''} onClick={() => onChange({ marker_fill: 'open' })}>
            空心
          </button>
        </div>
      </div>

      <div className="field">
        <label>颜色</label>
        <div className="color-row">
          <span className="small muted">填充</span>
          <input
            type="color"
            value={toHex(style.marker_fill_color)}
            onChange={(event) => onChange({ marker_fill_color: event.target.value, marker_fill: 'solid' })}
          />
          <span className="small muted">边框 / 线</span>
          <input
            type="color"
            value={toHex(style.marker_edge_color)}
            onChange={(event) => onChange({ marker_edge_color: event.target.value, line_color: event.target.value })}
          />
          <button
            className="btn sm"
            onClick={() =>
              onChange({
                marker_fill_color: style.marker_edge_color,
                marker_edge_color: style.marker_fill_color,
              })
            }
          >
            填充=边框
          </button>
        </div>
      </div>

      <SliderRow
        label="点直径（pt）"
        value={style.marker_size_pt}
        min={1}
        max={20}
        step={0.5}
        unit=" pt"
        onChange={(value) => onChange({ marker_size_pt: Math.min(20, Math.max(1, value)) })}
      />
      <SliderRow
        label="边框宽度（pt）"
        value={style.marker_edge_width_pt}
        min={0}
        max={3}
        step={0.25}
        unit=" pt"
        onChange={(value) => onChange({ marker_edge_width_pt: Math.min(3, Math.max(0, value)) })}
      />
      <SliderRow
        label="点透明度（UI：0 不透明 / 100 全透明）"
        value={alphaToUiTransparency(style.marker_alpha)}
        min={0}
        max={100}
        step={1}
        unit="%"
        onChange={(value) => onChange({ marker_alpha: uiTransparencyToAlpha(value) })}
      />

      {showLine && (
        <>
          <div className="divider" />
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <label className="check">
              <input type="checkbox" checked={style.connect} onChange={(event) => onChange({ connect: event.target.checked })} />
              连线
            </label>
            <label className="small muted">
              线宽
              <input
                type="number"
                min={0.5}
                max={5}
                step={0.5}
                value={style.line_width_pt}
                onChange={(event) => onChange({ line_width_pt: Math.min(5, Math.max(0.5, Number(event.target.value))) })}
                style={{ width: 60, marginLeft: 6 }}
              />
            </label>
          </div>
          <div className="field">
            <label>线型</label>
            <select value={style.line_dash} onChange={(event) => onChange({ line_dash: event.target.value as LineDash })}>
              {Object.entries(LINE_DASH_LABEL).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <SliderRow
            label="线透明度（UI：0 不透明 / 100 全透明）"
            value={alphaToUiTransparency(style.line_alpha)}
            min={0}
            max={100}
            step={1}
            unit="%"
            onChange={(value) => onChange({ line_alpha: uiTransparencyToAlpha(value) })}
          />
        </>
      )}
      <p className="small muted" style={{ marginTop: 8 }}>
        内部 alpha 只应用一次；UI 0% = 不透明，100% = 完全透明。所有值写入 PlotSpec → Scene，并进入导出，不只改 DOM。
      </p>
    </div>
  );
}

function toHex(color: string): string {
  return /^#[0-9a-fA-F]{6}$/.test(color) ? color : '#D55E00';
}
