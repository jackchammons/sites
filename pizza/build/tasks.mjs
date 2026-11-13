/* What each research task does, as the methodology prints it: one entry per
 * task, keyed by the name the pipeline knows it by.
 *
 * The methodology draws a table row for every member of ROTATION from here,
 * and names every other task in one line. A task that joins the rotation with
 * no `row` here stops the build (taskRows throws), because the alternative is
 * a table with a blank line in it. Every number comes from the modules the
 * worklists are drawn with; a row never states one of its own.
 *
 * `summary` completes "name (summary)" in the line about tasks outside the
 * rotation. `unit` is what a pass counts; a task with none has no worklist.
 * The row's cells answer, in order: what it looks at, what it may write, what
 * it does when it finds nothing, and when it looks at the same thing again.
 * `done` is for a task whose work can run out: given the dataset, it says
 * whether anything is left for the task to draw. */
import { PER_PASS, RETRY_DAYS, ROTATION, LIVENESS_REVISIT_DAYS, CLOSURE_RECONFIRM_DAYS } from '../src/rules.js';
import { LOCATION_REVISIT_DAYS } from '../src/locations.js';
import { isLaunchRating } from '../src/slice.js';

/* The sources and rerate tasks both draw from the ratings isLaunchRating
 * names, and nothing adds to those, so once none is on file neither task has
 * anything to do again. */
const noneLeft = dataset => !dataset.restaurants.some(isLaunchRating);

export const TASKS = {
  discovery: {
    summary: 'pizzerias that are not on file',
    unit: null,
    row: {
      looks: 'Local coverage, and neighbourhoods with no entry on file, for Seattle pizzerias the index does not have.',
      writes: 'New entries, open or about to open, each with the page it was read on. A name or an address already on file is refused.',
      nothing: 'Files nothing. An empty pass is a valid result.',
      again: 'Every time its turn comes round: it always has work.'
    }
  },
  locations: {
    summary: 'addresses, read from each pizzeria\'s own site',
    unit: 'entries',
    row: {
      looks: 'Each pizzeria\'s own website, for every branch it runs. Entries with a permit address that is not on file go first, then the longest unchecked.',
      writes: 'The full set of addresses, which replaces the set on file, and the official site. In passing: an Instagram link, a founding year or a price tier the site states.',
      nothing: 'Reports no address rather than guess one, and records the attempt.',
      again: `${LOCATION_REVISIT_DAYS} days after any look, whether it verified the addresses or not.`
    }
  },
  liveness: {
    summary: 'whether each entry is still open',
    unit: 'entries',
    row: {
      looks: 'Whether an entry is still open, from its own site and recent local coverage. The longest unchecked go first.',
      writes: 'A status (open, opening or closed) with its source, and the date it took effect only when the source states one. A closure needs a news report or the pizzeria\'s own announcement.',
      nothing: 'Leaves the status as it is. Confirming that a place is still open counts as a check.',
      again: `Oldest check first, and an entry checked in the last ${LIVENESS_REVISIT_DAYS} days goes behind the rest. A closure recorded in the last ${CLOSURE_RECONFIRM_DAYS} days is confirmed once more.`
    }
  },
  news: {
    summary: 'stories the feed sweep missed',
    unit: null,
    row: {
      looks: 'Recent Seattle pizza stories that the feed sweep did not catch.',
      writes: 'Stories for the buzz list, and a press mention on each entry a story is about.',
      nothing: 'Files nothing. A short pass is a good result on a quiet day.',
      again: 'Every time its turn comes round: it always has work.'
    }
  },
  rating: {
    summary: 'ratings for entries that have none',
    unit: 'entries',
    row: {
      looks: 'Published criticism of open entries that have no rating. Entries with press on file go first, then the ones no pass has looked at.',
      writes: 'A rating: craft, distinctiveness and a critic base, with the sources it read, at least one of them published criticism. With it, a founding year, price tier or style group where none is on file, and a press mention for each story cited.',
      nothing: 'Leaves the entry unrated and records the attempt with a note.',
      again: `${RETRY_DAYS.rating} days after an attempt that found nothing. An entry it has rated is never drawn again.`
    }
  },
  census: {
    summary: 'candidates from the permit register',
    unit: 'candidates',
    row: {
      looks: 'Pending candidates from the permit register: is each one real, open and pizza-forward?',
      writes: 'A new directory entry, or a verdict with a note: national chain, not pizza-forward, closed, could not be verified, or a duplicate of an entry on file.',
      nothing: 'Records the candidate as one it could not verify.',
      again: 'Only while a candidate is pending: a permit new to the register, or one inspected again after it was set aside.'
    }
  },
  social: {
    summary: 'Instagram and website links',
    unit: 'entries',
    row: {
      looks: 'Open entries with no Instagram profile or no website on file.',
      writes: 'An Instagram profile it saw linked or named, and a website for an entry that has none.',
      nothing: 'Leaves the gap and records the attempt with a note.',
      again: `${RETRY_DAYS.social} days after an attempt that left a gap.`
    }
  },
  facts: {
    summary: 'the descriptive record: year opened, price tier, style, signature pie',
    unit: 'entries',
    row: {
      looks: 'Open entries missing part of their descriptive record: the year opened, the price tier, the style, the style group or the pie the place is known for. Rated entries go first, then the ones missing most.',
      writes: 'Any of those facts, each from a page that states it and only where none is on file. A style or a signature pie has to come from the pizzeria\'s own site or from published coverage.',
      nothing: 'Leaves the gap, and records which facts it looked for.',
      again: `${RETRY_DAYS.facts} days after an attempt, fact by fact: a gap that attempt did not look for is drawn again sooner.`
    }
  },
  coverage: {
    summary: 'older press',
    unit: 'entries',
    row: {
      looks: 'Older press about open entries, the ones with the fewest stories on file first.',
      writes: 'A press mention for each story that names the pizzeria.',
      nothing: 'Records the attempt with a note.',
      again: `${RETRY_DAYS.coverage} days after an attempt that found nothing new.`
    }
  },
  serves: { summary: 'places that serve pizza and are not pizzerias', unit: null },
  sources: { summary: 'the published criticism behind a rating on file', unit: 'entries', done: noneLeft },
  rerate: { summary: 'a rating on file, read afresh from published criticism', unit: 'entries', done: noneLeft }
};

/* How much one pass takes, in words. */
const perPass = name => {
  const { unit } = TASKS[name];
  if (!unit) return 'No worklist: a set budget of searches.';
  if (PER_PASS[name] == null) throw new Error(`rules.js has no PER_PASS.${name}; the methodology cannot say how many ${unit} a pass takes`);
  return `Up to ${PER_PASS[name]} ${unit}.`;
};

/* The rotation's rows, in rotation order. */
export function taskRows() {
  return ROTATION.map(name => {
    const row = TASKS[name]?.row;
    if (!row) throw new Error(`"${name}" is in ROTATION but build/tasks.mjs has no row for it`);
    return { name, perPass: perPass(name), ...row };
  });
}

/* Every task this file knows that the rotation never picks. */
export const outsideRotation = () => Object.keys(TASKS).filter(name => !ROTATION.includes(name));
