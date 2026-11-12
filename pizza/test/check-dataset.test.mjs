import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkDataset } from '../src/check-dataset.js';
import { ENTRY_SCHEMA, normalizeEntry } from '../src/schema.js';

const NOW = Date.parse('2026-08-30T00:00:00Z');
const registry = { 'sells-out': { label: 'Sells out', frictionCost: 1.5 } };

/* An entry in the schema's shape, with `over` laid on top exactly as given, so
 * a test can add a key the schema refuses or take one away. */
const base = over => ({
  city: 'Seattle', dataVersion: '2026.08',
  restaurants: [{
    ...normalizeEntry({
      id: 'good-pie', name: 'Good Pie', status: 'open', url: 'https://goodpie.com',
      factors: { craft: { value: 8, setBy: 'agent', source: 'https://x.com/review', date: '2026-08-01' },
                 distinctiveness: { value: 7, setBy: 'agent', source: 'https://x.com/review', date: '2026-08-01' },
                 critical: { value: 8, setBy: 'agent', source: 'https://x.com/review', date: '2026-08-01' } },
      opened: 2015, priceIndex: 2, attributes: { 'sells-out': true },
      locations: [{ neighborhood: 'Ballard', address: '1 Main St, Seattle, WA 98117', lat: 47.6, lon: -122.3 }],
      mentions: [], lastVerified: '2026-08-20'
    }),
    ...over
  }]
});
const without = (...keys) => {
  const ds = base();
  for (const k of keys) delete ds.restaurants[0][k];
  return ds;
};

const failsWith = (ds, snippet) => {
  const fails = checkDataset(ds, registry, NOW);
  assert.ok(fails.some(f => f.includes(snippet)),
    `expected "${snippet}", got: ${JSON.stringify(fails)}`);
};

test('a well-formed dataset passes', () => {
  assert.deepEqual(checkDataset(base(), registry, NOW), []);
});

test('the header needs a city and a data version', () => {
  failsWith({ ...base(), city: undefined }, 'dataset.city missing');
  failsWith({ ...base(), dataVersion: undefined }, 'dataset.dataVersion missing');
});

test('agent-set factors must cite a source', () => {
  failsWith(base({ factors: { craft: { value: 8, setBy: 'agent', date: '2026-08-01' } } }), 'no https source');
});

test('a rating set by anyone but the research agent is refused', () => {
  const factors = setBy => Object.fromEntries(['craft', 'distinctiveness', 'critical']
    .map(k => [k, { value: 8, setBy, source: 'https://x.com/review', date: '2026-08-26' }]));
  assert.deepEqual(checkDataset(base({ factors: factors('agent') }), registry, NOW), []);
  for (const setBy of ['editorial', 'launch', undefined]) {
    failsWith(base({ factors: factors(setBy) }), 'setBy must be agent');
  }
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

test('out-of-range and legacy values fail: criticScore, priceIndex, opened', () => {
  failsWith(base({ criticScore: 8 }), 'legacy top-level criticScore');
  failsWith(base({ criticScore: null }), 'legacy top-level criticScore');
  failsWith(base({ priceIndex: 9 }), 'priceIndex');
  failsWith(base({ opened: 1850 }), 'opened');
});

test('an entry may not carry crowd figures, whatever they hold', () => {
  const refused = 'good-pie: crowd figures are not part of the dataset';
  for (const crowd of [{ rating: 4.5, reviews: 1200 }, { reviews: 1200 }, { rating: 4.5 }, {}, null]) {
    assert.deepEqual(checkDataset(base({ crowd }), registry, NOW), [refused], JSON.stringify(crowd));
  }
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
  for (const k of ['locationsVerified', 'locationsAttempted', 'statusChecked', 'statusDetected', 'ratingAttempted', 'factsAttempted',
    'coverageAttempted', 'socialAttempted']) {
    assert.deepEqual(checkDataset(base({ [k]: '2026-08-29' }), registry, NOW), [], k);
    assert.deepEqual(checkDataset(base({ [k]: null }), registry, NOW), [], k);
    failsWith(base({ [k]: '2099-12-31' }), `${k} is not a past date`);
    failsWith(base({ [k]: 'last Tuesday' }), `${k} is not a past date`);
  }
});

test('angle brackets are refused in the text the page prints', () => {
  const tag = '<img src=x onerror=alert(1)>';
  for (const k of ['name', 'neighborhood', 'style', 'styleGroup', 'signature', 'blurb', 'statusNote', 'ratingNote', 'factsNote',
    'locationsNote', 'coverageNote', 'socialNote']) {
    failsWith(base({ [k]: `Fine ${tag}` }), `${k} contains < or >`);
  }
  failsWith(base({ locations: [{ neighborhood: 'Ballard', address: `1 Main St ${tag}, Seattle, WA 98117` }] }), 'contains < or >');
  failsWith(base({ locations: [{ neighborhood: `Ballard ${tag}`, address: '1 Main St, Seattle, WA 98117' }] }), 'contains < or >');
  failsWith(base({ factors: { craft: { value: 8, setBy: 'agent', source: 'https://x.com/review', note: `good ${tag}` } } }), 'factors.craft.note contains < or >');
  // ordinary punctuation is untouched
  assert.deepEqual(checkDataset(base({ blurb: 'Pies & slices (cash only) \u2014 "the best", they say; 50% whole-wheat.' }), registry, NOW), []);
});

/* ---- one shape for every entry ---- */
test('an entry that lacks a schema key is refused, and the message names every key it lacks', () => {
  assert.deepEqual(checkDataset(without('signature'), registry, NOW), ['good-pie: missing schema keys: signature']);
  assert.deepEqual(checkDataset(without('styleGroup', 'factsAttempted', 'mentions'), registry, NOW),
    ['good-pie: missing schema keys: styleGroup, mentions, factsAttempted']);
  // every key that has an empty value is one an entry must carry
  for (const { key, empty } of ENTRY_SCHEMA) {
    if (empty === undefined) continue;
    failsWith(without(key), `missing schema keys: ${key}`);
  }
  // an entry as the dataset held them before the schema: most keys simply absent
  const bare = { city: 'Seattle', dataVersion: '2026.08', restaurants: [{ id: 'good-pie', name: 'Good Pie', status: 'open' }] };
  const fails = checkDataset(bare, registry, NOW);
  assert.equal(fails.length, 1);
  assert.match(fails[0], /^good-pie: missing schema keys: neighborhood, .*, socialNote$/);
  bare.restaurants = bare.restaurants.map(normalizeEntry);
  assert.deepEqual(checkDataset(bare, registry, NOW), []);
});

test('an entry with a key the schema does not name is refused', () => {
  assert.deepEqual(checkDataset(base({ signatureDish: 'The Brooklyn' }), registry, NOW),
    ['good-pie: "signatureDish" is not a key of the schema']);
  failsWith(base({ notes: null }), '"notes" is not a key of the schema');
  failsWith(base({ factsLookedFor: [] }), '"factsLookedFor" is not a key of the schema');
});

test('a key the schema does not name is refused inside a location, a factor and a mention too', () => {
  const loc = { neighborhood: 'Ballard', address: '1 Main St, Seattle, WA 98117' };
  failsWith(base({ locations: [{ ...loc, phone: '206-555-0100' }] }), '"phone" is not a key of the schema');
  const factor = { value: 8, setBy: 'agent', source: 'https://x.com/review', date: '2026-08-01' };
  failsWith(base({ factors: { craft: { ...factor, confidence: 'high' }, distinctiveness: factor, critical: factor } }),
    'factors.craft.confidence is not a key of the schema');
  failsWith(base({ factors: { craft: factor, distinctiveness: factor, critical: factor, value: factor } }),
    'factors.value is not a graded factor');
  const mention = { url: 'https://x.com/a', title: 'A review', source: 'Seattle Met', date: '2026-08-01', kind: 'mention' };
  assert.deepEqual(checkDataset(base({ mentions: [mention] }), registry, NOW), []);
  failsWith(base({ mentions: [{ ...mention, author: 'A. Critic' }] }), '"author" is not a key of the schema');
  // the keys a location, a factor and a mention may carry all pass
  assert.deepEqual(checkDataset(base({ factors: { craft: { ...factor, sources: ['https://x.com/review'], note: 'good', sourcedDate: '2026-08-02' },
    distinctiveness: factor, critical: factor } }), registry, NOW), []);
});

test('an empty value is the schema\'s own: a list for a list, an object for an object', () => {
  failsWith(base({ locations: null }), 'locations must be a list');
  failsWith(base({ mentions: {} }), 'mentions must be a list');
  failsWith(base({ factsSought: null }), 'factsSought must be a list');
  failsWith(base({ attributes: null }), 'attributes must be an object');
  failsWith(base({ factors: [] }), 'factors must be an object');
  assert.deepEqual(checkDataset(base({ factors: {}, attributes: {}, locations: [], mentions: [], factsSought: [] }), registry, NOW), []);
});

test('the page a fact was read from is https, and factsSought names facts', () => {
  for (const k of ['openedSource', 'priceSource', 'styleSource', 'styleGroupSource', 'signatureSource']) {
    assert.deepEqual(checkDataset(base({ [k]: 'https://goodpie.com/about' }), registry, NOW), [], k);
    failsWith(base({ [k]: 'http://goodpie.com/about' }), `${k} must be https`);
  }
  assert.deepEqual(checkDataset(base({ factsSought: ['opened', 'signature'] }), registry, NOW), []);
  failsWith(base({ factsSought: ['opened', 'founded'] }), 'factsSought names "founded"');
});
