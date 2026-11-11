/**
 * 散点图不得连线。
 *
 * 回归场景：把图型从 REE/蜘蛛图切回散点时，图层 style.connect 残留为 true，
 * 前端曾按 style.connect 连线，把不同样品连成折线（科学上无意义）。
 * 契约：连线只对曲线图（REE/蜘蛛）有效。
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { PlotScene } from '../../src/lib/generated/types';
import { buildPlotly } from '../../src/lib/sceneToPlotly';

const fixtureDir = resolve(process.cwd(), '..', 'contracts/fixtures/scene-1.2');

function loadScene(name: string): PlotScene {
  return JSON.parse(readFileSync(resolve(fixtureDir, name), 'utf8')) as PlotScene;
}

function withConnect(scene: PlotScene, connect: boolean): PlotScene {
  return {
    ...scene,
    series: scene.series.map((s) => ({ ...s, style: { ...s.style, connect } })),
  };
}

describe('散点图不连线', () => {
  it('connect=true 的 scatter 只画点（mode=markers）', () => {
    const scene = withConnect(loadScene('scatter_synthetic.json'), true);
    const traces = buildPlotly(scene, { highlightIds: [], showLegend: true })
      .data as Array<Record<string, any>>;
    expect(traces.length).toBeGreaterThan(0);
    for (const trace of traces) {
      expect(trace.mode).toBe('markers');
    }
  });

  it('connect=false 的 scatter 同样只画点', () => {
    const scene = withConnect(loadScene('scatter_synthetic.json'), false);
    const traces = buildPlotly(scene, { highlightIds: [], showLegend: true })
      .data as Array<Record<string, any>>;
    for (const trace of traces) {
      expect(trace.mode).toBe('markers');
    }
  });

  it('REE 曲线图仍然连线（lines+markers）', () => {
    const scene = loadScene('ree_synthetic.json');
    const traces = buildPlotly(scene, { highlightIds: [], showLegend: true })
      .data as Array<Record<string, any>>;
    expect(traces.some((trace) => trace.mode === 'lines+markers')).toBe(true);
  });
});
