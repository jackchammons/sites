/* The airship model against the drawing set it is built from.
 *
 * data/parameters.json was exported by the drawings' own Python model with a
 * `derived` block. derive() is a port of that model, so it must give the same
 * numbers; buildShip() must then put the hull, fins, decks and propulsors
 * where those numbers say. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildShip, derive, ROOMS, LIVERY } from '../src/ship.js';
import { MAT, STRIDE } from '../src/mesh.js';

const P = JSON.parse(fs.readFileSync(new URL('../data/parameters.json', import.meta.url), 'utf8'));
const g = derive(P.inputs);
const ship = buildShip(P.inputs);

function vertices(mesh) {
  const f = new Float32Array(mesh.buffer), b = new Uint8Array(mesh.buffer), out = [];
  for (let i = 0; i < mesh.count; i++) {
    out.push({ p: [f[i * 8], f[i * 8 + 1], f[i * 8 + 2]], n: [f[i * 8 + 3], f[i * 8 + 4], f[i * 8 + 5]],
      rgb: [b[i * STRIDE + 24], b[i * STRIDE + 25], b[i * STRIDE + 26]], mat: b[i * STRIDE + 28], aux: b[i * STRIDE + 29] });
  }
  return out;
}
const body = vertices(ship.body);

test('derive() reproduces the drawing set\'s derived values', () => {
  for (const key of ['a', 'b', 'z1', 'z2', 'z3', 'zs', 'bx', 'dx', 'gx', 'ex', 'xo', 'xr1', 'f1', 'nose',
    'shaft_x', 'ring_b', 'ring_c', 'protrude', 'fin_tip_r', 'volume']) {
    assert.ok(Math.abs(g[key] - P.derived[key]) < 1e-9, `${key}: ${g[key]} vs ${P.derived[key]}`);
  }
  assert.deepEqual(g.rings, P.derived.rings);
  assert.equal(g.ring, 10);
});

test('the hull radius follows r(x) = b * sqrt(1 - (x / a)^2)', () => {
  assert.equal(g.r(0), 22);
  assert.equal(g.r(75), 0);
  assert.ok(Math.abs(g.r(65) - 10.976) < 1e-3, 'ring R14 radius, from the ring schedule');
  assert.ok(Math.abs(g.prop_y(35) - 21.24) < 5e-3, 'propulsor station, from DT-06');
  assert.ok(Math.abs(g.prop_y(55) - 16.61) < 5e-3);
});

test('every envelope vertex lies on the ellipsoid', () => {
  const hull = body.filter(v => v.mat === MAT.HULL);
  assert.ok(hull.length > 10000);
  for (const v of hull) {
    const k = (v.p[0] / g.a) ** 2 + (v.p[1] ** 2 + v.p[2] ** 2) / g.b ** 2;
    assert.ok(Math.abs(k - 1) < 1e-4, `off the hull: ${v.p}`);
  }
});

test('the model is 150 m long, 44 m across, and stands on its skids', () => {
  const { lo, hi } = ship.body.bounds;
  assert.ok(Math.abs(lo[0] + 75) < 0.01 && Math.abs(hi[0] - 75) < 0.01);
  assert.ok(Math.abs(lo[1] + 22) < 0.01 && Math.abs(hi[1] - 22) < 0.01);
  // skids hang 0.3 m low in flight: z1 - 0.8 - 0.14
  assert.ok(Math.abs(lo[2] - (g.z1 - 0.94)) < 0.01, `lowest point ${lo[2]}`);
  // the top is the lookout dome on the ridge at the spiral stair
  assert.ok(hi[2] > g.r(g.shaft_x) + 1 && hi[2] < g.r(g.shaft_x) + 1.6);
});

test('the fins reach the tip circle and no further', () => {
  const tail = body.filter(v => v.mat === MAT.PAINT && v.p[0] < -60);
  const reach = Math.max(...tail.map(v => Math.hypot(v.p[1], v.p[2])));
  assert.ok(Math.abs(reach - g.fin_tip_r) < 0.25, `fin tips at ${reach}, expected ${g.fin_tip_r}`);
});

test('normals are unit length and nothing is NaN', () => {
  for (const mesh of [ship.body, ship.glass, ship.prop]) {
    for (const v of vertices(mesh)) {
      assert.ok(v.p.every(Number.isFinite) && v.n.every(Number.isFinite));
      assert.ok(Math.abs(Math.hypot(...v.n) - 1) < 1e-3);
    }
  }
});

test('eight propulsors sit on their ring planes, four a side', () => {
  assert.equal(ship.propMounts.length, 8);
  for (const m of ship.propMounts) {
    const station = P.inputs.prop_x.find(x => Math.abs(m.pos[0] - 1.15 - x) < 1e-6);
    assert.ok(station !== undefined, `no station for ${m.pos}`);
    assert.ok(Math.abs(Math.abs(m.pos[1]) - g.prop_y(station)) < 1e-6);
    assert.equal(m.pos[2], P.inputs.prop_z);
  }
  assert.equal(ship.propMounts.filter(m => m.pos[1] > 0).length, 4);
});

test('rooms and panes refer to rooms that exist', () => {
  assert.equal(ROOMS.length, 24);
  const rooms = body.filter(v => v.mat === MAT.ROOM || v.mat === MAT.SCREEN);
  assert.ok(rooms.length > 1000, 'the gondola has an inside');
  for (const v of rooms) assert.ok(v.aux > 0 && v.aux < ROOMS.length);
  const panes = vertices(ship.glass);
  assert.ok(panes.length >= 300);
  for (const v of panes) {
    assert.equal(v.mat, MAT.GLASS);
    assert.ok(v.aux > 0 && v.aux < ROOMS.length);
  }
  // every room that has a window can be lit
  const windowed = new Set(panes.map(v => v.aux));
  for (const name of ['dining room', 'bridge', 'kitchen', 'den', 'captain\'s cabin']) assert.ok(windowed.has(ROOMS.indexOf(name)), name);
});

test('the gondola hangs where the drawings put it', () => {
  const shell = body.filter(v => v.mat !== MAT.HULL && v.p[0] > g.gx - 0.01 && v.p[0] < 31 && v.p[2] < -20);
  const front = Math.max(...shell.map(v => v.p[0]));
  assert.ok(Math.abs(front - P.inputs.d2_tip) < 0.05, `prow tip at ${front}`);
  // deck 2 is 9 m wide, the garage block the full 11 m of the bay
  const deck2 = shell.filter(v => v.p[0] > 15 && v.p[2] > g.z2 + 0.5);
  assert.ok(Math.abs(Math.max(...deck2.map(v => Math.abs(v.p[1]))) - P.inputs.d2_w / 2) < 0.1);
  const garage = shell.filter(v => v.p[0] < g.xo - 0.5 && v.p[2] < g.z2 - 0.5);
  assert.ok(Math.abs(Math.max(...garage.map(v => Math.abs(v.p[1]))) - P.inputs.bay_w / 2) < 0.2);
});

test('navigation lights: red to port, green to starboard, white at the tail', () => {
  const steady = ship.lamps.filter(l => Math.abs(l.pos[0]) < 1 && Math.abs(l.pos[2]) < 1);
  const port = steady.find(l => l.pos[1] > 0), starboard = steady.find(l => l.pos[1] < 0);
  assert.ok(port.colour[0] > 0.9 && port.colour[1] < 0.3, 'port is red');
  assert.ok(starboard.colour[1] > 0.9 && starboard.colour[0] < 0.3, 'starboard is green');
  assert.ok(ship.lamps.some(l => l.pos[0] < -75 && l.colour.every(c => c > 0.85)), 'a white light at the tail');
});

test('what the hull shader is told matches the parameters', () => {
  assert.deepEqual(ship.hull.bay, [P.inputs.bay_x[0], P.inputs.bay_x[2], P.inputs.bay_w / 2]);
  assert.deepEqual(ship.hull.solar, [...P.inputs.solar_x, P.inputs.solar_deg]);
  assert.deepEqual(ship.hull.gutter, [...P.inputs.gutter_x, P.inputs.gutter_deg]);
  assert.equal(ship.hull.ring, 10);
});

test('the livery is hex throughout', () => {
  for (const [k, v] of Object.entries(LIVERY)) assert.match(v, /^#[0-9a-f]{6}$/, k);
});
