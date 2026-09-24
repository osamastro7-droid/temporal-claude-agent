// Sound report (tests/web/dev, not published): node dev/sfx-report.mjs (browsers run outside the Bash sandbox).
// 1) live: no AudioContext before the Sound click, 'running' after it, suspend on hidden, disable; 2) per-sound peak/length
// through the full graph in an OfflineAudioContext; 3) a scripted sequence of every event type with a crash (silence window).
import { chromium } from '@playwright/test';
import { startServer } from '../server.mjs';
const srv = await startServer(0), browser = await chromium.launch(), page = await browser.newPage(), errs = [];
page.on('pageerror', e => errs.push(e.message)); page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.type() + ': ' + m.text()); });
// live context test first (fresh page)
await page.goto(srv.url + '/dev/sfx.html'); await page.waitForFunction(() => window.__dev && window.__dev.ready);
const before = await page.evaluate(() => ({ n: __dev.contexts(), state: SFX_LIVE.state() }));
await page.waitForTimeout(300);
const before2 = await page.evaluate(() => ({ n: __dev.contexts(), state: SFX_LIVE.state() }));
await page.click('#on'); await page.waitForFunction(() => SFX_LIVE.state() === 'running', null, { timeout: 5000 });
const after = await page.evaluate(async () => {
  const t0 = performance.now(); for (const t of Object.keys(SFX_LIVE.TYPES)) SFX_LIVE.play(t, t === 'keys' ? { dur: 1 } : {});
  const playMs = performance.now() - t0;
  SFX_LIVE.hum(true); SFX_LIVE.scratch(true, .35); SFX_LIVE.keyStroke(' '); SFX_LIVE.crash(); SFX_LIVE.power();
  SFX_LIVE.filmCue({ t: 0, type: 'boot' }, 'a1');
  await new Promise(r => setTimeout(r, 1500));
  SFX_LIVE.visibility(true); await new Promise(r => setTimeout(r, 200)); const hidden = SFX_LIVE.state();
  SFX_LIVE.visibility(false); await new Promise(r => setTimeout(r, 200)); const shown = SFX_LIVE.state();
  await SFX_LIVE.disable(); const off = SFX_LIVE.state();
  return { n: __dev.contexts(), playMs: +playMs.toFixed(1), hidden, shown, off };
});
console.log('LIVE', JSON.stringify({ before, before2, after }));
await page.goto(srv.url + '/dev/sfx.html'); await page.waitForFunction(() => window.__dev && window.__dev.ready);
const per = await page.evaluate(() => __dev.perSound());
for (const r of per) console.log(r.type.padEnd(10), JSON.stringify(r.opts).padEnd(28), 'peak', String(r.peakDb).padStart(7), 'dBFS  rms', String(r.rmsDb).padStart(6), ' len', r.len);
const seq = await page.evaluate(() => __dev.renderSeq());
console.log('SEQ', JSON.stringify(seq, null, 1));
console.log('ERRORS', JSON.stringify(errs));
await browser.close(); await srv.close();
