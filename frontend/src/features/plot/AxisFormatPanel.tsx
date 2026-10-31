import { useEffect, useState } from 'react';
import { Modal } from '../../components/Modal';
import { useWorkspace } from '../../state/workspaceStore';
import { defaultAxis } from '../../lib/expressions';
import { AXIS_SCALE_LABEL, NUMBER_FORMAT_LABEL, TICK_DIRECTION_LABEL } from '../../lib/labels';
import type { AxisScale, AxisSpec, NumberFormat, TickDirection } from '../../lib/generated/types';

/**
 * 双击坐标轴打开：范围、log/linear、刻度、数字格式、反转。
 * 所有修改写入 PlotSpec.axes，由后端重新计算 Scene，不直接改 Plotly DOM。
 */
export function AxisFormatPanel() {
  const target = useWorkspace((s) => s.axisPanel);
  const spec = useWorkspace((s) => s.spec);
  const updateAxis = useWorkspace((s) => s.updateAxis);
  const setAxisPanel = useWorkspace((s) => s.setAxisPanel);
  const [draft, setDraft] = useState<AxisSpec | null>(null);
  const [minText, setMinText] = useState('');
  const [maxText, setMaxText] = useState('');

  const axis = target?.axis ?? null;
  const base = axis ? spec.axes[axis] : null;

  useEffect(() => {
    if (!axis || !base) return;
    setDraft({ ...base });
    setMinText(base.min == null ? '' : String(base.min));
    setMaxText(base.max == null ? '' : String(base.max));
    // 仅在打开/切换轴时初始化草稿
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [axis]);

  if (!target || !axis || !draft) return null;

  const close = () => setAxisPanel(null);
  const patch = (next: Partial<AxisSpec>) => setDraft((current) => (current ? { ...current, ...next } : current));

  const apply = () => {
    const min = draft.range_mode === 'manual' && minText.trim() !== '' ? Number(minText) : null;
    const max = draft.range_mode === 'manual' && maxText.trim() !== '' ? Number(maxText) : null;
    if (min != null && max != null && min >= max) {
      window.alert('最小值必须小于最大值；请修正范围。');
      return;
    }
    // 按后端 AxisFormat 约束钳制，避免手输越界触发 422
    const clamp = (value: number | null, lo: number, hi: number, dflt: number | null): number | null =>
      value == null || Number.isNaN(value) ? dflt : Math.min(hi, Math.max(lo, value));
    updateAxis(axis, {
      ...draft,
      min: Number.isNaN(min as number) ? null : min,
      max: Number.isNaN(max as number) ? null : max,
      title_font_size_pt: clamp(draft.title_font_size_pt, 4, 36, 7) as number,
      tick_font_size_pt: clamp(draft.tick_font_size_pt, 4, 36, 6) as number,
      decimal_places: clamp(draft.decimal_places, 0, 8, null),
      significant_digits: clamp(draft.significant_digits, 1, 8, null),
      log_exponent_step: draft.scale === 'log10' ? clamp(draft.log_exponent_step ?? 1, 1, 6, 1) : null,
      tick_step: draft.tick_mode === 'step' && draft.tick_step != null && draft.tick_step > 0 ? draft.tick_step : null,
    });
    close();
  };

  const reset = () => {
    const next = defaultAxis(draft.scale);
    setDraft(next);
    setMinText('');
    setMaxText('');
  };

  const axisTitle = axis === 'x' ? 'X 轴格式' : 'Y 轴格式';

  return (
    <Modal
      title={axisTitle}
      subtitle="修改后由后端重算 Scene；导出使用同一份 PlotSpec"
      width="narrow"
      onClose={close}
      footer={
        <>
          <button className="btn sm" onClick={reset}>
            恢复默认
          </button>
          <span className="spacer" />
          <button className="btn" onClick={close}>
            取消
          </button>
          <button className="btn primary" onClick={apply}>
            应用并重算
          </button>
        </>
      }
    >
      <div className="field">
        <label>坐标轴类型</label>
        <select value={draft.scale} onChange={(event) => patch({ scale: event.target.value as AxisScale })}>
          {(Object.keys(AXIS_SCALE_LABEL) as AxisScale[]).map((key) => (
            <option key={key} value={key}>
              {AXIS_SCALE_LABEL[key]}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label>范围</label>
        <div className="row">
          <select
            style={{ width: 110 }}
            value={draft.range_mode}
            onChange={(event) => patch({ range_mode: event.target.value as AxisSpec['range_mode'] })}
          >
            <option value="auto">自动</option>
            <option value="manual">手动</option>
          </select>
          <input
            type="number"
            placeholder="最小值"
            disabled={draft.range_mode !== 'manual'}
            value={minText}
            onChange={(event) => setMinText(event.target.value)}
          />
          <input
            type="number"
            placeholder="最大值"
            disabled={draft.range_mode !== 'manual'}
            value={maxText}
            onChange={(event) => setMaxText(event.target.value)}
          />
        </div>
        <div className="small muted" style={{ marginTop: 4 }}>
          手动范围会冻结在 PlotSpec 中；log 轴请填写数据值（不是 10 的指数）。
        </div>
      </div>

      <div className="field">
        <label className="check">
          <input type="checkbox" checked={draft.reversed} onChange={(event) => patch({ reversed: event.target.checked })} />
          反转坐标轴方向
        </label>
      </div>

      <div className="field">
        <label>主刻度</label>
        <div className="row">
          <select
            style={{ width: 120 }}
            value={draft.tick_mode}
            onChange={(event) => patch({ tick_mode: event.target.value as AxisSpec['tick_mode'] })}
          >
            <option value="auto">自动</option>
            <option value="step">固定步长</option>
          </select>
          <input
            type="number"
            placeholder="步长"
            min={0}
            disabled={draft.tick_mode !== 'step'}
            value={draft.tick_step ?? ''}
            onChange={(event) => patch({ tick_step: event.target.value ? Number(event.target.value) : null })}
          />
          {draft.scale === 'log10' && (
            <input
              type="number"
              placeholder="每 10 的指数步长"
              min={1}
              max={6}
              value={draft.log_exponent_step ?? 1}
              onChange={(event) => patch({ log_exponent_step: event.target.value ? Number(event.target.value) : null })}
            />
          )}
        </div>
      </div>

      <div className="field">
        <label>数字格式</label>
        <div className="row">
          <select
            style={{ width: 130 }}
            value={draft.number_format}
            onChange={(event) => patch({ number_format: event.target.value as NumberFormat })}
          >
            {(Object.keys(NUMBER_FORMAT_LABEL) as NumberFormat[]).map((key) => (
              <option key={key} value={key}>
                {NUMBER_FORMAT_LABEL[key]}
              </option>
            ))}
          </select>
          <input
            type="number"
            min={0}
            max={8}
            placeholder="小数位"
            value={draft.decimal_places ?? ''}
            onChange={(event) => patch({ decimal_places: event.target.value ? Number(event.target.value) : null })}
          />
          <input
            type="number"
            min={1}
            max={8}
            placeholder="有效位"
            value={draft.significant_digits ?? ''}
            onChange={(event) => patch({ significant_digits: event.target.value ? Number(event.target.value) : null })}
          />
        </div>
      </div>

      <div className="field">
        <label>轴标题覆盖（留空使用变量标签）</label>
        <input
          type="text"
          value={draft.title_override ?? ''}
          placeholder={axis === 'x' ? '例如 SiO₂ (wt%)' : '例如 Laₙ (Chondrite_MS95@1)'}
          onChange={(event) => patch({ title_override: event.target.value || null })}
        />
      </div>

      <div className="row">
        <div className="field grow">
          <label>标题字号（pt）</label>
          <input
            type="number"
            min={5}
            max={24}
            value={draft.title_font_size_pt}
            onChange={(event) => patch({ title_font_size_pt: Number(event.target.value) })}
          />
        </div>
        <div className="field grow">
          <label>刻度字号（pt）</label>
          <input
            type="number"
            min={5}
            max={24}
            value={draft.tick_font_size_pt}
            onChange={(event) => patch({ tick_font_size_pt: Number(event.target.value) })}
          />
        </div>
      </div>

      <div className="row">
        <label className="check">
          <input type="checkbox" checked={draft.major_grid} onChange={(event) => patch({ major_grid: event.target.checked })} />
          主网格线
        </label>
        <label className="check">
          <input type="checkbox" checked={draft.minor_ticks} onChange={(event) => patch({ minor_ticks: event.target.checked })} />
          次刻度
        </label>
        <select
          value={draft.tick_direction}
          onChange={(event) => patch({ tick_direction: event.target.value as TickDirection })}
          title="刻度方向"
        >
          {(Object.keys(TICK_DIRECTION_LABEL) as TickDirection[]).map((key) => (
            <option key={key} value={key}>
              刻度{TICK_DIRECTION_LABEL[key]}
            </option>
          ))}
        </select>
      </div>
    </Modal>
  );
}
