import { useWorkspace } from '../../state/workspaceStore';

const COMPUTE_TEXT: Record<string, string> = {
  idle: '尚未计算',
  computing: '正在计算 Scene',
  ready: 'Scene 就绪',
  error: 'Scene 计算失败',
};

export function StatusBar() {
  const mode = useWorkspace((s) => s.mode);
  const modeReason = useWorkspace((s) => s.modeReason);
  const project = useWorkspace((s) => s.project);
  const activeDatasetIds = useWorkspace((s) => s.activeDatasetIds);
  const analysesTotal = useWorkspace((s) => s.analysesTotal);
  const selection = useWorkspace((s) => s.selection);
  const computeState = useWorkspace((s) => s.computeState);
  const scene = useWorkspace((s) => s.scene);
  const stale = useWorkspace((s) => s.stale);
  const sceneError = useWorkspace((s) => s.sceneError);
  const exportRoots = useWorkspace((s) => s.exportRoots);

  const pillClass = computeState === 'error' ? 'error' : computeState === 'computing' || stale ? 'pending' : '';

  return (
    <footer className="statusbar">
      <span className={`pill ${pillClass}`} title={sceneError ?? undefined}>
        <span className="led" />
        {COMPUTE_TEXT[computeState] ?? computeState}
        {stale && computeState !== 'error' ? '（旧 Scene）' : ''}
      </span>
      <span className="sep" />
      <span>
        模式 <strong>{mode === 'live' ? '真实服务' : '演示'}</strong>
      </span>
      <span>
        数据集 <strong>{activeDatasetIds.length}</strong>
      </span>
      <span>
        记录 <strong>{analysesTotal}</strong>
      </span>
      <span>
        已勾选 <strong>{selection.ids.size}</strong>
      </span>
      <span>
        导出目录 <strong>{exportRoots.length}</strong>
      </span>
      <span className="sep" />
      <span className="mono muted">
        {scene ? `scene ${scene.scene_hash.slice(0, 12)} · spec ${scene.spec_hash.slice(0, 8)}` : 'scene —'}
      </span>
      <div className="grow" />
      <span className="muted" title={modeReason}>
        {project?.name ? `${project.name} · ` : ''}
        {modeReason}
      </span>
    </footer>
  );
}
