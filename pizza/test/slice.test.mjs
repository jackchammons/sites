import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  reputationFactor, criticalFactor, valueFactor, frictionPenalty, stalenessDecay,
  scoreOne, rank, splitTiers, isRated, shrinkRating,
  DEFAULT_WEIGHTS, FRICTION_CAP, CRITICAL_BOOST_CAP, MAX_STALENESS_DECAY, PRICE_MULT
} from '../src/slice.js';

const NOW = new Date('2026-08-30T00:00:00Z');

test('weights sum to 100', () => {
  assert.equal(Object.values(DEFAULT_WEIGHTS).reduce((a, b) => a + b, 0), 100);
});

test('reputation renormalises over the components an entry actually has', () => {
  const full = reputationFactor({ opened: 2000, crowd: { reviews: 5000 }, mentions: [] }, NOW);
  assert.equal(full.parts.length, 2); // no mention history yet -> coverage absent
  const lonely = reputationFactor({ opened: 2000 }, NOW);
  assert.equal(lonely.parts.length, 1);
  // longevity alone at 26 years = full marks; adding huge volume cannot exceed 10
  assert.ok(lonely.value > 9.9);
  assert.ok(full.value <= 10);
  const nothing = reputationFactor({}, NOW);
  assert.equal(nothing.value, 0);
});

test('reputation longevity is log-curved: year 2 proves more than year 12 adds', () => {
  const y = n => reputationFactor({ opened: NOW.getUTCFullYear() - n }, NOW).value;
  assert.ok(y(2) - y(0) > y(12) - y(10));
  assert.ok(y(15) <= 10 && y(30) <= 10);
});

test('critical boost is capped and fades with age', () => {
  const mention = d => ({ kind: 'ranking', date: d });
  const burst = Array.from({ length: 40 }, () => mention('2026-08-20'));
  const boosted = criticalFactor({ criticScore: 7, mentions: burst }, NOW);
  assert.equal(boosted.boost, CRITICAL_BOOST_CAP);
  assert.equal(boosted.value, 7 + CRITICAL_BOOST_CAP);
  const old = criticalFactor({ criticScore: 7, mentions: [mention('2022-01-01')] }, NOW);
  assert.ok(old.boost < 0.1);
  const capped = criticalFactor({ criticScore: 9.5, mentions: burst }, NOW);
  assert.equal(capped.value, 10); // never exceeds the scale
});

test('value scales quality by price tier', () => {
  assert.equal(valueFactor(8, 1).value, 8 * PRICE_MULT[1]);
  assert.equal(valueFactor(8, 4).value, 8 * PRICE_MULT[4]);
  assert.equal(valueFactor(9.5, 1).value, 10); // clamped
  assert.equal(valueFactor(8, undefined).mult, 1); // missing tier is neutral
});

test('friction prices from the registry and caps', () => {
  const registry = { 'sells-out': { label: 'Sells out', frictionCost: 1.5 },
                     'cash-only': { label: 'Cash only', frictionCost: 4 },
                     'patio': { label: 'Patio' } };
  const f = frictionPenalty({ 'sells-out': true, 'cash-only': true, 'patio': true, 'mystery': true }, registry);
  assert.equal(f.all.length, 4);                    // every flag renders
  assert.equal(f.items.length, 3);                  // zero-cost patio does not price
  assert.equal(f.raw, 1.5 + 4 + 0.5);               // unknown flag costs a conservative 0.5
  assert.equal(f.applied, FRICTION_CAP);            // capped
});

test('staleness decay is bounded and unverified data takes the max', () => {
  assert.equal(stalenessDecay(null, NOW), MAX_STALENESS_DECAY);
  assert.ok(Math.abs(stalenessDecay('2026-08-29', NOW) - 0.002 / 7) < 1e-9); // one day
  assert.equal(stalenessDecay('2020-01-01', NOW), MAX_STALENESS_DECAY);
});

test('shrinkRating pulls small samples toward the mean', () => {
  const small = shrinkRating(4.9, 80, 4.3, 500);
  const big = shrinkRating(4.7, 4000, 4.3, 500);
  assert.ok(Math.abs(small - 4.3) < Math.abs(4.9 - 4.3));
  assert.ok(Math.abs(big - 4.7) < 0.05);
});

function entry(over = {}) {
  return {
    id: over.id ?? 'x', name: over.name ?? 'X', status: 'open',
    factors: { craft: { value: 8 }, distinctiveness: { value: 7 } },
    criticScore: 8, opened: 2015, priceIndex: 2,
    attributes: {}, mentions: [], lastVerified: '2026-08-29',
    ...over
  };
}

test('isRated requires craft, distinctiveness and a critic base', () => {
  assert.ok(isRated(entry()));
  assert.ok(!isRated(entry({ criticScore: undefined })));
  assert.ok(!isRated(entry({ factors: { craft: { value: 8 } } })));
});

test('a perfect entry scores 100 before deductions', () => {
  const r = entry({
    factors: { craft: { value: 10 }, distinctiveness: { value: 10 } },
    criticScore: 10, opened: 1990, priceIndex: 1,
    crowd: { rating: 5, reviews: 100000 }
  });
  const s = scoreOne(r, { now: NOW, registry: {} });
  assert.ok(s.base > 99.4, `base ${s.base}`);
});

test('rank scores only rated entries and sorts descending', () => {
  const dataset = { restaurants: [entry({ id: 'a', criticScore: 9 }), entry({ id: 'b', criticScore: 5 }),
    { id: 'unrated', name: 'U', status: 'open' }] };
  const out = rank(dataset, { now: NOW });
  assert.equal(out.length, 2);
  assert.deepEqual(out.map(r => r.id), ['a', 'b']);
  assert.ok(out[0].score >= out[1].score);
});

test('splitTiers holds anything not open out of the top, whatever it scores', () => {
  const scored = [
    { id: 'closed-great', name: 'C', status: 'closed', score: 99 },
    ...Array.from({ length: 11 }, (_, i) => ({ id: 'p' + i, name: 'P' + i, status: 'open', score: 90 - i }))
  ];
  const { top, bench } = splitTiers(scored, 10);
  assert.equal(top.length, 10);
  assert.ok(!top.some(r => r.id === 'closed-great'));
  assert.ok(bench.some(r => r.id === 'closed-great'));
  assert.deepEqual(top.map(r => r.rank), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
});
