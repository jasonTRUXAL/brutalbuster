import { defineConfig, devices } from '@playwright/test';

// Uses the Chrome / Edge already installed on the machine (no browser download):
// Edge on Windows, Chrome elsewhere (GitHub's Ubuntu runners ship it). Override with PW_CHANNEL.
const channel = process.env.PW_CHANNEL || (process.platform === 'win32' ? 'msedge' : 'chrome');
const PORT = 5199;

export default defineConfig({
  testDir: 'test/smoke',
  testMatch: '*.spec.mjs',
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    channel,
    // software WebGL so the store renders on GPU-less CI machines too
    launchOptions: { args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1280, height: 720 } } },
    { name: 'phone', use: { ...devices['Pixel 7'], channel } },
  ],
  // The smoke tests drive the store through the dev-only window.__bb hooks, so they
  // run against the dev server. `npm run build` separately proves the production bundle.
  webServer: {
    command: `npx vite --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
