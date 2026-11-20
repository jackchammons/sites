/* The scenes and the director that plays them.
 *
 * A scene is data, and most ways of getting it wrong only show up as a
 * picture: a camera inside the hull or under the ground, a caption the face
 * cannot spell, a palette too long for the lookup table. These hold the data
 * to the rules the renderer relies on. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { SCENES, sceneById } from '../src/scenes.js';
import { frameAt, shotOrder, shotAt, shipAt, verticalFov, roomLights, pathY, DISSOLVE } from '../src/director.js';
import { hasGlyph } from '../src/font.js';
import { axis } from '../src/terrain.js';
import { derive, ROOMS } from '../src/ship.js';
import * as G from '../src/glsl.js';

const P = JSON.parse(fs.readFileSync(new URL('../data/parameters.json', import.meta.url), 'utf8'));
const g = derive(P.inputs);
const HEX = /^#[0-9a-f]{6}$/;
const ASPECTS = [16 / 9, 4 / 3, 21 / 9, 9 / 19.5, 3 / 4];

test('there are four scenes: a valley, a city at night, a sunset and the clouds', () => {
  assert.deepEqual(SCENES.map(s => s.id).sort(), ['city', 'clouds', 'sunset', 'valley']);
  assert.equal(new Set(SCENES.map(s => s.title)).size, 4);
  for (const s of SCENES) assert.equal(sceneById(s.id), s);
  assert.equal(sceneById('nowhere'), null);
  assert.equal(sceneById(null), null);
});

test('every caption can be set in the bitmap face', () => {
  for (const s of SCENES) for (const ch of s.title) assert.ok(hasGlyph(ch), `${s.id}: no glyph for "${ch}"`);
});

test('palettes are hex, free of repeats and short enough to index with a byte', () => {
  for (const s of SCENES) {
    assert.ok(s.palette.length >= 16 && s.palette.length <= 64, `${s.id}: ${s.palette.length} colours`);
    for (const c of s.palette) assert.match(c, HEX, `${s.id}: ${c}`);
    assert.equal(new Set(s.palette).size, s.palette.length, `${s.id} repeats a colour`);
    for (const c of s.anchors) assert.ok(s.palette.includes(c), `${s.id}: the palette has lost its anchor ${c}`);
  }
});

test('every colour a scene names is hex, and its numbers are sane', () => {
  const walk = (v, where) => {
    if (typeof v === 'string' && v.startsWith('#')) assert.match(v, HEX, where);
    else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${where}[${i}]`));
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, `${where}.${k}`);
    else if (typeof v === 'number') assert.ok(Number.isFinite(v), where);
  };
  for (const s of SCENES) {
    walk(s, s.id);
    assert.ok(Math.hypot(...s.sun.dir) > 0.5, `${s.id}: the sun has a direction`);
    assert.ok(s.sun.dir[2] > 0, `${s.id}: the light is above the horizon`);
    assert.equal(s.land.colours.length, 12);
    assert.ok(s.fog.max > 0 && s.fog.max < 1 && s.fog.density > 0 && s.fog.falloff > 0);
    assert.ok(s.flight.speed > 0 && s.flight.altitude > 300);
    assert.ok([0, 1, 2, 3].includes(s.terrain));
    if (s.cloud) {
      assert.ok([1, 2].includes(s.cloud.kind), `${s.id}: cloud kind`);
      assert.ok(Number.isInteger(s.cloud.steps) && s.cloud.steps >= 16 && s.cloud.steps <= 64, `${s.id}: cloud steps`);
      assert.ok(s.cloud.ceiling > s.cloud.floor);
      // A cloudscape is marched from the lens outward: its steps must carry it
      // through the near few miles, where the cloud has shape. (A layer is only
      // marched where the ray is inside it, which starts wherever that is.)
      if (s.cloud.kind === 2) assert.ok(12 * (1 + s.cloud.grow) ** s.cloud.steps > 8000, `${s.id}: cloud march falls short`);
    }
    if (s.city) assert.ok(s.city.block > s.city.street * 3 && s.city.radius >= 8);
    for (const id of Object.keys(s.ship.always || {})) assert.ok(Number(id) > 0 && Number(id) < ROOMS.length, `${s.id}: room ${id}`);
  }
});

test('the ground grid nests: each band a multiple of the one before', () => {
  for (const s of SCENES) {
    for (const bands of [s.grid.x, s.grid.y]) {
      let prev = null;
      for (const [reach, step] of bands) {
        assert.equal(reach % step, 0);
        if (prev) { assert.equal(step % prev[1], 0); assert.equal(prev[0] % step, 0); assert.ok(reach > prev[0]); }
        prev = [reach, step];
      }
      assert.ok(axis(bands).length < 700, 'a grid axis small enough to draw');
    }
  }
});

test('shots: enough of them, long enough to settle, angles a lens could have', () => {
  for (const s of SCENES) {
    assert.ok(s.shots.length >= 5, `${s.id} has ${s.shots.length} shots`);
    assert.equal(new Set(s.shots.map(x => x.name)).size, s.shots.length);
    for (const shot of s.shots) {
      assert.ok(shot.dur >= DISSOLVE * 6, `${s.id}/${shot.name} is over before it has dissolved in`);
      for (const end of [shot.from, shot.to, ...(shot.tall ? [shot.tall.from, shot.tall.to] : [])]) {
        assert.equal(end.pos.length, 3);
        assert.equal(end.look.length, 3);
        assert.ok(end.fov >= 20 && end.fov <= 60, `${s.id}/${shot.name}: fov ${end.fov}`);
      }
    }
  }
});

test('a visit opens on the establishing shot and then plays every shot once a lap', () => {
  for (const s of SCENES) {
    for (const seed of [1, 7, 99999]) {
      const order = shotOrder(s, seed);
      assert.equal(order[0], 0);
      assert.deepEqual(order.slice().sort((a, b) => a - b), s.shots.map((_, i) => i));
      assert.deepEqual(shotOrder(s, seed), order);
    }
    const total = s.shots.reduce((n, x) => n + x.dur, 0);
    assert.equal(shotAt(s, 7, 0).index, 0);
    assert.equal(shotAt(s, 7, total + 0.5).index, 0, 'the list comes round again');
    assert.equal(shotAt(s, 7, total + 0.5).slot, s.shots.length);
    let last = -1;
    for (let t = 0; t < total * 2; t += 0.5) {
      const run = shotAt(s, 7, t);
      assert.ok(run.slot === last || run.slot === last + 1, 'slots count up one cut at a time');
      assert.ok(run.age >= 0 && run.age < run.dur);
      last = run.slot;
    }
  }
});

test('the same second and seed always give the same frame', () => {
  for (const s of SCENES) {
    assert.deepEqual(frameAt(s, 11, 123.456, 1.6), frameAt(s, 11, 123.456, 1.6));
    assert.notDeepEqual(frameAt(s, 11, 123.456, 1.6).origin, frameAt(s, 12, 123.456, 1.6).origin, 'a different visit starts somewhere else');
  }
});

test('the camera is never inside the airship, under the ground or among the rooftops', () => {
  const inside = p => (p[0] / (g.a + 1.5)) ** 2 + (p[1] ** 2 + p[2] ** 2) / (g.b + 1.5) ** 2 < 1;
  const inGondola = p => p[0] > g.bx - 2 && p[0] < P.inputs.d2_tip + 2 && Math.abs(p[1]) < P.inputs.bay_w / 2 + 2 && p[2] > g.z1 - 3 && p[2] < 0;
  for (const s of SCENES) {
    for (let i = 0; i < s.shots.length; i++) {
      for (const aspect of ASPECTS) {
        for (let t = 0; t < s.shots[i].dur; t += 1.5) {
          for (const day of [0, 5000, 80000]) {
            const f = frameAt(s, 3, day + t, aspect, i);
            assert.ok(f.camera.eye.every(Number.isFinite) && f.camera.target.every(Number.isFinite));
            // back into the frame of the ship as it is drawn, heave and all
            const c = Math.cos(-f.ship.yaw), sn = Math.sin(-f.ship.yaw);
            const dx = f.camera.eye[0] - f.ship.pos[0], dy = f.camera.eye[1] - f.ship.pos[1], dz = f.camera.eye[2] - f.ship.pos[2];
            const local = [c * dx - sn * dy, sn * dx + c * dy, dz];
            const where = `${s.id}/${s.shots[i].name} at ${t}s, aspect ${aspect.toFixed(2)}`;
            assert.ok(!inside(local), `${where}: inside the envelope`);
            assert.ok(!inGondola(local), `${where}: inside the gondola`);
            // Each kind of ground is flat or capped within this distance of the route:
            // the valley floor, the sea and low islands, the cloud corridor. The city is flat everywhere.
            const off = Math.hypot(local[1]);
            if (!s.city) assert.ok(off <= 480, `${where}: ${off.toFixed(0)} m off the route`);
            const floor = s.city ? 300 : s.id === 'clouds' ? 320 : 190;
            assert.ok(f.camera.eye[2] >= floor, `${where}: only ${f.camera.eye[2].toFixed(0)} m up`);
            assert.ok(f.camera.fov > 0.2 && f.camera.fov < 1.6, `${where}: fov ${f.camera.fov}`);
          }
        }
      }
    }
  }
});

test('close shots ride the hull\'s heave; wide shots let the hull ride', () => {
  for (const s of SCENES) {
    for (let i = 0; i < s.shots.length; i++) {
      const shot = s.shots[i];
      const range = Math.hypot(...shot.from.pos.map((v, k) => v - shot.from.look[k]));
      // across a whole shot, how far does the aim point wander from the ship it is aimed at?
      let drift = 0;
      for (let t = 0; t < shot.dur; t += 0.5) {
        const f = frameAt(s, 3, 4000 + t, 16 / 9, i);
        const aim = f.camera.target[2] - f.ship.pos[2];
        const first = frameAt(s, 3, 4000, 16 / 9, i);
        drift = Math.max(drift, Math.abs(aim - (first.camera.target[2] - first.ship.pos[2])));
      }
      if (range < 70) assert.ok(drift < 0.6, `${s.id}/${shot.name}: a close shot loses the gondola by ${drift.toFixed(1)} m`);
      if (range > 260) assert.ok(drift < s.flight.heave * 3, `${s.id}/${shot.name}`);
    }
  }
});

test('the airship flies the path and turns with it, gently', () => {
  for (const s of SCENES) {
    for (const t of [0, 100, 5000]) {
      const a = shipAt(s, 1000, t), b = shipAt(s, 1000, t + 1);
      assert.ok(Math.abs(b.x - a.x - s.flight.speed) < 1e-9);
      assert.equal(a.y, pathY(s.path, a.x));
      assert.ok(Math.abs(a.yaw - Math.atan2(b.y - a.y, b.x - a.x)) < 0.01, 'it points where it is going');
      assert.ok(Math.abs(a.yaw) < 0.3 && Math.abs(a.pitch) < 0.03 && Math.abs(a.roll) < 0.03);
      assert.ok(Math.abs(a.heave) < 10);
    }
  }
});

test('the path the shaders bend the ground to is the path the ship flies', () => {
  assert.ok(G.COMMON.includes('float pathY(float x) { return uPath.x * sin(x * uPath.y) + uPath.z * sin(x * uPath.w + 1.3); }'));
  const path = { amp1: 3, freq1: 0.5, amp2: 2, freq2: 0.25 };
  assert.ok(Math.abs(pathY(path, 4) - (3 * Math.sin(2) + 2 * Math.sin(1 + 1.3))) < 1e-12);
});

test('field of view is written for the short side of the frame', () => {
  const wide = verticalFov(30, 16 / 9), tall = verticalFov(30, 9 / 16);
  assert.ok(Math.abs(wide - Math.PI / 6) < 1e-12);
  // on a tall screen the 30 degrees run across, so the vertical angle is larger
  assert.ok(Math.abs(2 * Math.atan(Math.tan(tall / 2) * 9 / 16) - Math.PI / 6) < 1e-12);
});

test('lights aboard: what a scene always lights is lit, and a visit is repeatable', () => {
  for (const s of SCENES) {
    const a = roomLights(s, 5), b = roomLights(s, 5);
    assert.deepEqual(a, b);
    assert.equal(a.length, ROOMS.length);
    assert.equal(a[0], 0);
    assert.ok(a.every(v => v >= 0 && v <= 1));
    for (const [id, v] of Object.entries(s.ship.always || {})) assert.equal(a[id], v);
  }
  const night = sceneById('city');
  const lit = seed => roomLights(night, seed).filter(v => v > 0).length;
  assert.ok(lit(1) >= 10 && lit(2) >= 10, 'most of the ship is lit at night');
});
