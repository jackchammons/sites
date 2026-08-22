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
