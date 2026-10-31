import { existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';

/**
 * TR03 真实联调：必须是 live 模式（无 ?demo=1）+ 真实 scene-1.2 fixture。
 * 默认跳过；Qoder 完成 QR03/QR04/QR05 后按说明书 §6 R07–R20 执行。
 */

const fixtureDir = resolve(process.cwd(), '..', 'contracts/fixtures/scene-1.2');
const fixtureReady = existsSync(fixtureDir) && readdirSync(fixtureDir).some((name) => name.endsWith('.json'));
const liveEnabled = process.env.GEOPLOT_LIVE === '1';
const blocked = !liveEnabled
  ? '未设置 GEOPLOT_LIVE=1：真实服务未启动，禁止用 demo 冒充联调。'
  : !fixtureReady
    ? 'contracts/fixtures/scene-1.2/ 不存在或为空：QR03 尚未交付真实 HTTP Scene fixture。'
    : '';

test.skip(Boolean(blocked), blocked);

test('R07/R09：真实 HTTP 一 analysis 一曲线，响应直接是 Scene 1.2', async ({ page }) => {
  const computeBodies: Array<Record<string, unknown>> = [];
  const computeScenes: Array<Record<string, unknown>> = [];
  page.on('request', (request) => {
    if (request.url().includes('/api/v1/plots/compute')) {
      computeBodies.push(JSON.parse(request.postData() ?? '{}') as Record<string, unknown>);
    }
  });
  page.on('response', async (response) => {
    if (response.url().includes('/api/v1/plots/compute') && response.ok()) {
      computeScenes.push((await response.json()) as Record<string, unknown>);
    }
  });

  await page.goto('/');
  await expect(page.getByTestId('demo-banner')).toHaveCount(0);
  await expect(page.locator('.table-row .cell').first()).toBeVisible();

  const rows = page.locator('.table-row');
  await rows.nth(0).getByRole('checkbox').check();
  await rows.nth(1).getByRole('checkbox').check();
  await page.getByRole('button', { name: '加为图层' }).click();
  await page.getByRole('tab', { name: 'REE 配分' }).click();
  await expect(page.locator('.js-plotly-plot')).toBeVisible();

  const traces = await page.evaluate(() => {
    const gd = document.querySelector('.js-plotly-plot') as unknown as {
      data?: Array<Record<string, unknown>>;
      layout?: Record<string, unknown>;
    } | null;
    return gd?.data ?? [];
  });
  const lineTraces = traces.filter((trace) => String(trace.mode ?? '').includes('lines'));
  expect(lineTraces.length).toBeGreaterThanOrEqual(2);
  for (const trace of lineTraces) {
    expect(trace.connectgaps).toBe(false);
    const customdata = (trace.customdata ?? []) as unknown[][];
    const analysisIds = new Set(customdata.map((row) => row[0]));
    expect(analysisIds.size).toBe(1);
  }

  expect(computeScenes.length).toBeGreaterThan(0);
  const scene = computeScenes[computeScenes.length - 1];
  expect(scene.schema_version).toBe('1.2');
  expect(scene.chart_type).toBe('ree');
  expect('scene' in scene).toBe(false);
  const body = computeBodies[computeBodies.length - 1];
  expect(Object.keys(body).sort()).toEqual(['request_id', 'spec']);
  expect(scene.request_id).toBe(body.request_id);
});

test('R10：log 轴范围来自后端正数边界，点值不取 log', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.table-row .cell').first()).toBeVisible();
  await page.getByRole('button', { name: '选择全部筛选结果' }).click();
  await page.getByRole('button', { name: '加为图层' }).click();
  await expect(page.locator('.js-plotly-plot')).toBeVisible();

  await page.locator('.axis-hotspot.x').dblclick();
  await page.getByRole('dialog').locator('select').first().selectOption('log10');
  await page.getByRole('button', { name: '应用并重算' }).click();
  await expect(page.getByText('X 轴格式')).toHaveCount(0);

  const state = await page.evaluate(() => {
    const gd = document.querySelector('.js-plotly-plot') as unknown as {
      data?: Array<{ x?: Array<number | null> }>;
      layout?: { xaxis?: { type?: string; range?: [number, number] } };
    } | null;
    return { x: gd?.data?.[0]?.x ?? [], xaxis: gd?.layout?.xaxis ?? {} };
  });
  expect(state.xaxis.type).toBe('log');
  expect(state.xaxis.range).toBeDefined();
  expect(state.xaxis.range![0]).toBeLessThan(state.xaxis.range![1]);
  const positiveX = state.x.filter((value): value is number => typeof value === 'number' && value > 0);
  expect(positiveX.length).toBeGreaterThan(0);
});

test.fixme(
  'R11–R20 出版逐项比对（浏览器/预览/PNG/PDF/SVG/CSV/重启恢复）',
  async () => {
    // 阻塞：QR05 尚未完成出版渲染修复，且无真实导出根目录。
  },
);
