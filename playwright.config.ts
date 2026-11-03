import { defineConfig } from '@playwright/test';

// Runs against the production build served under /game/ (exactly what GitHub Pages serves).
// Build first: `npm run build && npm run test:e2e`.
export default defineConfig({
  testDir: 'e2e',
  timeout: 90_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://localhost:4173/game/',
    // Locally use the installed Chrome (override with PW_CHANNEL=msedge); CI installs Playwright's Chromium.
    channel: process.env.PW_CHANNEL ?? (process.env.CI ? undefined : 'chrome'),
    viewport: { width: 1280, height: 720 },
    launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] },
  },
  webServer: {
    command: 'npm run preview',
    url: 'http://localhost:4173/game/',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
