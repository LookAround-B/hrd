import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/ui',
  workers: 1,
  timeout: 30000,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:8121',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    launchOptions: process.env.HRD_CHROMIUM_EXECUTABLE
      ? { executablePath: process.env.HRD_CHROMIUM_EXECUTABLE }
      : {},
  },
  webServer: {
    command: 'npm run dev -w frontend -- --host 127.0.0.1 --port 8121 --strictPort',
    url: 'http://127.0.0.1:8121',
    reuseExistingServer: false,
    timeout: 30000,
  },
});
