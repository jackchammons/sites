/*
 * Seeded randomness.
 *
 * Everything a visit randomises (which scene, where along the valley, which
 * windows are lit, the order of the camera shots) comes from one 32-bit seed,
 * so ?seed=N reproduces a visit exactly and the tests can pin one down.
 */

// 32-bit integer mix (lowbias32). The same function is written in GLSL in
// shaders.js, so a value hashed here matches one hashed on the GPU.
export function hash32(x) {
  x = x >>> 0;
  x ^= x >>> 16; x = Math.imul(x, 0x7feb352d);
  x ^= x >>> 15; x = Math.imul(x, 0x846ca68b);
  x ^= x >>> 16;
  return x >>> 0;
}

// A stable 32-bit number for a label, to derive independent streams by name.
export function hashString(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return hash32(h);
}

export class Rng {
  constructor(seed = 1) { this.state = (seed >>> 0) || 0x9e3779b9; }

  // mulberry32: a float in [0, 1).
  next() {
    let t = (this.state = (this.state + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(lo, hi) { return lo + (hi - lo) * this.next(); }
  int(n) { return Math.floor(this.next() * n); }
  pick(list) { return list[this.int(list.length)]; }
  chance(p) { return this.next() < p; }
  sign() { return this.next() < 0.5 ? -1 : 1; }

  // An independent stream named by label; drawing from it leaves this one alone.
  fork(label) { return new Rng(hash32(this.state ^ hashString(String(label)))); }

  // A new array holding the list in random order.
  shuffle(list) {
    const out = list.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = this.int(i + 1);
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }
}
