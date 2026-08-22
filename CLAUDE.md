# CLAUDE.md

Static sites published together at **https://jackchammons.github.io/sites/**.
Each site lives in a top-level directory and is served at `/<slug>/`.

## Build

```bash
node scripts/build-all.mjs    # all sites -> dist/
```

`sites.config.json` is the registry. For each entry, `build-all.mjs` runs the site's
`build` command with **`cwd` = the site's directory** and **`OUT_DIR` = `dist/<slug>/`**,
then its `verify` command, then renders the landing page at `dist/index.html`.

A single site can be built alone while iterating:

```bash
node pizza/scripts/build.mjs                              # -> dist/
OUT_DIR=/tmp/out python3 odyssey-seats/siff_seatmaps_v5.py --report-only
```

## The OUT_DIR contract

A site's build script must write a complete static site into `OUT_DIR`, defaulting to its
own local dir when the variable is unset. Optional config fields cover common cases:

- `indexFrom` — promote this file to `index.html` if the build doesn't emit one directly.
- `emptyIndex` — render a styled placeholder if the build legitimately produced nothing
  (e.g. a scraper found no data). Only applies when the build **succeeded**.

Use **relative asset paths** (`./app.js`) inside a site so it works under its subpath.

## Sites

| Slug | Dir | Stack | Notes |
|---|---|---|---|
| `pizza` | `pizza/` | Node, no deps | `src/slice.js` is the ranking algorithm, imported by both the build and the browser — one implementation, don't fork it. `verify.mjs` gates the deploy. |
| `odyssey-seats` | `odyssey-seats/` | Python, Playwright + Pillow | Scrapes siff.net. Writes `report.html`, promoted to `index.html`. Needs `pip install playwright pillow` + `playwright install chromium`. |

## Things that will bite you

- **A Pages deploy replaces the entire site.** Never add a second workflow that calls
  `deploy-pages` — it would delete the other sites' output. One workflow builds and
  deploys everything, on the fastest cadence any site needs.
- **If any site's build fails, the whole run fails and nothing deploys.** This is
  deliberate: the previous deploy stays live instead of publishing a half-built site.
- **Enabling Pages cannot be automated.** A workflow's `GITHUB_TOKEN` is refused on the
  Pages *create* API (`Resource not accessible by integration`) regardless of repo
  visibility, and the Claude GitHub App has no Administration or Pages permission. It is
  a one-time manual step per repo — which is the reason sites live here as subdirectories
  instead of in separate repos.
- **One custom domain per repo.** A `CNAME` applies to the whole Pages site, not per
  subdirectory. See README for the workaround.
- **Don't commit `dist/`** — it's generated and gitignored.
- Weekly data snapshots (`*/data/history.json`) are keyed by ISO week, so the daily
  workflow overwrites the current week rather than appending. Don't switch that back to
  date keys — and it keeps working if the cron changes again.
