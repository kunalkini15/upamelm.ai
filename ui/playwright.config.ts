import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  outputDir: process.env.PLAYWRIGHT_OUTPUT_DIR || 'test-results',
  workers: Number(process.env.PLAYWRIGHT_WORKERS || 2),
  retries: 0,
  reporter: [['list'], ['json', { outputFile: process.env.PLAYWRIGHT_JSON_OUTPUT || 'test-results/playwright-results.json' }]],
  use: {
    baseURL: process.env.UI_BASE_URL || 'http://127.0.0.1:5175',
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 } }],
});

