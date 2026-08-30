#!/usr/bin/env node
/*
 * Picks the research agent's task for today and emits GITHUB_OUTPUT lines:
 *   task=<type>
 *   brief<<EOF ... EOF     the task-specific half of the agent prompt
 *
 * Four task types rotate by UTC day, so a week covers every kind of upkeep
 * roughly twice. Passing a type as argv[2] forces it (used by manual
 * dispatches and the discovery backfill); "auto" rotates.
 *
 *   discovery   find Seattle pizzerias not yet on file
 *   locations   verify branches + website against the pizzeria's own site
 *   liveness    confirm entries are still open, with citations
 *   news        coverage the feed sweep missed + mention tags
 *   rating      rate unrated entries from their critical coverage, so
 *               discoveries can join the ranking
 *
 * The brief is task data; the fixed rules (run nothing, schema, validation)
 * live in research.yml so no task can drop them.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { locationWorklist } from '../src/locations.js';
import { isRated } from '../src/slice.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { restaurants } = JSON.parse(fs.readFileSync(path.join(root, 'data/restaurants.json'), 'utf8'));

const TYPES = ['discovery', 'locations', 'liveness', 'news', 'rating'];
/* Dispatch-only tasks: forceable for backfills, never part of the daily
 * rotation (their daily upkeep rides along on the rotating tasks). */
const DISPATCH_ONLY = ['social'];
const forced = (process.argv[2] || 'auto').toLowerCase();
const task = [...TYPES, ...DISPATCH_ONLY].includes(forced)
  ? forced
  : TYPES[Math.floor(Date.now() / 864e5) % TYPES.length];

const openField = restaurants.filter(r => r.status !== 'closed');

let brief = '';

if (task === 'discovery') {
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

  brief = `Your task: find pizzerias inside Seattle city limits that are not yet on file.

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
}

if (task === 'locations') {
  const rows = locationWorklist(openField).slice(0, 5).map(r => {
    const state = r.neighborhoodIsPlaceholder
      ? `PLACEHOLDER, stored as "${r.neighborhood}" — find every branch`
      : (r.locations ?? []).length
        ? `${r.locations.length} site(s) verified ${r.locationsVerified}`
        : `UNVERIFIED, stored as "${r.neighborhood}"`;
    return `- id: ${r.id} | ${r.name} | site: ${r.url ?? 'unknown, search for it'} | ${state}`;
  }).join('\n');
  brief = `Your task: verify where these pizzerias actually are. Verify these,
and only these:

${rows}

For each one, open the pizzeria's OWN website — its locations, visit or
contact page — and read off every branch it currently operates. If the
worklist says the site is unknown, search for the official site first;
never use a directory, aggregator, delivery app or review site as the
source, and never guess a domain from the name (several plausible ones
are wrong, and one lapsed domain now serves a gambling site). If you
cannot find an official page, omit that entry — a wrong address is worse
than a missing one.

Report every branch that is open now, with its homepage. Branches outside
the Puget Sound region do not belong. While you are on a pizzeria's own
site, also look for its Instagram link (usually in the header or footer)
and report it as a "links" record — the full profile URL exactly as the
site links it, never a handle you guessed from the name.

Write the "locations" section (plus "links" records for any Instagram you
saw). Budget: one or two page fetches per pizzeria plus at most 5 searches.`;
}

if (task === 'liveness') {
  const byNeed = [...openField].sort((a, b) => {
    // Openings change fastest; among the rest, an entry with no website is
    // both harder to confirm and likelier to be gone, so it goes first.
    const ord = r => r.status === 'opening' ? 0 : r.url ? 2 : 1;
    if (ord(a) !== ord(b)) return ord(a) - ord(b);
    return (Date.parse(a.statusChecked) || 0) - (Date.parse(b.statusChecked) || 0);
  });
  const rows = byNeed.slice(0, 6).map(r =>
    `- id: ${r.id} | ${r.name} | site: ${r.url ?? 'none on file'} | currently: ${r.status}${
      r.statusChecked ? ` (checked ${r.statusChecked})` : ' (never checked)'}`).join('\n');
  brief = `Your task: confirm whether these pizzerias are still operating.
Check these, and only these:

${rows}

For each: open its own website and search recent local coverage. Report a
"status" record for every one you checked, whatever you find — status
"open", "closed" or "opening", a one-sentence note, and the https source
you actually read. Confirming an entry is still open counts and advances
its check date. A closure claim needs real evidence: a news report, the
pizzeria's own announcement, or its site gone plus a corroborating
source. Review-site labels alone ("Yelp says closed") are a lead, not
evidence — chase the lead or leave the status as it is.
Budget: at most 12 searches and 2 fetches per entry.`;
}

if (task === 'rating') {
  // Mentions-first: entries with cited coverage on file are the ones a rating
  // can actually be grounded in, and Roma Roma arrives with three.
  // Only places actually open: a pizzeria that has not opened its doors has
  // no pies for anyone to have written about, and cannot rank anyway.
  // Mentions-first, then shuffled: an entry the agent skipped for want of
  // coverage should not monopolise the front of every future worklist while
  // others have never been attempted at all.
  const unrated = openField
    .filter(r => r.status !== 'opening' && !isRated(r))
    .map(r => [r, Math.random()])
    .sort((a, b) => ((b[0].mentions?.length ?? 0) - (a[0].mentions?.length ?? 0)) || (a[1] - b[1]))
    .map(([r]) => r)
    .slice(0, 6);
  const styleGroups = [...new Set(restaurants.map(r => r.styleGroup).filter(Boolean))].sort();
  brief = `Your task: rate pizzerias that are in the directory but not yet in
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

Skip any entry you cannot ground in at least one credible published
source about that specific place -- no rating is far better than an
invented one, and a skipped entry is a correct outcome. If your research
also surfaces solid coverage of another entry that is on file but
unrated, you may rate it too, under exactly the same standard -- one
proposal per pizzeria, at most 12 in total.

Budget: about 3 searches per entry, 18 total. Write the file and stop.`;
}

if (task === 'social') {
  // Dispatch-only backfill: fill in Instagram profiles, and best-available
  // links for entries with no website on file. Cheap lookups, so the worklist
  // runs bigger than the fact-verification tasks. Closed entries are excluded:
  // their sites die, and lapsed domains are traps (one pizzeria's old domain
  // now serves a gambling site).
  const worklist = openField
    .filter(r => !r.instagram || !r.url)
    .sort((a, b) => (a.url ? 1 : 0) - (b.url ? 1 : 0) || a.name.localeCompare(b.name))
    .slice(0, 15);
  brief = `Your task: record each pizzeria's web presence — its Instagram
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
- Omitting an entry you could not ground is correct. Every record needs
  the https "source" page where you saw the link.

Write the "links" section only. Budget: about 2 searches per entry,
25 in total.`;
}

if (task === 'news') {
  const ids = restaurants.map(r => `${r.id} = ${r.name}`).join('\n');
  brief = `Your task: find Seattle pizzeria news from the last 30 days that is
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
}

const out = process.env.GITHUB_OUTPUT;
const lines = `task=${task}\nbrief<<TASK_BRIEF_EOF\n${brief}\nTASK_BRIEF_EOF\n`;
if (out) fs.appendFileSync(out, lines);
else process.stdout.write(lines);
console.error(`task: ${task}`);
