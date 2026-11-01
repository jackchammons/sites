# The Seattle Pizza Index

A static site that tracks Seattle's pizzerias: a ranked top ten, a full directory with a
map, openings and closings, and the local press. Published at
**https://sites.jackhammons.com/pizza/**, rebuilt daily by GitHub Actions.

Every number on the page is computed at build time from `data/restaurants.json` by the
scoring module in `src/slice.js`, which also runs in the browser so readers can re-weight
the factors and watch the list re-sort.

## The score (SLICE v2.1)

```
SLICE = ( Σ factorᵢ ÷ 10 × weightᵢ − min(friction, 6.0) ) × (1 − decay)
```

| Factor | Weight | How it is set |
|---|---|---|
| Reputation | 24% | Computed: longevity, review count and press coverage (see below) |
| Critical reception | 24% | Graded critic base, lifted up to +1.5 by press the research pass files |
| Craft | 18% | Graded |
| Distinctiveness | 18% | Graded |
| Value | 16% | Computed: (craft + critical) / 2 × price-tier multiplier |

The weights, caps and constants on the page are read from `src/slice.js` at build time,
so the methodology section is always the code's own values.

**Graded factors** (craft, distinctiveness, critical) are stored once per entry with
provenance (`setBy`, `source`, `date`) and never overwritten by a script. They have two
sources, and the directory shows which applies: the founding entries were rated
editorially when the index launched in August 2026 and carry no cited source; every entry
added since is rated by the research agent from one to four published sources it read.

**Reputation** has three components, each 0 to 1: longevity (log curve on years open,
weight 3), review volume (`reviews / (reviews + 500)`, weight 2) and coverage (press
mentions in 24 months / 6, weight 1). They combine as the best weighted mean over any
prefix of the components sorted best-first, so adding evidence can lift the factor but
never lower it. An entry with no component on file has no reputation score; its 24% is
shared by the other four factors rather than scored as zero.

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
  data/buzz.json          press sweep, refreshed daily
  data/candidates.json    registry-seeded leads for the census task
  data/research.json      the research agent's last validated proposals
  src/slice.js            the scoring module (Node and browser)
  src/render.js           card rendering, shared by the build and the re-ranker
  src/app.js              the in-browser weight controls, directory and map
  src/locations.js        location labels and the locations worklist
  src/validate-research.js   the research-file gate, as a pure function
  src/check-dataset.js    the dataset lint, as a pure function
  src/census.js           candidate matching and coverage numbers
  build/                  the page, section by section (pure modules)
  scripts/build.mjs       composes build/ into OUT_DIR (default ../dist)
  scripts/verify.mjs      post-build gate: unit tests plus checks on the output
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

A local build never writes the weekly snapshot; only `publish.yml` sets `SNAPSHOT=1`.
Every push to a branch other than `main` runs `ci.yml` (tests, lint, build, verify for the
Node sites). Only `main` deploys.

## The daily loop

Two scheduled workflows. `research.yml` runs a Claude agent on one bounded task per day
(discovery, locations, liveness, news, rating, rotating), writing proposals to
`data/research.json`. The agent's write grant is scoped to that one file, a guard step
fails the run if anything else changed, every record is validated by
`validate-research.js`, the validated sections are applied to `restaurants.json`, the
dataset is linted, and the page is built and verified before the commit. `publish.yml`
then rebuilds every site and deploys.

What the agent may write: new directory entries, status changes (with the date the
source states, if any), verified locations and official sites, press mentions, factor
proposals for unrated entries only, Instagram links, attribute flags and candidate
verdicts. It never writes a score. Crowd star ratings were seeded at launch and are never
refreshed; they are shown as context, and only the review count feeds reputation.

## Corrections

If a fact on the page is wrong, open an issue or send a pull request against
`pizza/data/restaurants.json`. Every entry's record in the directory shows its sources.
