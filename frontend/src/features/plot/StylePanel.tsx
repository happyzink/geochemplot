import { useWorkspace } from '../../state/workspaceStore';
import { StyleEditor } from './StyleEditor';

export function StylePanel() {
  const spec = useWorkspace((s) => s.spec);
  const activeLayerId = useWorkspace((s) => s.activeLayerId);
  const setActiveLayer = useWorkspace((s) => s.setActiveLayer);
  const updateLayerStyle = useWorkspace((s) => s.updateLayerStyle);
  const clearOverrides = useWorkspace((s) => s.clearOverrides);
  const setSeriesPanel = useWorkspace((s) => s.setSeriesPanel);
  const selectionIds = useWorkspace((s) => s.selection.ids);
  const scene = useWorkspace((s) => s.scene);

  const layer = spec.layers.find((l) => l.layer_id === activeLayerId) ?? spec.layers[0];
  const countFor = (layerId: string) =>
    scene ? new Set(scene.series.filter((s) => s.layer_id === layerId).flatMap((s) => s.analysis_ids)).size : 0;

  if (!layer) {
    return (
      <div className="small muted">
        当前图还没有图层。先在左侧勾选分析记录，点击“加为图层”，再设置样式。
      </div>
    );
  }

  const overrideCount = Object.keys(layer.analysis_style_overrides ?? {}).length;

  return (
    <div>
      <div className="field">
        <label>当前层</label>
        <select value={layer.layer_id} onChange={(event) => setActiveLayer(event.target.value)}>
          {spec.layers.map((l) => (
            <option key={l.layer_id} value={l.layer_id}>
              {l.label}（{countFor(l.layer_id)} 条）
            </option>
          ))}
        </select>
      </div>

      <div className="row" style={{ marginBottom: 10 }}>
        <button className="btn sm" onClick={() => setSeriesPanel({ analysisId: null, layerId: layer.layer_id, scope: 'current' })}>
          当前层
        </button>
        <button className="btn sm" onClick={() => setSeriesPanel({ analysisId: null, layerId: layer.layer_id, scope: 'all' })}>
          全部层
        </button>
        <button
          className="btn sm"
          disabled={selectionIds.size === 0}
          onClick={() => setSeriesPanel({ analysisId: null, layerId: layer.layer_id, scope: 'selected' })}
        >
          选中分析（{selectionIds.size}）
        </button>
      </div>

      {overrideCount > 0 && (
        <div className="banner info" style={{ marginBottom: 10 }}>
          <span>该层有 {overrideCount} 个分析使用单点覆盖样式。</span>
          <button className="btn sm" onClick={() => clearOverrides(layer.layer_id)}>
            清除覆盖
          </button>
        </div>
      )}

      <StyleEditor
        style={layer.style}
        onChange={(patch) => updateLayerStyle(layer.layer_id, patch)}
        showLine={spec.chart_type === 'ree' || spec.chart_type === 'spider'}
      />

      <div className="divider" />
      <p className="small muted">
        双击图上的点可打开系列格式，按“当前层 / 全部层 / 选中分析”应用。单点样式进入 overrides，导出与预览使用同一 Scene。
      </p>
    </div>
  );
}
