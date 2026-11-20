/* The small pure modules: the palette table, the ground grid, the cloud
 * volume, the caption face, the picture's size, the flocks and the hash the
 * shaders share. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hexToRgb, oklab, nearestPair, buildLut, paletteBytes, extremes } from '../src/palette.js';
import { axis, buildGrid, snapStep } from '../src/terrain.js';
import { buildCloudNoise } from '../src/noise.js';
import { renderText, hasGlyph, GLYPH_W, GLYPH_H } from '../src/font.js';
import { artSize, TARGET_PIXELS } from '../src/layout.js';
import { birdsAt, BIRD_FLOATS } from '../src/flock.js';
import { Rng, hash32, hashString } from '../src/rng.js';
import * as V from '../src/vec.js';

test('oklab: white is L = 1 with no chroma, black is zero', () => {
  const w = oklab([1, 1, 1]), k = oklab([0, 0, 0]);
  assert.ok(Math.abs(w[0] - 1) < 1e-3 && Math.abs(w[1]) < 1e-3 && Math.abs(w[2]) < 1e-3);
  assert.deepEqual(k, [0, 0, 0]);
});

test('a palette colour maps to itself; a colour between two maps to both', () => {
  const pal = ['#000000', '#808080', '#ffffff', '#ff0000'];
  const labs = pal.map(h => oklab(hexToRgb(h)));
  const exact = nearestPair(labs[1], labs);
  assert.equal(exact.i1, 1);
  assert.equal(exact.t, 0);
  const mid = labs[1].map((v, k) => (v + labs[2][k]) / 2 + (k === 0 ? -0.01 : 0));
  const pair = nearestPair(mid, labs);
  assert.deepEqual([pair.i1, pair.i2], [1, 2]);
  assert.ok(pair.t > 0.4 && pair.t <= 0.5);
});

test('the lookup table holds an index pair and a mix for every lattice colour', () => {
  const pal = ['#101020', '#f0f0e0', '#c04020', '#2060c0', '#40a040'];
  const N = 8, lut = buildLut(pal, N);
  assert.equal(lut.length, N * N * N * 4);
  for (let i = 0; i < lut.length; i += 4) {
    assert.ok(lut[i] < pal.length && lut[i + 1] < pal.length);
    assert.ok(lut[i + 2] <= 128, 'the mix never passes halfway: the first index is the nearer');
    assert.equal(lut[i + 3], 255);
  }
  // the lattice corner at pure black is nearest the dark colour; red is along x
  assert.equal(lut[0], 0);
  assert.equal(lut[(N - 1) * 4], 2);
  assert.deepEqual([...paletteBytes(pal).slice(8, 12)], [0xc0, 0x40, 0x20, 255]);
  assert.deepEqual(extremes(pal), { light: 1, dark: 0 });
});

test('grid axes are symmetric, nested and strictly increasing', () => {
  const bands = [[64, 16], [192, 32], [448, 64]];
  const xs = axis(bands);
  assert.equal(xs[0], -448);
  assert.equal(xs[xs.length - 1], 448);
  assert.ok(xs.includes(0));
  for (let i = 1; i < xs.length; i++) assert.ok(xs[i] > xs[i - 1]);
  assert.deepEqual(xs.map(v => -v + 0).reverse(), xs);
  assert.equal(snapStep(bands), 64);
  // every offset is a multiple of the spacing of the band it is in
  for (const x of xs) {
    const band = bands.find(([reach]) => Math.abs(x) <= reach);
    assert.equal(Math.abs(x) % band[1], 0);
  }
});

test('the grid is two triangles a cell with every index in range', () => {
  const g = buildGrid([0, 1, 3], [0, 2, 4, 8]);
  assert.equal(g.vertices.length, 3 * 4 * 2);
  assert.equal(g.indices.length, 2 * 3 * 6);
  assert.ok(g.indices.every(i => i < 12));
  assert.deepEqual([...g.vertices.slice(0, 6)], [0, 0, 1, 0, 3, 0]);
});

test('the cloud volume fills its range and repeats across its faces', () => {
  const N = 16, v = buildCloudNoise(N, 7);
  assert.equal(v.length, N * N * N * 4);
  const at = (i, j, k, c) => v[(((k + N) % N * N + (j + N) % N) * N + (i + N) % N) * 4 + c];
  for (const c of [0, 1, 2]) {
    let lo = 255, hi = 0, inside = 0, across = 0;
    for (let k = 0; k < N; k++) {
      for (let j = 0; j < N; j++) {
        for (let i = 0; i < N; i++) {
          const a = at(i, j, k, c);
          lo = Math.min(lo, a); hi = Math.max(hi, a);
          if (i < N - 1) inside = Math.max(inside, Math.abs(a - at(i + 1, j, k, c)));
          else across = Math.max(across, Math.abs(a - at(0, j, k, c)));
        }
      }
    }
    assert.ok(hi - lo > 150, `channel ${c} is flat: ${lo}..${hi}`);
    // the step over the seam is no bigger than the steps inside the volume
    assert.ok(across <= inside * 1.25 + 4, `channel ${c} has a seam: ${across} vs ${inside}`);
  }
  assert.deepEqual(buildCloudNoise(8, 3), buildCloudNoise(8, 3));
});

test('the caption face: every glyph is 5 by 7, and text is laid out with one pixel between', () => {
  const t = renderText('A B');
  assert.equal(t.height, GLYPH_H);
  assert.equal(t.width, 3 * (GLYPH_W + 1) - 1);
  assert.equal(t.data.filter(v => v).length, 18 + 20, 'A has 18 pixels of ink, B has 20');
  for (const ch of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 .-:\',') {
    assert.ok(hasGlyph(ch), ch);
    const one = renderText(ch);
    assert.equal(one.width, GLYPH_W);
    if (ch !== ' ') assert.ok(one.data.some(v => v), `${ch} is blank`);
  }
  assert.deepEqual(renderText('abc').data, renderText('ABC').data, 'lower case is drawn as upper');
  assert.equal(renderText('~').data.some(v => v), false, 'an unknown character is a space');
});

test('the picture is about the same number of pixels on every screen', () => {
  for (const [w, h] of [[1170, 2532], [1920, 1080], [3840, 2160], [2560, 1440], [3024, 1964], [800, 600], [2532, 1170]]) {
    const a = artSize(w, h);
    assert.ok(Number.isInteger(a.scale) && a.scale >= 1);
    assert.ok(a.width * a.scale >= w && a.height * a.scale >= h, 'the art covers the screen');
    assert.ok((a.width - 1) * a.scale < w && (a.height - 1) * a.scale < h, 'with less than a pixel to spare');
    const pixels = a.width * a.height;
    assert.ok(pixels <= TARGET_PIXELS * 1.02 && pixels > TARGET_PIXELS * 0.55, `${w}x${h} -> ${a.width}x${a.height}`);
  }
  assert.deepEqual(artSize(768, 432, undefined, 2), { scale: 2, width: 384, height: 216 });
  assert.deepEqual(artSize(0, 0), { scale: 1, width: 1, height: 1 });
});

test('flocks: the same second always has the same birds, and they stay on station', () => {
  const flocks = [
    { count: 9, centre: [200, 900, 40], drift: [-11, 0, 0], range: 1400, spread: 26, formation: 'v', span: 2.6 },
    { count: 14, centre: [-300, 1500, -120], drift: [9, 0, 0], range: 1800, spread: 60, formation: 'loose', span: 2.2 },
  ];
  const a = birdsAt(flocks, 5, 123.4), b = birdsAt(flocks, 5, 123.4);
  assert.equal(a.length, 23 * BIRD_FLOATS);
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, birdsAt(flocks, 6, 123.4));
  for (const t of [0, 77, 9000, 86400]) {
    const birds = birdsAt(flocks, 5, t);
    for (let i = 0; i < birds.length; i += BIRD_FLOATS) {
      const f = i < 9 * BIRD_FLOATS ? flocks[0] : flocks[1];
      assert.ok(birds.slice(i, i + BIRD_FLOATS).every(Number.isFinite));
      assert.ok(Math.abs(birds[i]) <= f.range + f.spread * 3, `x ${birds[i]} at t=${t}`);
      assert.ok(Math.abs(birds[i + 1] - f.centre[1]) <= f.spread * 4);
      assert.ok(birds[i + 6] > 1.5 && birds[i + 6] < 3.5, 'a wingspan in metres');
    }
  }
});

test('the hash and the generator are stable', () => {
  // The shaders implement the same integer mix; these values pin it down.
  assert.equal(hash32(0), 0);
  assert.equal(hash32(1), 1753845952);
  assert.equal(hash32(0xdeadbeef), hash32(0xdeadbeef));
  assert.notEqual(hashString('rooms'), hashString('shots'));
  const a = new Rng(42), b = new Rng(42);
  const xs = Array.from({ length: 5 }, () => a.next());
  assert.deepEqual(xs, Array.from({ length: 5 }, () => b.next()));
  assert.ok(xs.every(x => x >= 0 && x < 1));
  assert.deepEqual(new Rng(1).shuffle([1, 2, 3, 4, 5]).sort(), [1, 2, 3, 4, 5]);
  // a fork does not disturb the stream it came from
  const c = new Rng(9), d = new Rng(9);
  c.fork('x').next();
  assert.equal(c.next(), d.next());
});

test('matrices: a view matrix puts the target straight ahead, and inverts', () => {
  const view = V.lookAt([10, -20, 5], [0, 0, 0]);
  const t = V.transformPoint(view, [0, 0, 0]);
  assert.ok(Math.abs(t[0]) < 1e-9 && Math.abs(t[1]) < 1e-9 && t[2] < 0, 'the target is on -z');
  const up = V.transformPoint(view, [0, 0, 10]);
  assert.ok(up[1] > 0, 'world up is up on screen');
  const m = V.multiply(V.perspective(0.6, 16 / 9, 2, 1000), view);
  const id = V.multiply(m, V.invert(m));
  for (let i = 0; i < 16; i++) assert.ok(Math.abs(id[i] - (i % 5 === 0 ? 1 : 0)) < 1e-6);
  assert.equal(V.invert(V.scaling(1, 0, 1)), null);
});
