/*
 * The ground grid.
 *
 * Land, sea and cloud tops are one flat grid that the vertex shader lifts to
 * the scene's height function. The grid is a tensor product: every column
 * crosses every row, so spacing can change along either axis without leaving
 * the T-junctions that open cracks between levels of detail. Columns are
 * offsets from a point that follows the camera in whole steps of the coarsest
 * spacing, so every vertex always sits on the same spot of ground and nothing
 * swims as the airship moves; rows are fixed in the world.
 *
 * The grid reaches forty kilometres in every direction and the camera looks
 * in one, so it is cut into square blocks of cells and only the blocks the
 * camera can see are drawn, nearest first: every vertex costs a height
 * function, and most of them would be behind the viewer.
 */
import { boxOutside } from './vec.js';

/* Offsets for one axis from bands of [reach, step]: within reach of zero the
   spacing is step. Each step must be a multiple of the one before, and each
   reach a multiple of its step, so the lattices nest. Symmetric about zero. */
export function axis(bands) {
  const half = [0];
  let at = 0;
  for (const [reach, step] of bands) {
    while (at < reach) { at += step; half.push(at); }
  }
  return [...half.slice(1).reverse().map(v => -v), ...half];
}

// The coarsest spacing: the whole grid may only move in multiples of this.
export const snapStep = bands => bands[bands.length - 1][1];

export const BLOCK = 16;            // cells along a block's side

/* The grid's vertices, and its triangles a block at a time: blocks[b] is the
   block's extent on the flat grid and where its indices lie in `indices`. */
export function buildGrid(xs, ys, block = BLOCK) {
  const nx = xs.length, ny = ys.length;
  const vertices = new Float32Array(nx * ny * 2);
  let o = 0;
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) { vertices[o++] = xs[i]; vertices[o++] = ys[j]; }
  }
  const indices = new Uint32Array((nx - 1) * (ny - 1) * 6);
  const blocks = [];
  o = 0;
  for (let bj = 0; bj < ny - 1; bj += block) {
    for (let bi = 0; bi < nx - 1; bi += block) {
      const i1 = Math.min(bi + block, nx - 1), j1 = Math.min(bj + block, ny - 1);
      const start = o;
      for (let j = bj; j < j1; j++) {
        for (let i = bi; i < i1; i++) {
          const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
          indices[o++] = a; indices[o++] = b; indices[o++] = d;
          indices[o++] = a; indices[o++] = d; indices[o++] = c;
        }
      }
      blocks.push({ x0: xs[bi], x1: xs[i1], y0: ys[bj], y1: ys[j1], start, count: o - start });
    }
  }
  return { vertices, indices, nx, ny, blocks };
}

/* The blocks a camera can see, nearest first, as their numbers in
   grid.blocks. The grid lies at (ox, oy) in the frame the planes and the eye
   are in, and the ground it is lifted to stays between zLow and zHigh. */
export function visibleBlocks(grid, planes, eye, ox, oy, zLow, zHigh) {
  const seen = [];
  for (let k = 0; k < grid.blocks.length; k++) {
    const b = grid.blocks[k];
    const x0 = b.x0 + ox, x1 = b.x1 + ox, y0 = b.y0 + oy, y1 = b.y1 + oy;
    if (boxOutside(planes, x0, y0, zLow, x1, y1, zHigh)) continue;
    // distance from the eye to the nearest point of the block's footprint
    const dx = Math.max(x0 - eye[0], 0, eye[0] - x1), dy = Math.max(y0 - eye[1], 0, eye[1] - y1);
    seen.push([dx * dx + dy * dy, k]);
  }
  seen.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  return seen.map(e => e[1]);
}

/* Those blocks' triangles, in that order, copied into `out` (a Uint32Array as
   long as grid.indices). Returns how many indices were written. */
export function packBlocks(grid, blocks, out) {
  let o = 0;
  for (const k of blocks) {
    const b = grid.blocks[k];
    out.set(grid.indices.subarray(b.start, b.start + b.count), o);
    o += b.count;
  }
  return o;
}

// Both at once.
export const visibleIndices = (grid, planes, eye, ox, oy, zLow, zHigh, out) =>
  packBlocks(grid, visibleBlocks(grid, planes, eye, ox, oy, zLow, zHigh), out);

/* The same for the city's buildings, which are drawn a block at a time: the
   blocks within `radius` of the middle one that a camera can see, nearest
   first, written to `out` as (dx, dy, slot) for each of a block's `slots`
   buildings. The middle block's corner is at (ox, oy); blocks are `size`
   metres square and nothing on them stands above `height`. Returns the
   number of buildings written. */
export function visibleLots(radius, size, slots, planes, eye, ox, oy, height, out) {
  const seen = [];
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx * dx + dy * dy > radius * radius) continue;
      const x0 = ox + dx * size, y0 = oy + dy * size;
      if (boxOutside(planes, x0, y0, 0, x0 + size, y0 + size, height)) continue;
      const ex = Math.max(x0 - eye[0], 0, eye[0] - x0 - size), ey = Math.max(y0 - eye[1], 0, eye[1] - y0 - size);
      seen.push([ex * ex + ey * ey, dx, dy]);
    }
  }
  seen.sort((a, b) => a[0] - b[0]);
  let o = 0;
  for (const [, dx, dy] of seen) {
    for (let slot = 0; slot < slots; slot++) { out[o++] = dx; out[o++] = dy; out[o++] = slot; }
  }
  return o / 3;
}

// How many buildings that can be at most: the size `out` must have, in floats, is three times this.
export function lotCapacity(radius, slots) {
  let n = 0;
  for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) if (dx * dx + dy * dy <= radius * radius) n++;
  return n * slots;
}
