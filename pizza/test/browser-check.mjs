#!/usr/bin/env node
/* Drive the BUILT page in Chromium and check what only a browser can answer.
 *
 * The unit tests cover the registry, the search rules and the palette, and
 * verify.mjs the seam between the markup, the data and the script. Neither
 * sees the directory run: one piece of state (which categories are on) that
 * has to show in three places at once, a search laid over it, a map that
 * loads late or not at all, and a pinned layout on a phone. This checks all
 * of that at 390, 1280 and 1920 px in both colour schemes, plus the page
 * without JavaScript, with the map's script refused, and the reader's own
 * location allowed nearby, allowed far away and refused.
 *
 * It builds its own copy of the site, from a scratch copy of the source in
 * which a few candidates are given coordinates (the queue has none until the
 * geocoder reaches it) and one has an accent in its name, so the checkout's
 * data is never touched. Map tiles cannot be fetched from here and are
 * answered with a blank image.
 *
 * Needs Chromium via Playwright (installed on the dev box, not in CI):
 *   node pizza/test/browser-check.mjs
 * SHOTS=<dir> also writes screenshots of the directory there.
 */
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { rankColor, CATEGORY_COLOR } from '../src/palette.js';
import { candidateIsShown } from '../src/census.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
let chromium;
for (const p of ['/opt/node22/lib/node_modules/playwright', 'playwright']) {
  try { ({ chromium } = require(p)); break; } catch {}
}
if (!chromium) { console.error('playwright not found'); process.exit(2); }

/* ---- a scratch copy of the site, built ---- */
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pizza-browser-'));
const site = path.join(tmp, 'pizza');
const dist = path.join(tmp, 'out', 'pizza');
for (const dir of ['build', 'data', 'scripts', 'src']) fs.cpSync(path.join(root, dir), path.join(site, dir), { recursive: true });
{
  const file = path.join(site, 'data/candidates.json');
  const queue = JSON.parse(fs.readFileSync(file, 'utf8'));
  // Coordinates for the first few listed candidates of each standing, spread
  // over the city, and two research-filed places, one with an accent.
  const seen = {};
  let n = 0;
  for (const c of queue.candidates) {
    if (!candidateIsShown(c) || c.lat != null) continue;
    const kind = c.verdict ?? c.status;
    if ((seen[kind] = (seen[kind] ?? 0) + 1) > 3) continue;
    c.lat = 47.54 + 0.012 * n;
    c.lon = -122.38 + 0.009 * (n % 7);
    n++;
  }
  queue.candidates.push(
    { key: 'cafe lago|2305', name: 'Café Lago', address: '2305 24th Ave E, Seattle, WA 98112', neighborhood: 'Montlake',
      sources: ['research'], status: 'rejected', verdict: 'not-pizza', resolvedDate: '2026-11-10',
      note: 'An Italian restaurant; wood-fired pizzas are one section of the menu.',
      resolutionSource: 'https://www.cafelago.example/menu', lat: 47.6395, lon: -122.3015 },
    { key: 'test pending|77', name: 'Zzyzx Test Slice Shop', address: '77 Yesler Way, Seattle, WA 98104',
      sources: ['kc-health'], lastInspection: '2026-10-30', status: 'pending', lat: 47.6017, lon: -122.3345 });
  fs.writeFileSync(file, JSON.stringify(queue, null, 2) + '\n');
}
{
  const built = spawnSync(process.execPath, [path.join(site, 'scripts/build.mjs')],
    { cwd: site, env: { ...process.env, OUT_DIR: dist, SNAPSHOT: '' }, encoding: 'utf8' });
  if (built.status !== 0) { console.error(`the scratch build failed:\n${built.stdout}${built.stderr}`); process.exit(2); }
}

/* The build is served under /pizza/, as it is deployed. */
const types = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  const p = decodeURIComponent(req.url.split('?')[0].split('#')[0]);
  const f = path.join(dist, p.replace(/^\/pizza\//, '/').replace(/\/$/, '/index.html'));
  if (!p.startsWith('/pizza/') || !f.startsWith(dist) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
await new Promise(r => server.listen(0, r));
const origin = `http://localhost:${server.address().port}`;

const failures = [];
let checks = 0;
const check = (ok, msg, detail = '') => { checks++; if (!ok) failures.push(detail ? `${msg} :: ${detail}` : msg); };
const shots = process.env.SHOTS ? path.resolve(process.env.SHOTS) : null;
if (shots) fs.mkdirSync(shots, { recursive: true });

const TILE = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/OXrfwAJmAPdYtRzVAAAAABJRU5ErkJggg==', 'base64');
const browser = await chromium.launch();
/* Console errors and uncaught exceptions, per page. A failed tile or a refused
 * script is logged by the browser itself, and the scenario that causes one
 * says so with `allow`. */
async function open(options = {}, { hash = '', allow = null, leaflet = true, init = null } = {}) {
  const ctx = await browser.newContext({ reducedMotion: 'reduce', ...options });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !(allow && allow.test(m.text()))) errors.push(m.text()); });
  await page.route(/tile\.openstreetmap\.org/, r => r.fulfill({ status: 200, contentType: 'image/png', body: TILE }));
  if (!leaflet) await page.route(/\/leaflet\.js/, r => r.abort());
  if (init) await page.addInitScript(init);
  await page.goto(`${origin}/pizza/${hash}`);
  return { ctx, page, errors };
}
const settle = (page, ms = 250) => page.waitForTimeout(ms);
/* Bring the directory to the top of the window and wait for the map. */
async function toDirectory(page, { map = true } = {}) {
  await page.evaluate(() => { const l = document.querySelector('.dir-layout'); scrollTo(0, l.getBoundingClientRect().top + scrollY - 60); });
  if (map) await page.waitForFunction(() => window.L && document.querySelector('#map .leaflet-overlay-pane svg'), null, { timeout: 8000 });
  await settle(page, 350);
}
/* What the directory is showing: per category whether it is open and how many
 * of its rows are drawn, the pins on the map against the pins those rows
 * should have, and whether anything is wider than the window. */
const read = page => page.evaluate(() => {
  // Drawn, not merely in the page: a row inside a closed <details> keeps its
  // box in Chromium, so its rectangles say nothing.
  const drawn = el => el.checkVisibility();
  const rows = [...document.querySelectorAll('#dir-list tr.dir-row, #dir-list tr.cq-row')];
  const showing = new Set(rows.filter(drawn).map(r => r.id));
  const groups = Object.fromEntries([...document.querySelectorAll('#dir-list details.dg')].map(d => [d.dataset.cat, {
    open: d.open, hidden: d.hidden || !drawn(d),
    rows: [...d.querySelectorAll('tr.dir-row, tr.cq-row')].filter(drawn).length,
    total: d.querySelectorAll('tr.dir-row, tr.cq-row').length,
    pressed: document.querySelector(`.cat-chip[data-cat="${d.dataset.cat}"]`)?.getAttribute('aria-pressed') === 'true',
    count: d.querySelector('.dg-n').textContent
  }]));
  const places = window.__PIZZA__.places;
  const paths = [...document.querySelectorAll('#map .leaflet-overlay-pane path')];
  const de = document.documentElement;
  return {
    groups,
    on: Object.keys(groups).filter(k => groups[k].open && !groups[k].hidden),
    rows: showing.size,
    wantPins: places.filter(p => showing.has(p.id)).reduce((n, p) => n + p.pts.length, 0),
    wantRings: places.filter(p => showing.has(p.id) && p.cat === 'ranked' && p.rank <= 10).reduce((n, p) => n + p.pts.length, 0),
    pins: paths.filter(p => p.classList.contains('leaflet-interactive')).length,
    rings: paths.filter(p => !p.classList.contains('leaflet-interactive')).length,
    status: document.getElementById('dir-status').textContent,
    // The page must not scroll sideways, and nothing in the directory may
    // reach past the window (the map's tiles and the sideways-scrolling row of
    // toggles are clipped by their own boxes and are not counted).
    overflow: de.scrollWidth - de.clientWidth,
    wider: Math.round(Math.max(...[...document.querySelectorAll('.dir-layout, #dir-list *, #dir-tools, #map, .dir-map-note')]
      .filter(drawn).map(e => e.getBoundingClientRect().right)) - de.clientWidth)
  };
});
/* Click a row where it has no link or button: scrolled clear of whatever is
 * pinned over the list first, since a click lands on what is on top. */
async function clickRow(page, id) {
  const at = await page.evaluate(rowId => {
    const row = document.getElementById(rowId);
    const cell = row.querySelector('.dir-score') ?? row.cells[row.cells.length - 1];
    scrollBy(0, cell.getBoundingClientRect().top - innerHeight * 0.8);
    const box = cell.getBoundingClientRect();
    return { x: box.left + box.width / 2, y: box.top + Math.min(box.height / 2, 14) };
  }, id);
  await page.mouse.click(at.x, at.y);
  await settle(page, 400);
}
const popup = page => page.evaluate(() => document.querySelector('#map .leaflet-popup-content')?.innerText ?? null);
/* Where the visible list begins: under the nav, and under the pinned map on a phone. */
const listTop = page => page.evaluate(() => {
  const pin = document.querySelector('.dir-pin');
  const stuck = pin && getComputedStyle(pin).position === 'sticky';
  return stuck ? pin.getBoundingClientRect().bottom : document.querySelector('.site-nav').getBoundingClientRect().bottom;
});

const SIZES = [[390, 844], [1280, 900], [1920, 1080]];

/* ---- the directory, at every size and in both palettes ---- */
for (const colorScheme of ['light', 'dark']) {
  for (const [width, height] of SIZES) {
    const at = `at ${width}px ${colorScheme}`;
    const { ctx, page, errors } = await open({ viewport: { width, height }, colorScheme });

    // Nothing of the map loads with the page.
    check(await page.evaluate(() => !window.L && !document.querySelector('script[src*="leaflet"]')), `Leaflet is not loaded before the map is near ${at}`);
    check(await page.evaluate(() => !document.getElementById('dir-tools').hidden && document.querySelectorAll('#dir-tools').length === 1),
      `the search field and the toggles are revealed, once ${at}`);
    await toDirectory(page);
    const data = await page.evaluate(() => ({ places: window.__PIZZA__.places, ranked: window.__PIZZA__.ranked }));

    /* The default: the ranking and nothing else, in the list and on the map. */
    let s = await read(page);
    const cats = Object.keys(s.groups);
    const total = cats.reduce((n, k) => n + s.groups[k].total, 0);
    check(s.on.join() === 'ranked' && s.rows === s.groups.ranked.total && s.rows > 0, `by default only the ranked rows are showing ${at}`, JSON.stringify(s.on));
    check(cats.every(k => s.groups[k].pressed === (k === 'ranked')), `by default only the ranked toggle is pressed ${at}`);
    check(s.pins === s.wantPins && s.pins > 0, `by default the map has the ranked pins and no others ${at}`, `${s.pins} pins, ${s.wantPins} wanted`);
    check(s.rings === s.wantRings && s.rings >= 10, `each of the ten highest ranked has a ring round its pin ${at}`, `${s.rings} rings, ${s.wantRings} wanted`);
    check(s.overflow <= 0 && s.wider <= 0, `nothing is wider than the window by default ${at}`, JSON.stringify([s.overflow, s.wider]));
    check(await page.evaluate(() => document.querySelectorAll('#map-rail #dir-tools').length === 1), `the toggles sit with the map ${at}`);
    if (shots) await page.screenshot({ path: path.join(shots, `default-${width}-${colorScheme}.png`) });

    /* The toggles stay in reach, and the map in view, however far down the list the reader is. */
    await page.evaluate(() => { const rows = document.querySelectorAll('#cat-ranked tr.dir-row'); rows[Math.floor(rows.length / 2)].scrollIntoView({ block: 'center' }); });
    await settle(page);
    const reach = await page.evaluate(() => {
      const inView = el => { const b = el.getBoundingClientRect(); return b.top >= 0 && b.bottom <= innerHeight && b.height > 0; };
      return { chip: inView(document.querySelector('.cat-chip')), field: inView(document.getElementById('dir-q')), map: inView(document.getElementById('map')) };
    });
    check(reach.chip && reach.field && reach.map, `halfway down the list the toggles, the search field and the map are all on screen ${at}`, JSON.stringify(reach));

    /* Each toggle shows its category's rows and its pins, and hides them again. */
    for (const cat of cats.filter(k => k !== 'ranked')) {
      await page.click(`.cat-chip[data-cat="${cat}"]`);
      await settle(page);
      s = await read(page);
      check(s.groups[cat].open && s.groups[cat].pressed && s.groups[cat].rows === s.groups[cat].total && s.on.join() === ['ranked', cat].sort((a, b) => cats.indexOf(a) - cats.indexOf(b)).join(),
        `the "${cat}" toggle shows its rows ${at}`, JSON.stringify(s.groups[cat]));
      check(s.pins === s.wantPins, `the map follows the "${cat}" toggle on ${at}`, `${s.pins} pins, ${s.wantPins} wanted`);
      const seen = await page.evaluate(k => { const b = document.querySelector(`#cat-${k} > summary`).getBoundingClientRect(); return b.top >= 0 && b.bottom <= innerHeight; }, cat);
      check(seen, `turning "${cat}" on brings its heading on screen ${at}`);
      await page.click(`.cat-chip[data-cat="${cat}"]`);
      await settle(page);
      s = await read(page);
      check(!s.groups[cat].open && !s.groups[cat].pressed && s.groups[cat].rows === 0 && s.pins === s.wantPins, `the "${cat}" toggle hides its rows and pins again ${at}`);
    }

    /* Show all, back to the default, and everything collapsed. */
    await page.click('#dir-all');
    await settle(page);
    s = await read(page);
    check(s.on.length === cats.length && s.rows === total, `"Show all" opens every category ${at}`, `${s.rows} of ${total} rows`);
    check(s.pins === s.wantPins && s.pins === data.places.reduce((n, p) => n + p.pts.length, 0), `"Show all" puts every place on the map ${at}`, `${s.pins} pins`);
    check(s.overflow <= 0 && s.wider <= 0, `nothing is wider than the window with every category open ${at}`, JSON.stringify([s.overflow, s.wider]));
    // Every pin is one size, and coloured as its category (or its rank) says.
    const drawn = await page.evaluate(() => [...document.querySelectorAll('#map .leaflet-overlay-pane path.leaflet-interactive')].map(p => {
      const d = p.getAttribute('d') ?? '';
      const r = Number(d.match(/a(\d+(?:\.\d+)?),/)?.[1]);
      return { r, fill: p.getAttribute('fill'), stroke: p.getAttribute('stroke') };
    }));
    check(new Set(drawn.map(p => p.r)).size === 1, `every pin is the same size ${at}`, [...new Set(drawn.map(p => p.r))].join());
    const fills = new Set(drawn.filter(p => p.fill !== '#fff').map(p => p.fill));
    const wantFills = new Set(data.places.filter(p => !p.lead).map(p => p.cat === 'ranked' ? rankColor(p.rank, data.ranked) : CATEGORY_COLOR[p.cat]));
    check(fills.size === wantFills.size && [...fills].every(f => wantFills.has(f)), `a filled pin is its category's colour, and a ranked one its rank's ${at}`,
      `${[...fills].filter(f => !wantFills.has(f)).join()} / ${[...wantFills].filter(f => !fills.has(f)).join()}`);
    const hollow = new Set(drawn.filter(p => p.fill === '#fff').map(p => p.stroke));
    const wantHollow = new Set(data.places.filter(p => p.lead).map(p => CATEGORY_COLOR[p.cat]));
    check(hollow.size === wantHollow.size && [...hollow].every(c => wantHollow.has(c)) && hollow.size > 0, `a place that is not on file is a hollow pin in its category's colour ${at}`, [...hollow].join());
    const swatch = await page.evaluate(() => getComputedStyle(document.querySelector('.cat-chip[data-cat="unrated"] .cat-dot')).backgroundColor);
    const rgb = hex => `rgb(${[1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)).join(', ')})`;
    check(swatch === rgb(CATEGORY_COLOR.unrated), `a toggle's swatch is the colour of its pins ${at}`, swatch);
    const dot = await page.evaluate(() => getComputedStyle(document.querySelector('#cat-ranked .dir-rank'), '::before').backgroundColor);
    check(dot === rgb(rankColor(1, data.ranked)), `the first ranked row's dot is the colour of rank 1 ${at}`, dot);
    if (shots) { await toDirectory(page); await page.screenshot({ path: path.join(shots, `all-${width}-${colorScheme}.png`) }); }

    await page.click('#dir-none');
    await settle(page);
    s = await read(page);
    check(s.on.length === 0 && s.rows === 0 && s.pins === 0 && s.rings === 0, `"Collapse all" closes every category and empties the map ${at}`, JSON.stringify([s.on, s.rows, s.pins]));
    check(await page.evaluate(() => { const p = document.querySelector('.map-empty'); return p && !p.hidden && p.textContent.length > 10; }), `an empty map says why it is empty ${at}`);
    check(Object.values(s.groups).every(g => !g.hidden), `collapsed, every category's heading is still listed ${at}`);
    await page.click('#dir-reset');
    await settle(page);
    s = await read(page);
    check(s.on.join() === 'ranked' && s.pins === s.wantPins && s.pins > 0, `the reset button brings back the default ${at}`, JSON.stringify(s.on));

    /* A category's own heading does what its toggle does. */
    await page.evaluate(() => { const h = document.querySelector('#cat-ranked > summary'); scrollBy(0, h.getBoundingClientRect().top - innerHeight * 0.75); });
    const head = await page.evaluate(() => { const b = document.querySelector('#cat-ranked .dg-title').getBoundingClientRect(); return { x: b.left + 5, y: b.top + b.height / 2 }; });
    await page.mouse.click(head.x, head.y);
    await settle(page);
    s = await read(page);
    check(!s.groups.ranked.open && !s.groups.ranked.pressed && s.pins === 0, `closing a category by its heading releases its toggle and clears its pins ${at}`, JSON.stringify(s.groups.ranked));
    await page.click('#cat-ranked > summary');
    await settle(page);
    s = await read(page);
    check(s.groups.ranked.open && s.groups.ranked.pressed && s.pins === s.wantPins && s.pins > 0, `opening it by its heading presses its toggle and restores its pins ${at}`);

    /* Search. The state it is laid over: the ranking and the closed places. */
    await page.click('.cat-chip[data-cat="closed"]');
    await settle(page);
    const before = (await read(page)).on.join();
    const search = async q => { await page.fill('#dir-q', q); await settle(page, 500); return read(page); };

    s = await search('delancey');
    check(s.rows === 1 && s.status === '1 match in 1 category' && s.on.join() === 'ranked', `a name finds its one row ${at}`, `${s.rows} rows, "${s.status}"`);
    check(s.groups.ranked.count === `1 of ${s.groups.ranked.total}` && Object.entries(s.groups).every(([k, g]) => k === 'ranked' || g.hidden),
      `a search shows only the categories with a match, and says how many of each ${at}`, s.groups.ranked.count);
    check(s.pins === s.wantPins && s.pins >= 1 && s.pins < 5, `the map shows only the match ${at}`, `${s.pins} pins`);
    if (shots) { await toDirectory(page); await page.screenshot({ path: path.join(shots, `search-${width}-${colorScheme}.png`) }); }

    s = await search('cafe lago');
    check(s.rows === 1 && s.on.join() === 'not-pizza' && s.pins === 1, `a search without the accent finds "Café Lago", in a category that was closed ${at}`, `${s.rows} rows in ${s.on.join()}`);
    s = await search('CAFÉ');
    check(s.rows >= 1 && s.groups['not-pizza'].rows >= 1, `case and accents in the query are ignored too ${at}`, String(s.rows));
    s = await search('wood-fired pizzas');
    check(s.groups['not-pizza'].rows === 1, `a candidate is found by its note ${at}`, JSON.stringify(s.on));

    s = await search('ballard neapolitan');
    const texts = await page.evaluate(() => [...document.querySelectorAll('#dir-list tr.dir-row')].filter(r => r.checkVisibility())
      .map(r => (r.textContent + ' ' + document.getElementById('dd-' + r.dataset.id).textContent).toLowerCase()));
    check(s.rows >= 1 && texts.every(t => t.includes('ballard') && t.includes('neapolitan')), `two words both have to match ${at}`, `${s.rows} rows`);
    const one = await search('ballard');
    check(one.rows > s.rows, `the second word narrows the first ${at}`, `${one.rows} then ${s.rows}`);
    check(one.pins === one.wantPins, `the map follows the search ${at}`, `${one.pins} pins, ${one.wantPins} wanted`);
    check(/^\d+ matches in \d+ categor(y|ies)$/.test(one.status), `the count is announced ${at}`, one.status);
    check(await page.evaluate(() => { const el = document.getElementById('dir-status'); return el.getAttribute('aria-live') === 'polite' && !document.getElementById('dir-clear').hidden; }),
      `the count is in a polite live region, beside a clear button ${at}`);
    check(one.overflow <= 0 && one.wider <= 0, `nothing is wider than the window during a search ${at}`, JSON.stringify([one.overflow, one.wider]));

    s = await search('qqxyzzy');
    check(s.rows === 0 && s.status === 'No matches' && s.pins === 0 && Object.values(s.groups).every(g => g.hidden), `a query with no match empties the list and the map and says so ${at}`, s.status);
    check(await page.evaluate(() => { const p = document.querySelector('.dir-empty'); return !p.hidden && p.checkVisibility(); }), `and the list says nothing matched ${at}`);

    await page.click('#dir-clear');
    await settle(page, 500);
    s = await read(page);
    check(s.on.join() === before && s.status === '' && s.pins === s.wantPins && await page.inputValue('#dir-q') === '', `clearing the search restores what was open before it ${at}`, `${s.on.join()} (was ${before})`);
    check(Object.values(s.groups).every(g => !g.hidden) && s.groups.ranked.count === String(s.groups.ranked.total), `and every category's heading and count are back ${at}`);
    await page.fill('#dir-q', 'ballard');
    await page.press('#dir-q', 'Escape');
    await settle(page, 400);
    check((await read(page)).on.join() === before, `Escape clears the search as well ${at}`);
    await page.evaluate(() => document.activeElement.blur());
    await page.keyboard.press('/');
    check(await page.evaluate(() => document.activeElement?.id === 'dir-q' && document.getElementById('dir-q').value === ''), `"/" goes to the search field ${at}`);
    await page.evaluate(() => document.activeElement.blur());
    await page.click('.cat-chip[data-cat="closed"]');
    await settle(page);

    /* A row opens its record and its pin; a pin finds its row. */
    const first = await page.evaluate(() => document.querySelector('#cat-ranked tr.dir-row').id);
    await clickRow(page, first);
    const opened = await page.evaluate(id => {
      const row = document.getElementById(id), record = document.getElementById('dd-' + row.dataset.id);
      return { record: !record.hidden && record.checkVisibility(), expanded: row.querySelector('.dir-toggle').getAttribute('aria-expanded') };
    }, first);
    check(opened.record && opened.expanded === 'true', `a click on a row opens its full record ${at}`);
    const pop = await popup(page);
    check(pop != null && pop.includes(await page.evaluate(id => window.__PIZZA__.places.find(p => p.id === id).name, first)), `and opens its pin on the map ${at}`, String(pop));
    await clickRow(page, first);
    check(await page.evaluate(id => document.getElementById('dd-' + document.getElementById(id).dataset.id).hidden, first), `a second click closes the record ${at}`);

    // A place that is not on file: its row has no record, so it is marked, and
    // its pin's popup names it, its address, its category and its inspection.
    await page.click('.cat-chip[data-cat="pending"]');
    await settle(page);
    const lead = await page.evaluate(() => window.__PIZZA__.places.find(p => p.cat === 'pending').id);
    await clickRow(page, lead);
    const leadPop = await popup(page);
    check(await page.evaluate(id => document.getElementById(id).classList.contains('marked'), lead), `a click on a candidate's row marks it ${at}`);
    check(leadPop != null && ['Zzyzx Test Slice Shop', '77 Yesler Way, Seattle, WA 98104', 'Waiting for a census pass', 'last inspected Oct 30, 2026'].every(t => leadPop.includes(t)),
      `a candidate's popup gives its name, address, category and last inspection ${at}`, String(leadPop));
    if (shots) {
      await page.evaluate(() => { const m = document.getElementById('map'); if (m.getBoundingClientRect().top < 60) scrollBy(0, m.getBoundingClientRect().top - 120); });
      await settle(page, 300);
      await page.screenshot({ path: path.join(shots, `popup-${width}-${colorScheme}.png`) });
    }

    // A click on a pin: the last pin drawn is on top, so a click lands on it.
    await page.evaluate(() => { document.querySelector('#map .leaflet-popup-close-button')?.click(); });
    await page.click('#dir-reset');
    await settle(page, 600);
    const pin = await page.evaluate(() => {
      const paths = [...document.querySelectorAll('#map .leaflet-overlay-pane path.leaflet-interactive')];
      const m = document.getElementById('map').getBoundingClientRect();
      for (const p of paths.reverse()) {
        const b = p.getBoundingClientRect();
        const x = b.left + b.width / 2, y = b.top + b.height / 2;
        if (x > m.left + 60 && x < m.right - 150 && y > m.top + 20 && y < m.bottom - 30 && document.elementFromPoint(x, y) === p) return { x, y };
      }
      return null;
    });
    check(pin != null, `a pin can be clicked ${at}`);
    if (pin) {
      await page.mouse.click(pin.x, pin.y);
      await settle(page, 500);
      const found = await page.evaluate(() => {
        const row = document.querySelector('#dir-list tr.dir-row.expanded');
        if (!row) return null;
        const b = row.getBoundingClientRect();
        return { top: b.top, bottom: b.bottom, vh: innerHeight, name: window.__PIZZA__.places.find(p => p.id === row.id).name };
      });
      const top = await listTop(page);
      check(found != null && found.top >= top - 1 && found.bottom <= found.vh, `a click on a pin opens its row and brings it into the visible list ${at}`, JSON.stringify({ found, top }));
      check(found != null && (await popup(page) ?? '').includes(found.name), `and the popup is that row's place ${at}`);
    }

    check(errors.length === 0, `no console or page errors ${at}`, errors.join(' | '));
    await ctx.close();
  }
}

/* ---- the layout holds: pinned on a phone, aligned and unclipped on a wide screen ---- */
{
  const { ctx, page, errors } = await open({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await toDirectory(page);
  await page.evaluate(() => { const rows = document.querySelectorAll('#cat-ranked tr.dir-row'); rows[30].scrollIntoView({ block: 'end' }); });
  await settle(page);
  const g = await page.evaluate(() => {
    const b = sel => document.querySelector(sel).getBoundingClientRect();
    return { nav: b('.site-nav').bottom, pin: b('.dir-pin'), tools: b('#dir-tools'), map: b('#map'), head: b('#cat-ranked thead th'), chipsScroll: document.getElementById('dir-cats').scrollWidth > document.getElementById('dir-cats').clientWidth,
      chipRows: new Set([...document.querySelectorAll('.cat-chip')].map(c => Math.round(c.getBoundingClientRect().top))).size, vh: innerHeight };
  });
  check(Math.abs(g.pin.top - g.nav) <= 3 && g.tools.top >= g.pin.top && g.map.top >= g.tools.bottom - 1 && g.map.bottom <= g.pin.bottom,
    'on a phone the toggles and the map are pinned together under the nav', JSON.stringify([g.nav, g.pin.top, g.tools.top, g.map.top]));
  check(Math.abs(g.head.top - g.pin.bottom) <= 2, 'on a phone the table header sticks right under the pinned map', `${g.head.top} against ${g.pin.bottom}`);
  check(g.chipRows === 1 && g.chipsScroll, 'on a phone the toggles are one row that scrolls sideways');
  check(g.pin.bottom < g.vh * 0.62, 'on a phone the pinned box leaves room for the list', `${Math.round(g.pin.bottom)} of ${g.vh}`);
  check(errors.length === 0, 'no console or page errors on a phone', errors.join(' | '));
  await ctx.close();
}
for (const width of [1440, 1920, 2560]) {
  const { ctx, page, errors } = await open({ viewport: { width, height: 1100 } });
  const top = await page.evaluate(() => {
    const left = sel => Math.round(document.querySelector(sel).getBoundingClientRect().left);
    const de = document.documentElement;
    return { nav: left('.site-nav .wrap'), main: left('main .wrap'), hero: left('.hero .wrap'), wrap: document.querySelector('main .wrap').getBoundingClientRect().width,
      overflow: de.scrollWidth - de.clientWidth, cardsPerRow: new Set([...document.querySelectorAll('#board .card')].map(c => Math.round(c.getBoundingClientRect().left))).size,
      lede: document.querySelector('#top-ten .lede').getBoundingClientRect().width };
  });
  check(top.nav === top.main && top.hero === top.main, `the nav and the hero line up with the content at ${width}px`, JSON.stringify(top));
  check(top.wrap > 1280 && top.wrap <= 1600 && top.wrap <= width * 0.94 + 1, `the content column uses a wide window, up to its cap, at ${width}px`, String(top.wrap));
  check(top.lede < top.wrap * 0.85 || width < 1500, `running prose keeps its measure at ${width}px`, String(top.lede));
  check(top.cardsPerRow === (width >= 1500 ? 2 : 1), `the ranking is ${width >= 1500 ? 'two cards' : 'one card'} to a row at ${width}px`, String(top.cardsPerRow));
  await toDirectory(page);
  await page.click('#dir-all');
  await settle(page);
  const d = await page.evaluate(() => {
    const b = sel => document.querySelector(sel).getBoundingClientRect();
    const de = document.documentElement;
    return { list: b('#dir-list'), rail: b('#map-rail'), map: b('#map'), note: b('.dir-map-note'), vh: innerHeight, overflow: de.scrollWidth - de.clientWidth };
  });
  const whole = await read(page);
  check(d.overflow <= 0 && whole.wider <= 0, `nothing is wider than the window at ${width}px`, JSON.stringify([d.overflow, whole.wider]));
  check(d.rail.left > d.list.right && d.map.width >= (width >= 1500 ? 560 : 400), `the map has a good share of a wide row at ${width}px`, `${Math.round(d.map.width)}px`);
  check(d.note.bottom <= d.vh + 1 && d.map.height >= 300, `the toggles, the map and its note all fit the window at ${width}px`, JSON.stringify([Math.round(d.map.height), Math.round(d.note.bottom), d.vh]));
  if (shots && width === 1920) {
    await page.click('#dir-reset'); await toDirectory(page);
    await page.screenshot({ path: path.join(shots, 'directory-1920.png') });
    await page.evaluate(() => scrollTo(0, 0)); await settle(page);
    await page.screenshot({ path: path.join(shots, 'top-1920.png') });
  }
  check(errors.length === 0, `no console or page errors at ${width}px`, errors.join(' | '));
  await ctx.close();
}

/* ---- "Larger map" is remembered ---- */
{
  const { ctx, page, errors } = await open({ viewport: { width: 1280, height: 900 } });
  await toDirectory(page);
  const widthOf = () => page.evaluate(() => document.getElementById('map').getBoundingClientRect().width);
  const small = await widthOf();
  await page.click('.map-grow');
  await settle(page);
  check(await widthOf() > small * 1.5 && await page.textContent('.map-grow') === 'Smaller map', '"Larger map" gives the map most of the row');
  await page.reload();
  await toDirectory(page);
  check(await widthOf() > small * 1.5 && await page.getAttribute('.map-grow', 'aria-pressed') === 'true', 'the larger map is remembered across a reload');
  await page.click('.map-grow');
  await settle(page);
  check(Math.abs(await widthOf() - small) < 2, '"Smaller map" puts it back');
  check(errors.length === 0, 'no console or page errors with the larger map', errors.join(' | '));
  await ctx.close();
}

/* ---- links into the directory open what they point at ---- */
for (const [width, height] of [[390, 844], [1280, 900]]) {
  const at = `at ${width}px`;
  const { ctx, page, errors } = await open({ viewport: { width, height } });
  // From the radar: a place that is not open yet, whose category is closed.
  const target = await page.evaluate(() => document.querySelector('#radar [data-radar="opening"] a.cand-dir').getAttribute('href').slice(1));
  await page.click(`#radar a.cand-dir[href="#${target}"]`);
  await settle(page, 700);
  const landed = async id => {
    const top = await listTop(page);
    return page.evaluate(([rowId, line]) => {
      const row = document.getElementById(rowId), b = row.getBoundingClientRect();
      return { open: row.closest('details').open, seen: b.height > 0 && b.top >= line - 1 && b.bottom <= innerHeight, expanded: row.classList.contains('expanded'), hash: location.hash, top: b.top, line };
    }, [id, top]);
  };
  let l = await landed(target);
  check(l.open && l.seen && l.expanded && l.hash === `#${target}`, `a link from the radar opens the row's category and its record, and shows the row ${at}`, JSON.stringify(l));
  let s = await read(page);
  check(s.on.join() === 'ranked,opening' && s.groups.opening.pressed, `and the category's toggle is pressed with it ${at}`, s.on.join());
  // The same link again, after the category was closed by hand.
  await page.click('.cat-chip[data-cat="opening"]');
  await page.evaluate(() => scrollTo(0, document.getElementById('radar').getBoundingClientRect().top + scrollY - 60));
  await page.click(`#radar a.cand-dir[href="#${target}"]`);
  await settle(page, 700);
  l = await landed(target);
  check(l.open && l.seen, `the same link opens it again after it was closed ${at}`, JSON.stringify(l));
  // During a search that hides the target.
  await page.fill('#dir-q', 'delancey');
  await settle(page, 400);
  await page.evaluate(() => scrollTo(0, document.getElementById('radar').getBoundingClientRect().top + scrollY - 60));
  await page.click(`#radar a.cand-dir[href="#${target}"]`);
  await settle(page, 700);
  l = await landed(target);
  check(l.open && l.seen && await page.inputValue('#dir-q') === '', `a link to a row a search had hidden clears the search ${at}`, JSON.stringify(l));
  // The page's own link to the places not on file.
  await page.evaluate(() => scrollTo(0, document.getElementById('directory').getBoundingClientRect().top + scrollY - 60));
  await page.click('#directory a[href="#candidates"]');
  await settle(page, 600);
  const head = await page.evaluate(() => { const b = document.getElementById('candidates').getBoundingClientRect(); return { top: b.top, vh: innerHeight }; });
  check(head.top >= (await listTop(page)) - 1 && head.top < head.vh - 40, `the link to "Not on file" lands on its heading, clear of what is pinned ${at}`, JSON.stringify(head));
  check(errors.length === 0, `no console or page errors following links ${at}`, errors.join(' | '));
  await ctx.close();

  // A fragment in the address the page is opened with: a category, a row, a
  // record, and the two ids the Candidates section used to have.
  for (const [hash, cat, rowOf] of [['#cat-closed', 'closed', null], ['#cat-unverifiable', 'unverifiable', null], [`#${target}`, 'opening', target],
    [`#dd-${target.slice(2)}`, 'opening', target], ['#unranked', 'unrated', null], ['#candidates', null, null], ['#queue', null, null]]) {
    const opened = await open({ viewport: { width, height } }, { hash });
    await settle(opened.page, 900);
    const r = await read(opened.page);
    const top = await listTop(opened.page);
    const where = await opened.page.evaluate(([c, row]) => {
      const el = row ? document.getElementById(row) : c ? document.querySelector(`#cat-${c} > summary`) : document.getElementById('candidates');
      const b = el.getBoundingClientRect();
      return { top: b.top, bottom: b.bottom, vh: innerHeight };
    }, [cat, rowOf]);
    check(r.on.join() === (cat ? ['ranked', cat].sort((a, b) => Object.keys(r.groups).indexOf(a) - Object.keys(r.groups).indexOf(b)).join() : 'ranked'),
      `opened at ${hash}, ${cat ? `the "${cat}" category is on beside the ranking` : 'the default is untouched'} ${at}`, r.on.join());
    check(where.top >= top - 1 && where.top < where.vh - 30, `opened at ${hash}, its target is on screen, clear of what is pinned ${at}`, JSON.stringify({ where, top }));
    check(opened.errors.length === 0, `no console or page errors opened at ${hash} ${at}`, opened.errors.join(' | '));
    await opened.ctx.close();
  }
}

/* ---- without JavaScript the list still works ---- */
{
  const { ctx, page } = await open({ viewport: { width: 390, height: 844 }, javaScriptEnabled: false });
  const drawnRows = () => page.locator('#dir-list tr.dir-row:visible, #dir-list tr.cq-row:visible').count();
  const ranked = await page.locator('#cat-ranked tr.dir-row').count();
  const everyRow = await page.locator('#dir-list tr.dir-row, #dir-list tr.cq-row').count();
  check(await drawnRows() === ranked && ranked > 0, 'without JavaScript the ranked rows are showing and no others', `${await drawnRows()} of ${ranked}`);
  check(everyRow === await page.locator('#dir-list details.dg .dg-n').evaluateAll(els => els.reduce((n, el) => n + Number(el.textContent), 0)), 'without JavaScript every row is in the page');
  check(await page.locator('#dir-tools').isHidden() && await page.locator('#map-rail').isHidden() && await page.locator('#dir-q').isHidden(),
    'without JavaScript the search field, the toggles and the map are not shown');
  check(await page.locator('.dg-unmapped').first().isHidden(), 'without JavaScript nothing talks about a map');
  await page.locator('#cat-closed > summary').click();
  check(await page.locator('#cat-closed tr.dir-row:visible, #cat-closed tr.cq-row:visible').count() === await page.locator('#cat-closed tr.dir-row, #cat-closed tr.cq-row').count(),
    'without JavaScript a category opens by its heading');
  const wide = await page.evaluate('document.documentElement.scrollWidth - document.documentElement.clientWidth');
  check(wide <= 0, 'without JavaScript nothing is wider than the window', String(wide));
  await ctx.close();
}

/* ---- the map's script refused: the toggles and the search go on working ---- */
for (const [width, height] of [[390, 844], [1280, 900]]) {
  const at = `at ${width}px with no map`;
  const { ctx, page, errors } = await open({ viewport: { width, height } }, { leaflet: false, allow: /Failed to load resource|ERR_FAILED/ });
  await toDirectory(page, { map: false });
  await page.waitForFunction(() => !document.getElementById('map-rail'), null, { timeout: 8000 });
  const placed = await page.evaluate(() => ({ tools: document.querySelectorAll('#dir-tools').length, inLayout: document.getElementById('dir-tools').parentElement.classList.contains('dir-layout'),
    hasMap: document.querySelector('.dir-layout').classList.contains('has-map'), listWidth: document.getElementById('dir-list').getBoundingClientRect().width, wrap: document.querySelector('#directory .wrap').getBoundingClientRect().width }));
  check(placed.tools === 1 && placed.inLayout && !placed.hasMap, `the rail is gone and the toggles are above the list, once ${at}`, JSON.stringify(placed));
  check(placed.listWidth >= placed.wrap - 2, `the list takes the full width ${at}`);
  if (width < 1100) {
    check(await page.evaluate(() => new Set([...document.querySelectorAll('.cat-chip')].map(c => Math.round(c.getBoundingClientRect().top))).size) === 1,
      `the toggles are still one row ${at}`);
  }
  await page.click('.cat-chip[data-cat="closed"]');
  await settle(page);
  let s = await read(page);
  check(s.on.join() === 'ranked,closed' && s.groups.closed.rows === s.groups.closed.total, `a toggle still opens its category ${at}`, s.on.join());
  await page.fill('#dir-q', 'delancey');
  await settle(page, 400);
  s = await read(page);
  check(s.rows === 1 && s.status === '1 match in 1 category', `the search still works ${at}`, s.status);
  await page.click('#dir-clear');
  await page.evaluate(() => { const rows = document.querySelectorAll('#cat-ranked tr.dir-row'); rows[40].scrollIntoView({ block: 'center' }); });
  await settle(page);
  const stuck = await page.evaluate(() => { const t = document.getElementById('dir-tools').getBoundingClientRect(), n = document.querySelector('.site-nav').getBoundingClientRect(), h = document.querySelector('#cat-ranked thead th').getBoundingClientRect();
    return { tools: t.top, toolsBottom: t.bottom, nav: n.bottom, head: h.top }; });
  check(Math.abs(stuck.tools - stuck.nav) <= 3 && Math.abs(stuck.head - stuck.toolsBottom) <= 3, `the toggles stay under the nav, and the table header under them ${at}`, JSON.stringify(stuck));
  const first = await page.evaluate(() => document.querySelectorAll('#cat-ranked tr.dir-row')[40].id);
  await clickRow(page, first);
  check(await page.evaluate(id => !document.getElementById('dd-' + document.getElementById(id).dataset.id).hidden, first), `a row still opens its record ${at}`);
  s = await read(page);
  check(s.overflow <= 0 && s.wider <= 0, `nothing is wider than the window ${at}`, JSON.stringify([s.overflow, s.wider]));
  check(errors.length === 0, `no page errors ${at}`, errors.join(' | '));
  await ctx.close();
}

/* ---- the reader's own location ---- */
/* Count the times the page asks the browser where it is, so "never on load" can be checked. */
const countAsks = () => {
  window.__asks = 0;
  const real = navigator.geolocation.getCurrentPosition.bind(navigator.geolocation);
  navigator.geolocation.getCurrentPosition = (...args) => { window.__asks++; return real(...args); };
};
const view = page => page.evaluate(() => {
  const m = document.getElementById('map').getBoundingClientRect();
  const me = document.querySelector('#map .map-me');
  const b = me?.getBoundingClientRect();
  return { me: Boolean(me), meInView: Boolean(b) && b.left >= m.left && b.right <= m.right && b.top >= m.top && b.bottom <= m.bottom,
    label: me?.querySelector('[role="img"]')?.getAttribute('aria-label') ?? null,
    said: document.querySelector('.map-locate-msg')?.textContent ?? null, asks: window.__asks,
    button: document.querySelector('.map-locate button') ? !document.querySelector('.map-locate button').disabled : null,
    pins: [...document.querySelectorAll('#map .leaflet-overlay-pane path.leaflet-interactive')].filter(p => { const r = p.getBoundingClientRect(); return r.left >= m.left && r.right <= m.right && r.top >= m.top && r.bottom <= m.bottom; }).length,
    tiles: [...document.querySelectorAll('#map .leaflet-tile')].map(t => t.src.split('/').slice(-3, -2)[0])[0], stored: JSON.stringify([Object.keys(localStorage), location.href]) };
});
for (const [width, height] of [[390, 844], [1280, 900]]) {
  const at = `at ${width}px`;
  // Not yet allowed: nothing asks until the button is pressed, and a refusal is a plain line.
  {
    const { ctx, page, errors } = await open({ viewport: { width, height } }, { init: countAsks });
    await toDirectory(page);
    await settle(page, 500);
    let v = await view(page);
    check(v.button === true && v.asks === 0 && !v.me && v.said === '', `the map has a "Show my location" button and nothing asks before it is pressed ${at}`, JSON.stringify(v));
    check(/stays in your browser/.test(await page.getAttribute('.map-locate button', 'title')), `the button says the location stays in the browser ${at}`);
    const zoom = v.tiles;
    await page.click('.map-locate button');
    await settle(page, 700);
    v = await view(page);
    check(v.asks === 1 && !v.me && /blocked/.test(v.said) && v.button === true, `refused, it says so in a line and the button still works ${at}`, JSON.stringify(v));
    check(v.tiles === zoom, `refused, the map does not move ${at}`);
    check(errors.length === 0, `a refusal logs no error ${at}`, errors.join(' | '));
    await ctx.close();
  }
  // Already allowed, in Seattle: shown without a click, in view with the pins, and kept nowhere.
  {
    const { ctx, page, errors } = await open({ viewport: { width, height }, geolocation: { latitude: 47.6205, longitude: -122.3493, accuracy: 40 }, permissions: ['geolocation'] }, { init: countAsks });
    check(await page.evaluate(() => window.__asks) === 0, `allowed already, still nothing asks before the map loads ${at}`);
    await toDirectory(page);
    await page.waitForFunction(() => document.querySelector('#map .map-me'), null, { timeout: 8000 }).catch(() => {});
    await settle(page, 700);
    const v = await view(page);
    check(v.me && v.meInView && v.asks === 1, `allowed already, the reader is on the map without pressing anything ${at}`, JSON.stringify(v));
    check(v.label === 'Your location' && /stays in this browser/.test(v.said), `the marker is labelled and the line says where the location stays ${at}`, `${v.label} / ${v.said}`);
    const s = await read(page);
    check(v.pins === s.pins && s.pins > 0, `the reader is brought into view together with the pins showing ${at}`, `${v.pins} of ${s.pins} pins in view`);
    check(await page.evaluate(() => !document.querySelector('#map .leaflet-overlay-pane path.leaflet-interactive')?.matches('.map-me') && getComputedStyle(document.querySelector('.map-me-dot')).transform !== 'none'),
      `the marker is a diamond, not a pin ${at}`);
    check(!/47\.62|122\.34/.test(v.stored) && !/47\.62|122\.34/.test(await page.evaluate(() => document.cookie + JSON.stringify(Object.values(localStorage)))), `the position is not stored or put in the address ${at}`, v.stored);
    check(errors.length === 0, `no console or page errors with a location ${at}`, errors.join(' | '));
    await ctx.close();
  }
  // Already allowed, a long way off: said in a line, and the map stays on Seattle.
  {
    const { ctx, page, errors } = await open({ viewport: { width, height }, geolocation: { latitude: 40.7128, longitude: -74.006, accuracy: 40 }, permissions: ['geolocation'] }, { init: countAsks });
    await toDirectory(page);
    await page.waitForFunction(() => document.querySelector('.map-locate-msg')?.textContent.includes('outside'), null, { timeout: 8000 }).catch(() => {});
    const v = await view(page);
    const s = await read(page);
    check(!v.me && /outside the Seattle area/.test(v.said), `far away, no marker is drawn and a line says the reader is outside Seattle ${at}`, JSON.stringify(v));
    check(v.pins === s.pins && s.pins > 0, `far away, the map stays on the pins ${at}`, `${v.pins} of ${s.pins} pins in view`);
    await page.click('.map-locate button');
    await settle(page, 500);
    check((await view(page)).asks === 2, `and the button can be pressed again ${at}`);
    check(errors.length === 0, `no console or page errors far away ${at}`, errors.join(' | '));
    await ctx.close();
  }
}
/* A browser with no geolocation has no button. */
{
  const { ctx, page, errors } = await open({ viewport: { width: 1280, height: 900 } },
    { init: () => { delete Navigator.prototype.geolocation; } });
  await toDirectory(page);
  await settle(page, 400);
  check(await page.evaluate(() => !('geolocation' in navigator) && !document.querySelector('.map-locate') && document.querySelector('.map-grow') != null), 'a browser with no geolocation gets no location button');
  check(errors.length === 0, 'no console or page errors without geolocation', errors.join(' | '));
  await ctx.close();
}

await browser.close();
server.close();
fs.rmSync(tmp, { recursive: true, force: true });
if (failures.length) {
  console.error(`${failures.length} of ${checks} browser checks FAILED:`);
  for (const f of failures) console.error('  ✗ ' + f);
  process.exit(1);
}
console.log(`Browser check passed (${checks} checks).`);
