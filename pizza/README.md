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
  data/history.json       weekly snapshots, drives the ▲/▼ movement markers
  src/slice.js            the algorithm (runs in Node AND in the browser)
  src/render.js           card rendering, shared by the build and the re-ranker
  src/app.js              the in-browser weight sliders
  src/styles.css
  scripts/build.mjs       renders dist/
  scripts/verify.mjs      post-build sanity checks
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
**https://jackchammons.github.io/sites/pizza/**, built by `scripts/build-all.mjs` and
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
