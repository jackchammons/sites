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
 */

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

export function buildGrid(xs, ys) {
  const nx = xs.length, ny = ys.length;
  const vertices = new Float32Array(nx * ny * 2);
  let o = 0;
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) { vertices[o++] = xs[i]; vertices[o++] = ys[j]; }
  }
  const indices = new Uint32Array((nx - 1) * (ny - 1) * 6);
  o = 0;
  for (let j = 0; j < ny - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
      indices[o++] = a; indices[o++] = b; indices[o++] = d;
      indices[o++] = a; indices[o++] = d; indices[o++] = c;
    }
  }
  return { vertices, indices, nx, ny };
}
