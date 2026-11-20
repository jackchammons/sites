/*
 * Where everything is at a given second.
 *
 * A scene is a pure function of time and the visit's seed: frameAt() returns
 * the airship's pose, the camera, which shot is running and how long ago the
 * last cut was. Nothing is integrated from frame to frame, so a tab that was
 * hidden for an hour, a 30 Hz phone and a test asking for second 437 all get
 * the same picture for the same second.
 *
 * Shots are written in the airship's own frame (x forward, y to port, z up,
 * origin at the middle of the hull) and each runs from one camera position to
 * another, slowly. The frame they are placed in follows the flight path. It
 * follows the hull's heave only for close shots: see `follow` below.
 */
import { Rng } from './rng.js';
import { lerp, lerp3, smoothstep, radians } from './vec.js';

// The flight path's sideways meander; the terrain shader has the same formula.
export const pathY = (path, x) => path.amp1 * Math.sin(x * path.freq1) + path.amp2 * Math.sin(x * path.freq2 + 1.3);
const pathSlope = (path, x) => path.amp1 * path.freq1 * Math.cos(x * path.freq1)
  + path.amp2 * path.freq2 * Math.cos(x * path.freq2 + 1.3);

export const DISSOLVE = 1.8;       // seconds a cut takes to dither across

/* The order shots run in for a visit: the scene's first shot opens (it is the
   establishing one), then the rest shuffled, the whole list repeating. */
export function shotOrder(scene, seed) {
  const rng = new Rng(seed).fork('shots');
  const rest = scene.shots.slice(1).map((_, i) => i + 1);
  return [0, ...rng.shuffle(rest)];
}

export function shotAt(scene, seed, t) {
  const order = shotOrder(scene, seed);
  const total = order.reduce((s, i) => s + scene.shots[i].dur, 0);
  let u = ((t % total) + total) % total;
  const lap = Math.floor(t / total);
  for (let k = 0; k < order.length; k++) {
    const shot = scene.shots[order[k]];
    if (u < shot.dur) return { index: order[k], slot: lap * order.length + k, age: u, dur: shot.dur };
    u -= shot.dur;
  }
  return { index: order[0], slot: 0, age: 0, dur: scene.shots[order[0]].dur };
}

/* The airship: along the path at a steady speed, turning to follow it, with a
   slow heave, pitch and roll. Positions are in the world. */
export function shipAt(scene, start, t) {
  const f = scene.flight;
  const x = start + f.speed * t;
  const y = pathY(scene.path, x);
  const yaw = Math.atan(pathSlope(scene.path, x));
  const heave = f.heave * (Math.sin(t * 0.11) + 0.4 * Math.sin(t * 0.23 + 1.0));
  return {
    x, y, z: f.altitude, yaw, heave,
    pitch: radians(f.pitch) * Math.sin(t * 0.09 + 0.5),
    roll: radians(f.roll) * Math.sin(t * 0.13 + 2.0),
  };
}

/* The vertical field of view for a shot whose angle is written for the frame's
   short side: a wide shot stays wide on a phone held upright. */
export function verticalFov(fovShort, aspect) {
  const f = radians(fovShort);
  return aspect >= 1 ? f : 2 * Math.atan(Math.tan(f / 2) / aspect);
}

export function frameAt(scene, seed, t, aspect = 16 / 9, forcedShot = null) {
  const rng = new Rng(seed);
  const start = rng.fork('start').range(0, 60000);
  const ship = shipAt(scene, start, t);
  const run = forcedShot === null ? shotAt(scene, seed, t)
    : { index: forcedShot, slot: 0, age: t % scene.shots[forcedShot].dur, dur: scene.shots[forcedShot].dur };
  const shot = scene.shots[run.index];
  const tall = aspect < 0.9 && shot.tall ? shot.tall : shot;
  const u = smoothstep(0, 1, run.age / run.dur);
  const pos = lerp3(tall.from.pos, tall.to.pos, u);
  const look = lerp3(tall.from.look, tall.to.look, u);
  const fov = lerp(tall.from.fov ?? shot.from.fov, tall.to.fov ?? shot.to.fov, u);
  // a little hand-held sway, never enough to read as shake
  const sway = [Math.sin(t * 0.21 + run.slot) * 0.6, Math.sin(t * 0.17 + 1.3 + run.slot) * 0.6, Math.sin(t * 0.13 + 2.1) * 0.4];
  const c = Math.cos(ship.yaw), s = Math.sin(ship.yaw);
  /* The hull heaves a few metres. From far off the camera lets it, and the
     ship is seen to ride. Close in, a few metres is the whole frame, so the
     camera rides with it and it is the land behind that moves. */
  const range = Math.hypot(pos[0] - look[0], pos[1] - look[1], pos[2] - look[2]);
  const follow = 1 - smoothstep(70, 260, range);
  // out of the ship's frame, into the local frame whose origin rides under the ship
  const place = p => [c * p[0] - s * p[1], s * p[0] + c * p[1], ship.z + p[2] + follow * ship.heave];
  const eye = place([pos[0] + sway[0], pos[1] + sway[1], pos[2] + sway[2]]);
  return {
    t, seed, start,
    origin: [ship.x, ship.y], altitude: ship.z,
    ship: { pos: [0, 0, ship.z + ship.heave], yaw: ship.yaw, pitch: ship.pitch, roll: ship.roll },
    camera: { eye, target: place(look), fov: verticalFov(fov, aspect) },
    shot: run.index, slot: run.slot, shotAge: run.age, shotDur: run.dur,
  };
}

/* Which rooms have their lights on, 0..1 each: the scene names the ones that
   always are, and the rest come on with the scene's probability. */
export function roomLights(scene, seed, count = 24) {
  const rng = new Rng(seed).fork('rooms');
  const out = new Array(count).fill(0);
  for (let i = 1; i < count; i++) out[i] = rng.chance(scene.ship.lights) ? rng.range(0.7, 1) : 0;
  for (const [i, v] of Object.entries(scene.ship.always || {})) out[i] = v;
  return out;
}
