/*
 * Where a pizzeria actually is.
 *
 * Two fields, deliberately separate:
 *   neighborhood  editorial, unverified, one string. What the site has always
 *                 shown. For three entries it was never a neighborhood at all
 *                 ("Multiple locations", "Citywide"), which is what
 *                 neighborhoodIsPlaceholder marks.
 *   locations[]   verified, written only by apply-research.mjs from an agent
 *                 pass that read the pizzeria's own site. Each entry carries a
 *                 neighborhood and a street address.
 *
 * Addresses are a legitimate agent job in a way crowd ratings are not: they are
 * published by the business itself, on a page that serves to anyone, and they
 * are checkable. Ratings sit behind a 403 and pillar scores are editorial.
 */

/* Distinct neighborhoods, in the order the pizzeria lists them. Branches are not
 * neighborhoods: Pagliacci runs 24 shops across 19 areas, three of them in
 * Bellevue and two in Ballard, so counting sites would print "Ballard" twice and
 * overstate how spread out it is. */
export function locationAreas(r) {
  const seen = new Set();
  const areas = [];
  for (const s of r.locations ?? []) {
    const key = s.neighborhood.trim().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    areas.push(s.neighborhood.trim());
  }
  return areas;
}

/* The label under a name. Names one or two real areas before falling back to a
 * count, because a bare "24 locations" is only as useful as the "Citywide" it
 * replaced -- and "Ballard + 23 more" is worse still, since it implies Ballard
 * is the flagship when it is simply first on their list. */
export function locationLabel(r) {
  const areas = locationAreas(r);
  if (areas.length === 1) return areas[0];
  if (areas.length === 2) return `${areas[0]} and ${areas[1]}`;
  if (areas.length > 2) return `${areas[0]}, ${areas[1]} + ${areas.length - 2} more`;
  // Nothing verified yet. A placeholder is not a place, so say what it means.
  if (r.neighborhoodIsPlaceholder) return 'Several locations';
  return r.neighborhood;
}

/* Long form for the card body: every distinct neighborhood, in listed order. */
export function locationList(r) {
  const areas = locationAreas(r);
  return areas.length ? areas : null;
}

/* "19 neighborhoods · 24 locations", or just the count when they agree. */
export function locationCount(r) {
  const sites = (r.locations ?? []).length;
  const areas = locationAreas(r).length;
  if (!sites) return null;
  if (sites === areas) return `${sites} location${sites === 1 ? '' : 's'}`;
  return `${areas} neighborhoods · ${sites} locations`;
}

/* True when this entry has been confirmed against the pizzeria's own site. */
export function locationsAreVerified(r) {
  return Boolean(r.locationsVerified && (r.locations ?? []).length);
}

/* How long an entry rests after a locations pass has looked at it, whether
 * the look verified it (locationsVerified) or found no official page to read
 * (locationsAttempted). */
export const LOCATION_REVISIT_DAYS = 30;

/* The locations worklist: entries worth a pass today, most overdue first.
 *
 * Left out: an "opening" entry with no location on file (there is no address
 * to publish until it opens), and anything looked at within the revisit
 * window. An entry nobody can verify would otherwise be redrawn on every pass
 * and hold the head of the list while the pass verified nothing.
 *
 * Order: placeholders first (they are actively wrong on the page), then
 * entries never looked at, then by the date of the last look, oldest first.
 * Entries never looked at tie on that date, so they go by oldest status check
 * and then id; file order would pin the same few to the front.
 * Date.parse(null) is NaN, which would poison a comparison, so it is coerced
 * to 0 and sorts first on its own. */
export function locationWorklist(restaurants, nowMs = Date.now()) {
  const at = v => Date.parse(v) || 0;
  const lastLook = r => Math.max(at(r.locationsVerified), at(r.locationsAttempted));
  const cutoff = nowMs - LOCATION_REVISIT_DAYS * 864e5;
  return restaurants
    .filter(r => !(r.status === 'opening' && !(r.locations ?? []).length))
    .filter(r => lastLook(r) <= cutoff)
    .sort((a, b) => {
      const ap = a.neighborhoodIsPlaceholder ? 0 : 1;
      const bp = b.neighborhoodIsPlaceholder ? 0 : 1;
      if (ap !== bp) return ap - bp;
      return lastLook(a) - lastLook(b)
        || at(a.statusChecked) - at(b.statusChecked)
        || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    });
}

/* One key per front door, so the same address written two ways compares
 * equal: "1415 NW 70th Street, Seattle, WA 98117" and "1415 N.W. 70th St.,
 * Seattle WA 98117". The street line is folded (case, punctuation, the usual
 * abbreviations, any suite or unit) and the ZIP is kept, so the same street
 * number in another town stays distinct. */
const STREET_WORDS = { street: 'st', avenue: 'ave', boulevard: 'blvd', road: 'rd', drive: 'dr',
  place: 'pl', lane: 'ln', court: 'ct', highway: 'hwy', parkway: 'pkwy',
  north: 'n', south: 's', east: 'e', west: 'w',
  northeast: 'ne', northwest: 'nw', southeast: 'se', southwest: 'sw' };
export function streetKey(address) {
  const full = String(address ?? '');
  const street = full.split(',')[0].toLowerCase()
    .replace(/[.'’]/g, '')
    .replace(/\s+(suite|ste|unit|apt|#)\s*[\w-]+.*$/, '')
    .replace(/[^a-z0-9]+/g, ' ').trim()
    .split(' ').map(w => STREET_WORDS[w] ?? w).join(' ');
  const zip = full.match(/\b\d{5}\b(?!.*\b\d{5}\b)/)?.[0] ?? '';
  return `${street}|${zip}`;
}
