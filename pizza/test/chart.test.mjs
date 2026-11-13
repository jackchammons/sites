import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { bumpChart, seriesSlot, SERIES_HUES, SERIES_STYLES } from '../build/chart.mjs';

/* Weeks of standings from rows of ids: the nth id of a row is ranked n+1. */
const weeksOf = rows => rows.map((ids, i) => ({ weekKey: `2026-W${30 + i}`, week: 30 + i, date: `2026-08-${String(i + 1).padStart(2, '0')}`,
  algorithm: 'SLICE v2.3', ranks: Object.fromEntries(ids.map((id, n) => [id, n + 1])) }));
const names = ids => new Map(ids.map(id => [id, { name: `Pizzeria ${id.toUpperCase()}` }]));
const ALPHA = 'abcdefghijklmnopqrstuvwxyz'.split('');

const seriesOf = svg => [...svg.matchAll(/<g class="series s(\d) t(\d)">([\s\S]*?)<\/g>/g)]
  .map(m => ({ hue: Number(m[1]), style: Number(m[2]), body: m[3] }));

test('seriesSlot: eight hues, then the same eight in the next line style, and no two of the first twenty-four alike', () => {
  assert.deepEqual(seriesSlot(0), { hue: 1, style: 0 });
  assert.deepEqual(seriesSlot(7), { hue: 8, style: 0 });
  assert.deepEqual(seriesSlot(8), { hue: 1, style: 1 });
  assert.deepEqual(seriesSlot(16), { hue: 1, style: 2 });
  const seen = new Set(Array.from({ length: SERIES_HUES * SERIES_STYLES }, (_, n) => JSON.stringify(seriesSlot(n))));
  assert.equal(seen.size, SERIES_HUES * SERIES_STYLES);
  // past them it comes round again, to a slot that exists
  assert.deepEqual(seriesSlot(SERIES_HUES * SERIES_STYLES), { hue: 1, style: 0 });
});

test('every line and every dot is coloured, however many pizzerias pass through the ten', () => {
  // Twenty pizzerias over four weeks: the ten shifts by a few places each week.
  const rows = [0, 3, 6, 10].map(k => ALPHA.slice(k, k + 10));
  const ids = ALPHA.slice(0, 20);
  const svg = bumpChart(weeksOf(rows), names(ids));
  const series = seriesOf(svg);
  assert.equal(series.length, 20);
  for (const s of series) {
    assert.ok(s.hue >= 1 && s.hue <= SERIES_HUES, `hue ${s.hue}`);
    assert.ok(s.style >= 0 && s.style < SERIES_STYLES, `style ${s.style}`);
    assert.match(s.body, /<path class="line" /);
    assert.match(s.body, /class="mark"/);
  }
  // twenty series, twenty different pairs of hue and line style
  assert.equal(new Set(series.map(s => `${s.hue}/${s.style}`)).size, 20);
  // nothing is drawn in the muted ink, and no colour is written into the markup:
  // a series gets its colour from its class, so both page palettes apply
  const drawn = svg.slice(svg.indexOf('<g class="series'), svg.lastIndexOf('</g>'));
  assert.ok(!/var\(--ink-3\)/.test(drawn), 'a series is drawn in the muted ink');
  assert.ok(!/(stroke|fill)="#/.test(drawn), 'a series carries a colour as an attribute');
});

test('the styles sheet defines a colour for every hue the chart can ask for, in both palettes', () => {
  const css = fs.readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
  for (let n = 1; n <= SERIES_HUES; n++) {
    assert.equal((css.match(new RegExp(`--series-${n}: #[0-9a-f]{6}`, 'g')) ?? []).length, 2, `--series-${n} has a dark and a light step`);
    assert.match(css, new RegExp(`\\.bump \\.s${n} \\{ --c: var\\(--series-${n}\\); \\}`));
  }
  for (let t = 1; t < SERIES_STYLES; t++) assert.match(css, new RegExp(`\\.bump \\.series\\.t${t} \\.line \\{ stroke-dasharray:`));
});

test('the record is not drawn as a table, and is still there for a reader who cannot see the chart', () => {
  const svg = bumpChart(weeksOf([ALPHA.slice(0, 10), ALPHA.slice(1, 11)]), names(ALPHA.slice(0, 11)));
  assert.ok(!/same record as a table/i.test(svg));
  assert.ok(!/<details/.test(svg));
  const hidden = svg.match(/<div class="chart-data"><table aria-label="Top ten by week">([\s\S]*?)<\/table><\/div>/);
  assert.ok(hidden, 'the table sits inside the block that hides it');
  assert.equal((hidden[1].match(/<tr>/g) ?? []).length, 11);
  assert.match(hidden[1], /Pizzeria A/);
});

test('names of lines that left the ten do not overprint each other', () => {
  // x and y each hold #8 for one week and then leave: their names would land
  // on the same strip above rank 8, a column apart.
  const base = ALPHA.slice(0, 7);
  const rows = [
    [...base, 'x', 'h', 'i'],
    [...base, 'y', 'h', 'i'],
    [...base, 'j', 'h', 'i'],
    [...base, 'j', 'h', 'i']
  ];
  const long = new Map([...names([...base, 'h', 'i', 'j']), ['x', { name: 'The Long Named Pizzeria X' }], ['y', { name: 'Another Long Pizzeria Y' }]]);
  const svg = bumpChart(weeksOf(rows), long);
  const labels = [...svg.matchAll(/<text class="end-lab out-lab" x="([\d.]+)" y="([\d.]+)" text-anchor="(end|start)">([^<]+)<\/text>/g)]
    .map(m => ({ x: Number(m[1]), y: Number(m[2]), anchor: m[3], w: m[4].length * 6.1 }))
    .map(l => ({ x0: l.anchor === 'end' ? l.x - l.w : l.x, x1: l.anchor === 'end' ? l.x : l.x + l.w, y0: l.y - 10, y1: l.y + 2 }));
  assert.equal(labels.length, 2);
  const [a, b] = labels;
  assert.ok(!(a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1), `the two names overlap: ${JSON.stringify(labels)}`);
});
