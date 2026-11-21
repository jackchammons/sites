/*
 * How many pixels the picture is drawn with.
 *
 * The picture is laid out in CSS pixels, here called dots, and that is the
 * unit everything that has a size on screen is given in: a star is a dot
 * across on a phone and on a monitor. How many pixels are actually drawn per
 * dot is a separate matter, decided by what the device can draw in a
 * thirtieth of a second (pace.js); the browser scales the result to the
 * screen smoothly. More pixels make the picture sharper. They never change
 * what is in it.
 *
 * At best a dot gets two pixels each way: beyond that the eye is past
 * caring and the cost goes on rising. A large monitor is capped at about
 * a 1080p picture's worth for the same reason.
 */
export const FULL_DOT = 2;
export const FULL_PIXELS = 2.1e6;
export const LEAST_DOT = 0.6;       // softer than this is not worth the frames it buys

/* The drawing size for a canvas of cssWidth x cssHeight dots on a screen of
   `dpr` device pixels per dot, at `quality` (0..1) of the most it may have.
   `forced`, when given, is device pixels per drawn pixel, and overrides
   quality: stills and tests ask for an exact size with it. */
export function renderSize(cssWidth, cssHeight, dpr = 1, quality = 1, forced = 0) {
  const w = Math.max(1, cssWidth), h = Math.max(1, cssHeight);
  const best = Math.min(Math.min(dpr, FULL_DOT), Math.sqrt(FULL_PIXELS / (w * h)));
  const least = Math.min(LEAST_DOT, best);
  const dot = forced > 0 ? dpr / forced : Math.max(least, best * Math.sqrt(Math.min(Math.max(quality, 0), 1)));
  return { width: Math.max(1, Math.round(w * dot)), height: Math.max(1, Math.round(h * dot)), dot };
}

/* The least quality worth asking for on that canvas: the one that lands on
   LEAST_DOT. Below it renderSize returns the same size. */
export function leastQuality(cssWidth, cssHeight, dpr = 1) {
  const w = Math.max(1, cssWidth), h = Math.max(1, cssHeight);
  const best = Math.min(Math.min(dpr, FULL_DOT), Math.sqrt(FULL_PIXELS / (w * h)));
  return Math.min(1, (LEAST_DOT / best) ** 2);
}
