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
