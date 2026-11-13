# The Seattle Pizza Index

A static site that tracks Seattle's pizzerias: a ranked top ten, a directory of every
place the index knows of with a map, openings and closings, and the local press. Published at
**https://sites.jackhammons.com/pizza/**, rebuilt daily by GitHub Actions.

Every number on the page is computed at build time from `data/restaurants.json` by the
scoring module in `src/slice.js`. Each ranked card opens to show every input behind its
score, read against the rest of the rated field; the browser runs only the map and the
directory's toggles and search.

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
  data/candidates.json    the candidates queue: registry-seeded leads for the census task, and
                          places a research pass filed as serving pizza without being pizzerias;
                          `updated` is the last refresh that changed a candidate, `checked` the
                          last that ran, `servesCursor` where the serves sweep has got to
  data/research.json      the research agent's last validated proposals
  src/slice.js            the scoring module (run by the build and the tests; nothing scores in the browser)
  src/render.js           card rendering and the per-card explanation
  src/registry.js         the one list of places: every entry and every listed candidate, each in
                          one category; every section that lists or counts places reads it
  src/app.js              the directory (categories, search, rows, map on demand), chart tooltip,
                          card toggles; the one script the browser runs
  src/search.js           the directory's search rules (folding, matching), with no DOM in them
  src/palette.js          the directory's colours: one per category and the rank ramp, defined once
  src/locations.js        location labels and the locations worklist
  src/schema.js           every key an entry carries, in order, with its empty value; the normaliser
  src/rules.js            worklist sizes, rest periods, the rotation, the neighbourhoods a sweep
                          walks and the geocoder's limits; the page prints them
  src/validate-research.js   the research-file gate, as a pure function
  src/check-dataset.js    the dataset lint, and the lint of what the scripts write into the queue
  src/census.js           candidate matching, branch leads, reopened verdicts, where a candidate
                          came from and where it stands
  src/bounds.js           the one geographic rule: the ZIP range, the coordinate box, a Seattle address
  build/                  the page, section by section (pure modules)
  build/tasks.mjs         what each research task does, as the methodology prints it
  scripts/build.mjs       composes build/ into OUT_DIR (default ../dist/pizza)
  scripts/verify.mjs      the deploy gate: unit tests plus checks on the output (below)
  scripts/check-dataset.mjs, verify-research.mjs, apply-research.mjs
  scripts/next-task.mjs   picks and briefs the research agent's daily task
  scripts/fetch-buzz.mjs, fetch-candidates.mjs, geocode.mjs
  test/                   node --test suites for every pure module
  test/browser-check.mjs  the directory in Chromium (dev box, Playwright; not run in CI)
```

No dependencies, no lockfile. Leaflet is vendored under `src/vendor/`.

## Working on it

```bash
node --test pizza/test/*.test.mjs        # unit tests
node pizza/scripts/check-dataset.mjs     # lint the dataset, and the candidates queue's coordinates
node pizza/scripts/check-dataset.mjs --normalize   # put every entry into the schema's shape, then lint
cd pizza && OUT_DIR=/tmp/out node scripts/build.mjs && OUT_DIR=/tmp/out node scripts/verify.mjs
node scripts/build-all.mjs --only pizza  # or through the orchestrator -> dist/pizza/
node pizza/test/browser-check.mjs        # the directory in Chromium; after touching app.js or styles.css
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
quoted data, and when the pinned map's rules below have come apart. The record, radar
and buzz sections are optional: each renders nothing when it has nothing to show, and
the nav is built from the sections that rendered.

The directory has checks of its own, all against the registry (below) built from the
two data files. Every category must list as many rows as the registry has for it, print
that number, and name each place in the place's own row; a category with nothing in it
must not be there. Every place must be in exactly one category, the one the registry
gives it, and the same is counted from the files: every entry in `restaurants.json` is
one row in one category, and the candidate rows plus the candidates tied to an entry are
the whole queue. Only the ranked category is open by default. The nav has no Candidates
entry, and `id="candidates"` sits at the head of the categories that are not on file
exactly when the queue holds something. The search field and the toggles are on the page
once, rendered hidden, with one toggle per category, pressed where its category is open,
and no stylesheet rule may show them without `.has-tools`. Every number of places the
page prints (`data-count`) is the registry's. Each place the radar names is in the
directory under the matching category and links to its row, and the radar's two lists
are the registry's. The inline map data lists the registry's places that have a point,
each under its row's category, with a rank for each ranked one; and the palette in the
page's stylesheet is the one `src/palette.js` defines, defined once. A census note and a
permit name are quoted data like a headline, so `candidates.json` is among the files the
`undefined` and wording checks exempt.

## What the page explains about itself

Three parts of the page describe the pipeline, and each prints the pipeline's own
numbers instead of repeating them.

**One list of places.** `src/registry.js` takes the entries and the candidates queue and
returns every place the index knows of, each in exactly one category: ranked (open and
rated), unrated, not open yet, closed, waiting for a census pass, national chain, not
pizza-forward, could not be verified, and set aside (a candidate with no verdict on
record; none today). An entry's category comes from its status and `isRated()`; a
candidate's from `candidateStanding()`. Closed is one list: the entries on file that
have closed, then the candidates a census pass found closed. A candidate that is an
entry on file, or a further permit of one, is not a place of its own and is only
counted. Every section that lists or counts places reads the registry from the build
context and nothing else: the directory, the map's data, the radar (not open yet, and
the closed category's last six months, so a permit-only closure appears there too,
dated as "reported", never as "closed on"), the hero's and the ranking's counts, and
the scoring path, which starts from the registry's entries.

**The directory** (`build/sections/directory.mjs`) lists the registry by category. A
category is a `details` element with its swatch, name, count and a one-line rule in its
header, and its own explanation inside: why a place is there and what brings it back,
with the numbers the worklists run on (`PER_PASS`, `RETRY_DAYS`, the inspection cutoff).
The ranked category is open and the rest are closed, so without JavaScript the list
opens by its headings and every row is in the page. An unrated entry says why under its
row: waiting for a rating pass, or the day a pass looked, the day it is eligible again
(`ratingAttempted` plus `RETRY_DAYS.rating`) and the agent's note. A candidate's row
gives the place, where it is known from (a food permit with its last inspection,
OpenStreetMap, or a research pass) and where it stands, with the note under it; one the
register has inspected since its verdict is marked as due back, and a place a research
pass filed is told apart from a permit, since no inspection brings it back. Further
permits of entries on file are one line with a count. The Candidates section these
lists used to be is gone; `id="candidates"` is the heading over the categories that are
not on file.

`app.js` adds one piece of state, the set of categories that are on, and three things
follow it: a category that is on is expanded, its toggle is pressed and its places are
on the map. The toggles and the category headings both change that set. The search
field matches each row's own text (name, neighbourhood, addresses, style, notes,
status) and what the build marks `.q` in its record or note (style group, signature
pie, every neighbourhood, a census note), read from the page once and folded by
`src/search.js`: case, accents and punctuation are ignored and every word has to match.
While there is a query each category with a match shows only its matching rows, the
rest are hidden, and clearing it brings back the set from before. A link or an address
fragment that names a category (`#cat-closed`), a row (`#r-<id>`, `#c-<key>`) or a
record (`#dd-<id>`) turns its category on and brings it into view.

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
anything in that fails, the rail is removed, the toggles go back above the list and the
list takes the full width. The map shows the pins of the categories that are on, and of
the matches during a search, and is fitted to them when that set changes. Every pin is
one size. Its colour is its category's, from `src/palette.js`, which is also written
into the page as custom properties for the toggles and headings, so the palette is
defined once; a ranked pin is coloured by rank on a ramp from blue (lowest) to red (#1),
by `rankColor()`, and the ten highest have a ring. A place on file is a filled pin and a
place that is not is a hollow one. "Show my location" asks the browser for the reader's
position only when it is pressed (or at once if the site is already allowed), draws it
as a diamond, and keeps it nowhere; a position outside the region leaves the map where
it was.

The search field and the toggles are rendered hidden, ahead of the list, and `app.js`
moves them into the map's wrapper once there is a map, so they exist once and are in
reach wherever the map is. At 1100px and wider the map is a sticky rail beside the
list: the field, the toggles, the map and its note, sized to the window. Under 1100px
the wrapper is pinned below the nav for as long as the directory list is on screen: the
field, the toggles as one row that scrolls sideways, and the map at three tenths of the
viewport's height, with the rows scrolling beneath; it leaves with the last row (and on
a screen under 540px high nothing is pinned). The pinned box is
`.dir-pin`, laid out as a child of `.dir-layout` because the rail has no box of its own
there (`display: contents`); the legend sits outside it, after the list. All of those rules hang off
`.has-map`, which `app.js` sets, so a reader without JavaScript never gets an empty
pinned box. A row tap focuses the marker; a marker tap brings its row into the part of
the screen below the map, which `app.js` finds by measuring what is stuck above the
list. The table header sticks under the pinned box: its offset is the toggles' height
(`--tools-h`, which `app.js` keeps measured) plus the map's. A
drag on the map pans it in both layouts; the wheel zooms it only in the desktop rail.
`verify.mjs` holds the static half of this (the sticky rule, the rail's and the tools'
`display`, the header's offset, the markup, what `app.js` observes); the rest needs a
layout engine, and `test/browser-check.mjs` drives it in Chromium at 390, 1280 and 1920
px in both colour schemes: the default, every toggle, show all, reset and collapse, the
headings, the search, rows and pins, links into the directory, the page without
JavaScript and without the map, and the reader's location allowed nearby, allowed far
away and refused. It builds its own copy of the site, so it changes nothing in the
checkout; run it after changing what the directory draws.

The content column is capped at 1600px, with running prose keeping a measure of its own,
so a wide monitor goes to the directory's table and map (two fifths of the row from
1500px), the ranking (two cards to a row from 1500px) and the methodology's blocks.

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
its descriptive record that no recent attempt looked for. Dispatch-only tasks
(`social`, `coverage`, `sources`, `rerate`, `serves`) run from the Actions tab. The sizes of the
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

A refresh owns what it seeded and nothing else in the file. A candidate a research pass
filed is carried through untouched, even when a registry row lands on its key. A
candidate keeps its coordinates for as long as its address is the one they were looked
up for. A top-level key the refresh does not write (`servesCursor`) is written back as
it was.

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

**Places that serve pizza and are not pizzerias.** The seed asks the register for permit
names that contain PIZZ or SLICE, and the register has no cuisine field, so a restaurant,
bar or bakery that serves pizza under any other name can never enter the queue that way:
Bar Cotto holds two Seattle permits and neither name matches. Those places are filed by
the research agent, through the `servesPizza` section: a name, a Seattle street address,
a neighbourhood, a note that says how pizza figures on the menu, and a source that is
the place's own site or menu or published coverage (an aggregator, a delivery app, a
directory or a social profile is refused, as for a `facts` description). The validator
refuses a record whose name or street address is an entry on file, and one whose key or
street address is already in the queue in any state. The apply step turns each accepted
record into a candidate with `sources: ["research"]`, already set aside as `not-pizza`,
with the note, the source and the day, and the address in the form a permit candidate
has. It carries no `lastInspection`, because no permit is tied to it.

Such a candidate does not churn. `candidateOrigin()` in `src/census.js` reads `research`
for it and `permit` for anything a registry seeded; a research-filed candidate is never
reopened by an inspection date, a seed refresh never rewrites it, and
`candidateStanding()` reports `reopens: false` for it. The one way it leaves that state
is a later pass filing the place through `directory` as a pizzeria: the directory
channel does not consult the queue, and when the entry is added the apply step marks the
candidate `promoted` with its `matchedId` and keeps the old finding as `previousVerdict`.
The same holds for a permit candidate set aside as closed, unverifiable or not-pizza
whose name matches an entry the same file adds.

Two tasks file these records. `serves` is dispatch-only and sweeps the city for them,
`SERVES_HOODS_PER_PASS` neighbourhoods a pass from `NEIGHBORHOODS` in `src/rules.js`
(the list the discovery task draws its sweep from), asking for up to `PER_PASS.serves`
records; its brief names what is already on file and in the queue for those
neighbourhoods. Its memory is a cursor, `servesCursor` at the top of
`data/candidates.json`: the brief starts from it, the apply step moves it on after a
serves pass whether or not the pass filed anything, and it wraps at the end of the list
(`servesSweep()` is read by both ends). `discovery` may file up to `SERVES_IN_PASSING`
such records for places it happens to meet, and moves no cursor.

**Coordinates for candidates.** `geocode.mjs` runs before every publish build. It looks
up every Seattle restaurant location that lacks coordinates first, as it always has,
and then the candidates the page lists by name: every one that is not `promoted` and
not a `duplicate` (`candidateIsShown()`), since those two are tied to an entry that has
its own. Candidates are held to `CANDIDATE_GEOCODE` in `src/rules.js`: a number of
requests and a number of seconds a run, whichever runs out first, and the log says how
many are left for a later run. An address that finds nothing is stamped `geoTried` and
rests `retryDays`; a request that fails stamps nothing, and a few failures in a row end
the run's work on candidates. The coordinates are written to `data/candidates.json`,
held to the same box as every location's (`src/bounds.js`), and survive a seed refresh
and a census verdict. `check-dataset.mjs` lints them, with the geocoder's stamp and the
sweep cursor, and nothing else in that file: a permit name or a research note is
third-party text and cannot fail a deploy.

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
computed from `src/rules.js`. `servesPizza` is capped the same way, at twice
`PER_PASS.serves`, and loses the records past its cap one at a time. Every other
section's cap is structural: one record over and the file is refused.

What the agent may write: new directory entries, status changes (with the date the
source states, if any), verified locations and official sites, press mentions up to two
years old, factor proposals (at least one source must be published criticism, and never
over a rating the agent has already set), citations for ratings already on file (values
never change), a
note on each worklist entry it could not resolve, the descriptive record (founding year,
price tier, style, style group and signature pie) from pages that state it, Instagram
links, candidate verdicts and places that serve pizza without being pizzerias (which join
the candidates queue, never the directory). It never writes a score
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
