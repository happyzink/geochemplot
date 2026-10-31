import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { PlotSpec } from '../../src/lib/generated/types';
import { buildScene } from '../../src/lib/mock/scene';
import { ANALYSES, REFERENCES } from '../../src/lib/mock/fixtures';

const scatterSpec = JSON.parse(
  readFileSync(resolve(process.cwd(), '..', 'contracts/fixtures/scatter_valid.json'), 'utf8'),
) as PlotSpec;

function build(analysisIds: string[]) {
  return buildScene({
    spec: scatterSpec,
    requestId: 'test_request',
    analyses: ANALYSES,
    selections: [
      {
        selection_id: scatterSpec.layers[0].selection_id,
        selection_hash: 'hash_test',
        analysis_ids: analysisIds,
        dataset_versions: [{ dataset_id: 'ds_demo', version: '1' }],
      },
    ],
    references: REFERENCES,
    softwareVersion: 'test',
  });
}

describe('Scene 构建（合同形态）', () => {
  const ids = ANALYSES.slice(0, 20).map((a) => a.analysis_id);
  const scene = build(ids);

  it('输出 schema 1.1 且带 hash/axes/counts', () => {
    expect(scene.schema_version).toBe('1.1');
    expect(scene.spec_hash.length).toBeGreaterThan(8);
    expect(scene.scene_hash.length).toBeGreaterThan(8);
    expect(scene.axes.x.label.length).toBeGreaterThan(0);
    expect(scene.counts.selected_analyses).toBe(ids.length);
  });

  it('比例变量产生点，且每点保留 analysis_id 与原始名', () => {
    expect(scene.series.length).toBeGreaterThan(0);
    const points = scene.series.flatMap((s) => s.points);
    expect(points.length).toBeGreaterThan(0);
    for (const point of points) {
      expect(ids).toContain(point.analysis_id);
      expect(point.provenance.raw_name).toBeTruthy();
    }
  });

  it('使用标准化变量时写入参考快照', () => {
    expect(scene.reference_snapshots.some((r) => r.ref_id === 'Chondrite_MS95')).toBe(true);
  });

  it('样式 alpha 与合同 fixture 一致（不叠加、不改写）', () => {
    for (const series of scene.series) {
      expect(series.style.marker_alpha).toBe(scatterSpec.layers[0].style.marker_alpha);
      expect(series.style.line_alpha).toBe(scatterSpec.layers[0].style.line_alpha);
    }
  });

  it('手动轴范围被保留，不悄悄回退', () => {
    expect(scene.axes.x.range).toEqual([0, 0.5]);
    expect(scene.axes.y.range).toEqual([0, 10]);
  });

  it('选择集缺失时给 warning 而不是抛错', () => {
    const missing = buildScene({
      spec: scatterSpec,
      requestId: 'test_missing',
      analyses: ANALYSES,
      selections: [],
      references: REFERENCES,
      softwareVersion: 'test',
    });
    expect(missing.series).toHaveLength(0);
    expect(missing.warnings.some((w) => w.startsWith('SELECTION_MISSING'))).toBe(true);
  });

  it('同一输入重复计算得到相同 scene_hash（忽略 request_id）', () => {
    const again = build(ids);
    expect(again.scene_hash).toBe(scene.scene_hash);
  });
});
