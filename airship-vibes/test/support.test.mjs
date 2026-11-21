/* The small pure modules: colours, the ground grid and what of it is in
 * sight, the noise textures, the caption face, how many pixels the picture
 * gets and how that is settled, the flocks and the hash the shaders share. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hexToRgb, toLinear } from '../src/colour.js';
import { axis, buildGrid, snapStep, visibleBlocks, packBlocks, visibleIndices, visibleLots, lotCapacity, BLOCK } from '../src/terrain.js';
import { buildCloudNoise, buildValueLattice, buildRandomLattice, LATTICE, CLOUD_SIZE } from '../src/noise.js';
import { renderText, hasGlyph, GLYPH_W, GLYPH_H } from '../src/font.js';
import { renderSize, leastQuality, FULL_DOT, FULL_PIXELS, LEAST_DOT } from '../src/layout.js';
import { Pace, FRAME_MS } from '../src/pace.js';
import { birdsAt, BIRD_FLOATS } from '../src/flock.js';
import { Rng, hash32, hashString } from '../src/rng.js';
import { SCENES } from '../src/scenes.js';
import * as V from '../src/vec.js';

test('colours: hex to numbers, and through the curve the shaders light in', () => {
  assert.deepEqual(hexToRgb('#ff8000'), [1, 128 / 255, 0]);
  assert.deepEqual(toLinear('#000000'), [0, 0, 0]);
  assert.deepEqual(toLinear('#ffffff'), [1, 1, 1]);
  const mid = toLinear('#808080')[0];
  assert.ok(Math.abs(mid - (128 / 255) ** 2.2) < 1e-12 && mid < 0.25, 'mid grey is dark in linear light');
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

test('the grid is two triangles a cell, cut into blocks, every triangle in exactly one', () => {
  const g = buildGrid([0, 1, 3], [0, 2, 4, 8]);
  assert.equal(g.vertices.length, 3 * 4 * 2);
  assert.equal(g.indices.length, 2 * 3 * 6);
  assert.ok(g.indices.every(i => i < 12));
  assert.deepEqual([...g.vertices.slice(0, 6)], [0, 0, 1, 0, 3, 0]);
  assert.equal(g.blocks.length, 1, 'a grid smaller than a block is one block');

  // a real one: the scenes' own bands
  const s = SCENES[0], xs = axis(s.grid.x), ys = axis(s.grid.y);
  const big = buildGrid(xs, ys);
  assert.equal(big.blocks.length, Math.ceil((xs.length - 1) / BLOCK) * Math.ceil((ys.length - 1) / BLOCK));
  let at = 0;
  for (const b of big.blocks) {
    assert.equal(b.start, at, 'blocks follow one another in the index buffer');
    assert.ok(b.count > 0 && b.count % 6 === 0);
    assert.ok(b.x1 > b.x0 && b.y1 > b.y0);
    // every vertex of the block lies inside its extent
    for (let i = b.start; i < b.start + b.count; i += 97) {
      const v = big.indices[i];
      assert.ok(big.vertices[v * 2] >= b.x0 && big.vertices[v * 2] <= b.x1 && big.vertices[v * 2 + 1] >= b.y0 && big.vertices[v * 2 + 1] <= b.y1);
    }
    at += b.count;
  }
  assert.equal(at, big.indices.length, 'and between them hold every triangle');
});

test('a frustum knows what is inside it', () => {
  const m = V.multiply(V.perspective(0.8, 1.5, 2, 1000), V.lookAt([0, 0, 100], [500, 0, 0]));
  const planes = V.frustumPlanes(m);
  assert.equal(planes.length, 6);
  for (const p of planes) assert.ok(Math.abs(Math.hypot(p[0], p[1], p[2]) - 1) < 1e-9, 'planes are normalised');
  const inside = p => planes.every(q => q[0] * p[0] + q[1] * p[1] + q[2] * p[2] + q[3] >= 0);
  assert.ok(inside([400, 0, 20]), 'what the camera looks at');
  assert.ok(!inside([-400, 0, 20]), 'behind it');
  assert.ok(!inside([400, 600, 20]), 'far off to one side');
  assert.ok(!inside([1, 0, 99.8]), 'nearer than the near plane');
  assert.ok(!inside([5000, 0, -900]), 'beyond the far plane');
  // boxes: one round the target is kept, one behind the camera is not, one that only crosses a side plane is kept
  assert.equal(V.boxOutside(planes, 350, -50, 0, 450, 50, 40), false);
  assert.equal(V.boxOutside(planes, -450, -50, 0, -350, 50, 40), true);
  assert.equal(V.boxOutside(planes, 300, -400, 0, 500, 400, 40), false);
  assert.equal(V.boxOutside(planes, -1e5, -1e5, -1e4, 1e5, 1e5, 1e4), false, 'a box that holds the whole frustum');
});

test('only the ground a camera can see is drawn, nearest first, and none of what it can see is left out', () => {
  const s = SCENES[0];
  const g = buildGrid(axis(s.grid.x), axis(s.grid.y));
  const out = new Uint32Array(g.indices.length);
  const low = -20, high = 900;
  for (const [eye, target, fov, aspect, ox, oy] of [
    [[40, -300, 430], [0, 0, 400], 0.8, 16 / 9, -130, 55],
    [[-140, -260, 650], [10, 0, 370], 0.52, 9 / 19.5, 200, -300],
    [[150, -70, 320], [0, 0, 430], 0.56, 4 / 3, 0, 0],
  ]) {
    const planes = V.frustumPlanes(V.multiply(V.perspective(fov, aspect, 2, 140000), V.lookAt(eye, target)));
    const n = visibleIndices(g, planes, eye, ox, oy, low, high, out);
    assert.ok(n > 0 && n % 3 === 0 && n < g.indices.length * 0.6, `${n} of ${g.indices.length} indices`);
    const kept = new Set();
    for (let i = 0; i < n; i += 3) kept.add(`${out[i]},${out[i + 1]},${out[i + 2]}`);
    assert.equal(kept.size, n / 3, 'no triangle twice');
    // any triangle with a corner the camera can see, at the lowest or the highest the ground can be, must be kept
    const seen = (v, z) => planes.every(q => q[0] * (g.vertices[v * 2] + ox) + q[1] * (g.vertices[v * 2 + 1] + oy) + q[2] * z + q[3] >= 0);
    let checked = 0;
    for (let i = 0; i < g.indices.length; i += 3) {
      const tri = [g.indices[i], g.indices[i + 1], g.indices[i + 2]];
      if (tri.some(v => seen(v, low) || seen(v, high) || seen(v, (low + high) / 2))) {
        checked++;
        assert.ok(kept.has(tri.join(',')), 'a triangle in view was left out');
      }
    }
    assert.ok(checked > 100);
    // nearest first: the first triangle drawn is closer to the eye than the last
    const far = i => Math.hypot(g.vertices[out[i] * 2] + ox - eye[0], g.vertices[out[i] * 2 + 1] + oy - eye[1]);
    assert.ok(far(0) < far(n - 3));
    // the list of blocks is what the renderer compares from frame to frame: the same view gives the same list,
    // and the list packs to the same triangles
    const blocks = visibleBlocks(g, planes, eye, ox, oy, low, high);
    assert.deepEqual(blocks, visibleBlocks(g, planes, eye, ox, oy, low, high));
    assert.equal(new Set(blocks).size, blocks.length);
    const again = new Uint32Array(g.indices.length);
    assert.equal(packBlocks(g, blocks, again), n);
    assert.deepEqual(again.subarray(0, n), out.subarray(0, n));
  }
  // looking straight up, there is no ground to draw
  const up = V.frustumPlanes(V.multiply(V.perspective(0.5, 1, 2, 140000), V.lookAt([0, 0, 2000], [1, 0, 9000])));
  assert.equal(visibleIndices(g, up, [0, 0, 2000], 0, 0, low, high, out), 0);
});

test('the city draws only the blocks in sight, eight buildings a block, nearest first', () => {
  const radius = 6, size = 120, slots = 8;
  const out = new Float32Array(lotCapacity(radius, slots) * 3);
  assert.equal(lotCapacity(1, 8), 5 * 8, 'a radius of one block is the block and its four neighbours');
  const eye = [30, -40, 500];
  const planes = V.frustumPlanes(V.multiply(V.perspective(0.7, 16 / 9, 2, 140000), V.lookAt(eye, [600, 100, 0])));
  const n = visibleLots(radius, size, slots, planes, eye, -60, -60, 300, out);
  assert.ok(n > 0 && n % slots === 0 && n < lotCapacity(radius, slots), `${n} buildings`);
  let last = -1;
  for (let i = 0; i < n; i++) {
    const dx = out[i * 3], dy = out[i * 3 + 1], slot = out[i * 3 + 2];
    assert.ok(dx * dx + dy * dy <= radius * radius);
    assert.equal(slot, i % slots);
    if (i % slots === 0) {
      const d = Math.hypot(Math.max(-60 + dx * size - eye[0], 0, eye[0] - (-60 + dx * size) - size), Math.max(-60 + dy * size - eye[1], 0, eye[1] - (-60 + dy * size) - size));
      assert.ok(d >= last, 'blocks come nearest first');
      last = d;
    }
  }
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
  assert.equal(CLOUD_SIZE, 32);
});

test('the noise lattice holds a cell\'s four corners in a texel, and neighbours agree about the corners they share', () => {
  const N = 16, v = buildValueLattice(N, 5);
  assert.equal(v.length, N * N * 4);
  const at = (i, j, c) => v[(((j % N) + N) % N * N + ((i % N) + N) % N) * 4 + c];
  let lo = 255, hi = 0;
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      // this corner, the one to the right, the one above, the one across
      assert.equal(at(i, j, 1), at(i + 1, j, 0), 'right');
      assert.equal(at(i, j, 2), at(i, j + 1, 0), 'above');
      assert.equal(at(i, j, 3), at(i + 1, j + 1, 0), 'across: this is what makes the noise continuous, and wrap');
      lo = Math.min(lo, at(i, j, 0)); hi = Math.max(hi, at(i, j, 0));
    }
  }
  assert.ok(hi - lo > 200, 'the values use their range');
  assert.deepEqual(buildValueLattice(N, 5), v);
  assert.notDeepEqual(buildValueLattice(N, 6), v);
  assert.equal(buildValueLattice().length, LATTICE * LATTICE * 4);
  // the scattering lattice: four bytes that have nothing to do with one another
  const r = buildRandomLattice(64, 3);
  const mean = c => { let m = 0; for (let k = 0; k < 64 * 64; k++) m += r[k * 4 + c]; return m / (64 * 64); };
  for (const c of [0, 1, 2, 3]) assert.ok(Math.abs(mean(c) - 127.5) < 8, `channel ${c} leans: ${mean(c)}`);
  let same = 0;
  for (let k = 0; k < 64 * 64; k++) if (r[k * 4] === r[k * 4 + 1]) same++;
  assert.ok(same < 64 * 64 / 50, 'two channels move together');
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

test('how many pixels: at best two a dot, never more than a 1080p picture, never softer than is worth it', () => {
  // a phone held upright, three device pixels to the dot
  assert.deepEqual(renderSize(390, 844, 3, 1), { width: 780, height: 1688, dot: 2 });
  // a 1080p monitor is drawn pixel for pixel; a 4K one is capped
  assert.deepEqual(renderSize(1920, 1080, 1, 1), { width: 1920, height: 1080, dot: 1 });
  const big = renderSize(1920, 1080, 2, 1);
  assert.ok(big.width * big.height <= FULL_PIXELS * 1.01 && big.dot < FULL_DOT);
  for (const [w, h, dpr] of [[390, 844, 3], [844, 390, 3], [412, 915, 2.625], [1920, 1080, 1], [1440, 900, 2], [2560, 1440, 1], [800, 600, 1], [320, 568, 2]]) {
    let last = 0;
    for (const q of [0.05, 0.1, 0.2, 0.35, 0.5, 0.75, 1]) {
      const a = renderSize(w, h, dpr, q);
      assert.ok(a.width >= 1 && a.height >= 1 && Number.isInteger(a.width) && Number.isInteger(a.height));
      assert.ok(a.width * a.height >= last, `${w}x${h}: more quality is never fewer pixels`);
      last = a.width * a.height;
      assert.ok(a.dot <= Math.min(dpr, FULL_DOT) + 1e-9, 'never more pixels than the screen has');
      assert.ok(a.dot >= Math.min(LEAST_DOT, dpr) - 1e-9, `${w}x${h} at ${q}: ${a.dot.toFixed(2)} pixels a dot is too soft`);
      assert.ok(Math.abs(a.width / a.height - w / h) < 0.02, 'the picture keeps the shape of the screen');
    }
    // the least quality worth asking for lands on the softest picture allowed, and asking for less changes nothing
    const least = leastQuality(w, h, dpr);
    assert.ok(least > 0 && least <= 1);
    assert.deepEqual(renderSize(w, h, dpr, least * 0.5), renderSize(w, h, dpr, least * 0.999));
    assert.ok(Math.abs(renderSize(w, h, dpr, least).dot - Math.min(LEAST_DOT, Math.min(dpr, FULL_DOT))) < 0.02 || least === 1);
  }
  // a size asked for outright: device pixels per drawn pixel
  assert.deepEqual(renderSize(768, 432, 1, 0.3, 2), { width: 384, height: 216, dot: 0.5 });
  assert.deepEqual(renderSize(390, 844, 3, 1, 1.5), { width: 780, height: 1688, dot: 2 });
  assert.deepEqual(renderSize(0, 0, 1, 1), { width: 1, height: 1, dot: 1 });
});

/* A device, for the pace to be tried on: drawing a frame takes `fixed`
   milliseconds plus `each` for the whole of the pixels at quality 1, and the
   screen offers a frame every `tick`. Returns the quality after every frame. */
function play(pace, device, frames, busy = () => false) {
  const out = [];
  let begun = 0;
  for (let i = 0; i < frames; i++) {
    const cost = device.fixed + device.each(i) * pace.quality + ((i * 7919) % 5 - 2) * 0.3;     // a little jitter
    // the next frame starts on the first tick after this one is drawn and, when holding, due
    const free = begun + Math.max(cost, pace.probing ? 0 : FRAME_MS - 2);
    const next = Math.max(Math.ceil(free / device.tick - 1e-9), Math.floor(begun / device.tick) + 1) * device.tick;
    pace.frame(next - begun, busy(i));
    begun = next;
    out.push(pace.quality);
  }
  return out;
}
const costAt = (device, q, i = 0) => device.fixed + device.each(i) * q;

test('the pace: a fast device is given every pixel, a slow one as many as it can draw in time', () => {
  for (const [name, device] of Object.entries({
    desktop: { tick: 1000 / 60, fixed: 1, each: () => 6 },
    'a good phone': { tick: 1000 / 60, fixed: 3, each: () => 38 },
    'a middling phone': { tick: 1000 / 60, fixed: 4, each: () => 90 },
    'a 120 Hz phone': { tick: 1000 / 120, fixed: 3, each: () => 60 },
    'an old phone': { tick: 1000 / 60, fixed: 8, each: () => 400 },
  })) {
    for (const from of [0.3, 0.5, 1]) {
      const pace = new Pace(from, 0.09);
      const q = play(pace, device, 600);
      const end = q[q.length - 1];
      assert.equal(pace.mode, 'hold', `${name} from ${from}: still looking after 600 frames`);
      assert.deepEqual(new Set(q.slice(-300)).size, 1, `${name} from ${from}: quality is still moving`);
      const cost = costAt(device, end);
      // in time: a frame fits its thirtieth of a second, or the picture is already as soft as it is allowed to be
      assert.ok(cost <= FRAME_MS * 1.02 || end === pace.least, `${name} from ${from}: settles at ${end.toFixed(2)}, ${cost.toFixed(0)} ms a frame`);
      // and not wasteful: with time for half as many pixels again, it would have taken them
      assert.ok(end === 1 || costAt(device, Math.min(1, end * 1.6)) > device.tick * 0.98, `${name} from ${from}: stops at ${end.toFixed(2)} with time to spare`);
      // it gets there quickly: within five seconds' worth of frames
      assert.ok(q.findIndex(v => v === end) < 150, `${name} from ${from}: slow to settle`);
    }
  }
});

test('the pace: it follows the picture when a shot costs more or less, and leaves dissolves out of it', () => {
  // a shot that costs twice as much comes on at frame 300
  const device = { tick: 1000 / 60, fixed: 3, each: i => (i < 300 ? 40 : 80) };
  const pace = new Pace(0.4, 0.09);
  const q = play(pace, device, 700);
  assert.ok(costAt(device, q[299], 0) <= FRAME_MS * 1.02);
  assert.ok(q[699] < q[299], 'frames ran late and quality came down');
  assert.ok(costAt(device, q[699], 400) <= FRAME_MS * 1.02, `still ${costAt(device, q[699], 400).toFixed(0)} ms a frame`);
  // then a cheap shot: holding cannot see the spare time, a fresh probe can
  const cheap = { tick: 1000 / 60, fixed: 3, each: () => 20 };
  const before = pace.quality;
  play(pace, cheap, 200);
  assert.equal(pace.quality, before, 'a hold does not go looking for more');
  pace.reprobe();
  assert.equal(pace.probing, true);
  play(pace, cheap, 200);
  assert.ok(pace.quality > before * 1.3, 'asked to look again, it finds the spare time');

  // frames that hold two pictures are slow and mean nothing
  const steady = new Pace(0.5, 0.09);
  play(steady, { tick: 1000 / 60, fixed: 3, each: () => 44 }, 300);
  const settled = steady.quality;
  play(steady, { tick: 1000 / 60, fixed: 3, each: () => 150 }, 90, () => true);
  assert.equal(steady.quality, settled, 'a dissolve must not cost the picture its sharpness');

  // a size asked for outright is left alone, however the frames arrive
  const fixed = new Pace(0.7, 0.09, true);
  play(fixed, { tick: 1000 / 60, fixed: 10, each: () => 900 }, 200);
  assert.equal(fixed.quality, 0.7);
  assert.equal(fixed.probing, false);
  // and quality stays inside its bounds
  assert.equal(new Pace(5, 0.2).quality, 1);
  assert.equal(new Pace(0.01, 0.2).quality, 0.2);
});

test('the pace: a screen that only offers thirty frames a second keeps what it started with', () => {
  // A phone saving its battery: frames arrive a thirtieth apart however little they cost.
  // Spare time cannot be seen, so quality stays put; it is not lowered either.
  const capped = { tick: 1000 / 30, fixed: 2, each: () => 12 };
  for (const from of [0.3, 0.5, 0.8]) {
    const pace = new Pace(from, 0.09);
    play(pace, capped, 300);
    assert.equal(pace.quality, from);
    assert.equal(pace.mode, 'hold');
  }
  // but a frame that takes two of those thirtieths is still seen for what it is
  const slow = new Pace(0.8, 0.09);
  play(slow, { tick: 1000 / 30, fixed: 4, each: () => 70 }, 400);
  assert.ok(costAt({ fixed: 4, each: () => 70 }, slow.quality) <= FRAME_MS * 1.02, `still ${slow.quality}`);
});

test('the pace: at its softest and still late, it says so', () => {
  const hopeless = { tick: 1000 / 60, fixed: 60, each: () => 300 };
  const pace = new Pace(0.5, 0.09);
  play(pace, hopeless, 300);
  assert.equal(pace.quality, 0.09);
  assert.ok(pace.starved > 0, 'nowhere left to go, and it has not said so');
  // a device that keeps up never says it
  const fine = new Pace(0.5, 0.09);
  play(fine, { tick: 1000 / 60, fixed: 2, each: () => 20 }, 600);
  assert.equal(fine.starved, 0);
  // nor one that settles at the softest picture and then keeps time there
  const just = new Pace(0.5, 0.09);
  play(just, { tick: 1000 / 60, fixed: 10, each: () => 200 }, 600);
  assert.equal(just.quality, 0.09);
  assert.equal(just.starved, 0);
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
