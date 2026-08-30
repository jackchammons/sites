import { esc } from './html.mjs';

/* ---- why an entry moved ----
 * The weekly delta says THAT a card moved; this names the mechanism behind it,
 * linked to the source that caused it. Signals, in order of strength:
 *   - factor diffs against last week's snapshot (when that snapshot has them)
 *   - a fresh re-rating (a graded factor whose provenance date is this week)
 *   - recent press mentions, phrased by kind (list, mention, opening)
 *   - freshness decay (score slides while nothing is re-verified) or its reset
 *   - displacement (the honest "entries around it moved")
 * A bare score delta is never the story: every line names a cause or names
 * displacement. */
export const FACTOR_LABEL = { reputation: 'reputation', critical: 'critical reception',
  craft: 'craft', distinctiveness: 'distinctiveness', value: 'value' };

const GRADED = ['craft', 'distinctiveness', 'critical'];
const MENTION_WINDOW_DAYS = 21;   // matches the visible "recent press" horizon
const RERATE_WINDOW_DAYS = 9;     // a provenance date inside the last snapshot gap

const link = (url, text) => `<a href="${esc(url)}" target="_blank" rel="noopener nofollow">${esc(text)}</a>`;

const KIND_PHRASE = {
  ranking: m => `named in a new list by ${link(m.url, m.source)}`,
  mention: m => `new coverage in ${link(m.url, m.source)}`,
  opening: m => `opening coverage in ${link(m.url, m.source)}`,
  closing: m => `a closure report in ${link(m.url, m.source)}`
};
const mentionPhrase = m => (KIND_PHRASE[m.kind] ?? KIND_PHRASE.mention)(m);

export function evidenceFor(r, previous, now) {
  const moved = r.previousRank != null && r.previousRank !== r.rank;
  const isNew = r.previousRank == null;
  if (!moved && !isNew) return '';

  const nowMs = now.getTime();
  const daysAgo = iso => (nowMs - Date.parse(iso)) / 864e5;

  // Recent press, strongest kind first (a list beats a passing mention).
  const kindRank = { ranking: 0, mention: 1, opening: 2, closing: 3 };
  const recent = (r.mentions ?? [])
    .filter(m => m.date && daysAgo(m.date) < MENTION_WINDOW_DAYS)
    .sort((a, b) => (kindRank[a.kind] ?? 9) - (kindRank[b.kind] ?? 9)
      || Date.parse(b.date) - Date.parse(a.date));

  // A factor the AGENT graded within the last snapshot gap is a re-rating this
  // week. Editorial factors are excluded: the schema migration stamped them all
  // with one date, so date-recency alone proves nothing about them.
  const freshlyRated = GRADED.filter(k => {
    const f = r.factors?.[k];
    return f?.setBy === 'agent' && f.date && daysAgo(f.date) < RERATE_WINDOW_DAYS;
  });

  const bits = [];
  const cited = new Set();
  const fmtD = d => `${d > 0 ? '+' : '−'}${Math.abs(d).toFixed(1)}`;
  const citeRating = () => {
    const src = freshlyRated.map(k => r.factors[k]).find(f => f.source && !cited.has(f.source));
    if (!src) return '';
    cited.add(src.source);
    return ` — from ${link(src.source, 'published coverage')}`;
  };

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
      if (freshlyRated.includes(k)) {
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
    bits.push(`re-rated this week: ${freshlyRated.map(k =>
      `${FACTOR_LABEL[k]} ${r.factorScores[k].toFixed(1)}`).join(', ')}${citeRating()}`);
  }

  // Computed after every branch has claimed its citations, so a story that
  // already explains a line never repeats in the tail.
  const tail = () => {
    const extra = recent.filter(m => !cited.has(m.url)).slice(0, 2)
      .map(m => link(m.url, m.source));
    return extra.length ? ` · in the news: ${extra.join(' · ')}` : '';
  };

  if (isNew) {
    const graded = GRADED.map(k => r.factors?.[k]).find(f => f?.setBy === 'agent' && f.source);
    const src = graded ? ` · rated from ${link(graded.source, 'published coverage')}` : '';
    return `<b>New to the ten:</b> ${bits.length ? bits.join('; ') : 'first week with a score high enough'}${src}${tail()}`;
  }

  if (!bits.length) {
    const prevScore = previous?.scores?.[r.id];
    const drift = prevScore != null ? r.score - prevScore : null;
    let cause;
    if (drift != null && drift <= -0.1 && (r.stalenessDecay ?? 0) > 0) {
      cause = `freshness decay — nothing re-verified since ${esc(r.lastVerified ?? 'the dataset date')}; a score slides 0.2% a week until the rotation re-checks it`;
    } else if (drift != null && drift >= 0.1 && r.lastVerified && daysAgo(r.lastVerified) < RERATE_WINDOW_DAYS) {
      cause = `re-verified ${esc(r.lastVerified)}, which resets its freshness decay`;
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
