# The Seattle Pizza Index

A static site ranking Seattle's ten best pizzerias by the **SLICE Score** — a transparent,
reproducible 0–100 algorithm published on the page itself. Rebuilt and redeployed by GitHub
Actions daily; the ranking itself moves weekly, since the spotlight and the ▲/▼ markers are
keyed to the ISO week.

## The algorithm

```
SLICE = ( Σ pillarᵢ ÷ 10 × weightᵢ ) − min(friction, 6.0) × (1 − freshness decay)
```

| Pillar | Weight | What it measures |
|---|---|---|
| Crust Integrity | 26% | Fermentation, hydration, structure, bake |
| Topping Craft | 18% | Sourcing and restraint |
| Consensus Signal | 22% | Critical reads blended with a de-noised crowd rating |
| Distinctiveness | 18% | Does it own a lane in this city |
| Value Density | 16% | Satisfaction per dollar, folded with the price tier |

Three things make it more than a weighted average:

1. **Bayesian shrinkage on crowd ratings.** A 4.9★ from 80 reviews is a rumour; a 4.7★ from
   4,000 is evidence. Each rating is pulled toward the city mean in proportion to how little
   data stands behind it: `adjusted = (v/(v+m))·R + (m/(v+m))·C`, with `m = 500` and
   `C = 4.30`.
2. **A friction penalty.** Points come off for preorder-only drops, hour-long waits and
   twenty-hour weeks, because a pie you cannot get is worth less than one you can. Capped at
   −6.0 so logistics can dent a ranking but never decide it.
3. **Freshness decay.** Entries lose 0.2%/week since their `lastVerified` date, capped at 6%,
   so stale data drifts down instead of sitting at the top forever.

Ties break on Consensus Signal, then Crust Integrity, then alphabetically.

## Layout

```
pizza/                    # published at /pizza/
  data/restaurants.json   the dataset — edit this to change the rankings
  data/buzz.json          news sweep, refreshed daily (see below)
  data/history.json       weekly snapshots, drives the ▲/▼ movement markers
  src/slice.js            the algorithm (runs in Node AND in the browser)
  src/render.js           card rendering, shared by the build and the re-ranker
  src/app.js              the in-browser weight sliders
  src/styles.css
  scripts/build.mjs       renders dist/
  scripts/verify.mjs      post-build sanity checks
  scripts/fetch-buzz.mjs  refreshes data/buzz.json from public news feeds
  scripts/fetch-ratings.mjs  refreshes crowd ratings from Yelp (needs a key)
  scripts/verify-research.mjs validates the research agent's output before it is used
  scripts/apply-research.mjs  applies validated ratings and closures to the dataset
```

`src/slice.js` is dependency-free ES module JavaScript with no Node or DOM APIs, so the static
build and the page's live "re-rank it yourself" sliders run the exact same math. There is one
implementation of the algorithm, not two.

## Working on it

```bash
node scripts/build-all.mjs       # all sites -> dist/ (this one at dist/pizza/)
node pizza/scripts/build.mjs     # or just this site -> dist/
node pizza/scripts/verify.mjs    # checks the output
npx serve dist                   # or any static server
```

No dependencies, no build tooling, no lockfile.

## Deployment

This site is published as part of the [`sites`](../README.md) repo at
**https://sites.jackhammons.com/pizza/**, built by `scripts/build-all.mjs` and
deployed by `.github/workflows/publish.yml` on:

- a daily cron — 13:17 UTC (06:17 Pacific)
- any push to `main` touching `pizza/**`
- manual dispatch from the Actions tab

On scheduled runs the workflow also commits the week's standings to `data/history.json`, which
is what the ▲/▼ markers compare against the following week.

## On the data

Pillar scores are editorial judgments applied by one rubric to every restaurant — declared
opinions, not measurements, which is why the page lets you overrule their weights. Crowd
figures are rounded aggregates observed across major review platforms at the dataset version
shown, not a live API feed. To change the rankings, edit `data/restaurants.json` and bump
`lastVerified`.

## Where the data comes from

Two refresh steps run before the daily build. Both only write into `data/`, and both are
fail-soft — no network, no API key, or a bad response leaves existing data in place and
the site still publishes.

**`fetch-buzz.mjs`** — keyless. Sweeps Google News RSS and Eater Seattle for Seattle pizza
coverage, filters for stories that are both local and actually about pizza (national
chains, crime, business-wire and other-city stories are dropped), classifies each as an
opening, closing, list or mention, and merges into `data/buzz.json` deduped on title with
a 120-day window. Reddit was considered and rejected: it now returns 403 to anonymous
reads.

**`fetch-ratings.mjs`** — needs `YELP_API_KEY` as a repository secret. Without it the step
is a clean no-op, which is the current state. With it, each restaurant's `crowd.rating`,
`crowd.reviews` and `lastVerified` are refreshed from Yelp Fusion. Guard rails: a result
must clear a name-similarity threshold, a rating cannot move more than 0.4 in one run, and
review counts cannot halve — any of those and the entry is left alone and logged. A wrong
match is worse than stale data.

**`research.yml`** — needs `CLAUDE_CODE_OAUTH_TOKEN`, generated with `claude setup-token`. A
separate daily workflow runs the Claude Code Action to refresh everything the keyless feeds
cannot, writing one file, `data/research.json`, with four sections:

| Section | What it does |
|---|---|
| `news` | Stories the RSS sweep missed; merged into the buzz list |
| `ratings` | Crowd figures with a source URL — **this is what promotes bench entries** |
| `candidates` | Unranked Seattle pizzerias worth considering, shown under the bench |
| `closures` | Relegation signals; flags the entry and drops it out of the top ten |

The agent writes only that file. `verify-research.mjs` then rejects the whole thing if any
entry is malformed — invented or non-https URL, future or stale date, invented `kind`,
unknown id, a rating moving more than 0.5, a review count halving, a duplicate. Only after it
passes does `apply-research.mjs` write crowd figures and closure flags into
`restaurants.json`. The agent never edits that file itself.

Note on billing: that token draws on the subscription's programmatic credit pool. Do **not**
also set `ANTHROPIC_API_KEY` here — it wins the credential chain and bills API credits
instead, which is a documented way to run up a surprise bill.

## Promotion and relegation

The top ten is not a fixed list. Every entry with verified crowd figures competes on score
alone; the ten highest are published and the rest form the bench. Two things hold an entry
off the top regardless of score:

- **Unverified crowd figures.** A provisional score rests on the critical read alone, so it
  has not proven anything yet. Verifying it is exactly what the research pass does.
- **A reported closure.** Relegation is immediate.

That makes the research pass consequential rather than decorative: confirming Breezy Town's
ratings moves it from bench #11 to the top ten, and pushes whoever sits at the cutoff out.

**Pillar scores are never written by a script.** They are editorial judgments applied by
one rubric, which is what the page claims, and automating them would make that claim
false. Only the crowd figures refresh automatically.
