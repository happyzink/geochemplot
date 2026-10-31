import { useEffect, useState } from 'react';
import { Modal } from '../../components/Modal';
import { useWorkspace } from '../../state/workspaceStore';
import { InteractivePlot } from '../plot/InteractivePlot';

interface Props {
  open: boolean;
  onClose: () => void;
}

export function ExportDialog({ open, onClose }: Props) {
  const scene = useWorkspace((s) => s.scene);
  const spec = useWorkspace((s) => s.spec);
  const figure = useWorkspace((s) => s.figure);
  const stale = useWorkspace((s) => s.stale);
  const roots = useWorkspace((s) => s.exportRoots);
  const loadExportRoots = useWorkspace((s) => s.loadExportRoots);
  const chooseExportRoot = useWorkspace((s) => s.chooseExportRoot);
  const registerExportRoot = useWorkspace((s) => s.registerExportRoot);
  const startExport = useWorkspace((s) => s.startExport);
  const activeExportJob = useWorkspace((s) => s.activeExportJob);
  const setPage = useWorkspace((s) => s.setPage);
  const mode = useWorkspace((s) => s.mode);

  const [formats, setFormats] = useState<Array<'png' | 'pdf' | 'svg'>>(['png', 'pdf', 'svg']);
  const [dpi, setDpi] = useState<number | null>(300);
  const [background, setBackground] = useState<'white' | 'transparent'>('white');
  const [width, setWidth] = useState(spec.layout.width_mm);
  const [height, setHeight] = useState(spec.layout.height_mm);
  const [rootId, setRootId] = useState('');
  const [manualPath, setManualPath] = useState('');
  const [choosing, setChoosing] = useState(false);

  useEffect(() => {
    if (!open) return;
    void loadExportRoots();
    setWidth(spec.layout.width_mm);
    setHeight(spec.layout.height_mm);
  }, [open]);

  useEffect(() => {
    if (!rootId && roots.length > 0) {
      setRootId((roots.find((root) => root.is_default) ?? roots[0]).export_root_id);
    }
  }, [roots, rootId]);

  if (!open) return null;

  const root = roots.find((item) => item.export_root_id === rootId) ?? null;
  const busy = activeExportJob != null;
  const blockers: string[] = [];
  if (!figure?.current_revision_id) blockers.push('尚未保存版本：导出必须冻结不可变版本。');
  if (stale) blockers.push('Scene 已过期或正在重算：禁止用旧图导出。');
  if (!scene) blockers.push('Scene 尚未计算完成。');
  if (!root) blockers.push('请选择导出文件夹。');
  if (root && root.writable_check === 'unwritable') blockers.push(`目录不可写：${root.absolute_path}`);
  if (root && mode === 'mock') blockers.push('演示模式不会真正写盘；请在真实服务上导出。');
  if (formats.length === 0) blockers.push('至少选择一种格式。');

  const toggleFormat = (format: 'png' | 'pdf' | 'svg') => {
    setFormats((prev) => (prev.includes(format) ? prev.filter((item) => item !== format) : [...prev, format]));
  };

  const doChoose = async () => {
    setChoosing(true);
    try {
      const chosen = await chooseExportRoot();
      if (chosen) setRootId(chosen.export_root_id);
    } finally {
      setChoosing(false);
    }
  };

  const doRegister = async () => {
    if (!manualPath.trim()) return;
    const added = await registerExportRoot(manualPath.trim());
    if (added) setRootId(added.export_root_id);
  };

  const doExport = async () => {
    if (blockers.length > 0) return;
    await startExport({ formats, dpi: formats.includes('png') ? dpi : null, background, width, height, exportRootId: rootId });
    setPage('exports');
    onClose();
  };

  return (
    <Modal
      title="导出图件"
      subtitle="选择本机文件夹；只有全部校验与写入完成后才显示成功与真实路径。"
      width="wide"
      onClose={busy ? () => undefined : onClose}
      footer={
        <>
          <button className="btn" disabled={busy} onClick={onClose}>取消</button>
          <button className="btn primary" disabled={busy || blockers.length > 0} onClick={() => void doExport()}>
            {busy ? '导出中…' : `开始导出（${formats.join(' / ') || '未选格式'}）`}
          </button>
        </>
      }
    >
      <div className="split-2">
        <div>
          <div className="field">
            <label>格式</label>
            <div className="row">
              {(['png', 'pdf', 'svg'] as const).map((format) => (
                <label key={format} className="check">
                  <input type="checkbox" checked={formats.includes(format)} onChange={() => toggleFormat(format)} />
                  {format.toUpperCase()}
                </label>
              ))}
            </div>
          </div>

          <div className="row" style={{ gap: 8, flexWrap: 'nowrap' }}>
            <label style={{ flex: 1 }}>
              <span className="small muted">宽 mm</span>
              <input type="number" min={30} max={420} value={width} onChange={(event) => setWidth(Number(event.target.value))} />
            </label>
            <label style={{ flex: 1 }}>
              <span className="small muted">高 mm</span>
              <input type="number" min={30} max={420} value={height} onChange={(event) => setHeight(Number(event.target.value))} />
            </label>
            <label style={{ flex: 1 }}>
              <span className="small muted">PNG dpi</span>
              <select value={dpi ?? 300} onChange={(event) => setDpi(Number(event.target.value))} disabled={!formats.includes('png')}>
                <option value={300}>300</option>
                <option value={600}>600</option>
                <option value={150}>150</option>
              </select>
            </label>
          </div>

          <div className="field">
            <label>背景</label>
            <div className="segmented">
              <button className={background === 'white' ? 'active' : ''} onClick={() => setBackground('white')}>白色</button>
              <button className={background === 'transparent' ? 'active' : ''} onClick={() => setBackground('transparent')}>透明</button>
            </div>
          </div>

          <div className="field">
            <label>导出文件夹</label>
            {roots.length === 0 && <div className="small muted">尚未登记目录。请选择本机文件夹。</div>}
            {roots.map((item) => (
              <label key={item.export_root_id} className="root-row">
                <input type="radio" checked={rootId === item.export_root_id} onChange={() => setRootId(item.export_root_id)} />
                <span>
                  <span className="mono">{item.absolute_path}</span>
                  <span className={`chip ${item.writable_check === 'ok' ? 'ok' : item.writable_check === 'unwritable' ? 'err' : ''}`} style={{ marginLeft: 6 }}>
                    {item.writable_check === 'ok' ? '可写' : item.writable_check === 'unwritable' ? '不可写' : '未检测'}
                  </span>
                  {item.is_default && <span className="chip" style={{ marginLeft: 4 }}>默认</span>}
                </span>
              </label>
            ))}
            <div className="row" style={{ marginTop: 6 }}>
              <button className="btn sm" disabled={choosing || mode === 'mock'} onClick={() => void doChoose()}>
                {choosing ? '等待选择…' : '选择本机文件夹…'}
              </button>
              <input
                placeholder="或输入本机绝对路径（如 D:\图件）"
                value={manualPath}
                onChange={(event) => setManualPath(event.target.value)}
                style={{ flex: 1 }}
              />
              <button className="btn sm" onClick={() => void doRegister()} disabled={!manualPath.trim()}>登记</button>
            </div>
            {mode === 'mock' && <div className="small muted">演示模式下“选择本机文件夹”由系统对话框提供，不对本机写盘。</div>}
          </div>

          <div className="field">
            <label>导出快照</label>
            <div className="kv">
              <dt>图件</dt>
              <dd>{figure?.name ?? '—'}</dd>
              <dt>版本</dt>
              <dd className="mono">{figure?.current_revision_id ?? '未保存'}</dd>
              <dt>Scene</dt>
              <dd className="mono">{scene?.scene_id ?? '—'}</dd>
              <dt>已选 / 有效 / 排除</dt>
              <dd>{scene?.counts.selected_analyses ?? 0} / {scene?.counts.valid_analyses ?? 0} / {scene?.counts.excluded_analyses ?? 0}</dd>
              <dt>本图点数</dt>
              <dd>{scene?.counts.plotted_points ?? 0}</dd>
            </div>
          </div>
        </div>

        <div>
          <h4 style={{ marginTop: 0 }}>版式预览（{width} × {height} mm）</h4>
          <div style={{ position: 'relative', width: '100%', maxWidth: 380, aspectRatio: `${width} / ${height}`, border: '1px solid var(--line)', background: background === 'transparent' ? 'repeating-conic-gradient(#eee 0% 25%, #fff 0% 50%) 50% / 16px 16px' : '#fff' }}>
            <InteractivePlot compact />
          </div>
          <p className="small muted">预览使用当前 Scene；导出前会校验 Scene/spec 哈希与冻结版本一致。</p>

          {scene && scene.warnings.length > 0 && (
            <div className="banner warn">
              {scene.warnings.map((warning) => (
                <div key={warning}>{warning}</div>
              ))}
            </div>
          )}
          {scene && scene.exclusions.length > 0 && (
            <div className="small muted">
              排除原因：
              {[...new Set(scene.exclusions.map((exclusion) => exclusion.reason_code))]
                .slice(0, 5)
                .map((code) => `${code}(${scene.exclusions.filter((exclusion) => exclusion.reason_code === code).length})`)
                .join('、')}
            </div>
          )}
          {scene && (
            <div className="small muted">
              参考：{scene.reference_snapshots.map((ref) => `${ref.ref_id}@${ref.version}`).join('、') || '未使用'}
            </div>
          )}
          {blockers.length > 0 && (
            <div className="banner err" style={{ marginTop: 8 }}>
              {blockers.map((blocker) => <div key={blocker}>{blocker}</div>)}
            </div>
          )}
          <p className="small muted">
            导出冻结版本与 Scene；继续修改当前图不会影响正在进行的导出。复现包含配置、数据、参考值、排除清单。
          </p>
        </div>
      </div>
    </Modal>
  );
}
