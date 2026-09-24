// Static checks for docs/map (GAME_SPEC §10 "Static checks"). Node only, no browser, no dependencies.
//   node static-checks.mjs          exit 1 on any FAIL; SKIP = a check whose content is not written yet
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MAP = path.resolve(HERE, '..', '..', 'docs', 'map');
const FILM = process.env.FILM_SRC || path.join(os.homedir(), 'code', 'temporal-film');
const results = [];
const ok = (name, detail = '') => results.push(['PASS', name, detail]);
const fail = (name, detail) => results.push(['FAIL', name, detail]);
const skip = (name, detail) => results.push(['SKIP', name, detail]);
const read = f => fs.readFileSync(path.join(MAP, f), 'utf8');
const walk = (dir, out = []) => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, e.name); out.push(p); if (e.isDirectory()) walk(p, out); } return out; };
const files = walk(MAP), rel = p => path.relative(MAP, p);
const jsFiles = files.filter(f => f.endsWith('.js')), codeJs = jsFiles.filter(f => !/font-emstech\.js$|logos\.js$/.test(f));
// strip // and /* */ comments (strings stay; a URL inside a string is not a comment)
const noComments = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"\\])\/\/[^\n]*/g, '$1');

// ---------- the font and the measure() of kit.js, taken from the shipped files ----------
const ctx = { window: {} }; vm.createContext(ctx);
vm.runInContext(read('engine/font-emstech.js') + '\nthis.FONT_EMS_TECH = FONT_EMS_TECH;', ctx);
const kit = read('engine/kit.js');
const grabFn = re => { const m = kit.match(re); if (!m) throw new Error('kit.js changed: ' + re); return m[0]; };
vm.runInContext([grabFn(/function glyphOf\(ch\)[^\n]*\n/), grabFn(/const dotGap = [^\n]*\n/), grabFn(/function measure\(str, cap[^\n]*\n[^\n]*\n\}/), 'this.measure = measure;'].join('\n'), ctx);
vm.runInContext(read('content.js') + '\nthis.CONTENT = window.CONTENT;', ctx);
const { CONTENT, measure, FONT_EMS_TECH } = ctx;
const G = FONT_EMS_TECH.glyphs;
const SAMPLE = { name: 'Alexandra', slug: 'alexandra', n: '9' };   // placeholders for coverage and widths
const fillIn = s => String(s).replace(/\{(\w+)\}/g, (m, k) => SAMPLE[k] ?? m);

// 1. every CONTENT.drawn string is covered by the font
{
  const strings = []; const collect = (v, k) => { if (typeof v === 'string') strings.push([k, v]); else if (Array.isArray(v)) v.forEach((x, i) => collect(x, `${k}[${i}]`)); else if (v && typeof v === 'object') for (const [kk, x] of Object.entries(v)) if (kk !== 'colors') collect(x, `${k}.${kk}`); };
  collect(CONTENT.drawn, 'drawn');
  const missing = strings.flatMap(([k, s]) => [...fillIn(s)].filter(ch => !G[ch]).map(ch => `${k}: '${ch}' U+${ch.codePointAt(0).toString(16)}`));
  missing.length ? fail('font covers CONTENT.drawn', missing.join('; ')) : ok('font covers CONTENT.drawn', `${strings.length} strings`);
}
// 2. widths: captions <= 1760 at cap 46; rows <= 540 (cap 38, condense .82, stageB rows); slips <= SLIP_MAX
{
  const bad = [];
  for (const [id, c] of Object.entries(CONTENT.drawn.captions)) for (const l of c.lines) { const w = measure(fillIn(l), 46, 0, 1); if (w > 1760) bad.push(`caption ${id} "${l}" ${w.toFixed(0)}`); }
  const rows = [...CONTENT.drawn.rows, ...Object.values(CONTENT.drawn.rowsReject)];
  for (const r of rows) { const w = measure(r, 38, 0, .82); if (w > 540) bad.push(`row "${r}" ${w.toFixed(0)}`); }
  // a slip is text + 64 wide at cap 36 / condense .82 (cast.js:198 slipDrawing); a8's slips are 477 (SB.slipW),
  // 'email_customer' needs 510, so the budget is 520 (see the foundation report)
  const SLIP_MAX = 520;
  for (const [k, s] of Object.entries(CONTENT.drawn.slips)) { const w = measure(s, 36, 0, .82) + 64; if (w > SLIP_MAX) bad.push(`slip ${k} "${s}" ${w.toFixed(0)}`); }
  const e = CONTENT.drawn.end, m = CONTENT.drawn.mail, st = CONTENT.drawn.start;
  for (const [k, s, cap, max] of [['end.plugs', e.plugs, 46, 1760], ['end.once', e.once.text, 46, 1760], ['end.noMoney', e.noMoney, 46, 1760], ['start.title', st.title, 72, 1760], ['start.sub', st.sub, 46, 1760]]) {
    const w = measure(fillIn(s), cap, 0, 1); if (w > max) bad.push(`${k} "${s}" ${w.toFixed(0)} > ${max}`); }
  // the refund email page (cloned from D.requested, page lettering cap 36 / condense .86): mail.lines, each
  // inside the display's text column (880 of its 960). lines[0] carries the name: NAME.BUDGET.mail gives the
  // name alone 880 - width("Hi ,"), so here the sample name must fit too.
  if (!Array.isArray(m.lines) || m.lines.length !== 2 || !m.lines[0].includes('{name}')) bad.push('mail.lines: two lines, the name in the first');
  else for (const line of m.lines) { const w = measure(fillIn(line), 36, 0, .86); if (w > 880) bad.push(`mail line "${fillIn(line)}" ${w.toFixed(0)} > 880`); }
  bad.length ? fail('widths fit the budgets', bad.join('; ')) : ok('widths fit the budgets');
}
// 3. captions: <= 2 lines, about 10 words (fail above 12)
{
  const bad = [], warn = [];
  for (const [id, c] of Object.entries(CONTENT.drawn.captions)) { const words = c.lines.join(' ').trim().split(/\s+/).length;
    if (!c.lines.length || c.lines.length > 2) bad.push(`${id}: ${c.lines.length} lines`); if (words > 12) bad.push(`${id}: ${words} words`); else if (words > 10) warn.push(`${id}: ${words} words`); }
  bad.length ? fail('captions: <= 2 lines, ~10 words', bad.join('; ')) : ok('captions: <= 2 lines, ~10 words', warn.join('; '));
}
// 3b. panel texts: the shape (ifPlug keyed by crash class per stage, outcome per outcome caption), then
// whether the content writer has written them yet
{
  const P = CONTENT.html.panel, CLS = [['any'], ['any'], ['any'], ['before', 'after'], ['before', 'after'], ['before', 'after'], ['wait', 'after'], ['before', 'money', 'after'], ['before', 'after'], ['any']];
  const shape = [];
  if (!Array.isArray(P.ifPlug) || P.ifPlug.length !== 10) shape.push('ifPlug: 10 stages');
  else P.ifPlug.forEach((o, i) => { const k = Object.keys(o ?? {}).sort().join(','); if (k !== CLS[i].slice().sort().join(',')) shape.push(`ifPlug[${i}] keys ${k} (want ${CLS[i].join(',')})`); });
  const outs = Object.keys(CONTENT.drawn.captions).filter(k => /^out/.test(k)), miss = outs.filter(k => !P.outcome?.[k]);
  if (miss.length) shape.push('panel.outcome missing ' + miss.join(','));
  if (CONTENT.html.events.waiting) shape.push('events.waiting is a note, not an event (panel.waitNote)');
  shape.length ? fail('panel text shape', shape.join('; ')) : ok('panel text shape', `ifPlug by crash class, ${outs.length} outcomes`);
  const empty = [...P.now.map((s, i) => (s ? null : `now[${i}]`)), ...P.ifPlug.flatMap((o, i) => Object.entries(o ?? {}).map(([k, s]) => (s ? null : `ifPlug[${i}].${k}`))),
    ...Object.entries(P.outcome ?? {}).map(([k, o]) => (o.text ? null : `outcome.${k}`))].filter(Boolean);
  empty.length ? skip('panel texts written', `not written yet: ${empty.length}`) : ok('panel texts written');
}
// 3c. the name limit: NAME.MAX (game/name.js) is the number CONTENT.html.name.invalid.long states
{
  const max = read('game/name.js').match(/const MAX = (\d+);/)?.[1], msg = CONTENT.html.name.invalid.long;
  max && new RegExp(`\\b${max}\\b`).test(msg) ? ok('name limit matches its message', `${max} graphemes`) : fail('name limit matches its message', `MAX ${max}, message "${msg}"`);
}
// 4. no file or folder name starting with _ or ., no .md files (Jekyll is on)
{
  const bad = files.filter(f => /^[_.]/.test(path.basename(f)) || f.endsWith('.md')).map(rel);
  bad.length ? fail('names: no _ or . prefix, no .md', bad.join(', ')) : ok('names: no _ or . prefix, no .md', `${files.length} entries`);
}
// 5. index.html: CSP meta first in <head>, then referrer; every script / css has the same ?v=; defer; load order
const html = read('index.html');
{
  const head = html.match(/<head>([\s\S]*?)<\/head>/i)?.[1] ?? '', firstTag = head.match(/<[a-z][^>]*>/i)?.[0] ?? '';
  const csp = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'none'; font-src 'none'; media-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; worker-src 'none'; manifest-src 'none'";
  if (!/http-equiv="Content-Security-Policy"/i.test(firstTag)) fail('CSP meta first in <head>', firstTag);
  else if (!firstTag.includes(`content="${csp}"`)) fail('CSP meta first in <head>', 'policy differs from GAME_SPEC §9');
  else ok('CSP meta first in <head>');
  const second = head.match(/<[a-z][^>]*>/gi)?.[1] ?? ''; /name="referrer" content="no-referrer"/.test(second) ? ok('referrer meta second') : fail('referrer meta second', second);
  /<link rel="icon" href="data:/.test(head) ? ok('data: favicon') : fail('data: favicon', 'missing');
  const urls = [...html.matchAll(/<(?:script|link)[^>]*?(?:src|href)="([^"]+)"/g)].map(m => m[1]).filter(u => !u.startsWith('data:'));
  const vs = new Set(urls.map(u => u.match(/\?v=(\w+)$/)?.[1] ?? 'none'));
  vs.size === 1 && !vs.has('none') ? ok('one ?v= on every script and css', `v=${[...vs][0]}, ${urls.length} urls`) : fail('one ?v= on every script and css', [...vs].join(','));
  const scripts = [...html.matchAll(/<script([^>]*)>/g)].map(m => m[1]);
  scripts.every(a => /\sdefer\b/.test(a) && /\ssrc="/.test(a)) ? ok('scripts are defer + src') : fail('scripts are defer + src', 'inline or non-defer script');
  const order = ['content.js', 'engine/core.js', 'engine/studio.js', 'engine/cels.js', 'engine/font-emstech.js', 'engine/logos.js', 'engine/kit.js', 'engine/cast.js', 'engine/stageB.js', 'engine/agent.js', 'engine/stageC.js', 'engine/stageD.js', 'game/boot.js', 'film/a1.js', 'film/a2.js', 'film/a3.js', 'game/name.js', 'game/shop.js', 'game/room.js', 'game/cards.js', 'game/sfx.js', 'game/story.js', 'game/ui.js', 'game/runtime.js'];
  const got = urls.filter(u => u.includes('.js')).map(u => u.replace(/\?.*$/, ''));
  JSON.stringify(got) === JSON.stringify(order) ? ok('script load order (GAME_SPEC §2)') : fail('script load order (GAME_SPEC §2)', got.join(' '));
  const missingFiles = got.concat(urls.filter(u => u.includes('.css')).map(u => u.replace(/\?.*$/, ''))).filter(u => !fs.existsSync(path.join(MAP, u)));
  missingFiles.length ? fail('every referenced file exists', missingFiles.join(', ')) : ok('every referenced file exists');
  /(src|href)="\//.test(html) ? fail('relative paths only', 'a root-relative path') : ok('relative paths only');
  // the no-JS fallback texts in the markup equal CONTENT.html (content.js stays the one source of text)
  const H = CONTENT.html, dec = t => t.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  const pairs = [['<title>', html.match(/<title>([^<]*)<\/title>/)?.[1], H.title], ['<h1>', html.match(/<h1[^>]*>([^<]*)<\/h1>/)?.[1], H.title],
    ['meta description', html.match(/<meta name="description" content="([^"]*)"/)?.[1], H.description], ['#footer-text', html.match(/<p id="footer-text">([^<]*)<\/p>/)?.[1], H.footer.text],
    ['#footer-lic', html.match(/<a id="footer-lic"[^>]*>([^<]*)<\/a>/)?.[1], H.footer.licences], ['<noscript>', html.match(/<noscript><p[^>]*>([^<]*)<\/p><\/noscript>/)?.[1], H.noscript]];
  const diff = pairs.filter(([, a, b]) => a === undefined || dec(a) !== b).map(([k, a]) => `${k}: "${a}"`);
  const labels = [...html.matchAll(/aria-label="([^"]*)"/g)].map(m => m[1]);
  if (labels.length) diff.push('hard-coded aria-label: ' + labels.join(', '));
  diff.length ? fail('markup texts equal CONTENT.html', diff.join('; ')) : ok('markup texts equal CONTENT.html', `${pairs.length} fallbacks`);
}
// 6. no http(s) loads anywhere in docs/map (navigation links <a href> are allowed)
{
  const bad = [];
  const htmlLoads = [...html.matchAll(/<(?!a\s)[a-z]+[^>]*\s(?:src|href|srcset|data|poster)="(https?:)?\/\//gi)].map(m => m[0]);
  bad.push(...htmlLoads);
  for (const f of files.filter(f => f.endsWith('.css'))) { if (/url\(\s*['"]?(https?:)?\/\//i.test(fs.readFileSync(f, 'utf8')) || /@import/i.test(fs.readFileSync(f, 'utf8'))) bad.push(rel(f) + ': url()/@import'); }
  for (const f of codeJs) { const s = noComments(fs.readFileSync(f, 'utf8'));
    for (const re of [/\bfetch\s*\(/, /XMLHttpRequest/, /new\s+WebSocket/, /EventSource/, /sendBeacon/, /\bimport\s*\(/, /new\s+Image\s*\(/, /\.src\s*=/, /new\s+Worker/]) if (re.test(s)) { if (rel(f) === 'engine/core.js' && /Image|src/.test(re.source)) continue; /* registerPhoto (core.js), never called: checked below */ bad.push(`${rel(f)}: ${re.source}`); } }
  for (const f of jsFiles.filter(f => rel(f) !== 'engine/core.js')) if (/registerPhoto\s*\(/.test(noComments(fs.readFileSync(f, 'utf8')))) bad.push(`${rel(f)}: registerPhoto (loads images)`);
  bad.length ? fail('no http(s) or network loads', bad.join('; ')) : ok('no http(s) or network loads');
}
// 7. forbidden APIs and inline code (GAME_SPEC §9)
{
  const bad = [];
  if (/<script(?![^>]*\ssrc=)[^>]*>/i.test(html)) bad.push('index.html: inline <script>');
  if (/<style[\s>]/i.test(html)) bad.push('index.html: <style>');
  if (/\sstyle\s*=/i.test(html)) bad.push('index.html: style attribute');
  if (/\son[a-z]+\s*=/i.test(html)) bad.push('index.html: inline event handler');
  for (const f of codeJs) { const s = noComments(fs.readFileSync(f, 'utf8'));
    for (const [re, what] of [[/\beval\s*\(/, 'eval'], [/new\s+Function\b/, 'new Function'], [/document\.write/, 'document.write'], [/\.innerHTML\b/, 'innerHTML'], [/\.outerHTML\b/, 'outerHTML'], [/insertAdjacentHTML/, 'insertAdjacentHTML'],
      [/setAttribute\(\s*['"]style['"]/, "setAttribute('style')"], [/setTimeout\(\s*['"`]/, 'setTimeout(string)'], [/document\.title\s*=/, 'document.title ='],
      [/\(\?<[=!]/, 'regex lookbehind (SyntaxError before Safari 16.4)']])
      if (re.test(s)) bad.push(`${rel(f)}: ${what}`);
    if (rel(f) !== 'game/boot.js' && /URLSearchParams|location\.search|location\.hash/.test(s)) bad.push(`${rel(f)}: reads the URL (only game/boot.js may)`);
  }
  bad.length ? fail('no forbidden APIs', bad.join('; ')) : ok('no forbidden APIs', `${codeJs.length} js files`);
}
// 8. licences and logos
{
  const need = ['licenses/NOTICE.txt', 'licenses/engine-MIT.txt', 'licenses/OFL-1.1-EMSTech.txt', 'licenses/EMSTech-metadata.txt', 'licenses/hersheytext-MIT.txt'];
  const miss = need.filter(f => !fs.existsSync(path.join(MAP, f)));
  miss.length ? fail('licence files exist', miss.join(', ')) : ok('licence files exist');
  /Alexey Fateev/.test(read('licenses/engine-MIT.txt')) ? ok('engine MIT names Alexey Fateev') : fail('engine MIT names Alexey Fateev', 'missing');
  /Kimberly Geswein/.test(read('engine/font-emstech.js').split('\n').slice(0, 8).join('\n')) && /OFL-1\.1-EMSTech\.txt/.test(read('engine/font-emstech.js').slice(0, 800)) ? ok('font header: Geswein copyright + OFL') : fail('font header: Geswein copyright + OFL', 'missing');
  /not affiliated with or endorsed by either/.test(read('licenses/NOTICE.txt')) ? ok('trademark line in NOTICE.txt') : fail('trademark line in NOTICE.txt', 'missing');
  const lc = { }; vm.createContext(lc); vm.runInContext(read('engine/logos.js') + '\nthis.K = Object.keys(LOGO_DATA);', lc);
  const keys = [...lc.K].sort().join(','); keys === 'claude,temporal' ? ok('logos: temporal and claude only') : fail('logos: temporal and claude only', keys);
}
// 9. copies: unchanged files equal the film's (after the first-line comment); patched files list their patches
{
  if (!fs.existsSync(FILM)) skip('copies match temporal-film', 'film repo not found at ' + FILM);
  else {
    const bad = [];
    for (const [dst, src] of [['engine/studio.js', 'studio.js'], ['engine/cels.js', 'cels.js'], ['engine/cast.js', 'cast.js'], ['engine/stageB.js', 'stageB.js'], ['engine/stageC.js', 'stageC.js'], ['engine/stageD.js', 'stageD.js'], ['film/a1.js', 'scenes2/a1.js'], ['film/a2.js', 'scenes2/a2.js'], ['film/a3.js', 'scenes2/a3.js']]) {
      const d = read(dst), first = d.split('\n')[0];
      if (first !== `// Copied from temporal-film (${src}), unmodified.`) bad.push(`${dst}: first line`);
      if (d.slice(first.length + 1) !== fs.readFileSync(path.join(FILM, src), 'utf8')) bad.push(`${dst}: differs from ${src}`);
    }
    bad.length ? fail('copies match temporal-film', bad.join('; ')) : ok('copies match temporal-film', '9 unchanged files');
  }
  const patched = ['engine/core.js', 'engine/kit.js', 'engine/logos.js', 'engine/font-emstech.js', 'engine/agent.js'].filter(f => !/^\/\/ Copied from temporal-film \([^)]+\), with (one patch|patches)/.test(read(f)));
  patched.length ? fail('patched files start with a patch header', patched.join(', ')) : ok('patched files start with a patch header');
}

const w = Math.max(...results.map(r => r[1].length));
for (const [s, n, d] of results) console.log(`${s.padEnd(4)}  ${n.padEnd(w)}  ${d}`);
const nf = results.filter(r => r[0] === 'FAIL').length;
console.log(`\n${results.length} checks: ${results.filter(r => r[0] === 'PASS').length} pass, ${nf} fail, ${results.filter(r => r[0] === 'SKIP').length} skip`);
process.exit(nf ? 1 : 0);
