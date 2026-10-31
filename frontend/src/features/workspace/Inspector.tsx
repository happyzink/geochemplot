import { useWorkspace } from '../../state/workspaceStore';
import { VariableEditor } from '../plot/VariableEditor';
import { LayerPanel } from '../plot/LayerPanel';
import { StylePanel } from '../plot/StylePanel';
import { LayoutPanel } from '../plot/LayoutPanel';
import { flagLabel, materialLabel, mineralLabel, missionLabel, valueStateLabel } from '../../lib/labels';

const TABS = [
  { key: 'variables', label: '变量' },
  { key: 'layers', label: '图层' },
  { key: 'style', label: '样式' },
  { key: 'layout', label: '版面' },
] as const;

export function Inspector() {
  const collapsed = useWorkspace((s) => s.rightCollapsed);
  const toggleRight = useWorkspace((s) => s.toggleRight);
  const rightTab = useWorkspace((s) => s.rightTab);
  const setRightTab = useWorkspace((s) => s.setRightTab);
  const detail = useWorkspace((s) => s.selectedAnalysisDetail);
  const setSelectedAnalysis = useWorkspace((s) => s.setSelectedAnalysis);

  if (collapsed) {
    return (
      <aside className="rightpanel collapsed">
        <div className="sidebar-head">
          <button className="icon-btn" title="展开属性面板" onClick={toggleRight}>
            «
          </button>
        </div>
      </aside>
    );
  }

  return (
    <aside className="rightpanel">
      <div className="sidebar-head">
        <h3>图表设置</h3>
        <div className="spacer" />
        <button className="icon-btn" title="收起属性面板" onClick={toggleRight}>
          »
        </button>
      </div>

      <div className="tabbar">
        {TABS.map((tab) => (
          <button key={tab.key} className={rightTab === tab.key ? 'active' : ''} onClick={() => setRightTab(tab.key)}>
            {tab.label}
          </button>
        ))}
      </div>

      <div className="panel-body">
        {rightTab === 'variables' && <VariableEditor />}
        {rightTab === 'layers' && <LayerPanel />}
        {rightTab === 'style' && <StylePanel />}
        {rightTab === 'layout' && <LayoutPanel />}

        {detail && (
          <div className="section" style={{ marginTop: 16, borderTop: '1px solid var(--line)', paddingTop: 12 }}>
            <div className="section-title">
              测点详情
              <button className="linklike" onClick={() => void setSelectedAnalysis(null)}>
                关闭
              </button>
            </div>
            <div className="small">
              <div>
                <strong>{detail.raw_name}</strong> <span className="mono muted">{detail.analysis_id}</span>
              </div>
              <div className="muted">
                {missionLabel(detail.mission)} · {materialLabel(detail.material_type)} ·{' '}
                {mineralLabel(detail.mineral_group)}
                {detail.parent_sample ? ` · 母样品 ${detail.parent_sample}` : ''}
              </div>
              {(detail.quality_flags?.length ?? 0) > 0 && (
                <div className="muted">质量：{detail.quality_flags.map(flagLabel).join('、')}</div>
              )}
              <div className="small muted" style={{ marginTop: 6 }}>
                来源：{detail.source.sheet} 第 {detail.source.row} 行（坐标只读，不能拖动改值）
              </div>
            </div>

            <div style={{ marginTop: 8, maxHeight: 260, overflow: 'auto' }}>
              <table className="table-simple">
                <thead>
                  <tr>
                    <th>测量</th>
                    <th>值</th>
                    <th>单位</th>
                    <th>状态</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.measurements.map((measurement) => (
                    <tr key={measurement.measurement_id}>
                      <td className="mono">
                        {measurement.analyte}
                        {measurement.channel ? ` (${measurement.channel})` : ''}
                      </td>
                      <td className="num">{measurement.value ?? '—'}</td>
                      <td>{measurement.unit ?? '—'}</td>
                      <td className="small">
                        {valueStateLabel(measurement.value_state)}
                        {measurement.unit_confirmed ? '' : ' · 单位未确认'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {(detail.classification_evidence?.length ?? 0) > 0 && (
              <div style={{ marginTop: 8 }}>
                <div className="small muted">分类证据</div>
                {detail.classification_evidence.map((evidence) => (
                  <div key={`${evidence.field}-${evidence.rule_id}`} className="small muted">
                    {evidence.field}：{evidence.raw_value ?? '—'} → {evidence.normalized_value ?? '—'}
                    {evidence.rule_id ? `（规则 ${evidence.rule_id}）` : ''}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}
