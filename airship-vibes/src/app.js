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
 *   the slider beside the speaker                 how loud
 *
 * Music cannot start by itself: a browser only lets a page make sound once it
 * has been touched. So the first tap, click or key starts it, and the
 * speaker button turns it off again; that choice is remembered.
 *
 * Everything that decides what is drawn or played lives in the modules this
 * imports; this file only connects them to the browser.
 *
 * Query parameters, for looking at one thing: ?scene=valley, ?seed=7,
 * ?shot=2, ?t=40 (hold that second, and hide the controls), ?q=0.5 (hold the
 * picture at half its best sharpness), ?px=2 (device pixels per drawn pixel),
 * ?aa=0 (no antialiasing).
 */
import { PARAMS } from './params.js';
import { buildShip } from './ship.js';
import { Renderer } from './renderer.js';
import { SCENES, sceneById } from './scenes.js';
import { frameAt, roomLights, playheadAt, holdShot, advance, move, DISSOLVE } from './director.js';
import { renderSize, leastQuality } from './layout.js';
import { Pace, FRAME_MS } from './pace.js';
import { classify, isDouble } from './gesture.js';
import { renderText } from './font.js';
import { Player } from './audio.js';

const canvas = document.getElementById('view');
const caption = document.getElementById('caption');
const note = document.getElementById('note');
const audioBox = document.getElementById('audio');
const soundButton = document.getElementById('sound');
const volumeSlider = document.getElementById('volume');
const tip = document.getElementById('tip');
const tipText = document.getElementById('tip-text');
const tipClose = document.getElementById('tip-close');
const query = new URLSearchParams(location.search);
const num = name => (query.has(name) && query.get(name) !== '' && Number.isFinite(Number(query.get(name))) ? Number(query.get(name)) : null);

const TIP_AFTER = 45000;             // ms on one scene before the hint about the others
const TIP_FOR = 20000;               // ms the hint stays if nobody dismisses it
const SLIDER_FOR = 4000;             // ms the volume slider stays out after a touch
const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
const coarse = matchMedia('(pointer: coarse)').matches;
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
  caption.hidden = true;
  audioBox.hidden = true;
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
let leaving = null;                 // the scene just left, kept running while the new one dissolves in

const describe = () => canvas.setAttribute('aria-label',
  `${document.title}: ${scene().title.toLowerCase()}. Tap or press the right arrow for the next shot, `
  + 'swipe right or press the left arrow for the one before, double-tap or press Enter for another scene.');

/* ---- how sharp ------------------------------------------------------------- */

/* How many pixels are drawn is settled by pace.js, from how the frames are
   arriving. A still, or a size asked for in the address, is drawn as asked. */
const forcedPx = num('px'), forcedQuality = num('q');
const remembered = Number(memory.get('quality'));
const pace = new Pace(
  forcedQuality ?? (held || still ? 1 : remembered > 0 && remembered <= 1 ? remembered : 0.5),
  0.1, held || still || forcedPx !== null || forcedQuality !== null);
let cssSize = '';

function layout(px = forcedPx) {
  const dpr = window.devicePixelRatio || 1;
  const cw = Math.max(1, canvas.clientWidth), ch = Math.max(1, canvas.clientHeight);
  if (cssSize !== `${cw}x${ch}`) {
    // a new window, or a phone turned over: what was learnt about the old size no longer holds
    cssSize = `${cw}x${ch}`;
    pace.least = leastQuality(cw, ch, dpr);
    pace.quality = Math.max(pace.quality, pace.least);
    pace.pause();
    showCaption();
  }
  const art = renderSize(cw, ch, dpr, pace.quality, px ?? 0);
  if (canvas.width !== art.width || canvas.height !== art.height) { canvas.width = art.width; canvas.height = art.height; }
  renderer.resize(art.width, art.height, art.dot);
}

/* ---- the caption ----------------------------------------------------------- */

/* The scene's name, in a 5 x 7 face, for the first few seconds. It is a small
   canvas of its own over the picture, enlarged by whole numbers with hard
   edges: lettering wants to be crisp at any size the picture is drawn. */
let captionFor = '', captionShown = -1;
function showCaption() {
  const face = renderText(scene().title);
  const k = canvas.clientWidth < 900 ? 2 : 3;        // screen pixels to one of the face's
  const key = `${scene().id}/${k}`;
  if (key === captionFor) return;
  captionFor = key;
  const w = face.width + 1, h = face.height + 1;
  caption.width = w; caption.height = h;
  const ctx = caption.getContext('2d');
  const img = ctx.createImageData(w, h);
  const put = (x, y, r, g, b, a) => img.data.set([r, g, b, a], (y * w + x) * 4);
  // a shadow one pixel down and to the right, then the ink over it
  for (let y = 0; y < face.height; y++) for (let x = 0; x < face.width; x++) if (face.data[y * face.width + x]) put(x + 1, y + 1, 10, 14, 28, 190);
  for (let y = 0; y < face.height; y++) for (let x = 0; x < face.width; x++) if (face.data[y * face.width + x]) put(x, y, 255, 248, 232, 255);
  ctx.putImageData(img, 0, 0);
  caption.style.width = `${w * k}px`;
  caption.style.height = `${h * k}px`;
}
// It comes up over the first second of a scene and is gone by the ninth.
function fadeCaption(age, show = true) {
  const a = show ? Math.max(0, Math.min(1, age / 1.2, (9 - age) / 1.5)) : 0;
  const shown = Math.round(a * 50) / 50;
  if (shown === captionShown) return;
  captionShown = shown;
  caption.style.opacity = String(shown);
}

/* ---- drawing ---------------------------------------------------------------- */

function draw(t, options = {}) {
  layout();
  if (forcedShot !== null) head = holdShot(scene(), seed, forcedShot, t);
  else head = advance(scene(), head, t);
  const aspect = renderer.width / renderer.height;
  const frame = frameAt(scene(), seed, t, aspect, head);
  if (leaving && t < DISSOLVE) {
    // the old scene carries on from where it was, on its own clock
    const was = SCENES[leaving.sceneIndex], then = (performance.now() - leaving.epoch) / 1000;
    leaving.head = advance(was, leaving.head, then);
    options = { ...options, leaving: { frame: frameAt(was, leaving.seed, then, aspect, { ...leaving.head, from: null }), fade: t / DISSOLVE } };
  } else {
    leaving = null;
  }
  renderer.render(frame, { still: held || still, ...options });
  fadeCaption(t);
  return { ...frame, busy: (!!frame.outgoing && frame.fade < 1) || !!leaving };
}

function start() {
  const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, depth: false, stencil: false, powerPreference: 'high-performance' });
  if (!gl) { fail('This page draws with WebGL 2, and this browser did not offer it.'); return false; }
  try {
    renderer = new Renderer(gl, buildShip(PARAMS.inputs), { samples: num('aa') ?? 4 });
    cssSize = '';
    layout();
    renderer.setScene(scene(), roomLights(scene(), seed));
  } catch (e) {
    console.error(e);
    fail('The scene could not be drawn on this device.');
    return false;
  }
  describe();
  showCaption();
  return true;
}

/* ---- sound --------------------------------------------------------------- */

let player = null;
let soundOn = memory.get('sound') !== 'off';
// The slider's place, 0..1, kept apart from on and off: turning the sound back on returns to it.
let volume = (() => { const v = Number(memory.get('volume')); return v > 0 && v <= 1 ? v : 1; })();
// Loudness follows the square of the slider, which is nearer to how it is heard.
const level = () => 0.9 * volume * volume;
const showSound = () => {
  soundButton.setAttribute('aria-pressed', String(soundOn));
  soundButton.setAttribute('aria-label', soundOn ? 'Sound is on. Turn it off' : 'Sound is off. Turn it on');
  const shown = soundOn ? Math.round(volume * 100) : 0;
  volumeSlider.value = String(shown);
  volumeSlider.style.setProperty('--v', `${shown}%`);
  volumeSlider.setAttribute('aria-valuetext', soundOn ? `${shown}%` : 'Off');
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
      player.setLevel(level());
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
  if (on) { wake(); if (player) player.setLevel(level()); }
  else if (player) player.ctx.suspend();
}

function setVolume(v) {
  if (v <= 0) { setSound(false); return; }
  volume = Math.min(1, v);
  memory.set('volume', volume.toFixed(2));
  if (!soundOn) setSound(true);
  else { showSound(); if (player) player.setLevel(level()); }
}

/* The slider comes out beside the speaker when a pointer is over either (CSS
   does that), or when either has the keyboard. A finger has no hover, so a
   touch on the speaker brings it out for a few seconds as well. */
let sliderTimer = 0;
function openSlider() {
  audioBox.classList.add('open');
  clearTimeout(sliderTimer);
  sliderTimer = setTimeout(() => audioBox.classList.remove('open'), SLIDER_FOR);
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
    tipText.textContent = coarse ? 'Double-tap for another scene' : 'Double-click for another scene';
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
  leaving = held || still ? null : { sceneIndex, seed, epoch, head };
  sceneIndex = to ?? (sceneIndex + step + SCENES.length) % SCENES.length;
  seed = (seed + 0x9e3779b9) >>> 0;
  epoch = performance.now();
  head = playheadAt(scene(), seed, 0);
  renderer.setScene(scene(), roomLights(scene(), seed));
  describe();
  showCaption();
  learned();
  if (player) player.play(scene().id, seed);
  if (still || held) draw(sceneTime());
}

/* Thirty frames a second, at whatever sharpness the device can draw them:
   see pace.js. While it is finding that out it draws on every frame the
   screen offers; once it knows, on every frame that is due. */
let last = 0, settled = '', dissolving = false;
function tick(now) {
  requestAnimationFrame(tick);
  if (!renderer) return;
  const gap = now - last;
  // (a dissolve is never probed: it is two pictures, and drawing those as fast as the screen allows proves nothing)
  if ((!pace.probing || dissolving) && gap < FRAME_MS - 2) return;
  last = now;
  try {
    const frame = draw(sceneTime());
    dissolving = frame.busy;
    if (pace.frame(gap, frame.busy)) memory.set('quality', pace.quality.toFixed(3));
    // as soft as it may be drawn and still late: do without antialiasing, and see what that buys
    if (pace.starved && renderer.samples > 1) { renderer.setSamples(0); pace.reprobe(); }
    // a new shot may cost more or less than the last: look again once it has the screen to itself
    const showing = `${scene().id}/${frame.shot}`;
    if (!frame.busy && showing !== settled) { settled = showing; pace.reprobe(); }
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
  // A double tap's first tap has already moved on a shot by the time the second lands. The
  // playhead from before it is kept, so the scene is left on the shot the viewer was looking at.
  let down = null, lastTap = null, beforeTap = null;
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
    else if (isDouble(lastTap, up)) { if (beforeTap) head = beforeTap; stepScene(1); lastTap = null; }
    else { beforeTap = head; stepShot(1); lastTap = up; }
  });

  addEventListener('keydown', e => {
    if (e.metaKey || e.ctrlKey || e.altKey || audioBox.contains(e.target) || e.target === tipClose) return;
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

  /* A control that has been clicked or touched keeps the keyboard's focus, and
     the slider stays out for as long as either control has it. That is right
     for someone using the keyboard and wrong for a pointer or a finger, where
     it would hold the slider out until something else was touched. So focus
     that a pointer gave is handed straight back. */
  let byPointer = false;
  audioBox.addEventListener('pointerdown', () => { byPointer = true; });
  audioBox.addEventListener('keydown', () => { byPointer = false; });
  soundButton.addEventListener('click', () => { setSound(!soundOn); openSlider(); if (byPointer) soundButton.blur(); });
  volumeSlider.addEventListener('input', () => { setVolume(Number(volumeSlider.value) / 100); openSlider(); });
  // letting go of the slider is a touch the browser will start sound from; moving it may not be
  volumeSlider.addEventListener('change', () => { if (soundOn) wake(); if (byPointer) volumeSlider.blur(); });
  tipClose.addEventListener('click', learned);
  // sound stops with the picture: a hidden tab is silent
  document.addEventListener('visibilitychange', () => {
    pace.pause();
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
  state: () => ({ scene: scene().id, shot: head.order[head.at], fading: !!head.from && sceneTime() - head.since < DISSOLVE,
    sound: soundOn, volume, level: player ? player.level : null, playing: !!player && player.ctx.state === 'running', song: player ? player.playing : null,
    tip: !tip.hidden, slider: audioBox.classList.contains('open'),
    quality: pace.quality, pace: pace.fixed ? 'fixed' : pace.mode, samples: renderer ? renderer.samples : 0,
    width: canvas.width, height: canvas.height }),
  frame(t, options = {}) {
    if (options.scene !== undefined) {
      const next = sceneById(options.scene);
      if (next && next !== scene()) { sceneIndex = SCENES.indexOf(next); renderer.setScene(next, roomLights(next, seed)); showCaption(); }
    }
    if (options.seed !== undefined && options.seed !== seed) { seed = options.seed >>> 0; renderer.setScene(scene(), roomLights(scene(), seed)); }
    layout(options.px ?? forcedPx);
    const shot = options.shot ?? forcedShot;
    const at = shot === null || shot === undefined ? playheadAt(scene(), seed, t) : holdShot(scene(), seed, shot, t);
    const frame = frameAt(scene(), seed, t, renderer.width / renderer.height, at);
    renderer.render(frame, { still: !options.live });
    fadeCaption(t, options.caption !== false);
    const gl = renderer.gl;
    const info = { scene: scene().id, shot: frame.shot, fade: frame.fade, width: renderer.width, height: renderer.height, dot: renderer.dot, error: gl.getError() };
    if (options.probe) {
      // Read the picture back: how many colours it uses, how much of it is the
      // commonest one, and how bright it is on the whole.
      const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
      const px = new Uint8Array(w * h * 4);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
      const seen = new Map();
      let light = 0;
      for (let o = 0; o < px.length; o += 4) {
        const c = px[o] << 16 | px[o + 1] << 8 | px[o + 2];
        seen.set(c, (seen.get(c) || 0) + 1);
        light += 0.299 * px[o] + 0.587 * px[o + 1] + 0.114 * px[o + 2];
      }
      Object.assign(info, { samples: w * h, colours: seen.size, largest: Math.max(...seen.values()) / (w * h), light: light / (w * h) / 255 });
      if (options.pixels) info.pixels = Array.from(px);
    }
    return info;
  },
};
