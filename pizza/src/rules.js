/*
 * The numbers the research worklists run on, in one place.
 *
 * next-task.mjs draws its worklists with them and the page prints them, so a
 * candidate's or an unrated entry's "what happens next" on the site is the
 * rule the automation actually follows, not a description of it.
 */
import { missingFacts } from './schema.js';

/* How many entries one pass of each task takes. */
export const PER_PASS = {
  rating: 6, rerate: 7, locations: 5, liveness: 6, census: 10, facts: 12, coverage: 10, social: 15, sources: 5
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

/* What a facts attempt stamped with no list of fields looked for. The task
 * asked for the founding year and the price tier and nothing else until it
 * took on the whole descriptive record, and it recorded only the day. */
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
