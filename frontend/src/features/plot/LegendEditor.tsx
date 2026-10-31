import { Modal } from '../../components/Modal';
import { useWorkspace } from '../../state/workspaceStore';
import type { LegendPosition } from '../../lib/generated/types';

const POSITION_LABEL: Record<LegendPosition, string> = {
  right: '右侧（自动）',
  inside: '图内自动避让',
  custom: '自定义位置（可拖动）',
};

/** 图例与注释编辑：写入 PlotSpec.layout，随导出一起渲染。 */
export function LegendEditor() {
  const open = useWorkspace((s) => s.legendEditorOpen);
  const setLegendEditor = useWorkspace((s) => s.setLegendEditor);
  const layout = useWorkspace((s) => s.spec.layout);
  const setLegend = useWorkspace((s) => s.setLegend);
  const setLegendAnchor = useWorkspace((s) => s.setLegendAnchor);
  const setLayout = useWorkspace((s) => s.setLayout);
  const addAnnotation = useWorkspace((s) => s.addAnnotation);
  const updateAnnotation = useWorkspace((s) => s.updateAnnotation);
  const removeAnnotation = useWorkspace((s) => s.removeAnnotation);

  if (!open) return null;

  const close = () => setLegendEditor(false);

  return (
    <Modal
      title="图例与注释"
      subtitle="位置、锚点与注释文本写入 PlotSpec；测点坐标不会被拖动改写"
      width="wide"
      onClose={close}
      footer={
        <>
          <span className="small muted">注释共 {layout.annotations.length} 条</span>
          <span className="spacer" />
          <button className="btn primary" onClick={close}>
            完成
          </button>
        </>
      }
    >
      <div className="row" style={{ alignItems: 'flex-start', gap: 18 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="field">
            <label>图例位置</label>
            <select
              value={layout.legend.position}
              onChange={(event) => setLegend({ position: event.target.value as LegendPosition })}
            >
              {(Object.keys(POSITION_LABEL) as LegendPosition[]).map((key) => (
                <option key={key} value={key}>
                  {POSITION_LABEL[key]}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label className="check">
              <input
                type="checkbox"
                checked={layout.legend_show_counts}
                onChange={(event) => setLayout({ legend_show_counts: event.target.checked })}
              />
              在图例中显示每条记录数
            </label>
          </div>

          <div className="field">
            <label>自定义锚点（0–1，相对绘图区）</label>
            <div className="row">
              <input
                type="number"
                step={0.01}
                min={0}
                max={1}
                value={layout.legend.anchor_x ?? 0.72}
                onChange={(event) => setLegendAnchor(Number(event.target.value), layout.legend.anchor_y ?? 0.18)}
                title="X 锚点"
              />
              <input
                type="number"
                step={0.01}
                min={0}
                max={1}
                value={layout.legend.anchor_y ?? 0.18}
                onChange={(event) => setLegendAnchor(layout.legend.anchor_x ?? 0.72, Number(event.target.value))}
                title="Y 锚点"
              />
            </div>
            <div className="small muted" style={{ marginTop: 4 }}>
              选择“自定义位置”后可直接在图内拖动图例；双击图例也会打开本面板。
            </div>
          </div>
        </div>

        <div style={{ flex: 1.2, minWidth: 0 }}>
          <div className="section-title">
            注释
            <button className="linklike" onClick={() => addAnnotation('新注释')}>
              添加注释
            </button>
          </div>
          {layout.annotations.length === 0 && <div className="small muted">还没有注释。</div>}
          {layout.annotations.map((annotation) => (
            <div key={annotation.id} className="annotation-item" style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 6 }}>
              <input
                type="text"
                style={{ flex: 1, minWidth: 0 }}
                value={annotation.text}
                onChange={(event) => updateAnnotation(annotation.id, { text: event.target.value })}
              />
              <input
                type="number"
                min={4}
                max={24}
                style={{ width: 58 }}
                title="字号 pt"
                value={annotation.font_size_pt}
                onChange={(event) => updateAnnotation(annotation.id, { font_size_pt: Number(event.target.value) })}
              />
              <input
                type="color"
                style={{ width: 34 }}
                title="文字颜色"
                value={annotation.color}
                onChange={(event) => updateAnnotation(annotation.id, { color: event.target.value })}
              />
              <button className="btn sm danger" onClick={() => removeAnnotation(annotation.id)}>
                删除
              </button>
            </div>
          ))}
          <div className="small muted">
            注释锚点也可通过图内拖拽调整；导出前会随 PlotSpec 一起进入 Scene。
          </div>
        </div>
      </div>
    </Modal>
  );
}
