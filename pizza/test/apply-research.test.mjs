import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { applyResearch } from '../scripts/apply-research.mjs';
import { checkDataset } from '../src/check-dataset.js';
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
const fresh = () => ({
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
  assert.equal(get('delancey').socialAttempted, undefined);
  assert.equal(get('good-luck-bread').socialAttempted, TODAY);
  assert.equal(get('good-luck-bread').socialNote, 'no site of its own and no outlet names a handle');
  assert.equal(get('good-luck-bread').coverageAttempted, undefined);
  // an attempt verifies nothing, so no freshness or status clock moves
  assert.equal(get('delancey').locationsVerified, '2026-08-01');
  assert.equal(get('delancey').statusChecked, undefined);
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
  assert.equal(r.statusPrev, undefined);
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
  assert.equal(r.factors, undefined);
  assert.deepEqual(checkDataset(dataset, {}, NOW), []);
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
  assert.deepEqual(checkDataset(dataset, {}, NOW), []);
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
  assert.deepEqual(done, { changes: 0, located: 0, ratedNow: 0, reratedNow: 0, buzzChanged: false, candidatesChanged: false });
  assert.equal(apply(located({})).dataset.dataVersion, '2026.11');
});

/* ---- the CLI ---- */
test('importing the module applies nothing', () => {
  const out = execFileSync(process.execPath, ['--input-type=module', '-e',
    `import fs from 'node:fs'; fs.writeFileSync = () => { throw new Error('wrote'); }; await import(${JSON.stringify(script)});`],
    { encoding: 'utf8' });
  assert.equal(out, '');
});
