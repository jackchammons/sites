#!/usr/bin/env node
/*
 * Picks the research agent's task for today and emits GITHUB_OUTPUT lines:
 *   task=<type>
 *   brief<<EOF ... EOF     the task-specific half of the agent prompt
 *
 * Six task types rotate. "auto" picks the one whose last successful pass is
 * oldest among those with work to do, so every kind of upkeep comes round in
 * turn. Passing a type as argv[2] forces it (used by manual dispatches and
 * the backfills).
 *
 *   discovery   find Seattle pizzerias not yet on file
 *   locations   verify branches + website against the pizzeria's own site
 *   liveness    confirm entries are still open, with citations
 *   news        coverage the feed sweep missed + mention tags
 *   rating      rate unrated entries from their critical coverage, so
 *               discoveries can join the ranking
 *   census      verify the candidates the permit-register seed turned up; it
 *               has work only while some are pending, so on most days the
 *               rotation passes over it and the other five take the week
 *
 * The brief is task data; the fixed rules (run nothing, schema, validation)
 * live in research.yml so no task can drop them.
 *
 * pickTask and buildTask are pure and exported for the tests; the file reads,
 * the git log and the output lines all happen in the CLI block at the end.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { locationWorklist } from '../src/locations.js';
import { isRated } from '../src/slice.js';
import { hostOf } from '../src/validate-research.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const TYPES = ['discovery', 'locations', 'liveness', 'news', 'rating', 'census'];
/* Dispatch-only tasks: forceable for backfills, never part of the daily
 * rotation (their daily upkeep rides along on the rotating tasks). */
export const DISPATCH_ONLY = ['social', 'facts', 'coverage', 'sources'];

const DAY = 864e5;
const daysSince = (iso, now) => iso ? (now - Date.parse(iso)) / DAY : Infinity;

/* The newest successful pass of each rotating type, from `git log` output
 * formatted as "<committer date>\t<subject>" per line. Only the subject the
 * research workflow writes counts: a commit that merely quotes one in its
 * body, or reverts one, is not a pass. A type with no pass on record is 0. */
export function lastSuccessFromLog(log) {
  const last = Object.fromEntries(TYPES.map(t => [t, 0]));
  for (const line of String(log).split('\n')) {
    const [when, subject = ''] = line.split('\t');
    const type = /^chore\(data\): research pass \((\w+)\)/.exec(subject)?.[1];
    if (Object.hasOwn(last, type ?? '')) last[type] = Math.max(last[type], Date.parse(when) || 0);
  }
  return last;
}

/* Returns null when the history cannot answer: git is missing, this is not a
 * repository, or the checkout is shallow (its log is truncated, so "no pass
 * on record" would be read off commits that were never fetched). */
function readLastSuccess() {
  try {
    const git = args => execFileSync('git', args,
      { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    if (git(['rev-parse', '--is-shallow-repository']).trim() !== 'false') return null;
    return lastSuccessFromLog(git(['log', '--format=%cI%x09%s', '--fixed-strings', '--grep', 'research pass (']));
  } catch { return null; }
}

/* Which task runs. A forced type is returned as given, empty worklist or not.
 * Auto mode walks the rotating types from the one whose last SUCCESSFUL pass
 * is oldest and takes the first that has work: a calendar rotation skipped a
 * type for five days whenever its day failed, and a manual dispatch never
 * counted. An empty worklist is passed over because a skipped run commits
 * nothing, so the same type would stay oldest and be picked every day. With
 * no usable history (lastSuccess null) the order starts from the UTC day
 * instead. discovery and news have no worklist and always qualify; census
 * qualifies only while the candidates queue holds something pending, which
 * is what lets a refreshed seed be worked without anyone dispatching it. */
export function pickTask(forced, lastSuccess, hasWork = () => true, dayIndex = Math.floor(Date.now() / DAY)) {
  if ([...TYPES, ...DISPATCH_ONLY].includes(forced)) return forced;
  const order = lastSuccess
    ? [...TYPES].sort((a, b) => (lastSuccess[a] ?? 0) - (lastSuccess[b] ?? 0) || TYPES.indexOf(a) - TYPES.indexOf(b))
    : TYPES.map((_, i) => TYPES[(dayIndex + i) % TYPES.length]);
  return order.find(hasWork) ?? order[0];
}

/* Each builder returns { brief, worklistSize }. worklistSize is null for a
 * task with no worklist and 0 when there is nothing to hand the agent. */
const BUILDERS = {};

BUILDERS.discovery = ({ restaurants }) => {
  const names = restaurants.map(r => r.name).sort().join('; ');

  // News-driven searching finds newsworthy places and dries up fast. Each run
  // also sweeps a handful of neighborhoods the file has no entry in, which is
  // where the long tail of never-in-the-news pizzerias lives. Random pick so
  // back-to-back backfill runs cover different ground.
  const HOODS = ['Ballard','Fremont','Wallingford','Green Lake','Greenwood','Crown Hill',
    'Magnolia','Queen Anne','Interbay','Belltown','Downtown','Pioneer Square',
    'Chinatown-International District','Capitol Hill','First Hill','Central District',
    'Madison Park','Madrona','Montlake','Eastlake','South Lake Union','University District',
    'Ravenna','Wedgwood','Maple Leaf','Northgate','Lake City','Beacon Hill','Columbia City',
    'Hillman City','Rainier Beach','Seward Park','Mount Baker','Georgetown','SoDo',
    'West Seattle Junction','Admiral','Alki','South Park','Delridge','Roosevelt','Phinney Ridge'];
  const covered = new Set();
  for (const r of restaurants) {
    if (r.neighborhood) covered.add(r.neighborhood.toLowerCase());
    for (const l of r.locations ?? []) covered.add(l.neighborhood.toLowerCase());
  }
  const sparse = HOODS.filter(h => !covered.has(h.toLowerCase()));
  const focus = sparse.sort(() => Math.random() - 0.5).slice(0, 5);

  const brief = `Your task: find pizzerias inside Seattle city limits that are not yet on file.

Already on file (do NOT propose any of these, under any spelling):
${names}

Search the way a local editor would: recent "new pizza Seattle" and
neighborhood-roundup coverage, Eater Seattle, The Stranger, Seattle Times,
neighborhood blogs. Also sweep these specific neighborhoods, where the
file currently has nothing — a "pizza <neighborhood> Seattle" search each.
Long-running neighborhood places that never make the news are exactly
what this is for:
${focus.map(h => `- ${h}`).join('\n')}

Delivery-only and pop-up operations count if they are genuinely operating
in Seattle. Skip national chains (Domino's, Pizza Hut, Papa John's, MOD,
Little Caesars): this is an index of Seattle's own pizzerias. For each
find, open its official website when it has one.

Report each as a "directory" entry: name, url (official site, only if you
opened it), neighborhood, style, status ("open", or "opening" if not yet
serving), note (one sentence on what it is), source (the page you read),
and address when published. At most 10 entries and 12 web searches. Fewer
real finds beat a padded list; an empty directory array is a valid result
if the city has nothing new.`;
  return { brief, worklistSize: null };
};

BUILDERS.locations = ({ openField, now }) => {
  const locList = locationWorklist(openField, now).slice(0, 5);
  const rows = locList.map(r => {
    // An address that arrived with a discovery is on file but nobody has read
    // it off the pizzeria's own site yet, so it carries no verification date.
    const state = r.neighborhoodIsPlaceholder
      ? `PLACEHOLDER, stored as "${r.neighborhood}" — find every branch`
      : (r.locations ?? []).length
        ? (r.locationsVerified
            ? `${r.locations.length} site(s) verified ${r.locationsVerified}`
            : 'address on file, never verified')
        : `UNVERIFIED, stored as "${r.neighborhood}"`;
    return `- id: ${r.id} | ${r.name} | site: ${r.url ?? 'unknown, search for it'} | ${state}`;
  }).join('\n');
  const brief = `Your task: verify where these pizzerias actually are. Verify these,
and only these:

${rows}

For each one, open the pizzeria's OWN website — its locations, visit or
contact page — and read off every branch it currently operates. If the
worklist says the site is unknown, search for the official site first;
never use a directory, aggregator, delivery app or review site as the
source, and never guess a domain from the name (several plausible ones
are wrong, and one lapsed domain now serves a gambling site). If you
cannot find an official page, report no address for that entry — a wrong
address is worse than a missing one — and report it as a
"locationsSkipped" record ({"id","note"}: what you searched and what you
found) so it is not redrawn next pass.

Report every branch that is open now, with its homepage. Branches outside
the Puget Sound region do not belong. While you are on a pizzeria's own
site, also look for its Instagram link (usually in the header or footer)
and report it as a "links" record — the full profile URL exactly as the
site links it, never a handle you guessed from the name.

While you are on the site, if its About page states the year it opened,
or its menu shows prices, also report a "facts" record ({"id","opened",
"priceIndex" (1 cheap slices .. 4 expensive),"source": the page that
states it}). Only what the page states; never infer a year.

Write the "locations" section, and a "locationsSkipped" record for every
worklist entry you could not verify (plus "links" and "facts" records
where you saw them). Budget: one or two page fetches per pizzeria plus at
most 5 searches.`;
  return { brief, worklistSize: locList.length };
};

BUILDERS.liveness = ({ restaurants, now }) => {
  /* Age of the last check first. The old tier-first sort let the one
   * "opening" entry and the three no-website entries take four of six slots
   * on every pass (16 of 24 slots over two weeks) while three top-ten entries
   * had never been checked. Openings and no-site entries still get priority,
   * but only once they are past a minimum revisit window; a closure recorded
   * within the last quarter gets one re-confirmation. */
  const MIN_REVISIT = 14, RECONFIRM_CLOSED = 90;
  const pool = restaurants.filter(r => r.status !== 'closed'
    || (daysSince(r.statusDetected, now) < RECONFIRM_CLOSED && r.statusChecked === r.statusDetected));
  const byNeed = [...pool].sort((a, b) => {
    const fresh = r => daysSince(r.statusChecked, now) < MIN_REVISIT ? 1 : 0;
    if (fresh(a) !== fresh(b)) return fresh(a) - fresh(b);
    const ord = r => r.status === 'closed' ? 0 : r.status === 'opening' ? 1 : r.url ? 3 : 2;
    if (!fresh(a) && ord(a) !== ord(b) && (ord(a) === 0 || ord(b) === 0)) return ord(a) - ord(b);
    const age = r => Date.parse(r.statusChecked) || 0;
    return age(a) - age(b) || ord(a) - ord(b);
  });
  const list = byNeed.slice(0, 6);
  const rows = list.map(r =>
    `- id: ${r.id} | ${r.name} | site: ${r.url ?? 'none on file'}${
      r.instagram ? ` | instagram: ${r.instagram}` : ''} | currently: ${r.status}${
      r.status === 'closed' ? ' (re-confirm the closure, or reopen it with evidence)' : ''}${
      r.statusChecked ? ` (checked ${r.statusChecked})` : ' (never checked)'}`).join('\n');
  const brief = `Your task: confirm whether these pizzerias are still operating.
Check these, and only these:

${rows}

For each: open its own website and search recent local coverage. Report a
"status" record for every one you checked, whatever you find — status
"open", "closed" or "opening", a one-sentence note, the https source you
actually read, and "date" (YYYY-MM-DD) ONLY when the source states when the
closure or opening took effect; omit it otherwise, never estimate it. Confirming an entry is still open counts and advances
its check date. A closure claim needs real evidence: a news report, the
pizzeria's own announcement, or its site gone plus a corroborating
source. Review-site labels alone ("Yelp says closed") are a lead, not
evidence — chase the lead or leave the status as it is. The pizzeria's
own announcement may be on its website, or on the Instagram or Facebook
account listed for it above. Cite a post there by a URL that carries the
account name — https://www.instagram.com/<handle>/p/<id>/, or the
profile itself — because a bare instagram.com/p/<id>/ link cannot be
tied to anyone and is refused, as is a post on an account that is not
listed above.
Budget: at most 12 searches and 2 fetches per entry.`;
  return { brief, worklistSize: list.length };
};

BUILDERS.rating = ({ restaurants, openField, now }) => {
  // Mentions-first: entries with cited coverage on file are the ones a rating
  // can actually be grounded in, and Roma Roma arrives with three.
  // Only places actually open: a pizzeria that has not opened its doors has
  // no pies for anyone to have written about, and cannot rank anyway.
  // Mentions-first, then shuffled: an entry the agent skipped for want of
  // coverage should not monopolise the front of every future worklist while
  // others have never been attempted at all.
  // Attempt memory: an entry the agent already searched and could not ground
  // (ratingAttempted) waits a quarter before it is drawn again. Never-attempted
  // entries with cited coverage go first, then the never-attempted rest, then
  // the oldest attempts.
  const RETRY_DAYS = 90;
  const unrated = openField
    .filter(r => r.status !== 'opening' && !isRated(r) && daysSince(r.ratingAttempted, now) >= RETRY_DAYS)
    .map(r => [r, Math.random()])
    .sort((a, b) => ((b[0].mentions?.length ?? 0) - (a[0].mentions?.length ?? 0))
      || ((Date.parse(a[0].ratingAttempted) || 0) - (Date.parse(b[0].ratingAttempted) || 0))
      || (a[1] - b[1]))
    .map(([r]) => r)
    .slice(0, 6);
  const styleGroups = [...new Set(restaurants.map(r => r.styleGroup).filter(Boolean))].sort();
  const brief = `Your task: rate pizzerias that are in the directory but not yet in
the ranking, so they can compete. Rate these, and only these:

${unrated.map(r => `- id: ${r.id} | ${r.name} | ${r.neighborhood ?? '?'} | site: ${r.url ?? 'unknown'}${r.mentions?.length ? ` | ${r.mentions.length} cited mention(s) on file` : ''}`).join('\n')}

For each one, read what has actually been published about it -- reviews,
neighborhood-blog writeups, substantive roundup entries in real outlets --
plus its own website and menu. Then propose a "factorRatings" entry
grounded in that coverage:

- craft: how good the pizza itself is by what critics and diners-in-print
  describe (dough, bake, toppings), 0-10 in 0.5 steps. A solid neighborhood
  slice shop is a 6, not a 9; reserve 8+ for places coverage treats as
  destinations.
- distinctiveness: does it own a lane in this city, 0-10 in 0.5 steps.
- criticScore: your read of its overall critical standing, 0-10.
- opened: the year it opened, when a source states it.
- priceIndex: 1 (cheap slices) to 4 (expensive), from its own menu.
- styleGroup: pick from the existing vocabulary when one fits --
  ${styleGroups.join('; ')} -- or coin a short new one only when nothing does.
- sources: 1-4 https URLs you actually read, strongest first.
- note: one or two sentences on what the coverage says, which is what the
  site will show as the rating's provenance.

At least one source must be published criticism -- a review, a roundup
entry, a news story -- not the pizzeria's own site, a review aggregator
or social media; those may be cited alongside but never alone.

For every review or story you cite, ALSO report it as a "mentions"
record (id, title, url, source, date, kind) so the coverage counts
toward the entry's record; coverage up to two years old counts.

Skip any entry you cannot ground in at least one credible published
source about that specific place -- no rating is far better than an
invented one, and a skipped entry is a correct outcome. Report each
skipped entry as a "ratingSkipped" record ({"id","note"}: what you
searched and what you found) so it is not redrawn tomorrow. If your
research also surfaces solid coverage of another entry that is on file
but unrated, you may rate it too, under exactly the same standard --
one proposal per pizzeria, at most 12 in total.

Budget: about 3 searches per entry, 18 total. Write the file and stop.`;
  return { brief, worklistSize: unrated.length };
};

BUILDERS.social = ({ openField, now }) => {
  // Dispatch-only backfill: fill in Instagram profiles, and best-available
  // links for entries with no website on file. Cheap lookups, so the worklist
  // runs bigger than the fact-verification tasks. Closed entries are excluded:
  // their sites die, and lapsed domains are traps (one pizzeria's old domain
  // now serves a gambling site).
  // Attempt memory: an entry the agent searched and could not complete
  // (socialAttempted) waits a quarter before it is drawn again. What is left
  // goes never-attempted first, then oldest attempt; entries with no website
  // lead each of those, and the order within a tie is shuffled. A shuffle
  // alone still handed every pass the entries with no findable handle, since
  // they are the ones that stay on the list.
  const SOCIAL_RETRY_DAYS = 90;
  const tried = r => Date.parse(r.socialAttempted) || 0;
  const worklist = openField
    .filter(r => (!r.instagram || !r.url) && daysSince(r.socialAttempted, now) >= SOCIAL_RETRY_DAYS)
    .sort(() => Math.random() - 0.5)
    .sort((a, b) => (tried(a) - tried(b)) || ((a.url ? 1 : 0) - (b.url ? 1 : 0)))
    .slice(0, 15);
  const brief = `Your task: record each pizzeria's web presence — its Instagram
profile, and an official website for any entry missing one. Cover these,
and only these:

${worklist.map(r => `- id: ${r.id} | ${r.name} | ${r.neighborhood ?? '?'} | site: ${r.url ?? 'MISSING — find one'} | instagram: ${r.instagram ? 'on file' : 'missing'}`).join('\n')}

For each, report a "links" record. The rules that matter:
- The best source for an Instagram link is the pizzeria's OWN website —
  the icon in its header or footer. Report the full profile URL exactly
  as linked.
- If the site is unknown or has no Instagram link, a search result or a
  news story that explicitly names the handle is acceptable. NEVER guess
  a handle from the name: plausible-looking handles are often fan pages,
  namesakes in other cities, or dead accounts. Instagram may block
  fetching profile pages directly; you do not need to open the profile,
  only to see it genuinely linked or named somewhere trustworthy.
- For an entry whose site is MISSING: search for its official site
  first. Never infer a domain from the name (a lapsed pizzeria domain
  now serves a gambling site — report only sites you actually opened).
  If it truly has no website, report its best canonical web presence as
  "website" — its Instagram, or an ordering page it links as its own.
- Every "links" record needs the https "source" page where you saw the
  link.
- Leaving a gap you could not ground is correct; filling it with a guess
  is not. For every entry above where something it is missing stayed
  missing, report a "socialSkipped" record ({"id","note"}: what you
  searched and what you found) so it is not redrawn next run. It may sit
  beside a "links" record for the part you did find.

Write the "links" section, and a "socialSkipped" record for every
worklist entry you could not complete. Budget: about 2 searches per
entry, 25 in total.`;
  return { brief, worklistSize: worklist.length };
};

BUILDERS.census = ({ restaurants, candidates }) => {
  // Drain the registry-seeded candidates queue. Candidates come from King
  // County food-permit data (and OSM when reachable) -- they are leads, and
  // every one either joins through the validated directory channel or gets a
  // recorded verdict so it stops re-entering worklists. The queue is empty
  // except after a seed refresh turns up a new permit, and an empty worklist
  // keeps the task out of the rotation until then.
  const worklist = candidates.filter(c => c.status === 'pending').slice(0, 10);
  const names = restaurants.map(r => r.name).sort().join('; ');
  const brief = `Your task: verify candidate pizzerias found in King County
food-business permit data, so the real ones can join the directory.
Verify these, and only these:

${worklist.map(c => `- "${c.name}" | ${c.address ?? 'address unknown'}${c.lastInspection ? ` | last health inspection ${c.lastInspection}` : ''}`).join('\n')}

Already on file (a candidate may be one of these under a permit-register
spelling — that is a "duplicate", not a new entry):
${names}

For EVERY candidate above, produce exactly one of:

1. It is real, currently operating, and pizza-forward (pizza is the core
   of the business, not one menu item): report a "directory" entry —
   name (the name it actually trades under, not the permit spelling),
   url (official site, only if you opened it; never guess a domain),
   neighborhood, style, status "open", note, source (an https page you
   read), address (from the worklist unless its own site corrects it).
2. It should NOT join: report a "candidateReview" record —
   {"name":"<EXACT name from the worklist above>",
    "verdict":"closed|chain|not-pizza|duplicate|unverifiable",
    "note":"<what you found>","source":"<https page, when you have one>"}.
   duplicate = same place as an entry on file or another candidate;
   not-pizza = a grocery counter, bar or restaurant where pizza is
   incidental; unverifiable = you could find no trace beyond the permit.

Candidates sharing a name are branches of one business (permits are
per-location): give that name exactly ONE record — a single directory
entry listing its main address, or a single verdict — and it covers all
its branches.

A permit proves a kitchen exists, not that it belongs in a pizza index —
be choosy on pizza-forward, and lean on each place's own site or real
local coverage, not review aggregators. Budget: 2-3 searches per
candidate, 25 in total.`;
  return { brief, worklistSize: worklist.length };
};

BUILDERS.facts = ({ openField, now }) => {
  // Dispatch-only backfill of the two plain facts reputation and value read.
  // Rated entries with no founding year first: they carry no reputation
  // score at all until one is on file.
  // Attempt memory: an entry already searched (factsAttempted) waits a
  // quarter before it is redrawn, and never-attempted entries go first.
  const FACTS_RETRY_DAYS = 90;
  const list = openField
    .filter(r => (r.opened == null || r.priceIndex == null) && daysSince(r.factsAttempted, now) >= FACTS_RETRY_DAYS)
    .sort((a, b) => (isRated(b) - isRated(a))
      || ((a.opened == null ? 0 : 1) - (b.opened == null ? 0 : 1))
      || ((Date.parse(a.factsAttempted) || 0) - (Date.parse(b.factsAttempted) || 0)))
    .slice(0, 12);
  const brief = `Your task: record two plain facts for these pizzerias -- the year each
opened and its price tier -- from pages that state them. Cover these,
and only these:

${list.map(r => `- id: ${r.id} | ${r.name} | site: ${r.url ?? 'unknown'} | missing: ${[r.opened == null ? 'opened' : null, r.priceIndex == null ? 'priceIndex' : null].filter(Boolean).join(', ')}`).join('\n')}

For each, open its own website (About, Our Story, History) and, failing
that, search local coverage. Report a "facts" record:
{"id","opened": <year>,"priceIndex": <1 cheap slices .. 4 expensive>,
 "source": "<https page that states it>"}. Include only the fields a page
actually states: an "established 2009" line, a "since 1979" in the
header, an opening story with a date. Never infer a year from a domain
registration, a review date or a photo. Price tier from its own menu:
1 = slices and pies under about $20, 2 = pies $20-28, 3 = $28-36, 4 = above.
For an entry where no page states either fact, report a "factsSkipped"
record ({"id","note"}: what you searched and found) so it is not redrawn
next run; omitting it silently puts it back at the front of the list.
Budget: about 2 searches per entry, 24 in total.`;
  return { brief, worklistSize: list.length };
};

BUILDERS.sources = ({ openField }) => {
  // Dispatch-only backfill of citations for the founding ratings, which were
  // set editorially with nothing on file. Values are never touched; the
  // agent attaches the published criticism it finds, and the directory shows
  // it beside the number. Highest-ranked first, since those are the ratings
  // a reader is most likely to argue with.
  const uncited = r => ['craft', 'distinctiveness', 'critical']
    .every(k => !(r.factors?.[k]?.sources?.length) && !r.factors?.[k]?.source);
  const list = openField
    .filter(r => isRated(r) && r.factors.craft.setBy === 'editorial' && uncited(r))
    .sort((a, b) => (b.factors.craft.value + b.factors.critical.value) - (a.factors.craft.value + a.factors.critical.value))
    .slice(0, 5);
  const brief = `Your task: find the published criticism behind ratings that are
already on file, so each carries its sources. Do NOT propose or change
any rating; report sources only. Cover these, and only these:

${list.map(r => `- id: ${r.id} | ${r.name} | ${r.neighborhood ?? '?'} | site: ${r.url ?? 'unknown'} | rated craft ${r.factors.craft.value}, distinctiveness ${r.factors.distinctiveness.value}, critical ${r.factors.critical.value}`).join('\n')}

For each, find one to four pieces of published writing about that
specific place -- a review, a substantive roundup entry, a news feature
-- in real outlets (The Stranger, Seattle Times, Seattle Met, Eater
Seattle, The Infatuation, neighborhood blogs with a byline). Report a
"factorSources" record:
{"id","sources":["<https URL you actually read>", ...],
 "note":"<one or two sentences on what the coverage says>"}.
At least one source must be published criticism, not the pizzeria's own
site, a review aggregator or social media. For every review or story
you cite, ALSO report it as a "mentions" record (id, title, url,
source, date, kind) when it is less than two years old. Omit an entry
you cannot ground in a single credible source; that is a correct
outcome. Budget: about 3 searches per entry, 15 in total.`;
  return { brief, worklistSize: list.length };
};

BUILDERS.coverage = ({ openField, now }) => {
  // Dispatch-only backfill of press mentions. The ranking reads a 24-month
  // window and the critical boost fades over 12; the daily news task looks
  // 30 days back, so the window can only fill from here.
  // Attempt memory: an entry already searched with nothing new to file
  // (coverageAttempted) waits a quarter before it is drawn again. Never
  // attempted first, then oldest attempt; within those, fewest mentions
  // first and rated entries before unrated. Sorted by mention count alone,
  // the entries nobody has written about are the head of every list.
  const COVERAGE_RETRY_DAYS = 90;
  const tried = r => Date.parse(r.coverageAttempted) || 0;
  const list = openField
    .filter(r => r.status !== 'opening' && daysSince(r.coverageAttempted, now) >= COVERAGE_RETRY_DAYS)
    .sort((a, b) => (tried(a) - tried(b))
      || ((a.mentions?.length ?? 0) - (b.mentions?.length ?? 0)) || (isRated(b) - isRated(a)))
    .slice(0, 10);
  // Each row says which stories are already on file, by outlet host and date:
  // a story filed twice is dropped at apply time, so an agent that cannot see
  // them would re-file the one story an entry has and never report it skipped.
  const onFile = r => {
    const have = [...(r.mentions ?? [])].sort((a, b) => (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0));
    if (!have.length) return 'no mentions on file';
    const shown = have.slice(0, 4).map(m => `${hostOf(m.url)} ${String(m.date).slice(0, 10)}`).join(', ');
    return `${have.length} mention(s) on file: ${shown}${have.length > 4 ? `, and ${have.length - 4} older` : ''}`;
  };
  const brief = `Your task: find published coverage from the last two years of these
pizzerias and connect it to their entries. Cover these, and only these:

${list.map(r => `- id: ${r.id} | ${r.name} | ${r.neighborhood ?? '?'} | ${onFile(r)}`).join('\n')}

For each, search for reviews, roundup entries, opening stories and
rankings in real outlets (The Infatuation, Seattle Times, Seattle Met,
Seattle Magazine, Eater Seattle, The Stranger, neighborhood news sites).
Report each story that is genuinely about that pizzeria as a "mentions"
record: {"id","title","url","source","date","kind": opening|closing|
ranking|mention}. The story must name the pizzeria; a citywide piece
that does not is not a mention. Dates up to 730 days old are accepted.
At most 4 mentions per entry. Do not report a story a row above already
lists by outlet and date.
For every entry above where you found no story to add, report a
"coverageSkipped" record ({"id","note"}: what you searched and what you
found) so it is not redrawn next run; omitting it silently puts it back
at the front of the list. Budget: 2 searches per entry, 20 in total.`;
  return { brief, worklistSize: list.length };
};

BUILDERS.news = ({ restaurants }) => {
  const ids = restaurants.map(r => `${r.id} = ${r.name}`).join('\n');
  const brief = `Your task: find Seattle pizzeria news from the last 30 days that is
not already covered, and connect coverage to the entries on file.

Read pizza/data/buzz.json first to see what the automated feed sweep
already found, so you do not repeat it. Then search for what it missed:
openings, closings, reviews and rankings of Seattle-area pizzerias.
Report stories in "news". For every story that is about an entry on
file — from this id list:

${ids}

— also add a "mentions" record tying the story to that id.

Budget: at most 12 web searches in total. A short honest file is a good
result on a quiet day.`;
  return { brief, worklistSize: null };
};

/* The brief and worklist size for one task type, from the dataset alone.
 * `candidates` is the census queue; only the census task reads it. */
export function buildTask(type, restaurants, { now = Date.now(), candidates = [] } = {}) {
  const openField = restaurants.filter(r => r.status !== 'closed');
  return BUILDERS[type]({ restaurants, openField, now, candidates });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1])) {
  const { restaurants } = JSON.parse(fs.readFileSync(path.join(root, 'data/restaurants.json'), 'utf8'));
  const candPath = path.join(root, 'data/candidates.json');
  const candidates = fs.existsSync(candPath) ? JSON.parse(fs.readFileSync(candPath, 'utf8')).candidates : [];
  const forced = (process.argv[2] || 'auto').toLowerCase();

  // Built at most once per type: two of the worklists are shuffled, so the
  // one the picker saw must be the one the brief prints.
  const built = new Map();
  const build = type => {
    if (!built.has(type)) built.set(type, buildTask(type, restaurants, { candidates }));
    return built.get(type);
  };
  const hasWork = type => {
    const some = build(type).worklistSize !== 0;
    if (!some) console.error(`passing over ${type}: empty worklist`);
    return some;
  };
  // The history only matters to auto mode, so a forced type does not read it.
  const isForced = [...TYPES, ...DISPATCH_ONLY].includes(forced);
  const task = pickTask(forced, isForced ? null : readLastSuccess(), hasWork);
  const { brief, worklistSize } = build(task);

  /* An empty worklist is a run that would pay for nothing, so the workflow
   * skips the agent step when skip=true. Only a forced type can get here with
   * one: auto mode has already passed over every type with nothing to do. */
  const skip = worklistSize === 0;
  const out = process.env.GITHUB_OUTPUT;
  const lines = `task=${task}\nskip=${skip}\nbrief<<TASK_BRIEF_EOF\n${brief}\nTASK_BRIEF_EOF\n`;
  if (out) fs.appendFileSync(out, lines);
  else process.stdout.write(lines);
  console.error(`task: ${task}${skip ? ' (empty worklist — skipping the agent)' : worklistSize != null ? ` (${worklistSize} in worklist)` : ''}`);
}
