import { useEffect, useRef, useState } from 'react';
import { useWorkspace } from '../../state/workspaceStore';
import { roleLabel } from '../../lib/labels';

export function SamplePanel() {
  const [groupQuery, setGroupQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const groupQueryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [groupLimit, setGroupLimit] = useState(60);

  // 标号组分面过滤防抖：1424 个组实时过滤在慢速输入下会卡顿，200ms 合并
  useEffect(() => {
    if (groupQueryTimer.current) clearTimeout(groupQueryTimer.current);
    groupQueryTimer.current = setTimeout(() => setDebouncedQuery(groupQuery), 200);
    return () => {
      if (groupQueryTimer.current) clearTimeout(groupQueryTimer.current);
    };
  }, [groupQuery]);
  const collapsed = useWorkspace((s) => s.leftCollapsed);
  const toggleLeft = useWorkspace((s) => s.toggleLeft);
  const datasets = useWorkspace((s) => s.datasets);
  const activeDatasetIds = useWorkspace((s) => s.activeDatasetIds);
  const toggleDataset = useWorkspace((s) => s.toggleDataset);
  const facets = useWorkspace((s) => s.facets);
  const filter = useWorkspace((s) => s.filter);
  const setFilter = useWorkspace((s) => s.setFilter);
  const searchMode = useWorkspace((s) => s.searchMode);
  const setSearchMode = useWorkspace((s) => s.setSearchMode);
  const searchText = useWorkspace((s) => s.searchText);
  const setSearchText = useWorkspace((s) => s.setSearchText);
  const setSearch = useWorkspace((s) => s.setSearch);
  const selection = useWorkspace((s) => s.selection);
  const filteredIdsForDeselect = useWorkspace((s) => s.filteredIdsForDeselect);
  const selectAllFiltered = useWorkspace((s) => s.selectAllFiltered);
  const deselectFiltered = useWorkspace((s) => s.deselectFiltered);
  const clearSelection = useWorkspace((s) => s.clearSelection);
  const saveSelection = useWorkspace((s) => s.saveSelection);
  const addSelectionLayer = useWorkspace((s) => s.addSelectionLayer);
  const analysesTotal = useWorkspace((s) => s.analysesTotal);

  if (collapsed) {
    return (
      <aside className="sidebar collapsed">
        <div className="sidebar-head">
          <button className="icon-btn" title="展开筛选面板" onClick={toggleLeft}>
            »
          </button>
        </div>
      </aside>
    );
  }

  const toggleInFilter = (key: 'mission' | 'sample_group' | 'material_type' | 'mineral_group', value: string) => {
    const current = (filter[key] ?? []) as string[];
    const next = current.includes(value) ? current.filter((item) => item !== value) : [...current, value];
    void setFilter({ [key]: next } as never);
  };

  const submitSearch = () => {
    void setSearch(searchMode, searchText);
  };

  return (
    <aside className="sidebar">
      <div className="sidebar-head">
        <h3>样品筛选</h3>
        <div className="spacer" />
        <button className="icon-btn" title="收起筛选面板" onClick={toggleLeft}>
          «
        </button>
      </div>

      <div className="sidebar-body">
        <div className="selection-bar">
          <div className="counts">
            <strong>{selection.ids.size}</strong>
            <span>条已勾选</span>
            {selection.intent === 'filter' && <span className="sub">（整批筛选）</span>}
          </div>
          <div className="sub">
            跨页勾选按 analysis_id 累积；筛选只改变可见记录，不会自动改变投图选择。
          </div>
          <div className="selection-actions">
            <button className="btn sm" onClick={() => void selectAllFiltered()} title="把当前筛选结果（跨页）全部加入勾选">
              选择全部筛选结果
            </button>
            <button
              className="btn sm"
              disabled={filteredIdsForDeselect.length === 0}
              onClick={() => void deselectFiltered()}
              title="只从勾选中移除当前筛选结果，不改变其他已勾选记录"
            >
              取消筛选结果
            </button>
            <button className="btn sm" disabled={selection.ids.size === 0} onClick={clearSelection}>
              清空
            </button>
            <button
              className="btn sm"
              disabled={selection.ids.size === 0}
              onClick={() => {
                const name = window.prompt('选择集名称', `选择集 ${new Date().toLocaleTimeString('zh-CN')}`);
                if (name) void saveSelection(name);
              }}
            >
              保存选择集
            </button>
            <button className="btn sm primary" disabled={selection.ids.size === 0} onClick={() => void addSelectionLayer('layer')}>
              加为图层
            </button>
            <button className="btn sm accent" disabled={selection.ids.size === 0} onClick={() => void addSelectionLayer('compare')}>
              加为对比图层
            </button>
          </div>
          {selection.saved && (
            <div className="sub">
              已保存选择集：{selection.saved.name}
              {selection.saved.resolved_count != null ? `（${selection.saved.resolved_count} 条）` : ''}
            </div>
          )}
        </div>

        <div className="section">
          <div className="section-title">数据来源</div>
          {datasets.length === 0 && <div className="small muted">尚未载入数据集；可先在“导入 / 上传”中扫描 Excel。</div>}
          {datasets.map((dataset) => (
            <label className="dataset-row" key={dataset.dataset_id} style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '4px 6px', borderRadius: 6 }}>
              <input
                type="checkbox"
                checked={activeDatasetIds.includes(dataset.dataset_id)}
                onChange={() => void toggleDataset(dataset.dataset_id)}
              />
              <span>
                {dataset.label}
                <span className="small muted"> · {roleLabel(dataset.role)} · v{dataset.version}</span>
              </span>
              <span className="tag">{dataset.counts.accepted_analyses} 条</span>
            </label>
          ))}
        </div>

        <div className="section">
          <div className="section-title">样品检索</div>
          <div className="search-box">
            <select value={searchMode} onChange={(event) => setSearchMode(event.target.value as typeof searchMode)} title="检索方式">
              <option value="contains">包含</option>
              <option value="exact">精确</option>
              <option value="parent">母样品</option>
            </select>
            <input
              value={searchText}
              placeholder="74235 / CE6-118…"
              onChange={(event) => setSearchText(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') submitSearch();
              }}
            />
            <button onClick={submitSearch}>搜索</button>
          </div>
          <div className="small muted" style={{ marginTop: 5 }}>
            当前筛选命中 {analysesTotal} 条记录；检索只影响列表，不改变投图选择。
          </div>
        </div>

        {facets && (
          <>
            <div className="section">
              <div className="section-title">
                任务
                {(filter.mission?.length ?? 0) > 0 && (
                  <button className="linklike" onClick={() => void setFilter({ mission: [] })}>
                    清除
                  </button>
                )}
              </div>
              <div className="tree-children">
                {facets.missions.map((bucket) => (
                  <div
                    key={bucket.value}
                    className={`tree-node${filter.mission?.includes(bucket.value as never) ? ' active' : ''}`}
                    onClick={() => toggleInFilter('mission', bucket.value)}
                  >
                    <span>{bucket.label}</span>
                    <span className="count">{bucket.count}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="section">
              <div className="section-title">
                样品标号
                {(filter.sample_group?.length ?? 0) > 0 && (
                  <button className="linklike" onClick={() => void setFilter({ sample_group: [] })}>
                    清除
                  </button>
                )}
              </div>
              <input
                className="group-filter"
                value={groupQuery}
                placeholder="过滤标号…（如 14049）"
                onChange={(event) => setGroupQuery(event.target.value.trim())}
                style={{ width: '100%', marginBottom: 5 }}
              />
              <div className="tree-children">
                {facets.sample_groups
                  .filter((bucket) => !debouncedQuery || bucket.value.toLowerCase().includes(debouncedQuery.toLowerCase()))
                  .slice(0, debouncedQuery ? 200 : groupLimit)
                  .map((bucket) => (
                    <div
                      key={bucket.value}
                      className={`tree-node${filter.sample_group?.includes(bucket.value) ? ' active' : ''}`}
                      onClick={() => toggleInFilter('sample_group', bucket.value)}
                    >
                      <span className="mono">{bucket.label}</span>
                      <span className="count">{bucket.count}</span>
                    </div>
                  ))}
              </div>
              {!debouncedQuery && facets.sample_groups.length > groupLimit && (
                <button className="linklike" onClick={() => setGroupLimit(groupLimit + 100)}>
                  显示更多（{facets.sample_groups.length - groupLimit} 个未显示）
                </button>
              )}
            </div>

            <div className="section">
              <div className="section-title">
                材料类型
                {(filter.material_type?.length ?? 0) > 0 && (
                  <button className="linklike" onClick={() => void setFilter({ material_type: [] })}>
                    清除
                  </button>
                )}
              </div>
              <div className="tree-children">
                {facets.material_types.map((bucket) => (
                  <div
                    key={bucket.value}
                    className={`tree-node${filter.material_type?.includes(bucket.value as never) ? ' active' : ''}`}
                    onClick={() => toggleInFilter('material_type', bucket.value)}
                  >
                    <span>{bucket.label}</span>
                    <span className="count">{bucket.count}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="section">
              <div className="section-title">
                矿物
                {(filter.mineral_group?.length ?? 0) > 0 && (
                  <button className="linklike" onClick={() => void setFilter({ mineral_group: [] })}>
                    清除
                  </button>
                )}
              </div>
              <div className="tree-children">
                {facets.mineral_groups.map((bucket) => (
                  <div
                    key={bucket.value}
                    className={`tree-node${filter.mineral_group?.includes(bucket.value as never) ? ' active' : ''}`}
                    onClick={() => toggleInFilter('mineral_group', bucket.value)}
                  >
                    <span>{bucket.label}</span>
                    <span className="count">{bucket.count}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="section">
              <div className="section-title">
                母样品
                {filter.parent_sample && (
                  <button className="linklike" onClick={() => void setFilter({ parent_sample: null })}>
                    清除
                  </button>
                )}
              </div>
              <div className="tree-children">
                {facets.parents.slice(0, 40).map((bucket) => (
                  <div
                    key={bucket.value}
                    className={`tree-node${filter.parent_sample === bucket.value ? ' active' : ''}`}
                    onClick={() => void setFilter({ parent_sample: filter.parent_sample === bucket.value ? null : bucket.value })}
                  >
                    <span className="mono">{bucket.label}</span>
                    <span className="count">{bucket.count}</span>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </aside>
  );
}
