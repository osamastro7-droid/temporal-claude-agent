// Shared helpers for the browser specs (GAME_SPEC §10 "Browser specs"): every test collects page errors,
// console errors, CSP violations and all requests, and fails on any request outside /temporal-claude-agent/map/
// (data: URLs excepted).
export const MAP = '/temporal-claude-agent/map/';

// Playwright's own screenshot code injects a <style> (caret / animation control). The page's CSP blocks it,
// and WebKit reports that as a console error and a securitypolicyviolation (Chromium does not). It is not a
// page problem, so exactly that report is ignored WHILE w.screenshot() runs, and nowhere else.
const PW_SHOT_STYLE = /^Refused to apply a stylesheet because its hash, its nonce, or 'unsafe-inline' does not appear in the style-src directive/;
const PW_SHOT_CSP = /^style-src(-elem)? inline$/;

/**
 * Start watching a page (call before goto).
 * @returns {Promise<{errors, csp, external, requests, ignored, finish(), screenshot(opts)}>}
 *   Specs take screenshots with w.screenshot(opts) (same options as page.screenshot), never page.screenshot.
 */
export async function watch(page) {
  const w = { errors: [], csp: [], external: [], requests: [], ignored: [], shooting: 0 };
  await page.addInitScript(() => {
    window.__csp = [];
    document.addEventListener('securitypolicyviolation', e => window.__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
  });
  page.on('pageerror', e => w.errors.push('pageerror: ' + e.message));
  page.on('console', m => {
    if (m.type() !== 'error') return;
    const t = m.text(); if (w.shooting && PW_SHOT_STYLE.test(t)) { w.ignored.push(t); return; }
    w.errors.push('console: ' + t);
  });
  page.on('request', r => {
    const u = r.url(); w.requests.push(u);
    if (u.startsWith('data:')) return;
    const p = new URL(u);
    if (!['127.0.0.1', 'localhost'].includes(p.hostname) || !p.pathname.startsWith(MAP)) w.external.push(u);
  });
  w.finish = async () => { try { w.csp.push(...await page.evaluate(() => window.__csp || [])); } catch (e) { /* page gone */ } return w; };
  w.screenshot = async opts => {
    w.shooting++;
    const n0 = await page.evaluate(() => (window.__csp || []).length);
    try { return await page.screenshot(opts); }
    finally {
      // let the report reach us (console events arrive before this round trip returns), then drop only the
      // violations the screenshot itself caused
      const dropped = await page.evaluate(([n, re]) => { const r = new RegExp(re), all = window.__csp || [], tail = all.splice(n);
        const keep = tail.filter(v => !r.test(v)); all.push(...keep); return tail.length - keep.length; }, [n0, PW_SHOT_CSP.source]);
      if (dropped) w.ignored.push(`${dropped} screenshot style-src violation(s)`);
      w.shooting--;
    }
  };
  return w;
}

/** Wait for runtime.js to be up. */
export async function ready(page) {
  await page.waitForFunction(() => window.__game && window.__game.ready, null, { timeout: 30000 });
}
