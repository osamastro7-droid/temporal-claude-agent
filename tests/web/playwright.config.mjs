// Playwright config for the pencil game (docs/map). Browsers come from ~/Library/Caches/ms-playwright
// (@playwright/test is pinned to 1.58.0, whose chromium-1208 / webkit-2248 builds are the cached ones).
// Run outside the Bash sandbox: npx playwright test  (or --project=chromium / --project=webkit)
// Specs (GAME_SPEC §10): smoke (foundation contracts), play (1 full play, 3 reject, 6 reduced motion, 9 sound),
// crash (2 the crash matrix), names (4), keyboard (5), layout (7 screenshots -> out/shots/), perf (8, PERF=1),
// webkit (10, the webkit project), film (11, FILM=1). One worker by default: the machine is shared (16 GB for
// several agents); WORKERS=n runs more.
import { defineConfig, devices } from '@playwright/test';

// Each run gets its own server on its own port (other agents run this suite at the same time; a shared 8765
// server they stop mid-run refused our connections). The runner picks the port once and the workers inherit it
// through the environment. PORT=n pins it and reuses a server already listening there.
const PORT = +(process.env.PORT || process.env.TCA_TEST_PORT || 20000 + (process.pid % 20000));
process.env.TCA_TEST_PORT = String(PORT);
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
  workers: +(process.env.WORKERS || 1),
  reporter: [['list']],
  use: { baseURL: `http://127.0.0.1:${PORT}`, viewport: { width: 1440, height: 900 } },
  webServer: { command: `node server.mjs ${PORT}`, url: `http://127.0.0.1:${PORT}/temporal-claude-agent/map/`, reuseExistingServer: !!process.env.PORT, timeout: 20000 },
  projects: [
    { name: 'chromium', testIgnore: /webkit\.spec\.mjs$/, use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 }, launchOptions: { args: GPU_ARGS } } },
    // WebKit runs the smoke and its own play-through (GAME_SPEC §10 test 10). No longtask entries there (see perf.mjs).
    { name: 'webkit', testMatch: /(smoke|webkit)\.spec\.mjs$/, use: { ...devices['Desktop Safari'], viewport: { width: 1440, height: 900 } } },
  ],
});
