/**
 * 消费真实后端 fixture（contracts/fixtures/scene-1.2/）的合同与渲染测试。
 *
 * 这些 fixture 是 Qoder 从真实后端输出落盘的 Scene 1.2（QR03 验证产物），
 * 不是前端手写的 mock。R07–R10 的前端断言全部以它们为输入。
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EXPECTED_SCENE_VERSION, SceneContractError, assertSceneContract } from '../../src/lib/api/http';
import { buildPlotly, resolveLegend } from '../../src/lib/sceneToPlotly';
import type { PlotScene } from '../../src/lib/generated/types';

const fixtureDir = resolve(process.cwd(), '..', 'contracts/fixtures/scene-1.2');
const fixtureNames = existsSync(fixtureDir)
  ? readdirSync(fixtureDir).filter((name) => name.endsWith('.json')).sort()
  : [];

function loadFixture(name: string): PlotScene {
  return JSON.parse(readFileSync(resolve(fixtureDir, name), 'utf8')) as PlotScene;
}

describe('scene-1.2 真实 fixture 消费（TR01/R09）', () => {
  it('fixture 目录含 QR03 交付的 scene-1.2 文件', () => {
    expect(fixtureNames.length).toBeGreaterThan(0);
    expect(fixtureNames).toContain('ree_synthetic.json');
  });

  it('每个真实 fixture 通过前端运行时合同校验', () => {
    for (const name of fixtureNames) {
      const scene = loadFixture(name);
      const validated = assertSceneContract(scene, scene.request_id);
      expect(validated.schema_version, name).toBe(EXPECTED_SCENE_VERSION);
      expect(validated.chart_type, name).toMatch(/^(scatter|ree|spider|tas)$/);
    }
  });

  it('request_id 不回显的真实响应被拒绝（防丢弃旧结果失效）', () => {
    const scene = loadFixture(fixtureNames[0]);
    expect(() => assertSceneContract(scene, 'other_request_id')).toThrow(SceneContractError);
  });
});

describe('R07：同层两 analysis 两条独立曲线（ree_synthetic.json）', () => {
  const scene = loadFixture('ree_synthetic.json');
  const bundle = buildPlotly(scene, { highlightIds: [], showLegend: true });
  const traces = bundle.data as Array<Record<string, any>>;

  it('fixture 为 2 个 analysis 的 REE 场景，默认 14 元素不含 Y/Pm', () => {
    expect(scene.chart_type).toBe('ree');
    expect(scene.counts.selected_analyses).toBe(2);
    const elements = scene.variables.elements ?? [];
    expect(elements).toHaveLength(14);
    expect(elements).not.toContain('Y');
    expect(elements).not.toContain('Pm');
  });

  it('每 analysis 一 series，两个 series 两条独立 trace', () => {
    expect(scene.series).toHaveLength(2);
    expect(traces.filter((t) => t.mode === 'lines+markers')).toHaveLength(2);
    const analysisPerSeries = scene.series.map((s) => new Set(s.points.map((p) => p.analysis_id)));
    for (const ids of analysisPerSeries) expect(ids.size).toBe(1);
  });

  it('没有 A 的 Lu→B 的 La 连线：各 trace 的 x 不跨界串联', () => {
    for (const trace of traces.filter((t) => t.mode === 'lines+markers')) {
      const xs = trace.x as Array<number | null>;
      // 同一 trace 内 x 必须有序（元素顺序 0..13），不允许 A 尾接 B 头的折返。
      const validX = xs.filter((v): v is number => v != null);
      const sorted = [...validX].sort((a, b) => a - b);
      expect(validX).toEqual(sorted);
    }
  });

  it('缺值断线：break_at_missing=true 时 connectgaps=false', () => {
    for (const trace of traces.filter((t) => t.mode === 'lines+markers')) {
      expect(trace.connectgaps).toBe(false);
    }
    for (const series of scene.series) {
      expect(series.break_at_missing).toBe(true);
    }
  });

  it('每元素位置不被压缩：x 为 0..13 的元素索引', () => {
    for (const series of scene.series) {
      const xs = series.points.map((p) => p.x);
      expect(xs).toEqual([...Array(14).keys()]);
    }
  });
});

describe('R08：缺值断线与孤立点（fixture 数值不变形）', () => {
  const scene = loadFixture('ree_synthetic.json');

  it('null 值保留在完整长度数组中，不被过滤压缩', () => {
    // 用 fixture 结构注入缺值，验证渲染器断线语义（真实缺值 fixture 由 QR03 补充）。
    const withGap: PlotScene = JSON.parse(JSON.stringify(scene));
    const points = withGap.series[0].points;
    points[4].y = null; // 缺 Sm
    points[5].y = 12.5; // 两个缺值之间的孤立有效点（示意）
    points[6].y = null;
    const bundle = buildPlotly(withGap, { highlightIds: [], showLegend: false });
    const trace = (bundle.data as Array<Record<string, any>>).find((t) => t.mode === 'lines+markers')!;
    const ys = trace.y as Array<number | null>;
    expect(ys).toHaveLength(14);
    expect(ys[4]).toBeNull();
    expect(ys[6]).toBeNull();
    expect(ys[5]).toBe(12.5); // 孤立点可见
    expect(trace.connectgaps).toBe(false); // 缺口断线
  });
});

describe('R10：log 轴范围换算（点值原样、非正报错）', () => {
  const scene = loadFixture('ree_synthetic.json');

  it('log10 范围 [-1,3] 用 log10 显示，点值不取 log', () => {
    const logScene: PlotScene = JSON.parse(JSON.stringify(scene));
    logScene.axes.y.scale = 'log10';
    logScene.axes.y.range = [0.1, 1000];
    const bundle = buildPlotly(logScene, { highlightIds: [], showLegend: false });
    const layout = bundle.layout as Record<string, any>;
    expect(layout.yaxis.type).toBe('log');
    expect(layout.yaxis.range).toEqual([-1, 3]);
    const trace = (bundle.data as Array<Record<string, any>>).find((t) => t.mode === 'lines+markers')!;
    const rawY = scene.series[0].points.map((p) => p.y);
    expect(trace.y).toEqual(rawY);
  });

  it('非正 log 边界是合同错误，不夹取到 Number.MIN_VALUE', () => {
    const badScene: PlotScene = JSON.parse(JSON.stringify(scene));
    badScene.axes.y.scale = 'log10';
    badScene.axes.y.range = [0, 1000];
    expect(() => buildPlotly(badScene, { highlightIds: [], showLegend: false })).toThrow(/正数边界/);
  });

  it('手动范围与反转保留', () => {
    const revScene: PlotScene = JSON.parse(JSON.stringify(scene));
    revScene.axes.x.reversed = true;
    revScene.axes.x.range = [13, 0];
    const bundle = buildPlotly(revScene, { highlightIds: [], showLegend: false });
    const layout = bundle.layout as Record<string, any>;
    expect(layout.xaxis.range).toEqual([0, 13]);
  });
});

describe('R11/R12：真实 TAS fixture 几何一致性（tas_synthetic.json）', () => {
  const tasScene = loadFixture('tas_synthetic.json');

  it('fixture 带冻结 diagram_geometry（17 独立多边形 + 49 去重线段）', () => {
    expect(tasScene.chart_type).toBe('tas');
    const geom = tasScene.diagram_geometry as Record<string, any>;
    expect(geom).toBeTruthy();
    expect(geom.model_id).toBe('tas_LeMaitre');
    expect(geom.model_version).toContain('pyrolite');
    expect(String(geom.source_hash)).toMatch(/^sha256:/);
    expect(geom.polygons).toHaveLength(17);
    expect(geom.segments).toHaveLength(49);
    // 每个多边形独立闭合（>=3 顶点），field_id 保留
    for (const poly of geom.polygons) {
      expect(poly.vertices.length).toBeGreaterThanOrEqual(3);
      expect(typeof poly.field_id).toBe('string');
    }
    // 禁止顶点链：legacy 字段为空或不存在
    expect(geom.boundary_coordinates ?? []).toEqual([]);
  });

  it('前端渲染：每 polygon 独立闭合 trace + 标签，不把顶点串成一条线', () => {
    const bundle = buildPlotly(tasScene, { highlightIds: [], showLegend: true });
    const traces = bundle.data as Array<Record<string, any>>;
    const polyTraces = traces.filter((t) => t.mode === 'lines' && t.name && t.name !== '高亮');
    expect(polyTraces.length).toBeGreaterThanOrEqual(17);
    for (const trace of polyTraces) {
      const xs = trace.x as Array<number | null>;
      // 闭合：首尾相同；且各 trace 顶点数远小于全部顶点串联总数
      expect(xs[0]).toBe(trace.x[trace.x.length - 1]);
      expect(xs.length).toBeLessThan(100);
    }
    const layout = bundle.layout as Record<string, any>;
    // 分区标签以 data 坐标注释呈现
    expect((layout.annotations ?? []).length).toBeGreaterThanOrEqual(17);
  });

  it('图注含模型来源与月球参考用途（R11）', () => {
    const annotations = (tasScene.layout as Record<string, any>).annotations ?? [];
    const caption = annotations.find((a: Record<string, unknown>) => String(a.text).includes('Le Maitre'));
    expect(caption).toBeTruthy();
    expect(String(caption.text)).toContain('pyrolite');
    expect(String(caption.text).toLowerCase()).toContain('lunar');
  });

  it('分类语义冻结在 Scene：axes 带模型窗口、点 provenance 可回查', () => {
    expect(tasScene.axes.x.range).toEqual([35, 88]);
    expect(tasScene.axes.y.range).toEqual([0, 18]);
    const p = tasScene.series[0].points[0];
    expect(p.provenance.sio2_raw).toBeTypeOf('number');
  });
});

describe('R09 细节：Scene 字段完整消费', () => {
  const scene = loadFixture('ree_synthetic.json');

  it('图例真值解析（顶层 legend 空时取 layout.legend）', () => {
    const legend = resolveLegend(scene);
    expect(legend.position).toBe(scene.layout.legend.position ?? 'right');
    expect(typeof legend.show_counts).toBe('boolean');
  });

  it('样式来自 Scene series.style（marker/line 独立 alpha）', () => {
    const bundle = buildPlotly(scene, { highlightIds: [], showLegend: false });
    const trace = (bundle.data as Array<Record<string, any>>).find((t) => t.mode === 'lines+markers')!;
    const style = scene.series[0].style;
    expect(trace.marker.color).toBe(`rgba(${parseInt(style.marker_fill_color.slice(1, 3), 16)},${parseInt(style.marker_fill_color.slice(3, 5), 16)},${parseInt(style.marker_fill_color.slice(5, 7), 16)},${style.marker_alpha})`);
  });

  it('counts/exclusions/provenance 保留可回查', () => {
    expect(scene.counts.plotted_points).toBe(28);
    const provenance = scene.series[0].points[0].provenance;
    expect(provenance.element).toBe('La');
    expect(provenance.raw_value).toBe(10);
    expect(provenance.raw_unit).toBe('ppm');
  });
});
