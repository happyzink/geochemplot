import { useEffect, useState } from 'react';
import { useWorkspace } from '../../state/workspaceStore';
import { ExportDialog } from './ExportDialog';
import { EXPORT_STATE_LABEL } from '../../lib/labels';

export function ExportsPage() {
  const exports = useWorkspace((s) => s.exports);
  const exportRoots = useWorkspace((s) => s.exportRoots);
  const exportsLoading = useWorkspace((s) => s.exportsLoading);
  const loadExports = useWorkspace((s) => s.loadExports);
  const loadExportRoots = useWorkspace((s) => s.loadExportRoots);
  const figures = useWorkspace((s) => s.figures);
  const refreshFigures = useWorkspace((s) => s.refreshFigures);
  const openExportFolder = useWorkspace((s) => s.openExportFolder);
  const refreshExport = useWorkspace((s) => s.refreshExport);
  const reexport = useWorkspace((s) => s.reexport);
  const demoRemoveFile = useWorkspace((s) => s.demoRemoveFile);
  const activeExportJob = useWorkspace((s) => s.activeExportJob);
  const setPage = useWorkspace((s) => s.setPage);
  const mode = useWorkspace((s) => s.mode);
  const toast = useWorkspace((s) => s.toast);

  const [expanded, setExpanded] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  useEffect(() => {
    void loadExports();
    void loadExportRoots();
    void refreshFigures();
  }, [loadExports, loadExportRoots, refreshFigures]);

  const figureName = (figureId: string) => figures.find((item) => item.figure_id === figureId)?.name ?? figureId;
  const rootPath = (rootId: string) => exportRoots.find((root) => root.export_root_id === rootId)?.absolute_path ?? '（目录未登记）';

  return (
    <>
      <div className="toolbar">
        <button className="btn" onClick={() => setPage('workspace')}>返回工作台</button>
        <span className="divider" />
        <strong className="t-13">导出记录</strong>
        {mode === 'mock' && <span className="chip warn">演示模式 · 不写本机磁盘</span>}
        {activeExportJob && <span className="chip">正在导出 {activeExportJob.exportId}…</span>}
        <div className="grow" />
        <button className="btn" onClick={() => { void loadExports(); void loadExportRoots(); }}>刷新全部</button>
        <button className="btn primary" onClick={() => setDialogOpen(true)}>导出当前图件…</button>
      </div>

      <div className="page-scroll">
        <p className="muted" style={{ marginTop: 0 }}>
          每条记录指向冻结的图件版本与 Scene。文件缺失会如实显示；“打开目录”使用操作系统文件管理器并返回真实结果。
        </p>

        {exports.length === 0 && !exportsLoading && (
          <div className="empty-state">
            <div className="big">还没有导出记录</div>
            <p className="muted">保存版本后，从工作台点击“导出”选择本机文件夹。</p>
          </div>
        )}

        {exports.map((record) => {
          const missing = record.files.filter((file) => !file.exists);
          const expandedRow = expanded === record.export_id;
          return (
            <div key={record.export_id} className="export-card">
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <div className="row" style={{ gap: 8 }}>
                  <span className={`chip ${record.state === 'succeeded' ? 'ok' : record.state === 'failed' || record.state === 'interrupted' ? 'err' : 'warn'}`}>
                    {EXPORT_STATE_LABEL[record.state]}
                  </span>
                  <strong className="t-12">{figureName(record.figure_id)}</strong>
                  <span className="mono small muted">{record.export_id}</span>
                </div>
                <span className="small muted">{new Date(record.created_at).toLocaleString('zh-CN')}</span>
              </div>

              <div className="export-meta mono small">
                <div>版本：{record.revision_id} · Scene：{record.scene_id} · 哈希：{record.scene_hash.slice(0, 12)}…</div>
                <div>目录：{rootPath(record.export_root_id)} \{record.relative_dir.replace(/\//g, '\\')}</div>
                <div>
                  版面：{record.size_mm.width} × {record.size_mm.height} mm · {record.formats.join(' / ')}
                  {record.dpi ? ` · ${record.dpi} dpi` : ''} · {record.background === 'white' ? '白底' : '透明底'}
                </div>
                <div>
                  文件：{record.files.length} 个
                  {missing.length > 0 && <span style={{ color: 'var(--err)' }}> · 缺失 {missing.length} 个</span>}
                  {record.error && <span style={{ color: 'var(--err)' }}> · {record.error.code}：{record.error.message}</span>}
                </div>
              </div>

              {missing.length > 0 && (
                <div className="banner err" style={{ margin: '6px 0' }}>
                  检测到 {missing.length} 个文件不存在（可能被移动或删除）。记录仍指向原冻结版本，可按原版本重新导出。
                </div>
              )}

              <div className="row" style={{ marginTop: 6 }}>
                <button className="btn sm" onClick={() => void openExportFolder(record.export_id)}>打开所在文件夹</button>
                <button className="btn sm" onClick={() => void refreshExport(record.export_id)}>刷新文件状态</button>
                <button className="btn sm" onClick={() => void reexport(record.export_id, record.export_root_id)}>按原版本重导</button>
                <button className="btn sm" onClick={() => setExpanded(expandedRow ? null : record.export_id)}>
                  {expandedRow ? '收起文件列表' : '查看文件列表'}
                </button>
                <div className="grow" />
                {mode === 'mock' && record.files.length > 0 && (
                  <button
                    className="btn sm danger"
                    onClick={() => void demoRemoveFile(record.export_id, record.files[0].filename).then(() => toast('info', '已模拟外部移除一个文件'))}
                  >
                    演示：模拟文件缺失
                  </button>
                )}
              </div>

              {expandedRow && (
                <div className="reference-table-scroll" style={{ marginTop: 8 }}>
                  <table className="table-simple">
                    <thead>
                      <tr>
                        <th>文件</th>
                        <th>格式</th>
                        <th className="num">字节</th>
                        <th>存在</th>
                        <th>SHA-256</th>
                        <th>绝对路径</th>
                      </tr>
                    </thead>
                    <tbody>
                      {record.files.map((file) => (
                        <tr key={file.absolute_path}>
                          <td className="mono small">{file.filename}</td>
                          <td>{file.format.toUpperCase()}</td>
                          <td className="num">{file.byte_size == null ? '—' : file.byte_size.toLocaleString()}</td>
                          <td>
                            <span className={`chip ${file.exists ? 'ok' : 'err'}`}>{file.exists ? '存在' : '缺失'}</span>
                          </td>
                          <td className="mono small">{file.sha256 ? `${file.sha256.slice(0, 16)}…` : '—'}</td>
                          <td className="mono small">{file.absolute_path}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <ExportDialog open={dialogOpen} onClose={() => setDialogOpen(false)} />
    </>
  );
}
