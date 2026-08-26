/*
 * THE SLICE SCORE, v2
 * -------------------
 * A 0-100 rating for pizzerias, computed the same way for every entry.
 *
 *   SLICE = (weighted factor base - friction penalty) x freshness factor
 *
 * Five factors. Three are computed from data the daily pipeline maintains,
 * two are editorial ratings stored with provenance:
 *
 *   reputation       computed   longevity + review volume + sustained coverage
 *   critical         computed   critic base rating + recency-weighted coverage
 *   craft            editorial  dough, bake, toppings -- the pizza itself
 *   distinctiveness  editorial  whether it owns a lane in this city
 *   value            computed   quality delivered per price tier
 *
 * Plain ES module with no Node or DOM dependencies: the static build and the
 * browser re-ranker run this exact file, so what the page claims is what the
 * page does.
 */

export const DEFAULT_WEIGHTS = {
  reputation: 24,
  critical: 24,
  craft: 18,
  distinctiveness: 18,
  value: 16
};

export const FRICTION_CAP = 6.0;         // logistics can dent, never decide
export const MAX_STALENESS_DECAY = 0.06; // 6% ceiling
export const STALENESS_PER_WEEK = 0.002;

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const round = n => Math.round(n * 10) / 10;

/* ---------- crowd-rating context (display only) ----------
 * Star averages are shown where the dataset has them, never scored directly:
 * the platforms that hold them block automated reads, so they cannot be kept
 * current. The review COUNT does feed reputation -- how many people have
 * bothered to rate a place is a durable fact even when the average is stale.
 *
 * Shown ratings are de-noised by Bayesian shrinkage toward the city mean:
 *   adjusted = (v / (v + m)) * R + (m / (v + m)) * C
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

/* ---------- computed factors ---------- */

/* Reputation: has this place earned standing over time?
 *
 * Three components, each 0..1, combined by fixed weights and renormalised over
 * whichever are measurable for the entry -- a pizzeria with no stored review
 * count is scored on the components it has, not punished with a zero for data
 * nobody collected:
 *
 *   longevity  (x3)  log-curve on years open; ~15 years earns full marks.
 *                    log1p because year 2 proves more than year 12.
 *   volume     (x2)  review count v -> v / (v + 500). The count, not the stars.
 *   coverage   (x1)  press mentions in the last 24 months -> /6, capped.
 *                    Only counted once the entry has any mention history, so
 *                    the factor stays fair while that history accumulates.
 */
export function reputationFactor(r, now) {
  const parts = [];
  if (typeof r.opened === 'number') {
    const years = Math.max(0, now.getUTCFullYear() - r.opened);
    parts.push({ key: 'longevity', w: 3, x: clamp(Math.log1p(years) / Math.log1p(15), 0, 1),
                 note: `${years} yr` });
  }
  if (r.crowd && typeof r.crowd.reviews === 'number') {
    parts.push({ key: 'volume', w: 2, x: r.crowd.reviews / (r.crowd.reviews + 500),
                 note: `${r.crowd.reviews} reviews` });
  }
  const mentions = r.mentions ?? [];
  if (mentions.length) {
    const cutoff = now.getTime() - 24 * 30.44 * 864e5;
    const recent = mentions.filter(m => Date.parse(m.date) > cutoff).length;
    parts.push({ key: 'coverage', w: 1, x: clamp(recent / 6, 0, 1),
                 note: `${recent} in 24 mo` });
  }
  const totalW = parts.reduce((s, p) => s + p.w, 0);
  const value = totalW ? 10 * parts.reduce((s, p) => s + p.w * p.x, 0) / totalW : 0;
  return { value: clamp(value, 0, 10), parts };
}

/* Critical reception: the critic base rating, refined -- never replaced -- by
 * what has been written since. Each press mention adds by kind and fades with
 * a 12-month half-life; the total boost is capped at +1.5 so a burst of
 * coverage can lift a score, not fabricate one.
 */
export const MENTION_WEIGHT = { ranking: 1.0, mention: 0.4, opening: 0.3, closing: 0 };
export const CRITICAL_BOOST_CAP = 1.5;

export function criticalFactor(r, now) {
  const base = clamp(r.criticScore ?? 0, 0, 10);
  let signal = 0;
  for (const m of r.mentions ?? []) {
    const months = (now.getTime() - Date.parse(m.date)) / (30.44 * 864e5);
    if (!isFinite(months) || months < 0) continue;
    signal += (MENTION_WEIGHT[m.kind] ?? 0.3) * Math.pow(0.5, months / 12);
  }
  const boost = Math.min(CRITICAL_BOOST_CAP, 0.5 * signal);
  return { value: clamp(base + boost, 0, 10), base, boost: round(boost) };
}

/* Value: quality delivered per dollar. The quality half is the mean of craft
 * and critical reception; the price tier scales it:
 *   $ x1.20   $$ x1.05   $$$ x0.90   $$$$ x0.75
 * A cheap great pie outruns its quality score; an expensive one has to be
 * better than its price to break even.
 */
export const PRICE_MULT = [null, 1.20, 1.05, 0.90, 0.75];

export function valueFactor(quality10, priceIndex) {
  const mult = PRICE_MULT[priceIndex] ?? 1;
  return { value: clamp(quality10 * mult, 0, 10), quality: round(quality10), mult };
}

/* ---------- deductions ---------- */

/* Friction: points for the gap between wanting the pizza and eating it, read
 * from the entry's attributes via the registry (data/attributes.json). Only
 * attributes with a frictionCost count; an attribute the registry has not
 * heard of costs a conservative 0.5 rather than silently nothing. */
export function frictionPenalty(attributes = {}, registry = {}) {
  const all = Object.keys(attributes)
    .filter(k => attributes[k])
    .map(k => ({
      tag: k,
      label: registry[k]?.label ?? k,
      cost: registry[k] ? (registry[k].frictionCost ?? 0) : 0.5
    }));
  const items = all.filter(i => i.cost > 0);
  const raw = items.reduce((s, i) => s + i.cost, 0);
  // `all` includes zero-cost attributes so the page can render every flag an
  // entry carries, not only the ones that cost points.
  return { all, items, raw, applied: Math.min(raw, FRICTION_CAP) };
}

/* Freshness: 0.2% off per week since the entry was last checked, capped at 6%.
 * Unverified data drifts down instead of coasting. */
export function stalenessDecay(lastVerified, now) {
  if (!lastVerified) return MAX_STALENESS_DECAY;
  const weeks = (now - new Date(lastVerified + 'T00:00:00Z')) / (7 * 864e5);
  if (!isFinite(weeks) || weeks <= 0) return 0;
  return Math.min(MAX_STALENESS_DECAY, weeks * STALENESS_PER_WEEK);
}

/* ---------- scoring ---------- */

/* An entry competes once it has the two editorial ratings and a critic base.
 * Everything else about it can be sparse; the computed factors handle gaps. */
export function isRated(r) {
  return Boolean(r.factors?.craft && r.factors?.distinctiveness
    && typeof r.criticScore === 'number');
}

/* Score one entry, returning every intermediate value for display. */
export function scoreOne(r, opts) {
  const {
    weights = DEFAULT_WEIGHTS,
    registry = {},
    cityMean, priorWeight,
    now = new Date(),
    applyFriction = true,
    applyFreshness = true
  } = opts;

  const rep = reputationFactor(r, now);
  const crit = criticalFactor(r, now);
  const craft10 = clamp(r.factors.craft.value, 0, 10);
  const dist10 = clamp(r.factors.distinctiveness.value, 0, 10);
  const val = valueFactor((craft10 + crit.value) / 2, r.priceIndex);

  const factorScores = {
    reputation: rep.value,
    critical: crit.value,
    craft: craft10,
    distinctiveness: dist10,
    value: val.value
  };

  const totalWeight = Object.values(weights).reduce((a, b) => a + b, 0) || 1;
  const contributions = {};
  const weightShares = {};
  let base = 0;
  for (const key of Object.keys(factorScores)) {
    // normalise so contributions always sum toward 100 even with custom weights
    const share = ((weights[key] ?? 0) / totalWeight) * 100;
    weightShares[key] = share;
    const c = (factorScores[key] / 10) * share;
    contributions[key] = c;
    base += c;
  }

  const fric = frictionPenalty(r.attributes, registry);
  const penalty = applyFriction ? fric.applied : 0;
  const decay = applyFreshness ? stalenessDecay(r.lastVerified, now) : 0;
  const score = Math.max(0, (base - penalty) * (1 - decay));

  const crowdContext = r.crowd
    ? {
        adjusted: shrinkRating(r.crowd.rating, r.crowd.reviews, cityMean, priorWeight),
        confidence: confidence(r.crowd.reviews, priorWeight)
      }
    : null;

  return {
    ...r,
    factorScores,
    contributions,
    weightShares,
    reputationDetail: rep,
    criticalDetail: crit,
    valueDetail: val,
    crowdContext,
    frictionDetail: fric,
    penaltyApplied: penalty,
    stalenessDecay: decay,
    base: round(base),
    score: round(score)
  };
}

/* Score and sort the rated field. Ties break on critical reception, then
 * craft, then alphabetically. */
export function rank(dataset, opts = {}) {
  const cityMean = dataset.cityMeanRating;
  const priorWeight = dataset.priorWeight;
  const registry = dataset.attributeRegistry ?? {};
  const scored = dataset.restaurants
    .filter(isRated)
    .map(r => scoreOne(r, { cityMean, priorWeight, registry, ...opts }));
  scored.sort((a, b) =>
    b.score - a.score ||
    b.factorScores.critical - a.factorScores.critical ||
    b.factorScores.craft - a.factorScores.craft ||
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

/* The published split: the ten highest-scoring open entries. Anything not
 * currently open is held out regardless of score. The remainder is returned
 * for the directory, still in score order. */
export function splitTiers(scored, topN = 10) {
  const eligible = [];
  const held = [];
  for (const r of scored) {
    if (r.status && r.status !== 'open') held.push(r);
    else eligible.push(r);
  }
  const byScore = (a, b) => b.score - a.score || a.name.localeCompare(b.name);
  eligible.sort(byScore);

  const top = eligible.slice(0, topN).map((r, i) => ({ ...r, rank: i + 1 }));
  const cutoff = top.length ? top[top.length - 1].score : 0;
  const bench = [...eligible.slice(topN), ...held]
    .sort(byScore)
    .map((r, i) => ({
      ...r,
      rank: top.length + i + 1,
      contender: r.score > cutoff && (!r.status || r.status === 'open')
    }));
  return { top, bench, cutoff };
}
