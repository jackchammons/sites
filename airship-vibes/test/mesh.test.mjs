import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MeshBuilder, MAT, STRIDE, rgb, shade } from '../src/mesh.js';
import { translation, rotationZ } from '../src/vec.js';

test('a box is twelve triangles whose normals point outward', () => {
  const m = new MeshBuilder().box([1, 2, 3], [2, 4, 6], '#808080');
  assert.equal(m.count, 36);
  const c = [1.5, 3, 4.5];
  for (let i = 0; i < m.count; i++) {
    const p = m.pos.slice(i * 3, i * 3 + 3), n = m.nrm.slice(i * 3, i * 3 + 3);
    const out = (p[0] - c[0]) * n[0] + (p[1] - c[1]) * n[1] + (p[2] - c[2]) * n[2];
    assert.ok(out > 0, `face at ${p} points inward`);
  }
});

test('faces can be left off a box', () => {
  assert.equal(new MeshBuilder().box([0, 0, 0], [1, 1, 1], '#ffffff', { faces: 'xXz' }).count, 18);
});

test('a transform moves positions and turns normals', () => {
  const m = new MeshBuilder();
  m.with(translation(10, 0, 0), () => m.with(rotationZ(Math.PI / 2), () => m.tri([1, 0, 0], [2, 0, 0], [1, 0, 1], '#ffffff')));
  assert.deepEqual(m.pos.slice(0, 3).map(v => Math.round(v * 1e6) / 1e6), [10, 1, 0]);
  // the triangle lay in the xz plane facing -y; turned a quarter it faces +x
  assert.deepEqual(m.nrm.slice(0, 3).map(v => Math.round(v * 1e6) / 1e6 + 0), [1, 0, 0]);
});

test('finish packs 32 bytes a vertex', () => {
  const m = new MeshBuilder().tri([0, 0, 0], [1, 0, 0], [0, 1, 0], '#ff8000', { glow: 1, mat: MAT.ROOM, aux: 7 });
  const out = m.finish();
  assert.equal(out.stride, STRIDE);
  assert.equal(out.buffer.byteLength, 3 * STRIDE);
  const f = new Float32Array(out.buffer), b = new Uint8Array(out.buffer);
  assert.deepEqual([...f.slice(8, 14)], [1, 0, 0, 0, 0, 1]);
  assert.deepEqual([...b.slice(24, 30)], [255, 128, 0, 255, MAT.ROOM, 7]);
  assert.deepEqual(out.bounds, { lo: [0, 0, 0], hi: [1, 1, 0] });
});

test('merge carries triangles through the current transform', () => {
  const part = new MeshBuilder().tri([0, 0, 0], [1, 0, 0], [0, 1, 0], '#ffffff');
  const m = new MeshBuilder();
  m.with(translation(0, 0, 5), () => m.merge(part));
  assert.equal(m.count, 3);
  assert.equal(m.pos[2], 5);
});

test('colours', () => {
  assert.deepEqual(rgb('#ff0080').map(v => Math.round(v * 255)), [255, 0, 128]);
  assert.deepEqual(shade('#808080', 3), [1, 1, 1]);
});
