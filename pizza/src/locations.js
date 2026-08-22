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

/* The label shown under a name. One site reads as its neighborhood; several
 * read as the flagship plus a count, since "Ballard, Capitol Hill, Georgetown,
 * Fremont, U District" does not fit a card and does not help anyone. */
export function locationLabel(r) {
  const sites = r.locations ?? [];
  if (sites.length === 1) return sites[0].neighborhood;
  if (sites.length > 1) {
    const first = sites[0].neighborhood;
    return `${first} + ${sites.length - 1} more`;
  }
  // Nothing verified yet. A placeholder is not a place, so say what it means.
  if (r.neighborhoodIsPlaceholder) return 'Several locations';
  return r.neighborhood;
}

/* Long form for the card body: every neighborhood, in order, flagship first. */
export function locationList(r) {
  const sites = r.locations ?? [];
  if (!sites.length) return null;
  return sites.map(s => s.neighborhood);
}

/* True when this entry has been confirmed against the pizzeria's own site. */
export function locationsAreVerified(r) {
  return Boolean(r.locationsVerified && (r.locations ?? []).length);
}

/* Worklist order: placeholders first (they are actively wrong on the page),
 * then never-verified, then stalest. Date.parse(null) is NaN, which would
 * poison a comparison, so it is coerced to 0 and sorts first on its own. */
export function locationWorklist(restaurants) {
  return [...restaurants].sort((a, b) => {
    const ap = a.neighborhoodIsPlaceholder ? 0 : 1;
    const bp = b.neighborhoodIsPlaceholder ? 0 : 1;
    if (ap !== bp) return ap - bp;
    const av = (a.locations ?? []).length ? 1 : 0;
    const bv = (b.locations ?? []).length ? 1 : 0;
    if (av !== bv) return av - bv;
    return (Date.parse(a.locationsVerified) || 0) - (Date.parse(b.locationsVerified) || 0);
  });
}
