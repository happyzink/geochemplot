import { useEffect, useMemo, useRef, useState } from 'react';
import Plotly from 'plotly.js-dist-min';
import { useWorkspace } from '../../state/workspaceStore';
import { buildPlotly, resolveLegend } from '../../lib/sceneToPlotly';
import { markerGlyph } from '../../lib/expressions';

type PlotlyElement = HTMLElement & {
  on: (event: string, handler: (payload: any) => void) => void;
  removeAllListeners?: (event?: string) => void;
};

interface Props {
  compact?: boolean;
  selectMode?: boolean;
  onViewport?: (ranges: { x?: [number, number]; y?: [number, number] }) => void;
}

export function InteractivePlot({ compact = false, selectMode = false, onViewport }: Props) {
  const scene = useWorkspace((s) => s.scene);
  const stale = useWorkspace((s) => s.stale);
  const computeState = useWorkspace((s) => s.computeState);
  const sceneError = useWorkspace((s) => s.sceneError);
  const highlightIds = useWorkspace((s) => s.highlightIds);
  const setAxisPanel = useWorkspace((s) => s.setAxisPanel);
  const setSeriesPanel = useWorkspace((s) => s.setSeriesPanel);
  const setSelectedAnalysis = useWorkspace((s) => s.setSelectedAnalysis);
  const setHighlight = useWorkspace((s) => s.setHighlight);
  const setLegendAnchor = useWorkspace((s) => s.setLegendAnchor);
  const setLegendEditor = useWorkspace((s) => s.setLegendEditor);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const legendRef = useRef<HTMLDivElement | null>(null);
  const lastClick = useRef<{ at: number; id: string } | null>(null);
  const singleClickTimer = useRef<number | null>(null);
  const viewportRef = useRef<{ x?: [number, number]; y?: [number, number] }>({});
  const [draggingLegend, setDraggingLegend] = useState(false);
  const [customAnchor, setCustomAnchor] = useState<{ x: number; y: number } | null>(null);
  const [widthPx, setWidthPx] = useState<number | undefined>(undefined);

  const showLegend = scene ? resolveLegend(scene).position !== 'custom' : false;
  const interactive = !compact;
  const built = useMemo(() => {
    if (!scene) return { bundle: null, error: null as string | null };
    try {
      return { bundle: buildPlotly(scene, { highlightIds, showLegend, widthPx }), error: null as string | null };
    } catch (error) {
      return {
        bundle: null,
        error: error instanceof Error ? error.message : 'Scene 渲染失败：合同字段无效',
      };
    }
  }, [scene, highlightIds, showLegend, widthPx]);
  const bundle = built.bundle;

  useEffect(() => {
    const el = containerRef.current;
    if (!el || !bundle) return;
    let disposed = false;
    const node = el as unknown as PlotlyElement;
    const layout = { ...bundle.layout, dragmode: selectMode ? 'select' : 'zoom' };
    const config = {
      responsive: !compact,
      displaylogo: false,
      doubleClick: false,
      scrollZoom: !compact,
      modeBarButtonsToRemove: ['sendDataToCloud', 'hoverCompareCartesian'],
      toImageButtonOptions: { filename: 'geoplot-preview' },
    };
    const draw = async () => {
      await Plotly.react(el, bundle.data, layout, config);
      if (disposed) return;
      Plotly.Plots.resize(el);
      node.on('plotly_click', (payload: any) => {
        if (!interactive) return;
        const point = payload?.points?.[0];
        const custom = point?.customdata as string[] | undefined;
        if (!custom) return;
        const [analysisId, , , layerId] = custom;
        const now = Date.now();
        if (lastClick.current && lastClick.current.id === analysisId && now - lastClick.current.at < 420) {
          lastClick.current = null;
          // 双击：取消第一次单击挂起的详情弹窗，改开系列格式。
          if (singleClickTimer.current !== null) {
            window.clearTimeout(singleClickTimer.current);
            singleClickTimer.current = null;
          }
          setSeriesPanel({ analysisId, layerId, scope: 'current' });
          return;
        }
        lastClick.current = { at: now, id: analysisId };
        // 单击延迟 260ms 打开详情，避免把双击的第一下变成遮罩弹窗。
        if (singleClickTimer.current !== null) window.clearTimeout(singleClickTimer.current);
        singleClickTimer.current = window.setTimeout(() => {
          singleClickTimer.current = null;
          void setSelectedAnalysis(analysisId);
        }, 260);
      });
      node.on('plotly_selected', (payload: any) => {
        if (!interactive) return;
        const ids = new Set<string>();
        (payload?.points ?? []).forEach((point: any) => {
          const custom = point.customdata as string[] | undefined;
          if (custom?.[0]) ids.add(custom[0]);
        });
        setHighlight([...ids]);
      });
      node.on('plotly_deselect', () => {
        if (!interactive) return;
        setHighlight([]);
      });
      node.on('plotly_relayout', (payload: any) => {
        if (!interactive) return;
        const next: { x?: [number, number]; y?: [number, number] } = {};
        const x0 = payload?.['xaxis.range[0]'];
        const x1 = payload?.['xaxis.range[1]'];
        const y0 = payload?.['yaxis.range[0]'];
        const y1 = payload?.['yaxis.range[1]'];
        if (typeof x0 === 'number' && typeof x1 === 'number') next.x = [x0, x1];
        else if (Array.isArray(payload?.['xaxis.range']) && payload['xaxis.range'].length === 2) {
          next.x = [Number(payload['xaxis.range'][0]), Number(payload['xaxis.range'][1])];
        }
        if (typeof y0 === 'number' && typeof y1 === 'number') next.y = [y0, y1];
        else if (Array.isArray(payload?.['yaxis.range']) && payload['yaxis.range'].length === 2) {
          next.y = [Number(payload['yaxis.range'][0]), Number(payload['yaxis.range'][1])];
        }
        if (!next.x && !next.y) return;
        if (next.x && scene?.axes.x.scale === 'log10') next.x = [10 ** next.x[0], 10 ** next.x[1]] as [number, number];
        if (next.y && scene?.axes.y.scale === 'log10') next.y = [10 ** next.y[0], 10 ** next.y[1]] as [number, number];
        viewportRef.current = { ...viewportRef.current, ...next };
        onViewport?.(viewportRef.current);
      });
      node.on('plotly_clickannotation', () => {
        if (!interactive) return;
        setLegendEditor(true);
      });
    };
    void draw();
    return () => {
      disposed = true;
      node.removeAllListeners?.('plotly_click');
      node.removeAllListeners?.('plotly_selected');
      node.removeAllListeners?.('plotly_deselect');
      node.removeAllListeners?.('plotly_relayout');
      node.removeAllListeners?.('plotly_clickannotation');
    };
    // interactive / compact 固定；bundle 变化时重绘
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bundle, selectMode, compact]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (width && width > 0) setWidthPx(width);
      if (compact) return;
      try {
        Plotly.Plots.resize(el);
      } catch {
        /* ignore */
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [compact]);

  useEffect(() => () => {
    if (singleClickTimer.current !== null) window.clearTimeout(singleClickTimer.current);
    const el = containerRef.current;
    if (el) Plotly.purge(el);
  }, []);

  const startLegendDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!interactive) return;
    event.preventDefault();
    const host = containerRef.current;
    if (!host) return;
    setDraggingLegend(true);
    const rect = host.getBoundingClientRect();
    const move = (e: PointerEvent) => {
      const x = Math.min(0.94, Math.max(0.02, (e.clientX - rect.left) / rect.width));
      const y = Math.min(0.94, Math.max(0.02, (e.clientY - rect.top) / rect.height));
      setCustomAnchor({ x, y });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setDraggingLegend(false);
      setCustomAnchor((anchor) => {
        if (anchor) setLegendAnchor(anchor.x, anchor.y);
        return anchor;
      });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    setCustomAnchor({
      x: (event.clientX - rect.left) / rect.width,
      y: (event.clientY - rect.top) / rect.height,
    });
  };

  if (!bundle) {
    return (
      <div style={{ position: 'absolute', inset: 0 }}>
        <div className="plot-canvas" ref={containerRef} data-testid="plot-canvas" />
        {built.error && (
          <div className="plot-overlay-error">
            <div className="box">
              <h3>Scene 合同错误</h3>
              <p className="small" style={{ margin: '8px 0', color: 'var(--err)' }}>
                {built.error}
              </p>
              <p className="small muted">前端不会自行修正标准化、单位、TAS 边界或轴范围；请让后端重算并返回合同 1.2 的 Scene。</p>
            </div>
          </div>
        )}
      </div>
    );
  }

  const anchorX = customAnchor?.x ?? (scene ? resolveLegend(scene).anchor_x : null) ?? 0.72;
  const anchorY = customAnchor?.y ?? (scene ? resolveLegend(scene).anchor_y : null) ?? 0.18;

  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <div className="plot-canvas" ref={containerRef} data-testid="plot-canvas" />
      {interactive && (
        <>
          <div
            className="axis-hotspot x"
            title="双击 X 轴：编辑范围、log/linear、刻度与数字格式"
            onDoubleClick={() => setAxisPanel({ axis: 'x' })}
          />
          <div
            className="axis-hotspot y"
            title="双击 Y 轴：编辑范围、log/linear、刻度与数字格式"
            onDoubleClick={() => setAxisPanel({ axis: 'y' })}
          />
        </>
      )}
      {scene && resolveLegend(scene).position === 'custom' && bundle.legendItems.length > 0 && (
        <div
          ref={legendRef}
          className={`custom-legend ${draggingLegend ? 'dragging' : ''}`}
          style={{ left: `${anchorX * 100}%`, top: `${anchorY * 100}%`, transform: 'translate(-50%, -50%)' }}
          onPointerDown={startLegendDrag}
          onDoubleClick={() => interactive && setLegendEditor(true)}
          title={interactive ? '拖动图例位置；双击编辑图例与注释' : undefined}
        >
          {bundle.legendItems.map((item) => (
            <div className="entry" key={item.layerId}>
              <span className="glyph" style={{ color: item.fill === 'open' ? item.color : item.color }}>
                {markerGlyph(item.shape)}
              </span>
              <span>{item.label}</span>
              {scene && resolveLegend(scene).show_counts && <span className="cnt">n={item.count}</span>}
            </div>
          ))}
        </div>
      )}
      {interactive && stale && (
        <div className="plot-overlay-note">
          当前显示旧版本 Scene（图表 <span className="mono">{scene?.plot_revision ?? '—'}</span>）。修改尚在计算或待计算，禁止用此旧图导出。
        </div>
      )}
      {interactive && computeState === 'error' && (
        <div className="plot-overlay-error">
          <div className="box">
            <h3>Scene 计算失败</h3>
            <p className="small" style={{ margin: '8px 0', color: 'var(--err)' }}>
              {sceneError}
            </p>
            <p className="small muted">请检查变量、单位、参考组成或后端服务；旧图已保留但不可导出。</p>
          </div>
        </div>
      )}
    </div>
  );
}
