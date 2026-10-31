/**
 * 合同就绪门禁的自动化证据：
 * 校验 docs/progress/CONTRACT_READY.json 的 status 与其中每个 sha256
 * 都与 contracts/ 下实际文件逐字节一致，并检查 fixture 的基本形态。
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REQUIRED_ENDPOINTS, collectEndpoints, diffEndpoints } from '../../src/lib/api/http';

// vitest 的 cwd 是 frontend/，合同与实际文件都在仓库根目录，用相对路径定位。
const repoRoot = resolve(process.cwd(), '..');
const repoPath = (rel: string) => resolve(repoRoot, rel);
const readText = (rel: string) => readFileSync(repoPath(rel), 'utf8');
const sha256 = (rel: string) => createHash('sha256').update(readFileSync(repoPath(rel))).digest('hex');

interface ReadySignal {
  status: string;
  schema_version: string;
  schema_sha256: string;
  plot_scene_schema_sha256?: string;
  openapi_sha256: string;
  fixture_manifest_sha256: string;
  fixture_hashes: Record<string, string>;
}

const ready = JSON.parse(readText('docs/progress/CONTRACT_READY.json')) as ReadySignal;

describe('CONTRACT_READY 就绪门禁', () => {
  it('状态为 ready 且 schema 版本为 1.2', () => {
    expect(ready.status).toBe('ready');
    expect(ready.schema_version).toBe('1.2');
  });

  it('plot-spec / plot-scene / openapi 的哈希与实际文件一致', () => {
    expect(sha256('contracts/plot-spec.schema.json')).toBe(ready.schema_sha256);
    if (ready.plot_scene_schema_sha256) {
      expect(sha256('contracts/plot-scene.schema.json')).toBe(ready.plot_scene_schema_sha256);
    }
    expect(sha256('contracts/openapi.json')).toBe(ready.openapi_sha256);
  });

  it('fixture manifest 哈希与实际文件一致', () => {
    expect(sha256('contracts/fixtures/manifest.json')).toBe(ready.fixture_manifest_sha256);
  });

  it('fixture 哈希与实际文件零漂移（R1 笔误已更正）', () => {
    expect(Object.keys(ready.fixture_hashes)).toHaveLength(8);
    const drifted = Object.entries(ready.fixture_hashes)
      .filter(([name, expected]) => sha256(`contracts/fixtures/${name}`) !== expected)
      .map(([name]) => name);
    expect(drifted).toEqual([]);
  });
});

describe('合同 fixture 形态', () => {
  const load = (name: string) =>
    JSON.parse(readText(`contracts/fixtures/${name}`)) as Record<string, unknown>;

  it('5 个有效 fixture 均为 schema 1.1，且带 layers/variables/axes/layout', () => {
    const valid = ['scatter_valid.json', 'ree_valid.json', 'ree_raw_no_reference_valid.json', 'spider_valid.json', 'tas_valid.json'];
    for (const name of valid) {
      const spec = load(name);
      expect(spec.schema_version, name).toBe('1.1');
      expect(Array.isArray(spec.layers), name).toBe(true);
      expect((spec.layers as unknown[]).length, name).toBeGreaterThan(0);
      expect(spec.variables, name).toBeTruthy();
      expect(spec.axes, name).toBeTruthy();
      expect(spec.layout, name).toBeTruthy();
      expect(spec.quality_policy, name).toBeTruthy();
    }
  });

  it('3 个拒绝 fixture 携带预期的拒绝特征', () => {
    const reeNoRef = load('ree_no_reference_reject.json');
    expect((reeNoRef.variables as Record<string, unknown>).reference_id).toBeNull();

    const scatterNoX = load('scatter_no_x_reject.json');
    expect((scatterNoX.variables as Record<string, unknown>).x).toBeNull();

    const duplicate = load('ree_duplicate_layer_reject.json');
    const ids = (duplicate.layers as Array<{ layer_id: string }>).map((l) => l.layer_id);
    expect(new Set(ids).size).toBeLessThan(ids.length);
  });

  it('marker_alpha 与 line_alpha 独立存在，不出现 v1 的 opacity', () => {
    const spec = load('scatter_valid.json');
    const style = (spec.layers as Array<{ style: Record<string, unknown> }>)[0].style;
    expect(style.marker_alpha).toBeTypeOf('number');
    expect(style.line_alpha).toBeTypeOf('number');
    expect(style).not.toHaveProperty('opacity');
  });
});

describe('真实模式端点门禁（R4）', () => {
  it('路径参数归一化后能匹配不同参数名', () => {
    const found = collectEndpoints({ '/api/v1/figures/{figure_id}/draft': { put: {} } });
    expect(diffEndpoints(found, ['PUT /api/v1/figures/{id}/draft'])).toEqual([]);
  });

  it('缺少的必需端点会被逐个列出', () => {
    const found = collectEndpoints({ '/api/v1/health': { get: {} } });
    const missing = diffEndpoints(found, ['GET /api/v1/health', 'GET /api/v1/datasets']);
    expect(missing).toEqual(['GET /api/v1/datasets']);
  });

  it('合同 openapi.json 覆盖全部必需端点（真实模式门禁）', () => {
    const openapi = JSON.parse(readText('contracts/openapi.json')) as {
      paths: Record<string, Record<string, unknown>>;
    };
    const missing = diffEndpoints(collectEndpoints(openapi.paths));
    expect(REQUIRED_ENDPOINTS).toHaveLength(20);
    expect(missing).toEqual([]);
  });
});
