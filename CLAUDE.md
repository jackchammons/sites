# CLAUDE.md

Static sites published together at **https://sites.jackhammons.com/**.
Each site lives in a top-level directory and is served at `/<slug>/`.

## Adding a site (start here)

```bash
node scripts/new-site.mjs <slug> "Name" "One-sentence tagline" [emoji]
node scripts/build-all.mjs
```

The scaffolder creates `<slug>/` with a build and verify that already honour the
`OUT_DIR` contract, seeds `data/data.json`, and registers the site. What it generates
builds and deploys as-is — run `build-all` once to confirm the pipeline before writing
real content, then replace the data and the rendering in `<slug>/scripts/build.mjs`.

A site that isn't Node (see `odyssey-seats/`, which is Python) needs its own directory
and a `build` command in the registry; the scaffolder only covers the Node case.

## Build

```bash
node scripts/build-all.mjs    # all sites -> dist/
```

`sites.config.json` is the registry. For each entry, `build-all.mjs` runs the site's
`build` command with **`cwd` = the site's directory** and **`OUT_DIR` = `dist/<slug>/`**,
then its `verify` command, then renders the landing page at `dist/index.html` — which
includes a client-side search over each site's name, tagline, slug and cadence.

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
| `pizza` | `pizza/` | Node, no deps | `src/slice.js` is the ranking algorithm, imported by both the build and the browser — one implementation, don't fork it. `verify.mjs` gates the deploy. `fetch-buzz.mjs` (keyless) and `fetch-ratings.mjs` (needs `YELP_API_KEY`) refresh `data/` before the build; both fail soft. Pillar scores are editorial — never write them from a script. |
| `odyssey-seats` | `odyssey-seats/` | Python, Playwright + Pillow | Scrapes SIFF's **dedicated 70mm page** (`MAIN_URL`), so every showtime found is 70mm and there is no date filter to maintain. Writes `report.html`, promoted to `index.html`. Needs `pip install playwright pillow` + `playwright install chromium`. |

## Things that will bite you

- **A Pages deploy replaces the entire site.** Never add a second workflow that calls
  `deploy-pages` — it would delete the other sites' output. `publish.yml` is the only
  workflow allowed to deploy. `research.yml` exists alongside it and only commits data.
  Its commit does **not** trigger `publish.yml`: a push made with `GITHUB_TOKEN` never
  fires another workflow, which is GitHub's anti-recursion rule and not something a
  `paths:` filter can work around. The cadence is what connects them -- `research.yml`
  runs at 12:47 UTC and `publish.yml`'s cron at 13:17 UTC, half an hour later, checking
  out whatever research just committed. Keep that ordering if you change either cron;
  to see a research commit on the site sooner, dispatch `publish.yml` by hand.
- **Agents stay out of the deploy path.** `research.yml` runs the Claude Code Action to write
  `pizza/data/research.json` (news, ratings, candidates, closures), gated behind
  `CLAUDE_CODE_OAUTH_TOKEN`. `verify-research.mjs` validates it and `apply-research.mjs` then
  writes crowd figures and closure flags into `restaurants.json` — the agent never edits that
  file itself. If it hangs or fails, the site still publishes.
- **The top ten is computed, not stored.** `splitTiers()` publishes the ten highest-scoring
  entries; a reported closure is the only thing that holds one back. The `tier` field in
  restaurants.json is a seed, not the published split. Don't reintroduce a hardcoded top ten.
- **Consensus is critic-only, deliberately.** Crowd ratings were 55% of that pillar and no
  longer count. They are frozen at one observation date and unrefreshable, so scoring on them
  permanently advantaged the ten entries that had them and barred the fifteen that did not.
  All 25 are now measured identically. The shrinkage still runs, but only to render a dated
  context figure beside the score — don't wire it back into the total.
- **Never let a script write pillar scores.** The page claims they are editorial judgments
  applied by one rubric; generating them would make that claim false. Crowd figures are the
  only part of the dataset automation may touch.
- **Crowd ratings are frozen, permanently, by decision.** Yelp returns 403 to automated
  fetching (business pages and search) and Google's results carry no rating in the HTML, so
  they cannot be scraped; and a Yelp API key was considered and ruled out, so there is no
  API path either. `fetch-ratings.mjs` has been deleted. The figures in `restaurants.json`
  are a dated observation and will not refresh. Do not reintroduce a ratings pipeline —
  three runs burned their whole turn budget rediscovering the 403.
- **Set exactly one research credential.** `research.yml` accepts either
  `CLAUDE_CODE_OAUTH_TOKEN` (subscription pool, from `claude setup-token`) or
  `ANTHROPIC_API_KEY` (metered API credits). If both are set the API key wins the credential
  chain, so you pay per token while the subscription allowance goes unused — the gate step
  emits a workflow warning when it sees both.
- **The research agent works; here is what it took.** Six runs failed on the turn ceiling
  (12, 28, 30, 30, 45, 55) and four blind tunes fixed none of them. `show_full_output`
  found it in one run: the prompt named `verify-research.mjs`, so the agent tried to run
  it, had no `Bash` tool, was denied four times and stopped to ask a human for approval in
  an unattended job. **Never mention a script the agent cannot run.** Three things keep it
  green now — the prompt says to run nothing and that a later step validates; a 15-search
  budget bounds the turns, which otherwise scaled with how much news existed that day; and
  the agent step is `continue-on-error` with the *next* step deciding the run, so an
  overrun cannot discard a file that was already written. A clean pass is ~3 minutes and
  about $1.20 of plan allowance.
- **Two things the first green run then exposed**, both worth knowing before touching this
  path. `build.mjs` read `research.items` while the agent writes `research.news`, so every
  researched story was validated, committed and silently dropped — the candidates half kept
  working, which is what hid it. And a research commit does **not** trigger `publish.yml`:
  a push made with `GITHUB_TOKEN` never fires another workflow. That commit step also needs
  an explicit token, because the Claude action revokes the one `checkout` persisted.
  The daily site update still does not depend on the agent — `fetch-buzz.mjs` in
  `publish.yml` is keyless and is what keeps the buzz section current on its own.
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
- SIFF lists this film on two pages, digital and 70mm. If the seat-map site goes empty,
  check `MAIN_URL` still resolves before assuming the engagement ended — the pages were
  split once already and the old code silently matched nothing for weeks.
- Weekly data snapshots (`*/data/history.json`) are keyed by ISO week, so the daily
  workflow overwrites the current week rather than appending. Don't switch that back to
  date keys — and it keeps working if the cron changes again.
