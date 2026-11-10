/* What the page must show for a room, checked against a snapshot of it.
 *
 * Two runners share this file. test/page.test.mjs runs the built app.js in
 * Node against a stand-in DOM, on every push; test/browser-sweep.mjs drives
 * the same page in Chromium on the dev box. One grid of rooms and one set of
 * expectations, so neither can pass what the other would fail.
 *
 * Every displayed figure is parsed back and compared with an independent
 * computation from src/screen.js, and a set of cross-fact rules is checked
 * that must hold whatever the inputs: the headline and vertical grades agree
 * on 16:9, the pixel, eye and 20/20 facts agree with each other, the tables'
 * "you" rows agree with the headline, and so on.
 *
 * A snapshot is plain data, however the runner collects it:
 *   boot                 the boot-error note is hidden
 *   stale                the page is marked as not current
 *   fov, fovCls, sub     the headline figure, its grade class, the prose
 *   facts[k]             { main, sub, cls } for each fact slot
 *   fields[id]           the text in each form field
 *   pjHidden             the projector section is hidden
 *   you, eyeLabel        the lanes marker label and the eye-bar label
 *   lanes                how many bands the lanes chart drew
 *   targets, seats, sizes   table rows, each an array of trimmed cell texts
 *   sizesHere            the highlighted row of the sizes table
 *   matrixNote, matrixYou   the matrix note and the highlighted cell
 *   hash                 location.hash
 */
import * as s from '../src/screen.js';

export const FACTS = ['size', 'area', 'vfov', 'density', 'pixel', 'avg', 'res', 'eye', 'tilt', 'throw', 'lens', 'fl', 'width', 'top', 'bottom', 'max', 'stand'];
export const FIELDS = ['in-diag', 'in-resw', 'in-resh', 'in-dist', 'in-eye', 'in-centre', 'in-throw1', 'in-throw2', 'in-offset', 'in-gain', 'in-lumens'];

/* ---- the grid ------------------------------------------------------- */
export function states(quick = false) {
  const SIZES = quick ? [43, 65, 120] : [24, 43, 65, 85, 120, 200];
  const DISTS = quick ? [48, 108, 240] : [36, 72, 108, 180, 300];
  const ASPECTS = ['16:9', '2.39', '4:3'];
  const RES = ['1080', '2160', 'custom'];
  const out = [];
  for (const d of SIZES) for (const v of DISTS) for (const a of ASPECTS) for (const r of RES) {
    out.push({ d, v, a, r, rw: 2560, rh: 1080, e: 42, c: 42, u: 'i', m: 'tv', t1: 1.2, t2: 1.5, o: 50, l: 2000, g: 1 });
  }
  // Metric and projector variants, with placement and brightness spread out.
  let seed = 7;
  const rnd = () => (seed = (seed * 48271) % 2147483647) / 2147483647;
  const pick = arr => arr[Math.floor(rnd() * arr.length)];
  for (let i = 0; i < (quick ? 15 : 60); i++) {
    out.push({ d: pick(SIZES), v: pick(DISTS), a: pick(ASPECTS), r: pick(RES), rw: pick([1920, 2560, 3440, 5120]), rh: pick([1080, 1440, 2160]),
      e: pick([24, 42, 60]), c: pick([30, 42, 60, 90, 120]), u: pick(['i', 'm']), m: pick(['tv', 'pj']),
      t1: pick([0.8, 1.2, 1.5]), t2: pick([1.0, 1.5, 2.1]), o: pick([-20, 0, 50, 100]), l: pick([400, 1500, 3000]), g: pick([0.8, 1, 1.3]) });
  }
  /* Panels are rarely a whole number of inches (these are real ones), and a
     size the page rounds is a size it gets wrong. */
  for (const d of quick ? [54.6] : [23.8, 31.5, 54.6, 64.5]) for (const [v, u] of [[36, 'i'], [108, 'm']]) {
    out.push({ d, v, a: '16:9', r: '2160', rw: 2560, rh: 1080, e: 42, c: 42, u, m: 'tv', t1: 1.2, t2: 1.5, o: 50, l: 2000, g: 1 });
  }
  return out;
}

export const hashOf = st => '#' + Object.entries(st).map(([k, v]) => `${k}=${v}`).join('&');

/* ---- expectations, computed here, not in the page ------------------ */
const resOf = st => st.r === 'custom' ? { id: 'custom', w: st.rw, h: st.rh } : s.resolution(st.r);
const SMPTE = 30, THX_FAR = 26;
const grade = (good, ok) => good ? 'good' : ok ? 'ok' : 'warn';
const ppd95 = s.ppdForFraction(0.05);

/* Parse a displayed length back to inches. */
export function parseLen(text) {
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
export const num = text => +text.replace(/,/g, '').match(/-?[\d.]+/)[0];

/* Everything one valid room must show. `check(ok, message, st)` records it. */
export function checkState(p, st, check) {
  const close = (a, b, tol, msg) => check(Math.abs(a - b) <= tol, `${msg}: shown ${a}, expected ${b}`, st);
  const d = s.dims(st.d, s.aspect(st.a).ratio);
  const res = resOf(st);
  const fov = s.hfov(d, st.v), vf = s.vfov(d, st.v);
  const pitch = s.pixelPitch(d, res);
  const ppd = s.pixelsPerDegree(pitch, st.v);
  const limit = s.acuityDistance(pitch);
  const frac = s.noticeFraction(ppd);
  const pl = s.placement(d, st.v, st.e, st.c);

  check(p.boot, 'boot error shown', st);
  check(!p.stale, 'a valid room is marked stale', st);
  for (const [id, text] of Object.entries(p.fields)) {
    check(!/NaN|undefined|Infinity/.test(text), `field #${id} holds "${text}"`, st);
  }
  check(!/ ft 12(\.0)? in/.test(p.fields['in-dist']), `distance field reads "${p.fields['in-dist']}"`, st);
  for (const k of FACTS) if (st.m === 'pj' || !['throw', 'lens', 'fl', 'width'].includes(k)) {
    check(p.facts[k].main !== '' && p.facts[k].main !== '—', `fact "${k}" is not filled`, st);
  }

  // Headline
  close(num(p.fov), fov, 0.051, 'headline angle');
  const fovGrade = fov >= s.FRONT_ROW ? 'ok' : grade(fov >= SMPTE, fov >= THX_FAR);
  check(p.fovCls === fovGrade, `headline grade ${p.fovCls}, expected ${fovGrade} at ${fov.toFixed(1)}°`, st);
  check(p.sub.includes(s.describeAngle(fov).slice(0, 20)), `headline prose "${p.sub}"`, st);
  // Prose and colour must agree: red ⟺ the prose calls it a television or small.
  const prose = s.describeAngle(fov);
  check((fovGrade === 'warn') === /television|small picture/.test(prose), `prose/grade disagree: ${fovGrade} vs "${prose}"`, st);

  // Picture
  const [w, h] = p.facts.size.main.split('×').map(t => parseLen(t.trim()));
  close(w, d.width, lenTol(p.facts.size.main), 'width');
  close(h, d.height, lenTol(p.facts.size.main), 'height');
  close(num(p.facts.area.main), st.u === 'm' ? d.area * 0.00064516 : d.area / 144, st.u === 'm' ? 0.006 : 0.06, 'area');

  // Vertical angle: value, grade, and agreement with the headline on 16:9
  close(num(p.facts.vfov.main), vf, 0.051, 'vertical angle');
  const vGrade = vf >= s.verticalEquivalent(s.FRONT_ROW) ? 'ok' : grade(vf >= s.verticalEquivalent(SMPTE), vf >= s.verticalEquivalent(THX_FAR));
  check(p.facts.vfov.cls === vGrade, `vertical grade ${p.facts.vfov.cls}, expected ${vGrade}`, st);
  if (st.a === '16:9') check(p.facts.vfov.cls === p.fovCls, `on 16:9 the vertical grade (${p.facts.vfov.cls}) must match the headline (${p.fovCls})`, st);
  close(num(p.facts.vfov.sub), st.v / d.height, 0.006, 'picture heights');

  // Pixels
  close(num(p.facts.density.main), 1 / pitch, 0.51, 'ppi');
  close(num(p.facts.pixel.main), ppd, 0.051, 'ppd centre');
  const ppdGrade = x => grade(x >= ppd95, x >= 60);
  check(p.facts.pixel.cls === ppdGrade(ppd), `ppd grade ${p.facts.pixel.cls}, expected ${ppdGrade(ppd)} at ${ppd.toFixed(1)}`, st);
  const imgV = s.subtended(pitch * res.h, st.v);
  close(num(p.facts.avg.main), res.h / imgV, 0.051, 'ppd average');
  check(p.facts.avg.cls === ppdGrade(res.h / imgV), 'avg grade', st);
  close(num(p.facts.eye.main), Math.round(frac * 100), 0.5, 'eye percent');
  check(p.facts.eye.cls === grade(frac < 0.05, frac < 0.5), `eye grade ${p.facts.eye.cls}`, st);
  check((p.facts.eye.cls === 'good') === (p.facts.pixel.cls === 'good'), 'eye good ⟺ pixel good', st);
  const wasted = st.v > limit;
  check(/^(Past|Inside) /.test(p.facts.res.main) && p.facts.res.main.startsWith(wasted ? 'Past' : 'Inside'), `20/20 fact "${p.facts.res.main}" vs wasted=${wasted}`, st);
  close(parseLen(p.facts.res.main), limit, lenTol(p.facts.res.main), '20/20 limit distance');
  check(p.facts.res.cls === (wasted ? 'good' : 'warn'), `20/20 grade ${p.facts.res.cls}`, st);
  if (Math.abs(ppd - 60) > 0.2) check((p.facts.res.cls === 'good') === (p.facts.pixel.cls !== 'warn'), '20/20 green ⟺ ppd not red', st);

  // Eye line
  const tiltGrade = grade(pl.ok && Math.abs(pl.centre) <= 5, pl.ok);
  check(p.facts.tilt.cls === tiltGrade, `tilt grade ${p.facts.tilt.cls}, expected ${tiltGrade} at ${pl.centre.toFixed(1)}°`, st);
  if (Math.abs(pl.centre) >= 0.5) close(num(p.facts.tilt.main), Math.abs(pl.centre), 0.051, 'tilt angle');
  else check(p.facts.tilt.main === 'Level', 'level', st);

  // Lanes + eye bar
  close(parseLen(p.you), st.v, lenTol(p.you), 'lanes marker');
  check(p.lanes >= 9, `only ${p.lanes} lane bands`, st);
  close(num(p.eyeLabel), ppd, 0.051, 'eye-bar ppd');

  // Targets: met ⟺ seat at or beyond the distance shown
  const TARGET_PPD = [60, s.ppdForFraction(0.5), s.ppdForFraction(0.05)];
  check(p.targets.length === 3, `${p.targets.length} target rows`, st);
  p.targets.forEach((row, i) => {
    const dist = parseLen(row[2]);
    const want = s.distanceForPpd(pitch, TARGET_PPD[i]);
    close(num(row[1]), TARGET_PPD[i], 0.51, `target ${i} ppd`);
    close(dist, want, lenTol(row[2]), `target ${i} distance`);
    check((row[3] === 'met') === (st.v >= want), `target ${i}: "${row[3]}" with seat ${st.v} vs ${want.toFixed(1)}`, st);
  });

  // Seats table: the "Your seat" row carries the headline angle; sorted by distance
  const mine = p.seats.find(r => r[0].startsWith('Your seat'));
  check(!!mine, 'no Your seat row', st);
  if (mine) { close(num(mine[2]), fov, 0.051, 'seats row angle'); close(num(mine[3]), st.v / st.d, 0.006, 'seats × diagonal'); }
  const dists = p.seats.map(r => parseLen(r[1]));
  check(dists.every((x, i) => i === 0 || x >= dists[i - 1] - 0.6), 'seats sorted', st);
  /* The angle is computed from the exact distance, the distance is shown
     rounded: accept any angle the rounding interval could produce. */
  for (const r of p.seats) if (!r[0].startsWith('Your seat')) {
    const shown = parseLen(r[1]), tol = lenTol(r[1]);
    const lo = s.hfov(d, shown + tol), hi = s.hfov(d, Math.max(0.1, shown - tol));
    check(num(r[2]) >= lo - 0.06 && num(r[2]) <= hi + 0.06, `seats angle for ${r[0]}: ${num(r[2])} outside [${lo.toFixed(2)}, ${hi.toFixed(2)}]`, st);
  }
  // Each ITU row sits at the picture heights the standard publishes.
  for (const itu of s.ITU_STANDARDS) {
    const row = p.seats.find(r => r[0] === `${itu.label}${itu.heights} picture heights`);
    check(!!row, `no seats row for ${itu.label} at ${itu.heights} picture heights`, st);
    if (row) close(parseLen(row[1]), itu.heights * d.height, lenTol(row[1]), `${itu.short} distance`);
  }

  /* Sizes table: the "yours" row is the diagonal as entered, with the same
     picture and angle as the figures above it; pill agrees with the 20/20 fact. */
  check(!!p.sizesHere, 'no yours row', st);
  if (p.sizesHere) {
    close(num(p.sizesHere[0]), st.d, 0.051, 'sizes "yours" row diagonal');
    check(p.sizesHere[1] === p.facts.size.main, `sizes "yours" picture "${p.sizesHere[1]}" vs the Picture fact "${p.facts.size.main}"`, st);
    close(num(p.sizesHere[2]), fov, 0.051, 'sizes row angle');
    check((p.sizesHere[4] === 'hidden') === wasted, `sizes pill "${p.sizesHere[4]}" vs wasted=${wasted}`, st);
    check(p.sizesHere[3] === s.describeAngle(fov), 'sizes verdict', st);
  }
  for (const r of p.sizes) {
    const dd = s.dims(num(r[0]), d.ratio);
    close(num(r[2]), s.hfov(dd, st.v), 0.06, `sizes angle for ${r[0]}`);
    check((r[4] === 'hidden') === (st.v > s.acuityDistance(s.pixelPitch(dd, res))), `sizes pill for ${r[0]}`, st);
  }

  // Matrix: the highlighted cell is the model's answer and the note says so
  const lim = s.limitResolution(d, st.v);
  check(p.matrixYou === (lim ? lim.label : '>32K'), `matrix you cell "${p.matrixYou}" vs ${lim ? lim.label : '>32K'}`, st);
  check(p.matrixNote.startsWith(lim ? lim.label : 'beyond 32K'), `matrix note "${p.matrixNote}"`, st);

  // Placement facts
  close(parseLen(p.facts.top.sub), st.c + d.height / 2, lenTol(p.facts.top.sub), 'top height');
  close(parseLen(p.facts.bottom.sub), st.c - d.height / 2, lenTol(p.facts.bottom.sub), 'bottom height');
  close(parseLen(p.facts.max.main), pl.maxCentre, lenTol(p.facts.max.main), 'max centre');
  close(parseLen(p.facts.stand.main), pl.bottomEdge, lenTol(p.facts.stand.main), 'stand');
  if (Math.abs(pl.top) >= 0.5) close(num(p.facts.top.main), Math.abs(pl.top), 0.051, 'top angle');

  // Projector
  check(p.pjHidden === (st.m !== 'pj'), 'projector section visibility', st);
  if (st.m === 'pj') {
    const t1 = Math.min(st.t1, st.t2), t2 = Math.max(st.t1, st.t2);
    const parts = p.facts.throw.main.split('–').map(t => parseLen(t.trim()));
    close(parts[0], d.width * t1, lenTol(p.facts.throw.main), 'throw near');
    close(parts[parts.length - 1], d.width * t2, lenTol(p.facts.throw.main), 'throw far');
    close(parseLen(p.facts.lens.main), st.c - d.height * st.o / 100, lenTol(p.facts.lens.main), 'lens height');
    const fl = s.footLamberts(st.l, st.g, d);
    close(num(p.facts.fl.main), fl, 0.051, 'foot-lamberts');
    check(p.facts.fl.cls === (fl < s.BRIGHTNESS.cinema ? 'warn' : fl >= s.BRIGHTNESS.sdrHome ? 'good' : 'ok'), `fL grade ${p.facts.fl.cls} at ${fl.toFixed(1)}`, st);
    const wp = p.facts.width.main.split('–').map(t => parseLen(t.trim()));
    close(wp[0], st.v / t2, lenTol(p.facts.width.main), 'image width near');
    // "a 96–120 in diagonal": the diagonals those widths make at this shape.
    const dg = p.facts.width.sub.match(/a ([\d,]+)(?:–([\d,]+))? in diagonal/);
    check(!!dg, `image width sub "${p.facts.width.sub}"`, st);
    if (dg) close(num(dg[1]), s.diagonalForWidth(st.v / t2, d.ratio), 0.51, 'image diagonal near');
  }

  // The hash round-trips every input
  for (const [k, v] of Object.entries(st)) {
    const got = new URLSearchParams(p.hash.slice(1)).get(k);
    check(got !== null && (isNaN(+v) ? got === String(v) : Math.abs(+got - +v) < 1e-6), `hash lost ${k}=${v} (got ${got})`, st);
  }
}

/* ---- what a person may type ----------------------------------------- */

/* The room the typing cases start from: imperial, projector mode and a
   custom panel, so every field is live. */
export const TYPING_ROOM = { d: 65, a: '16:9', r: 'custom', rw: 2560, rh: 1080, v: 108, e: 42, c: 42, u: 'i', m: 'pj', t1: 1.2, t2: 1.5, o: 50, l: 2000, g: 1 };

/* [field, hash key, [typed, value the hash must then hold]]. null means the
   field must be marked invalid instead: an entry that could mean two things
   is refused, never guessed. */
export const TYPED = [
  ['in-dist', 'v', [
    ["8'6\"", 102], ['8′6″', 102], ['8 ft 6 in', 102], ['8ft 6', 102], ['8 6', 102], ['8.5', 102], ['2.6 m', 102.362], ['260 cm', 102.362], ['102 in', 102],
    ['2,6 m', 102.362], ['8,5', 102],
    // A decimal on its way to being typed is the number so far.
    ['8.', 96], ['8 ft 6.', 102], ['.5', 6],
    // Ten metres or one centimetre: nobody can say.
    ['1,000 cm', null], ['1,000', null],
    ['8.5.5', null], ['8..5', null], ['6 in 3', null], ['abc', null], ['', null], ['0', null], ['-8', null],
  ]],
  ['in-diag', 'd', [['65', 65], ['65"', 65], ['65 in', 65], ['165 cm', 64.961], ['54.6', 54.6], ['54,6', 54.6], ['big', null]]],
  ['in-eye', 'e', [['42', 42], ['3 ft 6 in', 42], ['107 cm', 42.126], ['0', 0], ['four', null]]],
  // One comma is a decimal point, never a thousands separator to drop.
  ['in-throw1', 't1', [['1.2', 1.2], ['1,2', 1.2], ['1.', 1], ['.8', 0.8], ['1,2,3', null], ['1.2.3', null], ['-1', null], ['wide', null]]],
  ['in-throw2', 't2', [['1,5', 1.5], ['2', 2]]],
  ['in-gain', 'g', [['1,3', 1.3], ['0.8', 0.8], ['1', 1], ['0', null]]],
  ['in-offset', 'o', [['50', 50], ['50%', 50], ['-20', -20], ['12,5', 12.5], ['-12.5', -12.5], ['0', 0], ['-', null], ['up', null]]],
  // Whole numbers: plain digits or properly grouped thousands, nothing else.
  ['in-lumens', 'l', [['2000', 2000], ['2,000', 2000], ['2.000', 2000], ['2 000', 2000], ['12,500', 12500], ['2,5', null], ['1.50', null], ['20,00', null], ['1,000.000', null], ['0,500', null], ['bright', null]]],
  ['in-resw', 'rw', [['3440', 3440], ['3,440', 3440], ['3440.5', null], ['8', null]]],
  ['in-resh', 'rh', [['1440', 1440], ['1 440', 1440], ['1,44', null]]],
];

/* [inches, the text the distance field must show in feet and inches]. The
   inches round to a tenth, and a remainder that rounds to twelve carries. */
export const CARRY = [[108, '9'], [102, '8 ft 6 in'], [119.94, '9 ft 11.9 in'], [119.97, '10'], [227.97, '19'], [11.97, '1']];
