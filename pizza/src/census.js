/*
 * The census: pure helpers for the candidates queue.
 *
 * Candidates are pizzeria leads seeded from registries (King County
 * food-establishment permits, OpenStreetMap) rather than news coverage — the
 * top of the discovery funnel, never entries themselves. A candidate joins the
 * directory only after the census research task verifies it through the same
 * validated `directory` channel every discovery uses.
 *
 * Pure functions of data, no I/O: the fetch script and apply step do the
 * reading and writing.
 */

/* National chains are excluded from the index by policy — this is an index of
 * Seattle's own pizzerias. The seed still records them (status "chain") so the
 * site can publish how many were excluded rather than looking blind to them.
 * Regional chains already on file (Zeeks, Pagliacci, MOD-sized locals) are a
 * different thing: anything matching an existing entry is "promoted", and this
 * list is only consulted for names the dataset does not know. */
export const NATIONAL_CHAINS = [
  /\bdomino'?s\b/i, /\bpizza hut\b/i, /\bpapa john'?s?\b/i, /\blittle caesars?\b/i,
  /\bmod pizza\b/i, /\bpapa murphy'?s?\b/i, /\bblaze pizza\b/i, /\bround table\b/i,
  /\bsbarro\b/i, /\bgodfather'?s\b/i, /\bchuck e\.? cheese\b/i, /\bmarco'?s pizza\b/i
];

export const isNationalChain = name => NATIONAL_CHAINS.some(rx => rx.test(String(name)));

/* Name normalisation, aligned with the research validator's dedup rules and
 * widened for permit-register noise (ALL CAPS, "LLC", "#12" branch suffixes). */
export const normName = n => String(n).toLowerCase()
  .replace(/['’]/g, '')
  .replace(/^\s*#?\s*\d+\s+/, '')
  .replace(/\s*#\s*\d+\s*$/g, '')
  .replace(/\b(llc|inc|corp|co)\b\.?/g, '')
  .replace(/\b(pizza company|pizza co|pizzeria|pizza|restaurant|ristorante|cafe|the)\b/g, '')
  .replace(/[^a-z0-9]+/g, ' ').trim();

/* One key per physical place: name + street number, so "PAGLIACCI PIZZA #8"
 * at 4003 Stone Way and the same name downtown stay distinct candidates. */
export const candidateKey = (name, address) => {
  const num = String(address ?? '').match(/\d+/)?.[0] ?? '';
  return `${normName(name)}|${num}`;
};

/* Does a candidate match an entry already on file? Name match is enough when
 * the normalised names collide; permits and OSM both write raw names, so an
 * address tiebreak would reject true matches more often than it caught forks. */
export function matchEntry(candidate, restaurants) {
  const key = normName(candidate.name);
  if (!key) return null;
  return restaurants.find(r => normName(r.name) === key) ?? null;
}

/*
 * Merge freshly fetched candidates into the stored queue.
 * - a candidate already in the queue keeps its status and resolution
 *   (a rejected ghost must not resurrect on every refresh);
 * - anything matching a dataset entry is recorded as promoted;
 * - national chains are recorded as chain, excluded by policy;
 * - everything else joins as pending.
 * Returns the new candidates array (sorted for a stable diff).
 */
export function mergeCandidates(existing, incoming, restaurants) {
  const byKey = new Map(existing.map(c => [c.key, c]));
  for (const inc of incoming) {
    const key = candidateKey(inc.name, inc.address);
    const prev = byKey.get(key);
    if (prev) {
      // Refresh the facts, keep the resolution.
      byKey.set(key, { ...prev, ...inc, key, status: prev.status,
        ...(prev.note ? { note: prev.note } : {}),
        sources: [...new Set([...(prev.sources ?? []), ...(inc.sources ?? [])])] });
      continue;
    }
    const matched = matchEntry(inc, restaurants);
    const status = matched ? 'promoted' : isNationalChain(inc.name) ? 'chain' : 'pending';
    byKey.set(key, { key, ...inc, status, ...(matched ? { matchedId: matched.id } : {}) });
  }
  // A stored candidate that later gains a dataset entry (via news-driven
  // discovery) is promoted here too — reconciliation is idempotent.
  for (const [key, c] of byKey) {
    if (c.status !== 'pending') continue;
    const matched = matchEntry(c, restaurants);
    if (matched) byKey.set(key, { ...c, status: 'promoted', matchedId: matched.id });
  }
  return [...byKey.values()].sort((a, b) =>
    a.status.localeCompare(b.status) || a.name.localeCompare(b.name));
}

/* The published coverage numbers. */
export function coverageStats(candidates) {
  const by = s => candidates.filter(c => c.status === s).length;
  return { pending: by('pending'), promoted: by('promoted'),
           chains: by('chain'), rejected: by('rejected') };
}
