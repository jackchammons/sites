/*
 * The page: a canvas, a clock, and what the viewer does to them.
 *
 * On load it picks one scene at random, builds the airship from the parameter
 * file and starts drawing. Left alone it plays each shot of the scene in turn.
 *
 *   tap, click, swipe left, Space, right arrow    the next shot
 *   swipe right, left arrow                       the shot before
 *   double tap, double click, Enter               the next scene
 *   1 to 4                                        that scene
 *   M, or the speaker in the corner               sound on and off
 *
 * Music cannot start by itself: a browser only lets a page make sound once it
 * has been touched. So the first tap, click or key starts it, and the
 * speaker button turns it off again; that choice is remembered.
 *
 * Everything that decides what is drawn or played lives in the modules this
 * imports; this file only connects them to the browser.
 *
 * Query parameters, for looking at one thing: ?scene=valley, ?seed=7,
 * ?shot=2, ?t=40 (hold that second, and hide the controls), ?raw=1 (before
 * the palette), ?px=4 (device pixels per art pixel).
 */
import { PARAMS } from './params.js';
import { buildShip } from './ship.js';
import { Renderer } from './renderer.js';
import { SCENES, sceneById } from './scenes.js';
import { frameAt, roomLights, playheadAt, holdShot, advance, move } from './director.js';
import { artSize, TARGET_PIXELS } from './layout.js';
import { classify, isDouble } from './gesture.js';
import { Player } from './audio.js';

const canvas = document.getElementById('view');
const note = document.getElementById('note');
const soundButton = document.getElementById('sound');
const tip = document.getElementById('tip');
const tipText = document.getElementById('tip-text');
const tipClose = document.getElementById('tip-close');
const query = new URLSearchParams(location.search);
const num = name => (query.has(name) && query.get(name) !== '' && Number.isFinite(Number(query.get(name))) ? Number(query.get(name)) : null);

const FPS = 30;
const TIP_AFTER = 45000;             // ms on one scene before the hint about the others
const TIP_FOR = 20000;               // ms the hint stays if nobody dismisses it
let budget = TARGET_PIXELS;          // art pixels to draw; lowered if frames run late
const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
const heldTime = num('t');
const forcedShot = num('shot');
const held = heldTime !== null;      // a still for looking at: no controls, no hint
if (held) document.body.classList.add('held');

// What the viewer has chosen before. Storage can be refused; the page works without it.
const memory = {
  get(key) { try { return localStorage.getItem('airship-vibes.' + key); } catch { return null; } },
  set(key, value) { try { localStorage.setItem('airship-vibes.' + key, value); } catch { /* private mode */ } },
};

function fail(message) {
  note.textContent = message;
  note.hidden = false;
  canvas.hidden = true;
  soundButton.hidden = true;
}

let renderer = null;
let seed = num('seed') ?? (Math.random() * 0xffffffff) >>> 0;
let sceneIndex = (() => {
  const named = sceneById(query.get('scene'));
  return named ? SCENES.indexOf(named) : seed % SCENES.length;
})();
let epoch = performance.now();      // when the current scene began
const scene = () => SCENES[sceneIndex];
const sceneTime = () => (heldTime ?? (still ? 5 : (performance.now() - epoch) / 1000));
let head = playheadAt(scene(), seed, 0);

const describe = () => canvas.setAttribute('aria-label',
  `${document.title}: ${scene().title.toLowerCase()}. Tap or press the right arrow for the next shot, `
  + 'swipe right or press the left arrow for the one before, double-tap or press Enter for another scene.');

function layout() {
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const w = Math.max(1, Math.round(canvas.clientWidth * dpr)), h = Math.max(1, Math.round(canvas.clientHeight * dpr));
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  const art = artSize(w, h, budget, num('px') ?? 0);
  renderer.resize(art.width, art.height, art.scale);
  // the caption is doubled where an art pixel is under two CSS pixels, or it is too small to read
  renderer.captionScale = art.scale / dpr < 2 ? 2 : 1;
}

function draw(t, options = {}) {
  layout();
  if (forcedShot !== null) head = holdShot(scene(), seed, forcedShot, t);
  else head = advance(scene(), head, t);
  const frame = frameAt(scene(), seed, t, renderer.width / renderer.height, head);
  renderer.render(frame, { still: held || still, ...options });
  return frame;
}

function start() {
  const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, depth: false, stencil: false, powerPreference: 'high-performance' });
  if (!gl) { fail('This page draws with WebGL 2, and this browser did not offer it.'); return false; }
  try {
    renderer = new Renderer(gl, buildShip(PARAMS.inputs));
    renderer.raw = query.get('raw') === '1';
    layout();
    renderer.setScene(scene(), roomLights(scene(), seed), 0);
  } catch (e) {
    console.error(e);
    fail('The scene could not be drawn on this device.');
    return false;
  }
  describe();
  return true;
}

/* ---- sound --------------------------------------------------------------- */

let player = null;
let soundOn = memory.get('sound') !== 'off';
const showSound = () => {
  soundButton.setAttribute('aria-pressed', String(soundOn));
  soundButton.setAttribute('aria-label', soundOn ? 'Sound is on. Turn it off' : 'Sound is off. Turn it on');
};

// Called from inside a tap, click or key, which is the only place a browser allows sound to begin.
function wake() {
  if (!soundOn || held) return;
  if (!player) {
    const Context = window.AudioContext || window.webkitAudioContext;
    if (!Context) return;
    try {
      // On a phone this is music, to be heard like any other player's, not an alert to be silenced with the ringer.
      if (navigator.audioSession) navigator.audioSession.type = 'playback';
      player = new Player(new Context());
      player.play(scene().id, seed);
      setInterval(() => { if (player && soundOn && player.ctx.state === 'running') player.pump(); }, 90);
    } catch (e) { console.error(e); player = null; return; }
  }
  if (player.ctx.state !== 'running' && !document.hidden) player.ctx.resume();
}

function setSound(on) {
  soundOn = on;
  memory.set('sound', on ? 'on' : 'off');
  showSound();
  if (on) wake();
  else if (player) player.ctx.suspend();
}

/* ---- the hint ------------------------------------------------------------- */

let tipTimer = 0, tipGone = 0;
const hideTip = () => { tip.hidden = true; clearTimeout(tipGone); };
// Once someone has changed scene, or waved the hint away, they do not need telling again.
function learned() {
  clearTimeout(tipTimer);
  hideTip();
  memory.set('scenes', 'known');
}
function armTip() {
  if (held || memory.get('scenes') === 'known') return;
  tipTimer = setTimeout(() => {
    tipText.textContent = matchMedia('(pointer: coarse)').matches ? 'Double-tap for another scene' : 'Double-click for another scene';
    tip.hidden = false;
    tipGone = setTimeout(hideTip, TIP_FOR);
  }, TIP_AFTER);
}

/* ---- moving about ---------------------------------------------------------- */

function stepShot(step) {
  if (!renderer || forcedShot !== null) return;
  head = move(scene(), head, sceneTime(), step);
  if (still || held) draw(sceneTime());
}

function stepScene(step, to = null) {
  if (!renderer) return;
  sceneIndex = to ?? (sceneIndex + step + SCENES.length) % SCENES.length;
  seed = (seed + 0x9e3779b9) >>> 0;
  epoch = performance.now();
  head = playheadAt(scene(), seed, 0);
  renderer.setScene(scene(), roomLights(scene(), seed), 0);
  describe();
  learned();
  if (player) player.play(scene().id, seed);
  if (still || held) draw(sceneTime());
}

/* A device that cannot draw thirty frames a second is given fewer, larger
   pixels until it can: the picture gets chunkier, which it can afford, and
   stays smooth, which it cannot do without. */
let last = 0, late = 0;
function tick(now) {
  requestAnimationFrame(tick);
  if (!renderer || now - last < 1000 / FPS - 2) return;
  const gap = now - last;
  last = now;
  try {
    const frame = draw(sceneTime());
    // a dissolve draws two shots at once and is allowed to be slow
    if (gap < 500 && !frame.outgoing) late = gap > 55 ? late + 1 : Math.max(0, late - 1);
    if (late > 40 && budget > 30000) { budget = Math.round(budget * 0.7); late = 0; }
  } catch (e) { console.error(e); renderer = null; fail('The scene could not be drawn on this device.'); }
}

if (start()) {
  if (held || still) {
    draw(sceneTime());
    addEventListener('resize', () => renderer && draw(sceneTime()));
  } else {
    requestAnimationFrame(tick);
  }
  showSound();
  armTip();

  // taps and swipes on the picture
  let down = null, lastTap = null;
  canvas.addEventListener('pointerdown', e => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    down = { x: e.clientX, y: e.clientY, t: e.timeStamp, id: e.pointerId };
  });
  canvas.addEventListener('pointercancel', () => { down = null; });
  canvas.addEventListener('pointerup', e => {
    if (!down || e.pointerId !== down.id) return;
    const up = { x: e.clientX, y: e.clientY, t: e.timeStamp };
    const what = classify(down, up);
    down = null;
    if (!what) return;
    wake();
    if (what === 'right') { stepShot(-1); lastTap = null; }
    else if (what === 'left') { stepShot(1); lastTap = null; }
    else if (isDouble(lastTap, up)) { stepScene(1); lastTap = null; }
    else { stepShot(1); lastTap = up; }
  });

  addEventListener('keydown', e => {
    if (e.metaKey || e.ctrlKey || e.altKey || e.target === soundButton || e.target === tipClose) return;
    const k = e.key;
    if (k === ' ' || k === 'ArrowRight') stepShot(1);
    else if (k === 'ArrowLeft') stepShot(-1);
    else if (k === 'Enter' || k === 'ArrowDown' || k === 'n') stepScene(1);
    else if (k === 'ArrowUp' || k === 'p') stepScene(-1);
    else if (/^[1-9]$/.test(k) && Number(k) <= SCENES.length) stepScene(0, Number(k) - 1);
    else if (k === 'm') { setSound(!soundOn); return; }
    else return;
    e.preventDefault();
    wake();
  });

  soundButton.addEventListener('click', () => setSound(!soundOn));
  tipClose.addEventListener('click', learned);
  // sound stops with the picture: a hidden tab is silent
  document.addEventListener('visibilitychange', () => {
    if (!player) return;
    if (document.hidden) player.ctx.suspend();
    else if (soundOn) player.ctx.resume();
  });

  canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); renderer = null; });
  canvas.addEventListener('webglcontextrestored', () => { if (start() && (held || still)) draw(sceneTime()); });
}

/* For the browser check and for taking stills: draw an exact second and say
   what was drawn. Not used by the page itself. */
window.__vibes = {
  ready: !!renderer,
  scenes: SCENES.map(s => s.id),
  // where the page is now, as the viewer has left it
  state: () => ({ scene: scene().id, shot: head.order[head.at], fading: !!head.from && sceneTime() - head.since < 3,
    sound: soundOn, playing: !!player && player.ctx.state === 'running', tip: !tip.hidden }),
  frame(t, options = {}) {
    if (options.scene !== undefined) {
      const next = sceneById(options.scene);
      if (next && next !== scene()) { sceneIndex = SCENES.indexOf(next); renderer.setScene(next, roomLights(next, seed), 0); }
    }
    if (options.seed !== undefined && options.seed !== seed) { seed = options.seed >>> 0; renderer.setScene(scene(), roomLights(scene(), seed), 0); }
    layout();
    const shot = options.shot ?? forcedShot;
    const at = shot === null || shot === undefined ? playheadAt(scene(), seed, t) : holdShot(scene(), seed, shot, t);
    const frame = frameAt(scene(), seed, t, renderer.width / renderer.height, at);
    renderer.render(frame, { still: !options.live, raw: options.raw, caption: options.caption });
    const gl = renderer.gl;
    const info = { scene: scene().id, shot: frame.shot, fade: frame.fade, width: renderer.width, height: renderer.height, scale: renderer.scale, error: gl.getError() };
    if (options.probe) {
      // Read the picture back, one sample per art pixel: how many colours it
      // uses, and how many of its pixels are not in the scene's palette.
      const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight, k = renderer.scale;
      const px = new Uint8Array(w * h * 4);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
      const allowed = new Set(scene().palette.map(c => parseInt(c.slice(1), 16)));
      const seen = new Map(), all = [];
      let off = 0, n = 0;
      for (let y = Math.floor(k / 2); y < h; y += k) {
        for (let x = Math.floor(k / 2); x < w; x += k) {
          const o = (y * w + x) * 4, c = px[o] << 16 | px[o + 1] << 8 | px[o + 2];
          seen.set(c, (seen.get(c) || 0) + 1);
          if (!allowed.has(c)) off++;
          if (options.pixels) all.push(c);
          n++;
        }
      }
      Object.assign(info, { samples: n, colours: seen.size, offPalette: off, largest: Math.max(...seen.values()) / n });
      if (options.pixels) info.pixels = all;       // for scripts/fit-palette.mjs
    }
    return info;
  },
};
