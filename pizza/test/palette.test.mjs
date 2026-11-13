import test from 'node:test';
import assert from 'node:assert/strict';
import { CATEGORY_COLOR, PIN_LINE, RAMP_STOPS, rankColor, rankShare, rankRamp, paletteCss } from '../src/palette.js';
import { CATEGORIES } from '../src/registry.js';

/* The directory's colours: one per category, and a ramp for the ranked one.
 * app.js colours the pins with these functions and the build writes the same
 * values into the page's stylesheet. */
const rgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
const HEX = /^#[0-9a-f]{6}$/;

test('the ramp runs from blue at the lowest rank to red at #1', () => {
  const low = rankColor(74, 74), high = rankColor(1, 74);
  assert.match(low, HEX);
  assert.match(high, HEX);
  const [lr, lg, lb] = rgb(low), [hr, hg, hb] = rgb(high);
  // Blue: its blue channel leads. Red: its red channel leads, by a long way.
  assert.ok(lb > lr && lb > lg, low);
  assert.ok(hr > 2 * hg && hr > 2 * hb, high);
  // The ends do not depend on how many are ranked.
  assert.equal(rankColor(5, 5), low);
  assert.equal(rankColor(1, 5), high);
  assert.equal(rankColor(200, 200), low);
});

/* The hue of a colour in degrees round the usual wheel: red 0, yellow 60,
 * green 120, cyan 180, blue 240. */
const hue = c => {
  const [r, g, b] = rgb(c).map(v => v / 255);
  const max = Math.max(r, g, b), d = max - Math.min(r, g, b);
  if (!d) return 0;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
};

test('the ramp passes through teal, green, yellow and orange on its way from blue to red', () => {
  const n = 74;
  const field = Array.from({ length: n }, (_, i) => rankColor(i + 1, n));   // #1 first
  for (const c of field) assert.match(c, HEX);
  // Every rank has a colour of its own.
  assert.equal(new Set(field).size, n);
  // From #1 down to the lowest rank the hue only ever climbs the wheel, from
  // red towards blue: it never doubles back, so two ranks far apart never
  // share a colour. (A degree of slack: the colours are rounded to hex.)
  // A red a hair past the top of the wheel reads as 359, not as -1.
  const hues = field.map(c => hue(c) > 340 ? hue(c) - 360 : hue(c));
  for (let i = 1; i < n; i++) {
    assert.ok(hues[i] >= hues[i - 1] - 1, `the ramp doubles back between #${i} and #${i + 1}: ${field[i - 1]} (${hues[i - 1].toFixed(0)}) to ${field[i]} (${hues[i].toFixed(0)})`);
  }
  assert.ok(hues[0] < 10 && hues[n - 1] > 205 && hues[n - 1] < 230, `ends: ${hues[0].toFixed(0)} and ${hues[n - 1].toFixed(0)}`);
  // Each of the hues the owner asked for is somewhere on it.
  const bands = { red: [0, 15], orange: [20, 40], yellow: [45, 62], green: [95, 150], teal: [160, 190], blue: [200, 230] };
  for (const [name, [from, to]] of Object.entries(bands)) {
    assert.ok(hues.some(h => h >= from - (name === 'red' ? 5 : 0) && h <= to), `no ${name} on the ramp`);
  }
  // And it never goes through purple or magenta, which the unrated and the
  // not-open-yet pins wear.
  assert.ok(hues.every(h => h < 235), 'the ramp reaches purple');
  // The stops themselves fall in hue from the lowest rank to #1.
  for (let i = 1; i < RAMP_STOPS.length; i++) assert.ok(RAMP_STOPS[i].h < RAMP_STOPS[i - 1].h);
});

test('a rank outside the field is held to the nearer end, and a field of one is #1', () => {
  assert.equal(rankShare(1, 10), 1);
  assert.equal(rankShare(10, 10), 0);
  assert.equal(rankShare(5.5, 10), 0.5);
  assert.equal(rankColor(0, 10), rankColor(1, 10));
  assert.equal(rankColor(99, 10), rankColor(10, 10));
  assert.equal(rankColor(1, 1), rankColor(1, 10));
  for (const bad of [undefined, null, NaN, 'x']) assert.match(rankColor(bad, 10), HEX);
  assert.match(rankColor(3, 0), HEX);
  assert.match(rankColor(3, undefined), HEX);
});

test('every other category has a colour of its own, and a pizzeria on file is clear of the ramp\'s hues', () => {
  const others = CATEGORIES.filter(k => k !== 'ranked');
  assert.deepEqual(Object.keys(CATEGORY_COLOR), others);
  const colors = Object.values(CATEGORY_COLOR);
  for (const c of colors) assert.match(c, HEX);
  assert.equal(new Set(colors).size, colors.length);
  // The ramp takes every hue from red round to blue. A place on file is a
  // filled pin like a ranked one, so its colour has to be off the ramp: a
  // violet or a magenta (past blue on the wheel), or a grey.
  const grey = c => Math.max(...rgb(c)) - Math.min(...rgb(c)) < 24;
  for (const key of ['unrated', 'opening', 'closed']) {
    const c = CATEGORY_COLOR[key];
    assert.ok(grey(c) || (hue(c) > 250 && hue(c) < 335), `${key} (${c}, hue ${hue(c).toFixed(0)}) sits on the ramp`);
  }
  // No two of them are near each other either.
  const far = (a, b) => Math.hypot(...rgb(a).map((v, i) => v - rgb(b)[i]));
  for (const a of ['unrated', 'opening', 'closed']) for (const b of ['unrated', 'opening', 'closed']) {
    if (a < b) assert.ok(far(CATEGORY_COLOR[a], CATEGORY_COLOR[b]) > 80, `${a} and ${b} are too close`);
  }
  assert.match(PIN_LINE, HEX);
});

test('the stylesheet\'s custom properties are written from the same values', () => {
  const css = paletteCss();
  assert.match(css, /^:root\{[^{}]+\}$/);
  for (const [key, color] of Object.entries(CATEGORY_COLOR)) assert.ok(css.includes(`--cat-${key}:${color}`), key);
  assert.ok(css.includes(`--pin-line:${PIN_LINE}`));
  // The ranked swatch is the ramp, lowest rank on the left.
  const ramp = css.match(/--rank-ramp:linear-gradient\(90deg,([^)]+)\)/)[1].split(',');
  assert.equal(ramp[0], rankColor(2, 2));
  assert.equal(ramp.at(-1), rankColor(1, 2));
  assert.deepEqual(ramp, rankRamp(ramp.length));
  assert.ok(ramp.length >= 5);
});
