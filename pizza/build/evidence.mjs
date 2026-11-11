import { esc, srcLinks } from './html.mjs';
import { STALENESS_PER_WEEK, isLaunchRating } from '../src/slice.js';

/* ---- why an entry moved ----
 * The weekly delta says THAT a card moved; this names the mechanism behind it,
 * linked to the source that caused it. Signals, in order of strength:
 *   - factor diffs against last week's snapshot (when that snapshot has them)
 *   - a fresh re-rating (a graded factor whose provenance date is this week),
 *     which also restarts the freshness clock
 *   - recent press mentions, phrased by kind (list, mention, opening)
 *   - freshness decay (score slides while nothing is re-verified) or its reset
 *   - displacement (the honest "entries around it moved")
 * A bare score delta is never the story: every line names a cause or names
 * displacement.
 *
 * Freshness is read from `r.verified`, the date and check scoreOne ran the
 * decay from, so this line and the card's own freshness row cannot name
 * different dates. A liveness or locations pass resets the clock as surely
 * as a rating does. */
export const FACTOR_LABEL = { reputation: 'reputation', critical: 'critical reception',
  craft: 'craft', distinctiveness: 'distinctiveness', value: 'value' };

const GRADED = ['craft', 'distinctiveness', 'critical'];
const MENTION_WINDOW_DAYS = 21;   // matches the visible "recent press" horizon
const RERATE_WINDOW_DAYS = 9;     // a provenance date inside the last snapshot gap

/* What a graded factor was read from: the list a current pass files, or the
 * single source an earlier one did. */
const sourcesOf = f => f.sources?.length ? f.sources : f.source ? [f.source] : [];

const link = (url, text) => `<a href="${esc(url)}" target="_blank" rel="noopener nofollow">${esc(text)}</a>`;

const KIND_PHRASE = {
  ranking: m => `named in a new list by ${link(m.url, m.source)}`,
  mention: m => `new coverage in ${link(m.url, m.source)}`,
  opening: m => `opening coverage in ${link(m.url, m.source)}`,
  closing: m => `a closure report in ${link(m.url, m.source)}`
};
const mentionPhrase = m => (KIND_PHRASE[m.kind] ?? KIND_PHRASE.mention)(m);

export function evidenceFor(r, previous, now, algorithm) {
  const moved = r.previousRank != null && r.previousRank !== r.rank;
  const isNew = r.previousRank == null;
  if (!moved && !isNew) return '';

  // A snapshot taken under a different formula is not a baseline for cause:
  // the move is the method's, and saying anything else would be fiction.
  if (previous && algorithm && previous.algorithm && previous.algorithm !== algorithm) {
    return `<b>Why it moved:</b> the scoring method changed this week (${esc(previous.algorithm)} → ${esc(algorithm)}; see <a href="#methodology">how it works</a>). Movement against last week's standings reflects the new formula, not the pizzeria.`;
  }

  const nowMs = now.getTime();
  const daysAgo = iso => (nowMs - Date.parse(iso)) / 864e5;

  // Recent press, strongest kind first (a list beats a passing mention).
  const kindRank = { ranking: 0, mention: 1, opening: 2, closing: 3 };
  const recent = (r.mentions ?? [])
    .filter(m => m.date && daysAgo(m.date) < MENTION_WINDOW_DAYS)
    .sort((a, b) => (kindRank[a.kind] ?? 9) - (kindRank[b.kind] ?? 9)
      || Date.parse(b.date) - Date.parse(a.date));

  // A graded factor the agent dated inside the last snapshot gap is a re-rating
  // this week: that date is the day the research pass applied the rating, and
  // the sources beside it are what it was read from. A launch rating's date
  // means neither, so its factors never count.
  const agentSet = !isLaunchRating(r);
  const freshlyRated = GRADED.filter(k => {
    const f = r.factors?.[k];
    return agentSet && f?.date && daysAgo(f.date) < RERATE_WINDOW_DAYS;
  });

  const bits = [];
  const cited = new Set();
  const fmtD = d => `${d > 0 ? '+' : '−'}${Math.abs(d).toFixed(1)}`;
  // Every source the re-rating was read from, each linked once: the three
  // factors of one pass share their sources, so the first line carries them.
  const ratingSources = () => {
    const urls = [...new Set(freshlyRated.flatMap(k => sourcesOf(r.factors[k])))].filter(u => !cited.has(u));
    for (const u of urls) cited.add(u);
    return srcLinks(urls);
  };
  const citeRating = () => {
    const from = ratingSources();
    return from ? ` — from ${from}` : '';
  };
  // A pass that rates an entry stamps it verified that day, so the decay runs
  // from the rating. That reset is the re-rating's doing and is said so,
  // instead of being left to read as an unexplained "re-verified".
  const v = r.verified;
  const ratingResetsDecay = freshlyRated.length > 0 && v?.source === 'rating' && daysAgo(v.date) < RERATE_WINDOW_DAYS;
  let rerated = false;

  const pf = previous?.factors?.[r.id];
  if (pf) {
    const deltas = Object.keys(FACTOR_LABEL)
      .map(k => [k, r.factorScores[k] - (pf[k] ?? r.factorScores[k])])
      .filter(([, d]) => Math.abs(d) >= 0.1)
      .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
    const has = k => deltas.some(([dk]) => dk === k);
    for (const [k, d] of deltas.slice(0, 4)) {
      // Value is derived from craft and critical; explaining it separately when
      // a parent already moved would double-count one cause.
      if (k === 'value' && (has('craft') || has('critical'))) continue;
      // A reputation that carries no weight cannot be why a score rose.
      if (k === 'reputation' && d > 0 && r.reputationDetail && r.reputationDetail.use !== 'counted') continue;
      if (freshlyRated.includes(k)) {
        rerated = true;
        bits.push(`re-rated: ${FACTOR_LABEL[k]} ${(r.factorScores[k] - d).toFixed(1)} → ${r.factorScores[k].toFixed(1)}${citeRating()}`);
      } else if (k === 'critical' && d > 0 && recent.length) {
        const m = recent[0];
        cited.add(m.url);
        bits.push(`critical reception ${fmtD(d)} — ${mentionPhrase(m)}`);
      } else if (k === 'reputation' && d > 0 && recent.length) {
        const m = recent.find(x => !cited.has(x.url));
        bits.push(`reputation ${fmtD(d)}${m ? ` — fresh press in ${link(m.url, m.source)} counts toward its coverage record` : ''}`);
        if (m) cited.add(m.url);
      } else {
        bits.push(`${FACTOR_LABEL[k]} ${fmtD(d)}`);
      }
    }
    if (pf.penalty != null && Math.abs(r.penaltyApplied - pf.penalty) >= 0.1) {
      const d = r.penaltyApplied - pf.penalty;
      bits.push(`friction ${d > 0 ? 'grew' : 'eased'} ${Math.abs(d).toFixed(1)} after a verified attribute change`);
    }
  } else if (freshlyRated.length && !isNew) {
    // Older snapshots carry no factor breakdowns; a fresh provenance date still
    // pins the cause. A brand-new entry skips this — its "rated from" line
    // below already tells that story.
    rerated = true;
    bits.push(`re-rated this week: ${freshlyRated.map(k =>
      `${FACTOR_LABEL[k]} ${r.factorScores[k].toFixed(1)}`).join(', ')}${citeRating()}`);
  }
  if (rerated && ratingResetsDecay) bits.push('the new rating also resets its freshness decay');

  // Computed after every branch has claimed its citations, so a story that
  // already explains a line never repeats in the tail.
  const tail = () => {
    const extra = recent.filter(m => !cited.has(m.url)).slice(0, 2)
      .map(m => link(m.url, m.source));
    return extra.length ? ` · in the news: ${extra.join(' · ')}` : '';
  };

  if (isNew) {
    const graded = agentSet && GRADED.map(k => r.factors?.[k]).find(f => f?.source && !cited.has(f.source));
    const src = graded ? ` · rated from ${link(graded.source, 'published coverage')}` : '';
    return `<b>New to the ten:</b> ${bits.length ? bits.join('; ') : 'first week with a score high enough'}${src}${tail()}`;
  }

  if (!bits.length) {
    const prevScore = previous?.scores?.[r.id];
    const drift = prevScore != null ? r.score - prevScore : null;
    let cause;
    if (drift != null && drift <= -0.1 && (r.stalenessDecay ?? 0) > 0) {
      cause = `freshness decay — ${v ? `nothing re-verified since the ${esc(v.source)} on ${esc(v.date)}` : 'never verified'}; a score slides ${(STALENESS_PER_WEEK * 100).toFixed(1)}% a week until the rotation re-checks it`;
    } else if (drift != null && drift >= 0.1 && ratingResetsDecay) {
      // Re-rated to the values it already had: the rise is the clock alone.
      const from = ratingSources();
      cause = `re-rated on ${esc(v.date)}${from ? ` from ${from}` : ''} with its values unchanged, which resets its freshness decay`;
    } else if (drift != null && drift >= 0.1 && v && daysAgo(v.date) < RERATE_WINDOW_DAYS) {
      cause = `re-verified by a ${esc(v.source)} on ${esc(v.date)}, which resets its freshness decay`;
    } else if (drift != null && drift >= 0.1 && recent.length) {
      const m = recent[0];
      cited.add(m.url);
      cause = `${mentionPhrase(m)} lifted its critical reception`;
    } else {
      cause = `no change of its own — entries around it ${r.previousRank > r.rank ? 'fell' : 'rose'}`;
    }
    return `<b>Why it moved:</b> ${cause}${tail()}`;
  }
  return `<b>Why it moved:</b> ${bits.join('; ')}${tail()}`;
}
