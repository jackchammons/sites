/*
 * Where everything is at a given second.
 *
 * The airship, the camera and the lights aboard are pure functions of time
 * and the visit's seed. Nothing is integrated from frame to frame, so a tab
 * that was hidden for an hour, a 30 Hz phone and a test asking for second 437
 * all get the same picture for the same second.
 *
 * Which shot is on is the one piece of state, because the viewer can step
 * through the shots. It is a small plain object, the playhead: the visit's
 * shot order, the place in it, the second that shot began, and the shot it
 * came from. Left alone it plays each shot for its length and moves on; the
 * functions that change it return a new one and touch nothing else.
 *
 * Shots are written in the airship's own frame (x forward, y to port, z up,
 * origin at the middle of the hull) and each runs from one camera position to
 * another, slowly and at a steady pace, so the camera is still travelling
 * while one shot dissolves into the next. The frame they are placed in
 * follows the flight path. It follows the hull's heave only for close shots:
 * see `follow` below.
 */
import { Rng } from './rng.js';
import { lerp, lerp3, smoothstep, clamp, radians } from './vec.js';

// The flight path's sideways meander; the terrain shader has the same formula.
export const pathY = (path, x) => path.amp1 * Math.sin(x * path.freq1) + path.amp2 * Math.sin(x * path.freq2 + 1.3);
const pathSlope = (path, x) => path.amp1 * path.freq1 * Math.cos(x * path.freq1)
  + path.amp2 * path.freq2 * Math.cos(x * path.freq2 + 1.3);

export const DISSOLVE = 3;         // seconds one shot takes to dither into the next

/* The order shots run in for a visit: the scene's first shot opens (it is the
   establishing one), then the rest shuffled, the whole list repeating. */
export function shotOrder(scene, seed) {
  const rng = new Rng(seed).fork('shots');
  const rest = scene.shots.slice(1).map((_, i) => i + 1);
  return [0, ...rng.shuffle(rest)];
}

const lengthOf = (scene, head) => scene.shots[head.order[head.at]].dur;

/* The playhead at second t of a visit nobody has touched. */
export function playheadAt(scene, seed, t) {
  const order = shotOrder(scene, seed);
  const dur = k => scene.shots[order[k]].dur;
  const total = order.reduce((n, _, k) => n + dur(k), 0);
  const lap = Math.floor(Math.max(t, 0) / total);
  let at = 0, since = lap * total;
  let from = lap > 0 ? { at: order.length - 1, since: since - dur(order.length - 1) } : null;
  while (at < order.length - 1 && t - since >= dur(at)) {
    from = { at, since };
    since += dur(at);
    at += 1;
  }
  return { order, at, since, from };
}

/* The playhead held on one shot, for stills and tests: as if that shot were
   the only one, repeating. */
export function holdShot(scene, seed, shot, t) {
  const order = shotOrder(scene, seed);
  const dur = scene.shots[shot].dur;
  return { order, at: order.indexOf(shot), since: t - (((t % dur) + dur) % dur), from: null };
}

/* Move on when the current shot has run its length. */
export function advance(scene, head, t) {
  let h = head;
  while (t - h.since >= lengthOf(scene, h)) {
    h = { order: h.order, at: (h.at + 1) % h.order.length, since: h.since + lengthOf(scene, h), from: { at: h.at, since: h.since } };
  }
  return h;
}

/* The viewer asks for the next shot (step 1) or the one before (step -1). */
export function move(scene, head, t, step) {
  const n = head.order.length;
  return { order: head.order, at: (((head.at + step) % n) + n) % n, since: t, from: { at: head.at, since: head.since } };
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

/* The camera of one shot, `age` seconds after it began. A shot is on screen
   for its length and then for the dissolve into the next, and travels the
   whole of that time. */
function cameraOf(scene, ship, index, age, t, aspect) {
  const shot = scene.shots[index];
  const tall = aspect < 0.9 && shot.tall ? shot.tall : shot;
  const u = clamp(age / (shot.dur + DISSOLVE), 0, 1);
  const pos = lerp3(tall.from.pos, tall.to.pos, u);
  const look = lerp3(tall.from.look, tall.to.look, u);
  const fov = lerp(tall.from.fov ?? shot.from.fov, tall.to.fov ?? shot.to.fov, u);
  // a little hand-held sway, never enough to read as shake
  const sway = [Math.sin(t * 0.21 + index) * 0.6, Math.sin(t * 0.17 + 1.3 + index) * 0.6, Math.sin(t * 0.13 + 2.1) * 0.4];
  const c = Math.cos(ship.yaw), s = Math.sin(ship.yaw);
  /* The hull heaves a few metres. From far off the camera lets it, and the
     ship is seen to ride. Close in, a few metres is the whole frame, so the
     camera rides with it and it is the land behind that moves. */
  const range = Math.hypot(pos[0] - look[0], pos[1] - look[1], pos[2] - look[2]);
  const follow = 1 - smoothstep(70, 260, range);
  // out of the ship's frame, into the local frame whose origin rides under the ship
  const place = p => [c * p[0] - s * p[1], s * p[0] + c * p[1], ship.z + p[2] + follow * ship.heave];
  return {
    eye: place([pos[0] + sway[0], pos[1] + sway[1], pos[2] + sway[2]]),
    target: place(look),
    fov: verticalFov(fov, aspect),
  };
}

/* Everything the renderer needs for second t. `fade` runs 0..1 as the current
   shot dissolves in, and until it reaches 1 `outgoing` is the shot it is
   dissolving from, still running. */
export function frameAt(scene, seed, t, aspect = 16 / 9, head = playheadAt(scene, seed, t)) {
  const start = new Rng(seed).fork('start').range(0, 60000);
  const ship = shipAt(scene, start, t);
  const index = head.order[head.at];
  const age = t - head.since;
  const fade = head.from ? clamp(age / DISSOLVE, 0, 1) : 1;
  return {
    t, seed, start,
    origin: [ship.x, ship.y], altitude: ship.z,
    ship: { pos: [0, 0, ship.z + ship.heave], yaw: ship.yaw, pitch: ship.pitch, roll: ship.roll },
    camera: cameraOf(scene, ship, index, age, t, aspect),
    shot: index, shotAge: age, fade,
    outgoing: fade < 1
      ? { shot: head.order[head.from.at], camera: cameraOf(scene, ship, head.order[head.from.at], t - head.from.since, t, aspect) }
      : null,
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
