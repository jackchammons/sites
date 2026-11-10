# The Seattle Pizza Index

A static site that tracks Seattle's pizzerias: a ranked top ten, a full directory with a
map, openings and closings, and the local press. Published at
**https://sites.jackhammons.com/pizza/**, rebuilt daily by GitHub Actions.

Every number on the page is computed at build time from `data/restaurants.json` by the
scoring module in `src/slice.js`. Each ranked card opens to show every input behind its
score, read against the rest of the rated field; the browser runs only the map.

## The score (SLICE v2.2)

```
SLICE = ( Σ factorᵢ ÷ 10 × weightᵢ − min(friction, 6.0) ) × (1 − decay)
```

| Factor | Weight | How it is set |
|---|---|---|
| Reputation | 24% | Computed: longevity, review count and press coverage; counted only where it does not lower the score (see below) |
| Critical reception | 24% | Graded critic base, lifted up to +1.5 by press the research pass files |
| Craft | 18% | Graded |
| Distinctiveness | 18% | Graded |
| Value | 16% | Computed: (craft + critical) / 2 × price-tier multiplier |

Every weight, cap and constant the methodology section prints is an export of
`src/slice.js`, interpolated at build time (`build/page.mjs`), so the page cannot describe
a formula the code has left. A new constant in a formula is exported and printed, never
typed into the copy.

**Graded factors** (craft, distinctiveness, critical) are stored once per entry with
provenance (`setBy`, `source`, `date`) and never overwritten by a script. They have two
sources, and the directory shows which applies: the founding entries were rated
editorially when the index launched in August 2026 with nothing cited, and the `sources`
task attaches published criticism to those ratings after the fact without changing a
value; every entry added since is rated by the research agent from one to four published
sources it read.

**Reputation** has three components, each 0 to 1: longevity (log curve on years open,
weight 3), review volume (`reviews / (reviews + 500)`, weight 2) and coverage (press
mentions in 24 months / 6, weight 1). They combine as the best weighted mean over any
prefix of the components sorted best-first, so adding evidence can lift the factor but
never lower it.

The same rule holds one level up, in `scoreOne()`: reputation carries its 24% only when
it is measured **and** at or above the weighted mean of the entry's other four factors.
With no component on file, or with a reputation below the other four, its weight is
dropped and the other four share it in proportion to their own weights. The score is
therefore monotone in evidence: a new press mention, founding year or review count can
raise it and never lower it (`test/slice.test.mjs` checks this for fixtures and for every
rated entry in the dataset). `reputationDetail.use` records which case applied
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
  data/attributes.json    attribute registry (label + frictionCost per flag)
  data/history.json       weekly snapshots, stamped with the algorithm version
  data/buzz.json          press sweep; rewritten only when the list of stories changes
  data/candidates.json    registry-seeded leads for the census task
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
deploy. The record, radar and buzz sections are optional: each renders nothing when it has
nothing to show, and the nav is built from the sections that rendered.

The map is not part of first load. `app.js` reveals the map rail and fetches
`./leaflet.js` when the rail nears the viewport or a directory row asks for its marker; if
anything in that fails, the rail is removed and the table takes the full width.
Every push to a branch other than `main` runs `ci.yml` (tests, lint, build, verify for the
Node sites). Only `main` deploys.

## The daily loop

Two workflows. `research.yml` runs a Claude agent on one bounded task per day
(discovery, locations, liveness, news, rating; the type whose last successful pass is
oldest goes next), writing proposals to `data/research.json`. Dispatch-only backfill tasks
(`social`, `census`, `facts`, `coverage`, `sources`) run from the Actions tab. The agent's write grant is scoped to that one file, a guard step
fails the run if anything else changed, every record is validated by
`validate-research.js` (a record that fails is dropped with a warning; the rest are
applied), the accepted records are applied to `restaurants.json`, the dataset is linted,
and the page is built and verified before the commit. `publish.yml`
rebuilds every site and deploys: once when the research run finishes, and once a day on
its own schedule, so a day without research still updates the page.

What the agent may write: new directory entries, status changes (with the date the
source states, if any; a closure needs a news report or the pizzeria's own announcement),
verified locations and official sites, press mentions up to two years old, factor
proposals for unrated entries only (at least one source must be published criticism),
citations for ratings already on file (values never change), a
note on each unrated entry it could not ground, founding years and price tiers from pages
that state them, Instagram links, attribute flags and candidate verdicts. It never writes a score. Crowd star ratings were seeded at launch and are never
refreshed; they are shown as context, and only the review count feeds reputation.

## Corrections

If a fact on the page is wrong, open an issue or send a pull request against
`pizza/data/restaurants.json`. Every entry's record in the directory shows its sources.
