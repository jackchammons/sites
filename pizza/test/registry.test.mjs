import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRegistry, mapPoints, recentlyClosed, CATEGORIES, DEFAULT_OPEN, RECENT_CLOSE_DAYS } from '../src/registry.js';
import { RETRY_DAYS } from '../src/rules.js';
import { candidateIsShown } from '../src/census.js';

/* The registry is the one list of places every section of the page reads.
 * These fixtures hold one entry and one candidate for each way a place can be
 * known, plus the candidates that are not places of their own. */
const rated = { craft: { value: 8 }, distinctiveness: { value: 8 }, critical: { value: 8 } };
const entry = (id, name, over = {}) => ({ id, name, status: 'open', mentions: [], attributes: {}, locations: [], ...over });
const story = n => ({ url: `https://news.example/${n}`, title: `Story ${n}`, source: 'News', date: '2026-10-01', kind: 'mention' });

const restaurants = () => [
  entry('ranked', 'Ranked Pies', { factors: rated }),
  entry('bare', 'Bare Pies', { status: undefined, factors: rated }),
  entry('fresh', 'Fresh Pies'),
  entry('covered', 'Covered Pies', { mentions: [story(1), story(2)] }),
  entry('looked', 'Looked Pies', { ratingAttempted: '2026-10-01', ratingNote: 'Nothing published.' }),
  entry('earlier', 'Earlier Pies', { ratingAttempted: '2026-06-01' }),
  entry('soon', 'Soon Pies', { status: 'opening', ratingAttempted: '2026-10-01' }),
  entry('moving', 'Moving Pies', { status: 'opening', factors: rated }),
  entry('shut', 'Shut Pies', { status: 'closed', statusDate: '2026-10-01', statusDetected: '2026-10-20' }),
  entry('dark', 'Dark Pies', { status: 'closed', statusDetected: '2026-09-01', factors: rated })
];

const permit = (name, over = {}) => ({
  key: `${name.toLowerCase()}|100`, name, address: '100 Pine St, Seattle, WA 98101',
  sources: ['kc-health'], lastInspection: '2026-09-01', status: 'pending', ...over
});
const queue = () => [
  permit('Chain By Name', { status: 'chain' }),
  permit('Chain By Verdict', { status: 'chain', verdict: 'chain', resolvedDate: '2026-08-31' }),
  permit('Second Pending'),
  permit('First Pending'),
  permit('Branch Of Ranked', { status: 'promoted', matchedId: 'ranked', resolvedDate: '2026-08-01' }),
  permit('Second Registration', { status: 'rejected', verdict: 'duplicate', matchedId: 'ranked', resolvedDate: '2026-08-31' }),
  permit('Pasta House', { status: 'rejected', verdict: 'not-pizza', resolvedDate: '2026-08-31' }),
  permit('Ghost Kitchen', { status: 'rejected', verdict: 'unverifiable', resolvedDate: '2026-09-12' }),
  permit('Zed Slices', { status: 'rejected', verdict: 'closed', resolvedDate: '2026-09-12', lastInspection: '2025-12-01', note: 'Closed in the spring.' }),
  permit('Gone Slices', { status: 'rejected', verdict: 'closed', resolvedDate: '2026-03-01' }),
  permit('Odd One', { status: 'rejected' }),
  { key: 'bar cotto|1546', name: 'Bar Cotto', address: '1546 15th Ave, Seattle, WA 98122', neighborhood: 'Capitol Hill',
    sources: ['research'], status: 'rejected', verdict: 'not-pizza', resolvedDate: '2026-11-10', note: 'A salumeria with a pizza oven.' },
  { key: 'listed later|9', name: 'Listed Later', address: '9 Elm St, Seattle, WA 98101', sources: ['research'],
    status: 'promoted', matchedId: 'fresh', resolvedDate: '2026-11-11' }
];

const keysOf = list => list.map(p => p.key);

test('an entry is in the category its status and its rating put it in', () => {
  const { byCategory } = buildRegistry(restaurants(), null);
  // Open and rated: it competes. An entry with no status on file is open.
  assert.deepEqual(keysOf(byCategory.ranked), ['ranked', 'bare']);
  // Open, no rating. The ones no pass has looked at come first, press on file
  // first; then the ones a pass found nothing for, soonest due first.
  assert.deepEqual(keysOf(byCategory.unrated), ['covered', 'fresh', 'earlier', 'looked']);
  // Not open yet, rated or not: the rating does not make it compete.
  assert.deepEqual(keysOf(byCategory.opening), ['moving', 'soon']);
  // Closed, rated or not.
  assert.deepEqual(keysOf(byCategory.closed), ['shut', 'dark']);
  for (const k of ['pending', 'chain', 'not-pizza', 'unverifiable', 'set-aside']) assert.deepEqual(byCategory[k], [], k);

  const place = byCategory.unrated.find(p => p.key === 'looked');
  assert.equal(place.kind, 'entry');
  assert.equal(place.name, 'Looked Pies');
  assert.equal(place.category, 'unrated');
  assert.equal(place.entry.ratingNote, 'Nothing published.');
  // The day a pass looked, and the first day it may be drawn again.
  assert.equal(place.dates.looked, '2026-10-01');
  assert.equal(place.dates.eligible, new Date(Date.parse('2026-10-01') + RETRY_DAYS.rating * 864e5).toISOString().slice(0, 10));
  assert.equal(byCategory.unrated.find(p => p.key === 'fresh').dates.looked, null);
  // An attempt on a place that has not opened is not what keeps it unrated.
  assert.equal(byCategory.opening.find(p => p.key === 'soon').dates.looked, null);
});

test('a candidate is in the category its standing puts it in, and one tied to an entry is not a place', () => {
  const reg = buildRegistry(restaurants(), queue());
  const names = k => reg.byCategory[k].filter(p => p.kind === 'candidate').map(p => p.name);
  // The order the census task takes them in, which is the queue's.
  assert.deepEqual(names('pending'), ['Second Pending', 'First Pending']);
  assert.deepEqual(names('chain'), ['Chain By Name', 'Chain By Verdict']);
  // A place a research pass filed sits with the permits set aside for the same reason.
  assert.deepEqual(names('not-pizza'), ['Bar Cotto', 'Pasta House']);
  assert.deepEqual(names('unverifiable'), ['Ghost Kitchen']);
  assert.deepEqual(names('closed'), ['Gone Slices', 'Zed Slices']);
  // Set aside with no verdict on record: still listed, so nothing is dropped.
  assert.deepEqual(names('set-aside'), ['Odd One']);

  // Promoted and duplicate candidates are the entry they are tied to. They are
  // counted, and the ones that came from a register are counted apart: a
  // research-filed place that was later listed is no "further permit".
  const all = reg.places.map(p => p.name);
  for (const name of ['Branch Of Ranked', 'Second Registration', 'Listed Later']) assert.ok(!all.includes(name), name);
  assert.equal(reg.tied, 3);
  assert.equal(reg.tiedPermits, 2);
  assert.equal(reg.queued, queue().length);
  // The rule for "tied" is the census module's, not a second one here.
  assert.equal(reg.places.filter(p => p.kind === 'candidate').length, queue().filter(candidateIsShown).length);

  const cotto = reg.byCategory['not-pizza'][0];
  assert.equal(cotto.key, 'bar cotto|1546');
  assert.equal(cotto.kind, 'candidate');
  assert.equal(cotto.candidate.note, 'A salumeria with a pizza oven.');
  assert.equal(cotto.at.origin, 'research');
  assert.equal(cotto.at.reopens, false);
  assert.equal(cotto.dates.inspected, null);
  assert.equal(cotto.dates.resolved, '2026-11-10');
  assert.deepEqual(cotto.locations, [{ address: '1546 15th Ave, Seattle, WA 98122', neighborhood: 'Capitol Hill', lat: null, lon: null }]);
  const pasta = reg.byCategory['not-pizza'][1];
  assert.equal(pasta.at.origin, 'permit');
  assert.equal(pasta.dates.inspected, '2026-09-01');
  assert.equal(reg.byCategory.pending[1].at.queuePosition, 2);
});

test('closed is one list: the entries on file, then the places known only from the queue', () => {
  const reg = buildRegistry(restaurants(), queue());
  assert.deepEqual(reg.byCategory.closed.map(p => [p.kind, p.name]),
    [['entry', 'Shut Pies'], ['entry', 'Dark Pies'], ['candidate', 'Gone Slices'], ['candidate', 'Zed Slices']]);
  assert.equal(reg.counts.closed, 4);

  const [shut, dark, , zed] = reg.byCategory.closed;
  // The day it closed is the one the source stated. The day a pass recorded
  // the closure is a report, and for a candidate it is all there is.
  assert.deepEqual([shut.dates.closed, shut.dates.reported], ['2026-10-01', '2026-10-20']);
  assert.deepEqual([dark.dates.closed, dark.dates.reported], [null, '2026-09-01']);
  assert.deepEqual([zed.dates.closed, zed.dates.reported], [null, '2026-09-12']);
});

test('every place is in exactly one category, under a key and an anchor of its own', () => {
  const reg = buildRegistry(restaurants(), queue());
  assert.deepEqual(Object.keys(reg.byCategory), CATEGORIES);
  assert.deepEqual(DEFAULT_OPEN, ['ranked']);

  const seen = new Map();
  for (const k of CATEGORIES) {
    assert.equal(reg.counts[k], reg.byCategory[k].length, k);
    for (const p of reg.byCategory[k]) {
      assert.equal(p.category, k);
      assert.ok(!seen.has(p.key), `${p.key} is in ${seen.get(p.key)} and ${k}`);
      seen.set(p.key, k);
    }
  }
  // The list is every entry and every candidate that is not tied to one.
  assert.equal(reg.places.length, restaurants().length + queue().length - reg.tied);
  assert.equal(seen.size, reg.places.length);
  assert.deepEqual(reg.places.map(p => p.key), CATEGORIES.flatMap(k => keysOf(reg.byCategory[k])));

  // An anchor goes in a URL fragment and an element id.
  const anchors = reg.places.map(p => p.anchor);
  assert.equal(new Set(anchors).size, anchors.length);
  for (const a of anchors) assert.match(a, /^[rc]-[a-z0-9-]+$/);
  assert.equal(reg.places.find(p => p.key === 'ranked').anchor, 'r-ranked');
  assert.equal(reg.places.find(p => p.key === 'bar cotto|1546').anchor, 'c-bar-cotto-1546');

  // The entries are the dataset's own objects: the scoring path starts from them.
  const list = restaurants();
  const again = buildRegistry(list, queue());
  assert.equal(again.entries, list);
  assert.equal(again.byCategory.ranked[0].entry, list[0]);
});

test('a candidate without a key gets one, and two that collide are told apart', () => {
  const reg = buildRegistry([entry('same', 'Same')], [
    { name: 'No Key Pizza', address: '12 Oak St, Seattle, WA 98101', status: 'pending' },
    { name: 'No Key Pizza', address: '12 Oak St, Seattle, WA 98101', status: 'chain' },
    { key: 'same', name: 'Same', status: 'pending' },
    { name: '!!!', status: 'pending' }
  ]);
  const keys = reg.places.map(p => p.key);
  assert.equal(new Set(keys).size, 5);
  const anchors = reg.places.map(p => p.anchor);
  assert.equal(new Set(anchors).size, 5);
  for (const a of anchors) assert.match(a, /^[rc]-[a-z0-9-]+$/);
});

test('with no queue the list is the entries, and with nothing it is empty', () => {
  for (const none of [null, undefined, 'not a list']) {
    const reg = buildRegistry(restaurants(), none);
    assert.equal(reg.places.length, restaurants().length);
    assert.equal(reg.tied, 0);
    assert.equal(reg.queued, 0);
  }
  const empty = buildRegistry(undefined, undefined);
  assert.deepEqual(empty.places, []);
  assert.deepEqual(Object.values(empty.counts), CATEGORIES.map(() => 0));
});

test('recently closed is the closed category cut to six months, entries and candidates alike', () => {
  const reg = buildRegistry(restaurants(), queue());
  const now = new Date('2026-11-10T12:00:00Z');
  // By the date the source stated, else by the day it was found closed.
  // Newest first. Gone Slices was found closed too long ago.
  assert.deepEqual(recentlyClosed(reg, now).map(p => p.name), ['Shut Pies', 'Zed Slices', 'Dark Pies']);
  assert.ok(recentlyClosed(reg, now).every(p => p.category === 'closed'));
  assert.equal(RECENT_CLOSE_DAYS, 183);
  // A stated date outside the window is not made recent by a late report.
  const late = buildRegistry([entry('old', 'Old Pies', { status: 'closed', statusDate: '2024-03-01', statusDetected: '2026-11-01' }),
    entry('undated', 'Undated Pies', { status: 'closed' })], null);
  assert.deepEqual(recentlyClosed(late, now), []);
});

test('a place is plotted at its Seattle addresses that have coordinates', () => {
  const at = (address, lat, lon) => ({ neighborhood: 'Ballard', address, lat, lon });
  const reg = buildRegistry([
    entry('two', 'Two Shops', { factors: rated, locations: [
      at('1 Pine St, Seattle, WA 98101', 47.61, -122.33),
      at('2 Main St, Bellevue, WA 98004', 47.61, -122.2),
      at('3 Oak St, Seattle, WA 98103', null, null),
      at('4 Far St, Seattle, WA 98104', 40.7, -74.0)
    ] }),
    entry('none', 'No Address')
  ], [
    permit('Mapped Permit', { lat: 47.6, lon: -122.3 }),
    permit('Unmapped Permit'),
    permit('Lead With No Address', { address: undefined, lat: 47.62, lon: -122.31 })
  ]);
  const points = name => mapPoints(reg.places.find(p => p.name === name)).map(l => l.address);
  // A suburban branch is listed and not plotted; a point outside the region is a bad geocode.
  assert.deepEqual(points('Two Shops'), ['1 Pine St, Seattle, WA 98101']);
  assert.deepEqual(points('No Address'), []);
  assert.deepEqual(points('Mapped Permit'), ['100 Pine St, Seattle, WA 98101']);
  assert.deepEqual(points('Unmapped Permit'), []);
  assert.deepEqual(points('Lead With No Address'), [null]);
  assert.deepEqual(mapPoints(null), []);
});
