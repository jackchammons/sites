/*
 * Birds.
 *
 * A flock is a formation that drifts past the airship: each bird holds a
 * place in it, wanders a little about that place and flaps to its own beat.
 * Like everything else it is a pure function of time, so there is no
 * simulation to keep in step and a still of second 40 always has the same
 * birds in it.
 *
 * Positions are in the frame that follows the flight path (x along the
 * heading, y to port, z up, origin under the airship), so a flock keeps its
 * station on the ship however far the ship has flown.
 */
import { Rng } from './rng.js';

export const BIRD_FLOATS = 8;      // x, y, z, heading, flap phase, flap rate, wingspan, bank

const wrapAbout = (v, half) => ((v + half) % (2 * half) + 2 * half) % (2 * half) - half;

/* flocks: [{ count, centre, drift, range, spread, formation, span }]
   centre and drift are in the ship's frame, metres and metres per second;
   range is how far along x a flock travels before it comes round again. */
export function birdsAt(flocks, seed, t) {
  const total = flocks.reduce((n, f) => n + f.count, 0);
  const out = new Float32Array(total * BIRD_FLOATS);
  let o = 0;
  flocks.forEach((f, fi) => {
    const rng = new Rng(seed).fork('flock' + fi);
    const phase = rng.range(0, 1000);
    // the flock's own slow weave about its line of travel
    const weave = t * 0.05 + phase;
    const cx = wrapAbout(f.centre[0] + f.drift[0] * t + phase * 3, f.range);
    const cy = f.centre[1] + f.drift[1] * t * 0 + Math.sin(weave) * f.spread * 1.5;
    const cz = f.centre[2] + Math.sin(weave * 0.7 + 1) * f.spread * 0.4;
    const heading = Math.atan2(f.drift[1] + Math.cos(weave) * f.spread * 1.5 * 0.05, f.drift[0] || 1e-6);
    const ch = Math.cos(heading), sh = Math.sin(heading);
    for (let i = 0; i < f.count; i++) {
      let ax, ay, az;
      if (f.formation === 'v') {
        // a skein: alternate sides of the leader, each a little back and out
        const rank = Math.ceil(i / 2), side = i % 2 ? 1 : -1;
        ax = -rank * f.spread * 0.55; ay = side * rank * f.spread * 0.42; az = rank * f.spread * 0.03;
      } else {
        ax = rng.range(-1, 1) * f.spread * 1.6; ay = rng.range(-1, 1) * f.spread; az = rng.range(-1, 1) * f.spread * 0.35;
      }
      const p1 = rng.range(0, 6.28), p2 = rng.range(0, 6.28), rate = rng.range(0.7, 1.3);
      const wob = f.spread * 0.12;
      ax += Math.sin(t * 0.31 * rate + p1) * wob;
      ay += Math.sin(t * 0.27 * rate + p2) * wob;
      az += Math.sin(t * 0.4 * rate + p1 + p2) * wob * 0.6;
      out[o++] = cx + ax * ch - ay * sh;
      out[o++] = cy + ax * sh + ay * ch;
      out[o++] = cz + az;
      out[o++] = heading + Math.cos(t * 0.27 * rate + p2) * 0.08;
      out[o++] = p1 * 3;
      out[o++] = (f.flap || 5.5) * rate;
      out[o++] = f.span * rng.range(0.85, 1.15);
      out[o++] = Math.cos(t * 0.27 * rate + p2) * 0.25;
    }
  });
  return out;
}
