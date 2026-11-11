import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { deriveContext } from '../build/derive.mjs';
import { pageHtml } from '../build/page.mjs';
import { hostOf } from '../build/html.mjs';
import { methodParts } from '../build/sections/method.mjs';
import { recordSection } from '../build/sections/record.mjs';
import { bracketsSection } from '../build/sections/brackets.mjs';
import { radarSection } from '../build/sections/radar.mjs';
import { buzzSection } from '../build/sections/buzz.mjs';
import { directorySection } from '../build/sections/directory.mjs';
import { cardHtml, fieldStats } from '../src/render.js';
import {
  ALGORITHM, isoWeekKey, isoWeek, LONGEVITY_FULL_YEARS, COVERAGE_WINDOW_MONTHS, COVERAGE_FULL_MENTIONS,
  REPUTATION_WEIGHTS, DEFAULT_WEIGHTS
} from '../src/slice.js';

/* The build's sections, rendered from a small made-up field. Every entry was
 * checked on the build day, so nothing decays and the scores are exact. */
const NOW = new Date('2026-11-10T12:00:00Z');
const TODAY = '2026-11-10';
const WEEK = isoWeekKey(NOW);

const place = (id, name, grades, over = {}) => ({
  id, name, status: 'open', neighborhood: 'Ballard', style: 'Neapolitan', styleGroup: 'Neapolitan',
  statusChecked: TODAY, mentions: [], attributes: {},
  factors: { craft: { value: grades[0] }, distinctiveness: { value: grades[1] }, critical: { value: grades[2] } },
  ...over
});

/* Twelve open, rated entries with nothing on file for reputation, then the
 * special cases: a tie the published rule settles against the alphabet, a
 * reputation that counts, one that would lower the score, a closure, a rated
 * entry that is "opening", and an entry nobody has rated. */
const restaurants = () => [
  ...Array.from({ length: 12 }, (_, i) => place(`p${i}`, `Place ${String(i).padStart(2, '0')}`, [9 - i * 0.5, 9 - i * 0.5, 9 - i * 0.5])),
  place('zeta', 'Zeta Pies', [8, 8, 8]),
  place('alpha', 'Alpha Pies', [8, 8.9, 7.5]),
  place('old', 'Old Standby', [7, 7, 7], { opened: 1980 }),
  place('young', 'Young Upstart', [7.5, 7.5, 7.5], { opened: 2026, url: 'https://young.example/' }),
  place('gone', 'Gone Pies', [9.5, 9.5, 9.5], { status: 'closed', statusDate: '2026-10-01', statusSource: 'https://www.news.example/closing' }),
  place('moving', 'Moving Pies', [9.4, 9.4, 9.4], { status: 'opening' }),
  { id: 'unrated', name: 'Unrated Pies', status: 'open', neighborhood: 'Fremont', style: 'Slice', mentions: [], attributes: {} }
];

const context = (over = {}) => {
  const ctx = deriveContext({
    dataset: { city: 'Seattle', dataVersion: 'test', restaurants: restaurants(), attributeRegistry: {} },
    history: { snapshots: [] }, buzz: { updated: null, items: [] }, candidates: null, now: NOW,
    ...over
  });
  return { ...ctx, css: '', leafletCss: '' };
};
const page = ctx => pageHtml(ctx, {
  method: methodParts(ctx),
  recordSection: recordSection(ctx),
  bracketSection: bracketsSection(ctx),
  radarSection: radarSection(ctx),
  buzzSection: buzzSection(ctx),
  directorySection: directorySection(ctx)
});
const standingsOf = html => JSON.parse(html.match(/data-standings='([^']*)'/)[1].replace(/&#39;/g, "'"));
const dirRows = html => [...html.matchAll(/<tr class="dir-row[^"]*" data-id="([^"]+)">([\s\S]*?)<\/tr>/g)]
  .map(m => ({ id: m[1], rank: m[2].match(/class="dir-rank[^"]*">#(\d+)</)?.[1] ?? null }));

test('the record chart draws this build\'s standings for the current week, not the stored snapshot', () => {
  const live = context();
  const ids = live.allScored.map(r => r.id);
  // A snapshot an earlier publish stored for this week, with the top two the
  // other way round and the previous method's name.
  const stale = Object.fromEntries(ids.map((id, i) => [id, i + 1]));
  [stale[ids[0]], stale[ids[1]]] = [2, 1];
  const earlier = { weekKey: '2026-W45', week: 45, date: '2026-11-03', algorithm: 'SLICE v0', ranks: stale };
  const stored = { weekKey: WEEK, week: isoWeek(NOW), date: '2026-11-09', algorithm: 'SLICE v0', ranks: stale };
  const html = recordSection(context({ history: { snapshots: [earlier, stored] } }));

  const standings = standingsOf(html);
  assert.equal(standings.length, 2, 'the stored current week is replaced, not added to');
  assert.deepEqual(standings.at(-1).names, live.ranked.map(r => r.name));
  assert.equal(standings.at(-1).date, TODAY);
  // The column carries the algorithm, so the change is drawn the week it happens.
  assert.match(html, /class="method-change"/);
  assert.ok(html.includes(`Scoring method changed to ${ALGORITHM}`));
});

test('the record section is left out until there is an earlier week to compare with', () => {
  assert.equal(recordSection(context()), '');
  const only = { weekKey: WEEK, week: isoWeek(NOW), date: TODAY, algorithm: ALGORITHM, ranks: { p0: 1 } };
  assert.equal(recordSection(context({ history: { snapshots: [only] } })), '');
});

test('the directory lists scored open entries in published rank order, each with its rank', () => {
  const ctx = context();
  const rows = dirRows(directorySection(ctx));
  assert.equal(rows.length, ctx.dataset.restaurants.length);

  const open = ctx.allScored.filter(r => r.status === 'open');
  assert.deepEqual(rows.slice(0, open.length).map(r => r.id), open.map(r => r.id));
  assert.deepEqual(rows.slice(0, open.length).map(r => r.rank), open.map(r => String(r.rank)));

  // The tie: equal scores, settled by critical reception, against the alphabet.
  const zeta = open.find(r => r.id === 'zeta'), alpha = open.find(r => r.id === 'alpha');
  assert.equal(zeta.score, alpha.score);
  assert.equal(zeta.rank + 1, alpha.rank);
  const at = id => rows.findIndex(r => r.id === id);
  assert.equal(at('zeta') + 1, at('alpha'));

  // Unrated, opening and closed entries follow, in that order, with no rank.
  assert.deepEqual(rows.slice(open.length).map(r => r.id), ['unrated', 'moving', 'gone']);
  assert.deepEqual(rows.slice(open.length).map(r => r.rank), [null, null, null]);
});

test('the map rail is rendered hidden and the page does not load Leaflet itself', () => {
  const html = page(context());
  assert.match(html, /<div class="dir-rail" id="map-rail" hidden>/);
  assert.match(html, /<div id="map" class="dir-map" role="region" aria-label="[^"]+">/);
  // The map alone is in the wrapper that gets pinned; the legend follows it,
  // still inside the rail, so it is hidden and dropped with the map.
  const rail = html.match(/<div class="dir-rail"[\s\S]*?<\/p>\s*<\/div>/)[0];
  assert.match(rail, /<div class="dir-pin">\s*<div id="map"[^>]*><\/div>\s*<\/div>\s*<p class="note dir-map-note">/);
  assert.doesNotMatch(html, /<script[^>]+leaflet/);
  assert.match(html, /<script type="module" src="\.\/app\.js"><\/script>/);
});

test('the nav links only the sections that rendered', () => {
  const navOf = html => [...html.match(/<nav class="site-nav"[\s\S]*?<\/nav>/)[0].matchAll(/href="#([^"]+)"/g)].map(m => m[1]);
  const check = (ctx, expected) => {
    const html = page(ctx);
    assert.deepEqual(navOf(html), expected);
    for (const id of expected) assert.ok(html.includes(`id="${id}"`), `#${id} is linked but not on the page`);
  };
  // No earlier snapshot and no stories: no record, no buzz. The closure and
  // the opening put the radar on the page.
  check(context(), ['top-ten', 'styles', 'radar', 'directory', 'methodology']);

  const settled = restaurants().filter(r => r.status === 'open');
  const story = { title: 'A pizza story', url: 'https://news.example/a', source: 'News', published: '2026-11-08T10:00:00Z', kind: 'mention' };
  const earlier = { weekKey: '2026-W45', week: 45, date: '2026-11-03', algorithm: ALGORITHM, ranks: { p0: 1, p1: 2 } };
  check(context({
    dataset: { city: 'Seattle', dataVersion: 'test', restaurants: settled, attributeRegistry: {} },
    history: { snapshots: [earlier] }, buzz: { updated: '2026-11-08T10:00:00Z', items: [story] }
  }), ['top-ten', 'record', 'styles', 'buzz', 'directory', 'methodology']);
});

test('the methodology sits inside <main>, prints the constants from slice.js, and the footer links back', () => {
  const html = page(context());
  assert.ok(html.indexOf('id="methodology"') < html.indexOf('</main>'));
  assert.ok(html.includes(`log(1+${LONGEVITY_FULL_YEARS})`));
  assert.ok(html.includes(`mentions in ${COVERAGE_WINDOW_MONTHS} mo / ${COVERAGE_FULL_MENTIONS}`));
  assert.ok(html.includes(`Two components, each 0–1, weighted ${REPUTATION_WEIGHTS.longevity} : ${REPUTATION_WEIGHTS.coverage},`));
  assert.ok(html.includes(`Reputation carries its ${DEFAULT_WEIGHTS.reputation}% only when it is on file`));
  assert.ok(html.includes(`scoring module (${ALGORITHM})`));
  assert.match(html, /<a href="\.\.\/">all sites<\/a>/);
  assert.equal((html.match(/<meta name="theme-color"/g) ?? []).length, 2);
});

test('a card says which of the three reputation cases applies', () => {
  const ctx = context();
  const field = fieldStats(ctx.allScored);
  const card = id => {
    const r = ctx.allScored.find(x => x.id === id);
    return { r, html: cardHtml(r, field) };
  };

  const counted = card('old');
  assert.equal(counted.r.reputationDetail.use, 'counted');
  assert.match(counted.html, /vs field<\/span><\/td>\s*<td class="num">24% → <b>24\.0<\/b>/);
  assert.doesNotMatch(counted.html, /carries no weight/);

  const unmeasured = card('p0');
  assert.equal(unmeasured.r.reputationDetail.use, 'unmeasured');
  assert.match(unmeasured.html, /No founding year or press on file, so reputation carries no weight/);
  assert.match(unmeasured.html, />unmeasured<\/span><\/td>\s*<td class="num">0% → <b>0\.0<\/b>/);

  const lowers = card('young');
  assert.equal(lowers.r.reputationDetail.use, 'lowers');
  assert.match(lowers.html, /At 0\.0\/10 reputation is below the 7\.\d weighted mean of this entry's other four factors, so counting it would lower the score\. It is shown but carries no weight/);
  assert.match(lowers.html, />not counted<\/span><\/td>\s*<td class="num">0% → <b>0\.0<\/b>/);
  assert.match(lowers.html, /reputation is below its other factors, so it is left out/i);
  // Left out of the score, it scores exactly as its twin with nothing on file would.
  const twin = deriveContext({
    dataset: { restaurants: [place('young', 'Young Upstart', [7.5, 7.5, 7.5])], attributeRegistry: {} },
    history: { snapshots: [] }, now: NOW
  }).allScored[0];
  assert.equal(lowers.r.score, twin.score);
});

test('a citation link reads as the outlet\'s hostname', () => {
  assert.equal(hostOf('https://www.theinfatuation.com/seattle/reviews/x'), 'theinfatuation.com');
  assert.equal(hostOf('https://seattle.eater.com/2026/1/2/x'), 'seattle.eater.com');
  assert.equal(hostOf('not a url'), 'source');
  const html = radarSection(context());
  assert.match(html, /<a href="https:\/\/www\.news\.example\/closing"[^>]*>news\.example<\/a>/);
  assert.doesNotMatch(directorySection(context()), />(source|coverage|its own site)<\/a>/);
});

test('the page describes every rating one way, and a rating the agent has not set by its sources alone', () => {
  const with3 = provenance => ({
    craft: { value: 8, ...provenance }, distinctiveness: { value: 8.5, ...provenance }, critical: { value: 7.5, ...provenance }
  });
  const read = ['https://www.rev.example/review', 'https://paper.example/roundup'];
  const list = restaurants();
  const set = (id, provenance) => { list.find(r => r.id === id).factors = with3(provenance); };
  set('p0', { setBy: 'agent', date: '2026-08-27', source: read[0], sources: read, note: 'What the coverage says.' });
  set('p1', { setBy: 'editorial', date: '2026-08-26', source: read[0], sources: read, sourcedDate: '2026-11-05', note: 'What was attached.' });
  set('p2', { setBy: 'editorial', date: '2026-08-26' });
  const ctx = context({ dataset: { city: 'Seattle', dataVersion: 'test', restaurants: list, attributeRegistry: {} } });
  const html = page(ctx);
  const record = id => html.match(new RegExp(`<tr class="dir-detail" id="dd-${id}"[\\s\\S]*?</tr>`))[0];
  const graded = id => record(id).match(/<div class="dd-label">Graded factors<\/div>([\s\S]*?)<\/div>\s*<div class="dd-block">/)[1]
    .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

  assert.equal(graded('p0'),
    'Craft: 8.0 · Distinctiveness: 8.5 · Critical base: 7.5 All three set by the research agent Aug 27, 2026 from rev.example , paper.example What the coverage says.');
  // Its sources, and neither who set it nor either of its dates.
  assert.equal(graded('p1'),
    'Craft: 8.0 · Distinctiveness: 8.5 · Critical base: 7.5 Sources on file for all three: rev.example , paper.example What was attached.');
  assert.equal(graded('p2'), 'Craft: 8.0 · Distinctiveness: 8.5 · Critical base: 7.5');
  for (const url of read) assert.ok(record('p1').includes(`href="${url}"`));

  const text = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ');
  assert.doesNotMatch(text, /editorial|founding entr|at launch|launched in/i);
  assert.match(text, /The three graded factors \(craft, distinctiveness and the critic base\) are set by a research\s+agent from published coverage/);
});

test('the build refuses to clear a directory that is not a build output', () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const build = dir => spawnSync(process.execPath, [path.join(root, 'scripts/build.mjs')],
    { cwd: root, env: { ...process.env, OUT_DIR: dir, SNAPSHOT: '' }, encoding: 'utf8' });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pizza-out-'));
  try {
    // Somebody's files, and no index.html: not ours to delete.
    const foreign = path.join(tmp, 'notes');
    fs.mkdirSync(foreign);
    fs.writeFileSync(path.join(foreign, 'keep.txt'), 'keep');
    const refused = build(foreign);
    assert.equal(refused.status, 1);
    assert.match(refused.stderr, /refusing to clear/);
    assert.deepEqual(fs.readdirSync(foreign), ['keep.txt']);

    // An empty directory is fine, and so is the previous build in it.
    const out = path.join(tmp, 'out');
    fs.mkdirSync(out);
    assert.equal(build(out).status, 0);
    fs.writeFileSync(path.join(out, 'stale.txt'), 'from the previous build');
    assert.equal(build(out).status, 0);
    assert.ok(fs.existsSync(path.join(out, 'index.html')));
    assert.ok(!fs.existsSync(path.join(out, 'stale.txt')));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
