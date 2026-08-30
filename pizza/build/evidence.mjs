import { esc } from './html.mjs';

/* ---- why an entry moved ----
 * The weekly delta says THAT a card moved; this says what the data shows
 * behind it. Factor diffs come from the previous week's snapshot (older
 * snapshots lack them, so the section degrades to citations); citations come
 * from the entry's recent press mentions and, for a first appearance, the
 * sources its rating was graded from. */
export const FACTOR_LABEL = { reputation: 'reputation', critical: 'critical reception',
  craft: 'craft', distinctiveness: 'distinctiveness', value: 'value' };

export function evidenceFor(r, previous, now) {
  const moved = r.previousRank != null && r.previousRank !== r.rank;
  const isNew = r.previousRank == null;
  if (!moved && !isNew) return '';

  const bits = [];
  const pf = previous?.factors?.[r.id];
  if (pf) {
    const deltas = Object.keys(FACTOR_LABEL)
      .map(k => [k, r.factorScores[k] - (pf[k] ?? r.factorScores[k])])
      .filter(([, d]) => Math.abs(d) >= 0.1)
      .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
      .slice(0, 3);
    for (const [k, d] of deltas) bits.push(`${FACTOR_LABEL[k]} ${d > 0 ? '+' : '−'}${Math.abs(d).toFixed(1)}`);
    if (pf.penalty != null && Math.abs(r.penaltyApplied - pf.penalty) >= 0.1) {
      const d = r.penaltyApplied - pf.penalty;
      bits.push(`friction ${d > 0 ? 'grew' : 'eased'} ${Math.abs(d).toFixed(1)}`);
    }
  }

  const cutoffMs = now.getTime() - 21 * 864e5;
  const links = (r.mentions ?? [])
    .filter(m => Date.parse(m.date) > cutoffMs)
    .slice(0, 2)
    .map(m => `<a href="${esc(m.url)}" target="_blank" rel="noopener nofollow">${esc(m.source)}</a>`);

  if (isNew) {
    const graded = ['craft', 'distinctiveness']
      .map(k => r.factors?.[k])
      .find(f => f?.setBy === 'agent' && f.source);
    const src = graded
      ? ` · rated from <a href="${esc(graded.source)}" target="_blank" rel="noopener nofollow">published coverage</a>`
      : '';
    return `<b>New to the ten:</b> ${bits.length ? bits.join(', ') : 'first week with a score high enough'}${src}${links.length ? ' · in the news: ' + links.join(' · ') : ''}`;
  }

  if (!bits.length) {
    const prevScore = previous?.scores?.[r.id];
    const drift = prevScore != null ? r.score - prevScore : null;
    const cause = drift != null && Math.abs(drift) >= 0.3
      ? `score ${drift > 0 ? 'up' : 'down'} ${Math.abs(drift).toFixed(1)}`
      : `no change of its own — entries around it ${r.previousRank > r.rank ? 'fell' : 'rose'}`;
    return `<b>Why it moved:</b> ${cause}${links.length ? ' — ' + links.join(' · ') : ''}`;
  }
  return `<b>Why it moved:</b> ${bits.join(', ')}${links.length ? ' — ' + links.join(' · ') : ''}`;
}
