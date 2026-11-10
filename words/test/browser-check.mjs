#!/usr/bin/env node
/* Drive the BUILT page in Chromium and check what only a browser can answer.
 *
 * count.test.mjs covers the counting rules and verify.mjs the seam between
 * the markup and the script. Neither sees the page run, and the page's own
 * faults have all lived there: figures left describing the sample after the
 * browser restored the viewer's text, buttons that destroyed a draft with no
 * way back, and one long word pushing the whole page sideways. This checks
 * each of those, in both colour schemes and at 320, 390, 768 and 1280 px.
 *
 * Needs Chromium via Playwright (installed on the dev box, not in CI):
 *   node scripts/build.mjs && node test/browser-check.mjs
 * OUT_DIR names the build to drive, as it does for build.mjs and verify.mjs;
 * the check only reads it.
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = process.env.OUT_DIR
  ? path.resolve(process.env.OUT_DIR)
  : path.join(root, '..', 'dist', path.basename(root));
if (!fs.existsSync(path.join(dist, 'index.html'))) {
  console.error(`no build at ${dist}; run scripts/build.mjs first`); process.exit(2);
}

const require = createRequire(import.meta.url);
let chromium;
for (const p of ['/opt/node22/lib/node_modules/playwright', 'playwright']) {
  try { ({ chromium } = require(p)); break; } catch {}
}
if (!chromium) { console.error('playwright not found'); process.exit(2); }

/* The build is served under /words/, as it is deployed, and /elsewhere/ is a
   second page to leave for and come back from. */
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const server = http.createServer((req, res) => {
  const p = decodeURIComponent(req.url.split('?')[0].split('#')[0]);
  if (p === '/elsewhere/') {
    res.writeHead(200, { 'content-type': 'text/html' });
    return res.end('<!doctype html><title>elsewhere</title><p>elsewhere</p>');
  }
  const f = path.join(dist, p.replace(/^\/words\//, '/').replace(/\/$/, '/index.html'));
  if (!p.startsWith('/words/') || !f.startsWith(dist) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
await new Promise(r => server.listen(0, r));
const origin = `http://localhost:${server.address().port}`;

const failures = [];
let checks = 0;
const check = (ok, msg, detail = '') => { checks++; if (!ok) failures.push(detail ? `${msg} :: ${detail}` : msg); };

const browser = await chromium.launch();
const pageErrors = [];
async function open(opts) {
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage();
  page.on('pageerror', e => pageErrors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') pageErrors.push(m.text()); });
  await page.goto(`${origin}/words/`);
  await page.waitForTimeout(150);
  return { ctx, page };
}
const slot = (page, id) => page.textContent('#' + id);
const box = page => page.inputValue('#text');
const sample = page => page.evaluate(() => JSON.parse(document.getElementById('config').textContent).sample.text);
const desktop = { viewport: { width: 1280, height: 900 } };

/* ---- the counts always describe the text in the box ------------------ */
{
  const { ctx, page } = await open(desktop);
  check(await slot(page, 's-words') !== '—' && /sample/.test(await slot(page, 'status')), 'opens on the sample, counted, with its notice');
  await page.click('#text'); await page.keyboard.press('Control+A'); await page.keyboard.type('F');
  check(await slot(page, 'status') === '', 'the sample notice goes on the first keystroke');
  await page.keyboard.type('our words of mine.');
  await page.goto(`${origin}/elsewhere/`);
  await page.goBack(); await page.waitForTimeout(500);
  /* Whichever text the browser brings back, the figures and the notice must be about it. */
  const text = await box(page), isSample = text === await sample(page);
  const expected = isSample ? null : String(text.split(/\s+/).filter(Boolean).length);
  check(isSample || await slot(page, 's-words') === expected, 'after going back the word count is for the text in the box',
    `box ${JSON.stringify(text.slice(0, 30))}, words ${await slot(page, 's-words')}`);
  check(isSample || await slot(page, 'status') === '', 'after going back the sample notice is not shown over the viewer\'s text');
  await ctx.close();
}

/* ---- Clear, Load sample and Paste can be undone ---------------------- */
{
  const { ctx, page } = await open({ ...desktop, permissions: ['clipboard-read', 'clipboard-write'] });
  const bg = id => page.evaluate(i => getComputedStyle(document.getElementById(i)).backgroundColor, id);
  check(await bg('clear-btn') === await bg('sample-btn'), 'Clear is drawn like the other buttons');

  const draft = 'My own draft that took an hour to write.';
  await page.click('#text'); await page.keyboard.press('Control+A'); await page.keyboard.type(draft);
  await page.click('#clear-btn');
  check(await box(page) === '' && await slot(page, 's-words') === '0', 'Clear empties the box and the counts');
  await page.keyboard.press('Control+Z'); await page.waitForTimeout(80);
  check(await box(page) === draft && await slot(page, 's-words') === '9', 'Ctrl+Z after Clear brings the draft and its counts back', await box(page));

  await page.click('#sample-btn');
  check(await box(page) === await sample(page), 'Load sample loads the configured passage exactly');
  await page.click('#text'); await page.keyboard.press('Control+Z'); await page.waitForTimeout(80);
  check(await box(page) === draft, 'Ctrl+Z after Load sample brings the draft back', await box(page));

  await page.evaluate(() => navigator.clipboard.writeText('PASTED\r\nline two'));
  await page.evaluate(() => { const t = document.getElementById('text'); t.focus(); t.setSelectionRange(7, 12); });
  await page.click('#paste-btn'); await page.waitForTimeout(150);
  check(await box(page) === 'My own PASTED\nline two that took an hour to write.', 'Paste goes in at the caret, over the selection', JSON.stringify(await box(page)));
  check(await slot(page, 's-words') === '11' && await slot(page, 's-lines') === '2', 'the counts follow the paste');
  await page.click('#text'); await page.keyboard.press('Control+Z'); await page.waitForTimeout(80);
  check(await box(page) === draft, 'Ctrl+Z after Paste brings the text back', JSON.stringify(await box(page)));
  await page.evaluate(() => navigator.clipboard.writeText(''));
  await page.click('#paste-btn'); await page.waitForTimeout(150);
  check(await box(page) === draft, 'an empty clipboard changes nothing');
  await ctx.close();

  const fresh = await open({ ...desktop, permissions: ['clipboard-read', 'clipboard-write'] });
  await fresh.page.evaluate(() => navigator.clipboard.writeText('Only my words.'));
  await fresh.page.click('#paste-btn'); await fresh.page.waitForTimeout(150);
  check(await box(fresh.page) === 'Only my words.' && await slot(fresh.page, 's-words') === '3', 'Paste over the untouched sample replaces it');
  await fresh.ctx.close();

  /* A browser without the editing command still gets working buttons, and is
     not told about an undo it does not have. */
  const plain = await open(desktop);
  await plain.page.evaluate(() => { document.execCommand = () => false; });
  await plain.page.click('#clear-btn');
  check(await box(plain.page) === '' && await slot(plain.page, 's-words') === '0' && await slot(plain.page, 'status') === 'Cleared.',
    'with the editing command refused, Clear still clears and promises no undo', await slot(plain.page, 'status'));
  await plain.page.click('#sample-btn');
  check(await box(plain.page) === await sample(plain.page) && !/undo/.test(await slot(plain.page, 'status')), 'with the editing command refused, Load sample still loads');
  await plain.ctx.close();
}

/* ---- no text can make the page scroll sideways ----------------------- */
const LONG = [
  ['a URL slug', 'Read https://example.com/blog/how-to-count-words-in-a-long-document-quickly today, then reply.'],
  ['German compounds', 'Die Donaudampfschifffahrtsgesellschaftskapitänswitwe kam. Rindfleischetikettierungsüberwachungsaufgabenübertragungsgesetz!'],
  ['a commit hash', 'commit 9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08 landed'],
  ['300 letters', 'x'.repeat(300)],
  ['long words repeated', 'Rindfleischetikettierungsüberwachungsaufgabenübertragungsgesetz '.repeat(3) + 'https://example.com/' + 'a'.repeat(200)],
  ['a seven-figure count', 'word '.repeat(1234567)],
];
for (const colorScheme of ['light', 'dark']) {
  for (const [width, height] of [[320, 568], [390, 844], [768, 1024], [1280, 900]]) {
    const { ctx, page } = await open({ viewport: { width, height }, colorScheme });
    for (const [label, text] of [['the sample', null], ...LONG]) {
      if (text) await page.fill('#text', text);
      const m = await page.evaluate(() => {
        const de = document.documentElement;
        const right = Math.max(...[...document.querySelectorAll('body *')].map(e => e.getBoundingClientRect().right));
        return { scroll: de.scrollWidth, client: de.clientWidth, right: Math.round(right) };
      });
      check(m.scroll <= m.client && m.right <= m.client, `${label} at ${width}px ${colorScheme}: nothing wider than the page`, JSON.stringify(m));
    }
    await ctx.close();
  }
}

/* ---- on a phone the word count stays in view ------------------------- */
for (const colorScheme of ['light', 'dark']) {
  for (const [width, height] of [[320, 568], [390, 844]]) {
    const at = `at ${width}x${height} ${colorScheme}`;
    const { ctx, page } = await open({ viewport: { width, height }, isMobile: true, hasTouch: true, colorScheme });
    const geo = () => page.evaluate(() => {
      const r = id => document.getElementById(id).getBoundingClientRect();
      return { count: { top: r('s-words').top, bottom: r('s-words').bottom }, boxTop: r('text').top, boxHeight: r('text').height, vh: innerHeight };
    });
    let g = await geo();
    check(g.count.top >= 0 && g.count.bottom <= g.vh && g.count.bottom < g.boxTop, `the count is on screen and above the box on load ${at}`, JSON.stringify(g));
    check(g.boxHeight <= 0.45 * height + 1, `the box leaves room for a keyboard ${at}`, `${g.boxHeight}px`);
    await page.tap('#text'); await page.keyboard.press('Control+A'); await page.keyboard.type('Typing on a phone now');
    g = await geo();
    check(g.count.top >= 0 && g.count.bottom <= g.vh && await slot(page, 's-words') === '5', `the count is on screen and current while typing ${at}`, JSON.stringify(g.count));
    for (const frac of [0.15, 0.4, 0.7]) {
      await page.evaluate(f => { const b = document.querySelector('.galley').getBoundingClientRect(); scrollTo(0, scrollY + b.top + b.height * f); }, frac);
      await page.waitForTimeout(60);
      g = await geo();
      check(g.count.top >= 0 && g.count.top < 12, `the count stays pinned while the figures scroll under it ${at}`, `top ${g.count.top}`);
    }
    /* A keyboard is not part of the emulation, so stand in for it: the screen
       loses its lower 45% and the box is brought back into what is left. */
    await page.setViewportSize({ width, height: Math.round(height * 0.55) });
    await page.evaluate(() => document.getElementById('text').scrollIntoView({ block: 'nearest' }));
    await page.waitForTimeout(60);
    g = await geo();
    check(g.count.top >= 0 && g.count.bottom <= g.vh && g.boxTop < g.vh, `count and box share what a keyboard leaves ${at}`, JSON.stringify(g));
    await ctx.close();
  }
}

/* ---- the page shows what the rules say -------------------------------- */
{
  const { ctx, page } = await open(desktop);
  const shown = async text => {
    await page.fill('#text', text);
    return page.evaluate(() => Object.fromEntries([...document.querySelectorAll('[id^="s-"]')].map(e => [e.id.slice(2), e.textContent])));
  };
  let s = await shown('नमस्ते दुनिया');
  check(s.words === '2' && s.longest === 'नमस्ते', 'Hindi words keep their vowel signs', JSON.stringify([s.words, s.longest]));
  s = await shown('It cost 1,234.56 dollars.');
  check(s.words === '4' && s.longest === '1,234.56', 'a number with separators is one word', JSON.stringify([s.words, s.longest]));
  s = await shown('She said, "Go." He went.');
  check(s.sentences === '2', 'a sentence may end inside quotes', s.sentences);
  s = await shown('. . . !!!');
  check(s.sentences === '0' && s['avg-sent'] === '0.0', 'bare punctuation is no sentence', s.sentences);
  await page.fill('#text', "It's fine. It’s fine. it’s");
  const top = await page.evaluate(() => [...document.querySelectorAll('.freq-row')].map(r => r.querySelector('.w').textContent + r.querySelector('.c').textContent));
  check(top[0] === "it's×3", 'most used words fold the curly apostrophe', JSON.stringify(top));
  check(!/\d{4}-\d\d-\d\dT/.test(await page.textContent('footer')), 'the footer carries no build stamp');
  await ctx.close();
}

check(pageErrors.length === 0, 'no console or page errors', pageErrors.join(' | '));

await browser.close();
server.close();
if (failures.length) {
  console.error(`${failures.length} of ${checks} browser checks FAILED:`);
  for (const f of failures) console.error('  ✗ ' + f);
  process.exit(1);
}
console.log(`Browser check passed (${checks} checks).`);
