import { defineConfig, devices } from '@playwright/test';

const port = 4173;
const baseURL = `http://127.0.0.1:${port}`;
// Call Vite's binary directly: on Linux, Playwright cannot stop a server started through
// `pnpm exec`, so the run hangs after the last test until the CI job times out.
const vite = 'node node_modules/vite/bin/vite.js';

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // No retries: a flaky spec should fail CI, not pass on a second try.
  retries: 0,
  // Fail with a report well before the CI job's own timeout cancels the run.
  globalTimeout: 10 * 60_000,
  reporter: process.env.CI ? [['list'], ['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'desktop-chromium',
      testIgnore: /mobile\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'mobile-chromium',
      testMatch: /mobile\.spec\.ts/,
      use: { ...devices['Pixel 7'] },
    },
  ],
  webServer: {
    // Test the production bundle, as deployed.
    command: `${vite} build && ${vite} preview --host 127.0.0.1 --port ${port} --strictPort`,
    url: baseURL,
    // Never reuse a running server: it could be serving a stale build or one with Drive configured.
    reuseExistingServer: false,
    timeout: 180_000,
    // Drive needs real Google OAuth; keep it unconfigured even if a local .env sets a client ID.
    env: { VITE_GOOGLE_CLIENT_ID: '' },
  },
});
