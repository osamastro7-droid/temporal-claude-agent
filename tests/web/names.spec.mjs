// The player's name (GAME_SPEC §10 browser spec 4, the rules in §6): typed into the real form, started with
// the real Start button. Checked: valid or not (Start disabled with a reason), the cleaned name, what the
// pencil draws, fallback mode, the fitted widths, no '?' glyph for a Latin name, and that the name never
// reaches the URL, the title, the console or storage (unless "Remember" is ticked).
import { test, expect } from '@playwright/test';
import { open, problems, state, sync, needStory, railTo, playToEnd } from './helpers.mjs';

const FORTY = 'Maximiliana Wilhelmina Theodora Brightly';          // 40 characters
// input -> expected. name: the cleaned name (panel); drawn: what the pencil draws; mode; checkout: the fitted
// checkout-field text (§6 "Widths"); invalid: Start stays disabled.
const NAMES = [
  { input: 'Maria', name: 'Maria', drawn: 'Maria', mode: 'font' },
  { input: 'Zo\u00eb', name: 'Zo\u00eb', drawn: 'Zo\u00eb', mode: 'font' },
  { input: 'O\u2019Brien', name: 'O\u2019Brien', drawn: "O'Brien", mode: 'font' },
  { input: '\u0141ukasz', name: '\u0141ukasz', drawn: 'Lukasz', mode: 'font', panel: true },
  { input: 'Nguy\u1ec5n', name: 'Nguy\u1ec5n', drawn: 'Nguyen', mode: 'font' },
  // GAME_SPEC §10 writes '"Zoe" + U+0301 -> Zo\u00eb'; U+0301 is the acute (Zo\u00e9). Both decomposed forms are checked:
  { input: 'Zoe\u0308', name: 'Zo\u00eb', drawn: 'Zo\u00eb', mode: 'font' },
  { input: 'Zoe\u0301', name: 'Zo\u00e9', mode: 'font' },
  { input: '\u0645\u062d\u0645\u062f', name: '\u0645\u062d\u0645\u062f', mode: 'fallback' },
  { input: '\u5f20\u4f1f', name: '\u5f20\u4f1f', mode: 'fallback' },
  { input: '\u{1f469}\u200d\u{1f4bb}', invalid: true },
  { input: 'Zo\u00eb \u{1f642}', name: 'Zo\u00eb', drawn: 'Zo\u00eb', mode: 'font' },
  { input: '<img src=x onerror=alert(1)>', invalid: true, xss: true },
  { input: '     ', invalid: true },
  { input: FORTY, name: FORTY, drawn: FORTY, mode: 'font', fits: true },
  // "first word only": the whole first word when it fits the field, else its first part at the hyphen (a cut with
  // '...' is the last resort, GAME_SPEC §6 "Widths"; 'Alexandra-Katharina' alone is wider than the field's 512)
  { input: 'Alexandra-Katharina Wolfgang', name: 'Alexandra-Katharina Wolfgang', drawn: 'Alexandra-Katharina Wolfgang', mode: 'font', checkout: ['Alexandra-Katharina', 'Alexandra'] },
  { input: 'Ma\u202eria', name: 'Maria', drawn: 'Maria', mode: 'font' },
];

test.describe('4 names', () => {
  for (const n of NAMES) {
    test(`${JSON.stringify(n.input)} -> ${n.invalid ? 'invalid' : n.mode === 'fallback' ? 'fallback' : JSON.stringify(n.drawn)}`, async ({ page }) => {
      const w = await open(page);
      const dialogs = [], logs = [];
      page.on('dialog', d => { dialogs.push(d.message()); d.dismiss().catch(() => {}); });
      page.on('console', m => logs.push(m.text()));
      const input = page.locator('#name-input'), start = page.locator('#name-start');
      // the input itself (GAME_SPEC §6 "Input")
      await expect(input).toHaveAttribute('maxlength', '40');
      await expect(input).toHaveAttribute('autocomplete', 'off');
      await expect(input).toHaveAttribute('spellcheck', 'false');
      await expect(input).toHaveAttribute('autocapitalize', 'words');
      expect(await input.evaluate(el => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(16);
      expect(await page.evaluate(() => document.querySelector('label[for="name-input"]')?.textContent)).toBeTruthy();
      const count0 = await page.evaluate(() => document.getElementsByTagName('*').length);
      const title0 = await page.title(), url0 = page.url();
      await input.fill(n.input);
      if (n.invalid) {
        await expect(start).toBeDisabled();
        await expect(page.locator('#name-why')).not.toBeEmpty();
        await input.press('Enter'); await sync(page);
        expect((await state(page)).scene, 'Enter does not start with an invalid name').toBe('start');
        if (n.xss) {
          expect(dialogs).toEqual([]);
          expect(await page.evaluate(() => document.getElementsByTagName('*').length), 'no new element').toBe(count0);
          expect(await page.evaluate(() => document.querySelectorAll('img').length)).toBe(0);
        }
        expect(await problems(w)).toEqual([]);
        return;
      }
      await expect(start).toBeEnabled();
      await expect(page.locator('#name-why')).toBeEmpty();
      await start.click(); await sync(page);
      const s = await state(page);
      expect(s.name).toBe(n.name);
      expect(s.nameMode).toBe(n.mode);
      if (n.drawn) expect(s.drawnName).toBe(n.drawn);
      if (n.mode === 'fallback') expect(s.drawnName, 'fallback draws the exact name').toBe(n.name);
      expect(s.name.includes('\u202e') || s.name.includes('\u200b')).toBe(false);
      // the slug (GAME_SPEC §6): ascii lower letters of the drawn name, <= 12, else 'you'
      const slug = (n.drawn ?? s.drawnName).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z]/g, '').slice(0, 12) || 'you';
      expect(s.slug).toBe(slug);
      // the widths (GAME_SPEC §6 "Widths"): the checkout field, the email page, the end card
      const fit = await page.evaluate(() => {
        const s = window.__game.state(), B = NAME.BUDGET, m = (t, b) => NAME.measureName(t, s.nameMode, b.cap, b.cd);
        const co = NAME.checkout ? NAME.checkout.text : null, mail = NAME.fit(s.drawnName, s.nameMode, B.mail), line = NAME.fit(s.drawnName, s.nameMode, B.line);
        const glyphs = t => [...t].filter(ch => !FONT_EMS_TECH.glyphs[ch]);
        return { co, mail, line, w: { co: co === null ? null : m(co, B.field), mail: m(mail, B.mail), line: m(line, B.line) }, max: { co: B.field.max, mail: B.mail.max, line: B.line.max },
          missing: s.nameMode === 'font' ? [...glyphs(s.drawnName), ...glyphs(co ?? ''), ...glyphs(mail), ...glyphs(line)] : [] };
      });
      expect(fit.co, 'the checkout field got the name').not.toBeNull();
      expect(fit.w.co).toBeLessThanOrEqual(512);
      expect(fit.w.co).toBeLessThanOrEqual(fit.max.co);
      expect(fit.w.mail).toBeLessThanOrEqual(fit.max.mail);
      expect(fit.w.line).toBeLessThanOrEqual(fit.max.line);
      if (n.checkout) {                                                  // the first candidate that fits the field
        const fits = await page.evaluate(c => c.map(t => NAME.measureName(t, 'font', NAME.BUDGET.field.cap, NAME.BUDGET.field.cd) <= NAME.BUDGET.field.max), n.checkout);
        expect(fit.co, `first word only (fits: ${JSON.stringify(fits)})`).toBe(n.checkout[fits.indexOf(true)]);
      }
      else if (n.fits) expect(fit.co.endsWith('...') || fit.co === n.drawn || n.drawn.startsWith(fit.co)).toBe(true);
      else expect(fit.co).toBe(n.mode === 'font' ? n.drawn ?? s.drawnName : n.name);
      // no '?' glyph for a Latin name: every letter the pencil draws is in the font (glyphOf falls back to '?')
      if (n.mode === 'font') expect(fit.missing, "letters the font lacks (drawn as '?')").toEqual([]);
      // the checkout's typed cels index by code point (GAME_SPEC §6 "Compile ids"; stageC.js:239 sliced UTF-16)
      if (n.mode === 'font') expect(await page.evaluate(() => SC.D.checkout.name.n)).toBe([...fit.co].length);
      // the panel shows the exact name (GAME_SPEC §0)
      if (n.panel) await expect(page.locator('#panel')).toContainText(n.name);
      // never the URL, the title, the console or storage (GAME_SPEC §6 "Never", "Storage")
      expect(page.url()).toBe(url0);
      expect(await page.title()).toBe(title0);
      expect(logs.filter(l => l.includes(s.name) || (s.drawnName && l.includes(s.drawnName)))).toEqual([]);
      expect(await page.evaluate(() => { try { return localStorage.getItem('tca-map-name'); } catch (e) { return 'blocked'; } })).toBeNull();
      expect(await problems(w)).toEqual([]);
    });
  }

  test('Remember my name: unchecked by default; ticked, it is stored and comes back', async ({ page }) => {
    const w = await open(page);
    await expect(page.locator('#name-remember')).not.toBeChecked();
    await page.locator('#name-input').fill('Zo\u00eb');
    await page.locator('#name-remember').check();
    await page.locator('#name-start').click(); await sync(page);
    expect(await page.evaluate(() => localStorage.getItem('tca-map-name'))).toBe('Zo\u00eb');
    await page.reload(); await page.waitForFunction(() => window.__game && window.__game.ready);
    await expect(page.locator('#name-input')).toHaveValue('Zo\u00eb');
    await expect(page.locator('#name-remember')).toBeChecked();
    expect(await problems(w)).toEqual([]);
  });

  test('Change name on the end card forgets the stored name and empties the form', async ({ page }) => {
    test.setTimeout(120000);
    const w = await open(page);
    await needStory(page);
    await page.locator('#name-input').fill('Zo\u00eb');
    await page.locator('#name-remember').check();
    await page.locator('#name-start').click(); await sync(page);
    await railTo(page, 9);
    expect((await playToEnd(page)).ok).toBe(true);
    await page.locator('#btn-rename').click(); await sync(page);
    expect(await page.evaluate(() => localStorage.getItem('tca-map-name'))).toBeNull();
    expect((await state(page)).scene).toBe('start');
    await expect(page.locator('#name-input')).toHaveValue('');
    await expect(page.locator('#name-input')).toBeFocused();
    expect(await problems(w)).toEqual([]);
  });
});
