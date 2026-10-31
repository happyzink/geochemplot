import { afterEach, describe, expect, it, vi } from 'vitest';
import { EXPECTED_SCENE_VERSION, HttpApiClient, SceneContractError, assertSceneContract } from '../../src/lib/api/http';
import type { PlotSpec } from '../../src/lib/generated/types';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const spec = JSON.parse(
  readFileSync(resolve(process.cwd(), '..', 'contracts/fixtures/scatter_valid.json'), 'utf8'),
) as PlotSpec;

function validScene(requestId: string): Record<string, unknown> {
  return {
    scene_id: 'scene_test',
    schema_version: EXPECTED_SCENE_VERSION,
    request_id: requestId,
    spec_hash: 'spec_hash',
    scene_hash: 'scene_hash',
    plot_revision: 1,
    chart_type: 'scatter',
    variables: { value_mode: 'raw' },
    resolved_selections: [],
    reference_snapshots: [],
    axes: {
      x: { label: 'X', scale: 'linear', ticks: [], range: null, reversed: false, unit: null },
      y: { label: 'Y', scale: 'linear', ticks: [], range: null, reversed: false, unit: null },
    },
    series: [
      {
        series_id: 's1',
        layer_id: 'l1',
        label: 'L1',
        analysis_ids: ['a1'],
        points: [{ point_id: 'p1', analysis_id: 'a1', x: 1, y: 2, provenance: {} }],
        style: {},
      },
    ],
    diagram_geometry: null,
    legend: { position: 'right' },
    layout: { width_mm: 183, height_mm: 110, font_family: 'Arial', font_size_pt: 7, tick_font_size_pt: 6, annotations: [] },
    font_manifest: [],
    counts: {},
    exclusions: [],
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('HTTP 合同（18 §3）', () => {
  it('computePlot 发送 {request_id, spec} 并直接接收 PlotScene', async () => {
    let sentBody: Record<string, unknown> | null = null;
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      sentBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify(validScene(String(sentBody.request_id))), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }));

    const scene = await new HttpApiClient().computePlot(spec);
    expect(sentBody).not.toBeNull();
    expect(Object.keys(sentBody!)).toEqual(['request_id', 'spec']);
    expect(sentBody!.spec).toEqual(spec);
    expect((scene as unknown as Record<string, unknown>).chart_type).toBe('scatter');
    expect((scene as unknown as Record<string, unknown>).request_id).toBe(sentBody!.request_id);
  });

  it('拒绝后端 {scene,status} 包装，不强转成 Scene', () => {
    expect(() => assertSceneContract({ scene: validScene('req'), status: 'succeeded' }, 'req')).toThrow(
      SceneContractError,
    );
  });

  it('拒绝旧 schema 1.1', () => {
    expect(() => assertSceneContract({ ...validScene('req'), schema_version: '1.1' }, 'req')).toThrow(/1\.2/);
  });

  it('拒绝 request_id 不回显的旧结果', () => {
    expect(() => assertSceneContract(validScene('old'), 'req')).toThrow(/request_id/);
  });

  it('REE 混入多 analysis 的 series 直接拒绝', () => {
    const scene = validScene('req');
    scene.chart_type = 'ree';
    scene.series = [
      {
        series_id: 's1',
        layer_id: 'l1',
        label: 'L1',
        analysis_ids: ['a1', 'a2'],
        points: [
          { point_id: 'p1', analysis_id: 'a1', x: 0, y: 1, provenance: {} },
          { point_id: 'p2', analysis_id: 'a2', x: 1, y: 2, provenance: {} },
        ],
        style: {},
      },
    ];
    expect(() => assertSceneContract(scene, 'req')).toThrow(/一 analysis 一 series/);
  });

  it('TAS 缺少 diagram_geometry 直接拒绝', () => {
    const scene = validScene('req');
    scene.chart_type = 'tas';
    expect(() => assertSceneContract(scene, 'req')).toThrow(/diagram_geometry/);
  });
});
