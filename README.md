# sites

Static sites published to GitHub Pages at **https://sites.jackhammons.com/**

Each site lives in its own top-level directory, owns its data and build script, and
is published at `/<slug>/`. One workflow builds them all and deploys once. The landing
page indexes them with a client-side search (`/` to focus, Enter to open the first hit).

| Site | URL | Source | Cadence |
|---|---|---|---|
| The Seattle Pizza Index | [`/pizza/`](https://sites.jackhammons.com/pizza/) | [`pizza/`](pizza/) | Daily (ranked weekly) |
| Odyssey 70mm Seat Maps | [`/odyssey-seats/`](https://sites.jackhammons.com/odyssey-seats/) | [`odyssey-seats/`](odyssey-seats/) | Daily |

## Layout

```
sites.config.json        the registry — what gets built and how it appears on the landing page
scripts/build-all.mjs    builds each site into dist/<slug>/, then renders dist/index.html
scripts/new-site.mjs     scaffolds a new Node site and registers it
pizza/                   Node site: data, ranking algorithm, styles, build + verify
odyssey-seats/           Python site: Playwright scraper that emits an HTML report
.github/workflows/       publish.yml — build, verify, deploy
```

## Building

```bash
node scripts/build-all.mjs    # every site -> dist/
npx serve dist                # or any static server
```

The Python site needs `pip install playwright pillow` and `playwright install chromium`.

A single site can still be built on its own, which is useful while working on one:

```bash
node pizza/scripts/build.mjs                              # writes dist/
node pizza/scripts/verify.mjs
OUT_DIR=/tmp/out python3 odyssey-seats/siff_seatmaps_v5.py --report-only
```

Sites read `OUT_DIR` to decide where to write, defaulting to `dist/`. The orchestrator
sets it to `dist/<slug>/`; a standalone run ignores it. No dependencies, no lockfile.

## Adding a site

For a Node site, scaffold it:

```bash
node scripts/new-site.mjs rain-log "Seattle Rain Log" "Days it actually rained." "🌧️"
```

That creates the directory, a working build and verify honouring `OUT_DIR`, and the
registry entry — it builds and deploys immediately, so you can confirm the pipeline
before writing real content.

To add one by hand (any language):

1. Create a top-level directory with a build script that writes a complete static
   site (including `index.html`) into `OUT_DIR`, falling back to `dist/`.
2. Optionally add a verify script that checks that output — `build-all` runs it and
   fails the deploy if it exits non-zero. Two optional config fields help if the build
   doesn't emit `index.html` directly: `indexFrom` promotes a differently-named file,
   and `emptyIndex` renders a placeholder when a run legitimately produces nothing.
3. Register it in `sites.config.json`:

```json
{
  "slug": "example",
  "name": "Example",
  "emoji": "📊",
  "tagline": "One sentence for the landing page.",
  "dir": "example",
  "build": ["node", "scripts/build.mjs"],
  "verify": ["node", "scripts/verify.mjs"],
  "cadence": "Rebuilt Mondays",
  "accent": "#e14434"
}
```

Push to `main`. It builds, verifies and deploys to `/example/`, and appears on the
landing page automatically.

Use relative asset paths (`./app.js`) inside a site so it works under its subpath.

## Deployment

`.github/workflows/publish.yml` runs daily at 13:17 UTC, on pushes to `main` touching site
sources, and on manual dispatch. It builds every site, runs each verifier as a gate,
commits any weekly data snapshots back to the repo, and publishes `dist/` to Pages.

One workflow deploys everything deliberately: **a Pages deployment replaces the whole
site**, so a second workflow calling `deploy-pages` would delete the other sites' output.
The cron therefore runs at the fastest cadence any single site needs. For the same
reason, if one site's build fails the entire run fails and nothing deploys — the previous
deploy stays live rather than publishing a half-built site.

Pages must be enabled once per repository (Settings → Pages → Source). The workflow's
`GITHUB_TOKEN` cannot create a Pages site itself — that is a platform restriction, not
a configuration gap — but once the site exists, `configure-pages` manages the build
type from then on.

## Custom domains

GitHub Pages allows **one custom domain per repository**. The `CNAME` applies to the
whole Pages site, so individual subdirectories cannot each have their own domain.

- `sites.example.com` → serves this repo, with sites at `sites.example.com/pizza/`
  (the `/sites/` path segment disappears — a custom domain maps to the Pages root).
- Per-site domains would require one repo per site, each with Pages enabled and its own
  `CNAME` — reintroducing the manual setup this repo exists to avoid.
- To keep one repo *and* get per-site domains, put a proxy in front (Cloudflare Workers,
  Netlify, Vercel) that rewrites `pizza.example.com/*` to
  `sites.jackhammons.com/pizza/*`.
