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

test('ITU 3.2H for 1080p and 1.5H for 4K land near one arc-minute per pixel', () => {
  const d = s.dims(65, 16 / 9);
  const itu = s.ituDistances(d);
  near(itu[0].distance, 3.2 * d.height);
  near(itu[0].angle, 31, 0.5);
  near(itu[1].angle, 61.3, 0.5);
  const hd = s.acuityDistance(s.pixelPitch(d, s.resolution('1080')));
  near(hd / d.height, 3.18, 0.02);
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
  assert.match(s.describeAngle(55), /front-row/);
  assert.match(s.describeAngle(40), /best-seat/);
  assert.match(s.describeAngle(33), /SMPTE 30° and THX 36°/);
  assert.match(s.describeAngle(28), /THX 26° and SMPTE 30°/);
  assert.match(s.describeAngle(22), /television/);
  assert.match(s.describeAngle(12), /small picture/);
});
