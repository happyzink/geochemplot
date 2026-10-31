import { useEffect, useState } from 'react';
import { useWorkspace } from '../../state/workspaceStore';
import type { RuntimeStatus } from '../../lib/generated/types';

export function ProjectsPage() {
  const client = useWorkspace((s) => s.client);
  const projects = useWorkspace((s) => s.projects);
  const project = useWorkspace((s) => s.project);
  const mode = useWorkspace((s) => s.mode);
  const modeReason = useWorkspace((s) => s.modeReason);
  const datasets = useWorkspace((s) => s.datasets);
  const catalog = useWorkspace((s) => s.catalog);
  const exportRoots = useWorkspace((s) => s.exportRoots);
  const loadExportRoots = useWorkspace((s) => s.loadExportRoots);
  const registerExportRoot = useWorkspace((s) => s.registerExportRoot);
  const chooseExportRoot = useWorkspace((s) => s.chooseExportRoot);
  const setProject = useWorkspace((s) => s.setProject);
  const createProject = useWorkspace((s) => s.createProject);
  const saveProjectName = useWorkspace((s) => s.saveProjectName);
  const setPage = useWorkspace((s) => s.setPage);
  const toast = useWorkspace((s) => s.toast);
  const demoReset = useWorkspace((s) => s.demoReset);

  const [name, setName] = useState(project?.name ?? '');
  const [newName, setNewName] = useState('新项目');
  const [path, setPath] = useState('');
  const [choosing, setChoosing] = useState(false);
  const [runtime, setRuntime] = useState<RuntimeStatus | null>(null);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);

  useEffect(() => {
    setName(project?.name ?? '');
    void loadExportRoots();
  }, [project?.project_id, project?.name, loadExportRoots]);

  useEffect(() => {
    if (!client) return;
    let cancelled = false;
    client.runtimeStatus()
      .then((status) => {
        if (!cancelled) setRuntime(status);
      })
      .catch((error: Error) => {
        if (!cancelled) setRuntimeError(error.message);
      });
    return () => {
      cancelled = true;
    };
  }, [client]);

  const commitName = async () => {
    if (!name.trim() || name.trim() === project?.name) {
      setName(project?.name ?? '');
      return;
    }
    await saveProjectName(name.trim());
  };

  return (
    <>
      <div className="toolbar">
        <button className="btn" onClick={() => setPage('workspace')}>返回工作台</button>
        <span className="divider" />
        <strong className="t-13">项目与运行环境</strong>
        <span className={`chip ${mode === 'live' ? 'ok' : 'warn'}`}>{mode === 'live' ? '真实服务' : '演示模式（SYNTHETIC）'}</span>
        <div className="grow" />
        {mode === 'mock' && <button className="btn sm danger" onClick={() => void demoReset()}>重置演示数据</button>}
      </div>

      <div className="page-scroll">
        <div className="split-2">
          <div>
            <h2 style={{ marginTop: 0 }}>项目</h2>
            {project ? (
              <div className="card" style={{ padding: 12, marginBottom: 10 }}>
                <div className="field">
                  <label>当前项目名称</label>
                  <input value={name} onChange={(event) => setName(event.target.value)} onBlur={() => void commitName()} onKeyDown={(event) => { if (event.key === 'Enter') (event.target as HTMLInputElement).blur(); }} />
                </div>
                <div className="kv">
                  <dt>project_id</dt>
                  <dd className="mono">{project.project_id}</dd>
                  <dt>修订号</dt>
                  <dd>{project.revision}</dd>
                  <dt>图件数</dt>
                  <dd>{project.figure_count}</dd>
                  <dt>更新时间</dt>
                  <dd>{new Date(project.updated_at).toLocaleString('zh-CN')}</dd>
                  <dt>数据集版本</dt>
                  <dd className="mono">{project.dataset_versions.map((item) => `${item.dataset_id}@${item.version}`).join('、') || '—'}</dd>
                </div>
              </div>
            ) : (
              <div className="small muted">未选择项目。</div>
            )}

            <div className="row" style={{ marginTop: 8 }}>
              <select value={project?.project_id ?? ''} onChange={(event) => void setProject(event.target.value)} style={{ flex: 1 }}>
                {projects.map((item) => (
                  <option key={item.project_id} value={item.project_id}>{item.name}（{item.figure_count} 图）</option>
                ))}
              </select>
            </div>
            <div className="row" style={{ marginTop: 8 }}>
              <input value={newName} onChange={(event) => setNewName(event.target.value)} placeholder="新项目名称" style={{ flex: 1 }} />
              <button className="btn" onClick={() => void createProject(newName.trim() || '新项目')}>新建项目</button>
            </div>

            <h3 style={{ marginTop: 18 }}>内置数据集挂载状态</h3>
            <table className="table-simple">
              <thead>
                <tr>
                  <th>目录</th>
                  <th>基线</th>
                  <th>状态</th>
                  <th>待确认单位</th>
                </tr>
              </thead>
              <tbody>
                {catalog.map((entry) => (
                  <tr key={entry.data_id}>
                    <td>
                      {entry.label}
                      <div className="small muted">{entry.sheet} · {entry.role}</div>
                    </td>
                    <td className="num">{entry.record_baseline.toLocaleString()}</td>
                    <td>
                      <span className={`chip ${entry.attached ? 'ok' : ''}`}>{entry.attached ? `已挂载 ${entry.version ?? ''}` : '未挂载'}</span>
                    </td>
                    <td className="num">{entry.unit_confirmation_pending}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <h3 style={{ marginTop: 18 }}>已导入数据集</h3>
            {datasets.length === 0 ? <div className="small muted">当前项目没有数据集。</div> : (
              <table className="table-simple">
                <thead>
                  <tr>
                    <th>数据集</th>
                    <th>角色</th>
                    <th className="num">物理行</th>
                    <th className="num">接受分析</th>
                    <th>映射版本</th>
                  </tr>
                </thead>
                <tbody>
                  {datasets.map((dataset) => (
                    <tr key={`${dataset.dataset_id}@${dataset.version}`}>
                      <td>
                        {dataset.label}
                        <div className="mono small muted">{dataset.dataset_id}@{dataset.version}</div>
                      </td>
                      <td>{dataset.role}</td>
                      <td className="num">{dataset.counts.physical_rows.toLocaleString()}</td>
                      <td className="num">{dataset.counts.accepted_analyses.toLocaleString()}</td>
                      <td className="mono small">{dataset.mapping_version}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div>
            <h2 style={{ marginTop: 0 }}>本机导出目录</h2>
            {exportRoots.length === 0 && <div className="small muted">尚未登记。导出前必须选择本机文件夹。</div>}
            {exportRoots.map((root) => (
              <div key={root.export_root_id} className="card" style={{ padding: 10, marginBottom: 6 }}>
                <div className="mono small">{root.absolute_path}</div>
                <div className="row" style={{ marginTop: 4 }}>
                  <span className="chip">{root.display_name}</span>
                  <span className={`chip ${root.writable_check === 'ok' ? 'ok' : root.writable_check === 'unwritable' ? 'err' : ''}`}>
                    {root.writable_check === 'ok' ? '可写' : root.writable_check === 'unwritable' ? '不可写' : '未检测'}
                  </span>
                  {root.is_default && <span className="chip">默认</span>}
                </div>
              </div>
            ))}
            <div className="row" style={{ marginTop: 8 }}>
              <button className="btn sm" disabled={choosing || mode === 'mock'} onClick={async () => { setChoosing(true); try { await chooseExportRoot(); } finally { setChoosing(false); } }}>
                {choosing ? '等待系统对话框…' : '选择本机文件夹…'}
              </button>
            </div>
            <div className="row" style={{ marginTop: 6 }}>
              <input value={path} onChange={(event) => setPath(event.target.value)} placeholder="D:\GeoPlot输出" style={{ flex: 1 }} />
              <button className="btn sm" disabled={!path.trim()} onClick={async () => { const added = await registerExportRoot(path.trim()); if (added) setPath(''); }}>登记目录</button>
            </div>
            {mode === 'mock' && <div className="small muted">演示模式不写本机磁盘；目录登记只保存在浏览器演示数据中。</div>}

            <h2 style={{ marginTop: 18 }}>运行环境</h2>
            {runtimeError && <div className="banner err">{runtimeError}</div>}
            {runtime ? (
              <div className="kv">
                <dt>应用</dt>
                <dd>{runtime.app_id} {runtime.app_version}</dd>
                <dt>配置</dt>
                <dd className="mono">{runtime.profile_id}</dd>
                <dt>实例</dt>
                <dd className="mono">{runtime.instance_id}</dd>
                <dt>状态</dt>
                <dd>{runtime.state}</dd>
                <dt>PID</dt>
                <dd>{runtime.pid}</dd>
                <dt>启动时间</dt>
                <dd>{new Date(runtime.process_started_at).toLocaleString('zh-CN')}</dd>
                <dt>Base URL</dt>
                <dd className="mono">{runtime.base_url}</dd>
                <dt>活动任务</dt>
                <dd>{runtime.active_jobs}</dd>
              </div>
            ) : (
              <div className="small muted">正在读取运行状态…</div>
            )}

            <div className="banner info" style={{ marginTop: 10 }}>
              服务、科学计算、共享 schema、写盘、启动器与打包由 Qoder 负责。本页只展示后端返回的状态，不自行停止或启动进程。
              {modeReason && <div className="small">{modeReason}</div>}
            </div>

            <div className="row" style={{ marginTop: 8 }}>
              <button className="btn" onClick={() => { void setPage('import'); toast('info', '导入与内置库在“导入 / 上传”页'); }}>导入 / 上传</button>
              <button className="btn" onClick={() => setPage('exports')}>导出记录</button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
