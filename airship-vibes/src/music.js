/*
 * The music, as data.
 *
 * Each scene has a slow loop in the lo-fi manner: four jazz chords on an
 * electric piano, a soft kick and snare with the off-beats late, a bass that
 * mostly holds the root, and now and then a few notes of melody. Nothing is
 * recorded: this module says which notes fall where, and audio.js makes the
 * sound of each.
 *
 * It is one performance, not four. A Sequence counts bars from the first
 * touch and goes on counting when the scene changes: the new scene's song
 * takes over on the next bar line, in a key next door to the old one, and
 * the tempo eases to its own over a few bars. The beat never stops, so the
 * ear hears a band changing tune and not one record being swapped for
 * another.
 *
 * A bar is a pure function of the song, the visit's seed, the bar's number
 * and the tempo, so a test can ask for bar 300. Pitches are MIDI note numbers
 * (60 is middle C); times are seconds.
 */
import { Rng } from './rng.js';

const chord = (notes, bass) => ({ notes, bass });

/* Chords are voiced without their roots, between G3 and A4: the bass has the
   root, and that register is one every speaker can play, a phone's included.

   The keys are neighbours: C, C, F and G, the order the scenes come round in,
   each a fourth or a fifth (or one whole step) from the next, so most of the
   notes of one song are also in the one it gives way to. */
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
  // warm and slow: IV - iii - ii - I in F
  sunset: {
    bpm: 66, swing: 0.19, lead: 0.45, crackle: 0.4, wind: 0.4,
    chords: [chord([57, 60, 62, 65], 46), chord([55, 60, 62, 64], 45), chord([58, 62, 65, 69], 43), chord([57, 60, 64, 67], 41)],
    scale: [72, 74, 77, 79, 81, 84],
  },
  // airy: IV - iii - ii - I in G
  clouds: {
    bpm: 84, swing: 0.15, lead: 0.55, crackle: 0.25, wind: 0.7,
    chords: [chord([59, 62, 64, 67], 48), chord([57, 62, 64, 66], 47), chord([55, 59, 60, 64], 45), chord([57, 59, 62, 66], 43)],
    scale: [74, 76, 79, 81, 83, 86],
  },
};

export const STEPS = 16;                                  // sixteenths to the bar
export const stepSeconds = bpm => 60 / bpm / 4;
export const barSeconds = bpm => stepSeconds(bpm) * STEPS;
export const TEMPO_STEP = 4;                              // the most the tempo moves from one bar to the next, beats a minute

const KICKS = [[0, 7, 10], [0, 6, 10], [0, 10], [0, 3, 10]];

/* The notes of bar number `bar`, times in seconds from the start of the bar,
   played at `bpm`. `since` is the bar the song came in on: its chords count
   from there, so a song always enters on its first chord.
   Each: { time, kind, midi, vel, dur }; kind is kick, snare, hat, chord, bass or lead. */
export function barEvents(song, seed, bar, bpm = song.bpm, since = 0) {
  const rng = new Rng(seed).fork('bar' + bar);
  const step = stepSeconds(bpm);
  // off-sixteenths are late: that is the swing
  const at = s => (s + (s % 2 ? song.swing : 0)) * step;
  const loose = () => rng.range(0, 0.008);
  const out = [];
  const add = (time, kind, vel, dur, midi = 0) => out.push({ time, kind, midi, vel, dur });

  const intro = bar < 2;                                  // the piano alone, at the very beginning
  const phrase = bar % 16;
  const rest = bar >= 16 && phrase >= 14;                 // two bars' breath at the end of every sixteen
  const c = song.chords[(((bar - since) % song.chords.length) + song.chords.length) % song.chords.length];

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

/* A performance: the bars in order from the first, each handed out once,
   whichever songs they turn out to belong to.

   take(time) returns every note before `time` that has not been taken yet,
   times in seconds from the start of the performance. Asking in small pieces
   gives exactly what asking for the whole gives, which is what lets the
   player work a fraction of a second ahead of the clock. At the head of each
   bar comes a marker, kind 'bar', saying which song the bar belongs to and
   at what tempo: the player sets its echo and its room by those.

   change() asks for another song. It takes over at the end of the bar being
   read, and from there the tempo moves toward the new song's own by at most
   TEMPO_STEP a bar. */
export class Sequence {
  constructor(id, seed) {
    this.id = id;
    this.seed = seed;
    this.bpm = SONGS[id].bpm;
    this.bar = 0;               // the number of the bar being read
    this.start = 0;             // when it begins
    this.since = 0;             // the bar this song came in on
    this.next = null;           // the song asked for, until its bar line comes
    this.read();
  }

  // when the bar being read ends, which is also when a song that has been asked for comes in
  get end() { return this.start + barSeconds(this.bpm); }

  read() {
    const notes = barEvents(SONGS[this.id], this.seed, this.bar, this.bpm, this.since);
    this.events = [{ time: this.start, kind: 'bar', id: this.id, bpm: this.bpm, bar: this.bar, midi: 0, vel: 0, dur: 0 }];
    for (const e of notes) this.events.push({ ...e, time: e.time + this.start });
    this.at = 0;
  }

  change(id, seed) {
    if (!SONGS[id]) return;
    this.next = id === this.id && seed === this.seed ? null : { id, seed };
  }

  take(time) {
    const out = [];
    for (;;) {
      while (this.at < this.events.length && this.events[this.at].time < time) out.push(this.events[this.at++]);
      if (this.end >= time) return out;
      // the bar line
      this.start = this.end;
      this.bar += 1;
      if (this.next) {
        this.id = this.next.id; this.seed = this.next.seed; this.next = null;
        this.since = this.bar;
      }
      const own = SONGS[this.id].bpm;
      this.bpm += Math.max(-TEMPO_STEP, Math.min(TEMPO_STEP, own - this.bpm));
      this.read();
    }
  }
}

export const frequency = midi => 440 * 2 ** ((midi - 69) / 12);
