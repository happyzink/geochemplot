/**
 * Scene → Plotly 渲染适配（18 §5 TR02）。
 *
 * 只做渲染映射：所有轴、样式、图例、注释、chart_type 都来自冻结 Scene；
 * 不再读取编辑中的 PlotSpec，也不做任何单位换算/标准化/TAS 分类。
 * log 轴只把 Scene 的数值范围换算成 log10 range，点坐标保持原值；
 * 非正 log 边界是合同错误，绝不用 Number.MIN_VALUE 掩盖。
 */

import { SceneContractError } from './api/http';
import type { DiagramGeometry, LayerStyle, LegendConfig, PlotScene, TASLabel, TASPolygon } from './generated/types';

/**
 * 图例解析：schema 1.2 顶层 legend 为自由对象，真实 Scene 的图例真值在
 * layout.legend + layout.legend_show_counts（scene-1.2 fixture 实测）。
 * 只做取值合并，不重算样式。
 */
export function resolveLegend(scene: PlotScene): LegendConfig & { show_counts: boolean } {
  const fallback = scene.layout.legend;
  return {
    position: scene.legend.position ?? fallback.position ?? 'right',
    anchor_x: scene.legend.anchor_x ?? fallback.anchor_x ?? null,
    anchor_y: scene.legend.anchor_y ?? fallback.anchor_y ?? null,
    show_counts: scene.layout.legend_show_counts ?? false,
  };
}

/** 界面显示用中文轴标题：Scene 内保持英文（matplotlib 导出无 CJK 字形）。 */
const DISPLAY_AXIS_LABEL: Record<string, string> = {
  Element: '元素',
  'Sample / Chondrite': '样品 / 球粒陨石',
  'Sample / Primitive Mantle': '样品 / 原始地幔',
  'Concentration (ppm)': '浓度 (ppm)',
};

function displayAxisLabel(label: string): string {
  return DISPLAY_AXIS_LABEL[label] ?? label;
}

const SYMBOL_MAP: Record<LayerStyle['marker_shape'], string> = {
  circle: 'circle',
  square: 'square',
  triangle_up: 'triangle-up',
  triangle_down: 'triangle-down',
  diamond: 'diamond',
  plus: 'cross-thin',
  cross: 'x-thin',
  star: 'star',
  hexagon: 'hexagon',
};

const DASH_MAP: Record<LayerStyle['line_dash'], string> = {
  solid: 'solid',
  dash: 'dash',
  dot: 'dot',
  dashdot: 'dashdot',
};

/** mm → CSS px（96 dpi）。 */
const MM_TO_PX = 96 / 25.4;
/** pt → CSS px（96 dpi）。 */
const PT_TO_PX = 96 / 72;

function hexToRgba(hex: string, alpha: number): string {
  const value = hex.replace('#', '');
  if (value.length !== 6) return `rgba(0,0,0,${alpha})`;
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${Math.max(0, Math.min(1, alpha))})`;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function formatNumber(value: number): string {
  if (Number.isInteger(value)) return String(value);
  if (Math.abs(value) >= 1e4 || Math.abs(value) < 1e-3) return value.toExponential(3);
  return String(Number(value.toPrecision(4)));
}

function formatValue(value: unknown, unit: unknown): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '未提供';
  const suffix = typeof unit === 'string' && unit ? ` ${unit}` : '';
  return `${formatNumber(value)}${suffix}`;
}

function formatProvenanceText(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : '未提供';
}

/** 物理画布缩放：容器宽度相对 Scene 的 mm 宽度，pt→px 按比例换算。 */
function pxPerPt(scene: PlotScene, widthPx?: number): number {
  const naturalPx = (scene.layout.width_mm ?? 183) * MM_TO_PX;
  const measured = typeof widthPx === 'number' && widthPx > 0 ? widthPx : naturalPx;
  return PT_TO_PX * (measured / naturalPx);
}

function tickFormat(sceneAxis: PlotScene['axes']['x']): string | undefined {
  const digits = sceneAxis.decimal_places;
  switch (sceneAxis.number_format) {
    case 'fixed':
      return digits == null ? '.2f' : `.${digits}f`;
    case 'scientific':
      return digits == null ? '.2e' : `.${digits}e`;
    default:
      return undefined;
  }
}

function formatTickNumber(value: number, sceneAxis: PlotScene['axes']['x']): string {
  if (sceneAxis.number_format === 'fixed') {
    return value.toFixed(sceneAxis.decimal_places ?? 2);
  }
  if (sceneAxis.number_format === 'scientific') {
    return value.toExponential(sceneAxis.decimal_places ?? 2);
  }
  if (sceneAxis.scale === 'log10') {
    const exp = Math.log10(value);
    if (Math.abs(exp - Math.round(exp)) < 1e-9) {
      const exponent = Math.round(exp);
      if (exponent >= -3 && exponent <= 4) return String(Number(value.toPrecision(2)));
      return `10${superscript(exponent)}`;
    }
    return String(Number(value.toPrecision(3)));
  }
  return String(Number(value.toPrecision(4)));
}

function superscript(exponent: number): string {
  const map: Record<string, string> = { '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹', '-': '⁻' };
  return String(exponent).split('').map((c) => map[c] ?? c).join('');
}

/**
 * 非正 log 边界直接报合同错误。
 * 返回 log10 空间范围；点值不在这里取 log。
 */
function logRange(sceneAxis: PlotScene['axes']['x'], axisName: string): [number, number] | null {
  if (!sceneAxis.range) return null;
  const [lo, hi] = sceneAxis.range;
  if (!(lo > 0) || !(hi > 0)) {
    throw new SceneContractError(
      `${axisName} 轴 log10 范围为 [${formatNumber(lo)}, ${formatNumber(hi)}]，后端必须给出正数边界；禁止用 Number.MIN_VALUE 掩盖。`,
    );
  }
  return [Math.log10(lo), Math.log10(hi)];
}

function axisLayout(scene: PlotScene, axisKey: 'x' | 'y', pxPt: number) {
  const sceneAxis = scene.axes[axisKey];
  const isLog = sceneAxis.scale === 'log10';
  const axis: Record<string, unknown> = {
    title: { text: displayAxisLabel(sceneAxis.label), font: { size: (sceneAxis.title_font_size_pt ?? 7) * pxPt } },
    tickfont: { size: (sceneAxis.tick_font_size_pt ?? 6) * pxPt },
    showgrid: sceneAxis.major_grid ?? false,
    gridcolor: '#E5E5E5',
    ticks: sceneAxis.tick_direction === 'in' ? 'inside' : 'outside',
    ticklen: 3,
    tickwidth: 0.7,
    zeroline: false,
    automargin: true,
    linecolor: '#333333',
    mirror: false,
    minor: { ticks: sceneAxis.minor_ticks ? 'outside' : '', showgrid: false },
    tickformat: tickFormat(sceneAxis),
  };

  if (isLog) {
    axis.type = 'log';
    const range = logRange(sceneAxis, axisKey.toUpperCase());
    if (range) {
      axis.range = sceneAxis.reversed ? [range[1], range[0]] : range;
    } else {
      axis.autorange = sceneAxis.reversed ? 'reversed' : true;
    }
  } else if (sceneAxis.scale === 'category') {
    // 分类轴数据是 0..n-1 的位置索引，用数值轴 + array 刻度直接贴元素符号；
    // category_order 可能被写成空数组（表示“不排序”），此时回退到 elements
    const ordered = sceneAxis.category_order;
    const categories = ordered && ordered.length ? ordered : (scene.variables.elements ?? []);
    if (categories.length) {
      axis.tickmode = 'array';
      axis.tickvals = categories.map((_tick, index) => index);
      axis.ticktext = categories;
      const [lo, hi] = sceneAxis.range ?? [-0.5, categories.length - 0.5];
      axis.range = sceneAxis.reversed ? [hi, lo] : [lo, hi];
    }
  } else {
    if (sceneAxis.range) {
      axis.range = sceneAxis.reversed ? [sceneAxis.range[1], sceneAxis.range[0]] : sceneAxis.range;
    } else {
      axis.autorange = sceneAxis.reversed ? 'reversed' : true;
    }
  }

  if (!isLog && sceneAxis.scale !== 'category' && sceneAxis.ticks.length) {
    axis.tickvals = sceneAxis.ticks;
    axis.ticktext = sceneAxis.ticks.map((tick) =>
      typeof tick === 'number' ? formatTickNumber(tick, sceneAxis) : tick,
    );
  }
  return axis;
}

export interface LegendItem {
  label: string;
  color: string;
  shape: LayerStyle['marker_shape'];
  fill: LayerStyle['marker_fill'];
  alpha: number;
  count: number;
  layerId: string;
}

export interface PlotlyBundle {
  data: unknown[];
  layout: Record<string, unknown>;
  legendItems: LegendItem[];
  highlightTraceIndex: number | null;
}

export interface BuildOptions {
  highlightIds: string[];
  showLegend: boolean;
  /** 实际显示画布宽度（CSS px），用于按物理尺寸计算 pt→px 缩放。 */
  widthPx?: number;
}

function isCurveType(scene: PlotScene): boolean {
  if (scene.chart_type === 'ree' || scene.chart_type === 'spider') return true;
  if (scene.chart_type === 'scatter' || scene.chart_type === 'tas') return false;
  throw new SceneContractError(
    `Scene chart_type=${String(scene.chart_type ?? '缺失')} 缺失或不支持；不默认按 scatter 渲染。`,
  );
}

function hoverText(scene: PlotScene, seriesLabel: string, point: PlotScene['series'][number]['points'][number]): string {
  const provenance = (point.provenance ?? {}) as Record<string, unknown>;
  const parts: string[] = [`<b>${escapeHtml(seriesLabel)}</b>`];
  parts.push(`analysis_id：${escapeHtml(point.analysis_id)}`);
  if (typeof provenance.element === 'string') parts.push(`元素：${provenance.element}`);
  parts.push(
    `X：${formatValue(point.x, scene.axes.x.unit)}`,
    `Y：${formatValue(point.y, scene.axes.y.unit)}`,
  );

  if ('raw_value' in provenance || provenance.value_mode === 'normalized') {
    parts.push(`原始值：${formatValue(provenance.raw_value, provenance.raw_unit)}`);
  }
  if (provenance.value_mode === 'normalized') {
    const refId = formatProvenanceText(provenance.reference_id);
    const refVersion = formatProvenanceText(provenance.reference_version);
    parts.push(`参考：${refId}@${refVersion}`);
    parts.push(`参考值：${formatValue(provenance.reference_value, provenance.reference_unit)}`);
    parts.push(`标准化值：${formatValue(provenance.normalized_value, null)}（样品/参考）`);
  }

  const sheet = formatProvenanceText(provenance.source_sheet);
  const row = formatProvenanceText(provenance.source_row);
  parts.push(`来源：${sheet}!${row}`);
  const name = typeof provenance.raw_name === 'string' ? provenance.raw_name : null;
  if (name) parts.push(`样品：${escapeHtml(name)}`);
  return parts.join('<br>');
}

function geometryTraces(
  scene: PlotScene,
  pxPt: number,
): { traces: unknown[]; annotations: Array<Record<string, unknown>> } {
  const geometry = scene.diagram_geometry;
  if (!geometry) return { traces: [], annotations: [] };

  const traces: unknown[] = [];
  const polygons = geometry.polygons;
  for (const polygon of polygons) {
    const vertices = polygon.vertices.filter(
      (vertex): vertex is [number, number] =>
        Array.isArray(vertex) && vertex.length === 2 && Number.isFinite(vertex[0]) && Number.isFinite(vertex[1]),
    );
    // 空占位 polygon 不绘图（QR04）。
    if (vertices.length < 3) continue;
    const closed = [...vertices, vertices[0]];
    traces.push({
      type: 'scatter',
      mode: 'lines',
      x: closed.map((vertex) => vertex[0]),
      y: closed.map((vertex) => vertex[1]),
      line: { color: 'rgba(90,90,90,0.85)', width: 0.8 * pxPt },
      hoverinfo: 'skip',
      showlegend: false,
      name: polygon.field_id,
    });
  }

  const segments = geometry.segments;
  if (!polygons.some((polygon) => polygon.vertices.length >= 3) && segments.length) {
    const x: Array<number | null> = [];
    const y: Array<number | null> = [];
    for (const segment of segments) {
      if (x.length) {
        x.push(null);
        y.push(null);
      }
      x.push(segment[0][0], segment[1][0]);
      y.push(segment[0][1], segment[1][1]);
    }
    if (x.length) {
      traces.push({
        type: 'scatter',
        mode: 'lines',
        x,
        y,
        line: { color: 'rgba(90,90,90,0.85)', width: 0.8 * pxPt },
        hoverinfo: 'skip',
        showlegend: false,
        connectgaps: false,
        name: `${geometry.model_id}@${geometry.model_version}`,
      });
    }
  }

  const annotations = geometry.labels
    .filter((label) => Number.isFinite(label.x) && Number.isFinite(label.y))
    .map((label) => ({
      text: label.text,
      x: label.x,
      y: label.y,
      xref: 'x',
      yref: 'y',
      showarrow: false,
      font: { size: 5.5 * pxPt, color: '#555555' },
      bgcolor: 'rgba(255,255,255,0)',
    }));

  return { traces, annotations };
}

/**
 * @param scene 冻结 Scene（唯一渲染输入）
 * @param options 高亮与画布宽度；不再接收 PlotSpec
 */
export function buildPlotly(scene: PlotScene, options: BuildOptions): PlotlyBundle {
  const pxPt = pxPerPt(scene, options.widthPx);
  const isCurve = isCurveType(scene);
  const data: unknown[] = [];
  const legendMap = new Map<string, LegendItem>();
  const legendShownLayers = new Set<string>();
  const legend = resolveLegend(scene);
  const useNativeLegend = options.showLegend && legend.position !== 'custom';

  const geometry = isCurve
    ? { traces: [] as unknown[], annotations: [] as Array<Record<string, unknown>> }
    : geometryTraces(scene, pxPt);
  data.push(...geometry.traces);

  for (const series of scene.series) {
    const style = series.style;
    const alpha = style.marker_alpha;
    const hollow = style.marker_fill === 'open' && !['plus', 'cross'].includes(style.marker_shape);
    const markerColor = hollow ? 'rgba(0,0,0,0)' : hexToRgba(style.marker_fill_color, alpha);
    const edgeColor = hexToRgba(style.marker_edge_color, alpha);
    const lineColor = hexToRgba(style.line_color, style.line_alpha);
    const x = series.points.map((point) => point.x);
    const y = series.points.map((point) => point.y);
    const customdata = series.points.map((point) => [
      point.analysis_id,
      String(point.provenance?.raw_name ?? ''),
      point.point_id,
      series.layer_id,
      series.series_id,
    ]);
    // 点级覆盖样式已由后端解析进 Scene（resolved_style）；未覆盖的点沿用 series 样式。
    const pointStyle = (point: PlotScene['series'][number]['points'][number]): LayerStyle =>
      point.resolved_style ?? style;
    const hasOverrides = series.points.some((point) => point.resolved_style != null);
    const marker = {
      symbol: hasOverrides
        ? series.points.map((point) => SYMBOL_MAP[pointStyle(point).marker_shape] ?? 'circle')
        : SYMBOL_MAP[style.marker_shape] ?? 'circle',
      size: hasOverrides
        ? series.points.map((point) => Math.max(1, pointStyle(point).marker_size_pt) * pxPt)
        : Math.max(1, style.marker_size_pt) * pxPt,
      color: hasOverrides
        ? series.points.map((point) => {
            const s = pointStyle(point);
            return s.marker_fill === 'open' && !['plus', 'cross'].includes(s.marker_shape)
              ? 'rgba(0,0,0,0)'
              : hexToRgba(s.marker_fill_color, s.marker_alpha);
          })
        : markerColor,
      line: {
        color: hasOverrides
          ? series.points.map((point) => hexToRgba(pointStyle(point).marker_edge_color, pointStyle(point).marker_alpha))
          : edgeColor,
        width: hasOverrides
          ? series.points.map((point) => Math.max(0, pointStyle(point).marker_edge_width_pt) * pxPt)
          : Math.max(0, style.marker_edge_width_pt) * pxPt,
      },
    };
    // 连线只对曲线图（REE/蜘蛛）有意义；散点/TAS 下 style.connect 残留会把不同样品连成折线
    const showLines = isCurve;
    const trace: Record<string, unknown> = {
      type: 'scatter',
      mode: showLines ? 'lines+markers' : 'markers',
      name: series.label,
      x,
      y,
      customdata,
      text: series.points.map((point) => hoverText(scene, series.label, point)),
      marker,
      line: {
        color: lineColor,
        width: Math.max(0, style.line_width_pt) * pxPt,
        dash: DASH_MAP[style.line_dash] ?? 'solid',
      },
      hoverinfo: 'text',
      // 原生图例（right/inside）：每层只出一条图例项；custom 位由自绘图例接管
      showlegend: useNativeLegend && !legendShownLayers.has(series.layer_id),
      legendgroup: series.layer_id,
    };
    if (useNativeLegend) legendShownLayers.add(series.layer_id);
    if (showLines) {
      // 断线语义来自 Scene.break_at_missing：缺值不连接；跨样品靠一 analysis 一 series 保证。
      trace.connectgaps = !(series.break_at_missing ?? true);
    }
    data.push(trace);

    const existing = legendMap.get(series.layer_id);
    if (existing) {
      existing.count += series.points.length;
    } else {
      legendMap.set(series.layer_id, {
        label: series.label,
        color: style.marker_fill_color,
        shape: style.marker_shape,
        fill: style.marker_fill,
        alpha,
        count: series.points.length,
        layerId: series.layer_id,
      });
    }
  }

  let highlightTraceIndex: number | null = null;
  if (options.highlightIds.length) {
    const highlighted: Array<{ x: number | null; y: number | null; analysis_id: string }> = [];
    for (const series of scene.series) {
      for (const point of series.points) {
        if (options.highlightIds.includes(point.analysis_id)) {
          highlighted.push({ x: point.x, y: point.y, analysis_id: point.analysis_id });
        }
      }
    }
    if (highlighted.length) {
      highlightTraceIndex = data.length;
      data.push({
        type: 'scatter',
        mode: 'markers',
        x: highlighted.map((point) => point.x),
        y: highlighted.map((point) => point.y),
        marker: { symbol: 'circle-open', size: 11, color: 'rgba(0,0,0,0)', line: { color: 'rgba(20,20,20,0.9)', width: 1.6 } },
        hoverinfo: 'skip',
        showlegend: false,
        name: '高亮',
      });
    }
  }

  const annotations: Array<Record<string, unknown>> = scene.layout.annotations.map((annotation) => ({
    text: annotation.text,
    x: annotation.anchor_x,
    y: annotation.anchor_y,
    xref: 'paper',
    yref: 'paper',
    xanchor: 'left',
    yanchor: 'top',
    showarrow: false,
    font: { family: scene.layout.font_family, size: annotation.font_size_pt * pxPt, color: annotation.color },
    bgcolor: 'rgba(255,255,255,0)',
  }));
  annotations.push(...geometry.annotations);

  const layout: Record<string, unknown> = {
    autosize: true,
    margin: { l: 64, r: useNativeLegend && legend.position === 'right' ? 132 : 24, t: 22, b: 54 },
    paper_bgcolor: '#FFFFFF',
    plot_bgcolor: '#FFFFFF',
    font: { family: scene.layout.font_family, size: scene.layout.font_size_pt * pxPt, color: '#222222' },
    xaxis: axisLayout(scene, 'x', pxPt),
    yaxis: axisLayout(scene, 'y', pxPt),
    legend: {
      show: useNativeLegend,
      x: legend.position === 'inside' ? 0.98 : 1.02,
      y: legend.position === 'inside' ? 0.98 : 1,
      xanchor: 'left',
      yanchor: 'top',
      font: { size: (scene.layout.tick_font_size_pt ?? 6) * pxPt },
      bgcolor: 'rgba(255,255,255,0)',
      borderwidth: 0,
      itemsizing: 'constant',
      tracegroupgap: 4,
    },
    annotations,
    hovermode: 'closest',
    dragmode: 'zoom',
    showlegend: useNativeLegend,
  };

  return { data, layout, legendItems: [...legendMap.values()], highlightTraceIndex };
}

export { SYMBOL_MAP, hexToRgba };
