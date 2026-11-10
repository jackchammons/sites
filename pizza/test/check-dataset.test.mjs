import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkDataset } from '../src/check-dataset.js';

const NOW = Date.parse('2026-08-30T00:00:00Z');
const registry = { 'sells-out': { label: 'Sells out', frictionCost: 1.5 } };

const base = over => ({
  city: 'Seattle', dataVersion: '2026.08', cityMeanRating: 4.3, priorWeight: 500,
  restaurants: [{
    id: 'good-pie', name: 'Good Pie', status: 'open', url: 'https://goodpie.com',
    factors: { craft: { value: 8, setBy: 'editorial', date: '2026-08-01' },
               distinctiveness: { value: 7, setBy: 'agent', source: 'https://x.com/review', date: '2026-08-01' },
               critical: { value: 8, setBy: 'editorial', date: '2026-08-01' } },
    opened: 2015, priceIndex: 2, attributes: { 'sells-out': true },
    locations: [{ neighborhood: 'Ballard', address: '1 Main St, Seattle, WA 98117', lat: 47.6, lon: -122.3 }],
    mentions: [], lastVerified: '2026-08-20',
    ...over
  }]
});

const failsWith = (ds, snippet) => {
  const fails = checkDataset(ds, registry, NOW);
  assert.ok(fails.some(f => f.includes(snippet)),
    `expected "${snippet}", got: ${JSON.stringify(fails)}`);
};

test('a well-formed dataset passes', () => {
  assert.deepEqual(checkDataset(base(), registry, NOW), []);
});

test('agent-set factors must cite a source', () => {
  failsWith(base({ factors: { craft: { value: 8, setBy: 'agent', date: '2026-08-01' },
    distinctiveness: { value: 7, setBy: 'editorial', date: '2026-08-01' } } }), 'no https source');
});

test('closed entries need a citation and a date', () => {
  failsWith(base({ status: 'closed' }), 'https statusSource');
  failsWith(base({ status: 'closed', statusSource: 'https://x.com', statusDate: '2033-01-01' }), 'statusDate');
});

test('unknown attribute flags fail against the registry', () => {
  failsWith(base({ attributes: { 'made-up-flag': true } }), 'not in the registry');
});

test('coordinates outside Puget Sound fail', () => {
  failsWith(base({ locations: [{ neighborhood: 'X', address: '1 Main St, Seattle, WA 98117', lat: 40.7, lon: -74 }] }), 'lat');
});

test('out-of-range and legacy values fail: criticScore, priceIndex, crowd, opened', () => {
  failsWith(base({ criticScore: 8 }), 'legacy top-level criticScore');
  failsWith(base({ priceIndex: 9 }), 'priceIndex');
  failsWith(base({ crowd: { rating: 6, reviews: 10 } }), 'crowd.rating');
  failsWith(base({ opened: 1850 }), 'opened');
});

test('duplicate ids and non-https urls fail', () => {
  const ds = base();
  ds.restaurants.push({ ...ds.restaurants[0] });
  failsWith(ds, 'duplicate id');
  failsWith(base({ url: 'http://goodpie.com' }), 'url must be https');
});

test('instagram, when present, must be an https instagram.com profile URL', () => {
  failsWith(base({ instagram: 'https://facebook.com/zeeks' }), 'instagram must be');
  failsWith(base({ instagram: 'http://instagram.com/zeeks' }), 'instagram must be');
  assert.deepEqual(checkDataset(base({ instagram: 'https://www.instagram.com/zeeks.pizza' }), registry, NOW), []);
});

test('coordinates anywhere the ZIP rule reaches pass: one box for validator, geocoder and lint', () => {
  // Bellingham (982xx) and Olympia (985xx) carry accepted ZIPs, so their
  // coordinates must lint clean once geocoded.
  const ok = (address, lat, lon) => assert.deepEqual(
    checkDataset(base({ locations: [{ neighborhood: 'X', address, lat, lon }] }), registry, NOW), []);
  ok('1200 Harris Ave, Bellingham, WA 98225', 48.7203, -122.5036);
  ok('111 Market St NE, Olympia, WA 98501', 47.0449, -122.9017);
  ok('120 W Railroad Ave, Skykomish, WA 98288', 47.7093, -121.3601);
  failsWith(base({ locations: [{ neighborhood: 'X', address: '1 Main St, Seattle, WA 98117', lat: 47.66, lon: -117.43 }] }), 'lon');
  failsWith(base({ locations: [{ neighborhood: 'X', address: '1 Main St, Seattle, WA 98117', lat: 45.52, lon: -122.68 }] }), 'lat');
});

test('the clocks the apply step stamps must be real dates, not in the future', () => {
  for (const k of ['locationsVerified', 'locationsAttempted', 'statusChecked', 'statusDetected', 'ratingAttempted', 'factsAttempted']) {
    assert.deepEqual(checkDataset(base({ [k]: '2026-08-29' }), registry, NOW), [], k);
    assert.deepEqual(checkDataset(base({ [k]: null }), registry, NOW), [], k);
    failsWith(base({ [k]: '2099-12-31' }), `${k} is not a past date`);
    failsWith(base({ [k]: 'last Tuesday' }), `${k} is not a past date`);
  }
});

test('angle brackets are refused in the text the page prints', () => {
  const tag = '<img src=x onerror=alert(1)>';
  for (const k of ['name', 'neighborhood', 'style', 'styleGroup', 'blurb', 'statusNote', 'ratingNote', 'factsNote', 'locationsNote']) {
    failsWith(base({ [k]: `Fine ${tag}` }), `${k} contains < or >`);
  }
  failsWith(base({ locations: [{ neighborhood: 'Ballard', address: `1 Main St ${tag}, Seattle, WA 98117` }] }), 'contains < or >');
  failsWith(base({ locations: [{ neighborhood: `Ballard ${tag}`, address: '1 Main St, Seattle, WA 98117' }] }), 'contains < or >');
  failsWith(base({ factors: { craft: { value: 8, setBy: 'editorial', note: `good ${tag}` } } }), 'factors.craft.note contains < or >');
  // ordinary punctuation is untouched
  assert.deepEqual(checkDataset(base({ blurb: 'Pies & slices (cash only) \u2014 "the best", they say; 50% whole-wheat.' }), registry, NOW), []);
});
