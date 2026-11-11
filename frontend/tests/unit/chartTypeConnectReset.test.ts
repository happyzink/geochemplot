/**
 * 切换图型时必须复位图层的 connect 标记。
 *
 * 回归场景：REE/蜘蛛图会把所有图层 connect 置为 true，切回散点时若不复位，
 * 散点图会把不同样品连成折线。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useWorkspace } from '../../src/state/workspaceStore';
import { DEFAULT_STYLE } from '../../src/lib/expressions';
import type { PlotSpec } from '../../src/lib/generated/types';

function specWithLayer(connect: boolean): PlotSpec {
  const base = useWorkspace.getState().spec;
  return {
    ...base,
    chart_type: 'scatter',
    layers: [
      {
        layer_id: 'L1',
        label: '测试层',
        selection_id: 'sel_test',
        visible: true,
        aggregation: 'none',
        style: { ...DEFAULT_STYLE, connect },
        analysis_style_overrides: {},
      },
    ],
  };
}

describe('切换图型复位 connect', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('REE 图型把所有图层 connect 置为 true', () => {
    vi.useFakeTimers();
    useWorkspace.setState({ spec: specWithLayer(false), chartType: 'scatter' });
    useWorkspace.getState().setChartType('ree');
    const layers = useWorkspace.getState().spec.layers;
    expect(layers.length).toBeGreaterThan(0);
    expect(layers.every((layer) => layer.style.connect)).toBe(true);
  });

  it('从 REE 切回散点后 connect 复位为 false', () => {
    vi.useFakeTimers();
    useWorkspace.setState({ spec: specWithLayer(false), chartType: 'scatter' });
    useWorkspace.getState().setChartType('ree');
    useWorkspace.getState().setChartType('scatter');
    const layers = useWorkspace.getState().spec.layers;
    expect(layers.length).toBeGreaterThan(0);
    expect(layers.every((layer) => layer.style.connect)).toBe(false);
  });

  it('切到 TAS 同样复位 connect', () => {
    vi.useFakeTimers();
    useWorkspace.setState({ spec: specWithLayer(true), chartType: 'scatter' });
    useWorkspace.getState().setChartType('tas');
    const layers = useWorkspace.getState().spec.layers;
    expect(layers.every((layer) => layer.style.connect)).toBe(false);
  });
});
