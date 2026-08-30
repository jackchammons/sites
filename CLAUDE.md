# CLAUDE.md

Static sites published together at **https://sites.jackhammons.com/**.
Each site lives in a top-level directory and is served at `/<slug>/`.

## Adding a site (start here)

```bash
node scripts/new-site.mjs <slug> "Name" "One-sentence tagline" [emoji] \
  [--accent=#rrggbb] [--cadence="Rebuilt daily"]
node scripts/build-all.mjs --only <slug>
```

The scaffolder creates `<slug>/` with a build and verify that already honour the
`OUT_DIR` contract, seeds `data/data.json`, and registers the site. What it generates
builds and deploys as-is — run `build-all` once to confirm the pipeline before writing
real content, then replace the data and the rendering in `<slug>/scripts/build.mjs`.

Registering a site touches four files and the scaffolder patches all of them:
`sites.config.json`, the `paths:` filter in `publish.yml`, the README table and the
Sites table below. The doc tables are anchored on patterns that drift as they are
edited, so a patch that misses warns and names what to add by hand — read its output
rather than assuming silence means success.

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

`--only <slug>` and `--skip <slug>` narrow the run while iterating — `--skip
odyssey-seats` is how you build anything at all on a machine without Playwright and
Pillow, since one site's failure fails the whole run. Both are refused when `CI` is set:
a Pages deploy replaces the entire site, so uploading a partial `dist/` would delete the
sites left out.

A single site can be built alone while iterating:

```bash
node pizza/scripts/build.mjs                              # -> dist/
OUT_DIR=/tmp/out python3 odyssey-seats/siff_seatmaps_v5.py --report-only
```

## Publishing

**Only `main` deploys.** `publish.yml` builds and uploads to Pages on a push to `main`
(filtered by `paths:`), on its 13:17 UTC cron, and on manual dispatch. Work pushed to a
branch publishes nothing, and nothing reports that: a change that looks finished but is
invisible on the domain is almost always still sitting on a branch. Say what is merged,
not what is written.

```bash
git checkout main && git merge <branch> && git push origin main   # this is what deploys
curl -s -o /dev/null -w '%{http_code}\n' https://sites.jackhammons.com/<slug>/
```

Pages serves the new build about a minute after the run goes green — poll for the 200
rather than reporting a merge as a deploy. Two things worth knowing before you push:
the run rebuilds **every** site, so a site you cannot build locally can still fail the
deploy for the one you changed; and `paths:` lists each site directory by name, so a
slug missing from that list never redeploys, silently.

## Checking a site in a browser

These pages are finished by the browser, so a build that verifies clean can still be
visibly broken. Look at the page. Chromium and Playwright are installed
(`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers` — never run `playwright install`).

```bash
node scripts/build-all.mjs --only <slug>
cd dist && python3 -m http.server 8099 &      # serve it: file:// hides subpath bugs
```

Drive it with `require('/opt/node22/lib/node_modules/playwright')` against
`http://localhost:8099/<slug>/`, and vary the context: `colorScheme` (both palettes are
defined), `locale`, `timezoneId`. That is not thoroughness for its own sake — it is how
the clock's `Intl` crash on an `en-US@posix` locale tag was found, which no build check
would have caught.

The browser cannot reach the public internet from here. Outbound HTTPS goes through the
agent proxy and Chromium is not configured for it, so `page.goto` on a live URL fails
with `ERR_CONNECTION_RESET` while `curl` on the same URL returns 200. To check what is
actually deployed, `curl` the files down and serve them locally.

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
| `clock` | `clock/` | Node, no deps | Nothing time-dependent is rendered at build time — a baked-in figure would be wrong by however long ago the deploy ran. `build.mjs` emits a shell of ID'd slots and `src/app.js` fills every one from the viewer's device clock and Intl zone data. `verify.mjs` checks that each `$('...')` lookup in the script matches an `id` in the markup, since a typo there breaks only the browser. |

## Things that will bite you

- **Pushing to a branch publishes nothing.** Only `main` deploys — see Publishing above.
  Verify with a `curl` against the live URL before calling a site shipped: `clock/` was
  built, verified and pushed to a branch, and reported as done while the domain 404'd.
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
  `pizza/data/research.json` (news, mentions, locations, status, directory, factorRatings, newAttributes, links), gated behind
  `CLAUDE_CODE_OAUTH_TOKEN`. `verify-research.mjs` validates it and `apply-research.mjs` then
  writes crowd figures and closure flags into `restaurants.json` — the agent never edits that
  file itself. If it hangs or fails, the site still publishes.
- **SLICE v2: three factors are computed, two are editorial.** Reputation (longevity ×3,
  review volume ×2, coverage ×1, renormalised over what an entry has), critical reception
  (critic base + recency-weighted mention boost capped at +1.5) and value ((craft+critical)/2
  × price multiplier) derive at build time in `slice.js` — never store them. Craft and
  distinctiveness live in `factors` with provenance (`setBy`, `source`, `date`). The
  methodology section publishes every constant; change a formula and the page copy in
  `build.mjs` must change with it.
- **The top ten is computed, not stored.** `splitTiers()` publishes the ten highest-scoring
  entries with `status: "open"`; anything else is held out whatever it scores. There is no
  bench: ranks 11+ render in the directory table. `isRated()` decides who competes — craft +
  distinctiveness + criticScore present.
- **The rating task is how discoveries join the ranking.** `factorRatings` proposals carry
  craft, distinctiveness AND criticScore (all three are required by `isRated()` — the older
  `factors` path writes only the first two and can never make an entry rankable), plus
  opened/priceIndex/styleGroup when derivable, with 1–4 read sources. The validator refuses
  proposals for already-rated entries; ratings are never overwritten by the agent. An unrated
  entry with no findable critical coverage is a deliberate terminal state, not a bug.
- **Seattle is the inclusion rule.** An entry qualifies by having at least one location
  inside Seattle city limits (the discovery brief enforces it). Suburban branches of a
  qualifying chain are kept in `locations[]` and listed in the directory, but the map plots
  Seattle addresses only — matched by `, Seattle, WA` in the address string.
- **One database, three statuses.** `restaurants.json` holds every pizzeria on file:
  `open`, `opening` (the radar), `closed` (struck through in the directory, held out of the
  ranking, listed under recently-closed for six months). `attributes` is a flexible flag map;
  its registry (`data/attributes.json`) carries label + frictionCost per key, and the agent
  can add new keys through the validated `newAttributes` section.
- **What the agent may write, all through verify-research.mjs → apply-research.mjs:**
  locations (+homepage), status changes (citation required; review-site labels are a lead,
  not evidence), new directory entries (fuzzy-name dedup blocks variants like "Zeeks Pizza
  Co"), mentions (feed reputation and the critical boost), factor proposals (0–10 in 0.5
  steps, FILL GAPS ONLY — the validator rejects any overwrite of an existing rating — and
  need published criticism), newAttributes, and links. One bad entry rejects the whole file.
- **`links` is the one channel for web presence.** `{id, website?, instagram?, source}`:
  instagram must be a real `https://instagram.com/<handle>` profile URL the agent saw
  linked or named somewhere (never guessed — plausible handles are fan pages and
  namesakes); it is updatable on apply. `website` fills `url` only when the entry has
  none — the locations pass owns correcting an existing official site — and for a place
  with no site of its own it carries the best canonical link (often the Instagram).
  `nameLink()` renders `url ?? instagram`, so a backfilled entry is always clickable.
- **The agent runs one task per day**, rotated by `next-task.mjs`: discovery, locations,
  liveness, news, rating. The locations brief also collects Instagram links from the
  official sites it is already reading. A manual dispatch can force a type via the
  workflow's `task` input — including the dispatch-only `social` task (Instagram/website
  backfill, never in the rotation) — which is how backfills work. Briefs are code (in
  `next-task.mjs`); the fixed rules and schema live in `research.yml` so no task can
  drop them.
- **Crowd STAR ratings stay frozen; review counts are used.** Yelp 403s automated reads and
  no API key is in use, so the stored star figures cannot refresh and are display-only. The
  review COUNT does feed reputation — a count is durable in a way an average is not. Do not
  reintroduce a star-rating pipeline; three runs burned their budget rediscovering the 403.
- **Locations carry lat/lon once geocoded.** `geocode.mjs` (publish.yml) fills them via
  Nominatim at 1 req/sec, cached forever; `apply-research.mjs` preserves coordinates for
  unchanged addresses when a location set is re-verified. Leaflet is vendored in
  `pizza/src/vendor/` and loads as a plain script tag — it is outside the ES import graph,
  so verify.mjs checks it explicitly.
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
- **Locations are verified data; `neighborhood` is not.** `locations[]` on each restaurant
  is written only by `apply-research.mjs`, from an agent pass that read the pizzeria's own
  locations page, and carries a street address per branch. `neighborhood` is the original
  editorial string and stays as the fallback until a real set lands. Three entries stored
  placeholders there ("Multiple locations", "Citywide"), flagged with
  `neighborhoodIsPlaceholder` so the locations worklist in `next-task.mjs` puts them first and the page shows
  "Several locations" instead of pretending they are neighborhoods. Never render
  `r.neighborhood` directly — use `locationLabel(r)` from `src/locations.js`, which is what
  both the static build and the in-browser re-ranker call.
- **Addresses are the one factual field an agent may write.** They are published by the
  business itself on a page that serves to anyone, so they are checkable — unlike crowd
  ratings (403, frozen) and pillar scores (editorial, no script writes them). The validator
  rejects an address that does not start with a street number, is outside Washington or the
  Seattle metro, or repeats a branch. The agent verifies five per run, worst first, so all
  25 are covered in five days and the budget stays bounded.
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
