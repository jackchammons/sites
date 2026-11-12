/*
 * The numbers the research worklists run on, in one place.
 *
 * next-task.mjs draws its worklists with them and the page prints them, so a
 * candidate's or an unrated entry's "what happens next" on the site is the
 * rule the automation actually follows, not a description of it.
 */

/* How many entries one pass of each task takes. */
export const PER_PASS = {
  rating: 6, locations: 5, liveness: 6, census: 10, facts: 12, coverage: 10, social: 15
};

/* How long an entry rests after a task looked at it and could not resolve it,
 * before that task draws it again. Locations has its own, LOCATION_REVISIT_DAYS
 * in locations.js, because a verified set rests the same way. */
export const RETRY_DAYS = { rating: 90, facts: 90, coverage: 90, social: 90 };

/* The types the automatic rotation picks between, oldest successful pass
 * first; a type with nothing on its worklist is passed over. */
export const ROTATION = ['discovery', 'locations', 'liveness', 'news', 'rating', 'census'];
