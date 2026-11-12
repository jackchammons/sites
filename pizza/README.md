# The Seattle Pizza Index

A static site that tracks Seattle's pizzerias: a ranked top ten, a full directory with a
map, openings and closings, and the local press. Published at
**https://sites.jackhammons.com/pizza/**, rebuilt daily by GitHub Actions.

Every number on the page is computed at build time from `data/restaurants.json` by the
scoring module in `src/slice.js`. Each ranked card opens to show every input behind its
score, read against the rest of the rated field; the browser runs only the map.

## The score (SLICE v2.3)

```
SLICE = ( Σ factorᵢ ÷ 10 × weightᵢ − min(friction, 6.0) ) × (1 − decay)
```

| Factor | Weight | How it is set |
|---|---|---|
| Reputation | 24% | Computed: longevity and press coverage; counted only where it does not lower the score (see below) |
| Critical reception | 24% | Graded critic base, lifted up to +1.5 by press the research pass files |
| Craft | 18% | Graded |
| Distinctiveness | 18% | Graded |
| Value | 16% | Computed: (craft + critical) / 2 × price-tier multiplier |

Every weight, cap and constant the methodology section prints is an export of
`src/slice.js`, interpolated at build time (`build/page.mjs`), so the page cannot describe
a formula the code has left. A new constant in a formula is exported and printed, never
typed into the copy.

**Graded factors** (craft, distinctiveness, critical) are set by the research agent from
published coverage and stored per entry with provenance (`setBy`, `source`, `sources`,
`note`, `date`): the one to four sources the agent read and the day the pass applied the
rating. `validate-research.js` refuses a rating with no published criticism behind it (a
review, a roundup or a news story; the pizzeria's own site, an aggregator or a social post
may be cited beside one, never alone), and a rating the agent has set is never overwritten
by a script. The directory prints each rating with its sources.

**Reputation** has two components, each 0 to 1: longevity (log curve on years open,
weight 3) and coverage (press mentions in 24 months / 6, weight 1). They combine as the
best weighted mean over any prefix of the components sorted best-first, so adding
evidence can lift the factor but never lower it. With both on file that mean is the
higher of the two: the lower one would only pull it down, so it is left out.

The same rule holds one level up, in `scoreOne()`: reputation carries its 24% only when
it is measured **and** at or above the weighted mean of the entry's other four factors.
With no component on file, or with a reputation below the other four, its weight is
dropped and the other four share it in proportion to their own weights. The score is
therefore monotone in evidence: a new press mention or founding year can raise it and
never lower it (`test/slice.test.mjs` checks this for fixtures and for every rated entry
in the dataset). `reputationDetail.use` records which case applied
(`counted`, `unmeasured`, `lowers`) and each card says so.

**Value** multiplies the mean of craft and critical by the price tier: $ ×1.20, $$ ×1.05,
$$$ ×0.90, $$$$ ×0.75, no tier on file ×1.00.

**Friction** subtracts a cost per attribute flag (`data/attributes.json` holds the labels
and costs), capped at 6.0.

**Freshness decay** takes 0.2% per week since the entry was last verified, capped at 6%
after 30 weeks. "Verified" is the newest of a liveness check, a locations check or the
rating date (`verifiedDate()` in `src/slice.js`).

Ties break on critical reception, then craft, then alphabetically (`byRank` in
`src/slice.js`). The ten highest-scoring entries with `status: "open"` are published;
everything else rated is listed in the directory with its score.

## Layout

```
pizza/
  data/restaurants.json   the dataset: every pizzeria on file, with provenance
  data/attributes.json    attribute registry (label + frictionCost per flag), edited by hand
  data/history.json       weekly snapshots, stamped with the algorithm version
  data/buzz.json          press sweep; rewritten only when the list of stories changes
  data/candidates.json    registry-seeded leads for the census task; `updated` is the last
                          refresh that changed a candidate, `checked` the last that ran
  data/research.json      the research agent's last validated proposals
  src/slice.js            the scoring module (run by the build and the tests; nothing scores in the browser)
  src/render.js           card rendering and the per-card explanation
  src/app.js              directory rows, chart tooltip, card toggles; loads the map on demand
  src/locations.js        location labels and the locations worklist
  src/schema.js           every key an entry carries, in order, with its empty value; the normaliser
  src/rules.js            worklist sizes, rest periods and the rotation; the page prints them
  src/validate-research.js   the research-file gate, as a pure function
  src/check-dataset.js    the dataset lint, as a pure function
  src/census.js           candidate matching, branch leads, reopened verdicts and coverage numbers
  build/                  the page, section by section (pure modules)
  build/tasks.mjs         what each research task does, as the methodology prints it
  scripts/build.mjs       composes build/ into OUT_DIR (default ../dist/pizza)
  scripts/verify.mjs      the deploy gate: unit tests plus checks on the output (below)
  scripts/check-dataset.mjs, verify-research.mjs, apply-research.mjs
  scripts/next-task.mjs   picks and briefs the research agent's daily task
  scripts/fetch-buzz.mjs, fetch-candidates.mjs, geocode.mjs
  test/                   node --test suites for every pure module
```

No dependencies, no lockfile. Leaflet is vendored under `src/vendor/`.

## Working on it

```bash
node --test pizza/test/*.test.mjs        # unit tests
node pizza/scripts/check-dataset.mjs     # lint the dataset
node pizza/scripts/check-dataset.mjs --normalize   # put every entry into the schema's shape, then lint
cd pizza && OUT_DIR=/tmp/out node scripts/build.mjs && OUT_DIR=/tmp/out node scripts/verify.mjs
node scripts/build-all.mjs --only pizza  # or through the orchestrator -> dist/pizza/
```

With `OUT_DIR` unset, build and verify use `../dist/pizza/`, where the orchestrator puts
the site. The build refuses to clear a target that holds the site's source or anything that
is not a previous build, so `OUT_DIR=.` cannot delete the source tree.

A local build never writes the weekly snapshot; only `publish.yml` sets `SNAPSHOT=1`.
The record chart does not wait for it: the current week's column is always the build's own
standings.

`verify.mjs` fails the deploy when: a unit test fails; `app.js` does not parse, imports a
file that was not emitted, or looks up an id the page lacks; the emitted `leaflet.js`
differs from `src/vendor/leaflet.js`; the inline data or the chart's `data-standings` is
not JSON; an in-page link (nav included) points at an id that is not there; the
methodology is outside `<main>`; the chart's newest column, the cards and the head of
`rankings.json` disagree; an entry is missing from the visible markup or the directory;
the visible text shows `undefined`, `NaN` or `[object Object]`; or two adjacent open
entries in `rankings.json` are out of score order. Text quoted from the data files
(headlines, notes) is exempt from the `undefined` check, so a headline cannot stop a
deploy. It also fails when the page's own copy describes a rating as set by hand, dates
one to the index's launch or calls anything seeded (`editorial`, `founding entr…`,
`at launch`, `launched in`, `index launched`, `seeded`), with the same exemption for
quoted data, and when the pinned map's rules below have come apart. The record, radar,
buzz and candidates sections are optional: each renders nothing when it has nothing to
show, and the nav is built from the sections that rendered.

The candidates section has checks of its own. It must be on the page, and in the nav,
exactly when the dataset holds an open or opening entry with no rating or
`data/candidates.json` holds a candidate. Every group must list as many rows as the data
has for it, print that number, and name each of its entries; the rows of the first half
must add up to the unrated entries and the rows of the second half plus the duplicates
count to the whole queue, both counted from the files. A census note and a permit name
are quoted data like a headline, so `candidates.json` is among the files the `undefined`
and wording checks exempt.

## What the page explains about itself

Three parts of the page describe the pipeline, and each prints the pipeline's own
numbers instead of repeating them.

**Candidates** (`build/sections/candidates.mjs`, after the directory) lists what the
index knows of and does not rank. *On file, not yet ranked* is every open or opening
entry with no rating, grouped by why: waiting for a rating pass, looked at with no
published criticism found (the day, the agent's note, and the day it is due again,
`ratingAttempted` plus `RETRY_DAYS.rating`), or not open yet. *Not on file* is the
candidates queue grouped by `candidateStanding()` in `src/census.js`: pending, in the
order the census task takes them and with the pass that reaches each; then national
chain, not pizza-forward, could not be verified and closed, each with the permit
address, the last inspection, the day it was set aside and the agent's note. A
candidate the register has inspected since its verdict is marked as due back. Branches
and second registrations of entries on file are one line with a count. A group of more
than six rows is rendered collapsed, as a `details` element, so it opens without
JavaScript.

**The directory's expanded record** has the same blocks and rows for every entry, in
one order: style, style group, known for, opened and price (each with the page that
states it, where the facts task filed one), website, Instagram, status and its source,
locations, rating and its sources, score, attributes, press. A field with nothing on
file prints "not on file" in its place; a missing key and a `null` read the same.

**How it works** ends with the automation, built in `build/sections/method.mjs`: the
life of an entry as a flow (`LIFE_STAGES`), the two workflows step by step with their
gates, the task table, and what can and cannot move a score. The table has one row for
each member of `ROTATION`, written in `build/tasks.mjs` and keyed by task name. A task
that joins the rotation with no row there stops the build, and so does a task with a
worklist and no `PER_PASS` size; a task outside the rotation needs only its `summary`,
for the one line that names those. Change what a task does in `next-task.mjs` and its
row changes with it. The copy names no hour of the day: a scheduled run starts when the
runner gets to it, so the page says "once a day" and "after each research run".

The map is not part of first load. `app.js` reveals the map rail and fetches
`./leaflet.js` when the map nears the viewport or a directory row asks for its marker; if
anything in that fails, the rail is removed and the table takes the full width.

At 1100px and wider the map is a sticky rail beside the table. Under 1100px it is pinned
below the nav for as long as the directory list is on screen, a third of the viewport
high, and the rows scroll beneath it; it leaves with the last row. The pinned box is
`.dir-pin`, laid out as a child of `.dir-layout` because the rail has no box of its own
there (`display: contents`); the legend sits outside it, after the list. All of those rules hang off
`.has-map`, which `app.js` sets, so a reader without JavaScript never gets an empty
pinned box. A row tap focuses the marker; a marker tap brings its row into the part of
the screen below the map, which `app.js` finds from the table header's sticky offset. A
drag on the map pans it in both layouts; the wheel zooms it only in the desktop rail.
`verify.mjs` holds the static half of this (the sticky rule, the rail's `display`, the
header's offset, the markup, what `app.js` observes); the rest needs a layout engine, so
after changing what the directory draws, look at it in Chromium at a phone width.

Every push to a branch other than `main` runs `ci.yml` (tests, lint, build, verify for the
Node sites). Only `main` deploys.

## One shape for every entry

`src/schema.js` lists every key an entry in `data/restaurants.json` carries, in one
order, each with its kind and its empty value:

| Kind | Keys | Empty value |
|---|---|---|
| identity | `id`, `name` | none: an entry cannot be without them |
| fact | `neighborhood`, `blurb`, `style`, `styleGroup`, `signature`, `opened`, `priceIndex`, each of the last five followed by its source (`styleSource`, `styleGroupSource`, `signatureSource`, `openedSource`, `priceSource`) | `null` |
| fact | `attributes` | `{}` |
| link | `url`, `instagram` | `null` |
| status | `status` (never empty), `statusPrev`, `statusNote`, `statusSource`, `statusDate` | `null` |
| location | `locations` | `[]` |
| location | `neighborhoodIsPlaceholder`, `locationsSource` | `null` |
| rating | `factors` | `{}` |
| coverage | `mentions` | `[]` |
| stamp | `statusDetected`, `statusChecked`, `locationsVerified`, `lastVerified`, and for each worklist its `…Attempted` day and `…Note` (`rating`, `locations`, `facts`, `coverage`, `social`) | `null` |
| stamp | `factsSought` | `[]` |

Every entry has every key. One with nothing on file for a key holds the empty value, so
"not known" is written one way and a worklist that draws on what is missing does not
depend on how an entry happened to be written. `normalizeEntry()` adds the keys an entry
lacks and puts all of them in order; it changes no value, and it drops nothing but a
`crowd` key. `apply-research.mjs` passes every entry through it on every run, and
`check-dataset.js` refuses an entry that lacks a key or carries one the schema does not
name (inside a location, a factor and a mention too). After a hand edit,
`node pizza/scripts/check-dataset.mjs --normalize` rewrites the file in that shape, in
the bytes the apply step writes, and prints how many entries it changed.

## The daily loop

Two workflows. `research.yml` runs a Claude agent on one bounded task per day
(discovery, locations, liveness, news, rating, census, facts; the type whose last
successful pass is oldest goes next, passing over any with an empty worklist), writing
proposals to `data/research.json`. `census` has work only while `data/candidates.json`
holds pending candidates, so it takes a day when a seed refresh turns up a new food
permit and is passed over otherwise; `facts` has work while an open entry lacks part of
its descriptive record that no recent attempt looked for. Dispatch-only backfill tasks
(`social`, `coverage`, `sources`, `rerate`) run from the Actions tab. The sizes of the
worklists, the rest periods and the rotation itself are in `src/rules.js`, which the
brief builder draws with and the page prints. The agent's write grant is scoped to that one file, a guard step
fails the run if anything else changed, every record is validated by
`validate-research.js` (a record that fails is dropped with a warning; the rest are
applied), the accepted records are applied to `restaurants.json`, the dataset is linted,
and the page is built and verified before the commit. `publish.yml`
rebuilds every site and deploys: once when the research run finishes, and once a day on
its own schedule, so a day without research still updates the page.

The candidates seed keeps itself current. After the apply step `research.yml` runs
`fetch-candidates.mjs --max-age-days=30`, which returns before making any request unless
the last refresh is more than 30 days old. A refresh reads King County's food-permit
register and OpenStreetMap, each request with a User-Agent and a 25-second timeout,
rewrites the candidates only when one changed, and stamps `checked` when the permit
register answered. The register spells the city several ways (`SEATTLE`, `Seattle`,
`seattle`, `Seattle,`, `WEST SEATTLE`), so the request matches it in upper case and
`isSeattleCity()` in `src/census.js` settles which rows count. If neither source answers, or anything else goes wrong, the file is
left as it was and the step still exits 0. Run it with no flag to refresh at once.

A candidate that turns out to be an entry already on file stays tied to it. One the
seed matches by name is `promoted` with a `matchedId` (an entry's trailing parenthetical
is set aside, so the permit name "A Pizza Mart" matches "A Pizza Mart (First Hill)"), and
a census `duplicate` verdict must name the entry in `duplicateOf`, which is stored as
`matchedId` too. `branchLeads()` in `src/census.js` then lists, per open entry, the
Seattle permit addresses inspected within the seed's cutoff that match none of its
locations. An entry with a lead goes to the head of the locations worklist and its row
in the brief lists the addresses. A lead is never written into `locations[]`: a second
permit can be a commissary kitchen or an old registration, so the agent confirms each
against the pizzeria's own pages and reports the full set as usual. The 30-day rest
applies to these entries like any other, so a lead nobody can confirm costs one look a
month.

A verdict is not for ever. A candidate the census set aside as `closed`, `unverifiable`
or `not-pizza` goes back to `pending` when a seed refresh finds an inspection of its
permit dated after the day of the verdict: the register is saying a kitchen is working
there, and the verdict has not seen it. The earlier verdict, its note and its date move
to `previousVerdict` on the row, and the census brief prints them beside the candidate
so the pass starts from what was found before. A `chain` never returns (it is out by
policy) and neither does a `duplicate` (it is a branch of an entry, handled as a lead).
`candidateStanding()` in `src/census.js` gives the page each candidate's state and the
dates it depends on.

The `facts` task completes the descriptive record: the year a place opened, its price
tier, its style, its style group and the pie it is known for (`signature`, at most 100
characters). It draws open entries missing any of the five, rated entries first and
within each the ones missing most, twelve a pass. Each fact fills a gap only and is
stored with the page that states it. A `facts` record carries what one page states, so
an entry may have several in a file, one per page, with no fact reported twice. The
year and the tier may come from any https page. Style, style group and signature are
descriptions, and their source is the pizzeria's own site or menu (or the profile or
ordering page on file as its web presence) or published coverage; a review aggregator,
a delivery app or a directory listing is refused, because its categories and "popular
dishes" are compiled, not written by anyone who made or reviewed the pizza.

Every worklist remembers what it could not resolve. An entry the agent reports in
`ratingSkipped`, `factsSkipped`, `locationsSkipped`, `coverageSkipped` or `socialSkipped`
is stamped `ratingAttempted`, `factsAttempted`, `locationsAttempted`, `coverageAttempted`
or `socialAttempted` with the note it gave, and rests before it is drawn again: 30 days
for locations, 90 for the others.

The facts worklist remembers per fact. A `factsSkipped` record also stores `factsSought`,
the facts still missing once the file's own `facts` records are applied, and the entry
rests only while everything it lacks is on that list (`factsOutstanding()` in
`src/rules.js`). An attempt stamped with no list is read as a search for the year and
the tier, which is all the task asked for when it recorded only the day, so such an
entry is still drawn for its style, style group and signature. A `facts` record on its
own stamps nothing: the locations task files one when a site happens to state a year,
and that is not a search for the rest. `factsSkipped` may sit beside a `facts` record
for the part that was found.

A `…Skipped` section is attempt memory, and it can never cost a file. Its records are
reduced to one per entry (the first that passes its checks) and to the section's cap,
and each record dropped that way is reported like any other rejected record while the
rest of the file is applied. The caps are twice the largest worklist a section serves,
computed from `src/rules.js`. Every other section's cap is structural: one record over
and the file is refused.

What the agent may write: new directory entries, status changes (with the date the
source states, if any), verified locations and official sites, press mentions up to two
years old, factor proposals (at least one source must be published criticism, and never
over a rating the agent has already set), citations for ratings already on file (values
never change), a
note on each worklist entry it could not resolve, the descriptive record (founding year,
price tier, style, style group and signature pie) from pages that state it, Instagram
links and candidate verdicts. It never writes a score
and never sets an attribute flag: the flags and their friction costs in
`data/attributes.json` move scores, so they are edited by hand. The dataset holds no
crowd figures: Yelp answers 403 to automated reads and no API key is in use, so there is
no star average or review count to score or show, and `check-dataset.js` refuses an
entry that carries a `crowd` key.

A closure needs a news report or the pizzeria's own announcement. Review sites,
aggregators, ordering pages and social hosts are refused as its source, on any of their
domains (`yelp.ca` and `m.yelp.com` like `yelp.com`), with one exception: the Instagram
or Facebook account on file for that entry (its `instagram`, or its `url` when that is
itself a profile). The URL has to name the account, so the profile itself and anything
under it count (`instagram.com/<handle>/p/<id>/`, `facebook.com/<page>/posts/<id>`),
while a bare `instagram.com/p/<id>/`, a story, or a post on an account that is not on
file is a lead, not evidence.

## Corrections

If a fact on the page is wrong, open an issue or send a pull request against
`pizza/data/restaurants.json`. Every entry's record in the directory shows its sources.
