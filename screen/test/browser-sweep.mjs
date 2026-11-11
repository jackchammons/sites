#!/usr/bin/env node
/* Drive the BUILT page in Chromium through a grid of inputs and check what
 * it shows.
 *
 * The unit tests cover the maths module; the page script, where the grading
 * rules, formatting, parsing and hash handling live, is covered twice. The
 * rooms and what each must show are in page-checks.mjs, and page.test.mjs
 * runs them in Node against a stand-in DOM on every push. This runs the same
 * checks in a real browser, and adds what only a layout engine can answer:
 * that labels stay inside their charts at every width, that nothing overflows
 * a phone, that both colour schemes and awkward locales render, that a touch
 * keeps its tooltip, and that the page says so when its script fails to load.
 *
 * Needs Chromium via Playwright (installed on the dev box, not in CI):
 *   node scripts/build.mjs && node test/browser-sweep.mjs [--quick]
 * OUT_DIR names the build to drive, as it does for build.mjs and verify.mjs;
 * the sweep only reads it.
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as s from '../src/screen.js';
import { states as grid, hashOf, checkState, checkShown, num, FACTS, FIELDS, SHOWN, TYPING_ROOM, TYPED } from './page-checks.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = process.env.OUT_DIR ? path.resolve(process.env.OUT_DIR) : path.join(root, '..', 'dist', path.basename(root));
if (!fs.existsSync(path.join(dist, 'index.html'))) { console.error(`no build at ${dist}; run scripts/build.mjs first`); process.exit(2); }
const quick = process.argv.includes('--quick');

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let chromium;
for (const p of ['/opt/node22/lib/node_modules/playwright', 'playwright']) {
  try { ({ chromium } = require(p)); break; } catch {}
}
if (!chromium) { console.error('playwright not found'); process.exit(2); }

/* ---- serve dist/ ---------------------------------------------------- */
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0].split('#')[0]);
  if (p.endsWith('/')) p += 'index.html';
  const f = path.join(dist, p);
  if (!f.startsWith(dist) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
await new Promise(r => server.listen(0, r));
const base = `http://localhost:${server.address().port}/`;

const states = grid(quick);

/* ---- run ------------------------------------------------------------ */
const browser = await chromium.launch();
const ctx = await browser.newContext({ locale: 'en-US', viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
const pageErrors = [];
page.on('pageerror', e => pageErrors.push(e.message));
await page.goto(base);
await page.waitForTimeout(200);

const failures = [];
let checks = 0;
const check = (ok, msg, st) => { checks++; if (!ok) failures.push(`${JSON.stringify(st)} :: ${msg}`); };

async function readPage() {
  return page.evaluate(({ FACTS, FIELDS }) => {
    const $ = id => document.getElementById(id);
    const fact = k => ({ cls: ($('fact-' + k).className.match(/good|ok|warn/) || [''])[0], word: $('grade-' + k).textContent, main: $('sum-' + k).textContent, sub: $('sub-' + k).textContent });
    const rows = sel => [...document.querySelectorAll(sel)].map(tr => [...tr.children].map(td => td.textContent.trim()));
    return {
      boot: $('boot-error').hidden, stale: $('main').classList.contains('stale'),
      fov: $('out-fov').textContent, fovCls: ($('out-total').className.match(/good|ok|warn/) || [''])[0], fovWord: $('out-grade').textContent, sub: $('out-sub').textContent,
      facts: Object.fromEntries(FACTS.map(k => [k, fact(k)])),
      fields: Object.fromEntries(FIELDS.map(id => [id, $(id).value])),
      pjHidden: $('pj-section').hidden,
      you: [...document.querySelectorAll('#lanes text.you-lbl')].map(t => t.textContent)[0],
      eyeLabel: [...document.querySelectorAll('#eye-bar text.eye-pct')].map(t => t.textContent)[0],
      targets: rows('#targets tr'),
      seats: rows('#seats tr'),
      sizes: rows('#sizes tr'),
      sizesHere: rows('#sizes tr.here')[0],
      matrixNote: $('matrix-note').textContent,
      matrixYou: document.querySelector('#matrix td.you')?.textContent,
      hash: location.hash,
      lanes: [...document.querySelectorAll('#lanes rect.band')].length,
    };
  }, { FACTS, FIELDS });
}

for (const st of states) {
  await page.evaluate(h => { location.hash = h; }, hashOf(st));
  await page.waitForTimeout(40);
  checkState(await readPage(), st, check);
  check(pageErrors.length === 0, `page errors: ${pageErrors.join(' | ')}`, st);
  pageErrors.length = 0;
}
for (const [st, facts] of SHOWN) {
  await page.evaluate(h => { location.hash = h; }, hashOf(st));
  await page.waitForTimeout(40);
  checkShown(await readPage(), st, facts, check);
}

/* ---- interactions ---------------------------------------------------- */
const hashGet = async k => new URLSearchParams((await page.evaluate(() => location.hash)).slice(1)).get(k);
const settle = () => page.waitForTimeout(90);        // the form debounces typing by 60 ms

async function interact() {
  // Everything a person may type is read as they meant it, or refused.
  for (const [id, key, cases] of TYPED) {
    await page.evaluate(h => { location.hash = h; }, hashOf(TYPING_ROOM));
    await page.waitForTimeout(40);
    for (const [typed, want] of cases) {
      await page.fill('#' + id, typed); await settle();
      const flagged = await page.$eval('#' + id, e => e.closest('.field').classList.contains('invalid') && e.getAttribute('aria-invalid') === 'true');
      const stale = await page.$eval('#main', e => e.classList.contains('stale'));
      if (want === null) check(flagged && stale, `typing "${typed}" in #${id} should be refused`, { typed });
      else {
        const got = await hashGet(key);
        check(!flagged && !stale && Math.abs(+got - want) < 0.001, `typing "${typed}" in #${id} stored ${key}=${got}, expected ${want}`, { typed });
      }
    }
  }

  const st = { d: 65, a: '16:9', r: '2160', v: 108, e: 42, c: 42, u: 'i', m: 'tv' };
  await page.evaluate(h => { location.hash = h; }, hashOf(st));
  await page.waitForTimeout(40);
  const fovBefore = num(await page.textContent('#out-fov'));

  /* An invalid field: the headline loses its figure and its colour, the
     message names the field, the rest of the page is dimmed, and a unit
     switch leaves the unread text alone. Then it recovers. */
  const green = await page.$eval('#sum-res', e => getComputedStyle(e).color);
  await page.fill('#in-diag', 'big'); await settle();
  check((await page.textContent('#out-fov')) === '—', 'invalid diagonal should blank the headline', {});
  check((await page.textContent('#out-sub')) === 'Check “Diagonal”.', `the message should name the field: "${await page.textContent('#out-sub')}"`, {});
  check(await page.$eval('#in-diag', e => e.closest('.field').classList.contains('invalid') && e.getAttribute('aria-invalid') === 'true'), 'invalid field flagged', {});
  check((await page.$eval('#out-fov', e => getComputedStyle(e).color)) !== green, 'the blank headline is still drawn in a grade colour', {});
  check(await page.$eval('#out-grade', e => e.textContent === '' && e.getBoundingClientRect().width === 0), 'the blank headline still carries a grade word', {});
  const dimmed = await page.$$eval('.results .facts, #lanes, #eye-bar, #targets, #matrix, #seats, #sizes, #side-view', els => els.map(e => {
    let o = 1; for (let n = e; n; n = n.parentElement) o *= +getComputedStyle(n).opacity; return o;
  }));
  check(dimmed.every(o => o < 0.6) && dimmed.every(o => o > 0.3), `stale figures should be dimmed once: opacities ${dimmed.join(', ')}`, {});
  check((await page.$eval('.inputs', e => getComputedStyle(e).opacity)) === '1', 'the form itself stays at full strength', {});
  await page.click('#unit-metric'); await settle();
  check((await page.inputValue('#in-diag')) === 'big' && (await page.inputValue('#in-dist')) === '2.74', 'a unit switch converts what parsed and leaves the rest', {});
  for (const id of FIELDS) check(!/NaN/.test(await page.inputValue('#' + id)), `#${id} holds NaN after a unit switch`, {});
  await page.click('#unit-imperial'); await settle();
  check((await page.inputValue('#in-diag')) === 'big' && (await page.inputValue('#in-dist')) === '9', 'and back again', {});
  await page.fill('#in-diag', '65'); await settle();
  check(Math.abs(num(await page.textContent('#out-fov')) - fovBefore) < 0.06, 'recovers after invalid', {});
  check(!(await page.$eval('#main', e => e.classList.contains('stale'))) && (await page.$eval('#in-diag', e => e.getAttribute('aria-invalid'))) === null, 'recovery clears the stale mark', {});

  // Typing a decimal one key at a time never passes through an invalid state.
  await page.fill('#in-dist', '');
  for (const key of '8.5') {
    await page.type('#in-dist', key); await settle();
    check(!(await page.$eval('#main', e => e.classList.contains('stale'))), `typing 8.5 flashed invalid at "${await page.inputValue('#in-dist')}"`, {});
  }

  // Unit toggle round-trips within rounding and switches every adornment.
  await page.fill('#in-dist', '9'); await settle();
  await page.click('#unit-metric'); await settle();
  check((await page.textContent('#in-dist-unit')) === 'm' && (await page.textContent('#in-eye-unit')) === 'cm', 'metric adornments', {});
  check(/cm/.test(await page.textContent('#sum-size')), 'metric picture', {});
  const vMetric = +(await hashGet('v'));
  check(Math.abs(vMetric - 108) < 0.25, `distance after metric switch ${vMetric}`, {});
  await page.click('#unit-imperial'); await settle();
  const vBack = +(await hashGet('v'));
  check(Math.abs(vBack - 108) < 0.6, `distance after switching back ${vBack}`, {});
  check(Math.abs(num(await page.textContent('#out-fov')) - fovBefore) < 0.06, 'headline survives a unit round-trip', {});

  // Custom resolution and the "this screen" button.
  await page.selectOption('#in-res', 'custom'); await settle();
  check(!(await page.$eval('#custom-res', e => e.hidden)), 'custom fields appear', {});
  await page.fill('#in-resw', '3440'); await page.fill('#in-resh', '1440'); await settle();
  check(/3,440 × 1,440/.test(await page.textContent('#sub-density')), 'custom panel named', {});
  await page.click('#btn-this'); await settle();
  check((await page.inputValue('#in-resw')) === '1280' && (await page.inputValue('#in-resh')) === '900', 'this-screen fills the viewport pixels', {});
  await page.selectOption('#in-res', '2160'); await settle();
  check(await page.$eval('#custom-res', e => e.hidden), 'custom fields hide again', {});

  // Projector mode shows the section; reset restores the example.
  await page.click('#mode-pj'); await settle();
  check(!(await page.$eval('#pj-section', e => e.hidden)), 'projector section shows', {});
  await page.click('#btn-reset'); await settle();
  const after = new URLSearchParams((await page.evaluate(() => location.hash)).slice(1));
  check(after.get('d') === '65' && after.get('v') === '108' && after.get('m') === 'tv' && after.get('r') === '2160', `reset hash ${after}`, {});

  // A bad hash falls back instead of breaking.
  await page.evaluate(() => { location.hash = '#d=abc&a=nope&r=zzz&v=-5'; }); await page.waitForTimeout(60);
  check(pageErrors.length === 0, `errors on a bad hash: ${pageErrors.join(' | ')}`, {});
  check((await page.inputValue('#in-aspect')) === '16:9' && (await page.inputValue('#in-res')) === '2160', 'bad hash falls back to defaults', {});

  // Both colour schemes and a hostile locale render without error.
  for (const [scheme, locale] of [['dark', 'en-US@posix'], ['light', 'de-DE'], ['dark', 'ja-JP']]) {
    const c2 = await browser.newContext({ colorScheme: scheme, locale, viewport: { width: 390, height: 844 } });
    const p2 = await c2.newPage(); const errs = [];
    p2.on('pageerror', e => errs.push(e.message));
    await p2.goto(base + '#d=77&a=2.39&r=custom&rw=5120&rh=2160&v=130&u=m&m=pj'); await p2.waitForTimeout(250);
    check(errs.length === 0 && (await p2.$eval('#boot-error', e => e.hidden)), `${scheme}/${locale}: ${errs.join(' | ')}`, {});
    check(!(await p2.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)), `${scheme}/${locale}: horizontal overflow at phone width`, {});
    if (locale === 'de-DE') {
      /* The page prints a German reader's figures with a comma; the same
         figures typed back must be the same figures. */
      check(/at throw 1,2–1,5/.test(await p2.textContent('#sub-throw')), `de-DE prints "${await p2.textContent('#sub-throw')}"`, {});
      for (const [id, typed, key, want] of [['in-throw1', '1,2', 't1', 1.2], ['in-throw2', '1,5', 't2', 1.5], ['in-gain', '1,3', 'g', 1.3], ['in-lumens', '2.000', 'l', 2000], ['in-dist', '3,66', 'v', 144.094]]) {
        await p2.fill('#' + id, typed); await p2.waitForTimeout(90);
        const got = new URLSearchParams((await p2.evaluate(() => location.hash)).slice(1)).get(key);
        check(Math.abs(+got - want) < 0.001, `de-DE: typing "${typed}" in #${id} stored ${key}=${got}, expected ${want}`, {});
      }
      check(/at throw 1,2–1,5/.test(await p2.textContent('#sub-throw')) && !(await p2.$eval('#main', e => e.classList.contains('stale'))), 'de-DE: the figures typed back are the figures printed', {});
    }
    await c2.close();
  }
}
await interact();

/* ---- what only a layout engine can answer ---------------------------- */
async function layout() {
  /* The eye-bar label and the lanes marker label stay inside their charts,
     and axis figures do not run into each other, at every width and
     wherever the marker falls. */
  const SEATS = quick ? [44, 84, 108] : [12, 44, 60, 72, 84, 108, 116, 150, 300];
  for (const scheme of quick ? ['light'] : ['light', 'dark']) for (const width of quick ? [390, 768, 1280] : [320, 390, 660, 768, 900, 1060, 1280]) {
    const c2 = await browser.newContext({ colorScheme: scheme, locale: 'en-US', viewport: { width, height: 900 } });
    const p2 = await c2.newPage(); const errs = [];
    p2.on('pageerror', e => errs.push(e.message));
    p2.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
    await p2.goto(base); await p2.waitForTimeout(150);
    for (const v of SEATS) {
      const where = { scheme, width, v };
      await p2.evaluate(h => { location.hash = h; }, `#d=65&a=16:9&r=2160&v=${v}&u=i&m=tv`);
      await p2.waitForTimeout(40);
      const m = await p2.evaluate(() => {
        const inside = sel => {
          const t = document.querySelector(sel), a = t.getBoundingClientRect(), b = t.ownerSVGElement.getBoundingClientRect();
          return { text: t.textContent, left: a.left - b.left, right: b.right - a.right };
        };
        const ticks = [...document.querySelectorAll('#eye-bar .eye-axis text')].map(t => t.getBoundingClientRect()).map(r => [r.left, r.right]);
        const lanes = [...document.querySelectorAll('#lanes text.tick')].map(t => t.getBoundingClientRect()).map(r => [r.left, r.right]);
        return { eye: inside('#eye-bar .eye-pct'), you: inside('#lanes .you-lbl'), ticks, lanes,
          overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth };
      });
      check(m.eye.left >= -0.5 && m.eye.right >= -0.5, `eye-bar label "${m.eye.text}" is cut off (${m.eye.left.toFixed(1)} px left, ${m.eye.right.toFixed(1)} px right to spare)`, where);
      check(m.you.left >= -0.5 && m.you.right >= -0.5, `lanes marker label "${m.you.text}" is cut off`, where);
      check(m.ticks.every(([lo], i) => i === 0 || lo >= m.ticks[i - 1][1] + 1), 'eye-bar axis figures overlap', where);
      check(m.ticks.length >= 8, `only ${m.ticks.length} eye-bar axis figures`, where);
      check(m.lanes.every(([lo], i) => i === 0 || lo >= m.lanes[i - 1][1]), 'lanes axis figures overlap', where);
      check(!m.overflow, 'the page scrolls sideways', where);
    }
    /* The word that names each grade is on the page beside its figure: drawn,
       inside its fact, in the figure's colour, clear of the figure and of the
       line beneath wherever it wraps to. A fact with no grade shows none. One
       room with every grade in it, and a projector whose panel is not the
       picture's shape, which has the longest lines. */
    for (const hash of ['#d=43&a=16:9&r=1080&v=40&e=42&c=75&u=i&m=tv', '#d=65&a=16:9&r=2160&v=108&u=i&m=tv', '#d=100&a=16:9&r=custom&rw=2560&rh=1080&v=120&m=pj&l=400&o=-20&c=20&u=m']) {
      const where = { scheme, width, hash };
      await p2.evaluate(h => { location.hash = h; }, hash);
      await p2.waitForTimeout(40);
      const words = await p2.evaluate(() => [...document.querySelectorAll('.grade')].filter(g => !g.closest('[hidden]')).map(g => {
        const host = g.closest('.fact, .total'), fig = host.querySelector('span:not(.grade)'), sub = host.querySelector('.fact small');
        const r = g.getBoundingClientRect(), h = host.getBoundingClientRect(), f = fig.getBoundingClientRect();
        return { id: g.id, text: g.textContent, graded: /\b(good|ok|warn)\b/.test(host.className), w: r.width, h: r.height,
          inside: r.left >= h.left - 0.5 && r.right <= h.right + 0.5 && r.top >= h.top - 0.5 && r.bottom <= h.bottom + 0.5,
          clear: !(r.top < f.bottom - 1 && r.bottom > f.top + 1 && r.left < f.right - 0.5 && r.right > f.left + 0.5) && (!sub || r.bottom <= sub.getBoundingClientRect().top + 0.5),
          colour: getComputedStyle(g).color === getComputedStyle(fig).color };
      }));
      check(words.filter(g => g.text).length >= 7, `only ${words.filter(g => g.text).length} grade words on the page`, where);
      for (const g of words) {
        if (!g.graded) { check(g.text === '' && g.w === 0 && g.h === 0, `#${g.id} has no grade and shows "${g.text}" (${g.w} × ${g.h})`, where); continue; }
        check(g.text !== '' && g.w >= 20 && g.h >= 12, `#${g.id} "${g.text}" is not drawn (${g.w} × ${g.h})`, where);
        check(g.inside, `#${g.id} "${g.text}" leaves its box`, where);
        check(g.clear, `#${g.id} "${g.text}" runs into its figure or the line beneath`, where);
        check(g.colour, `#${g.id} "${g.text}" is not in its figure's colour`, where);
      }
      check(!(await p2.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)), 'the page scrolls sideways', where);
    }
    await p2.evaluate(h => { location.hash = h; }, '#d=65&a=16:9&r=2160&v=108&u=i&m=tv');
    await p2.waitForTimeout(40);
    // Nine facts in two columns: the ninth takes the whole row, leaving no empty cell.
    const facts = await p2.$eval('.results .facts', e => { const kids = [...e.children].map(k => k.getBoundingClientRect()); const box = e.getBoundingClientRect();
      return { last: kids.at(-1).width, first: kids[0].width, box: box.width }; });
    check(facts.last >= facts.box - 4, `the last fact is ${facts.last}px of a ${facts.box}px grid`, { scheme, width });
    check(errs.length === 0, `errors: ${errs.join(' | ')}`, { scheme, width });
    await c2.close();
  }

  /* A touch has no hover to end: a tapped tooltip stays up until the next
     tap somewhere else. */
  const touch = await browser.newContext({ locale: 'en-US', viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const tp = await touch.newPage();
  await tp.goto(base); await tp.waitForTimeout(200);
  for (const [chart, tip] of [['#eye-bar', '#eye-tip'], ['#lanes', '#tip']]) {
    await tp.locator(`${chart} rect.hit`).first().scrollIntoViewIfNeeded();
    await tp.tap(`${chart} rect.hit >> nth=0`); await tp.waitForTimeout(150);
    check(!(await tp.$eval(tip, e => e.hidden)) && (await tp.textContent(tip)).length > 10, `${tip} should still be showing after a tap`, {});
    const box = await tp.$eval(tip, e => { const r = e.getBoundingClientRect(); return { left: r.left, right: innerWidth - r.right }; });
    check(box.left >= 0 && box.right >= 0, `${tip} leaves the screen`, {});
    await tp.tap('h1', { force: true }).catch(() => tp.tap('header')); await tp.waitForTimeout(100);
    check(await tp.$eval(tip, e => e.hidden), `${tip} should close on a tap elsewhere`, {});
  }
  await touch.close();

  /* The page admits it when its script did not start: a file that never
     arrived, and an import the other file does not export. */
  const breakages = [
    ['app.js does not arrive', r => r.request().url().includes('/app.js') ? r.abort() : r.continue()],
    ['screen.js does not arrive', r => r.request().url().includes('/screen.js') ? r.abort() : r.continue()],
    ['app.js imports a name screen.js lacks', async r => {
      if (!r.request().url().includes('/app.js')) return r.continue();
      const body = fs.readFileSync(path.join(dist, 'app.js'), 'utf8').replace('import {', 'import { notExported,');
      return r.fulfill({ contentType: 'text/javascript', body });
    }],
    ['app.js throws while booting', async r => {
      if (!r.request().url().includes('/app.js')) return r.continue();
      const body = fs.readFileSync(path.join(dist, 'app.js'), 'utf8').replace('function boot() {', 'function boot() { null.x;');
      return r.fulfill({ contentType: 'text/javascript', body });
    }],
  ];
  for (const [name, handler] of breakages) {
    const c2 = await browser.newContext({ locale: 'en-US' });
    const p2 = await c2.newPage();
    await p2.route('**/*.js*', handler);
    await p2.goto(base); await p2.waitForTimeout(300);
    check(await p2.$eval('#boot-error', e => !e.hidden && e.getBoundingClientRect().height > 0), `no boot-error note when ${name}`, {});
    await c2.close();
  }
}
await layout();

await browser.close();
server.close();

console.log(`${states.length} states, ${checks} checks, ${failures.length} failures`);
for (const f of failures.slice(0, 60)) console.log('  ✗ ' + f);
if (failures.length > 60) console.log(`  … and ${failures.length - 60} more`);
process.exit(failures.length ? 1 : 0);
