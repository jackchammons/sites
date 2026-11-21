/*
 * Noise, built once and read by the shaders as textures.
 *
 * Land, cloud and water are all sums of noise, and a phone cannot afford to
 * work that noise out from nothing at every pixel: hashing the four corners
 * of a lattice cell is a few dozen integer operations, and a pixel of
 * mountain wants it a dozen times over. So the random numbers are laid out
 * here, and a shader reads the four corners of a cell in one fetch.
 *
 * The cloud volume is a small 3D texture of tiling noise, for the same
 * reason: marching a ray through cloud samples a density field dozens of
 * times per pixel. Every channel repeats exactly across the cube's faces, so
 * the shader can tile it for as far as the sky goes.
 *
 *   red    billowing base shape: smooth noise carved by inverted cell noise
 *   green  finer cell noise, used to erode edges and to place clouds
 *   blue   the smooth noise alone
 */
import { hash32 } from './rng.js';

const hash3 = (x, y, z, seed) => hash32(Math.imul(x, 0x9e3779b1) ^ hash32(Math.imul(y, 0x85ebca77) ^ hash32(z + seed)));
const unit = h => (h >>> 8) / 16777216;
const wrap = (i, n) => ((i % n) + n) % n;
const fade = t => t * t * t * (t * (t * 6 - 15) + 10);

// Smooth value noise on a lattice of `cells` that wraps.
function valueNoise(x, y, z, cells, seed) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const u = fade(x - xi), v = fade(y - yi), w = fade(z - zi);
  const at = (dx, dy, dz) => unit(hash3(wrap(xi + dx, cells), wrap(yi + dy, cells), wrap(zi + dz, cells), seed));
  const lerp = (a, b, t) => a + (b - a) * t;
  return lerp(
    lerp(lerp(at(0, 0, 0), at(1, 0, 0), u), lerp(at(0, 1, 0), at(1, 1, 0), u), v),
    lerp(lerp(at(0, 0, 1), at(1, 0, 1), u), lerp(at(0, 1, 1), at(1, 1, 1), u), v), w);
}

/* One jittered point per cell of a lattice that wraps, laid out once: the
   volume asks for the nearest point 27 cells at a time, a third of a million
   times, and hashing the same few hundred cells again for each is most of the
   cost of building it. */
function pointLattice(cells, seed) {
  const pts = new Float32Array(cells * cells * cells * 3);
  let o = 0;
  for (let z = 0; z < cells; z++) {
    for (let y = 0; y < cells; y++) {
      for (let x = 0; x < cells; x++) {
        const h = hash3(x, y, z, seed);
        pts[o++] = unit(h); pts[o++] = unit(hash32(h + 1)); pts[o++] = unit(hash32(h + 2));
      }
    }
  }
  return pts;
}

// Distance to the nearest of those points, wrapping; 0..~1.
function cellNoise(x, y, z, cells, pts) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  let best = 9;
  for (let dz = -1; dz <= 1; dz++) {
    const cz = zi + dz, wz = wrap(cz, cells);
    for (let dy = -1; dy <= 1; dy++) {
      const cy = yi + dy, wy = wrap(cy, cells);
      for (let dx = -1; dx <= 1; dx++) {
        const cx = xi + dx, o = ((wz * cells + wy) * cells + wrap(cx, cells)) * 3;
        const ex = cx + pts[o] - x, ey = cy + pts[o + 1] - y, ez = cz + pts[o + 2] - z;
        const d = ex * ex + ey * ey + ez * ez;
        if (d < best) best = d;
      }
    }
  }
  return Math.min(1, Math.sqrt(best));
}

export const CLOUD_SIZE = 32;      // texels along a side of the cloud volume; the shaders are told the same number

export function buildCloudNoise(size = CLOUD_SIZE, seed = 7) {
  const out = new Uint8Array(size * size * size * 4);
  const L = (cells, salt) => pointLattice(cells, seed + salt);
  const b4 = L(4, 31), b8 = L(8, 41), b16 = L(16, 53), f6 = L(6, 61), f12 = L(12, 71);
  let o = 0;
  for (let k = 0; k < size; k++) {
    for (let j = 0; j < size; j++) {
      for (let i = 0; i < size; i++) {
        const x = (i + 0.5) / size, y = (j + 0.5) / size, z = (k + 0.5) / size;
        const smooth = 0.55 * valueNoise(x * 4, y * 4, z * 4, 4, seed)
          + 0.3 * valueNoise(x * 8, y * 8, z * 8, 8, seed + 11)
          + 0.15 * valueNoise(x * 16, y * 16, z * 16, 16, seed + 23);
        const billow = 0.6 * (1 - cellNoise(x * 4, y * 4, z * 4, 4, b4))
          + 0.28 * (1 - cellNoise(x * 8, y * 8, z * 8, 8, b8))
          + 0.12 * (1 - cellNoise(x * 16, y * 16, z * 16, 16, b16));
        // Carve the smooth field with the billows: lobed, cauliflower edges.
        const base = Math.min(1, Math.max(0, (smooth - (1 - billow) * 0.55) / 0.45 * 0.5 + billow * 0.5));
        const fine = 0.6 * (1 - cellNoise(x * 6, y * 6, z * 6, 6, f6))
          + 0.4 * (1 - cellNoise(x * 12, y * 12, z * 12, 12, f12));
        out[o++] = Math.round(base * 255);
        out[o++] = Math.round(Math.min(1, fine) * 255);
        out[o++] = Math.round(smooth * 255);
        out[o++] = 255;
      }
    }
  }
  return out;
}

export const LATTICE = 256;        // cells along a side of the two lattices below; the shaders wrap at the same number

/* A lattice of random values for smooth noise. Each texel holds the values
   at the four corners of its cell (this corner, the one to the right, the
   one above, the one diagonally across), so that one fetch is enough to
   interpolate anywhere inside the cell. The lattice wraps. */
export function buildValueLattice(size = LATTICE, seed = 11) {
  const v = new Uint8Array(size * size);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) v[j * size + i] = hash32(Math.imul(i, 0x9e3779b1) ^ hash32(j + seed)) >>> 24;
  }
  const at = (i, j) => v[(j % size) * size + (i % size)];
  const out = new Uint8Array(size * size * 4);
  let o = 0;
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      out[o++] = at(i, j); out[o++] = at(i + 1, j); out[o++] = at(i, j + 1); out[o++] = at(i + 1, j + 1);
    }
  }
  return out;
}

/* Four unrelated random bytes per cell, for scattering points: where in its
   cell a tree or a lamp stands, and a number to tell it from its neighbours. */
export function buildRandomLattice(size = LATTICE, seed = 29) {
  const out = new Uint8Array(size * size * 4);
  for (let k = 0; k < size * size; k++) {
    const h = hash32(k + Math.imul(seed, 0x85ebca77));
    out[k * 4] = h & 255; out[k * 4 + 1] = (h >>> 8) & 255; out[k * 4 + 2] = (h >>> 16) & 255; out[k * 4 + 3] = h >>> 24;
  }
  return out;
}
