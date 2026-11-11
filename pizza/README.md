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
  src/validate-research.js   the research-file gate, as a pure function
  src/check-dataset.js    the dataset lint, as a pure function
  src/census.js           candidate matching and coverage numbers
  build/                  the page, section by section (pure modules)
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
quoted data, and when the pinned map's rules below have come apart. The record, radar and buzz sections are optional: each renders
nothing when it has nothing to show, and the nav is built from the sections that rendered.

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

## The daily loop

Two workflows. `research.yml` runs a Claude agent on one bounded task per day
(discovery, locations, liveness, news, rating, census; the type whose last successful pass
is oldest goes next, passing over any with an empty worklist), writing proposals to
`data/research.json`. `census` has work only while `data/candidates.json` holds pending
candidates, so it takes a day when a seed refresh turns up a new food permit and is
passed over otherwise. Dispatch-only backfill tasks (`social`, `facts`, `coverage`,
`sources`, `rerate`) run from the Actions tab. The agent's write grant is scoped to that one file, a guard step
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
register answered. If neither source answers, or anything else goes wrong, the file is
left as it was and the step still exits 0. Run it with no flag to refresh at once.

Every worklist remembers what it could not resolve. An entry the agent reports in
`ratingSkipped`, `factsSkipped`, `locationsSkipped`, `coverageSkipped` or `socialSkipped`
is stamped `ratingAttempted`, `factsAttempted`, `locationsAttempted`, `coverageAttempted`
or `socialAttempted` with the note it gave, and rests before it is drawn again: 30 days
for locations, 90 for the others.

What the agent may write: new directory entries, status changes (with the date the
source states, if any), verified locations and official sites, press mentions up to two
years old, factor proposals (at least one source must be published criticism, and never
over a rating the agent has already set), citations for ratings already on file (values
never change), a
note on each worklist entry it could not resolve, founding years and price tiers from
pages that state them, Instagram links and candidate verdicts. It never writes a score
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
