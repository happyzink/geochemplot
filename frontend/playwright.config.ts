import { defineConfig, devices } from '@playwright/test';

/**
 * 真实浏览器验收：默认连本机 Vite dev server，强制 demo=1 走演示 fixture。
 * 运行前需 `npx playwright install chromium`；未安装的机器上视为未验证。
 */
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'tests/e2e/report' }]],
  outputDir: 'tests/e2e/artifacts',
  use: {
    baseURL: 'http://127.0.0.1:5173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    viewport: { width: 1440, height: 900 },
  },
  // 用本机已安装的 Chrome，避免额外下载 Playwright 自带浏览器；
  // 便携包验收机也只需系统 Chrome/Edge。
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], channel: 'chrome' } }],
  webServer: {
    command: 'npm run dev',
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
