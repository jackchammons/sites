/*
 * The page: a canvas, a clock and a few keys.
 *
 * On load it picks one scene at random, builds the airship from the parameter
 * file and starts drawing. A click, a tap or the space bar moves to the next
 * scene. Everything that decides what is drawn lives in the modules this
 * imports; this file only connects them to the browser.
 *
 * Query parameters, for looking at one thing: ?scene=valley, ?seed=7,
 * ?shot=2, ?t=40 (hold that second), ?raw=1 (before the palette), ?px=4
 * (device pixels per art pixel).
 */
import { PARAMS } from './params.js';
import { buildShip } from './ship.js';
import { Renderer } from './renderer.js';
import { SCENES, sceneById } from './scenes.js';
import { frameAt, roomLights } from './director.js';
import { artSize, TARGET_PIXELS } from './layout.js';

const canvas = document.getElementById('view');
const note = document.getElementById('note');
const query = new URLSearchParams(location.search);
const num = name => (query.has(name) && query.get(name) !== '' && Number.isFinite(Number(query.get(name))) ? Number(query.get(name)) : null);

const FPS = 30;
let budget = TARGET_PIXELS;          // art pixels to draw; lowered if frames run late
const still = matchMedia('(prefers-reduced-motion: reduce)').matches;

function fail(message) {
  note.textContent = message;
  note.hidden = false;
  canvas.hidden = true;
}

let renderer = null;
let seed = num('seed') ?? (Math.random() * 0xffffffff) >>> 0;
let sceneIndex = (() => {
  const named = sceneById(query.get('scene'));
  return named ? SCENES.indexOf(named) : seed % SCENES.length;
})();
let epoch = performance.now();      // when the current scene began
const heldTime = num('t');
const forcedShot = num('shot');

const scene = () => SCENES[sceneIndex];
const sceneTime = () => (heldTime ?? (still ? 5 : (performance.now() - epoch) / 1000));

function layout() {
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const w = Math.max(1, Math.round(canvas.clientWidth * dpr)), h = Math.max(1, Math.round(canvas.clientHeight * dpr));
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  const art = artSize(w, h, budget, num('px') ?? 0);
  renderer.resize(art.width, art.height, art.scale);
}

function draw(t, options = {}) {
  layout();
  const frame = frameAt(scene(), seed, t, renderer.width / renderer.height, forcedShot);
  renderer.render(frame, { still: heldTime !== null || still, ...options });
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
  canvas.setAttribute('aria-label', `${document.title}: ${scene().title.toLowerCase()}. Click, tap or press Space for another scene.`);
  return true;
}

function nextScene(step = 1) {
  if (!renderer) return;
  sceneIndex = (sceneIndex + step + SCENES.length) % SCENES.length;
  seed = (seed + 0x9e3779b9) >>> 0;
  epoch = performance.now();
  renderer.setScene(scene(), roomLights(scene(), seed), 0);
  canvas.setAttribute('aria-label', `${document.title}: ${scene().title.toLowerCase()}. Click, tap or press Space for another scene.`);
  if (still || heldTime !== null) draw(sceneTime());
}

/* A device that cannot draw thirty frames a second is given fewer, larger
   pixels until it can: the picture gets chunkier, which it can afford, and
   stays smooth, which it cannot do without. */
let last = 0, late = 0;
function tick(now) {
  requestAnimationFrame(tick);
  if (!renderer || now - last < 1000 / FPS - 2) return;
  const gap = now - last;
  if (last && gap < 500) late = gap > 55 ? late + 1 : Math.max(0, late - 1);
  if (late > 40 && budget > 30000) { budget = Math.round(budget * 0.7); late = 0; }
  last = now;
  try { draw(sceneTime()); } catch (e) { console.error(e); renderer = null; fail('The scene could not be drawn on this device.'); }
}

if (start()) {
  if (heldTime !== null || still) {
    draw(sceneTime());
    addEventListener('resize', () => renderer && draw(sceneTime()));
  } else {
    requestAnimationFrame(tick);
  }
  canvas.addEventListener('click', () => nextScene(1));
  addEventListener('keydown', e => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === ' ' || e.key === 'ArrowRight' || e.key === 'Enter') { e.preventDefault(); nextScene(1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); nextScene(-1); }
    else if (/^[1-9]$/.test(e.key) && Number(e.key) <= SCENES.length) { sceneIndex = Number(e.key) - 1; nextScene(0); }
  });
  canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); renderer = null; });
  canvas.addEventListener('webglcontextrestored', () => { if (start() && (heldTime !== null || still)) draw(sceneTime()); });
}

/* For the browser check and for taking stills: draw an exact second and say
   what was drawn. Not used by the page itself. */
window.__vibes = {
  ready: !!renderer,
  scenes: SCENES.map(s => s.id),
  frame(t, options = {}) {
    if (options.scene !== undefined) {
      const next = sceneById(options.scene);
      if (next && next !== scene()) { sceneIndex = SCENES.indexOf(next); renderer.setScene(next, roomLights(next, seed), 0); }
    }
    if (options.seed !== undefined && options.seed !== seed) { seed = options.seed >>> 0; renderer.setScene(scene(), roomLights(scene(), seed), 0); }
    layout();
    const frame = frameAt(scene(), seed, t, renderer.width / renderer.height, options.shot ?? forcedShot);
    renderer.render(frame, { still: !options.live, raw: options.raw, caption: options.caption });
    const gl = renderer.gl;
    const info = { scene: scene().id, shot: frame.shot, width: renderer.width, height: renderer.height, scale: renderer.scale, error: gl.getError() };
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
