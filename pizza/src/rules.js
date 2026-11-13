/*
 * The numbers the research worklists run on, in one place.
 *
 * next-task.mjs draws its worklists with them and the page prints them, so a
 * candidate's or an unrated entry's "what happens next" on the site is the
 * rule the automation actually follows, not a description of it.
 */
import { missingFacts } from './schema.js';

/* How many entries one pass of each task takes. `serves` has no worklist: its
 * number is how many places one pass of the sweep may file. */
export const PER_PASS = {
  rating: 6, rerate: 7, locations: 5, liveness: 6, census: 10, facts: 12, coverage: 10, social: 15, sources: 5,
  serves: 12
};

/* How long an entry rests after a task looked at it and could not resolve it,
 * before that task draws it again. The rerate task rests an entry on the
 * rating task's stamp and for the rating task's time. Locations has its own,
 * LOCATION_REVISIT_DAYS in locations.js, because a verified set rests the
 * same way. */
export const RETRY_DAYS = { rating: 90, facts: 90, coverage: 90, social: 90 };

/* Liveness rests nothing: it sorts by the age of the last check. An entry
 * checked within LIVENESS_REVISIT_DAYS goes behind every one that was not,
 * and a closure is checked once more if it was recorded within
 * CLOSURE_RECONFIRM_DAYS and has not been looked at since. */
export const LIVENESS_REVISIT_DAYS = 14;
export const CLOSURE_RECONFIRM_DAYS = 90;

/* The types the automatic rotation picks between, oldest successful pass
 * first; a type with nothing on its worklist is passed over. */
export const ROTATION = ['discovery', 'locations', 'liveness', 'news', 'rating', 'census', 'facts'];

/* The neighbourhoods a sweep walks. The discovery task searches the ones no
 * entry on file is in; the serves task takes them in this order, a few a
 * pass, and starts again when it reaches the end. The order is part of the
 * rule: the cursor in data/candidates.json is a position in this list, so a
 * name is added at the end and never moved. */
export const NEIGHBORHOODS = ['Ballard', 'Fremont', 'Wallingford', 'Green Lake', 'Greenwood', 'Crown Hill',
  'Magnolia', 'Queen Anne', 'Interbay', 'Belltown', 'Downtown', 'Pioneer Square',
  'Chinatown-International District', 'Capitol Hill', 'First Hill', 'Central District',
  'Madison Park', 'Madrona', 'Montlake', 'Eastlake', 'South Lake Union', 'University District',
  'Ravenna', 'Wedgwood', 'Maple Leaf', 'Northgate', 'Lake City', 'Beacon Hill', 'Columbia City',
  'Hillman City', 'Rainier Beach', 'Seward Park', 'Mount Baker', 'Georgetown', 'SoDo',
  'West Seattle Junction', 'Admiral', 'Alki', 'South Park', 'Delridge', 'Roosevelt', 'Phinney Ridge'];

/* The serves task: places that serve pizza and are not pizzerias, swept
 * neighbourhood by neighbourhood. One pass takes this many neighbourhoods and
 * may spend this many searches on each. */
export const SERVES_HOODS_PER_PASS = 4;
export const SERVES_SEARCHES_PER_HOOD = 3;
/* How many such places a discovery pass may file when it meets them. It is
 * not sent looking for any. */
export const SERVES_IN_PASSING = 5;

/* One pass of the sweep: the neighbourhoods it takes, and where the next pass
 * starts. `cursor` is the position stored in data/candidates.json as
 * `servesCursor`; anything that is not a position in the list (no cursor yet,
 * a list that has since been shortened) starts from the top. The brief
 * builder reads `hoods` and the apply step stores `next`, so the two cannot
 * disagree about how far a pass went. A pass that files nothing has still
 * looked, and moves the cursor like any other. */
export function servesSweep(cursor) {
  const n = NEIGHBORHOODS.length;
  const start = Number.isInteger(cursor) && cursor >= 0 && cursor < n ? cursor : 0;
  const take = Math.min(SERVES_HOODS_PER_PASS, n);
  return {
    start,
    hoods: Array.from({ length: take }, (_, i) => NEIGHBORHOODS[(start + i) % n]),
    next: (start + take) % n
  };
}

/* Coordinates for the candidates the page lists. The geocoder looks up every
 * restaurant address first, with no limit; candidates then get what is left
 * of a publish run that has a site to build.
 *
 *   lookupsPerRun  requests to the geocoding service one run may spend on
 *                  candidates. A candidate started under the limit is
 *                  finished, and one address can take two requests.
 *   secondsPerRun  the time one run may spend on them, whichever limit is
 *                  reached first: a slow service must not hold the deploy.
 *   stopAfterFailures  this many failed requests in a row end the run's
 *                  work on candidates: the service is not answering, and
 *                  asking it sixty more times helps nobody.
 *   retryDays      how long a candidate rests after its address would not
 *                  resolve. A restaurant address is retried on every run,
 *                  which is fine for a handful and not for a queue. */
export const CANDIDATE_GEOCODE = { lookupsPerRun: 60, secondsPerRun: 90, stopAfterFailures: 3, retryDays: 30 };

/* What an attempt that recorded a day and no list looked for: the founding
 * year and the price tier. Those two were the whole of the task when it
 * stamped attempts that way, so such a stamp says nothing about the other
 * three facts. */
export const FACTS_SOUGHT_UNLISTED = ['opened', 'priceIndex'];

/* The facts the last attempt on an entry looked for and did not find: the
 * list it recorded, or the two the task asked for when it recorded none. An
 * entry never attempted has looked for nothing. */
export function factsSought(r) {
  if (!r?.factsAttempted) return [];
  return r.factsSought?.length ? r.factsSought : FACTS_SOUGHT_UNLISTED;
}

/* The facts an entry lacks that no attempt inside the rest period has looked
 * for. An entry is on the facts worklist while this is not empty.
 *
 * The rest is per fact, not per entry. An entry searched last week for its
 * founding year is still owed a look for its style and its signature pie,
 * which that search never asked about; once an attempt has covered every
 * fact it lacks, it rests like any other. */
export function factsOutstanding(r, nowMs = Date.now()) {
  const missing = missingFacts(r);
  const resting = nowMs - Date.parse(r?.factsAttempted) < RETRY_DAYS.facts * 864e5;
  if (!resting) return missing;
  const sought = factsSought(r);
  return missing.filter(k => !sought.includes(k));
}
