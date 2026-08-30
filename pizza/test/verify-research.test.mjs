import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateResearch } from '../src/validate-research.js';

const NOW = Date.parse('2026-08-30T00:00:00Z');

const dataset = { restaurants: [
  { id: 'delancey', name: 'Delancey', status: 'open',
    factors: { craft: { value: 9.6 }, distinctiveness: { value: 8.6 }, critical: { value: 9.6 } } },
  { id: 'zeeks-pizza', name: 'Zeeks Pizza', status: 'open' },
  { id: 'roma-roma', name: 'Roma Roma', status: 'open' }
] };
const registry = { 'sells-out': { label: 'Sells out', frictionCost: 1.5 } };

const run = doc => validateResearch(doc, dataset, registry, NOW);
const passes = doc => { const { fails } = run(doc); assert.deepEqual(fails, []); };
const failsWith = (doc, snippet) => {
  const { fails } = run(doc);
  assert.ok(fails.some(f => f.includes(snippet)),
    `expected a failure containing "${snippet}", got: ${JSON.stringify(fails)}`);
};

const NOTE = 'a note comfortably long enough to pass every length check';

/* ---- locations: the address gate ---- */
const site = (addr, hood = 'Somewhere') => ({ neighborhood: hood, address: addr });
const loc = (...sites) => ({ locations: [{ id: 'zeeks-pizza', source: 'https://z.com/l', sites }] });

test('locations: real Puget Sound addresses pass, Mill Creek included', () => {
  passes(loc(site('15021 Main Street, Mill Creek, WA 98012')));
  passes(loc(site('764 Broadway, Tacoma, WA 98402')));
  passes(loc(site('111 Market St NE, Olympia, WA 98501')));
});

test('locations: out-of-region and malformed addresses fail', () => {
  failsWith(loc(site('801 W Riverside Ave, Spokane, WA 99201')), 'Puget Sound ZIP');
  failsWith(loc(site('123 SE Main St, Portland, OR 97214')), 'not in Washington');
  failsWith(loc(site('Capitol Hill, Seattle, WA 98122')), 'street number');
  failsWith(loc(site('1415 NW 70th St, Seattle, WA')), 'Puget Sound ZIP');
});

test('locations: duplicate branches collide across punctuation', () => {
  failsWith(loc(site('1415 NW 70th St, Seattle, WA 98117'),
                site('1415 NW 70th St., Seattle WA 98117')), 'duplicate address');
});

test('locations: unknown id, http source, empty sites all fail', () => {
  failsWith({ locations: [{ id: 'nope', source: 'https://z.com', sites: [site('1 A St, Seattle, WA 98101')] }] }, 'unknown restaurant id');
  failsWith({ locations: [{ id: 'zeeks-pizza', source: 'http://z.com', sites: [site('1 A St, Seattle, WA 98101')] }] }, 'must be https');
  failsWith({ locations: [{ id: 'zeeks-pizza', source: 'https://z.com', sites: [] }] }, 'non-empty');
});

/* ---- directory: dedup against variant names ---- */
test('directory: a variant name cannot fork an existing entry', () => {
  failsWith({ directory: [{ name: 'Zeeks Pizza Co', status: 'open', neighborhood: 'X',
    note: NOTE, source: 'https://x.com/a' }] }, 'already on file');
  passes({ directory: [{ name: 'Totally New Pie', status: 'open', neighborhood: 'X',
    note: NOTE, source: 'https://x.com/a' }] });
});

/* ---- news ---- */
test('news: dates must be real, recent and not future', () => {
  const item = over => ({ news: [{ title: 'A perfectly plausible headline', source: 'The Stranger',
    url: 'https://x.com/a', published: '2026-08-20', kind: 'mention', ...over }] });
  passes(item({}));
  failsWith(item({ published: '2027-01-01' }), 'future');
  failsWith(item({ published: '2025-01-01' }), 'older than');
  failsWith(item({ kind: 'scandal' }), 'kind must be one of');
});

/* ---- factorRatings: the gate into the ladder ---- */
const rating = over => ({ factorRatings: [{ id: 'roma-roma', craft: 7.5, distinctiveness: 7,
  criticScore: 7.5, sources: ['https://x.com/review'], note: NOTE, ...over }] });

test('factorRatings: a grounded proposal for an unrated entry passes', () => {
  passes(rating({ opened: 2024, priceIndex: 2, styleGroup: 'Roman' }));
});

test('factorRatings: never overwrites, never off-grid, always sourced', () => {
  failsWith(rating({ id: 'delancey' }), 'already rated');
  failsWith(rating({ craft: 7.3 }), '0.5 steps');
  failsWith(rating({ criticScore: 11 }), 'criticScore');
  failsWith(rating({ sources: [] }), 'sources');
  failsWith(rating({ sources: ['http://x.com/a'] }), 'must be https');
  failsWith(rating({ opened: 2031 }), 'opened');
  failsWith(rating({ priceIndex: 5 }), 'priceIndex');
});

test('factorRatings: duplicate proposals for one entry are refused', () => {
  const doc = { factorRatings: [rating({}).factorRatings[0], rating({}).factorRatings[0]] };
  failsWith(doc, 'duplicate proposal');
});

/* ---- caps and structure ---- */
test('caps: an oversized section rejects the file', () => {
  const doc = { mentions: Array.from({ length: 31 }, () => ({})) };
  failsWith(doc, 'exceeds the 30 cap');
});

test('legacy crowd-rating payloads are refused outright', () => {
  failsWith({ ratings: [{ id: 'delancey', rating: 4.8 }] }, 'no longer accepted');
});

test('newAttributes: registry collisions and wild costs fail', () => {
  failsWith({ newAttributes: [{ key: 'sells-out', label: 'X', entries: ['delancey'] }] }, 'already exists');
  failsWith({ newAttributes: [{ key: 'cash-only', label: 'Cash only', frictionCost: 9, entries: ['delancey'] }] }, 'frictionCost');
  passes({ newAttributes: [{ key: 'cash-only', label: 'Cash only', frictionCost: 0.5, entries: ['delancey'] }] });
});

test('status: enum and citation enforced', () => {
  passes({ status: [{ id: 'delancey', status: 'open', note: 'confirmed on its site', source: 'https://x.com' }] });
  failsWith({ status: [{ id: 'delancey', status: 'gone', note: 'confirmed on its site', source: 'https://x.com' }] }, 'status must be');
});

/* ---- links: web presence records ---- */
test('links: a sourced website + instagram record passes', () => {
  passes({ links: [{ id: 'zeeks-pizza', website: 'https://zeekspizza.com',
    instagram: 'https://www.instagram.com/zeekspizza', source: 'https://zeekspizza.com' }] });
  passes({ links: [{ id: 'roma-roma', instagram: 'https://instagram.com/roma.roma_sea/',
    source: 'https://romaroma.example/about' }] });
});

test('links: guessed handles, wrong hosts and bare records fail', () => {
  failsWith({ links: [{ id: 'zeeks-pizza', instagram: 'https://facebook.com/zeeks',
    source: 'https://z.com' }] }, 'instagram must be a profile URL');
  failsWith({ links: [{ id: 'zeeks-pizza', instagram: 'https://www.instagram.com/p/abc123/extra',
    source: 'https://z.com' }] }, 'instagram must be a profile URL');
  failsWith({ links: [{ id: 'zeeks-pizza', source: 'https://z.com' }] }, 'website or instagram');
  failsWith({ links: [{ id: 'zeeks-pizza', website: 'http://zeeks.com', source: 'https://z.com' }] }, 'must be https');
});

test('links: unknown ids and duplicate records fail', () => {
  failsWith({ links: [{ id: 'nope', instagram: 'https://www.instagram.com/x_y',
    source: 'https://z.com' }] }, 'unknown restaurant id');
  failsWith({ links: [
    { id: 'zeeks-pizza', instagram: 'https://www.instagram.com/zeeks', source: 'https://z.com' },
    { id: 'zeeks-pizza', website: 'https://zeeks.com', source: 'https://z.com' }
  ] }, 'duplicate links record');
});
