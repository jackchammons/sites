/* A sweep over the whole input range. The unit tests pin a handful of
   known answers; this file checks the relationships that must hold for
   every size, shape, resolution and distance — inverses round-trip, orders
   are monotonic, independently-written formulas agree — and pins every
   cell of the Cambridge resolution matrix, not just a sample. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as s from '../src/screen.js';

const DEG = Math.PI / 180;
const M = 100 / 2.54;                                      // inches per metre
const SIZES = [10, 15, 24, 32, 43, 55, 65, 77, 85, 100, 120, 150, 200, 300];
const DISTS = [6, 12, 24, 36, 48, 72, 96, 120, 180, 240, 360, 600, 1200];
const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg}: ${a} vs ${b}`);
const rel = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol * Math.max(Math.abs(a), Math.abs(b), 1e-12), `${msg}: ${a} vs ${b}`);

/* Independent derivations, written differently from the module. */
const widthFromDiag = (D, r) => D * r / Math.hypot(r, 1);
const angleOf = (span, d) => 2 * Math.atan2(span / 2, d) / DEG;
const ppdOf = (pitch, d) => 1 / (2 * Math.atan(pitch / (2 * d)) / DEG);

test('dims: width, height and diagonal agree with Pythagoras for every size and shape', () => {
  for (const D of SIZES) for (const a of s.ASPECTS) {
    const d = s.dims(D, a.ratio);
    rel(Math.hypot(d.width, d.height), D, 1e-12, `${D}" ${a.id} diagonal`);
    rel(d.width / d.height, a.ratio, 1e-12, `${D}" ${a.id} ratio`);
    rel(d.width, widthFromDiag(D, a.ratio), 1e-12, `${D}" ${a.id} width`);
    rel(d.area, d.width * d.height, 1e-12, `${D}" ${a.id} area`);
    rel(s.diagonalForWidth(d.width, a.ratio), D, 1e-12, `${D}" ${a.id} diagonalForWidth`);
  }
});

test('angles: hfov/vfov match an independent formula and invert exactly', () => {
  for (const D of SIZES) for (const a of s.ASPECTS) for (const dist of DISTS) {
    const d = s.dims(D, a.ratio);
    const h = s.hfov(d, dist), v = s.vfov(d, dist);
    rel(h, angleOf(d.width, dist), 1e-12, `hfov ${D}" ${a.id} @${dist}`);
    rel(v, angleOf(d.height, dist), 1e-12, `vfov ${D}" ${a.id} @${dist}`);
    assert.ok(h > 0 && h < 180 && v > 0 && v < 180, 'angles in range');
    assert.ok(v < h === a.ratio > 1, 'the long side subtends more');
    rel(s.distanceForAngle(d.width, h), dist, 1e-10, `distanceForAngle ${D}" ${a.id} @${dist}`);
    rel(s.diagonalForAngle(dist, h, a.ratio), D, 1e-10, `diagonalForAngle ${D}" ${a.id} @${dist}`);
    rel(s.verticalEquivalent(h, a.ratio), v, 1e-10, `verticalEquivalent ${D}" ${a.id} @${dist}`);
  }
  assert.equal(s.subtended(10, 0), 180);
});

test('angles fall as distance grows and rise with size, for every shape', () => {
  for (const a of s.ASPECTS) {
    for (const D of SIZES) {
      const d = s.dims(D, a.ratio);
      for (let i = 1; i < DISTS.length; i++) assert.ok(s.hfov(d, DISTS[i]) < s.hfov(d, DISTS[i - 1]), 'hfov monotone in distance');
    }
    for (const dist of DISTS) {
      for (let i = 1; i < SIZES.length; i++) assert.ok(s.hfov(s.dims(SIZES[i], a.ratio), dist) > s.hfov(s.dims(SIZES[i - 1], a.ratio), dist), 'hfov monotone in size');
    }
  }
});

test('seating standards: each distance reproduces its angle; order is THX best < THX < SMPTE < THX far', () => {
  for (const D of SIZES) for (const a of s.ASPECTS) {
    const d = s.dims(D, a.ratio);
    const rows = s.seatingDistances(d);
    for (const r of rows) rel(s.hfov(d, r.distance), r.angle, 1e-10, `${r.id} on ${D}" ${a.id}`);
    for (let i = 1; i < rows.length; i++) assert.ok(rows[i].distance > rows[i - 1].distance, 'standards ordered by distance');
    if (a.id === '16:9') rel(rows[0].distance / D, 1.2, 0.005, 'THX 40° is 1.2× the diagonal on 16:9 (THX rounds 1.197)');
  }
});

test('ITU distances: picture heights and the implied angle', () => {
  for (const D of SIZES) {
    const d = s.dims(D, 16 / 9);
    for (const r of s.ituDistances(d)) {
      rel(r.distance, r.heights * d.height, 1e-12, `${r.id} distance`);
      rel(r.angle, angleOf(d.width, r.distance), 1e-12, `${r.id} angle`);
    }
    const hd = s.ituDistances(d).find(r => r.id === 'itu-hd');
    near(hd.angle, 31.0, 0.1, 'HD at 3.2H is a 31° picture on 16:9');
  }
});

test('pixels: pitch fits the panel inside the picture; ppd matches an independent formula; acuity inverts', () => {
  for (const D of SIZES) for (const a of s.ASPECTS) for (const r of [...s.RESOLUTIONS, ...s.MATRIX_RESOLUTIONS]) {
    const d = s.dims(D, a.ratio);
    const pitch = s.pixelPitch(d, r);
    assert.ok(pitch * r.w <= d.width * (1 + 1e-12) && pitch * r.h <= d.height * (1 + 1e-12), `panel fits ${D}" ${a.id} ${r.label}`);
    assert.ok(Math.abs(pitch * r.w - d.width) < 1e-9 || Math.abs(pitch * r.h - d.height) < 1e-9, `panel touches one edge ${D}" ${a.id} ${r.label}`);
    for (const dist of DISTS) {
      const ppd = s.pixelsPerDegree(pitch, dist);
      rel(ppd, ppdOf(pitch, dist), 1e-12, 'ppd formula');
      rel(s.distanceForPpd(pitch, ppd), dist, 1e-9, 'distanceForPpd inverts pixelsPerDegree');
      rel(s.pixelAngle(pitch, dist) * ppd, 1, 1e-12, 'pixelAngle × ppd = 1');
    }
    // At the acuity distance one pixel subtends one arc-minute, i.e. 60 px/°.
    const lim = s.acuityDistance(pitch);
    near(s.pixelsPerDegree(pitch, lim), 60, 1e-4, `60 px/° at the 20/20 limit ${D}" ${r.label}`);
    const dens = s.pixelDensity(pitch);
    rel(dens.ppi * pitch, 1, 1e-12, 'ppi × pitch = 1'); rel(dens.mm, pitch * 25.4, 1e-12, 'mm pitch');
  }
});

test('acuity table: sharper panels keep their pixels hidden from closer; the known 16:9 multiples hold', () => {
  for (const D of SIZES) {
    const t = s.acuityTable(s.dims(D, 16 / 9));
    for (let i = 1; i < t.length; i++) if (t[i].w > t[i - 1].w) assert.ok(t[i].distance < t[i - 1].distance, 'more pixels → shorter limit');
    const by = id => t.find(r => r.id === id).distance / D;
    near(by('1080'), 1.56, 0.005, '1080p limit is 1.56× the diagonal');
    near(by('2160'), 0.78, 0.005, '4K limit is 0.78× the diagonal');
    near(by('4320'), 0.39, 0.005, '8K limit is 0.39× the diagonal');
    near(by('720'), 2.34, 0.005, '720p limit is 2.34× the diagonal');
  }
});

test('describeResolution: wasted exactly when ppd exceeds 60; `lower` is the lowest rung already merged', () => {
  for (const D of SIZES) for (const r of s.RESOLUTIONS) for (const dist of DISTS) {
    const d = s.dims(D, 16 / 9);
    const v = s.describeResolution(d, r, dist);
    const ppd = s.pixelsPerDegree(v.pitch, dist);
    if (Math.abs(ppd - 60) > 1e-6) assert.equal(v.wasted, ppd > 60, `wasted ⟺ ppd>60 (${D}" ${r.label} @${dist}: ${ppd})`);
    if (v.lower) {
      assert.ok(v.lower.w < r.w, 'lower is lower');
      assert.ok(dist >= v.lower.limit, 'lower is already merged');
      for (const o of s.RESOLUTIONS) if (o.w < v.lower.w) assert.ok(dist < s.acuityDistance(s.pixelPitch(d, o)), 'nothing lower is merged');
    } else {
      for (const o of s.RESOLUTIONS) if (o.w < r.w) assert.ok(dist < s.acuityDistance(s.pixelPitch(d, o)), 'no lower rung merged when lower is undefined');
    }
  }
});

test('eye-limit model: CDF, inverse and the fraction/ppd pair are consistent and monotone', () => {
  for (let z = -6; z <= 6; z += 0.25) {
    near(s.normalCdf(z) + s.normalCdf(-z), 1, 1e-6, 'CDF symmetry');
    near(s.normalInv(s.normalCdf(z)), z, 1e-5, 'inverse CDF');
  }
  near(s.normalCdf(1.959964), 0.975, 1e-5, 'Φ(1.96)');
  near(s.normalCdf(0.5), 0.691462, 1e-5, 'Φ(0.5)');
  let prev = 1;
  for (let p = 0; p <= 300; p += 0.5) {
    const f = s.noticeFraction(p);
    assert.ok(f >= 0 && f <= 1 && f <= prev + 1e-12, `fraction monotone at ${p}`);
    prev = f;
  }
  for (const f of [0.001, 0.01, 0.05, 0.1, 0.25, 0.5, 0.75, 0.9, 0.99]) {
    near(s.noticeFraction(s.ppdForFraction(f)), f, 1e-6, `ppdForFraction inverts at ${f}`);
  }
  // The paper's headline: median foveal achromatic limit of 94 ppd.
  near(s.ppdForFraction(0.5), 94, 2, 'median near the paper’s 94 ppd');
});

test('the Cambridge matrix: every published cell but one', () => {
  /* Read off https://www.cl.cam.ac.uk/research/rainbow/projects/resolution_limit/images/display_resolution_matrix.png.
     55 cells follow from one centre-ppd threshold anywhere between 113.5
     (the lowest passing cell, 40" at 3 m, Full HD) and 121.1 (the highest
     failing, 50" at 6 m, HD); the fit from their calculator script gives
     113.4. The 50"/6 m cell is the exception: the image shows Full HD
     where HD reaches 121 px/°, and no threshold under any ppd definition
     (centre, average, horizontal, corner) reproduces it together with the
     rest, so it is pinned to the model, not the picture. */
  const chart = {
    20: ['8K', '5K', '4K', 'Full HD', 'HD', 'HD', 'HD', 'HD'],
    30: ['16K', '8K', '5K', '2.5K', 'Full HD', 'HD', 'HD', 'HD'],
    40: ['16K', '16K', '8K', '4K', 'Full HD', 'Full HD', 'HD', 'HD'],
    50: ['32K', '16K', '8K', '4K', '2.5K', 'Full HD', 'Full HD', 'HD'],       // image shows Full HD at 6 m; see above
    60: ['32K', '16K', '16K', '5K', '4K', '2.5K', 'Full HD', 'Full HD'],
    80: ['32K', '32K', '16K', '8K', '4K', '4K', '2.5K', 'Full HD'],
    100: [null, '32K', '16K', '8K', '5K', '4K', '4K', '2.5K'],
  };
  const metres = [0.4, 0.7, 1, 2, 3, 4, 5, 6];
  let cells = 0;
  for (const [size, row] of Object.entries(chart)) {
    row.forEach((want, j) => {
      const got = s.limitResolution(s.dims(+size, 16 / 9), metres[j] * M);
      assert.equal(got ? got.label : null, want, `${size}" at ${metres[j]} m`);
      cells++;
    });
  }
  assert.equal(cells, 56);
  // Rank never falls as the seat moves back or the screen shrinks.
  for (const D of SIZES) for (let i = 1; i < DISTS.length; i++) {
    const a = s.limitResolution(s.dims(D, 16 / 9), DISTS[i - 1]), b = s.limitResolution(s.dims(D, 16 / 9), DISTS[i]);
    assert.ok((a ? a.rank : 99) >= (b ? b.rank : 99), 'rung falls with distance');
  }
});

test('projector: throw inverts, offset is a fraction of height, brightness matches lumens/ft² and nits', () => {
  for (const D of SIZES) for (const a of s.ASPECTS) {
    const d = s.dims(D, a.ratio);
    for (const tr of [0.3, 0.8, 1.0, 1.2, 1.5, 2.1, 3]) {
      rel(s.widthAtThrow(s.throwDistance(d.width, tr), tr), d.width, 1e-12, 'throw round-trip');
      rel(s.throwDistance(d.width, tr) / d.width, tr, 1e-12, 'throw ratio definition');
    }
    for (const off of [-20, 0, 25, 50, 100]) rel(s.lensOffsetInches(d, off), d.height * off / 100, 1e-12, 'offset');
    for (const lm of [300, 1000, 2500, 5000]) for (const g of [0.8, 1, 1.3, 2.4]) {
      const fl = s.footLamberts(lm, g, d);
      rel(fl, lm * g / (d.width * d.height / 144), 1e-12, 'fL = lm·gain / ft²');
      rel(s.nits(fl), fl * 3.426, 1e-12, 'nits');
    }
  }
  // ProjectorCentral-style check: 2000 lm on a 100" 16:9 matte white ≈ 67 fL.
  near(s.footLamberts(2000, 1, s.dims(100, 16 / 9)), 67.4, 0.1, '2000 lm on 100"');
});

test('placement: angles from an independent atan, comfort band edges, max centre', () => {
  for (const D of [32, 65, 100, 150]) for (const dist of DISTS) for (const eye of [24, 42, 60]) for (const centre of [0, 30, 42, 60, 90, 140]) {
    const d = s.dims(D, 16 / 9);
    const p = s.placement(d, dist, eye, centre);
    rel(p.centre, Math.atan((centre - eye) / dist) / DEG, 1e-12, 'centre angle');
    rel(p.top, Math.atan((centre + d.height / 2 - eye) / dist) / DEG, 1e-12, 'top angle');
    rel(p.bottom, Math.atan((centre - d.height / 2 - eye) / dist) / DEG, 1e-12, 'bottom angle');
    assert.ok(p.top > p.centre && p.centre > p.bottom, 'top above centre above bottom');
    assert.equal(p.ok, p.centre <= s.PLACEMENT.maxUp && p.centre >= -s.PLACEMENT.maxDown, 'ok matches the band');
    rel(s.placement(d, dist, eye, p.maxCentre).centre, s.PLACEMENT.maxUp, 1e-9, 'maxCentre sits on the limit');
    rel(p.bottomEdge, centre - d.height / 2, 1e-12, 'bottom edge');
  }
});

test('describeAngle: bands are contiguous, ordered and cover 0–180', () => {
  let prev = null;
  for (let a = 0.5; a <= 180; a += 0.5) {
    const t = s.describeAngle(a);
    assert.ok(typeof t === 'string' && t.length > 10, `prose at ${a}`);
    if (prev && prev !== t) {
      // A boundary; the angle just crossed one of the standards or the 20/60 marks.
      const marks = [...s.ANGLE_STANDARDS.map(x => x.angle), 20, s.FRONT_ROW];
      assert.ok(marks.some(m => Math.abs(a - m) < 1e-9), `band changed at ${a}, not at a standard`);
    }
    prev = t;
  }
});
