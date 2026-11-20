#!/usr/bin/env node
/* Drive the BUILT page in Chromium and check what only a browser can answer.
 *
 * shelf.test.mjs covers the rules and verify.mjs the seam between the data,
 * the markup and the script. Neither sees the page laid out or a control
 * used. This does: the row of spines is wider than a phone and must scroll
 * inside the shelf without widening the page, the lettering on every spine
 * has to fit it, a chip has to narrow the list and dim the spines it leaves
 * out, a dimmed spine still has to lead to its row, and controls the browser
 * restores after a trip through history must still describe the list.
 * Checked in both colour schemes at 320, 390, 768 and 1280 px.
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
import { arrange, summarize } from '../src/shelf.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = process.env.OUT_DIR
  ? path.resolve(process.env.OUT_DIR)
  : path.join(root, '..', 'dist', path.basename(root));
if (!fs.existsSync(path.join(dist, 'index.html'))) {
  console.error(`no build at ${dist}; run scripts/build.mjs first`); process.exit(2);
}
const { discs } = JSON.parse(fs.readFileSync(path.join(root, 'data/data.json'), 'utf8'));
const sum = summarize(discs);

const require = createRequire(import.meta.url);
let chromium;
for (const p of ['/opt/node22/lib/node_modules/playwright', 'playwright']) {
  try { ({ chromium } = require(p)); break; } catch {}
}
if (!chromium) { console.error('playwright not found'); process.exit(2); }

/* The build is served under /bluray/, as it is deployed, and /elsewhere/ is a
   second page to leave for and come back from. */
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const server = http.createServer((req, res) => {
  const p = decodeURIComponent(req.url.split('?')[0].split('#')[0]);
  if (p === '/elsewhere/') {
    res.writeHead(200, { 'content-type': 'text/html' });
    return res.end('<!doctype html><title>elsewhere</title><p>elsewhere</p>');
  }
  const f = path.join(dist, p.replace(/^\/bluray\//, '/').replace(/\/$/, '/index.html'));
  if (!p.startsWith('/bluray/') || !f.startsWith(dist) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); }
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
  // A spine that cannot be clicked is a finding, not a reason to wait.
  ctx.setDefaultTimeout(5000);
  const page = await ctx.newPage();
  page.on('pageerror', e => pageErrors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') pageErrors.push(m.text()); });
  await page.goto(`${origin}/bluray/`);
  await page.waitForFunction(() => !document.getElementById('controls').hidden);
  return { ctx, page };
}

const shownRows = page => page.$$eval('#list > li', els => els.filter(e => !e.hidden).map(e => e.dataset.id));
const litSpines = page => page.$$eval('#spines a', els => els.filter(e => !e.classList.contains('off')).map(e => e.dataset.id));
const ids = list => list.map(d => d.id);
const same = (a, b) => a.join() === b.join();

/* A step that throws (a spine that cannot be reached, say) is reported with
   whatever was found before it, instead of taking the findings down with it. */
try {

/* ---- layout, at every width in both schemes ---- */
for (const colorScheme of ['light', 'dark']) {
  for (const width of [320, 390, 768, 1280]) {
    const at = `${width}px ${colorScheme}`;
    const { ctx, page } = await open({ viewport: { width, height: 800 }, colorScheme });

    const m = await page.evaluate(() => {
      const doc = document.documentElement;
      const strip = document.getElementById('spines');
      const box = e => e.getBoundingClientRect();
      const spines = [...strip.querySelectorAll('a')];
      return {
        pageWide: doc.scrollWidth - doc.clientWidth,
        stripOverflow: strip.scrollWidth - strip.clientWidth,
        stripLeft: box(strip).left, firstLeft: box(spines[0]).left,
        clipped: spines.filter(a => {
          const t = a.querySelector('.t');
          return t.scrollHeight > t.clientHeight + 1 || t.scrollWidth > t.clientWidth + 1;
        }).map(a => a.dataset.id),
        thin: spines.filter(a => box(a).width < 30 || box(a).height < 200).map(a => a.dataset.id),
        tiny: spines.filter(a => parseFloat(getComputedStyle(a.querySelector('.t')).fontSize) < 8.5).map(a => a.dataset.id),
        wideRows: [...document.querySelectorAll('#list > li')].filter(li => box(li).right > doc.clientWidth + 0.5).length,
        badges: [...document.querySelectorAll('.fmt')].filter(b => box(b).right > doc.clientWidth - 8).length,
        bodyBg: getComputedStyle(document.body).backgroundColor,
      };
    });
    check(m.pageWide <= 0, `${at}: the page scrolls sideways`, `${m.pageWide}px`);
    check(m.clipped.length === 0, `${at}: spine lettering is cut off`, m.clipped.join(', '));
    check(m.thin.length === 0, `${at}: a spine is drawn too small to read`, m.thin.join(', '));
    check(m.tiny.length === 0, `${at}: spine lettering is under 8.5px`, m.tiny.join(', '));
    check(m.wideRows === 0, `${at}: a list row runs past the edge of the page`, String(m.wideRows));
    check(m.badges === 0, `${at}: a format badge touches the edge of the page`, String(m.badges));
    // The first spine must be reachable: centring an overflowing row would put it off the left edge.
    check(m.firstLeft >= m.stripLeft, `${at}: the first spine starts off the left edge of the shelf`);
    // This collection fits a tablet and up; on a phone it scrolls inside the shelf.
    if (width <= 390) check(m.stripOverflow > 0, `${at}: expected the row of spines to scroll inside the shelf`);
    if (width >= 768) check(m.stripOverflow <= 0, `${at}: the row of spines does not fit the shelf`, `${m.stripOverflow}px over`);
    const dark = m.bodyBg.match(/\d+/g).slice(0, 3).reduce((a, n) => a + Number(n), 0) < 200;
    check(dark === (colorScheme === 'dark'), `${at}: the page did not take the ${colorScheme} palette`, m.bodyBg);

    // The last spine can be scrolled fully into view.
    const lastVisible = await page.evaluate(() => {
      const strip = document.getElementById('spines');
      strip.scrollLeft = strip.scrollWidth;
      const r = strip.querySelector('li:last-child a').getBoundingClientRect();
      return r.right <= strip.getBoundingClientRect().right + 0.5;
    });
    check(lastVisible, `${at}: the last spine cannot be scrolled into view`);
    await ctx.close();
  }
}

/* ---- the controls ---- */
{
  const { ctx, page } = await open({ viewport: { width: 390, height: 844 } });
  const everything = ids(discs);
  check(same(await shownRows(page), everything), 'the list does not open on everything, as shelved');
  check(same(await litSpines(page), everything), 'a spine is dimmed before any chip is chosen');
  check((await page.textContent('#tally')).includes(`All ${discs.length}`), 'the tally does not open on the whole count');

  for (const show of Object.keys(sum.shows).filter(s => s !== 'all' && sum.shows[s] > 0)) {
    await page.check(`input[name="show"][value="${show}"]`, { force: true });
    const want = ids(arrange(discs, { show }));
    check(same(await shownRows(page), want), `the "${show}" chip does not show what arrange() gives`);
    check(same(await litSpines(page), want), `the "${show}" chip does not dim the other spines`);
    check((await page.textContent('#tally')).startsWith(`${want.length} of ${discs.length}`), `the tally is wrong under "${show}"`);
    const label = await page.textContent(`input[name="show"][value="${show}"] + span b`);
    check(Number(label) === want.length, `the "${show}" chip is labelled ${label} and shows ${want.length}`);
  }

  // Every order, under a chip and under everything; the spines never move.
  for (const show of ['all', '4k']) {
    await page.check(`input[name="show"][value="${show}"]`, { force: true });
    for (const sort of ['title', 'oldest', 'newest', 'shelf']) {
      await page.selectOption('#sort', sort);
      check(same(await shownRows(page), ids(arrange(discs, { show, sort }))), `order "${sort}" under "${show}" is not what arrange() gives`);
    }
  }
  check(same(await page.$$eval('#spines a', els => els.map(e => e.dataset.id)), everything), 'the spines left shelf order');

  // A dimmed spine still leads somewhere: the chips reset and its row is shown and targeted.
  const hidden = discs.find(d => d.format !== '4K UHD');
  if (hidden) {
    await page.check('input[name="show"][value="4k"]', { force: true });
    await page.selectOption('#sort', 'title');
    await page.evaluate(id => document.querySelector(`#spines a[data-id="${id}"]`).scrollIntoView({ inline: 'center' }), hidden.id);
    await page.click(`#spines a[data-id="${hidden.id}"]`);
    check(await page.isChecked('input[name="show"][value="all"]'), 'a dimmed spine did not put the chips back on Everything');
    check(await page.$eval(`#d-${hidden.id}`, e => !e.hidden && e.matches(':target')), 'a dimmed spine did not reveal and target its row');
    check((await page.inputValue('#sort')) === 'title', 'following a spine changed the order');
    const r = await page.$eval(`#d-${hidden.id}`, e => { const b = e.getBoundingClientRect(); return b.top >= 0 && b.top < innerHeight; });
    check(r, 'the row a spine leads to is not scrolled into view');
  }

  // Keyboard: the chips are one radio group, reachable and operable without a pointer.
  await page.focus('input[name="show"][value="all"]');
  await page.keyboard.press('ArrowRight');
  check(await page.isChecked('input[name="show"][value="4k"]'), 'the arrow keys do not move between chips');
  check(same(await shownRows(page), ids(arrange(discs, { show: '4k', sort: 'title' }))), 'a chip chosen by keyboard does not narrow the list');
  await ctx.close();
}

/* ---- controls restored by the browser still describe the list ---- */
{
  const { ctx, page } = await open({ viewport: { width: 1280, height: 800 } });
  await page.check('input[name="show"][value="bluray"]', { force: true });
  await page.selectOption('#sort', 'newest');
  await page.goto(`${origin}/elsewhere/`);
  await page.goBack();
  await page.waitForFunction(() => !document.getElementById('controls').hidden);
  const state = await page.evaluate(() => {
    const f = document.getElementById('controls');
    return { show: f.elements.show.value, sort: f.elements.sort.value };
  });
  check(same(await shownRows(page), ids(arrange(discs, state))),
    'after going back, the list does not match the controls', JSON.stringify(state));
  check(same(await litSpines(page), ids(arrange(discs, { show: state.show }))),
    'after going back, the dimmed spines do not match the chips', JSON.stringify(state));
  await ctx.close();
}

/* ---- without JavaScript the page is still the whole list ---- */
{
  const ctx = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await page.goto(`${origin}/bluray/`);
  check(same(await shownRows(page), ids(discs)), 'without JavaScript the list is not the whole shelf');
  check(await page.$eval('#controls', e => e.getBoundingClientRect().height === 0), 'without JavaScript the dead controls are visible');
  check((await page.$$('#spines a')).length === discs.length, 'without JavaScript the spines are missing');
  await ctx.close();
}

} catch (e) {
  check(false, 'a step could not be carried out', String(e.message).split('\n')[0]);
}

await browser.close();
server.close();

check(pageErrors.length === 0, 'the page logged errors', pageErrors.join(' | '));
if (failures.length) {
  console.error(`Browser check FAILED (${failures.length} of ${checks}):`);
  for (const f of failures) console.error('  ✗ ' + f);
  process.exit(1);
}
console.log(`Browser check passed (${checks} checks).`);
