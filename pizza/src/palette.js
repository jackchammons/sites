/*
 * The directory's colours, defined once.
 *
 * A category has one colour, and it is the colour of its pins on the map, of
 * its toggle and of its header in the list. The ranked category is the
 * exception: its pins are coloured by rank, on a ramp from blue for the
 * lowest rank to red for #1, and its swatch is the ramp.
 *
 * app.js reads this module for the pins. The build reads it too and writes
 * the same values into the page as CSS custom properties (paletteCss below),
 * which is all the stylesheet knows of them. Nothing else names a colour for
 * a category.
 *
 * How the colours were chosen. The ramp runs round the hue circle from blue
 * through purple and magenta to red, and gets darker as it goes, so the order
 * still reads without full colour vision. Every other category keeps clear of
 * those hues: gold, green and grey for the pizzerias on file, and teal,
 * near-black, brown and olive for the places that are not. The two groups
 * are also drawn differently (a filled pin for a place on file, a hollow one
 * for a place that is not), and within each group every pair is told apart
 * with or without red-green colour vision.
 *
 * Pure: no DOM, no Node APIs.
 */

/* One colour per category that is not ranked. */
export const CATEGORY_COLOR = {
  unrated: '#f5c400',
  opening: '#57b35c',
  closed: '#948e88',
  pending: '#006d6d',
  chain: '#2a2420',
  'not-pizza': '#8a5a2b',
  unverifiable: '#6f9a12',
  'set-aside': '#7d6f5d'
};

/* The line round every pin, and the ring round the ten highest ranked. Dark,
 * so a pale fill still has an edge on the map's light tiles. */
export const PIN_LINE = '#23180f';

/* The ramp's two ends in OKLCH (lightness, chroma, hue in degrees): blue for
 * the lowest rank, red for #1. The hue runs the short way round, upward
 * through purple and magenta, which is why the red end is written past 360. */
const LOW = { l: 0.63, c: 0.16, h: 256 };
const HIGH = { l: 0.51, c: 0.21, h: 388 };

const hex = v => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0');
/* OKLCH to an sRGB hex colour (Björn Ottosson's OKLab matrices). */
const oklch = (l, c, h) => {
  const a = c * Math.cos(h * Math.PI / 180), b = c * Math.sin(h * Math.PI / 180);
  const L = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const M = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const S = (l - 0.0894841775 * a - 1.2914855480 * b) ** 3;
  const gamma = v => v <= 0.0031308 ? 12.92 * v : 1.055 * Math.max(v, 0) ** (1 / 2.4) - 0.055;
  return '#' + [
    4.0767416621 * L - 3.3077115913 * M + 0.2309699292 * S,
    -1.2684380046 * L + 2.6097574011 * M - 0.3413193965 * S,
    -0.0041960863 * L - 0.7034186147 * M + 1.7076147010 * S
  ].map(v => hex(gamma(v))).join('');
};

/* Where a rank sits on the ramp: 0 for the lowest rank, 1 for #1. A field of
 * one is all #1. Anything that is not a rank in the field is held to the
 * nearer end. */
export function rankShare(position, count) {
  const n = Number(count), p = Number(position);
  if (!(n > 1) || !Number.isFinite(p)) return 1;
  return Math.min(1, Math.max(0, (n - p) / (n - 1)));
}

/* The colour of rank `position` in a field of `count` ranked places. */
export function rankColor(position, count) {
  const t = rankShare(position, count);
  const mix = k => LOW[k] + (HIGH[k] - LOW[k]) * t;
  return oklch(mix('l'), mix('c'), mix('h'));
}

/* The ramp as a list of colours, lowest rank first, for drawing it. */
export const rankRamp = (stops = 5) => Array.from({ length: stops }, (_, i) => rankColor(stops - i, stops));

/* The palette as CSS custom properties, for the page's stylesheet. */
export const paletteCss = () => `:root{${[
  ...Object.entries(CATEGORY_COLOR).map(([key, color]) => `--cat-${key}:${color}`),
  `--pin-line:${PIN_LINE}`,
  `--rank-ramp:linear-gradient(90deg,${rankRamp(7).join(',')})`
].join(';')}}`;
