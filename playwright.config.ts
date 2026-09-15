import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests',
  use: { baseURL: process.env.TEST_URL || 'http://localhost:5173', browserName: 'chromium' },
  webServer: process.env.TEST_URL ? undefined : { command: 'npm run dev -- --port 5173', url: 'http://localhost:5173', reuseExistingServer: true },
});
