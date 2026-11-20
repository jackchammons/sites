/*
 * The cloud volume: a small 3D texture of tiling noise.
 *
 * Marching a ray through cloud samples a density field dozens of times per
 * pixel. Computing noise that often is too slow on a phone, so the field is
 * built once here and read as a texture. Every channel repeats exactly across
 * the cube's faces, so the shader can tile it for as far as the sky goes.
 *
 *   red    billowing base shape: smooth noise carved by inverted cell noise
 *   green  finer cell noise, used to erode edges and to place clouds
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

// Distance to the nearest of one jittered point per cell, wrapping; 0..~1.
function cellNoise(x, y, z, cells, seed) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  let best = 9;
  for (let dz = -1; dz <= 1; dz++) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const cx = xi + dx, cy = yi + dy, cz = zi + dz;
        const h = hash3(wrap(cx, cells), wrap(cy, cells), wrap(cz, cells), seed);
        const px = cx + unit(h), py = cy + unit(hash32(h + 1)), pz = cz + unit(hash32(h + 2));
        const d = (px - x) ** 2 + (py - y) ** 2 + (pz - z) ** 2;
        if (d < best) best = d;
      }
    }
  }
  return Math.min(1, Math.sqrt(best));
}

export function buildCloudNoise(size = 32, seed = 7) {
  const out = new Uint8Array(size * size * size * 4);
  let o = 0;
  for (let k = 0; k < size; k++) {
    for (let j = 0; j < size; j++) {
      for (let i = 0; i < size; i++) {
        const x = (i + 0.5) / size, y = (j + 0.5) / size, z = (k + 0.5) / size;
        const smooth = 0.55 * valueNoise(x * 4, y * 4, z * 4, 4, seed)
          + 0.3 * valueNoise(x * 8, y * 8, z * 8, 8, seed + 11)
          + 0.15 * valueNoise(x * 16, y * 16, z * 16, 16, seed + 23);
        const billow = 0.6 * (1 - cellNoise(x * 4, y * 4, z * 4, 4, seed + 31))
          + 0.28 * (1 - cellNoise(x * 8, y * 8, z * 8, 8, seed + 41))
          + 0.12 * (1 - cellNoise(x * 16, y * 16, z * 16, 16, seed + 53));
        // Carve the smooth field with the billows: lobed, cauliflower edges.
        const base = Math.min(1, Math.max(0, (smooth - (1 - billow) * 0.55) / 0.45 * 0.5 + billow * 0.5));
        const fine = 0.6 * (1 - cellNoise(x * 6, y * 6, z * 6, 6, seed + 61))
          + 0.4 * (1 - cellNoise(x * 12, y * 12, z * 12, 12, seed + 71));
        out[o++] = Math.round(base * 255);
        out[o++] = Math.round(Math.min(1, fine) * 255);
        out[o++] = Math.round(smooth * 255);
        out[o++] = 255;
      }
    }
  }
  return out;
}
