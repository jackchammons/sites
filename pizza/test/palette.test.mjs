import test from 'node:test';
import assert from 'node:assert/strict';
import { CATEGORY_COLOR, PIN_LINE, rankColor, rankShare, rankRamp, paletteCss } from '../src/palette.js';
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

test('the colour moves one way along the ramp, and the middle is neither end', () => {
  const n = 74;
  const field = Array.from({ length: n }, (_, i) => rankColor(i + 1, n));   // #1 first
  for (const c of field) assert.match(c, HEX);
  // From #1 down to the lowest rank the colour only ever cools: red's lead
  // over blue shrinks at every step, until blue leads by as much.
  const warmth = c => rgb(c)[0] - rgb(c)[2];
  for (let i = 1; i < n; i++) {
    assert.ok(warmth(field[i]) < warmth(field[i - 1]), `the ramp does not cool between #${i} and #${i + 1}: ${field[i - 1]} to ${field[i]}`);
  }
  assert.ok(warmth(field[0]) > 150 && warmth(field[n - 1]) < -150);
  // Every rank has a colour of its own.
  assert.equal(new Set(field).size, n);
  // The middle of the field is purple: well away from both ends.
  const mid = rgb(rankColor(37, 73));
  const far = (a, b) => Math.hypot(...a.map((v, i) => v - b[i]));
  assert.ok(far(mid, rgb(field[0])) > 60, 'the middle is too close to the red end');
  assert.ok(far(mid, rgb(field[n - 1])) > 60, 'the middle is too close to the blue end');
  assert.ok(mid[0] > 100 && mid[2] > 100, `the middle should be a purple: ${rankColor(37, 73)}`);
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

test('every other category has a colour of its own, clear of the ramp\'s hues', () => {
  const others = CATEGORIES.filter(k => k !== 'ranked');
  assert.deepEqual(Object.keys(CATEGORY_COLOR), others);
  const colors = Object.values(CATEGORY_COLOR);
  for (const c of colors) assert.match(c, HEX);
  assert.equal(new Set(colors).size, colors.length);
  // No blue, no purple or magenta and no red: in each of those the blue or
  // the red channel leads the green one clearly.
  for (const [key, c] of Object.entries(CATEGORY_COLOR)) {
    const [r, g, b] = rgb(c);
    assert.ok(!(b > g + 24), `${key} (${c}) leans blue or purple`);
    assert.ok(!(r > g + 60 && r > b + 60), `${key} (${c}) leans red`);
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
