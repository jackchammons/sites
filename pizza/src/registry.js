/*
 * The registry: the one list of every place the index knows of.
 *
 * Two files hold places. data/restaurants.json has the pizzerias on file;
 * data/candidates.json has leads that have not joined them, and the ones a
 * pass looked at and set aside. A reader does not care which file a place is
 * in, and a page that lists "closed" from one file in one section and from
 * the other file in another reads as two databases. So every section that
 * lists or counts places reads this list and nothing else: the directory's
 * categories, the map's pins, the radar, and every number of pizzerias the
 * page prints.
 *
 * Each place is in exactly one category. The rules for an entry are isRated
 * (slice.js) and its status; the rule for a candidate is candidateStanding
 * (census.js). Neither is restated here. A candidate that is an entry on
 * file, or another permit of one, is not a place of its own: the entry is the
 * place, and such candidates are only counted (`tied`).
 *
 * Pure: no DOM, no Node APIs.
 */
import { isRated } from './slice.js';
import { RETRY_DAYS } from './rules.js';
import { candidateStanding, candidateKey } from './census.js';
import { isSeattleAddress, inPugetSound } from './bounds.js';

/* The categories, in the order the page lists them.
 *
 *   ranked        on file, open and rated: it competes
 *   unrated       on file and open, with no rating yet
 *   opening       on file and not open yet
 *   closed        on file and closed, or a candidate a census pass found closed
 *   pending       a candidate waiting for a census pass
 *   chain         a candidate that is a national chain
 *   not-pizza     a candidate where pizza is incidental
 *   unverifiable  a candidate no pass could confirm
 *   set-aside     a candidate set aside with no verdict on record; nothing in
 *                 the queue is in this state today, and the category exists so
 *                 that one which is still has exactly one place to be listed
 */
export const CATEGORIES = ['ranked', 'unrated', 'opening', 'closed', 'pending', 'chain', 'not-pizza', 'unverifiable', 'set-aside'];

/* What a reader sees before touching anything: the ranking. */
export const DEFAULT_OPEN = ['ranked'];

/* How long a closure stays "recent": six months. */
export const RECENT_CLOSE_DAYS = 183;

const DAY = 864e5;
const day = v => typeof v === 'string' && Number.isFinite(Date.parse(v)) ? v.slice(0, 10) : null;
const byName = (a, b) => String(a.name).localeCompare(String(b.name), 'en');

const entryCategory = r =>
  r.status === 'closed' ? 'closed'
  : r.status === 'opening' ? 'opening'
  : isRated(r) ? 'ranked' : 'unrated';

/* A candidate's category is its standing; a state this module has no name for
 * is listed as set aside rather than dropped. */
const STATE_CATEGORY = { pending: 'pending', chain: 'chain', closed: 'closed',
  'not-pizza': 'not-pizza', unverifiable: 'unverifiable', rejected: 'set-aside' };
const TIED = ['listed', 'duplicate'];

/* A token for a URL fragment and an element id: the place's key with anything
 * that cannot go in either folded to a hyphen. */
const slug = s => String(s).normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

function entryPlace(r) {
  const category = entryCategory(r);
  const closed = category === 'closed';
  const looked = category === 'unrated' ? day(r.ratingAttempted) : null;
  return {
    key: r.id, kind: 'entry', name: r.name, category, entry: r,
    locations: r.locations ?? [],
    dates: {
      /* The day it closed as the source states it, and the day a pass
       * recorded the closure. Only the first is ever a "since". */
      closed: closed ? day(r.statusDate) : null,
      reported: closed ? day(r.statusDetected) : null,
      /* The day a rating pass looked and found nothing, and the first day it
       * may be drawn again. */
      looked,
      eligible: looked ? new Date(Date.parse(looked) + RETRY_DAYS.rating * DAY).toISOString().slice(0, 10) : null
    }
  };
}

function candidatePlace(c, at, key) {
  const category = STATE_CATEGORY[at.state] ?? 'set-aside';
  return {
    key, kind: 'candidate', name: c.name, category, candidate: c, at,
    locations: [{ address: c.address ?? null, neighborhood: c.neighborhood ?? null, lat: c.lat ?? null, lon: c.lon ?? null }],
    dates: {
      /* The register does not say when a place closed. What is on file is the
       * day the pass found it closed, which is a report and not a "since". */
      closed: null,
      reported: category === 'closed' ? day(at.resolvedDate) : null,
      inspected: day(at.lastInspection),
      resolved: day(at.resolvedDate)
    }
  };
}

/*
 * Build the list.
 *
 *   places      every place, in category order and, within a category, in the
 *               order the page lists it (ranked entries are in dataset order
 *               here: their order is the score's, which this module does not
 *               compute)
 *   byCategory  the same places, per category; every category has a list
 *   counts      its length, per category
 *   entries     the entries on file, as the dataset holds them: the set every
 *               scoring path starts from
 *   tied        how many candidates are an entry on file or a branch of one
 *   queued      how many candidates the queue holds in all
 *
 * A place carries `key` (the entry's id, or the candidate's key), `anchor`
 * (the key as a fragment-safe token, unique in the list), `kind`, `name`,
 * `category`, the `entry` or the `candidate` itself (a candidate with `at`,
 * its standing), `locations` and `dates`.
 */
export function buildRegistry(restaurants, candidates) {
  const entries = Array.isArray(restaurants) ? restaurants : [];
  const queue = Array.isArray(candidates) ? candidates : [];
  const byCategory = Object.fromEntries(CATEGORIES.map(k => [k, []]));

  for (const r of entries) {
    const p = entryPlace(r);
    byCategory[p.category].push(p);
  }

  let tied = 0;
  const keys = new Set(entries.map(r => r.id));
  for (const c of queue) {
    const at = candidateStanding(c, queue);
    if (TIED.includes(at.state)) { tied++; continue; }
    // A candidate the seed wrote has a key; one that does not gets the key
    // the seed would have given it. Two that collide are told apart by number.
    const base = c.key ?? candidateKey(c.name, c.address);
    let key = base;
    for (let n = 2; keys.has(key); n++) key = `${base}#${n}`;
    keys.add(key);
    const p = candidatePlace(c, at, key);
    byCategory[p.category].push(p);
  }

  /* The order inside a category. Unrated: the ones no pass has looked at,
   * press on file first (the order the rating task draws in), then the ones
   * a pass found nothing for, soonest due first. Closed: the entries, then
   * the places known only from the queue. Pending: the order the census task
   * takes them in. */
  const press = p => p.entry.mentions?.length ?? 0;
  byCategory.unrated.sort((a, b) =>
    (a.dates.looked != null) - (b.dates.looked != null)
    || (a.dates.looked == null
      ? press(b) - press(a)
      : (a.dates.eligible > b.dates.eligible) - (a.dates.eligible < b.dates.eligible))
    || byName(a, b));
  byCategory.opening.sort(byName);
  byCategory.closed = [
    ...byCategory.closed.filter(p => p.kind === 'entry'),
    ...byCategory.closed.filter(p => p.kind === 'candidate').sort(byName)
  ];
  byCategory.pending.sort((a, b) => (a.at.queuePosition ?? Infinity) - (b.at.queuePosition ?? Infinity));
  for (const k of ['chain', 'not-pizza', 'unverifiable', 'set-aside']) byCategory[k].sort(byName);

  const places = CATEGORIES.flatMap(k => byCategory[k]);
  const anchors = new Set();
  for (const p of places) {
    const base = `${p.kind === 'entry' ? 'r' : 'c'}-${slug(p.key) || 'place'}`;
    let anchor = base;
    for (let n = 2; anchors.has(anchor); n++) anchor = `${base}-${n}`;
    anchors.add(anchor);
    p.anchor = anchor;
  }

  return {
    places, byCategory,
    counts: Object.fromEntries(CATEGORIES.map(k => [k, byCategory[k].length])),
    entries, tied, queued: queue.length
  };
}

/* Where a place goes on the map: its Seattle addresses that have coordinates.
 * The index is about Seattle, so a chain's suburban branch is listed and not
 * plotted, and a point outside the region is a bad geocode and is left off. */
export function mapPoints(place) {
  return (place?.locations ?? []).filter(l =>
    inPugetSound(l.lat, l.lon) && (l.address == null || isSeattleAddress(l.address)));
}

/* The closed category's recent part: closed in the last RECENT_CLOSE_DAYS by
 * the date the source stated, or, when none was stated, found closed in that
 * time. Newest first. */
export function recentlyClosed(registry, now = new Date(), days = RECENT_CLOSE_DAYS) {
  const when = p => Date.parse(p.dates.closed ?? p.dates.reported ?? '');
  return registry.byCategory.closed
    .filter(p => now - when(p) < days * DAY)
    .sort((a, b) => when(b) - when(a));
}
