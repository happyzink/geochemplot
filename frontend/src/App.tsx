import { useEffect } from 'react';
import type { ClientResolution } from './lib/api';
import { useWorkspace } from './state/workspaceStore';
import { TopBar } from './features/layout/TopBar';
import { StatusBar } from './features/layout/StatusBar';
import { WorkspacePage } from './features/workspace/WorkspacePage';
import { ImportPage } from './features/import/ImportPage';
import { FigureLibraryPage } from './features/figures/FigureLibraryPage';
import { ExportsPage } from './features/exports/ExportsPage';
import { ProjectsPage } from './features/projects/ProjectsPage';
import { AxisFormatPanel } from './features/plot/AxisFormatPanel';
import { SeriesFormatPanel } from './features/plot/SeriesFormatPanel';
import { ReferencePicker } from './features/plot/ReferencePicker';
import { LegendEditor } from './features/plot/LegendEditor';
import { Toasts } from './features/layout/Toasts';

export function App({ resolution }: { resolution: ClientResolution }) {
  const booted = useWorkspace((s) => s.booted);
  const bootError = useWorkspace((s) => s.bootError);
  const init = useWorkspace((s) => s.init);
  const page = useWorkspace((s) => s.page);
  const undo = useWorkspace((s) => s.undo);
  const redo = useWorkspace((s) => s.redo);
  const saveDraftNow = useWorkspace((s) => s.saveDraftNow);
  const undoAvailable = useWorkspace((s) => s.undoStack.length > 0);
  const redoAvailable = useWorkspace((s) => s.redoStack.length > 0);

  useEffect(() => {
    void init(resolution);
  }, [init, resolution]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable;
      if (typing) return;
      const mod = event.ctrlKey || event.metaKey;
      if (!mod) return;
      if (event.key.toLowerCase() === 'z' && !event.shiftKey) {
        event.preventDefault();
        if (undoAvailable) undo();
      } else if ((event.key.toLowerCase() === 'z' && event.shiftKey) || event.key.toLowerCase() === 'y') {
        event.preventDefault();
        if (redoAvailable) redo();
      } else if (event.key.toLowerCase() === 's') {
        event.preventDefault();
        void saveDraftNow();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [undo, redo, undoAvailable, redoAvailable, saveDraftNow]);

  if (!booted) {
    return (
      <div className="splash">
        <div className="box">
          <h1>GeoPlot 科研绘图工作台</h1>
          <p>正在连接本地服务并载入项目…</p>
          <div className="spinner" />
        </div>
      </div>
    );
  }

  if (bootError) {
    return (
      <div className="splash">
        <div className="box">
          <h1>无法启动工作台</h1>
          <p className="error">{bootError}</p>
          <p className="small muted">{resolution.reason}</p>
          <p>当前模式：{resolution.mode === 'live' ? '真实服务（未降级到演示）' : '显式演示'}；草稿不会被演示数据替换。</p>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <TopBar />
      <div className={page === 'workspace' ? 'page' : 'page page-column'}>
        {page === 'workspace' && <WorkspacePage />}
        {page === 'import' && <ImportPage />}
        {page === 'figures' && <FigureLibraryPage />}
        {page === 'exports' && <ExportsPage />}
        {page === 'projects' && <ProjectsPage />}
      </div>
      <StatusBar />
      <AxisFormatPanel />
      <SeriesFormatPanel />
      <ReferencePicker />
      <LegendEditor />
      <Toasts />
    </div>
  );
}
