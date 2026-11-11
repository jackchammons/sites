# sites

Static sites published to GitHub Pages at **https://sites.jackhammons.com/**

Each site lives in its own top-level directory, owns its data and build script, and
is published at `/<slug>/`. One workflow builds them all and deploys once. The landing
page indexes them with a client-side search (`/` to focus, Enter to open the first hit).

| Site | URL | Source | Cadence |
|---|---|---|---|
| The Seattle Pizza Index | [`/pizza/`](https://sites.jackhammons.com/pizza/) | [`pizza/`](pizza/) | Rebuilt daily |
| Now | [`/clock/`](https://sites.jackhammons.com/clock/) | [`clock/`](clock/) | Live in your browser |
| Mortgage Calculator | [`/mortgage/`](https://sites.jackhammons.com/mortgage/) | [`mortgage/`](mortgage/) | Live in your browser |
| Life | [`/life/`](https://sites.jackhammons.com/life/) | [`life/`](life/) | Live in your browser |
| Screen & Seat | [`/screen/`](https://sites.jackhammons.com/screen/) | [`screen/`](screen/) | Live in your browser |
| Word Counter | [`/words/`](https://sites.jackhammons.com/words/) | [`words/`](words/) | Live in your browser |

Every site is plain Node with no dependencies and no lockfile. Each directory has its
own README.

## Layout

```
sites.config.json        the registry: what gets built and how it appears on the landing page
scripts/build-all.mjs    builds each site into dist/<slug>/, checks and stamps it, renders the landing page
scripts/lib/             registry validation, shared output checks, asset stamping
scripts/new-site.mjs     scaffolds a new site and registers it
scripts/commit-data.sh   how the workflows commit refreshed data to main
scripts/test/            tests for all of the above
<slug>/                  one directory per site: data, source, build, verify, tests
.github/workflows/       ci.yml (the checks), publish.yml (build and deploy), research.yml (pizza data)
```

## Checking your work

```bash
node --test */test/*.test.mjs            # every unit test, a few seconds
bash scripts/test/commit-data.test.sh    # the data-commit script, against scratch repos
node pizza/scripts/check-dataset.mjs     # lint the pizza dataset
node scripts/build-all.mjs               # build, verify, check and stamp every site -> dist/
```

That is exactly what `ci.yml` runs on every branch push, and what `publish.yml` runs
before it builds for a deploy.

## Building

```bash
node scripts/build-all.mjs                    # every site -> dist/
node scripts/build-all.mjs --only pizza       # just one, while iterating
node scripts/build-all.mjs --skip pizza       # everything but one
cd dist && python3 -m http.server 8099        # then open http://localhost:8099/
```

`--only` and `--skip` are for local work only and are refused when `CI` is set: a Pages
deploy replaces the whole site, so publishing a partial `dist/` would delete the rest.

For each registered site `build-all` runs its `build`, then its `verify`, then checks
that apply to every site (an `index.html` with a title, no root-relative `src` or
`href`, every referenced local file present), then stamps every local script and
stylesheet URL with a content hash. Last it writes the landing page, `404.html`,
`robots.txt` and `sitemap.xml`. If any step fails for any site, the run fails.

A single site can be built on its own:

```bash
node pizza/scripts/build.mjs      # writes dist/pizza/
node pizza/scripts/verify.mjs
```

A build reads `OUT_DIR` to decide where to write. The orchestrator sets it to
`dist/<slug>/`; with it unset a build writes to the same place. A build refuses to
clear a target that is not empty and is not a previous build.

## Publishing

Only `main` deploys. `.github/workflows/publish.yml` runs on every push to `main` that
is not documentation-only, on a daily cron, on manual dispatch, and when the pizza
research workflow finishes. It runs the checks, builds every site, commits refreshed
pizza data back to `main`, and uploads `dist/` to Pages. Work on a branch is not live
until it is merged.

```bash
git fetch origin && git checkout main && git pull --ff-only origin main
git merge <branch> && git push origin main
curl -s -o /dev/null -w '%{http_code}\n' https://sites.jackhammons.com/<slug>/   # 200 when live
```

The pull matters: the workflows commit data to `main` every day, so a local `main` is
usually behind.

One workflow deploys everything deliberately: **a Pages deployment replaces the whole
site**, so a second workflow calling `deploy-pages` would delete the other sites' output.
For the same reason, if one site's build fails the entire run fails and nothing deploys:
the previous deploy stays live rather than a half-built site going out.

Pages must be enabled once per repository (Settings → Pages → Source). The workflow's
`GITHUB_TOKEN` cannot create a Pages site itself, which is a platform restriction and
not a configuration gap, but once the site exists `configure-pages` manages the build
type from then on.

## Adding a site

Scaffold it:

```bash
node scripts/new-site.mjs rain-log "Seattle Rain Log" "Days it actually rained." "🌧️" \
  --accent=#5b8dd6 --cadence="Rebuilt daily"
node scripts/build-all.mjs --only rain-log
```

That creates the directory with a working build and verify, a README, and every
registration the site needs: the `sites.config.json` entry, the table above and the one
in `CLAUDE.md`. It builds and deploys as it stands, so the pipeline can be confirmed
before any real content is written. Nothing in the workflows lists sites by name.

To add one by hand:

1. Create a top-level directory with a build command that writes a complete static
   site (including `index.html`) into `OUT_DIR`.
2. Optionally add a verify command that checks that output; `build-all` runs it and
   fails the deploy if it exits non-zero.
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
  "accent": "#e14434",
  "keywords": ["words people search by", "that the tagline does not use"]
}
```

`keywords` is optional: the landing page's search matches them and never shows them.

`build-all` validates the registry before it builds anything. A site whose build needs
something the runner does not have (another language, a browser) also needs a setup
step in `ci.yml`, which is the one definition of the checks.

Inside a site, reference assets by plain relative path (`./app.js`, `./styles.css`) and
link back to the index with `../`. Root-relative paths fail the build, because the site
is served under `/<slug>/`.

## Custom domains

GitHub Pages allows **one custom domain per repository**. The `CNAME` applies to the
whole Pages site, so individual subdirectories cannot each have their own domain.

- `sites.example.com` → serves this repo, with sites at `sites.example.com/pizza/`
  (the `/sites/` path segment disappears: a custom domain maps to the Pages root).
- Per-site domains would require one repo per site, each with Pages enabled and its own
  `CNAME`, reintroducing the manual setup this repo exists to avoid.
- To keep one repo *and* get per-site domains, put a proxy in front (Cloudflare Workers,
  Netlify, Vercel) that rewrites `pizza.example.com/*` to
  `sites.jackhammons.com/pizza/*`.
