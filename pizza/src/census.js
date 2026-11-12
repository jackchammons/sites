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
import { streetKey } from './locations.js';
import { PER_PASS } from './rules.js';

/* How long a permit stays a lead after its last inspection. The seed drops a
 * business the register has not inspected in this long as likely gone, and a
 * branch lead from a stored candidate is held to the same age. */
export const INSPECTION_CUTOFF_MONTHS = 30;

/* The register files every permit under a free-text city, and Seattle is
 * spelt several ways in it: "SEATTLE", "Seattle", "seattle", "Seattle," and
 * "WEST SEATTLE". Any case, with trailing punctuation or spaces, is the city;
 * a longer name that merely contains it ("Seattle tacoma") is not. */
export const isSeattleCity = city => /^\s*(west\s+)?seattle[\s.,;]*$/i.test(String(city ?? ''));

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

/* The one name normalisation: the research validator's directory dedup and
 * the candidates queue both read it, so a name that is "already on file" to
 * one is to the other. Accents fold to their plain letters, and permit-register
 * noise (ALL CAPS, "LLC", "#12" branch suffixes) and the generic words a
 * pizzeria's name is padded with drop out. */
export const normName = n => String(n).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
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

/* An entry's name without a trailing parenthetical. "A Pizza Mart (First
 * Hill)" is filed under the branch it was found at, and the register lists
 * every branch under the plain "A Pizza Mart". */
const baseName = name => String(name).replace(/\s*\([^()]*\)\s*$/, '');

/* Does a candidate match an entry already on file? Name match is enough when
 * the normalised names collide; permits and OSM both write raw names, so an
 * address tiebreak would reject true matches more often than it caught forks.
 * An entry's full name is tried first, so an entry filed under the plain name
 * wins over one that only shares it once its parenthetical is set aside. */
export function matchEntry(candidate, restaurants) {
  const key = normName(candidate.name);
  if (!key) return null;
  return restaurants.find(r => normName(r.name) === key)
    ?? restaurants.find(r => normName(baseName(r.name)) === key)
    ?? null;
}

/* The verdicts a later inspection reopens. Each says the census found no
 * pizzeria to list there: it had closed, it left no trace, or pizza was not
 * its business. An inspection dated after that finding is the register saying
 * a kitchen is working under the permit, and the finding has not seen it. A
 * chain is out by policy whatever it is doing, and a duplicate is a branch of
 * an entry on file, which reaches the locations worklist as a lead, so
 * neither of those is reopened by anything. */
export const REOPENING_VERDICTS = ['closed', 'unverifiable', 'not-pizza'];

/* Is the inspection on a candidate's row evidence newer than the verdict it
 * carries? A verdict with no date on it cannot be shown to be older, and
 * stays. */
export function inspectedSinceVerdict(candidate) {
  return candidate?.status === 'rejected' && REOPENING_VERDICTS.includes(candidate.verdict)
    && Date.parse(candidate.lastInspection) > Date.parse(candidate.resolvedDate);
}

/* A reopened candidate goes back to pending with what was found before kept
 * as previousVerdict, so the next census pass starts from the earlier finding
 * and the row never reads as both pending and judged. */
const reopened = candidate => {
  const { verdict, note, resolvedDate, resolutionSource, ...rest } = candidate;
  return { ...rest, status: 'pending',
    previousVerdict: { verdict, ...(note ? { note } : {}), resolvedDate,
      ...(resolutionSource ? { source: resolutionSource } : {}) } };
};

/*
 * Merge freshly fetched candidates into the stored queue.
 * - a candidate already in the queue keeps its status and resolution
 *   (a rejected ghost must not resurrect on every refresh), unless the
 *   register has inspected it since a verdict that an inspection reopens;
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
      const kept = { ...prev, ...inc, key, status: prev.status,
        ...(prev.note ? { note: prev.note } : {}),
        sources: [...new Set([...(prev.sources ?? []), ...(inc.sources ?? [])])] };
      // The newest inspection on the row is this refresh's when it brought
      // one, and otherwise the one already on file.
      byKey.set(key, inspectedSinceVerdict(kept) ? reopened(kept) : kept);
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

/*
 * Where one candidate stands and what would change that, as data: the page
 * turns it into words, and the numbers it prints are the ones the queue runs
 * on.
 *
 *   state         'listed'      it is the entry `matchedId`
 *                 'pending'     waiting for a census pass
 *                 'chain'       a national chain, left out by policy
 *                 'duplicate'   another permit or branch of the entry `matchedId`
 *                 'closed', 'unverifiable', 'not-pizza'   the census verdict
 *                 'rejected'    set aside with no verdict on record
 *   matchedId     the entry it is, or is a branch of; otherwise null
 *   resolvedDate  the day the verdict or the match was recorded, or null
 *   lastInspection  the register's newest inspection on file for it, or null
 *   reopens       true when a later inspection returns it to the queue
 *   reopensAfter  the day such an inspection has to postdate, or null
 *   inspectedSince  true when the inspection on file already does: the next
 *                 seed refresh that still finds the permit returns it
 *   previousVerdict  for a candidate that came back, what was found before
 *                 ({ verdict, note, resolvedDate, source }), or null
 *   queuePosition, censusPass, perPass
 *                 for a pending candidate when `queue` (the whole candidates
 *                 list) is given: its place among the pending, counting from
 *                 1, the census pass that reaches it (1 is the next) and how
 *                 many a pass takes. Null otherwise.
 */
export function candidateStanding(candidate, queue = null) {
  const c = candidate ?? {};
  const state = c.status === 'promoted' ? 'listed'
    : c.status === 'pending' || c.status === 'chain' ? c.status
    : [...REOPENING_VERDICTS, 'duplicate'].includes(c.verdict) ? c.verdict
    : 'rejected';
  const reopens = c.status === 'rejected' && REOPENING_VERDICTS.includes(c.verdict) && c.resolvedDate != null;
  const at = state === 'pending' && queue
    ? queue.filter(q => q.status === 'pending').findIndex(q => q === candidate || (q.key != null && q.key === c.key)) + 1
    : 0;
  return {
    state,
    matchedId: state === 'listed' || state === 'duplicate' ? c.matchedId ?? null : null,
    resolvedDate: state === 'pending' ? null : c.resolvedDate ?? null,
    lastInspection: c.lastInspection ?? null,
    reopens,
    reopensAfter: reopens ? c.resolvedDate : null,
    inspectedSince: inspectedSinceVerdict(c),
    previousVerdict: state === 'pending' ? c.previousVerdict ?? null : null,
    queuePosition: at || null,
    censusPass: at ? Math.ceil(at / PER_PASS.census) : null,
    perPass: at ? PER_PASS.census : null
  };
}

/* The keys one door answers to when a permit address is held against an
 * entry's locations: its street key, its street line alone, and its street
 * number with its ZIP. The register and a pizzeria's own site write one door
 * differently in ways the street key does not fold: another ZIP for the same
 * street line ("10003 Rainier Ave S" under 98118 and 98178), "6711 M L King
 * Jr Way S" for "6711 Martin Luther King Jr Way S", "9622 16th Ave Sw, A"
 * for "9622-A 16th Ave SW". Both sides belong to one business and the permit
 * is in Seattle, so a looser match costs nothing: two branches sharing a
 * street line, or a number and a ZIP, do not occur, and a false lead costs a
 * look every month. */
const doorKeys = address => {
  const full = String(address ?? '');
  const key = streetKey(full);
  const line = key.split('|')[0];
  const num = full.match(/^\s*(\d+)/)?.[1];
  const zip = key.split('|')[1];
  return [key, ...(line ? [`${line}|`] : []), ...(num && zip ? [`#${num}|${zip}`] : [])];
};

/*
 * Branch leads: per entry id, the Seattle addresses the permit register lists
 * under that business and the entry does not have.
 *
 * A candidate names its entry through matchedId, whether it was promoted on a
 * name match or rejected as a duplicate. Its address is a lead when the
 * permit was inspected within the seed's cutoff and no location on file is at
 * that door. A lead is never a location: a duplicate permit can be a
 * commissary kitchen or an old registration, so the locations task confirms
 * each against the pizzeria's own pages before it is reported. A closed entry
 * has no leads, since nothing is verified for it any more.
 *
 * Returns a Map of id -> addresses, in the order the queue holds them.
 */
export function branchLeads(candidates, restaurants, nowMs = Date.now()) {
  const cutoff = nowMs - INSPECTION_CUTOFF_MONTHS * 30 * 864e5;
  const byId = new Map(restaurants.map(r => [r.id, r]));
  const doors = new Map();
  const leads = new Map();
  for (const c of candidates ?? []) {
    const r = byId.get(c?.matchedId);
    if (!r || r.status === 'closed') continue;
    if (c.status !== 'promoted' && c.status !== 'rejected') continue;
    if (typeof c.address !== 'string' || !/, Seattle, WA\b/.test(c.address)) continue;
    if (!(Date.parse(c.lastInspection) >= cutoff)) continue;
    if (!doors.has(r.id)) {
      doors.set(r.id, new Set((r.locations ?? []).flatMap(l => doorKeys(l.address))));
    }
    const have = doors.get(r.id);
    const keys = doorKeys(c.address);
    if (keys.some(k => have.has(k))) continue;
    // Two permits at one door are one lead.
    for (const k of keys) have.add(k);
    leads.set(r.id, [...(leads.get(r.id) ?? []), c.address]);
  }
  return leads;
}

/* The published coverage numbers. */
export function coverageStats(candidates) {
  const by = s => candidates.filter(c => c.status === s).length;
  return { pending: by('pending'), promoted: by('promoted'),
           chains: by('chain'), rejected: by('rejected') };
}
