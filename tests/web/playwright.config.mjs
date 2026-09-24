// Playwright config for the pencil game (docs/map). Browsers come from ~/Library/Caches/ms-playwright
// (@playwright/test is pinned to 1.58.0, whose chromium-1208 / webkit-2248 builds are the cached ones).
// Run outside the Bash sandbox: npx playwright test  (or --project=chromium / --project=webkit)
import { defineConfig, devices } from '@playwright/test';

const PORT = +(process.env.PORT || 8765);
/** Chromium on the GPU (Metal ANGLE). Headless Chromium otherwise renders with SwiftShader, where software
 *  compositing alone holds the page at ~15 fps (the JS draw is < 1 ms): a perf spec would fail on something
 *  that is not a page problem. perf.mjs and the §10.8 perf spec use these. */
export const GPU_ARGS = ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu-rasterization'];
export default defineConfig({
  testDir: '.',
  testMatch: /.*\.spec\.mjs$/,
  outputDir: 'test-results',
  timeout: 60000,
  fullyParallel: true,
  reporter: [['list']],
  use: { baseURL: `http://127.0.0.1:${PORT}`, viewport: { width: 1440, height: 900 } },
  webServer: { command: `node server.mjs ${PORT}`, url: `http://127.0.0.1:${PORT}/temporal-claude-agent/map/`, reuseExistingServer: true, timeout: 20000 },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 }, launchOptions: { args: GPU_ARGS } } },
    // WebKit: no longtask entries (see perf.mjs); perf assertions there use the rAF gap maximum instead
    { name: 'webkit', use: { ...devices['Desktop Safari'], viewport: { width: 1440, height: 900 } } },
  ],
});
