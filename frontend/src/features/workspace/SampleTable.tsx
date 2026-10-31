import { useWorkspace } from '../../state/workspaceStore';
import { flagLabel, materialLabel, mineralLabel, missionLabel, reasonLabel } from '../../lib/labels';

export function SampleTable() {
  const analyses = useWorkspace((s) => s.analyses);
  const analysesTotal = useWorkspace((s) => s.analysesTotal);
  const analysesLoading = useWorkspace((s) => s.analysesLoading);
  const analysesOffset = useWorkspace((s) => s.analysesOffset);
  const pageSize = useWorkspace((s) => s.pageSize);
  const loadAnalyses = useWorkspace((s) => s.loadAnalyses);
  const selection = useWorkspace((s) => s.selection);
  const toggleAnalysis = useWorkspace((s) => s.toggleAnalysis);
  const togglePage = useWorkspace((s) => s.togglePage);
  const selectedAnalysisId = useWorkspace((s) => s.selectedAnalysisId);
  const setSelectedAnalysis = useWorkspace((s) => s.setSelectedAnalysis);
  const highlightIds = useWorkspace((s) => s.highlightIds);
  const hoverAnalysisId = useWorkspace((s) => s.hoverAnalysisId);
  const setHover = useWorkspace((s) => s.setHover);
  const bottomTab = useWorkspace((s) => s.bottomTab);
  const setBottomTab = useWorkspace((s) => s.setBottomTab);
  const scene = useWorkspace((s) => s.scene);

  const pageIndex = Math.floor(analysesOffset / pageSize) + 1;
  const pageCount = Math.max(1, Math.ceil(analysesTotal / pageSize));

  const points = scene?.series.flatMap((series) =>
    series.points.map((point) => ({ point, layerLabel: series.label })),
  ) ?? [];
  const exclusionByAnalysis = new Map((scene?.exclusions ?? []).map((item) => [item.analysis_id, item]));

  return (
    <div className="table-wrap">
      <div className="table-head">
        <button className={`tab-pill${bottomTab === 'samples' ? ' active' : ''}`} onClick={() => setBottomTab('samples')}>
          样品记录
        </button>
        <button className={`tab-pill${bottomTab === 'points' ? ' active' : ''}`} onClick={() => setBottomTab('points')}>
          测点 {scene ? points.length : 0}
        </button>
        <span className="small muted">
          共 {analysesTotal} 条 · 已勾选 {selection.ids.size}
        </span>
        <div className="spacer" />
        {bottomTab === 'samples' && (
          <>
            <button className="btn sm" onClick={togglePage} disabled={analyses.length === 0}>
              全选本页
            </button>
            <button className="btn sm" disabled={analysesOffset <= 0} onClick={() => void loadAnalyses(Math.max(0, analysesOffset - pageSize))}>
              上一页
            </button>
            <span className="small muted">
              {pageIndex} / {pageCount}
            </span>
            <button
              className="btn sm"
              disabled={analysesOffset + pageSize >= analysesTotal}
              onClick={() => void loadAnalyses(analysesOffset + pageSize)}
            >
              下一页
            </button>
          </>
        )}
      </div>

      <div className="table-scroll">
        {bottomTab === 'samples' ? (
          analyses.length === 0 ? (
            <div className="table-empty">
              {analysesLoading ? '正在载入记录…' : '当前筛选没有记录。调整左侧筛选或检索条件。'}
            </div>
          ) : (
            <>
              <div className="table-row header">
                <span className="cell" onClick={(event) => event.stopPropagation()}>
                  <input
                    type="checkbox"
                    title="全选本页"
                    checked={analyses.length > 0 && analyses.every((row) => selection.ids.has(row.analysis_id))}
                    onChange={togglePage}
                  />
                </span>
                <span className="cell">原始名称</span>
                <span className="cell">标号</span>
                <span className="cell">任务</span>
                <span className="cell">材料</span>
                <span className="cell">矿物</span>
                <span className="cell">母样品</span>
                <span className="cell">质量标记</span>
              </div>
              {analyses.map((row) => {
                const checked = selection.ids.has(row.analysis_id);
                const selected = selectedAnalysisId === row.analysis_id;
                const highlighted = highlightIds.includes(row.analysis_id);
                return (
                  <div
                    key={row.analysis_id}
                    className={`table-row${selected ? ' selected' : ''}${highlighted ? ' highlighted' : ''}`}
                    onClick={() => void setSelectedAnalysis(row.analysis_id)}
                    onMouseEnter={() => setHover(row.analysis_id)}
                    onMouseLeave={() => setHover(null)}
                    title={`${row.analysis_id} · 来源 ${row.source.sheet} 第 ${row.source.row} 行`}
                    style={hoverAnalysisId === row.analysis_id ? { background: '#f2f8ff' } : undefined}
                  >
                    <span className="cell" onClick={(event) => event.stopPropagation()}>
                      <input type="checkbox" checked={checked} onChange={() => toggleAnalysis(row.analysis_id)} />
                    </span>
                    <span className="cell" title={row.raw_name}>
                      {row.raw_name}
                    </span>
                    <span className="cell mono">{row.sample_group ?? '—'}</span>
                    <span className="cell">{missionLabel(row.mission)}</span>
                    <span className="cell">{materialLabel(row.material_type)}</span>
                    <span className="cell">{mineralLabel(row.mineral_group)}</span>
                    <span className="cell mono">{row.parent_sample ?? '—'}</span>
                    <span className="cell small">
                      {row.quality_flags.length === 0 ? '—' : row.quality_flags.map(flagLabel).join('、')}
                    </span>
                  </div>
                );
              })}
            </>
          )
        ) : (
          <>
            <div className="table-row header points">
              <span className="cell" />
              <span className="cell">测点 / 分析</span>
              <span className="cell num">X</span>
              <span className="cell num">Y</span>
              <span className="cell">图层</span>
              <span className="cell">质量</span>
              <span className="cell">排除原因</span>
            </div>
            {points.length === 0 && <div className="table-empty">当前 Scene 没有有效测点。</div>}
            {points.slice(0, 400).map(({ point, layerLabel }) => {
              const exclusion = exclusionByAnalysis.get(point.analysis_id);
              const rawName = String((point.provenance as Record<string, unknown>).raw_name ?? '');
              return (
                <div key={point.point_id} className="table-row points" onClick={() => void setSelectedAnalysis(point.analysis_id)}>
                  <span className="cell" />
                  <span className="cell">
                    {rawName || point.analysis_id}
                    <span className="mono muted small"> {point.analysis_id}</span>
                  </span>
                  <span className="cell num">{point.x == null ? '—' : point.x.toPrecision(4)}</span>
                  <span className="cell num">{point.y == null ? '—' : point.y.toPrecision(4)}</span>
                  <span className="cell">{layerLabel}</span>
                  <span className="cell small">{point.quality_flags.map(flagLabel).join('、') || '—'}</span>
                  <span className="cell small">{exclusion ? reasonLabel(exclusion.reason_code) : '—'}</span>
                </div>
              );
            })}
          </>
        )}
      </div>
    </div>
  );
}
