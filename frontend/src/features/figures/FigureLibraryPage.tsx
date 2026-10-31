import { useEffect, useState } from 'react';
import { useWorkspace } from '../../state/workspaceStore';
import { Modal } from '../../components/Modal';

export function FigureLibraryPage() {
  const figures = useWorkspace((s) => s.figures);
  const figure = useWorkspace((s) => s.figure);
  const revisions = useWorkspace((s) => s.revisions);
  const refreshFigures = useWorkspace((s) => s.refreshFigures);
  const openFigure = useWorkspace((s) => s.openFigure);
  const newFigure = useWorkspace((s) => s.newFigure);
  const renameFigure = useWorkspace((s) => s.renameFigure);
  const archiveFigure = useWorkspace((s) => s.archiveFigure);
  const restoreRevision = useWorkspace((s) => s.restoreRevision);
  const setPage = useWorkspace((s) => s.setPage);
  const project = useWorkspace((s) => s.project);
  const toast = useWorkspace((s) => s.toast);

  const [newOpen, setNewOpen] = useState(false);
  const [newName, setNewName] = useState('新的图件');
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [onlyActive, setOnlyActive] = useState(false);

  useEffect(() => {
    void refreshFigures();
  }, [refreshFigures]);

  const list = figures.filter((item) => (onlyActive ? !item.archived : true));

  const open = async (id: string) => {
    await openFigure(id);
    setPage('workspace');
  };

  const create = async () => {
    await newFigure(newName.trim() || '未命名图件');
    setNewOpen(false);
    setPage('workspace');
  };

  const commitRename = async () => {
    if (!figure || !renameValue.trim() || renameValue.trim() === figure.name) {
      setRenameId(null);
      return;
    }
    await renameFigure(renameValue.trim());
    setRenameId(null);
  };

  return (
    <>
      <div className="toolbar">
        <button className="btn" onClick={() => setPage('workspace')}>返回工作台</button>
        <span className="divider" />
        <strong className="t-13">图件库</strong>
        <span className="chip">{project?.name ?? '未选择项目'}</span>
        <div className="grow" />
        <label className="check">
          <input type="checkbox" checked={onlyActive} onChange={(event) => setOnlyActive(event.target.checked)} />
          隐藏已归档
        </label>
        <button className="btn" onClick={() => void refreshFigures()}>刷新</button>
        <button className="btn primary" onClick={() => setNewOpen(true)}>新建图件</button>
      </div>

      <div className="page-scroll">
        <p className="muted" style={{ marginTop: 0 }}>
          图件草稿可变、保存版本不可变；导出记录按版本冻结。重开编辑不会悄悄切换到新的数据集版本。
        </p>

        {list.length === 0 && <div className="empty-state">当前项目还没有图件。点击“新建图件”开始。</div>}
        <div className="card-grid">
          {list.map((item) => {
            const active = item.figure_id === figure?.figure_id;
            return (
              <div key={item.figure_id} className={`card figure-card ${active ? 'active' : ''}`}>
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  {renameId === item.figure_id ? (
                    <input
                      autoFocus
                      value={renameValue}
                      onChange={(event) => setRenameValue(event.target.value)}
                      onBlur={() => void commitRename()}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') void commitRename();
                        if (event.key === 'Escape') setRenameId(null);
                      }}
                      style={{ flex: 1 }}
                    />
                  ) : (
                    <strong className="t-13">{item.name}</strong>
                  )}
                  {item.archived && <span className="chip warn">已归档</span>}
                  {active && <span className="chip ok">当前打开</span>}
                </div>
                <div className="small muted mono" style={{ marginTop: 4 }}>{item.figure_id}</div>
                <div className="small muted">更新：{new Date(item.updated_at).toLocaleString('zh-CN')}</div>
                <div className="small muted">
                  当前版本：{item.current_revision_id ?? '尚无保存版本'}
                </div>
                <div className="row" style={{ marginTop: 8 }}>
                  <button className="btn sm primary" onClick={() => void open(item.figure_id)}>打开编辑</button>
                  <button
                    className="btn sm"
                    disabled={!active}
                    onClick={() => {
                      if (!active) return;
                      setRenameId(item.figure_id);
                      setRenameValue(item.name);
                    }}
                  >
                    重命名
                  </button>
                  <button
                    className="btn sm"
                    disabled={!active}
                    onClick={() => {
                      if (!active) return;
                      void archiveFigure(!item.archived);
                      toast('info', item.archived ? '已取消归档' : '已归档；数据保留');
                    }}
                  >
                    {item.archived ? '取消归档' : '归档'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {figure && (
          <>
            <h3 style={{ marginTop: 18 }}>当前图件的保存版本（{revisions.length}）</h3>
            {revisions.length === 0 && (
              <div className="small muted">尚无不可变版本。在工作台点击“保存版本”冻结当前 PlotSpec 与 Scene，之后才能导出。</div>
            )}
            {revisions.length > 0 && (
              <table className="table-simple">
                <thead>
                  <tr>
                    <th>版本</th>
                    <th>revision_id</th>
                    <th>Scene</th>
                    <th>时间</th>
                    <th>分析数</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {[...revisions].reverse().map((revision) => (
                    <tr key={revision.revision_id}>
                      <td>r{revision.revision_number}{figure.current_revision_id === revision.revision_id && <span className="chip ok" style={{ marginLeft: 4 }}>当前</span>}</td>
                      <td className="mono small">{revision.revision_id}</td>
                      <td className="mono small">{revision.scene_id}</td>
                      <td className="small">{new Date(revision.created_at).toLocaleString('zh-CN')}</td>
                      <td className="num">{revision.resolved_analysis_ids.length}</td>
                      <td>
                        <button className="btn sm" onClick={() => void restoreRevision(revision.revision_id)}>
                          恢复并继续编辑
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <p className="small muted">恢复版本会创建新的可变草稿，不覆盖已有版本；导出记录仍指向原版本。</p>
          </>
        )}
      </div>

      {newOpen && (
        <Modal
          title="新建图件"
          onClose={() => setNewOpen(false)}
          footer={
            <>
              <button className="btn" onClick={() => setNewOpen(false)}>取消</button>
              <button className="btn primary" onClick={() => void create()}>创建</button>
            </>
          }
        >
          <label className="field">
            <span>图件名称</span>
            <input autoFocus value={newName} onChange={(event) => setNewName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void create(); }} />
          </label>
          <p className="small muted">新图件将使用当前图的图表类型与图层草稿；之后可独立保存版本与导出。</p>
        </Modal>
      )}
    </>
  );
}
