import { useEffect, useState } from 'react';
import { Modal } from '../../components/Modal';
import { useWorkspace } from '../../state/workspaceStore';
import { StyleEditor } from './StyleEditor';
import type { LayerStyle } from '../../lib/generated/types';

function diffStyle(base: LayerStyle, draft: LayerStyle): Partial<LayerStyle> {
  const patch: Partial<LayerStyle> = {};
  (Object.keys(DRAFT_KEYS) as Array<keyof LayerStyle>).forEach((key) => {
    if (draft[key] !== base[key]) {
      (patch as Record<string, unknown>)[key] = draft[key];
    }
  });
  return patch;
}

const DRAFT_KEYS: Record<keyof LayerStyle, true> = {
  marker_shape: true,
  marker_fill: true,
  marker_fill_color: true,
  marker_edge_color: true,
  marker_size_pt: true,
  marker_edge_width_pt: true,
  marker_alpha: true,
  line_color: true,
  line_width_pt: true,
  line_dash: true,
  line_alpha: true,
  connect: true,
};

export function SeriesFormatPanel() {
  const target = useWorkspace((s) => s.seriesPanel);
  const setSeriesPanel = useWorkspace((s) => s.setSeriesPanel);
  const spec = useWorkspace((s) => s.spec);
  const selectionIds = useWorkspace((s) => s.selection.ids);
  const scene = useWorkspace((s) => s.scene);
  const updateLayerStyle = useWorkspace((s) => s.updateLayerStyle);
  const updateOverrides = useWorkspace((s) => s.updateOverrides);
  const toast = useWorkspace((s) => s.toast);

  const layer = target ? spec.layers.find((l) => l.layer_id === target.layerId) : undefined;
  const base = layer?.style;
  const [draft, setDraft] = useState<LayerStyle | null>(null);

  useEffect(() => {
    if (!target || !layer) return;
    const override = target.analysisId ? layer.analysis_style_overrides?.[target.analysisId] : undefined;
    setDraft({ ...layer.style, ...(override ?? {}) });
  }, [target, layer]);

  if (!target || !layer || !draft || !base) return null;

  const analysisIds = target.scope === 'selected'
    ? [...new Set([...selectionIds, ...(target.analysisId ? [target.analysisId] : [])])]
    : [];
  const layerAnalysisCount = scene
    ? new Set(scene.series.filter((s) => s.layer_id === layer.layer_id).flatMap((s) => s.analysis_ids)).size
    : 0;
  const scopeCount = target.scope === 'all'
    ? spec.layers.length
    : target.scope === 'selected'
      ? analysisIds.length
      : layerAnalysisCount;

  const apply = () => {
    const patch = diffStyle(base, draft);
    if (Object.keys(patch).length === 0) {
      toast('info', '样式没有变化');
      setSeriesPanel(null);
      return;
    }
    if (target.scope === 'all') {
      spec.layers.forEach((l) => updateLayerStyle(l.layer_id, patch));
    } else if (target.scope === 'selected') {
      if (analysisIds.length === 0) {
        toast('info', '没有选中分析可应用');
        return;
      }
      updateOverrides(layer.layer_id, analysisIds, patch);
    } else {
      updateLayerStyle(layer.layer_id, patch);
    }
    setSeriesPanel(null);
  };

  return (
    <Modal
      title="系列格式"
      subtitle={`目标图层：${layer.label} · ${layerAnalysisCount} 条分析${target.analysisId ? ` · 来源测点 ${target.analysisId}` : ''}`}
      onClose={() => setSeriesPanel(null)}
      footer={
        <>
          <button className="btn" onClick={() => setSeriesPanel(null)}>取消</button>
          <button className="btn primary" onClick={apply}>应用（影响 {scopeCount}）</button>
        </>
      }
    >
      <div className="segmented" style={{ marginBottom: 12 }}>
        <button className={target.scope === 'current' ? 'active' : ''} onClick={() => setSeriesPanel({ ...target, scope: 'current' })}>
          当前层（{layerAnalysisCount}）
        </button>
        <button className={target.scope === 'all' ? 'active' : ''} onClick={() => setSeriesPanel({ ...target, scope: 'all' })}>
          全部层（{spec.layers.length}）
        </button>
        <button className={target.scope === 'selected' ? 'active' : ''} onClick={() => setSeriesPanel({ ...target, scope: 'selected' })}>
          选中分析（{[...new Set([...selectionIds, ...(target.analysisId ? [target.analysisId] : [])])].length}）
        </button>
      </div>
      {target.scope === 'selected' && analysisIds.length === 0 && (
        <div className="banner warn" style={{ marginBottom: 10 }}>当前没有勾选分析；请先在图或表格中勾选，或使用“当前层”。</div>
      )}
      <StyleEditor
        style={draft}
        onChange={(patch) => setDraft({ ...draft, ...patch })}
        showLine={spec.chart_type === 'ree' || spec.chart_type === 'spider'}
      />
      <p className="small muted" style={{ marginTop: 8 }}>
        当前层/全部层写入图层基础样式；选中分析写入单点 overrides，不会改动其他测点。所有值进入 PlotSpec 与 Scene。
      </p>
    </Modal>
  );
}
