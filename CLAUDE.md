# CLAUDE.md

Static sites published together at **https://sites.jackhammons.com/**.
Each site lives in a top-level directory and is served at `/<slug>/`. Every site is
plain Node with no dependencies. This file holds the rules that apply to the whole
repo; each site's own rules are in its directory (see Sites below).

## Check your work

```bash
node --test */test/*.test.mjs            # every unit test
bash scripts/test/commit-data.test.sh    # the data-commit script, against scratch repos
node pizza/scripts/check-dataset.mjs     # lint the pizza dataset
node scripts/build-all.mjs               # build, verify, check and stamp every site -> dist/
```

This is what `ci.yml` runs on every branch push and what `publish.yml` runs before it
builds for a deploy, so if it passes here the deploy gate passes. Node is 22 on a dev
box and 24 in the workflows.

## Adding a site

```bash
node scripts/new-site.mjs <slug> "Name" "One-sentence tagline" [emoji] \
  [--accent=#rrggbb] [--cadence="Rebuilt daily"]
node scripts/build-all.mjs --only <slug>
```

The scaffolder creates `<slug>/` with a build and verify that honour the `OUT_DIR`
contract, a README and a CLAUDE.md, seeds `data/data.json`, and registers the site in
three files: `sites.config.json`, the README table and the Sites table below. What it
generates builds and deploys as it stands; run `build-all` once to confirm the pipeline,
then replace the data and the rendering in `<slug>/scripts/build.mjs`.

The two doc tables are found by row shape, so a table that has drifted produces a
warning naming the row to add by hand. Read the scaffolder's output. No workflow lists
sites by name, so there is nothing to register there.

## Build

`sites.config.json` is the registry. `build-all.mjs` validates it, then for each entry:

1. runs the site's `build` with **`cwd` = the site's directory** and **`OUT_DIR` =
   `dist/<slug>/`**;
2. runs its `verify`;
3. applies the checks every site must pass: `index.html` exists and has a title, no
   `src` or `href` starts with `/` (it would 404 under `/<slug>/`; link to the index
   with `../`), and every local file the HTML references was emitted;
4. stamps every local script and stylesheet URL with a content hash (`./app.js?v=…`),
   including import specifiers inside emitted scripts.

Then it renders the landing page (with a client-side search over each site's name,
tagline, slug and cadence), `404.html`, `robots.txt`, `sitemap.xml`, `.nojekyll` and
`CNAME`. If anything fails for any site the run exits non-zero with one line naming the
site and the step.

`--only <slug>` and `--skip <slug>` narrow the run while iterating. Both are refused
when `CI` is set: a Pages deploy replaces the entire site, so uploading a partial
`dist/` would delete the sites left out.

A site can be built alone: `node <slug>/scripts/build.mjs` writes `dist/<slug>/`.
A site's `verify.mjs` expects that unstamped output, so do not point it at a
`dist/<slug>/` that `build-all` has already stamped.

## The OUT_DIR contract

A site's build writes a complete static site into `OUT_DIR`, and into `dist/<slug>/`
when the variable is unset. It clears the target first, and refuses to when the target
holds the site's own source or is a non-empty directory that is not a previous build.

Inside a site, reference assets by plain relative path (`./app.js`, `./styles.css`,
`from './maths.js'`). Sites never version their own asset URLs: `build-all` does it,
after verify. Pages serves everything with `max-age=600` and a page and its scripts
expire separately, so without the stamp a returning visitor can pair new HTML with an
old cached script and the page breaks on load.

## Publishing

**Only `main` deploys.** `publish.yml` runs on every push to `main` that is not
documentation-only (`**/*.md`, `docs/**`, `.claude/**`), on its 13:17 UTC cron, on manual
dispatch, and when a research run on `main` finishes. It has four jobs: `check` (calls
`ci.yml`), `build`, `deploy`, and `data-commit`. Work pushed to a branch publishes
nothing, and nothing reports that: a change that looks finished but is invisible on the
domain is almost always still sitting on a branch. Say what is merged, not what is
written.

```bash
git fetch origin && git checkout main && git pull --ff-only origin main
git merge <branch> && git push origin main        # this is what deploys
curl -s -o /dev/null -w '%{http_code}\n' https://sites.jackhammons.com/<slug>/
```

Pull first: the workflows commit `pizza/data/*.json` to `main` every day, so a local
`main` is usually behind, and those files should never be hand-edited on a stale
checkout. Pages serves the new build about a minute after the run goes green; poll for
the 200 rather than reporting a merge as a deploy. The run rebuilds **every** site, so a
site you did not touch can still fail the deploy for the one you changed.

Scheduled runs start hours late in practice (the 13:17 UTC cron has started between
18:00 and 23:00 UTC). Nothing may depend on the time of day a workflow runs.

## Checking a site in a browser

These pages are finished by the browser, so a build that verifies clean can still be
visibly broken. Look at the page. Chromium and Playwright are installed
(`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`; never run `playwright install`).

```bash
node scripts/build-all.mjs --only <slug>
cd dist && python3 -m http.server 8099 &      # serve it: file:// hides subpath bugs
```

Drive it with `require('/opt/node22/lib/node_modules/playwright')` against
`http://localhost:8099/<slug>/`, and vary the context: `colorScheme` (both palettes are
defined), `locale`, `timezoneId`, a phone-width viewport. That is how the clock's `Intl`
crash on an `en-US@posix` locale tag was found, which no build check would have caught.

The browser cannot reach the public internet from here. Outbound HTTPS goes through the
agent proxy and Chromium is not configured for it, so `page.goto` on a live URL fails
with `ERR_CONNECTION_RESET` while `curl` on the same URL returns 200. To check what is
actually deployed, `curl` the files down and serve them locally.

## Sites

Read a site's `README.md` before editing it: it holds that site's rules and is loaded
by the `CLAUDE.md` beside it. The pizza site has a long `pizza/CLAUDE.md` of its own.

| Slug | Dir | Stack | What it is |
|---|---|---|---|
| `pizza` | `pizza/` | Node, no deps | Seattle pizzerias ranked by a published method, rebuilt daily from data a research agent maintains. |
| `clock` | `clock/` | Node, no deps | A live clock; the build emits a shell and the browser fills every figure. |
| `mortgage` | `mortgage/` | Node, no deps | A mortgage calculator computed entirely in the browser. |
| `life` | `life/` | Node, no deps | Conway's Game of Life on a full-viewport canvas. |
| `screen` | `screen/` | Node, no deps | TV and projector sizing, computed in the browser. |
| `words` | `words/` | Node, no deps | A word counter, computed in the browser as the viewer types. |

The browser-computed sites share one pattern: the logic lives in modules with no DOM
in them (`mortgage.js` and `inputs.js`, `screen.js`, `count.js`, `life.js`, `time.js`),
imported by the page's `app.js`, by the unit tests, and by `verify.mjs` from the *built*
copy. One implementation of each; never fork it. No figure that depends on the date is
baked in at build time, because it would be wrong by however long ago the deploy ran.

`screen/` and `words/` also carry a Playwright check for what needs a layout engine
(`screen/test/browser-sweep.mjs`, `words/test/browser-check.mjs`). They run on a dev
box, not in CI: run them after changing what those pages draw.

## Things that will bite you

- **Pushing to a branch publishes nothing.** Only `main` deploys. Verify with a `curl`
  against the live URL before calling a site shipped: `clock/` was built, verified and
  pushed to a branch, and reported as done while the domain 404'd.
- **A Pages deploy replaces the entire site.** Never add a second workflow that calls
  `deploy-pages`; it would delete the other sites' output. `publish.yml` is the only
  workflow allowed to deploy.
- **If any site's build fails, the whole run fails and nothing deploys.** This is
  deliberate: the previous deploy stays live instead of a half-built site.
- **`ci.yml` is the one definition of the checks**, and it lists no site or test file by
  name. It runs on every branch push; `publish.yml` calls it as its `check` job, so
  nothing deploys from `main` unless the same checks pass in that run.
- **Data commits are off the deploy's critical path.** The build job commits refreshed
  pizza data with `scripts/commit-data.sh`. If that push fails the site still deploys
  and the `data-commit` job turns the run red. The script pushes only the one commit it
  makes and refuses a checkout that is ahead of `main`.
- **Only `main` commits data or deploys.** A manual dispatch of `publish.yml` on a branch
  runs the checks and the build and stops. A manual dispatch of `research.yml` on a
  branch is a dry run that commits nothing and triggers no publish.
- **Third-party text must not be able to fail the deploy.** Feed headlines and
  agent-written notes reach the pizza page daily. Verifiers test visible text for
  `undefined`/`NaN`, never raw bytes: a news URL contains those letters often enough.
- **Enabling Pages cannot be automated.** A workflow's `GITHUB_TOKEN` is refused on the
  Pages *create* API regardless of repo visibility, and the Claude GitHub App has no
  Administration or Pages permission. It is a one-time manual step per repo, which is
  the reason sites live here as subdirectories instead of in separate repos.
- **One custom domain per repo.** A `CNAME` applies to the whole Pages site, not per
  subdirectory. `build-all` writes it from `customDomain` in the registry.
- **Don't commit `dist/`.** It is generated and gitignored.
