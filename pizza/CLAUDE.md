# pizza/ — The Seattle Pizza Index

Rules for working in this directory. `README.md` here explains the method and the
layout; this file is the list of things that are easy to get wrong. Repo-wide rules
(build, publishing, the deploy gate) are in the root `CLAUDE.md`.

```bash
node --test pizza/test/*.test.mjs        # unit tests
node pizza/scripts/check-dataset.mjs     # lint data/restaurants.json, and what the scripts write into data/candidates.json
node pizza/scripts/check-dataset.mjs --normalize   # after a hand edit: put every entry into the schema's shape
node pizza/scripts/build.mjs && node pizza/scripts/verify.mjs    # -> dist/pizza/
```

Never run `fetch-buzz.mjs`, `geocode.mjs`, `fetch-candidates.mjs`, `verify-research.mjs`,
`apply-research.mjs`, or a build with `SNAPSHOT=1`, against the checkout unless the
point is to change `data/`: they all write there. The workflows commit `data/*.json` to
`main` daily, so pull before editing any of it.

## Where things are

- `src/slice.js` is the scoring algorithm, run at build time only. The page has no
  reader re-weighting (removed by request); every card explains its inputs instead.
- `scripts/build.mjs` composes the page from `build/` (`load`, `derive`, `page`,
  `sections/*`, `emit`). The methodology copy is in `build/page.mjs` and
  `build/sections/method.mjs`; the research tasks' rows are in `build/tasks.mjs`. The
  directory is `build/sections/directory.mjs`, and there is no Candidates section.
- `src/registry.js` is the one list of places the page knows: every entry on file and
  every candidate that is a place of its own, each in exactly one category.
- `scripts/verify.mjs` gates the deploy. `src/app.js` is the browser's one entry: the
  directory's state, the map, and the chart's tooltip. It imports `search.js` and
  `palette.js`; a module it imports must be in the copy list in `build/emit.mjs`.
- `scripts/next-task.mjs` picks and briefs the research agent's daily task;
  `src/validate-research.js` + `scripts/verify-research.mjs` validate what it wrote;
  `scripts/apply-research.mjs` applies it; `src/check-dataset.js` lints the result.
- `src/schema.js` is the one list of an entry's keys, and the normaliser. `src/rules.js`
  holds the worklist sizes, the rest periods and the rotation; `next-task.mjs` draws
  with them and the page prints them, so write a number there and nowhere else.
- Leaflet is vendored in `src/vendor/`. `app.js` fetches it on demand, when the map is
  about to be seen, from the literal `'./leaflet.js'`. It is outside the ES import
  graph, so `verify.mjs` checks that literal and that the emitted file is byte-identical
  to the vendored one.

## Scoring (SLICE)

- **Three factors are computed, two are graded.** Reputation, critical reception and
  value derive at build time in `slice.js`; never store them. Craft and distinctiveness
  (and the critic base) live in `factors` with provenance (`setBy`, `source`, `sources`,
  `note`, `date`), graded by the research agent from published coverage. A rating the
  agent set is write-once: never overwrite it from a script.
- **Every rating comes from the research agent.** The index launched with 25 ratings
  typed in by hand (`setBy: "editorial"`); all have been replaced, and `check-dataset.js`
  refuses any `setBy` but `agent`. `isLaunchRating()` in `slice.js` and the dispatch-only
  `rerate` and `sources` tasks remain as the path that replaced them, with worklists
  that are now always empty. The page never describes a rating as editorial or
  founding, and `verify.mjs` gates on that.
- **Reputation can lift a score and never lower it.** It has two components, longevity
  ×3 and coverage ×1, combined as the best weighted mean over the components present, so
  an added component never lowers the factor. The factor is then counted only when it
  is measured *and* counting it does not lower the score; otherwise its weight is shared
  by the other four. Before this rule an entry with nothing on file outranked
  better-documented ones, and its first press mention cost it up to 17 points.
- **Critical reception** is the critic base plus a recency-weighted mention boost capped
  at +1.5. **Value** is (craft + critical)/2 × a price multiplier.
- **The methodology section prints the constants from `slice.js`.** Change a formula and
  the copy in `build/page.mjs` must change with it, and `ALGORITHM` must be bumped.
- **Snapshots carry `algorithm`.** `ALGORITHM` is stamped on every weekly snapshot in
  `data/history.json`. The record chart draws a rule at a change and the evidence line
  says "the scoring method changed" instead of inventing a cause. Snapshots are keyed by
  ISO week, so the daily run overwrites the current week rather than appending. Only
  `publish.yml` writes one (`SNAPSHOT=1`); a local or CI build must not move the
  baseline.
- **The top ten is computed, not stored.** `splitTiers()` publishes the ten
  highest-scoring entries with `status: "open"`; anything else is held out whatever it
  scores. Ranks 11+ render in the directory table. `isRated()` decides who competes:
  craft, distinctiveness and critical all present in `factors`. Import it; do not write
  the rule out again.
- **Freshness is the newest verification of any kind.** `verifiedDate()` reads
  `statusChecked`, `locationsVerified`, `lastVerified` and the graded factors' dates;
  decay runs from the newest. Anything that explains a score movement must read the
  same date (`r.verified`), not `lastVerified` alone.
- **There are no crowd figures.** No entry carries a star average or a review count, and
  nothing scores or prints one. Yelp answers 403 to automated reads and no API key is in
  use, so a stored figure could not be kept current. Do not build a star or review-count
  pipeline; three runs burned their budget rediscovering the 403. `check-dataset.js`
  refuses a `crowd` key on an entry, and the validator refuses a `ratings` section.

## The dataset

- **One shape for every entry.** Every entry carries every key in `src/schema.js`, in
  that order, with `null`, `[]` or `{}` where nothing is on file, so "not known" is
  written one way. `apply-research.mjs` normalises on every run and the lint refuses a
  missing or unknown key (inside a location, a factor and a mention too). To add a key,
  add it to the schema first, then run `check-dataset.mjs --normalize`.
- **One database, three statuses.** `restaurants.json` holds every pizzeria on file:
  `open`, `opening` (the radar), `closed` (struck through in the directory, held out of
  the ranking, listed under recently-closed for six months). `attributes` is a flexible
  flag map; its registry (`data/attributes.json`) carries label + frictionCost per key.
- **Two dates on a status.** `statusDate` is when a status took effect, as the source
  reports it, and stays `null` when the source does not say; `statusDetected` is the day
  the pass recorded it. Only `statusDate` is ever printed as "since" or as a closure
  year. Writing the detection day into `statusDate` published a March 2024 closure as a
  2026 one.
- **Seattle is the inclusion rule.** An entry qualifies by having at least one location
  inside Seattle city limits. Suburban branches of a qualifying chain are kept in
  `locations[]` and listed in the directory, but the map plots, and the geocoder looks
  up, Seattle addresses only (matched by `, Seattle, WA`).
- **Locations are verified data; `neighborhood` is not.** `locations[]` is written only
  by `apply-research.mjs` from a pass that read the pizzeria's own locations page.
  `neighborhood` is the original editorial string and the fallback. Never render
  `r.neighborhood` directly; use `locationLabel(r)` from `src/locations.js`.
- **A permit address is a lead, never a location.** `branchLeads()` in `src/census.js`
  lists, per open entry, the Seattle permit addresses of candidates whose `matchedId` is
  that entry and that match none of its locations. Such an entry leads the locations
  worklist and its row lists the addresses for the agent to confirm on the pizzeria's
  own pages; a duplicate permit can be a commissary or a second registration. A lead
  does not bypass the 30-day rest, so one that cannot be confirmed costs a look a month.
- **One geographic rule.** `src/bounds.js` holds the ZIP pattern and the lat/lon box,
  imported by the validator, the geocoder and the lint, so an address the validator
  accepts cannot fail the lint once geocoded.
- **Candidates have coordinates too.** `geocode.mjs` fills `lat`/`lon` on every candidate
  the page lists (`candidateIsShown()`: not promoted, not a duplicate), after the
  restaurant locations and inside `CANDIDATE_GEOCODE` in `rules.js`: 60 requests or 90
  seconds a run, whichever comes first, and three failed requests in a row end it. An
  address that finds nothing is stamped `geoTried` and rests 30 days; a failed request
  stamps nothing. Coordinates survive a seed refresh while the address is unchanged, and
  any verdict. `publish.yml` lists `candidates.json` in its data commit for this.
  `check-dataset.mjs` lints the coordinates, the stamp and the sweep cursor and nothing
  else in that file: a permit name or a note is third-party text.
- **`links` is the one channel for web presence.** `{id, website?, instagram?, source}`:
  instagram must be a real profile URL the agent saw linked or named (never guessed);
  `website` fills `url` only when the entry has none. `nameLink()` renders
  `url ?? instagram`.

## The research agent

- **Agents stay out of the deploy path.** `research.yml` runs the Claude Code Action to
  write `data/research.json`, in its own workflow. If it hangs or fails, the site still
  publishes.
- **The agent never shares a runner with a token that can write.** `research.yml` has
  two jobs. `agent` reads the open web with a read-only token; its write grant is
  `Edit(pizza/data/research.json)`, a guard step fails the run if `git status` shows any
  other path, and the one thing that leaves the runner is `research.json`, as an
  artifact. `apply` starts from a fresh checkout, takes that file, validates it, applies
  it, builds and verifies the page from the result, and commits. Anything else must not
  cross between the two jobs. The action is pinned to a commit: bump it deliberately,
  with a dry run.
- **The agent does not see this file.** It runs with `--setting-sources user`, so no
  `CLAUDE.md` and no `.claude/settings.json` from the repository is in its context. Its
  whole instruction is the brief from `next-task.mjs` plus the prompt in `research.yml`.
- **Try a change with a dry run.** Dispatching `research.yml` from a branch runs both
  jobs and commits nothing, and publishes nothing. That is how to test a brief, a prompt
  or schema change, a new model or a new action version; the agent job's log prints
  `num_turns` and `total_cost_usd`. A pass costs roughly $0.30 to $1.
- **Never mention a script the agent cannot run.** The prompt once named
  `verify-research.mjs`; the agent tried to run it, had no Bash tool, and stopped to ask
  for approval in an unattended job. Six runs were lost to that. Two more rules keep it
  green: every brief carries a search budget, and the agent step is `continue-on-error`
  with the *next* step judging the file, so a turn-ceiling overrun cannot discard work
  already written. Briefs are code (`next-task.mjs`); the fixed rules and the schema
  live in the `research.yml` prompt so no task can drop them.
- **One task per run.** In auto mode `next-task.mjs` picks, among discovery, locations,
  liveness, news, rating, census and facts (`ROTATION` in `rules.js`), the type whose
  last successful pass is oldest *and whose worklist is not empty* (dates are read from
  `chore(data): research pass (<type>)` commit subjects, so a failed day is retried and
  a dispatch counts). Census has work only when the candidates queue has something
  pending; facts only while an open entry lacks a fact no recent attempt looked for. A
  forced type (the workflow's `task` input) runs as given, including the dispatch-only
  ones: `social`, `coverage`, `sources`, `rerate`, `serves`. Only a forced type can come
  back `skip=true`.
- **Every worklist needs attempt memory.** A task that redraws the entries it could not
  resolve stalls: locations verified nothing for three passes that way. Rating, facts,
  locations, coverage and social each have a `…Skipped` section the agent fills for
  entries it could not resolve, which stamps `…Attempted` so the entry rests (30 days
  for locations, 90 for the others). Liveness sorts by age of last check. A new task
  needs the same, for the entries it resolved as well as the ones it could not: a
  coverage pass that filed a mention stamped nothing, so every entry that gained one
  stayed "never attempted". The apply step is told the task (`RESEARCH_TASK`) and
  stamps `coverageAttempted` for a coverage pass's `mentions` too.
- **Facts remembers per fact.** The task fills `opened`, `priceIndex`, `style`,
  `styleGroup` and `signature`. `factsSkipped` stamps `factsAttempted` and stores
  `factsSought`, the facts that pass looked for and did not find; an entry rests only
  while everything it lacks is on that list, and a stamp with no list means year and
  tier only (the whole task, when those stamps were made). A `facts` record alone
  stamps nothing, because the locations task files a two-field one in passing.
- **What the agent may write**, all through `verify-research.mjs` → `apply-research.mjs`:
  `news`, `mentions`, `locations` (+homepage), `status`, `directory` (new entries;
  deduplicated by normalised name and by street address), `factorRatings`,
  `factorSources`, `facts`, `links`, `candidateReview`, `servesPizza`, and the five
  `…Skipped` sections. Nothing the agent writes can change `data/attributes.json`: that registry
  is edited by hand, because a friction cost moves a score and carries no source.
- **Facts fill gaps only, each with its source.** A `facts` record carries what one
  source page states and writes the matching source key (`openedSource`, `priceSource`,
  `styleSource`, `styleGroupSource`, `signatureSource`); a fact on file is never
  replaced. `style`, `styleGroup` and `signature` describe the place, so their source
  must be the pizzeria's own site or menu, or published coverage: an aggregator, a
  delivery app or a directory listing is refused for them.
- **A closure needs a citation the validator can tie to someone.** A news report, the
  pizzeria's own site, or a post on the Instagram or Facebook account already on file
  for that entry, with the account name in the URL. A review site or aggregator (matched
  by registrable name, so `yelp.ca` is `yelp`) is a lead, not evidence, and a bare
  `instagram.com/p/<id>/` link belongs to nobody.
- **Records are rejected one at a time.** `verify-research.mjs` drops the records that
  fail, emits a warning per drop, writes the accepted set back to `research.json`, and
  fails the run only on a structural problem. Unknown top-level keys are ignored with a
  warning. Free text and addresses may not contain `<` or `>`.
- **A `…Skipped` section never fails a file, and its note never costs the record.** A
  note over the limit is cut to it and kept: refusing it dropped the record, the entry
  was never stamped, and the next pass drew it again (twice in one rating pass). The
  section keeps one record per id, up to twice the largest worklist that task serves
  (from `rules.js`), and drops the rest one at a time with a warning. `servesPizza` is
  capped the same way, at twice `PER_PASS.serves`. An agent that wrote 16 "nothing found" records for a 10-entry
  worklist once cost a whole coverage pass, mentions included. Every other section's
  cap is structural and still fails the file.
- **Ratings fill gaps, and replace launch ratings.** `factorRatings` proposals carry
  craft, distinctiveness and criticScore (all three, or the entry can never rank), 0–10
  in 0.5 steps, with 1–4 read sources of which at least one is published criticism. The
  validator refuses a proposal for an entry the agent has already rated. On a launch
  rating the apply step replaces all three graded factors with nothing of the old object
  kept, and leaves `opened`, `priceIndex` and `styleGroup` fill-gaps-only; `rerate`
  draws 7 per pass and never shows the agent the values on file. A `ratingSkipped`
  record for a launch rating stamps `ratingAttempted` and leaves the rating for a person
  to review. `factorSources` attaches citations and never changes a value. An unrated
  entry with no findable coverage is a deliberate terminal state.
- **The candidates queue is the discovery funnel's top.** `data/candidates.json` is
  seeded by `scripts/fetch-candidates.mjs` from King County food-permit data. Candidates
  are leads, never entries: the `census` task verifies each through the `directory`
  channel or records why it does not belong through `candidateReview`. The apply job
  refreshes the seed once it is a month old (`--max-age-days=30`; `checked` is the last
  refresh, `updated` the last change), and a new candidate gives census a worklist.
- **A verdict is not for ever.** A candidate set aside as `closed`, `unverifiable` or
  `not-pizza` returns to pending when a seed refresh shows a permit inspection dated
  after the verdict, with the old verdict kept as `previousVerdict` and shown to the
  agent as an earlier finding. `chain` and `duplicate` never return.
  `candidateStanding()` in `src/census.js` is the one statement of where a candidate
  stands; the page's registry reads it.
- **A duplicate names what it duplicates.** A `candidateReview` with verdict `duplicate`
  must carry `duplicateOf` (an id on file), stored on the candidate as `matchedId`.
  Without it a branch's address is thrown away, which is how A Pizza Mart sat on file
  with one of its six shops. `matchEntry` sets aside a trailing parenthetical in an
  entry's name.
- **The seed cannot see a place that serves pizza under another name.** The register has
  no cuisine field and the seed query matches permit names containing PIZZ or SLICE, so
  Bar Cotto (two Seattle permits) can never enter the queue from it. Those places are
  filed by the agent as `servesPizza` (`{name, address, neighborhood, note, source}`) and
  the apply step makes each a candidate with `sources: ["research"]`, already
  `rejected`/`not-pizza`, with no `lastInspection`. The validator refuses a name or street
  address on file ("already on file") and a key or street address anywhere in the queue
  ("already known"); the source may not be an aggregator, delivery app, directory or
  social profile.
- **A research-filed candidate does not churn.** `candidateOrigin()` in `src/census.js`
  is `research` when `sources` is research alone. A seed refresh never rewrites one, an
  inspection never reopens one, and `candidateStanding()` reports `origin` and
  `reopens: false`. It joins the directory one way: a pass files it through `directory`,
  which does not consult the queue, and the apply step marks the candidate `promoted` with
  `matchedId` and keeps the old finding as `previousVerdict`. The same happens to a permit
  candidate set aside as closed, unverifiable or not-pizza when the same file adds an
  entry of its name.
- **The serves sweep remembers by cursor.** `serves` is dispatch-only and walks
  `NEIGHBORHOODS` in `rules.js`, `SERVES_HOODS_PER_PASS` at a time. `servesCursor` sits at
  the top of `data/candidates.json`: the brief starts from it, the apply step moves it
  when `RESEARCH_TASK` is `serves` whether or not anything was filed, and
  `fetch-candidates.mjs` writes back any top-level key it does not own. `servesSweep()` is
  the one function both ends read. Add a neighbourhood at the end of the list; never
  reorder it. `discovery` may file up to `SERVES_IN_PASSING` such records and moves no
  cursor.
- **The permit register's `city` is free text.** It spells Seattle several ways, and a
  query that compared it with `=` missed a quarter of the city's permits, Jet City Pizza
  among them. The query matches `upper(city) like '%SEATTLE%'` and `isSeattleCity()`
  settles the set; never compare `city` with `=`.
- **Set exactly one research credential.** `CLAUDE_CODE_OAUTH_TOKEN` or
  `ANTHROPIC_API_KEY`. If both are set the API key wins and bills per token while the
  subscription allowance goes unused; the gate step warns. The model is named once, as
  `RESEARCH_MODEL` in `research.yml`. There is no credential probe: a direct API call
  with the subscription token only ever answered 429, so the agent step is the signal.

## What the page says about itself

- **The page describes the automation from the code that runs it.** The lifecycle
  flow, the two step lists and the task table in the methodology read `rules.js`,
  `census.js`, `locations.js` and `slice.js`; no worklist size, rest period or cutoff
  is typed into the copy. A task added to `ROTATION` with no row in `build/tasks.mjs`
  stops the build, on purpose. A by-hand task whose work has run out for good
  (`done` in `build/tasks.mjs`) is not named.
- **No clock time anywhere in that copy.** Scheduled runs start hours late, so the page
  says "once a day" and what triggers what, never an hour. A page test holds this.
- **One list of places behind every section.** `src/registry.js` puts every place in
  exactly one category: ranked, unrated, not open yet, closed, waiting for a census
  pass, national chain, not pizza-forward, could not be verified. A section that lists
  or counts places reads `ctx.registry`; it never filters `dataset.restaurants` or reads
  `candidates` itself. The Radar's two lists are the registry's opening category and
  its closed one inside six months. A reader once found places called closed in the
  Radar that the "Closed" list did not have, because the two read different files:
  closed is now one category, entries first, then places known only from a permit.
  A printed count carries `data-count`, and `verify.mjs` holds it, the rows of every
  category and the Radar's rows to the registry.
- **The directory is the whole list, by category.** Each category is a `<details>`
  with its rule and what brings a place back; only ranked is open by default. One
  state drives the list and the map: a category that is on is expanded and its pins
  are shown. `id="candidates"` survives as the heading over the categories that are
  not on file, for old links. Without JavaScript the headings still open and every
  row is in the HTML.
- **The tools exist once.** `#dir-tools` (the search field and the category toggles) is
  rendered hidden and moved into `.dir-pin` when there is a map, back above the list
  when the map is dropped. Set no `display` on `.dir-tools` without `.has-tools`;
  sticky offsets under it use `--tools-h`, which `app.js` measures.
- **Colours are defined once, in `src/palette.js`.** `styles.css` uses only `--cat-*`,
  `--pin-line` and `--rank-ramp`, which the build writes from it. Ranked pins run from
  blue at the lowest rank through teal, green, yellow and orange to red at #1
  (`rankColor`, `RAMP_STOPS`); the first ramp went blue to red through purple and read
  as a smear. Every pin is one size and the top ten have a heavier outline on the same
  pin, not a second circle round it; a place not on file is a hollow pin. The other
  pizzerias on file take the hues the ramp leaves: violet, magenta and a grey.
- **Toggling a category never moves the map.** It opens on a view that holds every
  pin of every category and stays where the reader puts it. Only a search moves it, to
  the matches, and clearing the search puts it back. It used to refit on every toggle
  and lurched in and out. The record chart has its own
  eight series colours (`--series-N`) and three line styles (`build/chart.mjs`): a
  ninth line reuses the first colour dashed, and no colour is generated.
- **Location is asked for only on a press, and never stored.** "Show my location"
  calls the browser's prompt when pressed, or at once when the site is already
  allowed. The position stays in the page.
- **The record chart is the only view drawn of the record.** The table of the same
  weeks is in the markup inside `.chart-data`, hidden from the screen, for a reader who
  cannot see the chart. The class goes on a block round the table: a table ignores a
  width set on itself and stretched the page 1,000px when it was tried.
- **Run `node pizza/test/browser-check.mjs` after touching `app.js` or `styles.css`.**
  It is a dev-box Playwright check, not CI. In it use `checkVisibility()`: a row inside
  a closed `<details>` still has rectangles in Chromium. The inlined CSS has no
  comments (the build strips them), so a verify mutation must target rule text.
- **Every directory record has the same rows.** Each fact, link and status row is
  printed for every entry, with "not on file" where the dataset holds the empty value.
  A new schema key that a reader should see gets a row there.
- **Candidate notes are third-party text too.** `candidates.json` is in `verify.mjs`'s
  quoted-data exemption with headlines and agent notes, and a permit name is printed as
  the register spells it, apart from a capitalised possessive (`tidyPossessive`).

## Buzz and the deploy gate

- **`fetch-buzz.mjs` is keyless and fails soft.** It sweeps Google News searches before
  every publish build, rewrites `data/buzz.json` only when the list of stories changed
  (`updated` is the last sweep that changed it), and exits 0 on any failure. It is what
  keeps the buzz section current without the agent.
- **Google News re-dates old articles.** A feed story labelled opening whose every tagged
  entry is on file as closed, or as opened two or more calendar years before the story's
  date, is dropped at merge (`staleOpening`). That also drops a real story about an
  established pizzeria opening a new branch; those reach the page only when the research
  `news` task files them.
- **Under 1100px the map is pinned and its rail has no box.** `.dir-rail` is
  `display: contents` there, so `.dir-pin` can stick inside the layout while the
  entries scroll beneath it. Observe or measure `#map` or `.dir-pin`, never `#map-rail`,
  and set no `display` on `.dir-rail` without `.has-map` (it is rendered `hidden`).
- **Headlines and agent notes are third-party text.** They must never be able to fail
  `verify.mjs` or reach the page unescaped, in the static HTML or in a map popup.
- **`verify.mjs` checks what it claims.** When adding a check, prove it by mutating a
  built copy and watching it fail; a check that greps for a string the inline data blob
  always contains is not a check.
