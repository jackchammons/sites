# sites

Static sites published to GitHub Pages at **https://jackchammons.github.io/sites/**

Each site lives in its own top-level directory, owns its data and build script, and
is published at `/<slug>/`. One workflow builds them all and deploys once.

| Site | URL | Source | Cadence |
|---|---|---|---|
| The Seattle Pizza Index | [`/pizza/`](https://jackchammons.github.io/sites/pizza/) | [`pizza/`](pizza/) | Rebuilt Mondays |

## Layout

```
sites.config.json        the registry — what gets built and how it appears on the landing page
scripts/build-all.mjs    builds each site into dist/<slug>/, then renders dist/index.html
pizza/                   a site: its own data, algorithm, styles, build and verify scripts
.github/workflows/       publish.yml — build, verify, deploy
```

## Building

```bash
node scripts/build-all.mjs    # every site -> dist/
npx serve dist                # or any static server
```

A single site can still be built on its own, which is useful while working on one:

```bash
node pizza/scripts/build.mjs     # writes dist/
node pizza/scripts/verify.mjs
```

Sites read `OUT_DIR` to decide where to write, defaulting to `dist/`. The orchestrator
sets it to `dist/<slug>/`; a standalone run ignores it. No dependencies, no lockfile.

## Adding a site

1. Create a top-level directory with a build script that writes a complete static
   site (including `index.html`) into `OUT_DIR`, falling back to `dist/`.
2. Optionally add a verify script that checks that output — `build-all` runs it and
   fails the deploy if it exits non-zero.
3. Register it in `sites.config.json`:

```json
{
  "slug": "example",
  "name": "Example",
  "emoji": "📊",
  "tagline": "One sentence for the landing page.",
  "dir": "example",
  "build": "scripts/build.mjs",
  "verify": "scripts/verify.mjs",
  "cadence": "Rebuilt Mondays",
  "accent": "#e14434"
}
```

Push to `main`. It builds, verifies and deploys to `/example/`, and appears on the
landing page automatically.

Use relative asset paths (`./app.js`) inside a site so it works under its subpath.

## Deployment

`.github/workflows/publish.yml` runs on a weekly cron (Mondays 13:00 UTC), on pushes
to `main` touching site sources, and on manual dispatch. It builds every site, runs
each verifier as a gate, commits any weekly data snapshots back to the repo, and
publishes `dist/` to Pages.

Pages must be enabled once per repository (Settings → Pages → Source). The workflow's
`GITHUB_TOKEN` cannot create a Pages site itself — that is a platform restriction, not
a configuration gap — but once the site exists, `configure-pages` manages the build
type from then on.
