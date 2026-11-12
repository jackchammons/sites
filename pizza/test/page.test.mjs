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
import { methodParts, LIFE_STAGES } from '../build/sections/method.mjs';
import { TASKS, outsideRotation } from '../build/tasks.mjs';
import { recordSection } from '../build/sections/record.mjs';
import { bracketsSection } from '../build/sections/brackets.mjs';
import { radarSection } from '../build/sections/radar.mjs';
import { buzzSection } from '../build/sections/buzz.mjs';
import { directorySection } from '../build/sections/directory.mjs';
import { candidatesSection } from '../build/sections/candidates.mjs';
import { cardHtml, fieldStats } from '../src/render.js';
import { PER_PASS, RETRY_DAYS, ROTATION } from '../src/rules.js';
import { LOCATION_REVISIT_DAYS } from '../src/locations.js';
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
  directorySection: directorySection(ctx),
  candidatesSection: candidatesSection(ctx)
});
/* One block of an expanded directory record, as the text a reader sees. */
const blockOf = (record, label) => record
  .match(new RegExp(`<div class="dd-block"><div class="dd-label">${label}</div>([\\s\\S]*?)</div>\\s*(?:<div class="dd-block">|</div></td>)`))[1]
  .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
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
  // the opening put the radar on the page, and the entry nobody has rated
  // puts the candidates there.
  check(context(), ['top-ten', 'styles', 'radar', 'directory', 'candidates', 'methodology']);

  // Every open entry rated and no candidates queue: nothing is known of that
  // is not ranked, so there is no candidates section to link.
  const settled = restaurants().filter(r => r.status === 'open' && r.factors);
  const story = { title: 'A pizza story', url: 'https://news.example/a', source: 'News', published: '2026-11-08T10:00:00Z', kind: 'mention' };
  const earlier = { weekKey: '2026-W45', week: 45, date: '2026-11-03', algorithm: ALGORITHM, ranks: { p0: 1, p1: 2 } };
  const quiet = {
    dataset: { city: 'Seattle', dataVersion: 'test', restaurants: settled, attributeRegistry: {} },
    history: { snapshots: [earlier] }, buzz: { updated: '2026-11-08T10:00:00Z', items: [story] }
  };
  check(context(quiet), ['top-ten', 'record', 'styles', 'buzz', 'directory', 'methodology']);
  assert.doesNotMatch(page(context(quiet)), /href="#(candidates|unranked|queue)"/);

  // A queue alone is enough to bring the section back.
  const pending = { key: 'new pie|1', name: 'New Pie', address: '1 Pine St, Seattle, WA 98101',
    sources: ['kc-health'], lastInspection: '2026-10-01', status: 'pending' };
  check(context({ ...quiet, candidates: [pending] }),
    ['top-ten', 'record', 'styles', 'buzz', 'directory', 'candidates', 'methodology']);
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
  const graded = id => blockOf(record(id), 'Rating');

  assert.equal(graded('p0'),
    'Craft: 8.0 · Distinctiveness: 8.5 · Critical base: 7.5 All three set by the research agent Aug 27, 2026 from rev.example , paper.example What the coverage says.');
  // Its sources, and neither who set it nor either of its dates.
  assert.equal(graded('p1'),
    'Craft: 8.0 · Distinctiveness: 8.5 · Critical base: 7.5 Sources on file for all three: rev.example , paper.example What was attached.');
  // With none on file the record says so, and still says nothing of who or when.
  assert.equal(graded('p2'), 'Craft: 8.0 · Distinctiveness: 8.5 · Critical base: 7.5 Sources for all three: not on file');
  for (const url of read) assert.ok(record('p1').includes(`href="${url}"`));

  const text = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ');
  assert.doesNotMatch(text, /editorial|founding entr|at launch|launched in|index launched|seeded/i);
  assert.match(text, /The three graded factors \(craft, distinctiveness and the critic base\) are set by a research\s+agent from published coverage/);
});

test('every directory record has the same rows in the same order, and says what is not on file', () => {
  const list = restaurants();
  // One entry with everything the record prints, one with every key present
  // and empty, and the fixture's bare entry, which lacks the keys altogether.
  Object.assign(list.find(r => r.id === 'p0'), {
    styleGroup: 'Wood-fired', signature: 'The plain pie', signatureSource: 'https://full.example/menu',
    opened: 2009, openedSource: 'https://full.example/about', priceIndex: 3,
    url: 'https://full.example/', instagram: 'https://www.instagram.com/fullpies',
    statusSource: 'https://news.example/open', attributes: { waits: true },
    locations: [{ neighborhood: 'Ballard', address: '1 Pine St, Seattle, WA 98107' }],
    locationsVerified: '2026-11-01', locationsSource: 'https://full.example/visit',
    mentions: [{ url: 'https://news.example/review', title: 'A review of Place 00', source: 'News', date: '2026-10-01', kind: 'mention' }]
  });
  list.push({ id: 'empty', name: 'Empty Pies', status: 'open', neighborhood: null, style: null, styleGroup: null,
    signature: null, opened: null, priceIndex: null, url: null, instagram: null, statusSource: null,
    attributes: {}, locations: [], locationsVerified: null, factors: {}, mentions: [] });
  const html = directorySection(context({ dataset: { city: 'Seattle', dataVersion: 'test', restaurants: list,
    attributeRegistry: { waits: { label: 'Long waits', frictionCost: 1.2 } } } }));
  const record = id => html.match(new RegExp(`<tr class="dir-detail" id="dd-${id}"[\\s\\S]*?</tr>`))[0];
  const rows = id => [...record(id).matchAll(/<div class="dd-label">([^<]+)<\/div>|<span class="dd-k">([^<]+)<\/span>/g)]
    .map(m => m[1] ? `[${m[1]}]` : m[2]);

  const shape = ['[On file]', 'Style', 'Style group', 'Known for', 'Opened', 'Price',
    '[Links]', 'Website', 'Instagram', '[Status]', 'Source', '[Locations]', '[Rating]',
    '[Score]', '[Attributes]', '[Press on file]'];
  for (const r of list) assert.deepEqual(rows(r.id), shape, r.id);

  assert.equal(blockOf(record('p0'), 'On file'),
    'Style Neapolitan Style group Wood-fired Known for The plain pie · full.example Opened 2009 · full.example Price $$$');
  assert.equal(blockOf(record('p0'), 'Links'), 'Website full.example Instagram @fullpies');
  assert.match(blockOf(record('p0'), 'Status'), /^Open · last checked Nov 10, 2026 Source news\.example$/);
  assert.match(blockOf(record('p0'), 'Locations'), /^1 Pine St, Seattle, WA 98107 \(Ballard\) verified Nov 1, 2026 against full\.example$/);
  assert.equal(blockOf(record('p0'), 'Attributes'), 'Long waits −1.2');

  // A null and a missing key read the same: the placeholder, in the dim style.
  const none = 'not on file';
  for (const id of ['empty', 'unrated']) {
    assert.equal(blockOf(record(id), 'On file').replace(/^Style Slice /, 'Style not on file '),
      `Style ${none} Style group ${none} Known for ${none} Opened ${none} Price ${none}`, id);
    assert.equal(blockOf(record(id), 'Links'), `Website ${none} Instagram ${none}`, id);
    assert.match(blockOf(record(id), 'Status'), new RegExp(`^Open(?: · last checked [^·]+)? Source ${none}$`), id);
    assert.equal(blockOf(record(id), 'Locations'), none, id);
    assert.match(blockOf(record(id), 'Rating'), /^not on file No rating pass has looked at it yet\. What happens next$/, id);
    assert.equal(blockOf(record(id), 'Score'), 'not on file No score until the entry has a rating.', id);
    assert.equal(blockOf(record(id), 'Attributes'), none, id);
    assert.equal(blockOf(record(id), 'Press on file'), none, id);
  }
  assert.match(record('empty'), /<span class="dd-dim">not on file<\/span>/);
  // A rated entry that is not open keeps its score and says why it does not rank.
  assert.match(blockOf(record('gone'), 'Score'), /^SLICE \d+\.\d .* Held out of the ranking: only open pizzerias compete\.$/);
  assert.doesNotMatch(blockOf(record('p0'), 'Score'), /Held out/);
});

/* The methodology between its heading and the end of <main>, as markup and as
 * the text a reader sees. */
const methodOf = html => html.slice(html.indexOf('<section class="section" id="methodology"'), html.indexOf('</main>'));
const textOf = markup => markup.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

test('the flow names every stage of an entry\'s life, in order, with the ways out', () => {
  const method = methodOf(page(context()));
  const flow = method.match(/<ol class="life"[\s\S]*?<\/ol>/)[0];
  const stages = [...flow.matchAll(/<li class="life-step" data-stage="([^"]+)">\s*<div class="life-box"><b>([^<]+)<\/b>/g)];
  assert.deepEqual(stages.map(m => m[2]),
    ['Permit register', 'Candidate', 'Census verdict', 'On file, unrated', 'Rating pass', 'Ranked', 'Top ten']);
  assert.deepEqual(stages.map(m => m[1]), LIFE_STAGES.map(s => s.key));

  const text = textOf(flow);
  // The census's four reasons, the rating task's retry, and closure.
  for (const reason of ['national chain', 'not pizza-forward', 'could not be verified', 'closed']) {
    assert.ok(flow.includes(`<li>${reason}</li>`), reason);
  }
  assert.ok(text.includes(`up to ${PER_PASS.census} per pass`));
  assert.ok(text.includes(`up to ${PER_PASS.rating} entries per pass`));
  assert.ok(text.includes(`No criticism found Stays unrated. Tried again after ${RETRY_DAYS.rating} days.`));
  assert.match(text, /Closed A cited closure takes it out of the ranking\./);
  assert.match(text, /Also joins here A pizzeria the discovery task finds/);
  assert.match(text, /The ten highest scores among open pizzerias\./);
  // Drawn in markup, so it follows the colour scheme and reflows.
  assert.doesNotMatch(flow, /<img|<svg/);
});

test('the methodology has one row for each task in the rotation and names the rest in a line', async () => {
  const method = methodOf(page(context()));
  const rows = [...method.matchAll(/<tr role="row" data-task="([^"]+)">([\s\S]*?)<\/tr>/g)];
  assert.deepEqual(rows.map(m => m[1]), ROTATION);
  const cellsOf = name => [...rows.find(m => m[1] === name)[2].matchAll(/<td role="cell" data-l="([^"]+)">([\s\S]*?)<\/td>/g)]
    .map(m => [m[1], m[2].trim()]);
  for (const name of ROTATION) {
    const cells = cellsOf(name);
    assert.deepEqual(cells.map(c => c[0]), ['Looks at', 'Per pass', 'May write', 'Finds nothing', 'Looks again'], name);
    for (const [label, body] of cells) {
      assert.ok(body.length > 10, `${name}: "${label}" is blank`);
      assert.doesNotMatch(body, /undefined|NaN/, `${name}: ${label}`);
    }
    // The size of a pass is the one next-task.mjs draws with.
    const perPass = cells[1][1];
    if (PER_PASS[name] != null) assert.match(perPass, new RegExp(`^Up to ${PER_PASS[name]} (entries|candidates)\\.$`), name);
    else assert.match(perPass, /^No worklist/, name);
  }
  const again = name => cellsOf(name)[4][1];
  assert.ok(again('rating').startsWith(`${RETRY_DAYS.rating} days after`));
  assert.ok(again('locations').startsWith(`${LOCATION_REVISIT_DAYS} days after`));

  const text = textOf(method);
  assert.match(text, /oldest first, and takes the first that has work to do/);
  assert.match(text, /A task with nothing on its worklist is passed over\./);
  // Everything this build knows of that the rotation never picks, by name.
  const outside = outsideRotation();
  const byHand = markup => textOf(markup.match(/<p class="method-p" id="by-hand"[^>]*>([\s\S]*?)<\/p>/)[1]).trim();
  const line = byHand(method);
  assert.match(line, /^\w+ more tasks are never picked automatically and run only when started by hand/);
  for (const name of outside) assert.ok(line.includes(`${name} (${TASKS[name].summary})`), name);
  for (const name of ROTATION) assert.ok(!line.includes(`${name} (`), `${name} is in the rotation and in the other line`);
  // The tasks a dispatch can force are the ones this page accounts for.
  const forceable = (await import('../scripts/next-task.mjs')).DISPATCH_ONLY ?? [];
  for (const name of forceable) assert.ok(outside.includes(name), `${name} can be dispatched and the methodology does not name it`);

  // The fixture's ratings carry no author, so the two tasks that work through
  // such ratings still have work. Once the agent has set every rating they
  // have none for good, and the line stops naming them.
  assert.match(line, /They catch up in bulk: social \([^)]+\), .* and rerate \([^)]+\)\.$/);
  const agentSet = restaurants().map(r => r.factors
    ? { ...r, factors: Object.fromEntries(Object.entries(r.factors).map(([k, f]) => [k, { ...f, setBy: 'agent' }])) } : r);
  const done = byHand(methodOf(page(context({ dataset: { city: 'Seattle', dataVersion: 'test', restaurants: agentSet, attributeRegistry: {} } }))));
  assert.match(done, /^Two more tasks are never picked automatically and run only when started by hand, through the same steps and the same gates\. They catch up in bulk: social \([^)]+\) and coverage \([^)]+\)\.$/);
  for (const name of ['sources', 'rerate']) assert.ok(!done.includes(`${name} (`), `${name} has nothing left to do and is still named`);
});

test('a task that joins the rotation with no row stops the build', () => {
  ROTATION.push('newtask');
  try {
    assert.throws(() => methodParts(context()), /"newtask" is in ROTATION but build\/tasks\.mjs has no row for it/);
  } finally {
    ROTATION.pop();
  }
  // A task with a worklist and no size on file is the same kind of gap.
  ROTATION.push('sources');
  try {
    assert.throws(() => methodParts(context()), /no row for it/);
  } finally {
    ROTATION.pop();
  }
  assert.doesNotThrow(() => methodParts(context()));
});

test('the methodology lists both workflows step by step and says what the agent cannot do', () => {
  const method = methodOf(page(context()));
  const steps = label => [...method.match(new RegExp(`<ol class="steps" aria-label="${label}">[\\s\\S]*?</ol>`))[0]
    .matchAll(/<li><b>([^<]+)<\/b>/g)].map(m => m[1]);
  assert.deepEqual(steps('The research run, step by step'),
    ['Pick one task', 'The agent researches', 'Each record is validated on its own',
     'Accepted records are applied', 'Lint, build, verify', 'Commit']);
  assert.deepEqual(steps('The publish, step by step'),
    ['Checks', 'Feed sweep', 'Geocode', 'Lint', 'Build every site', 'Deploy']);
  const text = textOf(method);
  assert.match(text, /Once a day, and whenever it is started by hand/);
  assert.match(text, /After each research run, once a day on its own schedule, and on every change to the code/);
  assert.match(text, /It can write exactly one file, its proposals\. It cannot run code/);
  assert.match(text, /The agent never runs code and never writes a score\./);
  assert.match(text, /A step that fails ends its run: nothing new is committed or deployed/);
  // What moves a score: the constants are the scoring module's.
  assert.ok(text.includes(`raises its version, now ${ALGORITHM}`));
  assert.match(text, /A rating the agent has set\. It is set once\./);
});

test('no clock time appears in the methodology or the candidates section', () => {
  const pending = { key: 'new pie|1', name: 'New Pie', address: '1 Pine St, Seattle, WA 98101',
    sources: ['kc-health'], lastInspection: '2026-10-01', status: 'pending' };
  const html = page(context({ candidates: [pending], candidatesChecked: '2026-11-12T05:30:31.005Z' }));
  const from = html.indexOf('<section class="section" id="candidates"');
  const text = textOf(html.slice(from, html.indexOf('</main>')));
  assert.ok(text.includes('How it works') && text.includes('Known, but not ranked'));
  // A scheduled run starts when the runner gets to it, so the page names no hour.
  assert.doesNotMatch(text, /\b\d{1,2}:\d{2}\b|\b\d{1,2}\s?(?:a\.?m\.?|p\.?m\.?)(?![a-z])|\bUTC\b|\bGMT\b|o'clock|\bmidnight\b|\bnoon\b|\bcron\b/i);
  assert.match(text, /The register was last read on Nov 11, 2026\./);
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
