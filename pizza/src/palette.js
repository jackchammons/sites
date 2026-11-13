/*
 * The directory's colours, defined once.
 *
 * A category has one colour, and it is the colour of its pins on the map, of
 * its toggle and of its header in the list. The ranked category is the
 * exception: its pins are coloured by rank, on a ramp that runs from blue for
 * the lowest rank through teal, green, yellow and orange to red for #1, and
 * its swatch is the ramp.
 *
 * app.js reads this module for the pins. The build reads it too and writes
 * the same values into the page as CSS custom properties (paletteCss below),
 * which is all the stylesheet knows of them. Nothing else names a colour for
 * a category.
 *
 * How the colours were chosen. The first ramp ran from blue through purple
 * to red; on the map that read as a smear of purples, and the owner asked
 * for more colours. This one goes the long way round the hue circle, so each
 * fifth of the ranking has a hue of its own: cold at the bottom, hot at the
 * top. A ramp of many hues does not order itself for a reader who cannot
 * tell red from green, so the rank is never the colour alone: the top ten
 * wear a heavier outline, and every ranked row prints its number beside the
 * same dot.
 *
 * The ramp takes every hue from blue round to red, so the other pizzerias on
 * file take what is left: violet for the unrated, magenta for the ones not
 * open yet, and a grey for the closed. A place that is not on file is drawn
 * differently (a hollow pin, where a place on file is a filled one), so its
 * colour only has to be told from the other hollow ones: teal, near-black,
 * brown and olive.
 *
 * Pure: no DOM, no Node APIs.
 */

/* One colour per category that is not ranked. */
export const CATEGORY_COLOR = {
  unrated: '#8a5cd6',
  opening: '#d6409f',
  closed: '#948e88',
  pending: '#006d6d',
  chain: '#2a2420',
  'not-pizza': '#8a5a2b',
  unverifiable: '#6f9a12',
  'set-aside': '#7d6f5d'
};

/* The line round every pin, heavier round the ten highest ranked. Dark, so a
 * pale fill (the ramp's yellow) still has an edge on the map's light tiles. */
export const PIN_LINE = '#23180f';

/* The ramp's stops in OKLCH (lightness, chroma, hue in degrees), lowest rank
 * first: blue, teal, green, yellow, orange, red. The hue only ever falls
 * from one stop to the next, so the colour moves one way round the circle
 * and no two ranks far apart share a hue. */
export const RAMP_STOPS = [
  { l: 0.58, c: 0.17, h: 258 },   // blue: the lowest rank
  { l: 0.68, c: 0.12, h: 200 },   // teal
  { l: 0.72, c: 0.19, h: 145 },   // green
  { l: 0.87, c: 0.17, h: 98 },    // yellow
  { l: 0.74, c: 0.17, h: 58 },    // orange
  { l: 0.56, c: 0.22, h: 28 }     // red: #1
];

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
  const at = rankShare(position, count) * (RAMP_STOPS.length - 1);
  const i = Math.min(RAMP_STOPS.length - 2, Math.floor(at));
  const a = RAMP_STOPS[i], b = RAMP_STOPS[i + 1], t = at - i;
  const mix = k => a[k] + (b[k] - a[k]) * t;
  return oklch(mix('l'), mix('c'), mix('h'));
}

/* The ramp as a list of colours, lowest rank first, for drawing it. */
export const rankRamp = (stops = 5) => Array.from({ length: stops }, (_, i) => rankColor(stops - i, stops));

/* The palette as CSS custom properties, for the page's stylesheet. */
export const paletteCss = () => `:root{${[
  ...Object.entries(CATEGORY_COLOR).map(([key, color]) => `--cat-${key}:${color}`),
  `--pin-line:${PIN_LINE}`,
  `--rank-ramp:linear-gradient(90deg,${rankRamp(11).join(',')})`
].join(';')}}`;
