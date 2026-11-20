/*
 * The sound: music.js's notes, made audible with Web Audio.
 *
 * Every instrument is synthesised when its note falls: the electric piano is
 * a few sine waves with a bell in the attack, the kick a sine sliding down in
 * pitch, the snare and hats filtered noise. A looped buffer of hiss and pops
 * is the record surface, another of low noise the wind past the hull, and the
 * whole mix goes through a low-pass, a slow wobble in pitch and a room built
 * from a burst of decaying noise, which between them are most of what makes a
 * recording sound old.
 *
 * buildGraph() and trigger() work on any BaseAudioContext, so the same code
 * plays live and renders to a buffer in a test (renderOffline). This module
 * creates no context of its own and touches nothing else in the browser.
 */
import { SONGS, eventsBetween, stepSeconds, frequency } from './music.js';
import { Rng } from './rng.js';

const AHEAD = 0.4;             // seconds of notes kept scheduled ahead of the clock

function noiseBuffer(ctx, seconds, fill) {
  const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
  fill(buf.getChannelData(0), ctx.sampleRate);
  return buf;
}

export function buildGraph(ctx) {
  const rng = new Rng(20261119);
  const gain = (v, to) => { const g = ctx.createGain(); g.gain.value = v; if (to) g.connect(to); return g; };
  const filter = (type, freq, q, to) => { const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q; if (to) f.connect(to); return f; };

  // out <- tape low-pass <- compressor <- master
  const out = gain(0, ctx.destination);
  const tape = filter('lowpass', 8500, 0.5, out);
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -18; comp.knee.value = 14; comp.ratio.value = 3; comp.attack.value = 0.012; comp.release.value = 0.28;
  comp.connect(tape);
  const master = gain(0.85, comp);

  // a room: noise that dies away, darker as it goes
  const room = ctx.createConvolver();
  const len = Math.floor(ctx.sampleRate * 2.2);
  const ir = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = ir.getChannelData(ch);
    let low = 0;
    for (let i = 0; i < len; i++) {
      const t = i / len;
      low += (rng.range(-1, 1) - low) * (0.5 - 0.42 * t);
      d[i] = low * Math.exp(-5.5 * t) * (i < 300 ? i / 300 : 1);
    }
  }
  room.buffer = ir;
  room.connect(gain(0.5, master));

  const drums = gain(1.0, master);
  // the piano's bus breathes with the kick and trembles slightly
  const duck = gain(1, master);
  // the low-pass is the old tape; the high-pass keeps the left hand out of the bass's way
  const chords = gain(0.5, filter('highpass', 170, 0.5, filter('lowpass', 2900, 0.4, duck)));
  const tremolo = ctx.createOscillator();
  tremolo.frequency.value = 4.3;
  tremolo.connect(gain(0.05, chords.gain));
  const bass = gain(0.17, filter('lowpass', 700, 0.5, master));
  const leadFilter = filter('lowpass', 3600, 0.4, master);
  const lead = gain(0.62, leadFilter);
  // an echo on the melody, three sixteenths behind
  const echo = ctx.createDelay(1.5);
  const echoBack = gain(0.34, echo);
  echo.connect(filter('lowpass', 1700, 0.3, echoBack));
  echo.connect(gain(0.5, master));
  lead.connect(echo);
  lead.connect(gain(0.55, room));
  chords.connect(gain(0.3, room));

  // tape wow: everything pitched drifts a few cents, slowly
  const wow = ctx.createOscillator();
  wow.frequency.value = 0.37;
  const wowDepth = gain(7);
  wow.connect(wowDepth);

  const white = noiseBuffer(ctx, 2, d => { for (let i = 0; i < d.length; i++) d[i] = rng.range(-1, 1); });
  // the record: hiss, and a pop every so often
  const vinyl = noiseBuffer(ctx, 6, (d, rate) => {
    for (let i = 0; i < d.length; i++) d[i] = rng.range(-1, 1) * 0.02;
    for (let n = 0; n < 6 * 13; n++) {
      const at = rng.int(d.length - 40), amp = rng.next() ** 3 * 0.7 * rng.sign();
      for (let k = 0; k < 24; k++) d[at + k] += amp * Math.exp(-k / (2 + rate / 44100 * 3));
    }
  });
  const texture = gain(0, master);
  const crackle = ctx.createBufferSource();
  crackle.buffer = vinyl; crackle.loop = true;
  crackle.connect(filter('highpass', 900, 0.3, filter('lowpass', 6500, 0.3, texture)));
  const windLevel = gain(0, master);
  const wind = ctx.createBufferSource();
  wind.buffer = white; wind.loop = true;
  wind.connect(filter('lowpass', 420, 0.3, windLevel));
  const gust = ctx.createOscillator();
  gust.frequency.value = 0.07;
  const gustDepth = gain(0, windLevel.gain);
  gust.connect(gustDepth);

  return { ctx, out, master, room, drums, duck, chords, bass, lead, echo, wowDepth, white, texture, windLevel, gustDepth,
    sources: [tremolo, wow, crackle, wind, gust], started: false };
}

/* Set the levels that belong to a song, and start the things that run all the time. */
export function dress(g, song, when) {
  if (!g.started) { for (const s of g.sources) s.start(when); g.started = true; }
  g.echo.delayTime.setValueAtTime(stepSeconds(song) * 3, when);
  g.texture.gain.setTargetAtTime(song.crackle * 1.3, when, 0.4);
  g.windLevel.gain.setTargetAtTime(song.wind * 0.07, when, 0.4);
  g.gustDepth.gain.setTargetAtTime(song.wind * 0.04, when, 0.4);
}

/* One note, starting at `when` on the context's clock. */
export function trigger(g, e, when) {
  const ctx = g.ctx;
  const osc = (type, freq, to, wow = true) => {
    const o = ctx.createOscillator();
    o.type = type; o.frequency.value = freq;
    if (wow) {
      g.wowDepth.connect(o.detune);
      // The wobble outlives every note. Left connected, it would hold on to each
      // finished oscillator, and a page left open all evening plays fifty thousand.
      o.onended = () => { try { g.wowDepth.disconnect(o.detune); } catch { /* already gone */ } };
    }
    o.connect(to);
    return o;
  };
  const env = (to, peak, attack) => {
    const v = ctx.createGain();
    v.gain.setValueAtTime(0.0001, when);
    v.gain.linearRampToValueAtTime(peak, when + attack);
    v.connect(to);
    return v;
  };
  const burst = (to, seconds) => {
    const s = ctx.createBufferSource();
    s.buffer = g.white;
    s.connect(to);
    s.start(when, (when * 7.3) % 1.5, seconds + 0.05);
    return s;
  };

  if (e.kind === 'kick') {
    const v = env(g.drums, e.vel * 0.62, 0.004);
    v.gain.exponentialRampToValueAtTime(0.001, when + 0.3);
    const o = osc('sine', 165, v, false);
    o.frequency.setValueAtTime(165, when);
    o.frequency.exponentialRampToValueAtTime(52, when + 0.1);
    o.start(when); o.stop(when + 0.34);
    // most of a kick is below what a phone's speaker can play: this knock is the part it can
    const knock = env(g.drums, e.vel * 0.3, 0.001);
    knock.gain.exponentialRampToValueAtTime(0.001, when + 0.035);
    const kb = ctx.createBiquadFilter();
    kb.type = 'bandpass'; kb.frequency.value = 900; kb.Q.value = 0.7;
    kb.connect(knock);
    burst(kb, 0.04);
    const thud = env(g.drums, e.vel * 0.25, 0.003);
    thud.gain.exponentialRampToValueAtTime(0.001, when + 0.12);
    const o2 = osc('triangle', 330, thud, false);
    o2.frequency.exponentialRampToValueAtTime(110, when + 0.07);
    o2.start(when); o2.stop(when + 0.15);
    // the piano steps back for the kick and comes forward again
    g.duck.gain.cancelScheduledValues(when);
    g.duck.gain.setValueAtTime(1, when);
    g.duck.gain.linearRampToValueAtTime(0.74, when + 0.03);
    g.duck.gain.linearRampToValueAtTime(1, when + 0.3);
  } else if (e.kind === 'snare') {
    const v = env(g.drums, e.vel * 1.1, 0.002);
    v.gain.exponentialRampToValueAtTime(0.001, when + e.dur);
    v.connect(g.room);
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass'; band.frequency.value = 1700; band.Q.value = 0.8;
    const top = ctx.createBiquadFilter();
    top.type = 'lowpass'; top.frequency.value = 6000;
    band.connect(top); top.connect(v);
    burst(band, e.dur);
    const body = env(g.drums, e.vel * 0.4, 0.002);
    body.gain.exponentialRampToValueAtTime(0.001, when + 0.09);
    const o = osc('triangle', 186, body, false);
    o.frequency.exponentialRampToValueAtTime(140, when + 0.08);
    o.start(when); o.stop(when + 0.12);
  } else if (e.kind === 'hat') {
    const v = env(g.drums, e.vel * 0.75, 0.001);
    v.gain.exponentialRampToValueAtTime(0.001, when + e.dur);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 5800;
    hp.connect(v);
    burst(hp, e.dur);
  } else if (e.kind === 'chord') {
    // an electric piano: two sines a few cents apart, an octave above them, a bell that is gone at once
    const f = frequency(e.midi), end = when + e.dur;
    const v = env(g.chords, e.vel * 0.26, 0.008);
    v.gain.setTargetAtTime(e.vel * 0.11, when + 0.01, 0.35);
    v.gain.setTargetAtTime(0.0001, end, 0.14);
    const parts = [osc('sine', f, v), osc('sine', f * 1.0035, v)];
    const upper = ctx.createGain(); upper.gain.value = 0.5; upper.connect(v);
    parts.push(osc('sine', f * 2, upper));
    const third = ctx.createGain(); third.gain.value = 0.2; third.connect(v);
    parts.push(osc('sine', f * 3, third));
    const bell = ctx.createGain();
    bell.gain.setValueAtTime(0.16, when);
    bell.gain.exponentialRampToValueAtTime(0.001, when + 0.14);
    bell.connect(v);
    parts.push(osc('sine', f * 5.02, bell));
    for (const o of parts) { o.start(when); o.stop(end + 0.9); }
  } else if (e.kind === 'bass') {
    const f = frequency(e.midi), end = when + e.dur;
    const v = env(g.bass, e.vel * 0.5, 0.012);
    v.gain.setTargetAtTime(e.vel * 0.36, when + 0.012, 0.2);
    v.gain.setTargetAtTime(0.0001, end, 0.05);
    // overtones carry the note on speakers too small for its fundamental
    const tri = ctx.createGain(); tri.gain.value = 0.9; tri.connect(v);
    const saw = ctx.createGain(); saw.gain.value = 0.28; saw.connect(v);
    for (const o of [osc('sine', f, v), osc('triangle', f, tri), osc('sawtooth', f, saw)]) { o.start(when); o.stop(end + 0.4); }
  } else if (e.kind === 'lead') {
    const f = frequency(e.midi), end = when + e.dur;
    const v = env(g.lead, e.vel * 0.5, 0.012);
    v.gain.setTargetAtTime(e.vel * 0.18, when + 0.012, 0.22);
    v.gain.setTargetAtTime(0.0001, end, 0.1);
    const upper = ctx.createGain(); upper.gain.value = 0.12; upper.connect(v);
    for (const o of [osc('triangle', f, v), osc('sine', f * 2, upper)]) { o.start(when); o.stop(end + 0.7); }
  }
}

/* Plays a scene's song on a live context, a fraction of a second ahead of its
   clock. pump() must be called a few times a second while it plays. */
export class Player {
  constructor(ctx) {
    this.ctx = ctx;
    this.g = buildGraph(ctx);
    this.song = null;
    this.seed = 1;
    this.origin = 0;          // the context time at which the song began
    this.done = 0;            // song time up to which notes have been scheduled
    this.level = 0.9;
    this.pending = null;
  }

  // Start a scene's song, or change to it: the old one fades, the new one rises.
  play(id, seed) {
    const song = SONGS[id];
    if (!song || (song === this.song && seed === this.seed)) return;
    const now = this.ctx.currentTime;
    const first = this.song === null;
    this.g.out.gain.cancelScheduledValues(now);
    this.g.out.gain.setTargetAtTime(0, now, first ? 0.001 : 0.22);
    this.pending = { song, seed, at: now + (first ? 0.05 : 0.8) };
  }

  setLevel(level) {
    this.level = level;
    if (this.song && !this.pending) this.g.out.gain.setTargetAtTime(level, this.ctx.currentTime, 0.15);
  }

  pump() {
    const now = this.ctx.currentTime;
    if (this.pending && now >= this.pending.at) {
      this.song = this.pending.song; this.seed = this.pending.seed; this.pending = null;
      this.origin = now + 0.12; this.done = 0;
      dress(this.g, this.song, now);
      this.g.out.gain.cancelScheduledValues(now);
      this.g.out.gain.setTargetAtTime(this.level, now, 0.9);
    }
    if (!this.song || this.pending) return;
    // after a long sleep, do not try to play everything that was missed
    if (now - this.origin - this.done > 1) this.done = now - this.origin;
    const until = now + AHEAD - this.origin;
    for (const e of eventsBetween(this.song, this.seed, this.done, until)) trigger(this.g, e, this.origin + e.time);
    this.done = Math.max(this.done, until);
  }
}

/* The first `seconds` of a song rendered to a buffer, for tests and for
   listening to one stem at a time. only: a kind of note, or 'texture'. */
export async function renderOffline(Offline, id, seed, seconds, only = null, sampleRate = 44100) {
  const ctx = new Offline(2, Math.floor(seconds * sampleRate), sampleRate);
  const g = buildGraph(ctx);
  const song = SONGS[id];
  g.out.gain.value = 0.9;
  dress(g, song, 0);
  if (only && only !== 'texture') { g.texture.gain.cancelScheduledValues(0); g.texture.gain.value = 0; g.windLevel.gain.cancelScheduledValues(0); g.windLevel.gain.value = 0; g.gustDepth.gain.cancelScheduledValues(0); g.gustDepth.gain.value = 0; }
  for (const e of eventsBetween(song, seed, 0, seconds)) {
    if (!only || e.kind === only) trigger(g, e, e.time);
  }
  return ctx.startRendering();
}
