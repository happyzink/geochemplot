import { expect, test } from '@playwright/test';

/**
 * 演示模式（?demo=1）核心流程：勾选分析 → 成层 → Excel 式轴编辑 → 图件/导出页。
 * 只证明前端交互与 PlotSpec→Scene 链路，不证明写盘或真实科学计算。
 */

const EVIDENCE = 'D:/moon/docs/progress/evidence';

test.beforeEach(async ({ page }) => {
  await page.goto('/?demo=1');
  await expect(page.getByTestId('demo-banner')).toBeVisible();
  await expect(page.getByRole('button', { name: '作图工作台' })).toBeVisible();
});

async function selectFirstPage(page: import('@playwright/test').Page) {
  // 等样品表首次加载完成，再按 analysis_id 做跨页选择（依赖 analysis_id，而不是行号）。
  await expect(page.locator('.table-row .cell').first()).toBeVisible();
  await page.getByRole('button', { name: '选择全部筛选结果' }).click();
  await expect(page.getByRole('button', { name: '加为图层' })).toBeEnabled();
}

test('勾选样品后创建图层并渲染 Plotly 画布', async ({ page }) => {
  await selectFirstPage(page);
  await page.getByRole('button', { name: '加为图层' }).click();

  await expect(page.locator('.js-plotly-plot')).toBeVisible();
  await expect(page.locator('.plot-stat-strip')).toContainText('有效');
  await page.screenshot({ path: `${EVIDENCE}/01-workspace-layer.png` });
});

test('双击 X 轴热区打开轴格式并把 log10 写入 PlotSpec', async ({ page }) => {
  await selectFirstPage(page);
  await page.getByRole('button', { name: '加为图层' }).click();
  await expect(page.locator('.js-plotly-plot')).toBeVisible();

  await page.locator('.axis-hotspot.x').dblclick();
  await expect(page.getByText('X 轴格式')).toBeVisible();
  await page.screenshot({ path: `${EVIDENCE}/02-axis-panel.png` });

  await page.getByRole('dialog').locator('select').first().selectOption('log10');
  await page.getByRole('button', { name: '应用并重算' }).click();
  await expect(page.getByText('X 轴格式')).toHaveCount(0);

  // updateAxis 会触发异步重算 Scene，等 Plotly 的 layout 真正切换到 log。
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const plot = document.querySelector('.js-plotly-plot') as unknown as { _fullLayout?: { xaxis?: { type?: string } } };
          return plot._fullLayout?.xaxis?.type ?? null;
        }),
      { timeout: 20_000 },
    )
    .toBe('log');
  await page.screenshot({ path: `${EVIDENCE}/03-axis-log-applied.png` });
});

test('双击数据点打开系列格式面板', async ({ page }) => {
  await selectFirstPage(page);
  await page.getByRole('button', { name: '加为图层' }).click();
  await expect(page.locator('.js-plotly-plot')).toBeVisible();

  // Plotly 的 draglayer 覆盖数据点，直接点 path 会被拦截；按点的屏幕坐标双击更接近真实用户。
  const point = page.locator('.js-plotly-plot .scatterlayer .points .point').first();
  await expect(point).toBeVisible();
  const box = await point.boundingBox();
  if (!box) throw new Error('数据点没有可点击区域');
  await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.getByRole('dialog').getByText('系列格式')).toBeVisible();
  await page.screenshot({ path: `${EVIDENCE}/04-series-panel.png` });
  await page.getByRole('dialog').getByRole('button', { name: '取消' }).click();
});

test('筛选只改变筛选结果，不悄悄改变投图选择', async ({ page }) => {
  await selectFirstPage(page);
  await expect(page.locator('.topbar')).toContainText('已勾选 330');

  await page.getByPlaceholder('74235 / CE6-118…').fill('74235');
  await page.getByRole('button', { name: '搜索' }).click();
  await expect.poll(async () => (await page.locator('.topbar').innerText()).includes('已勾选 330')).toBe(true);
  await expect(page.locator('.topbar')).toContainText('已勾选 330');
  await page.screenshot({ path: `${EVIDENCE}/07-filter-keeps-selection.png` });
});

test('保存不可变版本后导出对话框给出真实阻断项', async ({ page }) => {
  await selectFirstPage(page);
  await page.getByRole('button', { name: '加为图层' }).click();
  await page.getByRole('button', { name: '保存版本' }).click();
  await expect(page.getByText(/已保存不可变版本/)).toBeVisible();

  await page.getByRole('button', { name: '导出…' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('dialog')).toContainText('演示模式不会真正写盘');
  await expect(page.getByRole('dialog').getByRole('button', { name: /开始导出|导出/ })).toBeDisabled();
  await page.screenshot({ path: `${EVIDENCE}/08-export-blockers.png` });
});

test('刷新后无需重传数据，图层与轴设置从草稿恢复', async ({ page }) => {
  await selectFirstPage(page);
  await page.getByRole('button', { name: '加为图层' }).click();
  await page.locator('.axis-hotspot.x').dblclick();
  await page.getByRole('dialog').locator('select').first().selectOption('log10');
  await page.getByRole('button', { name: '应用并重算' }).click();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const plot = document.querySelector('.js-plotly-plot') as unknown as { _fullLayout?: { xaxis?: { type?: string } } };
        return plot._fullLayout?.xaxis?.type ?? null;
      }),
    )
    .toBe('log');
  // 等待草稿落盘（演示模式写入 localStorage 的 mock DB；自动保存节流 3s）。
  await page.waitForTimeout(3600);

  await page.reload();
  await expect(page.getByTestId('demo-banner')).toBeVisible();
  await expect(page.locator('.js-plotly-plot')).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const plot = document.querySelector('.js-plotly-plot') as unknown as { _fullLayout?: { xaxis?: { type?: string } } };
        return plot._fullLayout?.xaxis?.type ?? null;
      }),
      { timeout: 20_000 },
    )
    .toBe('log');
  await page.screenshot({ path: `${EVIDENCE}/09-reload-restored.png` });
});

test('图件库与导出记录页可导航并说明版本不可变', async ({ page }) => {
  await page.locator('.navbar .nav-item', { hasText: '图件库' }).click();
  await expect(page.getByText(/当前图件的保存版本/)).toBeVisible();
  await page.screenshot({ path: `${EVIDENCE}/05-figure-library.png` });

  await page.locator('.navbar .nav-item', { hasText: '导出记录' }).click();
  await expect(page.getByText(/还没有导出记录|保存版本后/).first()).toBeVisible();
  await page.screenshot({ path: `${EVIDENCE}/06-exports-page.png` });
});
