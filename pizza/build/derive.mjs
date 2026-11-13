/* Everything computed from the loaded data before any HTML renders: the
 * registry of places, the scored field, the published split, weekly
 * baselines, style brackets, and the per-card movement evidence. Pure.
 *
 * The registry (src/registry.js) is built first and is the one list of
 * places: the entries scored here are its entries, and every section that
 * lists or counts places reads it from the context instead of the two data
 * files. */
import { rank, splitTiers, isoWeek, isoWeekKey, ALGORITHM } from '../src/slice.js';
import { buildRegistry } from '../src/registry.js';
import { evidenceFor } from './evidence.mjs';

export function deriveContext(ctx) {
  const { dataset, history } = ctx;
  const now = ctx.now ?? new Date();
  const weekKey = isoWeekKey(now);
  const week = isoWeek(now);

  // Movement markers compare against the most recent snapshot from an EARLIER
  // week, so a mid-week rebuild never flattens the markers to "no change".
  const previous = [...history.snapshots].reverse().find(s => s.weekKey !== weekKey);
  const baseline = previous ? previous.ranks : {};

  const registry = buildRegistry(dataset.restaurants, ctx.candidates);
  const scoredAll = rank({ ...dataset, restaurants: registry.entries }, { now });
  const { top, bench: restRaw } = splitTiers(scoredAll, 10);
  const ranked = top.map(r => ({ ...r, previousRank: baseline[r.id] ?? null }));
  const restScored = restRaw;   // ranks 11+, shown in the directory with scores

  const evidenceMap = {};
  for (const r of ranked) {
    const html = evidenceFor(r, previous, now, ALGORITHM);
    if (html) { evidenceMap[r.id] = html; r.evidenceHtml = html; }
  }

  /* Weekly spotlight: rotates through the top ten by ISO week. */
  const spotlight = ranked[week % ranked.length];

  const entriesById = new Map(registry.entries.map(r => [r.id, r]));

  /* ---- Style brackets ---- */
  const allScored = [...ranked, ...restScored];
  const byStyle = new Map();
  for (const r of allScored) {
    if (!r.styleGroup) continue;
    // A closed pizzeria cannot be the best of anything tonight. It keeps its
    // score in the directory, but the brackets are a recommendation.
    if (r.status && r.status !== 'open') continue;
    if (!byStyle.has(r.styleGroup)) byStyle.set(r.styleGroup, []);
    byStyle.get(r.styleGroup).push(r);
  }
  const brackets = [...byStyle.entries()]
    .map(([group, list]) => ({ group, list: list.sort((a, b) => b.score - a.score) }))
    .sort((a, b) => b.list[0].score - a.list[0].score);

  return { ...ctx, now, week, weekKey, previous, baseline, registry,
           scoredAll, ranked, restScored, allScored, evidenceMap, spotlight,
           entriesById, brackets };
}
