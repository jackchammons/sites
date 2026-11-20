/*
 * The music, as data.
 *
 * Each scene has a slow loop in the lo-fi manner: four jazz chords on an
 * electric piano, a soft kick and snare with the off-beats late, a bass that
 * mostly holds the root, and now and then a few notes of melody. Nothing is
 * recorded: this module says which notes fall where, and audio.js makes the
 * sound of each.
 *
 * A bar is a pure function of the song, the visit's seed and the bar's number,
 * so the scheduler can ask for any stretch of time in any order and a test
 * can ask for bar 300. Pitches are MIDI note numbers (60 is middle C); times
 * are seconds from the start of the song.
 */
import { Rng } from './rng.js';

const chord = (notes, bass) => ({ notes, bass });

/* Chords are voiced without their roots, between G3 and A4: the bass has the
   root, and that register is one every speaker can play, a phone's included. */
export const SONGS = {
  // bright and open: IV - iii - ii - I in C
  valley: {
    bpm: 80, swing: 0.17, lead: 0.5, crackle: 0.3, wind: 0.5,
    chords: [chord([57, 60, 64, 67], 41), chord([55, 59, 62, 64], 40), chord([57, 60, 64, 65], 38), chord([59, 62, 64, 67], 36)],
    scale: [72, 74, 76, 79, 81, 84],
  },
  // late and jazzy: ii - V - I - VI in C, the VI altered
  city: {
    bpm: 70, swing: 0.2, lead: 0.4, crackle: 0.45, wind: 0.3,
    chords: [chord([57, 60, 64, 65], 38), chord([59, 64, 65, 69], 43), chord([59, 62, 64, 67], 36), chord([61, 65, 67, 70], 45)],
    scale: [69, 72, 74, 77, 79, 81],
  },
  // warm and slow: IV - iii - ii - I in E flat
  sunset: {
    bpm: 66, swing: 0.19, lead: 0.45, crackle: 0.4, wind: 0.4,
    chords: [chord([60, 63, 67, 70], 44), chord([58, 62, 65, 67], 43), chord([56, 60, 63, 67], 41), chord([55, 58, 62, 65], 39)],
    scale: [70, 72, 75, 77, 79, 82],
  },
  // airy: IV - iii - ii - I in D
  clouds: {
    bpm: 84, swing: 0.15, lead: 0.55, crackle: 0.25, wind: 0.7,
    chords: [chord([59, 62, 66, 69], 43), chord([57, 61, 64, 66], 42), chord([55, 59, 62, 66], 40), chord([61, 64, 66, 69], 38)],
    scale: [74, 76, 78, 81, 83, 86],
  },
};

export const STEPS = 16;                                  // sixteenths to the bar
export const stepSeconds = song => 60 / song.bpm / 4;
export const barSeconds = song => stepSeconds(song) * STEPS;

const KICKS = [[0, 7, 10], [0, 6, 10], [0, 10], [0, 3, 10]];

/* The notes of one bar, times relative to the start of the song.
   Each: { time, kind, midi, vel, dur }; kind is kick, snare, hat, chord, bass or lead. */
export function barEvents(song, seed, bar) {
  const rng = new Rng(seed).fork('bar' + bar);
  const step = stepSeconds(song), t0 = bar * barSeconds(song);
  // off-sixteenths are late: that is the swing
  const at = s => t0 + (s + (s % 2 ? song.swing : 0)) * step;
  const loose = () => rng.range(0, 0.008);
  const out = [];
  const add = (time, kind, vel, dur, midi = 0) => out.push({ time, kind, midi, vel, dur });

  const intro = bar < 2;                                  // the piano alone
  const phrase = bar % 16;
  const rest = bar >= 16 && phrase >= 14;                 // two bars' breath at the end of every sixteen
  const c = song.chords[bar % song.chords.length];

  // piano: the chord rolled from the bottom up, sometimes touched again later in the bar
  c.notes.forEach((m, i) => add(at(0) + i * 0.022 + loose(), 'chord', rng.range(0.55, 0.7), step * 13, m));
  if (rng.chance(0.45)) {
    const s = rng.pick([6, 10]);
    c.notes.slice(-3).forEach((m, i) => add(at(s) + i * 0.02 + loose(), 'chord', rng.range(0.32, 0.42), step * 5, m));
  }

  if (!intro && !rest) {
    add(at(0), 'bass', 0.8, step * 6, c.bass);
    if (rng.chance(0.7)) add(at(10) + loose(), 'bass', 0.6, step * 3, c.bass + rng.pick([0, 7, 12]));
    if (rng.chance(0.25)) add(at(14) + loose(), 'bass', 0.5, step * 2, c.bass);

    const kicks = phrase % 4 === 3 ? rng.pick(KICKS) : KICKS[0];
    kicks.forEach(s => add(at(s) + (s ? loose() : 0), 'kick', s ? 0.7 : 0.9, 0.3));
    // the snare sits a little behind the beat
    for (const s of [4, 12]) add(at(s) + 0.012 + loose(), 'snare', rng.range(0.6, 0.72), 0.17);
    if (rng.chance(0.2)) add(at(15) + loose(), 'snare', 0.22, 0.1);
  }
  if (!intro) {
    for (let s = 0; s < STEPS; s += 2) {
      if (rng.chance(0.08)) continue;
      const open = s === 14 && rng.chance(0.15);
      add(at(s) + loose(), 'hat', (s % 4 ? 0.3 : 0.48) + rng.range(-0.06, 0.06), open ? 0.22 : 0.04);
    }
    if (rng.chance(0.3)) add(at(rng.pick([3, 7, 11, 15])) + loose(), 'hat', 0.14, 0.03);
  }

  // melody: a few notes that move by step, in some bars and not others
  if (!intro && rng.chance(song.lead)) {
    let degree = rng.int(song.scale.length);
    let s = rng.pick([2, 4, 6, 8]);
    const count = 2 + rng.int(3);
    for (let i = 0; i < count && s < STEPS; i++) {
      const last = i === count - 1;
      add(at(s) + loose(), 'lead', rng.range(0.35, 0.5), step * (last ? 4 : 2), song.scale[degree]);
      degree = Math.max(0, Math.min(song.scale.length - 1, degree + rng.pick([-1, -1, 1, 1, 2, -2])));
      s += rng.pick([2, 2, 3, 4]);
    }
  }
  return out.sort((a, b) => a.time - b.time);
}

/* Every note whose time falls in [from, to). Asking for a stretch in pieces
   gives exactly what asking for it whole gives, which is what lets the
   scheduler work a fraction of a second ahead. */
export function eventsBetween(song, seed, from, to) {
  const bar = barSeconds(song);
  const out = [];
  for (let b = Math.max(0, Math.floor(from / bar)); b * bar < to; b++) {
    for (const e of barEvents(song, seed, b)) if (e.time >= from && e.time < to) out.push(e);
  }
  return out;
}

export const frequency = midi => 440 * 2 ** ((midi - 69) / 12);
