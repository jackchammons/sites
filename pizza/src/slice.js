/*
 * THE SLICE SCORE
 * ---------------
 * A transparent, reproducible 0-100 rating for pizzerias.
 *
 *   SLICE = (weighted pillar base - friction penalty) x freshness factor
 *
 * Every number on the site comes out of this file. It is plain ES module
 * JavaScript with no Node or DOM dependencies so the static build and the
 * browser's live "re-rank it yourself" sliders run the exact same math.
 */

export const DEFAULT_WEIGHTS = {
  crust: 26,          // Crust Integrity   - fermentation, structure, bake
  toppings: 18,       // Topping Craft     - sourcing, restraint, balance
  consensus: 22,      // Consensus Signal  - critics + de-noised crowd rating
  distinctiveness: 18,// Distinctiveness   - does it own a lane in this city
  value: 16           // Value Density     - satisfaction per dollar
};

export const FRICTION_COSTS = {
  'preorder-only': 2.5,
  'preorder-recommended': 1.0,
  'sells-out': 1.5,
  'long-waits': 1.2,
  'no-reservations': 0.6,
  'limited-hours': 0.8,
  'tiny-room': 0.7,
  'small-room': 0.7,
  'late-night-only-peak': 0.4
};

export const FRICTION_LABELS = {
  'preorder-only': 'Preorder only',
  'preorder-recommended': 'Preorder recommended',
  'sells-out': 'Sells out',
  'long-waits': 'Long waits',
  'no-reservations': 'No reservations',
  'limited-hours': 'Limited hours',
  'tiny-room': 'Tiny room',
  'small-room': 'Small room',
  'late-night-only-peak': 'Peaks late night'
};

export const FRICTION_CAP = 6.0;   // never let logistics erase the pizza
export const RATING_FLOOR = 3.5;   // review scores below this are treated as 0
export const RATING_CEIL = 5.0;
export const MAX_STALENESS_DECAY = 0.06; // 6% ceiling
export const STALENESS_PER_WEEK = 0.002;

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

/*
 * Bayesian shrinkage. A 4.9 from 80 diners is a rumour; a 4.7 from 4,000 is
 * evidence. We pull every rating toward the city mean in proportion to how
 * little data stands behind it:
 *
 *   adjusted = (v / (v + m)) * R  +  (m / (v + m)) * C
 *
 * v = review count, m = prior weight, R = raw rating, C = city mean rating.
 */
export function shrinkRating(rating, reviews, cityMean, priorWeight) {
  const v = Math.max(0, reviews);
  const w = v / (v + priorWeight);
  return w * rating + (1 - w) * cityMean;
}

export function confidence(reviews, priorWeight) {
  const v = Math.max(0, reviews);
  return v / (v + priorWeight);
}

/* Map a shrunk 5-point rating onto the 0-10 pillar scale. */
export function ratingToPillar(adjusted) {
  return clamp(((adjusted - RATING_FLOOR) / (RATING_CEIL - RATING_FLOOR)) * 10, 0, 10);
}

/* Consensus Signal: 55% de-noised crowd, 45% critical consensus. */
export function consensusPillar(r, cityMean, priorWeight) {
  const adjusted = shrinkRating(r.crowd.rating, r.crowd.reviews, cityMean, priorWeight);
  const crowd10 = ratingToPillar(adjusted);
  return {
    adjusted,
    crowd10,
    value: clamp(0.55 * crowd10 + 0.45 * r.criticScore, 0, 10)
  };
}

/*
 * Value Density folds the editorial value read together with the raw price
 * tier, so a great cheap slice is rewarded twice and a $$$$ room has to earn
 * its keep. priceIndex 1..4 maps to 9, 7, 5, 3.
 */
export function valuePillar(r) {
  return clamp(0.75 * r.pillars.value + 0.25 * (11 - 2 * r.priceIndex), 0, 10);
}

export function frictionPenalty(tags = []) {
  const items = tags.map(t => ({ tag: t, cost: FRICTION_COSTS[t] ?? 0.5 }));
  const raw = items.reduce((s, i) => s + i.cost, 0);
  return { items, raw, applied: Math.min(raw, FRICTION_CAP) };
}

/*
 * Freshness. Data that has not been re-verified slowly loses a little of its
 * score, capped at 6%. It never rewrites the leaderboard on its own, but it
 * does mean a listing nobody has looked at in a year quietly drifts down --
 * and it gives the daily rebuild something real to recompute.
 */
export function stalenessDecay(lastVerified, now) {
  if (!lastVerified) return MAX_STALENESS_DECAY;
  const weeks = (now - new Date(lastVerified + 'T00:00:00Z')) / (7 * 864e5);
  if (!isFinite(weeks) || weeks <= 0) return 0;
  return Math.min(MAX_STALENESS_DECAY, weeks * STALENESS_PER_WEEK);
}

/* Score one restaurant, returning every intermediate value for display. */
export function scoreOne(r, opts) {
  const {
    weights = DEFAULT_WEIGHTS,
    cityMean, priorWeight,
    now = new Date(),
    applyFriction = true,
    applyFreshness = true
  } = opts;

  const cons = consensusPillar(r, cityMean, priorWeight);
  const pillars = {
    crust: r.pillars.crust,
    toppings: r.pillars.toppings,
    consensus: cons.value,
    distinctiveness: r.pillars.distinctiveness,
    value: valuePillar(r)
  };

  const totalWeight = Object.values(weights).reduce((a, b) => a + b, 0) || 1;
  const contributions = {};
  const weightShares = {};
  let base = 0;
  for (const key of Object.keys(pillars)) {
    // normalise so the bars always add up to 100 even with custom weights
    const share = ((weights[key] ?? 0) / totalWeight) * 100;
    weightShares[key] = share;
    const c = (pillars[key] / 10) * share;
    contributions[key] = c;
    base += c;
  }

  const fric = frictionPenalty(r.friction);
  const penalty = applyFriction ? fric.applied : 0;
  const decay = applyFreshness ? stalenessDecay(r.lastVerified, now) : 0;
  const score = Math.max(0, (base - penalty) * (1 - decay));

  return {
    ...r,
    pillars,
    contributions,
    weightShares,
    consensusDetail: cons,
    friction: r.friction,
    frictionDetail: fric,
    penaltyApplied: penalty,
    stalenessDecay: decay,
    confidence: confidence(r.crowd.reviews, priorWeight),
    base: round(base),
    score: round(score)
  };
}

const round = n => Math.round(n * 10) / 10;

/* Score and sort the whole field. Ties break on consensus, then crust. */
export function rank(dataset, opts = {}) {
  const cityMean = dataset.cityMeanRating;
  const priorWeight = dataset.priorWeight;
  const scored = dataset.restaurants.map(r =>
    scoreOne(r, { cityMean, priorWeight, ...opts })
  );
  scored.sort((a, b) =>
    b.score - a.score ||
    b.pillars.consensus - a.pillars.consensus ||
    b.pillars.crust - a.pillars.crust ||
    a.name.localeCompare(b.name)
  );
  return scored.map((r, i) => ({ ...r, rank: i + 1 }));
}

/* ISO-8601 week number - drives the deterministic weekly spotlight. */
export function isoWeek(date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d - yearStart) / 864e5 + 1) / 7);
}

/* "2026-W34" - stable key for one ISO week, used to keep weekly snapshots
 * weekly no matter how often the publish workflow happens to run. */
export function isoWeekKey(date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const year = d.getUTCFullYear();
  const yearStart = new Date(Date.UTC(year, 0, 1));
  const wk = Math.ceil(((d - yearStart) / 864e5 + 1) / 7);
  return `${year}-W${String(wk).padStart(2, '0')}`;
}
