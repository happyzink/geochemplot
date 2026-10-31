import { useState } from 'react';
import { useWorkspace } from '../../state/workspaceStore';
import { markerGlyph } from '../../lib/expressions';

export function LayerPanel() {
  const spec = useWorkspace((s) => s.spec);
  const activeLayerId = useWorkspace((s) => s.activeLayerId);
  const setActiveLayer = useWorkspace((s) => s.setActiveLayer);
  const toggleLayerVisible = useWorkspace((s) => s.toggleLayerVisible);
  const renameLayer = useWorkspace((s) => s.renameLayer);
  const duplicateLayer = useWorkspace((s) => s.duplicateLayer);
  const removeLayer = useWorkspace((s) => s.removeLayer);
  const moveLayer = useWorkspace((s) => s.moveLayer);
  const addSelectionLayer = useWorkspace((s) => s.addSelectionLayer);
  const setSeriesPanel = useWorkspace((s) => s.setSeriesPanel);
  const selectionIds = useWorkspace((s) => s.selection.ids);
  const scene = useWorkspace((s) => s.scene);
  const [editing, setEditing] = useState<string | null>(null);

  return (
    <div>
      <div className="row" style={{ marginBottom: 10 }}>
        <button className="btn sm primary" disabled={selectionIds.size === 0} onClick={() => void addSelectionLayer('layer')}>
          加为图层（{selectionIds.size}）
        </button>
        <button className="btn sm" disabled={selectionIds.size === 0} onClick={() => void addSelectionLayer('compare')}>
          加为对比图层
        </button>
      </div>
      <p className="small muted" style={{ marginTop: 0 }}>
        每个图层独立保存选择集、筛选和样式；对比层不会自动成为标准化参考值。隐藏图层不删除选择，导出以冻结的 visible 状态为准。
      </p>

      {spec.layers.length === 0 && <div className="small muted">还没有图层。</div>}

      {spec.layers.map((layer, index) => {
        const layerSeries = scene?.series.filter((s) => s.layer_id === layer.layer_id) ?? [];
        const seriesCount = layerSeries.length;
        const pointCount = layerSeries.reduce((sum, s) => sum + s.points.length, 0);
        const analysisCount = new Set(layerSeries.flatMap((s) => s.points.map((point) => point.analysis_id))).size;
        return (
          <div
            key={layer.layer_id}
            className={`layer-item ${layer.layer_id === activeLayerId ? 'active' : ''}`}
            onClick={() => setActiveLayer(layer.layer_id)}
          >
            <div className="row" style={{ gap: 6 }}>
              <input
                type="checkbox"
                checked={layer.visible}
                onChange={() => toggleLayerVisible(layer.layer_id)}
                title="显示/隐藏（不删除选择）"
                onClick={(event) => event.stopPropagation()}
              />
              <span className="glyph" style={{ color: layer.style.marker_fill_color }}>
                {markerGlyph(layer.style.marker_shape)}
              </span>
              {editing === layer.layer_id ? (
                <input
                  autoFocus
                  defaultValue={layer.label}
                  onClick={(event) => event.stopPropagation()}
                  onBlur={(event) => {
                    const next = event.target.value.trim();
                    if (next && next !== layer.label) renameLayer(layer.layer_id, next);
                    setEditing(null);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') (event.target as HTMLInputElement).blur();
                    if (event.key === 'Escape') setEditing(null);
                  }}
                  style={{ flex: 1, minWidth: 0 }}
                />
              ) : (
                <strong
                  className="t-12"
                  style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                  onDoubleClick={(event) => {
                    event.stopPropagation();
                    setEditing(layer.layer_id);
                  }}
                  title="双击重命名"
                >
                  {layer.label}
                </strong>
              )}
            </div>
            <div className="row" style={{ marginTop: 4, justifyContent: 'space-between' }}>
              <span className="small muted">
                {analysisCount} 条分析 · {seriesCount} 系列 · {pointCount} 点
              </span>
              <span className="row" style={{ gap: 2 }}>
                <button className="mini" disabled={index === 0} onClick={(event) => { event.stopPropagation(); moveLayer(layer.layer_id, -1); }} title="上移" aria-label="图层上移">↑</button>
                <button className="mini" disabled={index === spec.layers.length - 1} onClick={(event) => { event.stopPropagation(); moveLayer(layer.layer_id, 1); }} title="下移" aria-label="图层下移">↓</button>
                <button className="mini" onClick={(event) => { event.stopPropagation(); duplicateLayer(layer.layer_id); }} title="复制图层" aria-label="复制图层">⧉</button>
                <button className="mini" onClick={(event) => { event.stopPropagation(); setSeriesPanel({ analysisId: null, layerId: layer.layer_id, scope: 'current' }); }} title="系列格式" aria-label="打开系列格式">✎</button>
                <button className="mini danger" onClick={(event) => { event.stopPropagation(); removeLayer(layer.layer_id); }} title="移除图层" aria-label="移除图层">×</button>
              </span>
            </div>
          </div>
        );
      })}

      <div className="divider" />
      <p className="small muted">
        跨页勾选以 analysis_id 累积；筛选只改变可见记录，不自动改变投图选择。添加对比数据时请确认来源与 n。
      </p>
    </div>
  );
}
