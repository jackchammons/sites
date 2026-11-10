/*
 * THE SLICE SCORE, v2.2
 * ---------------------
 * A 0-100 rating for pizzerias, computed the same way for every entry.
 *
 *   SLICE = (weighted factor base - friction penalty) x freshness factor
 *
 * Five factors. Three are computed from data the daily pipeline maintains,
 * two are editorial ratings stored with provenance:
 *
 *   reputation       computed   longevity + review volume + sustained coverage;
 *                               counted only where it does not lower the score
 *   critical         computed   critic base rating + recency-weighted coverage
 *   craft            editorial  dough, bake, toppings -- the pizza itself
 *   distinctiveness  editorial  whether it owns a lane in this city
 *   value            computed   quality delivered per price tier
 *
 * Plain ES module with no Node or DOM dependencies, run by the build and the
 * tests from this exact file, so what the page claims is what the
 * page does.
 */

/* Bumped whenever a formula changes. Stamped on every weekly snapshot so the
 * record chart and the movement evidence can tell a re-scoring from a real
 * move (v1 -> v2 on 2026-08-26 was read as three pizzerias falling out of the
 * ten; it was the formula). */
export const ALGORITHM = 'SLICE v2.2';

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

/* ---------- computed factors ----------
 * Crowd star averages are shown where the dataset has them, exactly as stored,
 * and never scored: the platforms that hold them block automated reads, so
 * they cannot be kept current. The review COUNT does feed reputation -- how
 * many people have bothered to rate a place is a durable fact even when the
 * average is stale. */

/* Reputation: has this place earned standing over time?
 *
 * Three components, each 0..1, with fixed weights. An entry is scored on the
 * components it has: a pizzeria with no stored review count is not punished
 * with a zero for data nobody collected.
 *
 *   longevity  (x3)  log-curve on years open; LONGEVITY_FULL_YEARS earns
 *                    full marks. log1p because year 2 proves more than year 12.
 *   volume     (x2)  review count v -> v / (v + VOLUME_HALF_REVIEWS). The
 *                    count, not the stars.
 *   coverage   (x1)  press mentions in the last COVERAGE_WINDOW_MONTHS,
 *                    over COVERAGE_FULL_MENTIONS, capped.
 *
 * Combination is monotone in added evidence: the factor is the best weighted
 * mean over any non-empty subset of the present components (components sorted
 * by their score, best prefix wins). A plain weighted mean punished the
 * entries the pipeline knew most about -- a stored review count or a first
 * press mention pulled a full-marks longevity DOWN -- so collecting data cost
 * points. Under this rule a component counts only when it raises the factor.
 *
 * With no component at all the factor is unmeasured (`measured: false`). It is
 * not scored as zero: 29 of 52 rated entries had reputation 0.0 for want of a
 * founding year, and that, not quality, decided the published ten. scoreOne
 * decides whether a measured reputation carries weight.
 *
 * The page prints these constants from here, so the methodology cannot drift
 * from the code.
 */
export const REPUTATION_WEIGHTS = { longevity: 3, volume: 2, coverage: 1 };
export const LONGEVITY_FULL_YEARS = 15;
export const VOLUME_HALF_REVIEWS = 500;
export const COVERAGE_WINDOW_MONTHS = 24;
export const COVERAGE_FULL_MENTIONS = 6;

const MONTH_MS = 30.44 * 864e5;

export function reputationFactor(r, now) {
  const parts = [];
  if (typeof r.opened === 'number') {
    const years = Math.max(0, now.getUTCFullYear() - r.opened);
    parts.push({ key: 'longevity', w: REPUTATION_WEIGHTS.longevity,
                 x: clamp(Math.log1p(years) / Math.log1p(LONGEVITY_FULL_YEARS), 0, 1), note: `${years} yr` });
  }
  if (r.crowd && typeof r.crowd.reviews === 'number') {
    parts.push({ key: 'volume', w: REPUTATION_WEIGHTS.volume,
                 x: r.crowd.reviews / (r.crowd.reviews + VOLUME_HALF_REVIEWS), note: `${r.crowd.reviews} reviews` });
  }
  const mentions = r.mentions ?? [];
  if (mentions.length) {
    const cutoff = now.getTime() - COVERAGE_WINDOW_MONTHS * MONTH_MS;
    const recent = mentions.filter(m => Date.parse(m.date) > cutoff).length;
    parts.push({ key: 'coverage', w: REPUTATION_WEIGHTS.coverage,
                 x: clamp(recent / COVERAGE_FULL_MENTIONS, 0, 1), note: `${recent} in ${COVERAGE_WINDOW_MONTHS} mo` });
  }
  if (!parts.length) return { value: 0, parts, measured: false, counted: [] };

  // Best prefix of the components sorted by score: each one is kept only if
  // it raises the weighted mean of the ones before it.
  const sorted = [...parts].sort((a, b) => b.x - a.x);
  let best = -1, bestN = 0, sw = 0, sx = 0;
  sorted.forEach((p, i) => {
    sw += p.w; sx += p.w * p.x;
    const mean = sx / sw;
    if (mean > best) { best = mean; bestN = i + 1; }
  });
  const counted = sorted.slice(0, bestN).map(p => p.key);
  return { value: clamp(10 * best, 0, 10), parts, measured: true, counted };
}

/* Critical reception: the critic base rating, refined -- never replaced -- by
 * what has been written since. Each press mention adds by kind (a kind the
 * table does not name takes MENTION_WEIGHT_OTHER) and fades with a half-life
 * of MENTION_HALF_LIFE_MONTHS; the summed signal is scaled by
 * CRITICAL_BOOST_SCALE and the boost capped at CRITICAL_BOOST_CAP, so a burst
 * of coverage can lift a score, not fabricate one.
 */
export const MENTION_WEIGHT = { ranking: 1.0, mention: 0.4, opening: 0.3, closing: 0 };
export const MENTION_WEIGHT_OTHER = 0.3;
export const MENTION_HALF_LIFE_MONTHS = 12;
export const CRITICAL_BOOST_SCALE = 0.5;
export const CRITICAL_BOOST_CAP = 1.5;

export function criticalFactor(r, now) {
  const base = clamp(r.factors?.critical?.value ?? 0, 0, 10);
  let signal = 0;
  for (const m of r.mentions ?? []) {
    const months = (now.getTime() - Date.parse(m.date)) / MONTH_MS;
    if (!isFinite(months) || months < 0) continue;
    signal += (MENTION_WEIGHT[m.kind] ?? MENTION_WEIGHT_OTHER) * Math.pow(0.5, months / MENTION_HALF_LIFE_MONTHS);
  }
  const boost = Math.min(CRITICAL_BOOST_CAP, CRITICAL_BOOST_SCALE * signal);
  return { value: clamp(base + boost, 0, 10), base, boost: round(boost) };
}

/* Value: quality delivered per dollar. The quality half is the mean of craft
 * and critical reception; the price tier scales it:
 *   $ x1.20   $$ x1.05   $$$ x0.90   $$$$ x0.75
 * A cheap great pie outruns its quality score; an expensive one has to be
 * better than its price to break even. An entry with no tier on file takes
 * PRICE_MULT_UNKNOWN.
 */
export const PRICE_MULT = [null, 1.20, 1.05, 0.90, 0.75];
export const PRICE_MULT_UNKNOWN = 1;

export function valueFactor(quality10, priceIndex) {
  const mult = PRICE_MULT[priceIndex] ?? PRICE_MULT_UNKNOWN;
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

/* Freshness: 0.2% off per week since the entry was last verified, capped at 6%
 * (reached after 30 weeks). Unverified data takes the cap.
 *
 * "Verified" means the newest of any check the pipeline records: a liveness
 * confirmation (statusChecked), a locations pass (locationsVerified), the
 * rating date on a graded factor, or the legacy lastVerified stamp. Reading
 * lastVerified alone meant the clock only ever started on the day an entry
 * was first rated and nothing in the rotation could reset it, so the decay
 * was a permanent penalty keyed to rating date rather than freshness. */
export function verifiedDate(r) {
  const cands = [
    ['status check', r.statusChecked],
    ['locations check', r.locationsVerified],
    ['rating', r.lastVerified],
    ...['craft', 'distinctiveness', 'critical'].map(k => ['rating', r.factors?.[k]?.date])
  ].filter(([, d]) => typeof d === 'string' && Number.isFinite(Date.parse(d)));
  if (!cands.length) return null;
  cands.sort((a, b) => Date.parse(b[1]) - Date.parse(a[1]));
  return { date: cands[0][1].slice(0, 10), source: cands[0][0] };
}

export function stalenessDecay(lastVerified, now) {
  if (!lastVerified) return MAX_STALENESS_DECAY;
  const weeks = (now - new Date(lastVerified.slice(0, 10) + 'T00:00:00Z')) / (7 * 864e5);
  if (!isFinite(weeks) || weeks <= 0) return 0;
  return Math.min(MAX_STALENESS_DECAY, weeks * STALENESS_PER_WEEK);
}

/* ---------- scoring ---------- */

/* An entry competes once all three graded factors are on file.
 * Everything else about it can be sparse; the computed factors handle gaps. */
export function isRated(r) {
  return Boolean(r.factors?.craft && r.factors?.distinctiveness && r.factors?.critical);
}

/* Score one entry, returning every intermediate value for display.
 *
 * Reputation carries its weight only when it is measured and counting it does
 * not lower the score: when its value is below the weighted mean of the other
 * four factors, its weight is dropped exactly as for an unmeasured entry and
 * the other four share it. The second half is what keeps the score monotone
 * in evidence. With the unmeasured rule alone, an entry with nothing on file
 * has its 24% shared out, and the first press mention or founding year filed
 * for it becomes a low reputation at full weight: a top-ten entry lost up to
 * 16 points for having been written about. The base is the larger of M (the
 * other four's weighted mean) and the mean with reputation in it, which rises
 * with both, so a new mention, founding year or review count can lift a score
 * and never lower it.
 *
 * `reputationDetail.use` says which case applied, so a card can explain itself:
 *   'counted'     in the score at its full weight
 *   'unmeasured'  nothing on file
 *   'lowers'      on file and shown, but below the entry's other factors
 */
export function scoreOne(r, opts = {}) {
  const {
    weights = DEFAULT_WEIGHTS,
    registry = {},
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

  // The weighted mean of the other four factors, 0..10: the level reputation
  // has to reach before counting it helps.
  let ow = 0, os = 0;
  for (const key of Object.keys(factorScores)) {
    if (key === 'reputation') continue;
    ow += weights[key] ?? 0;
    os += (weights[key] ?? 0) * factorScores[key];
  }
  const othersMean = ow ? os / ow : 0;
  const use = !rep.measured ? 'unmeasured' : rep.value < othersMean ? 'lowers' : 'counted';

  // The shares renormalise over the weights still in play, so the
  // contributions of a perfect entry sum to 100 in every case.
  const effective = { ...weights };
  if (use !== 'counted') effective.reputation = 0;
  const totalWeight = Object.values(effective).reduce((a, b) => a + b, 0) || 1;
  const contributions = {};
  const weightShares = {};
  let base = 0;
  for (const key of Object.keys(factorScores)) {
    const share = ((effective[key] ?? 0) / totalWeight) * 100;
    weightShares[key] = share;
    const c = (factorScores[key] / 10) * share;
    contributions[key] = c;
    base += c;
  }

  const fric = frictionPenalty(r.attributes, registry);
  const penalty = applyFriction ? fric.applied : 0;
  const verified = verifiedDate(r);
  const decay = applyFreshness ? stalenessDecay(verified?.date, now) : 0;
  const score = Math.max(0, (base - penalty) * (1 - decay));

  return {
    ...r,
    factorScores,
    contributions,
    weightShares,
    reputationDetail: { ...rep, use, othersMean },
    criticalDetail: crit,
    valueDetail: val,
    frictionDetail: fric,
    penaltyApplied: penalty,
    verified,
    stalenessDecay: decay,
    base: round(base),
    score: round(score)
  };
}

/* Ties break on critical reception, then craft, then alphabetically. The one
 * comparator the page's order comes from; splitTiers partitions, never
 * re-sorts, so the stated rule is the published rule. */
export const byRank = (a, b) =>
  b.score - a.score ||
  b.factorScores.critical - a.factorScores.critical ||
  b.factorScores.craft - a.factorScores.craft ||
  a.name.localeCompare(b.name, 'en');

/* Score and sort the rated field. */
export function rank(dataset, opts = {}) {
  const registry = dataset.attributeRegistry ?? {};
  const scored = dataset.restaurants
    .filter(isRated)
    .map(r => scoreOne(r, { registry, ...opts }));
  scored.sort(byRank);
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

/* The published split: the ten highest-scoring open entries, in the order
 * rank() gave them. Anything not currently open is held out regardless of
 * score and listed after the open remainder; nothing is re-sorted here. The
 * old version re-sorted by score then name, which silently replaced the
 * published tie-break with an alphabetical one. */
export function splitTiers(scored, topN = 10) {
  const eligible = [];
  const held = [];
  for (const r of scored) {
    if (r.status && r.status !== 'open') held.push(r);
    else eligible.push(r);
  }
  const top = eligible.slice(0, topN).map((r, i) => ({ ...r, rank: i + 1 }));
  const bench = [...eligible.slice(topN), ...held]
    .map((r, i) => ({ ...r, rank: top.length + i + 1 }));
  return { top, bench };
}
