import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  reputationFactor, criticalFactor, valueFactor, frictionPenalty, stalenessDecay,
  verifiedDate, scoreOne, rank, splitTiers, byRank, isRated, shrinkRating,
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
  assert.equal(nothing.measured, false);
});

test('reputation is monotone: added evidence never lowers it', () => {
  const lonely = reputationFactor({ opened: 2000 }, NOW);                     // longevity 1.0
  const withCount = reputationFactor({ opened: 2000, crowd: { reviews: 200 } }, NOW); // volume 0.29
  assert.ok(withCount.value >= lonely.value, 'a review count must not cost points');
  assert.deepEqual(withCount.counted, ['longevity']);
  const withMention = reputationFactor({ opened: 2000, mentions: [{ date: '2026-08-01' }] }, NOW);
  assert.ok(withMention.value >= lonely.value, 'a first mention must not cost points');
  // a component that raises the mean is counted
  const young = reputationFactor({ opened: 2025, crowd: { reviews: 5000 } }, NOW);
  assert.ok(young.counted.includes('volume'));
  assert.ok(young.value > reputationFactor({ opened: 2025 }, NOW).value);
});

test('an unmeasured reputation carries no weight; the other factors share it', () => {
  const r = entry({ opened: undefined, crowd: undefined, mentions: [] });
  const s = scoreOne(r, { now: NOW, registry: {} });
  assert.equal(s.reputationDetail.measured, false);
  assert.equal(s.weightShares.reputation, 0);
  assert.equal(s.contributions.reputation, 0);
  const others = Object.entries(s.weightShares).filter(([k]) => k !== 'reputation').map(([, v]) => v);
  assert.ok(Math.abs(others.reduce((a, b) => a + b, 0) - 100) < 1e-9);
  // identical graded factors with no reputation data must not score below the
  // same entry with a founding year that earns full longevity marks...
  const known = scoreOne(entry({ opened: 1990, crowd: undefined, mentions: [] }), { now: NOW, registry: {} });
  assert.ok(known.score >= s.score);
  // ...and must not be zeroed: it scores as the mean of what it has.
  assert.ok(s.base > 70, `base ${s.base}`);
});

test('the freshness clock is the newest verification of any kind', () => {
  assert.equal(verifiedDate({}), null);
  assert.deepEqual(verifiedDate({ lastVerified: '2026-08-01', statusChecked: '2026-08-20' }),
    { date: '2026-08-20', source: 'status check' });
  assert.deepEqual(verifiedDate({ lastVerified: '2026-08-01', locationsVerified: '2026-07-01',
    factors: { craft: { date: '2026-08-27' } } }), { date: '2026-08-27', source: 'rating' });
  const fresh = scoreOne(entry({ lastVerified: '2026-01-01', statusChecked: '2026-08-29' }), { now: NOW, registry: {} });
  assert.ok(fresh.stalenessDecay < 0.001);
  assert.equal(fresh.verified.source, 'status check');
});

test('reputation longevity is log-curved: year 2 proves more than year 12 adds', () => {
  const y = n => reputationFactor({ opened: NOW.getUTCFullYear() - n }, NOW).value;
  assert.ok(y(2) - y(0) > y(12) - y(10));
  assert.ok(y(15) <= 10 && y(30) <= 10);
});

test('critical boost is capped and fades with age', () => {
  const mention = d => ({ kind: 'ranking', date: d });
  const burst = Array.from({ length: 40 }, () => mention('2026-08-20'));
  const boosted = criticalFactor({ factors: { critical: { value: 7 } }, mentions: burst }, NOW);
  assert.equal(boosted.boost, CRITICAL_BOOST_CAP);
  assert.equal(boosted.value, 7 + CRITICAL_BOOST_CAP);
  const old = criticalFactor({ factors: { critical: { value: 7 } }, mentions: [mention('2022-01-01')] }, NOW);
  assert.ok(old.boost < 0.1);
  const capped = criticalFactor({ factors: { critical: { value: 9.5 } }, mentions: burst }, NOW);
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
    factors: { craft: { value: 8 }, distinctiveness: { value: 7 }, critical: { value: 8 } },
    opened: 2015, priceIndex: 2,
    attributes: {}, mentions: [], lastVerified: '2026-08-29',
    ...over
  };
}

test('isRated requires craft, distinctiveness and a critic base', () => {
  assert.ok(isRated(entry()));
  assert.ok(!isRated(entry({ factors: { craft: { value: 8 }, distinctiveness: { value: 7 } } })));
  assert.ok(!isRated(entry({ factors: { craft: { value: 8 }, critical: { value: 8 } } })));
});

test('a perfect entry scores 100 before deductions', () => {
  const r = entry({
    factors: { craft: { value: 10 }, distinctiveness: { value: 10 }, critical: { value: 10 } },
    opened: 1990, priceIndex: 1,
    crowd: { rating: 5, reviews: 100000 }
  });
  const s = scoreOne(r, { now: NOW, registry: {} });
  assert.ok(s.base > 99.4, `base ${s.base}`);
});

test('rank scores only rated entries and sorts descending', () => {
  const dataset = { restaurants: [entry({ id: 'a' }), entry({ id: 'b', factors: { craft: { value: 4 }, distinctiveness: { value: 4 }, critical: { value: 4 } } }),
    { id: 'unrated', name: 'U', status: 'open' }] };
  const out = rank(dataset, { now: NOW });
  assert.equal(out.length, 2);
  assert.deepEqual(out.map(r => r.id), ['a', 'b']);
  assert.ok(out[0].score >= out[1].score);
});

test('splitTiers keeps rank() order: ties break on critical, then craft, never alphabetically', () => {
  const fs = (critical, craft) => ({ reputation: 5, critical, craft, distinctiveness: 7, value: 7 });
  // Equal published scores; Zed has the better critical read and must come first.
  const alpha = { id: 'alpha', name: 'Alpha', status: 'open', score: 81.3, factorScores: fs(8.0, 8.0) };
  const zed   = { id: 'zed',   name: 'Zed',   status: 'open', score: 81.3, factorScores: fs(8.4, 8.0) };
  const ordered = [alpha, zed].sort(byRank);
  assert.deepEqual(ordered.map(r => r.id), ['zed', 'alpha']);
  // same score and critical: craft decides; then, and only then, the name
  const bravo = { id: 'bravo', name: 'Bravo', status: 'open', score: 81.3, factorScores: fs(8.4, 8.5) };
  assert.deepEqual([alpha, zed, bravo].sort(byRank).map(r => r.id), ['bravo', 'zed', 'alpha']);
  const { top } = splitTiers(ordered, 10);
  assert.deepEqual(top.map(r => r.id), ['zed', 'alpha']);
  assert.deepEqual(top.map(r => r.rank), [1, 2]);
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
