import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { PlotScene, PlotSpec } from '../../src/lib/generated/types';
import { buildScene } from '../../src/lib/mock/scene';
import { ANALYSES, REFERENCES } from '../../src/lib/mock/fixtures';
import { SYMBOL_MAP, buildPlotly, hexToRgba } from '../../src/lib/sceneToPlotly';

function loadFixture(name: string): PlotSpec {
  return JSON.parse(
    readFileSync(resolve(process.cwd(), '..', 'contracts/fixtures', name), 'utf8'),
  ) as PlotSpec;
}

const baseSpec = loadFixture('scatter_valid.json');

function makeScene(spec: PlotSpec, analysisIds?: string[]): PlotScene {
  return buildScene({
    spec,
    requestId: 'test_plotly',
    analyses: ANALYSES,
    selections: [
      {
        selection_id: spec.layers[0].selection_id,
        selection_hash: 'hash_test',
        analysis_ids: analysisIds ?? ANALYSES.slice(0, 12).map((a) => a.analysis_id),
        dataset_versions: [{ dataset_id: 'ds_demo', version: '1' }],
      },
    ],
    references: REFERENCES,
    softwareVersion: 'test',
  });
}

describe('Plotly 适配', () => {
  const scene = makeScene(baseSpec);
  const bundle = buildPlotly(scene, { highlightIds: [], showLegend: true });
  const traces = bundle.data as Array<Record<string, any>>;

  it('alpha 只应用一次：颜色为 rgba(hex, alpha)', () => {
    expect(traces.length).toBeGreaterThan(0);
    const first = traces[0];
    expect(first.marker.color).toBe(
      hexToRgba(baseSpec.layers[0].style.marker_fill_color, baseSpec.layers[0].style.marker_alpha),
    );
    expect(first.marker.line.color).toBe(
      hexToRgba(baseSpec.layers[0].style.marker_edge_color, baseSpec.layers[0].style.marker_alpha),
    );
    expect(first.marker.color).not.toContain('rgba(rgba');
  });

  it('9 种形状映射到 9 个不同的 Plotly 符号', () => {
    expect(Object.keys(SYMBOL_MAP)).toHaveLength(9);
    expect(new Set(Object.values(SYMBOL_MAP)).size).toBe(9);
  });

  it('log 轴只改显示类型，点坐标保持原始值', () => {
    const logScene: PlotScene = {
      ...scene,
      axes: { ...scene.axes, y: { ...scene.axes.y, scale: 'log10', range: [0.1, 100] } },
    };
    const logBundle = buildPlotly(logScene, { highlightIds: [], showLegend: false });
    const layout = logBundle.layout as Record<string, any>;
    expect(layout.yaxis.type).toBe('log');
    expect(layout.yaxis.range).toEqual([Math.log10(0.1), Math.log10(100)]);
    const points = logScene.series.flatMap((s) => s.points);
    const yValues = (logBundle.data as Array<Record<string, any>>)[0].y as Array<number | null>;
    const rawY = points.filter((p) => p.y != null).map((p) => p.y);
    expect(yValues.filter((v) => v != null)).toEqual(expect.arrayContaining(rawY.slice(0, 3)));
  });

  it('非正 log 边界报合同错误，不用 Number.MIN_VALUE 掩盖', () => {
    const badScene: PlotScene = {
      ...scene,
      axes: { ...scene.axes, y: { ...scene.axes.y, scale: 'log10', range: [0, 1000] } },
    };
    expect(() => buildPlotly(badScene, { highlightIds: [], showLegend: false })).toThrow(/正数边界/);
  });

  it('分类轴使用 scene 的 category_order 作为刻度标签', () => {
    const categoryScene: PlotScene = {
      ...scene,
      axes: { ...scene.axes, x: { ...scene.axes.x, scale: 'category', category_order: ['La', 'Ce', 'Lu'] } },
    };
    const catBundle = buildPlotly(categoryScene, { highlightIds: [], showLegend: false });
    const layout = catBundle.layout as Record<string, any>;
    expect(layout.xaxis.tickvals).toEqual([0, 1, 2]);
    expect(layout.xaxis.ticktext).toEqual(['La', 'Ce', 'Lu']);
  });

  it('分类轴 category_order 为空时回退 variables.elements 作为刻度标签', () => {
    const emptyOrderScene: PlotScene = {
      ...scene,
      variables: { ...scene.variables, elements: ['La', 'Ce', 'Lu'] },
      axes: { ...scene.axes, x: { ...scene.axes.x, scale: 'category', category_order: [] } },
    };
    const bundleWithOrder = buildPlotly(emptyOrderScene, { highlightIds: [], showLegend: false });
    const layout = bundleWithOrder.layout as Record<string, any>;
    expect(layout.xaxis.ticktext).toEqual(['La', 'Ce', 'Lu']);
  });

  it('默认英文轴标题在界面显示为中文（导出仍用英文）', () => {
    const zhScene: PlotScene = {
      ...scene,
      axes: {
        x: { ...scene.axes.x, label: 'Element' },
        y: { ...scene.axes.y, label: 'Sample / Chondrite' },
      },
    };
    const zhBundle = buildPlotly(zhScene, { highlightIds: [], showLegend: false });
    const layout = zhBundle.layout as Record<string, any>;
    expect(layout.xaxis.title.text).toBe('元素');
    expect(layout.yaxis.title.text).toBe('样品 / 球粒陨石');
  });

  it('图例项数覆盖可见图层', () => {
    expect(bundle.legendItems.length).toBeGreaterThan(0);
    expect(bundle.legendItems[0].layerId).toBe(baseSpec.layers[0].layer_id);
  });

  it('一 analysis 一曲线，缺值 connectgaps=false', () => {
    const reeSpec = loadFixture('ree_valid.json');
    const twoAnalyses = ANALYSES.slice(0, 2).map((a) => a.analysis_id);
    const reeScene = makeScene(reeSpec, twoAnalyses);
    expect(reeScene.chart_type).toBe('ree');
    const curveBundle = buildPlotly(reeScene, { highlightIds: [], showLegend: true });
    const curveTraces = curveBundle.data as Array<Record<string, any>>;
    expect(curveTraces).toHaveLength(reeScene.series.length);
    for (const trace of curveTraces) {
      expect(trace.connectgaps).toBe(false);
      expect(trace.mode).toBe('lines+markers');
    }
    const seriesAnalysisIds = reeScene.series.map((series) => series.points[0]?.analysis_id);
    expect(new Set(seriesAnalysisIds).size).toBe(reeScene.series.length);
  });

  it('TAS 几何按 polygon 独立矢量绘制并带标签，不串连顶点', () => {
    const tasScene: PlotScene = {
      ...scene,
      chart_type: 'tas',
      diagram_geometry: {
        model_id: 'LeMaitre',
        model_version: '1',
        source_hash: 'hash_tas',
        polygons: [
          { field_id: 'O3', label: 'O3', vertices: [[50, 0], [70, 5], [60, 12]] },
          { field_id: 'Bs', label: 'Bs', vertices: [[40, 0], [45, 3], [40, 8]] },
          { field_id: 'EMPTY', label: '', vertices: [] },
        ],
        labels: [{ field_id: 'O3', x: 58, y: 5, text: 'O3' }],
        segments: [],
      } as unknown as PlotScene['diagram_geometry'],
    };
    const tasBundle = buildPlotly(tasScene, { highlightIds: [], showLegend: false });
    const tasTraces = tasBundle.data as Array<Record<string, any>>;
    const polygonTraces = tasTraces.filter((trace) => trace.name === 'O3' || trace.name === 'Bs');
    expect(polygonTraces).toHaveLength(2);
    for (const trace of polygonTraces) {
      expect(trace.mode).toBe('lines');
      expect(trace.x.length).toBe(trace.y.length);
      expect(trace.x[0]).toBe(trace.x[trace.x.length - 1]);
    }
    expect(tasTraces.some((trace) => trace.name === 'EMPTY')).toBe(false);
    const layout = tasBundle.layout as Record<string, any>;
    expect(layout.annotations.some((annotation: Record<string, unknown>) => annotation.text === 'O3')).toBe(true);
  });

  it('悬停文本包含 analysis_id、原始值/参考/来源，不伪造分母', () => {
    const firstTrace = traces[0];
    expect(firstTrace.hoverinfo).toBe('text');
    const text = firstTrace.text as string[];
    expect(text[0]).toContain('analysis_id');
    expect(text[0]).toContain('来源');
    expect(text[0]).toContain('X：');
    expect(text.every((line) => typeof line === 'string')).toBe(true);
  });

  it('物理画布缩放随容器宽度变化，导出 pt 值不变', () => {
    const narrow = buildPlotly(scene, { highlightIds: [], showLegend: false, widthPx: 380 });
    const wide = buildPlotly(scene, { highlightIds: [], showLegend: false, widthPx: 760 });
    const narrowMarker = (narrow.data as Array<Record<string, any>>)[0].marker.size;
    const wideMarker = (wide.data as Array<Record<string, any>>)[0].marker.size;
    expect(wideMarker).toBeCloseTo(narrowMarker * 2, 1);
  });
});
