import { useWorkspace, type Page } from '../../state/workspaceStore';

const NAV: Array<{ key: Page; label: string }> = [
  { key: 'workspace', label: '作图工作台' },
  { key: 'import', label: '导入 / 上传' },
  { key: 'figures', label: '图件库' },
  { key: 'exports', label: '导出记录' },
  { key: 'projects', label: '项目' },
];

const AUTOSAVE_TEXT: Record<string, string> = {
  idle: '草稿未保存',
  pending: '草稿待保存…',
  saving: '草稿保存中…',
  saved: '草稿已保存',
  conflict: '草稿版本冲突',
  error: '草稿保存失败',
};

export function TopBar() {
  const page = useWorkspace((s) => s.page);
  const setPage = useWorkspace((s) => s.setPage);
  const mode = useWorkspace((s) => s.mode);
  const modeReason = useWorkspace((s) => s.modeReason);
  const projects = useWorkspace((s) => s.projects);
  const project = useWorkspace((s) => s.project);
  const setProject = useWorkspace((s) => s.setProject);
  const selection = useWorkspace((s) => s.selection);
  const pendingConfirmations = useWorkspace((s) => s.pendingConfirmations);
  const undo = useWorkspace((s) => s.undo);
  const redo = useWorkspace((s) => s.redo);
  const undoAvailable = useWorkspace((s) => s.undoStack.length > 0);
  const redoAvailable = useWorkspace((s) => s.redoStack.length > 0);
  const autosaveState = useWorkspace((s) => s.autosaveState);
  const autosaveError = useWorkspace((s) => s.autosaveError);
  const demoReset = useWorkspace((s) => s.demoReset);

  return (
    <>
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">GP</span>
          <div>
            GeoPlot
            <small>科研绘图工具 · 中文工作台</small>
          </div>
        </div>

        <label className="project-picker">
          <span className="small muted">项目</span>
          <select
            value={project?.project_id ?? ''}
            onChange={(event) => {
              if (event.target.value) void setProject(event.target.value);
            }}
            title="切换项目：数据集、图件和导出目录随项目保存"
          >
            {projects.length === 0 && <option value="">（载入中）</option>}
            {projects.map((item) => (
              <option key={item.project_id} value={item.project_id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>

        <span className={`mode-badge ${mode}`} title={modeReason}>
          {mode === 'live' ? '本地服务' : '演示模式'}
        </span>

        <div className="spacer" />

        <span className="small muted" data-testid="selection-count">
          已勾选 {selection.ids.size}
        </span>
        <button className="icon-btn" title="撤销（Ctrl+Z）" disabled={!undoAvailable} onClick={undo}>
          ↶
        </button>
        <button className="icon-btn" title="重做（Ctrl+Shift+Z）" disabled={!redoAvailable} onClick={redo}>
          ↷
        </button>
        <span
          className="small muted"
          style={autosaveState === 'error' || autosaveState === 'conflict' ? { color: 'var(--err)' } : undefined}
          title={autosaveError ?? undefined}
        >
          {AUTOSAVE_TEXT[autosaveState] ?? autosaveState}
        </span>
      </header>

      <nav className="navbar">
        {NAV.map((item) => (
          <button
            key={item.key}
            className={`nav-item${page === item.key ? ' active' : ''}`}
            onClick={() => setPage(item.key)}
          >
            {item.label}
            {item.key === 'import' && pendingConfirmations > 0 && <span className="dot" title="有单位待确认的记录" />}
          </button>
        ))}
        <div className="nav-meta">
          <span>
            模式 <strong>{mode === 'live' ? '真实服务' : '演示（fixture）'}</strong>
          </span>
          <span>
            项目 <strong>{project?.name ?? '—'}</strong>
          </span>
        </div>
      </nav>

      {mode === 'mock' && (
        <div className="demo-banner" data-testid="demo-banner">
          <strong>演示模式</strong>
          <span>
            仅由 URL 显式 <span className="mono">?demo=1</span> 进入；只使用合同 fixture 合成数据，不调用本地服务、不真正写盘，导出文件名带 DEMO 标记。生产模式连接失败时显示错误，不会自动降级到演示。
          </span>
          <span className="demo-actions">
            <button className="btn sm ghost" onClick={() => void demoReset()} title="清空演示草稿、选择集与导出记录">
              重置演示数据
            </button>
          </span>
        </div>
      )}
    </>
  );
}
