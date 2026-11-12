import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { applyResearch } from '../scripts/apply-research.mjs';
import { mergeCandidates } from '../src/census.js';
import { checkDataset } from '../src/check-dataset.js';
import { factsOutstanding } from '../src/rules.js';
import { ENTRY_KEYS, normalizeDataset, normalizeEntry, serializeDataset } from '../src/schema.js';
import { validateResearch } from '../src/validate-research.js';
import { isRated, isLaunchRating } from '../src/slice.js';

const script = fileURLToPath(new URL('../scripts/apply-research.mjs', import.meta.url));
const TODAY = '2026-11-10';
const NOW = Date.parse('2026-11-10T12:00:00Z');
const NOTE = 'a note comfortably long enough to pass every length check';

/* A rating the agent read from coverage, and a launch rating as the data holds
 * one: typed in by hand, with citations a later backfill attached. */
const graded = (values, rest) => Object.fromEntries(['craft', 'distinctiveness', 'critical']
  .map((k, i) => [k, { value: values[i], ...rest }]));
const RATED = () => graded([9, 8, 9], { setBy: 'agent', source: 'https://news.example/delancey-review',
  sources: ['https://news.example/delancey-review'], note: NOTE, date: '2026-09-14' });
const LAUNCH = () => graded([9.3, 9.7, 9.4], { setBy: 'editorial', date: '2026-08-26',
  sources: ['https://news.example/old-review', 'https://news.example/old-profile'],
  source: 'https://news.example/old-review', sourcedDate: '2026-11-05', note: 'What the backfilled coverage said.' });
/* Three entries carrying only the keys something has been recorded under,
 * which is how an entry was written before the schema. */
const sparse = () => ({
  city: 'Seattle', dataVersion: '2026.10',
  restaurants: [
    { id: 'delancey', name: 'Delancey', status: 'open', neighborhood: 'Ballard', url: 'https://delancey.example',
      factors: RATED(), attributes: {}, mentions: [],
      locations: [{ neighborhood: 'Ballard', address: '1415 NW 70th St, Seattle, WA 98117', lat: 47.6793, lon: -122.3756 }],
      locationsVerified: '2026-08-01', locationsSource: 'https://delancey.example/visit' },
    { id: 'breezy-town', name: 'Breezy Town', status: 'closed', neighborhood: 'Beacon Hill', attributes: {}, mentions: [],
      statusSource: 'https://news.example/breezy', statusDate: null, statusDetected: '2026-11-05', statusChecked: '2026-11-05',
      statusNote: 'Reported closed.', locations: [] },
    { id: 'good-luck-bread', name: 'Good Luck Bread', status: 'open', neighborhood: 'Georgetown', attributes: {}, mentions: [],
      locations: [], locationsVerified: null }
  ]
});
/* The same three in the schema's shape, as the dataset is on disk: every key
 * present, the empty value where the fixture says nothing. */
const fresh = () => normalizeDataset(sparse());
const apply = (research, dataset = fresh(), extra = {}) => {
  const lines = [];
  const done = applyResearch(research, { dataset, ...extra }, TODAY, l => lines.push(l));
  return { dataset, done, lines, get: id => dataset.restaurants.find(r => r.id === id) };
};

/* ---- locations ---- */
const located = over => ({ locations: [{ id: 'delancey', source: 'https://delancey.example/visit',
  sites: [{ neighborhood: 'Ballard', address: '1415 NW 70th St, Seattle, WA 98117' }], ...over }] });

test('locations: verified is always the day of the pass, whatever the record says', () => {
  for (const verified of ['2099-12-31', '2020-01-01', 'soon', 5]) {
    const { get } = apply(located({ verified }));
    assert.equal(get('delancey').locationsVerified, TODAY);
  }
  assert.equal(apply(located({})).get('delancey').locationsVerified, TODAY);
});

test('locations: an unchanged address keeps its coordinates, a new one has none yet', () => {
  const { get, done } = apply(located({ sites: [
    { neighborhood: 'Ballard', address: '1415 NW 70th St., Seattle, WA 98117' },
    { neighborhood: 'Fremont', address: '3400 Fremont Ave N, Seattle, WA 98103' }] }));
  assert.deepEqual(get('delancey').locations, [
    { neighborhood: 'Ballard', address: '1415 NW 70th St., Seattle, WA 98117', lat: 47.6793, lon: -122.3756 },
    { neighborhood: 'Fremont', address: '3400 Fremont Ave N, Seattle, WA 98103' }]);
  assert.equal(done.located, 1);
});

test('locationsSkipped: stamps the attempt and keeps the note', () => {
  const { get, done, dataset } = apply({ locationsSkipped: [
    { id: 'good-luck-bread', note: 'no official site, only an Instagram profile' },
    { id: 'not-on-file', note: 'nothing to stamp this on' }] });
  assert.equal(get('good-luck-bread').locationsAttempted, TODAY);
  assert.equal(get('good-luck-bread').locationsNote, 'no official site, only an Instagram profile');
  assert.equal(get('good-luck-bread').locationsVerified, null);
  assert.equal(done.changes, 1);
  assert.deepEqual(checkDataset(dataset, {}, NOW), []);
});

test('coverageSkipped and socialSkipped: each stamps its own attempt and keeps the note', () => {
  const { get, done, dataset, lines } = apply({
    coverageSkipped: [{ id: 'delancey', note: 'four outlets searched by name; nothing new since the review on file' },
                      { id: 'not-on-file', note: 'nothing to stamp this on' }],
    socialSkipped: [{ id: 'good-luck-bread', note: 'no site of its own and no outlet names a handle' }] });
  assert.equal(get('delancey').coverageAttempted, TODAY);
  assert.equal(get('delancey').coverageNote, 'four outlets searched by name; nothing new since the review on file');
  assert.equal(get('delancey').socialAttempted, null);
  assert.equal(get('good-luck-bread').socialAttempted, TODAY);
  assert.equal(get('good-luck-bread').socialNote, 'no site of its own and no outlet names a handle');
  assert.equal(get('good-luck-bread').coverageAttempted, null);
  // an attempt verifies nothing, so no freshness or status clock moves
  assert.equal(get('delancey').locationsVerified, '2026-08-01');
  assert.equal(get('delancey').statusChecked, null);
  assert.equal(done.changes, 2);
  assert.equal(lines.length, 2);
  assert.deepEqual(checkDataset(dataset, {}, NOW), []);
});

/* ---- status ---- */
const status = over => ({ status: [{ id: 'breezy-town', status: 'closed', note: 'Its site says the last day was October 26.',
  source: 'https://breezytown.example/goodbye', ...over }] });

test('status: a confirmation that brings the missing date fills date, note and source', () => {
  const { get, lines, dataset } = apply(status({ date: '2026-10-26' }));
  const r = get('breezy-town');
  assert.equal(r.statusDate, '2026-10-26');
  assert.equal(r.statusNote, 'Its site says the last day was October 26.');
  assert.equal(r.statusSource, 'https://breezytown.example/goodbye');
  assert.equal(r.statusDetected, '2026-11-05');
  assert.equal(r.statusChecked, TODAY);
  assert.equal(r.statusPrev, null);
  assert.match(lines[0], /= Breezy Town: closed \(confirmed, dated 2026-10-26\)/);
  assert.deepEqual(checkDataset(dataset, {}, NOW), []);
});

test('status: a confirmation with no date changes only the check date', () => {
  const { get } = apply(status({}));
  const r = get('breezy-town');
  assert.equal(r.statusDate, null);
  assert.equal(r.statusNote, 'Reported closed.');
  assert.equal(r.statusSource, 'https://news.example/breezy');
  assert.equal(r.statusChecked, TODAY);
});

test('status: a date already on file is never replaced by a confirmation', () => {
  const dataset = fresh();
  dataset.restaurants[1].statusDate = '2026-10-20';
  const { get } = apply(status({ date: '2026-10-26' }), dataset);
  assert.equal(get('breezy-town').statusDate, '2026-10-20');
  assert.equal(get('breezy-town').statusNote, 'Reported closed.');
});

test('status: a date after the day the status was recorded is not taken', () => {
  const { get, dataset } = apply(status({ date: '2026-11-08' }));
  assert.equal(get('breezy-town').statusDate, null);
  assert.equal(get('breezy-town').statusChecked, TODAY);
  assert.deepEqual(checkDataset(dataset, {}, NOW), []);
});

test('status: a change records the old status, the event date and the day it was detected', () => {
  const { get } = apply({ status: [{ id: 'delancey', status: 'closed', note: 'Closed for good, per the Times.',
    source: 'https://news.example/delancey', date: '2026-11-01' }] });
  const r = get('delancey');
  assert.deepEqual([r.status, r.statusPrev, r.statusDate, r.statusDetected, r.statusChecked],
    ['closed', 'open', '2026-11-01', TODAY, TODAY]);
});

/* ---- directory ---- */
const found = over => ({ name: 'Nonna Rosa', status: 'open', neighborhood: 'Wallingford', note: NOTE,
  source: 'https://news.example/nonna', address: '100 N 45th St, Seattle, WA 98103', ...over });

test('directory: a new entry joins unrated, with its address unverified', () => {
  const { get, dataset } = apply({ directory: [found()] });
  const r = get('nonna-rosa');
  assert.equal(r.name, 'Nonna Rosa');
  assert.deepEqual(r.locations, [{ neighborhood: 'Wallingford', address: '100 N 45th St, Seattle, WA 98103' }]);
  assert.equal(r.locationsVerified, null);
  assert.deepEqual(r.factors, {});
  assert.equal(isRated(r), false);
  assert.deepEqual(checkDataset(dataset, {}, NOW), []);
});

test('directory: a new entry carries every schema key, in order, empty where the discovery said nothing', () => {
  const { get } = apply({ directory: [found({ url: undefined, style: undefined, address: undefined })] });
  const r = get('nonna-rosa');
  assert.deepEqual(Object.keys(r), ENTRY_KEYS);
  assert.deepEqual([r.style, r.url, r.signature, r.opened, r.instagram, r.statusDate, r.ratingAttempted], [null, null, null, null, null, null, null]);
  assert.deepEqual([r.locations, r.mentions, r.attributes, r.factors, r.factsSought], [[], [], {}, {}, []]);
  assert.deepEqual([r.statusSource, r.statusDetected, r.statusChecked, r.blurb], ['https://news.example/nonna', TODAY, TODAY, NOTE]);
});

test('directory: a record landing on an id in use is skipped, and the log says so', () => {
  const { dataset, done, lines } = apply({ directory: [found({ name: 'Delancey!' }), found({ name: 'Good-Luck Bread' })] });
  assert.equal(dataset.restaurants.length, 3);
  assert.equal(done.changes, 0);
  assert.equal(lines.length, 2);
  assert.match(lines[0], /\? Delancey!: not added, the id "delancey" is already Delancey/);
  assert.match(lines[1], /\? Good-Luck Bread: not added, the id "good-luck-bread" is already Good Luck Bread/);
});

/* ---- ratings ---- */
const proposal = (id, over = {}) => ({ id, craft: 6, distinctiveness: 6, criticScore: 6,
  sources: ['https://news.example/review'], note: NOTE, ...over });
/* A dataset whose first entry carries a launch rating, with the facts a
 * proposal may only fill the gaps of. */
const launched = (over = {}) => {
  const dataset = fresh();
  Object.assign(dataset.restaurants[0], { factors: LAUNCH(), opened: 2009, priceIndex: 3, styleGroup: 'Wood-fired',
    lastVerified: '2026-08-26', ...over });
  return dataset;
};

test('ratings: a rating the agent set is never overwritten; an unrated entry is filled', () => {
  const before = JSON.stringify(fresh().restaurants[0]);
  const { get, done, lines } = apply({ factorRatings: [proposal('delancey'), proposal('good-luck-bread')],
    ratingSkipped: [{ id: 'delancey', note: 'nothing found' }] });
  assert.equal(JSON.stringify(get('delancey')), before);
  assert.equal(get('good-luck-bread').factors.critical.value, 6);
  assert.equal(get('good-luck-bread').factors.craft.setBy, 'agent');
  assert.deepEqual([done.ratedNow, done.reratedNow, done.changes], [1, 0, 1]);
  assert.deepEqual(lines, ['  # Good Luck Bread: rated — craft 6, distinctiveness 6, critic 6 (https://news.example/review)']);
});

test('ratings: a launch rating is replaced whole, and nothing of the old object is left', () => {
  const dataset = launched();
  const research = { factorRatings: [proposal('delancey', { craft: 8.5, distinctiveness: 8, criticScore: 9,
    sources: ['https://news.example/review', 'https://news.example/roundup'],
    opened: 2011, priceIndex: 2, styleGroup: 'Neapolitan' })] };
  // through the gate first: what is applied is what the validator accepted
  const gate = validateResearch(research, dataset, NOW);
  assert.deepEqual(gate.fails, []);
  const { get, done, lines } = apply(gate.accepted, dataset);
  const r = get('delancey');

  const factor = value => ({ value, setBy: 'agent', source: 'https://news.example/review',
    sources: ['https://news.example/review', 'https://news.example/roundup'], note: NOTE, date: TODAY });
  assert.deepEqual(r.factors, { craft: factor(8.5), distinctiveness: factor(8), critical: factor(9) });
  assert.doesNotMatch(JSON.stringify(r.factors), /editorial|old-review|old-profile|sourcedDate|2026-08-26|backfilled|9\.3|9\.7|9\.4/);
  assert.equal(isLaunchRating(r), false);
  assert.equal(r.ratingAttempted, TODAY);
  assert.equal(r.lastVerified, TODAY);
  // the plain facts on file are not the proposal's to change
  assert.deepEqual([r.opened, r.priceIndex, r.styleGroup], [2009, 3, 'Wood-fired']);
  assert.deepEqual([done.reratedNow, done.ratedNow, done.changes], [1, 0, 1]);
  assert.deepEqual(lines, ['  # Delancey: re-rated — craft 9.3 -> 8.5, distinctiveness 9.7 -> 8, critic 9.4 -> 9 (https://news.example/review)']);
  assert.deepEqual(checkDataset(dataset, {}, NOW), []);

  // It is the agent's rating from here on: the gate refuses a second proposal,
  // and one that reached the apply step anyway would change nothing.
  const again = { factorRatings: [proposal('delancey', { craft: 2, distinctiveness: 2, criticScore: 2 })] };
  assert.match(validateResearch(again, dataset, NOW).fails[0], /Delancey is already rated; ratings are never overwritten/);
  const after = JSON.stringify(dataset);
  assert.equal(apply(again, dataset).done.changes, 0);
  assert.equal(JSON.stringify(dataset), after);
});

test('ratings: a re-rating fills the gaps in the plain facts, as a first rating does', () => {
  const { get } = apply({ factorRatings: [proposal('delancey', { opened: 2011, priceIndex: 2, styleGroup: ' Neapolitan ' })] },
    launched({ opened: null, priceIndex: undefined, styleGroup: undefined }));
  assert.deepEqual([get('delancey').opened, get('delancey').priceIndex, get('delancey').styleGroup], [2011, 2, 'Neapolitan']);
});

test('ratings: one hand-set factor beside two of the agent\'s is replaced with the rest', () => {
  const dataset = launched({ factors: { ...RATED(), distinctiveness: LAUNCH().distinctiveness } });
  const { get, done, lines } = apply({ factorRatings: [proposal('delancey')] }, dataset);
  assert.deepEqual(Object.values(get('delancey').factors).map(f => [f.value, f.setBy, f.date]),
    [[6, 'agent', TODAY], [6, 'agent', TODAY], [6, 'agent', TODAY]]);
  assert.equal(done.reratedNow, 1);
  assert.match(lines[0], /re-rated — craft 9 -> 6, distinctiveness 9\.7 -> 6, critic 9 -> 6/);
});

test('ratings: a launch rating the agent could not replace is kept, and the entry rests', () => {
  const dataset = launched();
  const research = { ratingSkipped: [{ id: 'delancey', note: 'both sources on file are paywalled; nothing else names it' }] };
  const gate = validateResearch(research, dataset, NOW);
  assert.deepEqual(gate.fails, []);
  const { get, done, lines } = apply(gate.accepted, dataset);
  const r = get('delancey');
  assert.deepEqual(r.factors, LAUNCH());
  assert.equal(isRated(r) && isLaunchRating(r), true);
  assert.equal(r.ratingAttempted, TODAY);
  assert.equal(r.ratingNote, 'both sources on file are paywalled; nothing else names it');
  // an attempt verifies nothing about the place
  assert.equal(r.lastVerified, '2026-08-26');
  assert.deepEqual([done.reratedNow, done.ratedNow, done.changes], [0, 0, 1]);
  assert.deepEqual(lines, ['  . Delancey: not re-rated, launch rating kept — both sources on file are paywalled; nothing else names it']);
});

test('ratings: an unrated entry reported as skipped is stamped, and logged as no coverage found', () => {
  const { get, lines } = apply({ ratingSkipped: [{ id: 'good-luck-bread', note: 'no review names it' }] });
  assert.equal(get('good-luck-bread').ratingAttempted, TODAY);
  assert.equal(get('good-luck-bread').ratingNote, 'no review names it');
  assert.deepEqual(lines, ['  . Good Luck Bread: no coverage found — no review names it']);
});

/* ---- the side files ---- */
test('side files are changed only when something was added to them', () => {
  const buzz = { updated: '2026-11-09T00:00:00.000Z', items: [
    { title: 'A story already on file', url: 'https://news.example/known', source: 'X', published: '2026-11-01T00:00:00.000Z', kind: 'mention', mentions: [] }] };
  const candFile = { candidates: [{ name: 'Ghost Pizza', status: 'pending' }, { name: 'DELANCEY', status: 'pending' }] };
  const story = { title: 'A story already on file', url: 'https://news.example/known', source: 'X', published: '2026-11-01', kind: 'mention' };

  const quiet = apply({ news: [story] }, fresh(), { buzz, candFile: { candidates: [] } });
  assert.deepEqual([quiet.done.buzzChanged, quiet.done.candidatesChanged], [false, false]);

  const busy = apply({
    news: [{ ...story, title: 'A story the sweep missed', url: 'https://news.example/new', published: '2026-11-05', mentions: ['delancey'] }],
    candidateReview: [{ name: 'ghost pizza', verdict: 'closed', note: 'gone since spring', source: 'http://x.example/a' }]
  }, fresh(), { buzz, candFile });
  assert.deepEqual([busy.done.buzzChanged, busy.done.candidatesChanged], [true, true]);
  assert.equal(buzz.items[0].title, 'A story the sweep missed');
  assert.equal(buzz.items[0].via, 'research');
  assert.deepEqual(candFile.candidates.map(c => [c.name, c.status, c.resolutionSource]),
    [['Ghost Pizza', 'rejected', undefined], ['DELANCEY', 'promoted', undefined]]);
  assert.deepEqual(checkDataset(busy.dataset, {}, NOW), []);
});

test('candidateReview: a duplicate stores the entry it duplicates as matchedId, on every branch of the name', () => {
  const candFile = { candidates: [
    { name: 'Delancey Annex', address: '1 A St, Seattle, WA 98101', status: 'pending' },
    { name: 'DELANCEY ANNEX', address: '2 B St, Seattle, WA 98102', status: 'pending' },
    { name: 'Ghost Pizza', status: 'pending' },
    { name: 'Corner Bar', status: 'pending' }
  ] };
  const research = { candidateReview: [
    { name: 'Delancey Annex', verdict: 'duplicate', duplicateOf: 'delancey', note: 'two more permits of the entry on file' },
    { name: 'Ghost Pizza', verdict: 'closed', note: 'gone since spring' },
    // The validator refuses both of these; the apply step still writes no id it cannot find.
    { name: 'Corner Bar', verdict: 'duplicate', duplicateOf: 'nowhere', note: 'names an entry that is not on file' }
  ] };
  assert.deepEqual(validateResearch({ candidateReview: research.candidateReview.slice(0, 2) }, fresh(), NOW, candFile).fails, []);
  const { done, lines } = apply(research, fresh(), { candFile });
  assert.equal(done.candidatesChanged, true);
  assert.deepEqual(candFile.candidates.map(c => [c.name, c.status, c.verdict, c.matchedId, c.resolvedDate]), [
    ['Delancey Annex', 'rejected', 'duplicate', 'delancey', TODAY],
    ['DELANCEY ANNEX', 'rejected', 'duplicate', 'delancey', TODAY],
    ['Ghost Pizza', 'rejected', 'closed', undefined, TODAY],
    ['Corner Bar', 'rejected', 'duplicate', undefined, TODAY]
  ]);
  assert.ok(lines.includes('  - candidate "Delancey Annex": duplicate of delancey (2 location(s))'));
});

test('newAttributes in a research file is not applied: no flag is set and no registry row is written', () => {
  const registry = { 'sells-out': { label: 'Sells out', frictionCost: 1.5 } };
  const before = JSON.stringify(fresh());
  const { dataset, done } = apply({ newAttributes: [
    { key: 'hard-parking', label: 'Hard parking', frictionCost: 2.5, entries: ['delancey'] }] }, fresh(), { registry });
  assert.equal(JSON.stringify(dataset), before);
  assert.deepEqual(registry, { 'sells-out': { label: 'Sells out', frictionCost: 1.5 } });
  assert.equal(done.changes, 0);
  assert.ok(!('registryChanged' in done));
});

test('an empty research file changes nothing, dataVersion included', () => {
  const before = JSON.stringify(fresh());
  const { dataset, done } = apply({ updated: '2026-11-10T00:00:00Z' });
  assert.equal(JSON.stringify(dataset), before);
  assert.deepEqual(done, { changes: 0, located: 0, ratedNow: 0, reratedNow: 0, buzzChanged: false, candidatesChanged: false, reshaped: 0 });
  assert.equal(apply(located({})).dataset.dataVersion, '2026.11');
});

/* ---- facts: the descriptive record ---- */
const MENU = 'https://goodluckbread.example/menu';
const fact = (over = {}) => ({ id: 'good-luck-bread', source: MENU, ...over });

test('facts: every fact a record carries fills its gap, with the page that states it', () => {
  const research = { facts: [fact({ opened: 2021, priceIndex: 2, style: ' Sourdough pan pizza ', styleGroup: ' Detroit pan ',
    signature: 'The pepperoni square, hot honey on request' })] };
  const gate = validateResearch(research, fresh(), NOW);
  assert.deepEqual(gate.fails, []);
  const { get, done, lines, dataset } = apply(gate.accepted);
  const r = get('good-luck-bread');
  assert.deepEqual([r.opened, r.priceIndex, r.style, r.styleGroup, r.signature],
    [2021, 2, 'Sourdough pan pizza', 'Detroit pan', 'The pepperoni square, hot honey on request']);
  assert.deepEqual([r.openedSource, r.priceSource, r.styleSource, r.styleGroupSource, r.signatureSource], [MENU, MENU, MENU, MENU, MENU]);
  assert.equal(done.changes, 1);
  assert.deepEqual(lines, ['  = Good Luck Bread: opened 2021, price $$, style "Sourdough pan pizza", style group Detroit pan, '
    + 'signature "The pepperoni square, hot honey on request" (https://goodluckbread.example/menu)']);
  assert.deepEqual(checkDataset(dataset, {}, NOW), []);
});

test('facts: a fact already on file is never replaced, and keeps the source it came with', () => {
  const dataset = fresh();
  Object.assign(dataset.restaurants[0], { opened: 2009, openedSource: 'https://delancey.example/about', styleGroup: 'Wood-fired' });
  const { get, done } = apply({ facts: [{ id: 'delancey', opened: 2011, styleGroup: 'Neapolitan', signature: 'The Brooklyn',
    source: 'https://news.example/delancey-review' }] }, dataset);
  const r = get('delancey');
  assert.deepEqual([r.opened, r.openedSource], [2009, 'https://delancey.example/about']);
  // a style group the rating task set has no source of its own, and gains none
  assert.deepEqual([r.styleGroup, r.styleGroupSource], ['Wood-fired', null]);
  assert.deepEqual([r.signature, r.signatureSource], ['The Brooklyn', 'https://news.example/delancey-review']);
  assert.equal(done.changes, 1);

  // nothing new in the record: nothing changes, and nothing is logged
  const again = apply({ facts: [{ id: 'delancey', opened: 2012, signature: 'Another pie', source: 'https://news.example/other' }] }, dataset);
  assert.deepEqual([again.done.changes, again.lines.length], [0, 0]);
  assert.equal(again.get('delancey').signature, 'The Brooklyn');
});

test('facts: two records for one entry, each fact with the page it was read on', () => {
  const research = { facts: [fact({ opened: 2021, source: 'https://goodluckbread.example/about' }),
    fact({ priceIndex: 2, signature: 'The pepperoni square' })] };
  assert.deepEqual(validateResearch(research, fresh(), NOW).fails, []);
  const r = apply(research).get('good-luck-bread');
  assert.deepEqual([r.openedSource, r.priceSource, r.signatureSource], ['https://goodluckbread.example/about', MENU, MENU]);
});

test('facts: a record on its own stamps no attempt, so a year read in passing does not rest the rest of the record', () => {
  const { get } = apply({ facts: [fact({ opened: 2021 })] });
  const r = get('good-luck-bread');
  assert.deepEqual([r.factsAttempted, r.factsSought, r.factsNote], [null, [], null]);
  assert.deepEqual(factsOutstanding(r, NOW), ['priceIndex', 'style', 'styleGroup', 'signature']);
});

test('factsSkipped: stamps the day, the note and the facts still missing once the file\'s own records are in', () => {
  const research = { facts: [fact({ opened: 2021, style: 'Sourdough pan pizza' })],
    factsSkipped: [{ id: 'good-luck-bread', note: 'menu shows no prices and no page singles out a pie' },
                   { id: 'not-on-file', note: 'nothing to stamp this on' }] };
  const gate = validateResearch(research, fresh(), NOW);
  assert.deepEqual(gate.fails, ['factsSkipped[1]: unknown restaurant id "not-on-file"']);
  const { get, done, lines, dataset } = apply(gate.accepted);
  const r = get('good-luck-bread');
  assert.equal(r.factsAttempted, TODAY);
  assert.deepEqual(r.factsSought, ['priceIndex', 'styleGroup', 'signature']);
  assert.equal(r.factsNote, 'menu shows no prices and no page singles out a pie');
  assert.deepEqual([r.opened, r.style], [2021, 'Sourdough pan pizza']);
  assert.equal(done.changes, 2);
  assert.equal(lines[1], '  . Good Luck Bread: priceIndex, styleGroup, signature not found — menu shows no prices and no page singles out a pie');
  // everything it lacks has been looked for, so it rests
  assert.deepEqual(factsOutstanding(r, NOW), []);
  assert.deepEqual(checkDataset(dataset, {}, NOW), []);
});

test('factsSkipped: an entry with nothing missing is not stamped', () => {
  const dataset = fresh();
  Object.assign(dataset.restaurants[0], { opened: 2009, priceIndex: 3, style: 'Wood-fired', styleGroup: 'Wood-fired', signature: 'The Brooklyn' });
  const { get, done, lines } = apply({ factsSkipped: [{ id: 'delancey', note: 'searched for more and found nothing' }] }, dataset);
  assert.deepEqual([get('delancey').factsAttempted, get('delancey').factsNote, done.changes], [null, null, 0]);
  assert.match(lines[0], /\? Delancey: reported as skipped, but nothing is missing from its record/);
});

/* ---- one shape for every entry ---- */
test('every entry leaves in the schema\'s shape, whatever the pass did to it', () => {
  // out of shape on the way in: the entries carry only what was recorded
  const dataset = sparse();
  assert.ok(checkDataset(dataset, {}, NOW).length > 0);
  const { done } = apply({
    status: [{ id: 'delancey', status: 'open', note: 'Open, per its own site today.', source: 'https://delancey.example' }],
    directory: [found()],
    mentions: [{ id: 'delancey', title: 'A review of Delancey', url: 'https://news.example/d', source: 'The Paper', date: '2026-11-01', kind: 'mention' }],
    factorRatings: [proposal('good-luck-bread', { opened: 2021, styleGroup: 'Detroit pan' })],
    facts: [{ id: 'delancey', signature: 'The Brooklyn', source: 'https://delancey.example/menu' }],
    factsSkipped: [{ id: 'breezy-town', note: 'closed; nothing left to read' }],
    links: [{ id: 'good-luck-bread', instagram: 'https://www.instagram.com/goodluckbread/', source: 'https://news.example/glb' }],
    locations: located({}).locations,
    locationsSkipped: [{ id: 'good-luck-bread', note: 'no official site, only an Instagram profile' }],
    coverageSkipped: [{ id: 'delancey', note: 'nothing new since the review on file' }],
    socialSkipped: [{ id: 'delancey', note: 'its site links no profile' }]
  }, dataset);
  assert.equal(dataset.restaurants.length, 4);
  for (const r of dataset.restaurants) assert.deepEqual(Object.keys(r), ENTRY_KEYS, r.id);
  assert.deepEqual(checkDataset(dataset, {}, NOW), []);
  // the three that came in out of shape; the new entry was written in it
  assert.equal(done.reshaped, 3);
  assert.equal(serializeDataset(normalizeDataset(dataset)), serializeDataset(dataset));
});

test('a dataset out of shape is put right by a pass that changes nothing, and that is not a data change', () => {
  const dataset = sparse();
  const { done } = apply({ updated: '2026-11-10T00:00:00Z' }, dataset);
  assert.deepEqual([done.changes, done.located, done.reshaped], [0, 0, 3]);
  assert.equal(dataset.dataVersion, '2026.10');
  assert.equal(serializeDataset(dataset), serializeDataset(fresh()));
  assert.deepEqual(checkDataset(dataset, {}, NOW), []);
  // in shape already: the same pass reshapes nothing
  assert.equal(apply({ updated: '2026-11-10T00:00:00Z' }, dataset).done.reshaped, 0);
});

test('a pass over a dataset in shape moves no key: only the values it set differ', () => {
  const dataset = fresh();
  const before = dataset.restaurants.map(r => ({ ...r }));
  const { done } = apply({
    status: [{ id: 'good-luck-bread', status: 'closed', note: 'Closed, per the Times.', source: 'https://news.example/glb', date: '2026-11-01' }],
    ratingSkipped: [{ id: 'good-luck-bread', note: 'no review names it' }],
    factsSkipped: [{ id: 'delancey', note: 'no page states a year' }],
    locations: located({}).locations
  }, dataset);
  assert.equal(done.reshaped, 0);
  dataset.restaurants.forEach((r, i) => assert.deepEqual(Object.keys(r), Object.keys(before[i]), r.id));
});

test('locations: a verified set clears the placeholder flag and keeps the key', () => {
  const dataset = fresh();
  Object.assign(dataset.restaurants[0], { neighborhood: 'Citywide', neighborhoodIsPlaceholder: true });
  const r = apply(located({}), dataset).get('delancey');
  assert.equal(r.neighborhoodIsPlaceholder, null);
  assert.deepEqual(Object.keys(r), ENTRY_KEYS);
});

/* ---- a candidate the register reopened ---- */
test('candidateReview: a candidate that came back is judged again, and what was found before stays on the row', () => {
  const stored = [{ key: 'ghost|1', name: 'Ghost Pizza', address: '1 A St, Seattle, WA 98101', sources: ['kc-health'],
    lastInspection: '2026-03-01', status: 'rejected', verdict: 'unverifiable', note: 'no trace beyond the permit',
    resolvedDate: '2026-08-31' }];
  const candidates = mergeCandidates(stored, [{ name: 'Ghost Pizza', address: '1 A St, Seattle, WA 98101', sources: ['kc-health'],
    lastInspection: '2026-10-20' }], fresh().restaurants);
  assert.deepEqual([candidates[0].status, candidates[0].verdict], ['pending', undefined]);
  const candFile = { candidates };
  const research = { candidateReview: [{ name: 'Ghost Pizza', verdict: 'not-pizza', note: 'now a bar that sells frozen pizza',
    source: 'https://news.example/ghost' }] };
  assert.deepEqual(validateResearch(research, fresh(), NOW, candFile).fails, []);
  apply(research, fresh(), { candFile });
  assert.deepEqual(candFile.candidates[0], { key: 'ghost|1', name: 'Ghost Pizza', address: '1 A St, Seattle, WA 98101',
    sources: ['kc-health'], lastInspection: '2026-10-20', status: 'rejected',
    previousVerdict: { verdict: 'unverifiable', note: 'no trace beyond the permit', resolvedDate: '2026-08-31' },
    verdict: 'not-pizza', note: 'now a bar that sells frozen pizza', resolutionSource: 'https://news.example/ghost', resolvedDate: TODAY });
  // the inspection that brought it back is older than the new verdict, so the next refresh leaves it
  const again = mergeCandidates(candFile.candidates, [{ name: 'Ghost Pizza', address: '1 A St, Seattle, WA 98101',
    sources: ['kc-health'], lastInspection: '2026-10-20' }], fresh().restaurants);
  assert.deepEqual([again[0].status, again[0].verdict], ['rejected', 'not-pizza']);
});

/* ---- the CLI ---- */
test('importing the module applies nothing', () => {
  const out = execFileSync(process.execPath, ['--input-type=module', '-e',
    `import fs from 'node:fs'; fs.writeFileSync = () => { throw new Error('wrote'); }; await import(${JSON.stringify(script)});`],
    { encoding: 'utf8' });
  assert.equal(out, '');
});

/* The CLI writes data, so it runs on a copy in a scratch directory and never
 * on the checkout. */
function scratch(dataset, research) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apply-research-'));
  for (const d of ['scripts', 'data']) fs.mkdirSync(path.join(dir, d));
  fs.copyFileSync(script, path.join(dir, 'scripts/apply-research.mjs'));
  fs.cpSync(fileURLToPath(new URL('../src/', import.meta.url)), path.join(dir, 'src'),
    { recursive: true, filter: src => !src.includes(`${path.sep}vendor`) });
  const file = path.join(dir, 'data/restaurants.json');
  fs.writeFileSync(file, JSON.stringify(dataset, null, 2) + '\n');
  fs.writeFileSync(path.join(dir, 'data/research.json'), JSON.stringify(research));
  return {
    read: () => fs.readFileSync(file, 'utf8'),
    mtime: () => fs.statSync(file).mtimeMs,
    run: () => execFileSync(process.execPath, [path.join(dir, 'scripts/apply-research.mjs')], { encoding: 'utf8' }),
    done: () => fs.rmSync(dir, { recursive: true, force: true })
  };
}

test('CLI: a file out of shape is rewritten in the schema\'s shape even when the research changes nothing', () => {
  const s = scratch(sparse(), { updated: '2026-11-10T00:00:00Z' });
  try {
    const out = s.run();
    assert.match(out, /applied: 0 change\(s\), 0 location set\(s\) verified\. 0 newly rated, 0 re-rated\. 3 entries put into the schema's shape\./);
    assert.equal(s.read(), serializeDataset(fresh()));
    // in shape now: the next quiet pass does not write the file at all
    const written = s.mtime();
    const again = s.run();
    assert.match(again, /applied: 0 change\(s\), 0 location set\(s\) verified\. 0 newly rated, 0 re-rated\.\n$/);
    assert.equal(s.mtime(), written);
  } finally { s.done(); }
});

test('CLI: what it writes is the lint\'s shape and the normaliser\'s bytes', () => {
  const s = scratch(sparse(), { facts: [{ id: 'good-luck-bread', opened: 2021, source: 'https://goodluckbread.example/about' }],
    factsSkipped: [{ id: 'good-luck-bread', note: 'no menu online and no coverage names a pie' }] });
  try {
    s.run();
    const written = JSON.parse(s.read());
    assert.deepEqual(checkDataset(written, {}), []);
    assert.equal(s.read(), serializeDataset(normalizeDataset(written)));
    const r = written.restaurants.find(e => e.id === 'good-luck-bread');
    assert.deepEqual([r.opened, r.factsSought], [2021, ['priceIndex', 'style', 'styleGroup', 'signature']]);
    assert.deepEqual(Object.keys(r), ENTRY_KEYS);
    assert.deepEqual(normalizeEntry(r), r);
  } finally { s.done(); }
});
