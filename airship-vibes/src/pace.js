/*
 * How sharp the picture can be and still keep time.
 *
 * The page aims at thirty frames a second and spends whatever a device has
 * left over on sharpness: `quality` is the share (0..1] of the pixels
 * layout.js would allow that are actually drawn. Nothing in a browser says
 * how long the graphics chip took over a frame, so the only evidence is how
 * far apart the frames arrive, and that is what this goes by.
 *
 * It works in two moods. Probing, the page draws on every frame the screen
 * offers and watches the gaps: frames arriving faster than thirty a second
 * mean there is time to spare, so quality goes up in proportion and it probes
 * again; frames arriving slower mean there is not, and it comes down.
 * Holding, the page draws thirty a second at the quality it found, and only
 * watches for frames running late. A hold cannot see spare time (a frame
 * that took a third of its slot looks like one that took all of it), so the
 * page asks for a fresh probe whenever the picture changes, at each new shot.
 *
 * Frames drawn during a dissolve are left out of it: they hold two pictures
 * and say nothing about what one costs.
 *
 * A screen that only offers thirty frames a second (a phone saving its
 * battery does this) hides spare time from a probe as well: its frames arrive
 * a thirtieth apart however little they cost. There the page stays at the
 * quality it started with, which is why it starts at a middling one and
 * remembers what it found last time.
 *
 * When the picture is already as soft as it is allowed to be and frames still
 * run late, `starved` counts it. The page answers that by giving up
 * antialiasing, the one other thing it can do without.
 *
 * This module is the arithmetic only. It never looks at a clock or a canvas.
 */
export const FRAME_MS = 1000 / 30;

const PROBE_FRAMES = 12;      // gaps looked at before a probe decides
const HOLD_FRAMES = 30;       // and before a hold does
const SETTLE = 3;             // frames ignored after the size changes: the first few pay for the change

const median = xs => {
  const s = [...xs].sort((a, b) => a - b), n = s.length;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
};

export class Pace {
  /* least: the lowest quality worth drawing (layout.leastQuality).
     fixed: the size was asked for outright and is not to be adjusted. */
  constructor(quality, least = 0.1, fixed = false) {
    this.least = Math.min(1, Math.max(0.01, least));
    this.quality = Math.min(1, Math.max(this.least, quality));
    this.fixed = fixed;
    this.mode = fixed ? 'hold' : 'probe';
    this.skip = SETTLE + 2;     // the first frames also compile shaders
    this.seen = [];
    this.starved = 0;           // times it needed to come down and had nowhere to go
  }

  // True while every frame the screen offers should be drawn; otherwise thirty a second.
  get probing() { return this.mode === 'probe'; }

  // Look again for spare time: called when what is being drawn has changed.
  reprobe() {
    if (this.fixed || this.mode === 'probe') return;
    this.mode = 'probe'; this.skip = 1; this.seen = [];
  }

  // The page was away (a hidden tab, a resize): what came before says nothing about now.
  pause() { this.skip = SETTLE; this.seen = []; }

  /* A frame has been drawn, `gap` milliseconds after the one before; `busy`
     if it held two pictures. Returns true if quality changed, in which case
     the caller resizes the picture before the next frame. */
  frame(gap, busy = false) {
    if (this.fixed) return false;
    if (busy) { this.seen = []; return false; }
    if (this.skip > 0) { this.skip -= 1; return false; }
    // a frame that took a quarter of a second or five seconds is, for this purpose, the same bad frame
    this.seen.push(Math.min(Math.max(gap, 0), 250));
    if (this.seen.length < (this.mode === 'probe' ? PROBE_FRAMES : HOLD_FRAMES)) return false;
    const spare = FRAME_MS / median(this.seen);      // above 1: frames are arriving faster than they are needed
    this.seen = [];

    if (this.mode === 'probe') {
      if (spare > 1.25 && this.quality < 1) {
        // Cost goes with the number of pixels, near enough. Keep a quarter of the slot in hand.
        const up = Math.min(1, this.quality * Math.min(spare * 0.75, 1.8));
        if (up >= this.quality * 1.1) return this.set(up);
      } else if (spare < 0.87) {
        const down = Math.max(this.least, this.quality * Math.max(spare * 0.9, 0.5));
        if (down <= this.quality * 0.92) return this.set(down);
        if (this.quality <= this.least) this.starved += 1;
      }
      this.mode = 'hold';
      return false;
    }
    if (spare < 0.77) {
      if (this.quality <= this.least) { this.starved += 1; return false; }
      this.mode = 'probe';
      return this.set(Math.max(this.least, this.quality * Math.max(spare * 0.9, 0.5)));
    }
    return false;
  }

  set(quality) {
    this.quality = quality;
    this.skip = SETTLE;
    this.seen = [];
    return true;
  }
}
