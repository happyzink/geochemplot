import { useEffect, useState } from 'react';
import { useWorkspace } from '../../state/workspaceStore';
import { InteractivePlot } from './InteractivePlot';
import { ExportDialog } from '../exports/ExportDialog';
import type { ChartType } from '../../lib/generated/types';

const CHART_TABS: Array<{ key: ChartType; label: string; hint: string }> = [
  { key: 'scatter', label: '散点图', hint: '元素 / 比值 / 标准化值的 X–Y 关系' },
  { key: 'ree', label: 'REE 配分', hint: '14 个稀土元素按固定顺序，纵轴对数' },
  { key: 'spider', label: '多元素蛛网', hint: '可排序元素序列，参考组成标准化' },
  { key: 'tas', label: 'TAS', hint: 'SiO₂(wt%) 对 Na₂O+K₂O(wt%)，仅参考比较' },
];

export function PlotWorkspace() {
  const chartType = useWorkspace((s) => s.chartType);
  const setChartType = useWorkspace((s) => s.setChartType);
  const figure = useWorkspace((s) => s.figure);
  const renameFigure = useWorkspace((s) => s.renameFigure);
  const saveRevision = useWorkspace((s) => s.saveRevision);
  const scene = useWorkspace((s) => s.scene);
  const stale = useWorkspace((s) => s.stale);
  const computeState = useWorkspace((s) => s.computeState);
  const spec = useWorkspace((s) => s.spec);
  const selection = useWorkspace((s) => s.selection);
  const addSelectionLayer = useWorkspace((s) => s.addSelectionLayer);
  const setRightTab = useWorkspace((s) => s.setRightTab);
  const setReferencePicker = useWorkspace((s) => s.setReferencePicker);
  const setLegendEditor = useWorkspace((s) => s.setLegendEditor);
  const applyHighlightToSelection = useWorkspace((s) => s.applyHighlightToSelection);
  const useCurrentViewForExport = useWorkspace((s) => s.useCurrentViewForExport);
  const highlightIds = useWorkspace((s) => s.highlightIds);
  const activeLayerId = useWorkspace((s) => s.activeLayerId);
  const setPage = useWorkspace((s) => s.setPage);
  const lastSavedAt = useWorkspace((s) => s.lastSavedAt);
  const toast = useWorkspace((s) => s.toast);

  const [name, setName] = useState(figure?.name ?? '未命名图件');
  const [selectMode, setSelectMode] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [viewport, setViewport] = useState<{ x?: [number, number]; y?: [number, number] }>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setName(figure?.name ?? '未命名图件');
  }, [figure?.figure_id, figure?.name]);

  const commitName = async () => {
    const next = name.trim();
    if (!next || !figure || next === figure.name) {
      setName(figure?.name ?? '未命名图件');
      return;
    }
    await renameFigure(next);
  };

  const doSaveRevision = async () => {
    setSaving(true);
    try {
      const revision = await saveRevision();
      if (revision) toast('success', `已保存不可变版本 r${revision.revision_number}（${revision.revision_id}）`);
    } finally {
      setSaving(false);
    }
  };

  const axisTitles = scene
    ? { x: scene.axes.x.label, y: scene.axes.y.label }
    : { x: spec.axes.x.title_override ?? 'X', y: spec.axes.y.title_override ?? 'Y' };

  const empty = spec.layers.length === 0;
  const currentCount = scene?.counts.plotted_points ?? 0;
  const savedLabel = lastSavedAt ? `草稿已保存 ${new Date(lastSavedAt).toLocaleTimeString('zh-CN')}` : '草稿未保存';

  return (
    <div className="plot-stage" data-testid="plot-workspace">
      <div className="workspace-top">
        <input
          className="figure-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          onBlur={() => void commitName()}
          onKeyDown={(event) => {
            if (event.key === 'Enter') (event.target as HTMLInputElement).blur();
          }}
          title="图件名称（失焦保存到草稿）"
        />
        <span className="small muted">{savedLabel}</span>
        <span className="chip">{figure?.current_revision_id ? `版本 ${figure.current_revision_id}` : '尚无保存版本'}</span>
        <div className="spacer" />
        <div className="chart-tabs" role="tablist">
          {CHART_TABS.map((tab) => (
            <button
              key={tab.key}
              className={chartType === tab.key ? 'active' : ''}
              onClick={() => setChartType(tab.key)}
              title={tab.hint}
              role="tab"
              aria-selected={chartType === tab.key}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <button className="btn" onClick={() => setExportOpen(true)} disabled={!scene || stale}>
          导出
        </button>
        <button className="btn primary" onClick={() => void doSaveRevision()} disabled={saving || !figure}>
          {saving ? '保存中…' : '保存版本'}
        </button>
      </div>

      <div className="plot-toolbar">
        <span className="small muted">
          当前层：<strong>{spec.layers.find((l) => l.layer_id === activeLayerId)?.label ?? '—'}</strong>
        </span>
        <span className="divider" />
        <button className={`btn sm ${selectMode ? 'primary' : ''}`} onClick={() => setSelectMode((v) => !v)} title="框选高亮仅改变高亮，不会自动改变投图选择">
          {selectMode ? '框选高亮中' : '框选高亮'}
        </button>
        <button className="btn sm" disabled={highlightIds.length === 0} onClick={() => applyHighlightToSelection()}>
          将高亮应用为投图选择（{highlightIds.length}）
        </button>
        <span className="divider" />
        <button className="btn sm" disabled={!viewport.x && !viewport.y} onClick={() => { useCurrentViewForExport(viewport); setViewport({}); }} title="把当前拖动/缩放后的视野写入 PlotSpec 轴范围并重新计算">
          将当前视野用于导出
        </button>
        <button className="btn sm" onClick={() => setReferencePicker(true)}>参考组成…</button>
        <button className="btn sm" onClick={() => setLegendEditor(true)}>图例 / 注释…</button>
        <span className="divider" />
        <span className="small muted">
          X：{axisTitles.x} · Y：{axisTitles.y}
        </span>
        <div className="spacer" />
        <span className="small muted">双击坐标轴编辑；双击测点打开系列格式；测点坐标只读</span>
      </div>

      <div className="plot-card" data-testid="plot-card">
        {empty ? (
          <div className="empty-state" style={{ height: '100%' }}>
            <div className="big">还没有投图图层</div>
            <p className="muted">在左侧勾选样品分析记录，然后点击“加为图层”。筛选只改变可见记录，不会自动改变投图选择。</p>
            <div className="row" style={{ justifyContent: 'center', gap: 8 }}>
              <button className="btn primary" disabled={selection.ids.size === 0} onClick={() => void addSelectionLayer('layer')}>
                用当前勾选创建图层（{selection.ids.size}）
              </button>
              <button className="btn" onClick={() => setRightTab('layers')}>查看图层</button>
            </div>
          </div>
        ) : (
          <>
            <InteractivePlot selectMode={selectMode} onViewport={setViewport} />
            {computeState === 'computing' && (
              <div className="plot-overlay-note" style={{ top: 'auto', bottom: 14 }}>
                正在由后端计算 Scene…（旧图保留但不用于导出）
              </div>
            )}
            <div className="plot-stat-strip">
              <span>本图测点 <strong>{currentCount}</strong></span>
              <span>已选 <strong>{scene?.counts.selected_analyses ?? selection.ids.size}</strong></span>
              <span>有效 <strong>{scene?.counts.valid_analyses ?? 0}</strong></span>
              <span>排除 <strong>{scene?.counts.excluded_analyses ?? 0}</strong></span>
              {scene?.counts.distinct_samples != null && (
                <span>独立母样品 <strong>{scene.counts.distinct_samples}</strong></span>
              )}
              {scene && <span className="mono">plot r{scene.plot_revision}</span>}
              <div className="grow" />
              <span className="mono muted small" title="Scene 与规格哈希用于导出前一致性校验">scene {scene?.scene_hash.slice(0, 10) ?? '—'}</span>
            </div>
          </>
        )}
      </div>

      <div className="plot-foot">
        <span>
          {CHART_TABS.find((t) => t.key === chartType)?.hint}
          {chartType === 'tas' && ' · 矿物不进入 TAS；不自动宣布地球火山岩定名'}
        </span>
        <div className="grow" />
        <button className="linklike" onClick={() => setPage('figures')}>图件库</button>
        <button className="linklike" onClick={() => setPage('exports')}>导出记录</button>
        <button className="linklike" onClick={() => setPage('import')}>导入 / 上传</button>
      </div>

      <ExportDialog open={exportOpen} onClose={() => setExportOpen(false)} />
    </div>
  );
}
