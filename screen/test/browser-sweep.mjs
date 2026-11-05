#!/usr/bin/env node
/* Drive the BUILT page through a grid of inputs and check what it shows.
 *
 * The unit tests cover the maths module; this covers the page script, where
 * the grading rules, formatting, parsing and hash handling live — and where
 * the vertical-angle grade was wrong for weeks without a test noticing.
 * Every displayed figure is parsed back and compared with an independent
 * computation, and a set of cross-fact rules is checked that must hold
 * whatever the inputs: the headline and vertical grades agree on 16:9, the
 * pixel, eye and 20/20 facts agree with each other, the tables' "you" rows
 * agree with the headline, and so on.
 *
 * Needs Chromium via Playwright (installed on the dev box, not in CI):
 *   node scripts/build.mjs && node test/browser-sweep.mjs [--quick]
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as s from '../src/screen.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = process.env.OUT_DIR ? path.resolve(process.env.OUT_DIR) : path.join(root, '..', 'dist');
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

/* ---- the grid ------------------------------------------------------- */
const SIZES = quick ? [43, 65, 120] : [24, 43, 65, 85, 120, 200];
const DISTS = quick ? [48, 108, 240] : [36, 72, 108, 180, 300];
const ASPECTS = ['16:9', '2.39', '4:3'];
const RES = ['1080', '2160', 'custom'];
const states = [];
for (const d of SIZES) for (const v of DISTS) for (const a of ASPECTS) for (const r of RES) {
  states.push({ d, v, a, r, rw: 2560, rh: 1080, e: 42, c: 42, u: 'i', m: 'tv', t1: 1.2, t2: 1.5, o: 50, l: 2000, g: 1 });
}
// Metric and projector variants, with placement and brightness spread out.
let seed = 7;
const rnd = () => (seed = (seed * 48271) % 2147483647) / 2147483647;
const pick = arr => arr[Math.floor(rnd() * arr.length)];
for (let i = 0; i < (quick ? 15 : 60); i++) {
  states.push({ d: pick(SIZES), v: pick(DISTS), a: pick(ASPECTS), r: pick(RES), rw: pick([1920, 2560, 3440, 5120]), rh: pick([1080, 1440, 2160]),
    e: pick([24, 42, 60]), c: pick([30, 42, 60, 90, 120]), u: pick(['i', 'm']), m: pick(['tv', 'pj']),
    t1: pick([0.8, 1.2, 1.5]), t2: pick([1.0, 1.5, 2.1]), o: pick([-20, 0, 50, 100]), l: pick([400, 1500, 3000]), g: pick([0.8, 1, 1.3]) });
}

/* ---- expectations, computed here, not in the page ------------------ */
const resOf = st => st.r === 'custom' ? { id: 'custom', w: st.rw, h: st.rh } : s.resolution(st.r);
const SMPTE = 30, THX_FAR = 26;
const grade = (good, ok) => good ? 'good' : ok ? 'ok' : 'warn';
const ppd95 = s.ppdForFraction(0.05);

/* Parse a displayed length back to inches. */
function parseLen(text, metric) {
  const t = text.replace(/,/g, '');
  let m;
  if ((m = t.match(/(-?[\d.]+) ft(?: ([\d.]+) in)?/))) return +m[1] * 12 + (m[2] ? +m[2] : 0);
  if ((m = t.match(/(-?[\d.]+) in\b/))) return +m[1];
  if ((m = t.match(/(-?[\d.]+) m\b/))) return +m[1] * 100 / 2.54;
  if ((m = t.match(/(-?[\d.]+) cm\b/))) return +m[1] / 2.54;
  throw new Error(`cannot parse length "${text}"`);
}
/* How coarse the display is at that magnitude, in inches. */
const lenTol = (text) => / ft/.test(text) ? 0.51 : / in\b/.test(text) ? 0.06 : / m\b/.test(text) ? 0.21 : /\.\d cm/.test(text) ? 0.03 : 0.21;
const num = text => +text.replace(/,/g, '').match(/-?[\d.]+/)[0];

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
const close = (a, b, tol, msg, st) => check(Math.abs(a - b) <= tol, `${msg}: shown ${a}, expected ${b}`, st);

const hashOf = st => '#' + Object.entries(st).map(([k, v]) => `${k}=${v}`).join('&');

async function readPage() {
  return page.evaluate(() => {
    const $ = id => document.getElementById(id);
    const fact = k => ({ cls: ($('fact-' + k).className.match(/good|ok|warn/) || [''])[0], main: $('sum-' + k).textContent, sub: $('sub-' + k).textContent });
    const rows = sel => [...document.querySelectorAll(sel)].map(tr => [...tr.children].map(td => td.textContent.trim()));
    return {
      boot: $('boot-error').hidden,
      fov: $('out-fov').textContent, fovCls: ($('out-total').className.match(/good|ok|warn/) || [''])[0], sub: $('out-sub').textContent,
      facts: Object.fromEntries(['size', 'area', 'vfov', 'density', 'pixel', 'avg', 'res', 'eye', 'tilt', 'throw', 'lens', 'fl', 'width', 'top', 'bottom', 'max', 'stand'].map(k => [k, fact(k)])),
      pjHidden: $('pj-section').hidden,
      you: [...document.querySelectorAll('#lanes text.you-lbl')].map(t => t.textContent)[0],
      eyeLabel: [...document.querySelectorAll('#eye-bar text.eye-pct')].map(t => t.textContent)[0],
      targets: rows('#targets tr'),
      seats: rows('#seats tr'),
      sizes: rows('#sizes tr'),
      sizesHere: rows('#sizes tr.here')[0],
      matrixNote: $('matrix-note').textContent,
      matrixYou: document.querySelector('#matrix td.you')?.textContent,
      matrixRow: [...document.querySelectorAll('#matrix tbody tr')].find(tr => tr.querySelector('th.you'))?.querySelectorAll('td').length,
      hash: location.hash,
      lanes: [...document.querySelectorAll('#lanes rect.band')].length,
    };
  });
}

for (const st of states) {
  await page.evaluate(h => { location.hash = h; }, hashOf(st));
  await page.waitForTimeout(40);
  const p = await readPage();
  const metric = st.u === 'm';
  const d = s.dims(st.d, s.aspect(st.a).ratio);
  const res = resOf(st);
  const fov = s.hfov(d, st.v), vf = s.vfov(d, st.v);
  const pitch = s.pixelPitch(d, res);
  const ppd = s.pixelsPerDegree(pitch, st.v);
  const limit = s.acuityDistance(pitch);
  const frac = s.noticeFraction(ppd);
  const pl = s.placement(d, st.v, st.e, st.c);

  check(p.boot, 'boot error shown', st);
  check(pageErrors.length === 0, `page errors: ${pageErrors.join(' | ')}`, st);
  pageErrors.length = 0;

  // Headline
  close(num(p.fov), fov, 0.051, 'headline angle', st);
  const fovGrade = fov >= s.FRONT_ROW ? 'ok' : grade(fov >= SMPTE, fov >= THX_FAR);
  check(p.fovCls === fovGrade, `headline grade ${p.fovCls}, expected ${fovGrade} at ${fov.toFixed(1)}°`, st);
  check(p.sub.includes(s.describeAngle(fov).slice(0, 20)), `headline prose "${p.sub}"`, st);
  // Prose and colour must agree: red ⟺ the prose calls it a television or small.
  const prose = s.describeAngle(fov);
  check((fovGrade === 'warn') === /television|small picture/.test(prose), `prose/grade disagree: ${fovGrade} vs "${prose}"`, st);

  // Picture
  const [w, h] = p.facts.size.main.split('×').map(t => parseLen(t.trim(), metric));
  close(w, d.width, lenTol(p.facts.size.main), 'width', st);
  close(h, d.height, lenTol(p.facts.size.main), 'height', st);
  close(num(p.facts.area.main), metric ? d.area * 0.00064516 : d.area / 144, metric ? 0.006 : 0.06, 'area', st);

  // Vertical angle: value, grade, and agreement with the headline on 16:9
  close(num(p.facts.vfov.main), vf, 0.051, 'vertical angle', st);
  const vGrade = vf >= s.verticalEquivalent(s.FRONT_ROW) ? 'ok' : grade(vf >= s.verticalEquivalent(SMPTE), vf >= s.verticalEquivalent(THX_FAR));
  check(p.facts.vfov.cls === vGrade, `vertical grade ${p.facts.vfov.cls}, expected ${vGrade}`, st);
  if (st.a === '16:9') check(p.facts.vfov.cls === p.fovCls, `on 16:9 the vertical grade (${p.facts.vfov.cls}) must match the headline (${p.fovCls})`, st);
  close(num(p.facts.vfov.sub), st.v / d.height, 0.006, 'picture heights', st);

  // Pixels
  close(num(p.facts.density.main), 1 / pitch, 0.51, 'ppi', st);
  close(num(p.facts.pixel.main), ppd, 0.051, 'ppd centre', st);
  const ppdGrade = x => grade(x >= ppd95, x >= 60);
  check(p.facts.pixel.cls === ppdGrade(ppd), `ppd grade ${p.facts.pixel.cls}, expected ${ppdGrade(ppd)} at ${ppd.toFixed(1)}`, st);
  const imgV = s.subtended(pitch * res.h, st.v);
  close(num(p.facts.avg.main), res.h / imgV, 0.051, 'ppd average', st);
  check(p.facts.avg.cls === ppdGrade(res.h / imgV), 'avg grade', st);
  close(num(p.facts.eye.main), Math.round(frac * 100), 0.5, 'eye percent', st);
  check(p.facts.eye.cls === grade(frac < 0.05, frac < 0.5), `eye grade ${p.facts.eye.cls}`, st);
  check((p.facts.eye.cls === 'good') === (p.facts.pixel.cls === 'good'), 'eye good ⟺ pixel good', st);
  const wasted = st.v > limit;
  check(/^(Past|Inside) /.test(p.facts.res.main) && p.facts.res.main.startsWith(wasted ? 'Past' : 'Inside'), `20/20 fact "${p.facts.res.main}" vs wasted=${wasted}`, st);
  close(parseLen(p.facts.res.main, metric), limit, lenTol(p.facts.res.main), '20/20 limit distance', st);
  check(p.facts.res.cls === (wasted ? 'good' : 'warn'), `20/20 grade ${p.facts.res.cls}`, st);
  if (Math.abs(ppd - 60) > 0.2) check((p.facts.res.cls === 'good') === (p.facts.pixel.cls !== 'warn'), '20/20 green ⟺ ppd not red', st);

  // Eye line
  const tiltGrade = grade(pl.ok && Math.abs(pl.centre) <= 5, pl.ok);
  check(p.facts.tilt.cls === tiltGrade, `tilt grade ${p.facts.tilt.cls}, expected ${tiltGrade} at ${pl.centre.toFixed(1)}°`, st);
  if (Math.abs(pl.centre) >= 0.5) close(num(p.facts.tilt.main), Math.abs(pl.centre), 0.051, 'tilt angle', st);
  else check(p.facts.tilt.main === 'Level', 'level', st);

  // Lanes + eye bar
  close(parseLen(p.you, metric), st.v, lenTol(p.you), 'lanes marker', st);
  check(p.lanes >= 9, `only ${p.lanes} lane bands`, st);
  close(num(p.eyeLabel), ppd, 0.051, 'eye-bar ppd', st);

  // Targets: met ⟺ seat at or beyond the distance shown
  const TARGET_PPD = [60, s.ppdForFraction(0.5), s.ppdForFraction(0.05)];
  check(p.targets.length === 3, `${p.targets.length} target rows`, st);
  p.targets.forEach((row, i) => {
    const dist = parseLen(row[2], metric);
    const want = s.distanceForPpd(pitch, TARGET_PPD[i]);
    close(num(row[1]), TARGET_PPD[i], 0.51, `target ${i} ppd`, st);
    close(dist, want, lenTol(row[2]), `target ${i} distance`, st);
    check((row[3] === 'met') === (st.v >= want), `target ${i}: "${row[3]}" with seat ${st.v} vs ${want.toFixed(1)}`, st);
  });

  // Seats table: the "Your seat" row carries the headline angle; sorted by distance
  const mine = p.seats.find(r => r[0].startsWith('Your seat'));
  check(!!mine, 'no Your seat row', st);
  if (mine) { close(num(mine[2]), fov, 0.051, 'seats row angle', st); close(num(mine[3]), st.v / st.d, 0.006, 'seats × diagonal', st); }
  const dists = p.seats.map(r => parseLen(r[1], metric));
  check(dists.every((x, i) => i === 0 || x >= dists[i - 1] - 0.6), 'seats sorted', st);
  /* The angle is computed from the exact distance, the distance is shown
     rounded: accept any angle the rounding interval could produce. */
  for (const r of p.seats) if (!r[0].startsWith('Your seat')) {
    const shown = parseLen(r[1], metric), tol = lenTol(r[1]);
    const lo = s.hfov(d, shown + tol), hi = s.hfov(d, Math.max(0.1, shown - tol));
    check(num(r[2]) >= lo - 0.06 && num(r[2]) <= hi + 0.06, `seats angle for ${r[0].split('\n')[0]}: ${num(r[2])} outside [${lo.toFixed(2)}, ${hi.toFixed(2)}]`, st);
  }

  // Sizes table: the "yours" row agrees with the headline; pill agrees with the 20/20 fact
  check(!!p.sizesHere, 'no yours row', st);
  if (p.sizesHere) {
    close(num(p.sizesHere[2]), fov, 0.06, 'sizes row angle', st);
    check((p.sizesHere[4] === 'hidden') === wasted, `sizes pill "${p.sizesHere[4]}" vs wasted=${wasted}`, st);
    check(p.sizesHere[3] === s.describeAngle(fov), 'sizes verdict', st);
  }
  for (const r of p.sizes) {
    const dd = s.dims(num(r[0]), d.ratio);
    close(num(r[2]), s.hfov(dd, st.v), 0.06, `sizes angle for ${r[0]}`, st);
    check((r[4] === 'hidden') === (st.v > s.acuityDistance(s.pixelPitch(dd, res))), `sizes pill for ${r[0]}`, st);
  }

  // Matrix: the highlighted cell is the model's answer and the note says so
  const lim = s.limitResolution(d, st.v);
  check(p.matrixYou === (lim ? lim.label : '>32K'), `matrix you cell "${p.matrixYou}" vs ${lim ? lim.label : '>32K'}`, st);
  check(p.matrixNote.startsWith(lim ? lim.label : 'beyond 32K'), `matrix note "${p.matrixNote}"`, st);

  // Placement facts
  close(parseLen(p.facts.top.sub, metric), st.c + d.height / 2, lenTol(p.facts.top.sub), 'top height', st);
  close(parseLen(p.facts.bottom.sub, metric), st.c - d.height / 2, lenTol(p.facts.bottom.sub), 'bottom height', st);
  close(parseLen(p.facts.max.main, metric), pl.maxCentre, lenTol(p.facts.max.main), 'max centre', st);
  close(parseLen(p.facts.stand.main, metric), pl.bottomEdge, lenTol(p.facts.stand.main), 'stand', st);
  if (Math.abs(pl.top) >= 0.5) close(num(p.facts.top.main), Math.abs(pl.top), 0.051, 'top angle', st);

  // Projector
  check(p.pjHidden === (st.m !== 'pj'), 'projector section visibility', st);
  if (st.m === 'pj') {
    const t1 = Math.min(st.t1, st.t2), t2 = Math.max(st.t1, st.t2);
    const parts = p.facts.throw.main.split('–').map(t => parseLen(t.trim(), metric));
    close(parts[0], d.width * t1, lenTol(p.facts.throw.main), 'throw near', st);
    close(parts[parts.length - 1], d.width * t2, lenTol(p.facts.throw.main), 'throw far', st);
    close(parseLen(p.facts.lens.main, metric), st.c - d.height * st.o / 100, lenTol(p.facts.lens.main), 'lens height', st);
    const fl = s.footLamberts(st.l, st.g, d);
    close(num(p.facts.fl.main), fl, 0.051, 'foot-lamberts', st);
    check(p.facts.fl.cls === (fl < s.BRIGHTNESS.cinema ? 'warn' : fl >= s.BRIGHTNESS.sdrHome ? 'good' : 'ok'), `fL grade ${p.facts.fl.cls} at ${fl.toFixed(1)}`, st);
    const wp = p.facts.width.main.split('–').map(t => parseLen(t.trim(), metric));
    close(wp[0], st.v / t2, lenTol(p.facts.width.main), 'image width near', st);
  }

  // The hash round-trips every input
  for (const [k, v] of Object.entries(st)) {
    const got = new URLSearchParams(p.hash.slice(1)).get(k);
    check(got !== null && (isNaN(+v) ? got === String(v) : Math.abs(+got - +v) < 1e-6), `hash lost ${k}=${v} (got ${got})`, st);
  }
}

/* ---- interactions ---------------------------------------------------- */
async function interact() {
  const st = { d: 65, a: '16:9', r: '2160', v: 108, e: 42, c: 42, u: 'i', m: 'tv' };
  await page.evaluate(h => { location.hash = h; }, hashOf(st));
  await page.waitForTimeout(40);
  const fovBefore = num(await page.textContent('#out-fov'));

  // Typed lengths in every accepted form give the same answer.
  for (const [typed, inches] of [["8'6\"", 102], ['8 ft 6 in', 102], ['8ft 6', 102], ['8.5', 102], ['2.6 m', 102.36], ['260 cm', 102.36], ['102 in', 102], ['2,6 m', 102.36]]) {
    await page.fill('#in-dist', typed); await page.waitForTimeout(120);
    const got = new URLSearchParams((await page.evaluate(() => location.hash)).slice(1)).get('v');
    check(Math.abs(+got - inches) < 0.01, `typing "${typed}" stored v=${got}, expected ${inches}`, { typed });
  }
  // Diagonal with a unit
  for (const [typed, inches] of [['65', 65], ['65"', 65], ['65 in', 65], ['165 cm', 64.96]]) {
    await page.fill('#in-diag', typed); await page.waitForTimeout(120);
    const got = new URLSearchParams((await page.evaluate(() => location.hash)).slice(1)).get('d');
    check(Math.abs(+got - inches) < 0.01, `diagonal "${typed}" stored d=${got}`, { typed });
  }
  // Invalid input shows a dash and names the field; recovery works.
  await page.fill('#in-diag', 'big'); await page.waitForTimeout(120);
  check((await page.textContent('#out-fov')) === '—', 'invalid diagonal should blank the headline', {});
  check(await page.$eval('#in-diag', e => e.closest('.field').classList.contains('invalid')), 'invalid field flagged', {});
  await page.fill('#in-diag', '65'); await page.waitForTimeout(120);
  check(Math.abs(num(await page.textContent('#out-fov')) - s.hfov(s.dims(65, 16 / 9), 102.36)) < 0.06, 'recovers after invalid', {});

  // Unit toggle round-trips within rounding and switches every adornment.
  await page.fill('#in-dist', '9'); await page.waitForTimeout(120);
  await page.click('#unit-metric'); await page.waitForTimeout(120);
  check((await page.textContent('#in-dist-unit')) === 'm' && (await page.textContent('#in-eye-unit')) === 'cm', 'metric adornments', {});
  check(/cm/.test(await page.textContent('#sum-size')), 'metric picture', {});
  const vMetric = +new URLSearchParams((await page.evaluate(() => location.hash)).slice(1)).get('v');
  check(Math.abs(vMetric - 108) < 0.25, `distance after metric switch ${vMetric}`, {});
  await page.click('#unit-imperial'); await page.waitForTimeout(120);
  const vBack = +new URLSearchParams((await page.evaluate(() => location.hash)).slice(1)).get('v');
  check(Math.abs(vBack - 108) < 0.6, `distance after switching back ${vBack}`, {});
  check(Math.abs(num(await page.textContent('#out-fov')) - fovBefore) < 0.06, 'headline survives a unit round-trip', {});

  // Custom resolution and the "this screen" button.
  await page.selectOption('#in-res', 'custom'); await page.waitForTimeout(120);
  check(!(await page.$eval('#custom-res', e => e.hidden)), 'custom fields appear', {});
  await page.fill('#in-resw', '3440'); await page.fill('#in-resh', '1440'); await page.waitForTimeout(120);
  check(/3,440 × 1,440/.test(await page.textContent('#sub-density')) || /3440 × 1440/.test(await page.textContent('#sub-density')), 'custom panel named', {});
  await page.click('#btn-this'); await page.waitForTimeout(120);
  check((await page.inputValue('#in-resw')) === '1280' && (await page.inputValue('#in-resh')) === '900', 'this-screen fills the viewport pixels', {});
  await page.selectOption('#in-res', '2160'); await page.waitForTimeout(120);
  check(await page.$eval('#custom-res', e => e.hidden), 'custom fields hide again', {});

  // Projector mode shows the section; reset restores the example.
  await page.click('#mode-pj'); await page.waitForTimeout(120);
  check(!(await page.$eval('#pj-section', e => e.hidden)), 'projector section shows', {});
  await page.click('#btn-reset'); await page.waitForTimeout(120);
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
    await c2.close();
  }
}
await interact();

await browser.close();
server.close();

console.log(`${states.length} states, ${checks} checks, ${failures.length} failures`);
for (const f of failures.slice(0, 60)) console.log('  ✗ ' + f);
if (failures.length > 60) console.log(`  … and ${failures.length - 60} more`);
process.exit(failures.length ? 1 : 0);
