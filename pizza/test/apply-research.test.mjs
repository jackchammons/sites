import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { applyResearch } from '../scripts/apply-research.mjs';
import { checkDataset } from '../src/check-dataset.js';

const script = fileURLToPath(new URL('../scripts/apply-research.mjs', import.meta.url));
const TODAY = '2026-11-10';
const NOW = Date.parse('2026-11-10T12:00:00Z');
const NOTE = 'a note comfortably long enough to pass every length check';

const RATED = () => ({ craft: { value: 9, setBy: 'editorial' }, distinctiveness: { value: 8, setBy: 'editorial' },
  critical: { value: 9, setBy: 'editorial' } });
const fresh = () => ({
  city: 'Seattle', dataVersion: '2026.10', cityMeanRating: 4.3, priorWeight: 500,
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
test('ratings: an entry already rated is never overwritten; an unrated one is filled', () => {
  const proposal = id => ({ id, craft: 6, distinctiveness: 6, criticScore: 6, sources: ['https://news.example/review'], note: NOTE });
  const { get, done } = apply({ factorRatings: [proposal('delancey'), proposal('good-luck-bread')],
    ratingSkipped: [{ id: 'delancey', note: 'nothing found' }] });
  assert.equal(get('delancey').factors.craft.value, 9);
  assert.equal(get('delancey').ratingAttempted, undefined);
  assert.equal(get('good-luck-bread').factors.critical.value, 6);
  assert.equal(get('good-luck-bread').factors.craft.setBy, 'agent');
  assert.equal(done.ratedNow, 1);
});

/* ---- the side files ---- */
test('side files are changed only when something was added to them', () => {
  const buzz = { updated: '2026-11-09T00:00:00.000Z', items: [
    { title: 'A story already on file', url: 'https://news.example/known', source: 'X', published: '2026-11-01T00:00:00.000Z', kind: 'mention', mentions: [] }] };
  const registry = { 'sells-out': { label: 'Sells out' } };
  const candFile = { candidates: [{ name: 'Ghost Pizza', status: 'pending' }, { name: 'DELANCEY', status: 'pending' }] };
  const story = { title: 'A story already on file', url: 'https://news.example/known', source: 'X', published: '2026-11-01', kind: 'mention' };

  const quiet = apply({ news: [story], newAttributes: [{ key: 'sells-out', label: 'Sells out', entries: ['delancey'] }] },
    fresh(), { buzz, registry, candFile: { candidates: [] } });
  assert.deepEqual([quiet.done.buzzChanged, quiet.done.registryChanged, quiet.done.candidatesChanged], [false, false, false]);

  const busy = apply({
    news: [{ ...story, title: 'A story the sweep missed', url: 'https://news.example/new', published: '2026-11-05', mentions: ['delancey'] }],
    newAttributes: [{ key: 'cash-only', label: 'Cash only', frictionCost: 0.5, entries: ['delancey'] }],
    candidateReview: [{ name: 'ghost pizza', verdict: 'closed', note: 'gone since spring', source: 'http://x.example/a' }]
  }, fresh(), { buzz, registry, candFile });
  assert.deepEqual([busy.done.buzzChanged, busy.done.registryChanged, busy.done.candidatesChanged], [true, true, true]);
  assert.equal(buzz.items[0].title, 'A story the sweep missed');
  assert.equal(buzz.items[0].via, 'research');
  assert.deepEqual(registry['cash-only'], { label: 'Cash only', frictionCost: 0.5 });
  assert.equal(busy.get('delancey').attributes['cash-only'], true);
  assert.deepEqual(candFile.candidates.map(c => [c.name, c.status, c.resolutionSource]),
    [['Ghost Pizza', 'rejected', undefined], ['DELANCEY', 'promoted', undefined]]);
  assert.deepEqual(checkDataset(busy.dataset, registry, NOW), []);
});

test('an empty research file changes nothing, dataVersion included', () => {
  const before = JSON.stringify(fresh());
  const { dataset, done } = apply({ updated: '2026-11-10T00:00:00Z' });
  assert.equal(JSON.stringify(dataset), before);
  assert.deepEqual(done, { changes: 0, located: 0, ratedNow: 0, buzzChanged: false, registryChanged: false, candidatesChanged: false });
  assert.equal(apply(located({})).dataset.dataVersion, '2026.11');
});

/* ---- the CLI ---- */
test('importing the module applies nothing', () => {
  const out = execFileSync(process.execPath, ['--input-type=module', '-e',
    `import fs from 'node:fs'; fs.writeFileSync = () => { throw new Error('wrote'); }; await import(${JSON.stringify(script)});`],
    { encoding: 'utf8' });
  assert.equal(out, '');
});
