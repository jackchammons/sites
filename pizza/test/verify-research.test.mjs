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

/* ---- per-record rejection ---- */
test('a bad record is dropped from accepted; the rest of the section survives', () => {
  const good = { id: 'delancey', status: 'open', note: 'confirmed on its site today', source: 'https://x.com/a' };
  const badRec = { id: 'delancey', status: 'open', note: 'confirmed on its site today', source: 'http://x.com/a' };
  const { fails, fatal, accepted } = run({ status: [good, badRec] });
  assert.equal(fatal, false);
  assert.equal(fails.length, 1);
  assert.deepEqual(accepted.status, [good]);
});

test('structural problems are fatal and accept nothing', () => {
  const over = run({ mentions: Array.from({ length: 41 }, () => ({})) });
  assert.equal(over.fatal, true);
  assert.deepEqual(over.accepted, {});
  assert.equal(run('nope').fatal, true);
});

/* ---- text hygiene ---- */
test('look-alike scripts and oversized text are refused', () => {
  failsWith({ directory: [{ name: 'Zeeks Pizz\u0430', status: 'open', neighborhood: 'X',
    note: NOTE, source: 'https://x.com/a' }] }, 'outside the Latin script');
  failsWith({ directory: [{ name: 'Fine Pizza', status: 'open', neighborhood: 'X',
    note: 'x'.repeat(601), source: 'https://x.com/a' }] }, 'longer than 600');
  // an accented Latin name is fine, and dedups against its plain spelling
  failsWith({ directory: [{ name: 'Z\u00e9eks Pizza', status: 'open', neighborhood: 'X',
    note: NOTE, source: 'https://x.com/a' }] }, 'already on file');
});

/* ---- status: closures need evidence ---- */
test('status: a closure citing a review site or listing is refused; news passes', () => {
  failsWith({ status: [{ id: 'delancey', status: 'closed', note: 'Yelp marks it closed.',
    source: 'https://www.yelp.com/biz/delancey-seattle' }] }, 'a closure needs');
  passes({ status: [{ id: 'delancey', status: 'closed', note: 'Eater reports the closure.',
    source: 'https://seattle.eater.com/closed', date: '2024-03-01' }] });
  passes({ status: [{ id: 'delancey', status: 'open', note: 'Yelp says open, site confirms',
    source: 'https://www.yelp.com/biz/delancey-seattle' }] });
});

/* ---- mentions: the 24-month window ---- */
test('mentions: accepted up to 24 months back, news only 180 days', () => {
  passes({ mentions: [{ id: 'roma-roma', title: 'An older but real review', url: 'https://x.com/r',
    source: 'Seattle Met', date: '2025-01-15', kind: 'mention' }] });
  failsWith({ mentions: [{ id: 'roma-roma', title: 'An ancient review', url: 'https://x.com/r',
    source: 'Seattle Met', date: '2023-01-15', kind: 'mention' }] }, 'older than 730');
});

/* ---- facts and ratingSkipped ---- */
test('facts: fill-gap records for opened and priceIndex', () => {
  passes({ facts: [{ id: 'delancey', opened: 2009, source: 'https://delancey.example/about' }] });
  failsWith({ facts: [{ id: 'delancey', source: 'https://x.com' }] }, 'must carry opened or priceIndex');
  failsWith({ facts: [{ id: 'delancey', opened: 1850, source: 'https://x.com' }] }, 'opened must be');
  failsWith({ facts: [{ id: 'nope', opened: 2000, source: 'https://x.com' }] }, 'unknown restaurant id');
});

test('ratingSkipped: records an attempt on an unrated entry only', () => {
  passes({ ratingSkipped: [{ id: 'roma-roma', note: 'no published review found' }] });
  failsWith({ ratingSkipped: [{ id: 'delancey', note: 'no published review found' }] }, 'already rated');
});

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

test('factorRatings: sources must include published criticism', () => {
  failsWith(rating({ sources: ['https://www.yelp.com/biz/roma-roma'] }), 'no source is published criticism');
  failsWith(rating({ sources: ['https://en.wikipedia.org/wiki/Roma_Roma', 'https://www.instagram.com/romaroma/'] }), 'no source is published criticism');
  passes(rating({ sources: ['https://www.yelp.com/biz/roma-roma', 'https://seattlemet.com/review'] }));
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
  const doc = { mentions: Array.from({ length: 41 }, () => ({})) };
  failsWith(doc, 'exceeds the 40 cap');
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

/* ---- factorSources: citations for a rating already on file ---- */
test('factorSources: attaches criticism to a rated entry, never to an unrated one', () => {
  passes({ factorSources: [{ id: 'delancey', sources: ['https://www.thestranger.com/food/delancey-review'], note: NOTE }] });
  failsWith({ factorSources: [{ id: 'zeeks-pizza', sources: ['https://www.thestranger.com/x'], note: NOTE }] }, 'is not rated');
  failsWith({ factorSources: [{ id: 'nope', sources: ['https://www.thestranger.com/x'], note: NOTE }] }, 'unknown restaurant id');
  failsWith({ factorSources: [{ id: 'delancey', sources: [], note: NOTE }] }, 'sources must be 1-4');
  failsWith({ factorSources: [{ id: 'delancey', sources: ['https://www.yelp.com/biz/delancey'], note: NOTE }] }, 'no source is published criticism');
  failsWith({ factorSources: [
    { id: 'delancey', sources: ['https://www.thestranger.com/a'], note: NOTE },
    { id: 'delancey', sources: ['https://www.thestranger.com/b'], note: NOTE }
  ] }, 'duplicate factorSources record');
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

/* ---- candidateReview: census verdicts ---- */
const CANDS = { candidates: [
  { name: 'Belltown Pizza', status: 'pending' },
  { name: 'Ghost Pizza', status: 'rejected' }
] };
const review = it => validateResearch({ candidateReview: [it] }, dataset, registry, NOW, CANDS);
const reviewFails = (it, snippet) => {
  const { fails } = review(it);
  assert.ok(fails.some(f => f.includes(snippet)),
    `expected "${snippet}", got: ${JSON.stringify(fails)}`);
};

test('candidateReview: a verdict on a pending candidate passes', () => {
  assert.deepEqual(review({ name: 'Belltown Pizza', verdict: 'not-pizza',
    note: 'a bar where pizza is incidental', source: 'https://x.com/a' }).fails, []);
});

test('candidateReview: bad verdicts, unknown/resolved names, thin notes fail', () => {
  reviewFails({ name: 'Belltown Pizza', verdict: 'meh', note: 'long enough note here' }, 'verdict must be');
  reviewFails({ name: 'Ghost Pizza', verdict: 'closed', note: 'long enough note here' }, 'not a pending candidate');
  reviewFails({ name: 'Nowhere Pizza', verdict: 'closed', note: 'long enough note here' }, 'not a pending candidate');
  reviewFails({ name: 'Belltown Pizza', verdict: 'closed', note: 'short' }, 'note missing or too short');
  reviewFails({ name: 'Belltown Pizza', verdict: 'closed', note: 'long enough note here',
    source: 'not a url' }, 'not a valid URL');
});

test('candidateReview: an http source is tolerated (dropped at apply), never fatal', () => {
  assert.deepEqual(review({ name: 'Belltown Pizza', verdict: 'closed',
    note: 'long enough note here', source: 'http://x.com/directions' }).fails, []);
});

test('candidateReview: without a candidates queue, name matching is skipped', () => {
  const { fails } = validateResearch({ candidateReview: [
    { name: 'Anything Pizza', verdict: 'closed', note: 'long enough note here' }
  ] }, dataset, registry, NOW);
  assert.deepEqual(fails, []);
});
