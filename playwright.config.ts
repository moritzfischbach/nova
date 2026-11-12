import { defineConfig } from '@playwright/test';

// E2E runs against the combined Nova server (API + built PWA) with mock Grok-Bot webhook,
// mock Google Calendar and a local test push service (see e2e/test-server.mjs).
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  use: {
    baseURL: 'http://127.0.0.1:8797',
    channel: 'chrome',
    headless: true,
    viewport: { width: 390, height: 844 },
    locale: 'de-DE',
    timezoneId: 'Europe/Berlin',
  },
  webServer: {
    command: 'node e2e/test-server.mjs',
    url: 'http://127.0.0.1:8797/api/bot/status',
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
