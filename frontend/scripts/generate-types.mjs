#!/usr/bin/env node
/**
 * 合同类型生成/核对脚本。
 *
 * 数据源：
 *   contracts/plot-spec.schema.json
 *   contracts/plot-scene.schema.json
 *   docs/progress/CONTRACT_READY.json（就绪信号与哈希）
 *
 * 用法：
 *   node scripts/generate-types.mjs            # 核对：校验哈希并生成到临时文件，报告与 types.ts 的差异
 *   node scripts/generate-types.mjs --write    # 生成并覆盖 src/lib/generated/types.ts
 *
 * 注意：当前 src/lib/generated/types.ts 以合同 1.1 + 05 文档为准做了少量人工补强
 * （分类轴 category_order、带 code/message 的 warnings、字体清单数组等）。
 * plot-scene.schema.json 在就绪信号之后仍有更新，形态差异记录在
 * docs/progress/TRAE_CONTRACT_REQUESTS.md，等 Qoder 明确后再 --write。
 */

import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compile } from 'json-schema-to-typescript';

const here = dirname(fileURLToPath(import.meta.url));
const frontendRoot = resolve(here, '..');
const repoRoot = resolve(frontendRoot, '..');
const rel = (p) => join(repoRoot, p);
const readText = (p) => readFileSync(rel(p), 'utf8');
const readJson = (p) => JSON.parse(readText(p));
const sha256 = (p) => createHash('sha256').update(readFileSync(rel(p))).digest('hex');

let failures = 0;
function check(label, actual, expected) {
  const ok = actual === expected;
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `\n      actual=${actual}\n      expect=${expected}`}`);
}

const ready = readJson('docs/progress/CONTRACT_READY.json');
check('CONTRACT_READY.status', ready.status, 'ready');
check('plot-spec.schema.json', sha256('contracts/plot-spec.schema.json'), ready.schema_sha256);
check('openapi.json', sha256('contracts/openapi.json'), ready.openapi_sha256);
check('fixtures/manifest.json', sha256('contracts/fixtures/manifest.json'), ready.fixture_manifest_sha256);

for (const [name, expected] of Object.entries(ready.fixture_hashes)) {
  check(`fixtures/${name}`, sha256(`contracts/fixtures/${name}`), expected);
}

const spec = readJson('contracts/plot-spec.schema.json');
const scene = readJson('contracts/plot-scene.schema.json');
const defs = {
  ...(spec.$defs ?? spec.definitions ?? {}),
  ...(scene.$defs ?? scene.definitions ?? {}),
  PlotScene: {
    title: 'PlotScene',
    type: 'object',
    description: scene.description,
    properties: scene.properties,
    required: scene.required,
  },
};
const root = { ...spec, $defs: defs };
delete root.definitions;

const generated = await compile(root, 'PlotSpec', {
  bannerComment: '',
  additionalProperties: false,
  enableConstEnums: true,
  format: false,
  style: { singleQuote: true },
});

const target = join(frontendRoot, 'src/lib/generated/types.ts');
const current = readFileSync(target, 'utf8');
const tempDir = mkdtempSync(join(tmpdir(), 'geoplot-types-'));
const tempFile = join(tempDir, 'types.generated.ts');
writeFileSync(tempFile, generated, 'utf8');

const normalize = (text) => text.replace(/\r\n/g, '\n').trim();
const same = normalize(generated) === normalize(current);
console.log(`\n生成结果：${tempFile}`);
console.log(`与 src/lib/generated/types.ts ${same ? '完全一致' : '存在差异（人工补强或 schema 漂移）'}`);

if (process.argv.includes('--write')) {
  writeFileSync(target, generated, 'utf8');
  console.log(`已写入 ${target}`);
}

if (failures > 0) {
  console.error(`\n哈希核对失败 ${failures} 项；就绪信号与实际文件不一致，禁止据此签发完成。`);
  process.exit(1);
}
