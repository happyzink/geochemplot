import { useWorkspace } from '../../state/workspaceStore';

export function Toasts() {
  const toasts = useWorkspace((s) => s.toasts);
  const dismissToast = useWorkspace((s) => s.dismissToast);

  if (toasts.length === 0) return null;

  return (
    <div className="toast-stack" aria-live="polite">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast ${toast.kind}`} onClick={() => dismissToast(toast.id)} title="点击关闭">
          {toast.text}
        </div>
      ))}
    </div>
  );
}
