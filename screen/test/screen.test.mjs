import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as s from '../src/screen.js';

const near = (a, b, eps = 0.01) => assert.ok(Math.abs(a - b) <= eps, `${a} ≉ ${b}`);

test('a 65" 16:9 screen is 56.65 × 31.87 in', () => {
  const d = s.dims(65, 16 / 9);
  near(d.width, 56.65); near(d.height, 31.87); near(d.area, 1805.5, 0.5);
  near(s.diagonalForWidth(d.width, d.ratio), 65);
});

test('horizontal angle: 65" at 9 ft is about 29°, and the inverse agrees', () => {
  const d = s.dims(65, 16 / 9);
  near(s.hfov(d, 108), 29.4, 0.1);
  near(s.distanceForAngle(d.width, 29.4), 108, 0.5);
  near(s.diagonalForAngle(108, 29.4, 16 / 9), 65, 0.2);
  assert.equal(s.subtended(10, 0), 180);
});

test('THX 40° is diagonal × 1.2 on a 16:9 screen', () => {
  const d = s.dims(100, 16 / 9);
  const thx = s.seatingDistances(d).find(x => x.id === 'thx-best');
  near(thx.distance / 100, 1.2, 0.01);
});

test('ITU 3.2H, 1.6H and 0.8H give the 31°, 58° and 96° BT.500 prints for 16:9', () => {
  const d = s.dims(65, 16 / 9);
  const itu = s.ituDistances(d);
  assert.deepEqual(itu.map(x => x.heights), [3.2, 1.6, 0.8]);
  near(itu[0].distance, 3.2 * d.height);
  near(itu[0].angle, 31, 0.1);
  near(itu[1].angle, 58, 0.15);
  near(itu[2].angle, 96, 0.1);
  near(itu[1].distance / 12, 4.25, 0.01);
  const hd = s.acuityDistance(s.pixelPitch(d, s.resolution('1080')));
  near(hd / d.height, 3.18, 0.02);
  // Each is the recommendation's rounding of one arc-minute per pixel.
  for (const x of itu) near(s.pixelsPerDegree(s.pixelPitch(d, s.resolution(x.res)), x.distance), 60, 0.6);
});

test('the front-row line is past every seating standard and past ITU 4K on 16:9', () => {
  assert.ok(s.ANGLE_STANDARDS.every(x => x.angle < s.FRONT_ROW));
  const itu = s.ituDistances(s.dims(65, 16 / 9));
  assert.ok(itu[1].angle < s.FRONT_ROW && itu[2].angle > s.FRONT_ROW);
  // The prose names the standards it is wider than, so an ITU row beyond it does not contradict it.
  assert.match(s.describeAngle(itu[2].angle), /wider than THX or SMPTE ask/);
  assert.doesNotMatch(s.describeAngle(itu[1].angle), /front-row/);
});

test('pixel pitch fits the panel inside the picture', () => {
  const wide = s.dims(100, 2.39);
  const r = s.resolution('1080');
  near(s.pixelPitch(wide, r), wide.height / 1080, 1e-6);
  const tv = s.dims(65, 16 / 9);
  near(s.pixelPitch(tv, r), tv.width / 1920, 1e-6);
});

test('acuity: 4K on 65" is invisible past about 4.2 ft; 1080p past 8.4 ft', () => {
  const d = s.dims(65, 16 / 9);
  const t = s.acuityTable(d);
  near(t.find(r => r.id === '2160').distance / 12, 4.23, 0.05);
  near(t.find(r => r.id === '1080').distance / 12, 8.45, 0.05);
  near(s.pixelsPerDegree(s.pixelPitch(d, s.resolution('2160')), 50.7), 60, 0.2);
  near(s.pixelsPerDegree(s.pixelPitch(d, s.resolution('1080')), 101.4), 60, 0.2);
});

test('resolution verdict names the lowest resolution already past its limit', () => {
  const d = s.dims(65, 16 / 9);
  const far = s.describeResolution(d, s.resolution('2160'), 120);
  assert.equal(far.wasted, true);
  assert.equal(far.lower.id, '1080');
  assert.equal(s.describeResolution(d, s.resolution('2160'), 240).lower.id, '720');
  const close = s.describeResolution(d, s.resolution('2160'), 40);
  assert.equal(close.wasted, false);
  assert.equal(close.lower, undefined);
});

test('throw and brightness', () => {
  const d = s.dims(120, 16 / 9);          // 104.6 in wide, 42.7 ft²
  near(s.throwDistance(d.width, 1.5), 156.9, 0.1);
  near(s.widthAtThrow(156.9, 1.5), 104.6, 0.1);
  near(s.footLamberts(2000, 1, d), 46.8, 0.1);
  near(s.nits(14), 47.96, 0.05);
  near(s.lensOffsetInches(d, 50), d.height / 2);
});

test('the lit image: a panel of another shape fills one dimension of the picture', () => {
  // A 16:9 projector on a 120" scope screen fills the height and lights 82.3 in of the 110.7 in width.
  const scope = s.dims(120, 2.39);
  const lit = s.litImage(scope, s.resolution('1080'));
  const h = 120 / Math.hypot(1, 2.39), w = h * 16 / 9;
  assert.equal(lit.fills, 'height');
  assert.equal(lit.height, scope.height);
  near(lit.height, h, 1e-9); near(lit.width, w, 1e-9); near(lit.area, w * h, 1e-6);
  near(lit.width, 82.3, 0.05);
  near(s.throwDistance(lit.width, 1.5), 123.5, 0.05);
  near(s.footLamberts(2000, 1, lit), 2000 / (w * h / 144), 1e-9);
  near(s.footLamberts(2000, 1, lit), 75.5, 0.05);
  near(s.lensOffsetInches(lit, 50), h / 2, 1e-9);
  // It is the image the pixel maths already describes.
  near(lit.width / 1920, s.pixelPitch(scope, s.resolution('1080')), 1e-12);

  // A panel wider than the picture fills the width and leaves the height short.
  const tv = s.dims(100, 16 / 9);
  const wide = s.litImage(tv, { w: 2560, h: 1080 });
  assert.equal(wide.fills, 'width');
  assert.equal(wide.width, tv.width);
  near(wide.height, tv.width * 1080 / 2560, 1e-9);
  near(s.lensOffsetInches(wide, 50), tv.width * 1080 / 2560 / 2, 1e-9);
  assert.equal(s.litImage(s.dims(100, 4 / 3), s.resolution('2160')).fills, 'width');
  assert.equal(s.litImage(s.dims(100, 2.35), s.resolution('dci4k')).fills, 'height');
});

test('the lit image of a panel shaped like the picture is the picture, to the last bit', () => {
  const shapes = { '16:9': ['720', '1080', '1440', '2160', '4320'], '16:10': [{ w: 1920, h: 1200 }, { w: 2560, h: 1600 }],
    '21:9': [{ w: 2560, h: 1080 }], '4:3': [{ w: 1024, h: 768 }, { w: 1600, h: 1200 }] };
  for (const [id, panels] of Object.entries(shapes)) for (const panel of panels) {
    const res = typeof panel === 'string' ? s.resolution(panel) : panel;
    for (let diag = 20; diag <= 300; diag += 0.7) {
      const d = s.dims(diag, s.aspect(id).ratio);
      const lit = s.litImage(d, res);
      assert.deepEqual(lit, { width: d.width, height: d.height, area: d.area, fills: 'both' }, `${diag}" ${id} with ${res.w} × ${res.h}`);
      assert.equal(s.throwDistance(lit.width, 1.37), s.throwDistance(d.width, 1.37));
      assert.equal(s.footLamberts(1850, 1.1, lit), s.footLamberts(1850, 1.1, d));
      assert.equal(s.lensOffsetInches(lit, 35), s.lensOffsetInches(d, 35));
    }
  }
});

test('placement: centre at eye level is 0°, a high mount is flagged', () => {
  const d = s.dims(65, 16 / 9);
  const level = s.placement(d, 108, 42, 42);
  near(level.centre, 0); assert.equal(level.ok, true);
  near(level.top, Math.atan(d.height / 2 / 108) * 180 / Math.PI);
  const mantel = s.placement(d, 108, 42, 78);
  assert.ok(mantel.centre > 15); assert.equal(mantel.ok, false);
  near(mantel.maxCentre, 42 + 108 * Math.tan(15 * Math.PI / 180));
});

test('describeAngle covers every band', () => {
  assert.match(s.describeAngle(65), /front-row/);
  assert.match(s.describeAngle(55), /best-seat/);
  assert.match(s.describeAngle(40), /best-seat/);
  assert.match(s.describeAngle(33), /SMPTE 30° and THX 36°/);
  assert.match(s.describeAngle(28), /THX 26° and SMPTE 30°/);
  assert.match(s.describeAngle(22), /television/);
  assert.match(s.describeAngle(12), /small picture/);
});

test('Cambridge eye-limit model: median near 95 ppd, 95th percentile near 113', () => {
  near(s.ppdForFraction(0.5), 95.4, 0.3);
  near(s.ppdForFraction(0.05), 113.4, 0.5);
  near(s.noticeFraction(s.ppdForFraction(0.2)), 0.2, 1e-3);
  near(s.noticeFraction(60), 1, 1e-3);
  near(s.noticeFraction(300), 0, 1e-3);
  assert.equal(s.noticeFraction(0), 1);
  near(s.normalCdf(1.6449), 0.95, 1e-4);
  near(s.normalInv(0.975), 1.96, 1e-3);
});

test('distanceForPpd inverts pixelsPerDegree; average ppd is rows over angle', () => {
  const d = s.dims(65, 16 / 9);
  const pitch = s.pixelPitch(d, s.resolution('2160'));
  const dist = s.distanceForPpd(pitch, 90);
  near(s.pixelsPerDegree(pitch, dist), 90, 1e-6);
  near(s.averagePpd(2160, 16.8), 128.6, 0.1);
  near(s.pixelDensity(0.015).ppi, 66.7, 0.1);
  near(s.pixelDensity(0.015).mm, 0.381, 1e-3);
  assert.equal(s.aspectLabel(1920, 1080), '16:9');
  assert.equal(s.aspectLabel(2560, 1080), '64:27');
});

test('resolution-limit matrix reproduces the Cambridge chart', () => {
  const M = 100 / 2.54;
  assert.equal(s.limitResolution(s.dims(50, 16 / 9), 2 * M).label, '4K');
  assert.equal(s.limitResolution(s.dims(20, 16 / 9), 1 * M).label, '4K');
  assert.equal(s.limitResolution(s.dims(20, 16 / 9), 0.4 * M).label, '8K');
  assert.equal(s.limitResolution(s.dims(60, 16 / 9), 0.7 * M).label, '16K');
  assert.equal(s.limitResolution(s.dims(30, 16 / 9), 6 * M).label, 'HD');
  assert.equal(s.limitResolution(s.dims(100, 16 / 9), 0.4 * M), null);
  assert.equal(s.limitResolution(s.dims(80, 16 / 9), 5 * M).label, '2.5K');
  const m = s.limitMatrix([20, 100], [0.4 * M, 6 * M], 16 / 9);
  assert.equal(m.length, 2); assert.equal(m[0][1].label, 'HD');
});

test('verticalEquivalent: SMPTE 30° on 16:9 is a 17.1° tall picture', () => {
  near(s.verticalEquivalent(30), 17.1, 0.05);
  near(s.verticalEquivalent(26), 14.8, 0.05);
  const d = s.dims(65, 16 / 9), dist = s.distanceForAngle(d.width, 30);
  near(s.vfov(d, dist), s.verticalEquivalent(30), 1e-9);
});
