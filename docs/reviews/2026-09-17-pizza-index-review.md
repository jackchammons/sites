# The Seattle Pizza Index: a top-down review

Reviewed 2026-09-17 against `main` at `03f849f`. The deployed page at sites.jackhammons.com/pizza/ matched the local build except for the build date, so everything below applies to what readers see today.

## Verdict

The Seattle Pizza Index is a well-built site whose ranking does not yet do what its methodology says, and whose research agent is trusted further than its controls justify.

The engineering is unusually careful for a side project. One scoring module is shared by the build and the browser, and the two agree exactly. Every record the agent proposes is validated before it can touch the dataset, and in 77 runs no invalid record has got through that channel. The deploy is fail-closed, and that has already kept a broken build off the domain once. The desktop design is handsome, the record chart is the best element on the page, and the commit history is better documentation than most projects' wikis.

Four things undercut it.

1. **The score measures data availability more than pizza.** A 24-point factor is zero for 29 of the 52 rated entries because no founding year is on file. The freshness penalty is permanent for the 15 original entries the rotation never re-verifies. The two computed factors the agent was built to feed receive almost nothing from it. Removing the missing-data penalties alone reorders 44 of 52 entries and changes the published ten.
2. **The page publishes facts that are wrong.** A closure is dated two and a half years late and shown as "recently closed". Every date-only provenance stamp renders a day early. Two founding years on top-ten cards are wrong, and correcting them swaps #3 and #4. One ranked entry carries another entry's address, website and Instagram. A top-five pizzeria's official link returns 404. The methodology says ratings are "not hand edits" and cites a rubric that has never been in the repository.
3. **The agent is confined by a sentence, not a control.** Its Write tool is unscoped, nothing checks that it changed only `research.json`, and the validator, apply and lint scripts run from the tree it can edit, with the repository token in scope. A prompt on a pizzeria's web page is never declared to be data rather than instruction. The gate that makes the site trustworthy guards one channel; the agent is not held to that channel.
4. **The process is fast but brittle.** All 77 development commits went straight to `main` with no checks on a branch. The one deploy freeze so far was caused by the agent's own data commit, which the research workflow lands without rendering the page. The README and the landing-page tagline describe an algorithm retired on 26 August.

None of this is expensive. The first week of the plan is small changes to `slice.js`, `apply-research.mjs`, `next-task.mjs`, `render.js`, the page copy and the two workflow files. Three decisions need the maintainer: which reputation formula to adopt, what Breezy Town Pizza is today, and what the 25 founding ratings actually are, because git says a Claude session typed them and the page says an editor did.

## How this review was done

Seven reviewers each took one dimension: the ranking algorithm, page UX and accessibility, page content and documentation, build and code quality, the autonomous research loop, CI/CD and process, and data quality. Each worked read-only against the repository, the built page served locally, the live site over curl, the GitHub Actions history and the full git history. Every finding then went to an independent verifier instructed to refute it. A completeness critic then read the verified list, named what the seven had not asked, and two further investigations ran on those gaps with their own verifiers. I reproduced every headline number myself: the counterfactual rankings, the calibration histograms, the date bug, the contrast ratios, the tie-break, the Aug 27 timeline, the data records named, and the provenance facts in git.

| Dimension | Findings | Confirmed by verifier | Refuted or reduced to low | Confirmed by me only |
|---|---|---|---|---|
| Ranking algorithm | 10 | 10 | 0 | 0 |
| Page UX and accessibility | 12 | 11 | 1 | 0 |
| Page content and docs | 12 | 12 | 0 | 0 |
| Build and code quality | 12 | 8 | 0 | 4 |
| Research loop | 12 | 12 | 0 | 0 |
| CI/CD and process | 8 | 7 | 1 | 0 |
| Data quality | 12 | 9 | 3 | 0 |
| Gap: agent trust boundary | 5 | 5 | 0 | 0 |
| Gap: founding-data provenance | 5 | 1 | 0 | 4 |

Of 88 findings, 75 were confirmed by a verifier, 5 were refuted or reduced to low, and 8 were confirmed by my own reproduction when their verifiers were cut off (an account spend limit for the code findings; a safeguard misfire for the provenance findings). The critic judged the seven-area list "deep and well evidenced" but heavily duplicated (78 findings collapse to about 50 distinct issues); the findings below are the merged list. The refuted five are in Appendix A.

## What is working, and should be kept

- **One algorithm, exact parity.** `src/slice.js` is a dependency-free module imported by the build, the browser and the tests. The browser fixes `now` to the build timestamp, so re-ranking reproduces the printed scores exactly in three time zones.
- **The validation channel.** `validate-research.js` is a pure, tested function. The order verify, apply, lint, commit means nothing that arrives through `research.json` reaches the dataset unchecked. 21 of 27 agent ratings cite named critics. Every agent-written string reaching the build is escaped. The limit of that guarantee is finding T1 below.
- **Fail-closed deploy.** `verify.mjs` refused three deploys on 27 August and the previous build stayed live. The tokened commit script with rebase retry has landed 132 bot commits from two overlapping workflows without a push failure.
- **Published constants match the code.** Weights, friction cap, decay, boost cap, half-life, price multipliers and the reputation curve on the page are read from `slice.js`, not retyped.
- **Provenance where it exists is visible.** Every agent-set factor carries who, source and date, and the directory's expanded record shows it, with a source link. The absence of a link on the 25 founding entries is what makes B10 detectable at all.
- **The census worked.** 87 permit-seeded candidates produced 43 promotions and 29 recorded verdicts; all 43 promotions resolve to a real entry.
- **The card copy for the founding ten** is specific and well paced, and where it was checked (Delancey's dough, Windy City Pie's SoDo origin, Moto's story) it matched primary sources.
- **Cost is bounded.** Research passes cost $0.62 to $1.07 and 21 to 48 turns, under a 120-turn ceiling.
- **Commit messages** name the run, the cause and the measurement. The audit trail that made the provenance question answerable exists because of them.

## Findings

Severity: **critical** means a published ranking position or fact is wrong or misleading, the deploy is at risk, or an untrusted input can reach `main`. **high** materially degrades the site or the process. **medium** is worth fixing this quarter. **low** is polish. Effort: S under an hour, M about a day, L multi-day.

### T. The trust boundary around the research agent

**T1. The agent can write anywhere, and nothing checks that it did not. Critical, M.**
`research.yml:161` grants a bare `Write` tool with no path scope; the only confinement is the prompt sentence "Write only pizza/data/research.json". No step between the agent and the gate runs `git status` or `git diff`. The gate scripts (`verify-research.mjs`, `apply-research.mjs`, `check-dataset.mjs`, `validate-research.js`) run from the same checkout the agent can edit, and `commit-data.sh` then stages `restaurants.json`, `attributes.json` and `candidates.json` from that tree. Reproduced in a scratch clone with a bare remote: a direct edit to `restaurants.json` that re-grades Delancey to 2.0 and flips it to closed on a Yelp URL passes `check-dataset` (editorial factors need no source) and is pushed. An edit to `apply-research.mjs` survives the rebase (autostash) and its effect lands. Writing `core.fsmonitor` into `.git/config` gets a command executed by the next `git status`, with `GITHUB_TOKEN` in scope. The verifier also found that Claude Code honours `Edit(path)` rules for the Write tool while `Write(path)` rules are silently ignored, so the fix is `Edit(pizza/data/research.json)` in place of `Write`, plus a guard step that fails the run if `git status --porcelain` names anything else, plus running the gate from a pristine second checkout.

**T2. Fetched pages are never declared to be data. High, S.**
Neither the fixed rules in `research.yml` nor any brief in `next-task.mjs` tells the agent that web content is evidence about pizzerias, not instruction. The validator accepts any schema-valid record a page could induce: a status flip to closed on a top-ten entry citing one real https URL, a forked directory entry, a mention alleging a health closure. All passed. Two sentences in the prompt and a rule that a closure needs a non-review-site source close most of it.

**T3. Two "working well" claims in the reviews were false as stated. Low, S.**
"The agent has no Bash tool and cannot touch the dataset directly" and "nothing unchecked reaches restaurants.json" should read: nothing that arrives through `research.json` reaches it unchecked. CLAUDE.md line 129 and the workflow comment make the stronger claim and should be corrected with the guard in place.

### A. The ranking measures data availability, not quality

**A1. Reputation is zeroed, not renormalised, for 29 of 52 rated entries. Critical, S.**
`slice.js:91` returns 0 when an entry has no longevity, volume or coverage component, and `scoreOne` still gives reputation its full 24-point share. The file's own comment, CLAUDE.md and the methodology copy all say the opposite. None of the 29 has a review count or a mention, so the only thing separating them from the rest is whether an `opened` year is on file. All ten published entries have one. The best entry without one is Breezy Town Pizza at #23 with a graded mean of 9.10, fifth-best quality in the field. Mean score with `opened` is 74.9 against 53.1 without, while graded quality differs only 7.63 against 7.18. Renormalising for those 29 moves 44 of 52 ranks, puts Breezy Town at #7 and drops Mioposto out of the ten.

**A2. Adding reputation data lowers the score. High, S.**
Each present component is averaged in by weight, so a component below full marks drags a full-marks longevity down. Removing the stored review count raises 8 of the 10 entries that have one, and a single press mention costs a longevity-only entry about 3.4 points. The news task is the one reputation input the loop can still write, and the design penalises exactly the entries it adds mentions to. The critic graded this high rather than critical because no published rank is wrong today, only the incentive. The fix should make the combination monotone in added evidence; plain renormalisation over present components is not enough.

**A3. Freshness decay is a permanent penalty, not freshness. High, S.**
The only writer of `lastVerified` is the rating apply, which the validator refuses for any already-rated entry. Liveness writes `statusChecked` and locations writes `locationsVerified`; nothing else touches the decay clock. 15 editorial entries have no `lastVerified` and sit at the 6% cap forever; the top ten is frozen at 2026-08-01. Two reviewers proposed opposite fixes; the consolidated one is to compute the clock as the newest of the verification dates at score time, with the card saying which check it was, rather than stamping `lastVerified` in the liveness loop, which would also mislabel the crowd figures' "Observed" date.

**A4. No write channel exists for `opened` or `priceIndex` on a rated entry. High, M.**
Both are written only inside the rating apply, which skips rated entries. The 29 reputation-zero entries and the 15 price-less entries are stuck unless a human edits the JSON.

**A5. The two rating populations are on different scales, and the founding one is not what the page says it is. High, M.** See B10 for provenance. On calibration alone: editorial craft is 25 values spread 6.9 to 9.6 in 0.1 steps, none on the 0.5 grid the validator enforces; agent craft has 12 of 27 at exactly 7.5, seven at 6.0, mean 6.83 against 8.28; distinctiveness clusters at 6.5. The rating brief carries one anchor for craft and none for the other two factors. Every entry discovered since August competes on a scale about 1.5 points lower than the founding 25, and the page never says there are two populations.

**A6. The published order breaks the stated tie rule. High, S.**
`splitTiers` re-sorts by score then name, discarding the critical-then-craft tie-break that `rank()` applies and the methodology promises. Scores round to 0.1 so ties are common; three reviewers found it independently and one verifier called it understated. Whether the top five is affected depends on the build minute: at some build times Dino's and Serious Pie tie at 84.5 and Dino's is published above Serious Pie despite a lower critical score.

**A7. A missing price tier silently scores at 1.00 and the template renders holes. Medium, S.**
15 ranked entries have no `priceIndex`; the multiplier defaults to 1.00, which the methodology table does not list. Mioposto's #10 card ships an empty price chip and "for the  tier". Rendering all 52 rated cards produces 15 "est. null" and 14 "est. undefined"; the browser re-ranker exposes them on the first alternative weighting a reader tries. Five reviewers found this; it is one guard in `render.js` and one sentence on the page.

**A8. The record chart's first column is a different algorithm. High, S.**
Snapshot W34 (2026-08-23) predates SLICE v2 (2026-08-26). The chart shows Cornelly falling from #1 to #6 and Breezy Town, Lupo and Moto leaving the ten as if the field moved; the formula changed. On a phone those three leavers are the only labels visible. Snapshots carry no algorithm tag, and the plan below changes the formula again, so history needs a rule: tag snapshots with the algorithm version and either start the chart at the first snapshot of the current version or draw a marker at each change.

**A9. `rankings.json` publishes unrounded floats. Low, S.**

### B. Facts the page gets wrong

**B1. Status dates are the day the agent checked, not the event. Critical, S.**
Flying Squirrel Pizza closed on 1 March 2024 (its own cited source and its own stored note say so) but is published as "Closed 2026", listed under "the ones Seattle just lost", and the six-month rule keeps it there. 53 open entries show "Open since Aug 25, 2026" style lines that mean nothing. `statusDate` should mean the event, `statusChecked` the check, and the status schema needs an optional event date.

**B2. Every date-only field renders a day early. High, S.**
`html.mjs` parses "2026-08-27" as UTC midnight and formats it in Los Angeles, giving "Aug 26, 2026". Every provenance stamp in the directory is off by one and disagrees with the ISO date beside it.

**B3. Breezy Town Pizza is a self-contradicting record. Medium, S to decide, M to fix.**
Its neighborhood is Beacon Hill and its blurb says it operates inside the Clock-Out Lounge, but its address, coordinates, website and Instagram are byte-identical to Windy City Pie's Phinney Ridge record, copied by a locations pass. It is the only cross-entry duplicate in the dataset, its blurb still calls it "the most promising promotion candidate on the bench", and the dataset lint has no cross-entry uniqueness check to catch this.

**B4. Dead official links on ranked entries. High, S.**
Serious Pie (#4) links to a Tom Douglas page that returns 404 while the working domain already sits in `locationsSource`; Lupo and Moto Pizza link to domains that no longer resolve.

**B5. The methodology contradicts the code in five places. High, S.**
"Nothing on this page is placed by hand" and "ratings are produced by a bounded research loop, not hand edits" (25 of 52 are not from the loop and have no source). "Every fact on file ... will be re-verified within days" (ratings are write-once; the freshness clock never advances). "Data nobody has verified in a year says so in the score" (the cap is reached at 30 weeks). "Star rating ... never scored" (the review count in the same sentence feeds reputation). "New reviews and list appearances feed it daily" (only agent-filed mentions count; three entries have any boost).

**B6. Crowd figures carry no source and borrow the decay clock as their date. Low, S.**
All ten review counts date from the founding commit and have never changed; the cards print "Observed 2026-08-01", a date 17 days before the repository's first commit, because the template reuses `lastVerified`. Because of A2 the counts slightly lower those ten scores rather than raise them, so this is a disclosure gap, not an advantage.

**B7. Six agent ratings cite no published criticism. Medium, M.**
Sources for 6 of 27 are the pizzeria's own site, HappyCow, OneBite or Wikipedia. The methodology says proposals "need published criticism" and the directory labels each "from coverage"; the validator only checks for https.

**B8. Buzz admits what its own note says it filters. Medium, S.**
A national-chain wire story, a Tacoma opening and a P-Patch fundraiser are listed under a note saying such items are filtered out, because the filter matches "seattle" in the outlet name and lists Tacoma as local. Only 2 of 17 stories are tagged to an entry although at least three concern Abecedary, because matching is title-only.

**B9. Smaller copy defects. Low, S.**
"Published ranking." is an orphan state line under the Top 10 intro. "Rated 52" counts two closed entries. The math table header still says "Pillar". "79 verified entries" describes a directory in which 16 open entries have never been status-checked and 42 have no verified locations. The page invites pull requests without linking the repository and never states the cutoff that separates #10 from #11. There is no license, no correction route and no canonical or share image, so a journalist or owner who wants to cite or dispute the ranking has nowhere to go.

**B10. The founding data is not what the page says it is. Critical to disclose, S; decision needed.**
The facts from git: the dataset entered in commit `87dab3f` on 22 August, authored `Claude <noreply@anthropic.com>`. No human-authored commit has ever touched `pizza/`. The day-one dataset note says pillar scores were "applied uniformly by the rubric in METHODOLOGY.md"; that file has never existed in the repository. When SLICE v2 landed on 26 August, the ten founding craft values were derived arithmetically as `round((26 × crust + 18 × toppings) / 44, 1)` from the v1 pillars, which is why none sits on the 0.5 grid. All 75 editorial factor dates are 2026-08-26, the migration date, not a rating date. Two seeded founding years are wrong: Dino's Tomato Pie opened in March 2016 (Seattle Met, 7 March 2016: "official opening date should be Wednesday, March 9"), not 2015; Cornelly opened in fall 2020 per Capitol Hill Seattle, not 2021. Correcting them swaps Dino's and Serious Pie at #3 and #4 and lifts Cornelly to 83.1. Moto Pizza still stores "Ballard" as its neighborhood; it is in West Seattle. Whether a person made the 25 judgments and had Claude type them is something only the maintainer knows. What the page says today is "editorial judgments applied by one rubric", "stored with provenance: who set them, from what source, and when", and "nothing placed by hand". If the ratings are the maintainer's, the page should say so and the rubric should be in the repository. If they are not, the agent-rated population is the better-sourced one and the founding 25 should be re-grounded through the same cited-coverage channel or labelled as unsourced on the card.

### C. The research loop is not feeding the ranking

**C1. Liveness re-checks the same four entries every pass. High, S.**
The worklist sorts by tier before age, so the one "opening" entry and the three no-website entries take four of six slots on every fifth day; 16 of the last 24 slots went to the same four names. Tutta Bella (#5), The Independent (#8) and Pagliacci (#9) have never been checked. Revisit period for the other 73 entries is about six months.

**C2. Mentions cannot fill the window the ranking reads. High, M.**
The ranking counts mentions over 24 months; the news brief asks for 30 days; the validator rejects anything older than 180 days; the rating pass reads criticism but never files it as a mention; feed-sweep tags are never persisted. After six news passes, 4 entries hold 13 mentions, two of them duplicates. This is why reputation coverage and the critical boost are inert for 75 of 79 entries.

**C3. The rating task has no memory of failed attempts. Medium, M.**
26 entries with no findable coverage recycle to the front of the worklist indefinitely; CLAUDE.md calls no-coverage a terminal state but nothing records it. Only the first of up to four cited sources is stored.

**C4. Whole-file rejection has discarded three complete passes. Medium, S.**
Every record is already validated independently, so per-record rejection with a warning would have been safe in each case.

**C5. A closure is accepted on any https URL. Medium, S.**
A status flip to closed with a Yelp page as the source passes the validator, is applied unconditionally, and removes the entry from every worklist, so a false closure can only be reversed by hand. With T2 this is the injection path that matters most.

**C6. The rotation is a pure function of the calendar. Medium, S.**
A failed day skips that task for five days (the Sep 8 failure cost rating its slot for ten days), manual dispatches never count, and nothing records what was attempted. The commit subjects already record every successful task, so the next task can be the type with the oldest success.

**C7. The discovery funnel is dry. Low, S.**
The candidates queue has had 0 pending since its one seeding on 30 August; the last four scheduled discovery passes landed 1, 2, 1 and 0 entries; a census dispatch now ships an empty worklist to the agent. Skip the agent step when a worklist is empty.

**C8. Agent-found news survives one publish. Low, S.**
`research.json` is replaced by the next day's pass and `buzz.json` never absorbs the agent's stories; they do survive as mentions, which the build could fold into the buzz list.

**C9. Validator gaps. Medium, S.**
A Cyrillic look-alike name forks an existing entry; notes have no length cap; the address rule checks a ZIP pattern anywhere in the string, so a Spokane address with a Seattle ZIP passes. The map popup in `app.js:209` is the one unescaped sink on the page.

**C10. Mention dedup is exact-URL only. Low, S.** Trailing-slash and Google News redirect variants count twice; one mention cites a roundup that does not name the pizzeria.

**C11. Cost and documentation drift. Low, S.** Passes cost $0.62 to $1.07, not the $1.20 CLAUDE.md cites; the preflight probes a different model than the run uses.

### D. The page: right bones, wrong priorities on a phone

**D1. The ranking is 1.4 screens down on a phone. High, M.** At 390 px the first card starts at 1,197 px and the ten cards run 6,000 px; the page is 31,305 px tall on mobile.

**D2. The weight controls are below all ten cards under 1200 px. High, M.** Changing a factor re-sorts a list 6,000 px above the control, the feedback line is off-screen, and nothing is announced. The site's signature interaction appears to do nothing on the majority device.

**D3. Light-palette small text fails contrast. High, S.** The muted ink (#8b7767) measures 3.96:1 and the accent (#e0512f) 3.63:1 on the page background, below 4.5:1, and they carry the score label, movement marker, chips, table headers and metadata. Two token changes fix it; the dark palette passes.

**D4. The directory is a 904 px table in a 365 px box. High, M.** Four of six columns are off-screen on a phone with no scroll affordance; the section is 9,771 px tall; 63 of 79 rows have an empty Notes cell.

**D5. No navigation on a 20k to 31k px page. Medium, M.** No in-page links, no `<nav>` or `<main>`, no skip link, ids on 2 of 8 sections, 611 tabbable elements.

**D6. The record chart hides its legend on mobile. Medium, S.** A 560 px SVG in a 367 px scroller shows 3 of 13 end labels, all three of them the v1 leavers from A8.

**D7. Half the HTML is markup nobody sees. Low, M.** 79 hidden directory detail rows and a second copy of the dataset make up 56% of a 507 KB page. Graded low: 80 KB gzipped, no measured user cost. Falls out naturally once D4 renders rows on demand.

**D8. Accessibility details. Low, S.** 79 directory toggles are 12 by 11 px; the score stack and movement marker carry meaning only in `title` attributes; the reduced-motion rule loses to `html { scroll-behavior: smooth }` on specificity; an `h3` precedes the first `h2`.

### E. Process

**E1. The render gate is in the wrong workflow. Critical, S.**
`research.yml` lints the data shape after apply but never renders the page, then commits to `main`. On 27 August a rating pass added three entries with no `signature`; `render.js` assumed one; the next three publishes failed on "page contains undefined" until a code fix at 06:19. The hole is still open, and with T1 this commit path is the least-guarded write to `main`. A build-and-verify step before the research commit turns it into a red research run instead of a poisoned `main`.

**E2. Research and publish are coupled only by cron proximity. Medium, S.**
Design margin is 30 minutes; observed margin is 15 to 28 minutes because both crons start three to five hours late. A research pass that overruns, or any manual dispatch after the daily publish, sits on `main` for up to a day; the live site was one data commit behind at review time. A `workflow_run` trigger on publish after research completes closes the gap; the event is emitted by the Actions service, not created through the token, so the anti-recursion rule does not suppress it.

**E3. No checks run before `main`. High, S.**
77 development commits, 0 pull requests, tests only in CI after the push. A workflow that builds, tests and verifies on every branch push costs one file and about 90 seconds.

**E4. Every build rewrites `data/history.json` in the source tree. Low, S.** `build.mjs:43` writes the week's snapshot unconditionally, including local and review builds. Put it behind a flag only the publish workflow sets.

**E5. `verify.mjs`'s strongest checks are vacuous. Medium, S.** "Every entry appears on the page" is satisfied by the inline JSON blob and cannot fail; the gate never loads the page, never checks a card per top-ten id, never checks that a location has coordinates.

**E6. Fail-soft scripts are not. Medium, S.** `fetch-buzz.mjs` throws on an unparseable feed date outside its try/catch, which fails the deploy; a partial feed outage shows a fresh "Swept" stamp. `geocode.mjs` has no request timeout and no negative cache.

**E7. `rmSync(OUT_DIR)` has no guard. Low, S.** A mistyped `OUT_DIR` deletes the source directory, and the scaffolder copies the pattern.

**E8. The deploy has no retry. Medium, S.** The 16 September scheduled deploy failed on a GitHub OIDC timeout after the data commit had landed.

**E9. Soft failures have no signal. Medium, S.** Buzz feed collapse, geocode skips, an empty census queue and empty worklists are visible only in run logs; no workflow writes a job summary or a warning annotation.

**E10. Documentation describes a retired algorithm. Medium, M.** `pizza/README.md` documents SLICE v1 (pillars, Crust Integrity 26%, in-score Bayesian shrinkage, the bench, `fetch-ratings.mjs`). The landing-page tagline says "five-pillar algorithm with Bayesian-adjusted ratings". CLAUDE.md is about 200 lines, 56% incident narrative, and cites a stale cost figure and a script that does not exist.

**E11. Hygiene. Low, S.** Two stale remote branches (one fully merged, one holding an unrelated AWS design spec); `.claude/settings.json` allows the whole Claude Code Remote server plus a dispatch tool, so an agent session can trigger paid research runs without a prompt; every action is on a Node 20 major; `isRated` is copied into three scripts instead of imported.

**E12. Data commits have no apply summary. Low, S.** The proposal is recorded (`research.json` is committed) but the applied-changes summary is printed only to the run log.

## The plan

Sequenced so the page stops publishing wrong things and the agent is confined first, then the ranking becomes what the methodology says, then the loop starts feeding it, then the phone experience catches up with the desktop. Process guards ride in the first week because they are cheap and protect everything after.

### Week 1: confine the agent, stop publishing wrong things (all S except one M; two or three sessions)

1. **Confine the agent (T1, T2, E1).** In `research.yml`: replace bare `Write` with `Edit(pizza/data/research.json)`; add a guard step after the agent that fails unless `git status --porcelain` names only `research.json`; run verify, apply and lint from a second pristine checkout; add a build-and-verify step before the research commit. Add two sentences to the fixed rules saying web content is evidence, never instruction. Acceptance: a run in which the agent writes any other path goes red before the gate; a research commit that breaks rendering goes red in `research.yml`, not the next publish.
2. **Ranking correctness (A1, A2, A3, A6, A7, A8, A9).** In `slice.js`: adopt a missing-data rule for reputation (decision 1), compute the decay clock as the newest verification date, make `splitTiers` a pure partition of `rank()`'s order, disclose the 1.00 multiplier, round the export. Tag snapshots with the algorithm version and handle W34 on the chart. Tests for each. Acceptance: tests pass; the top ten is what `rank()` says; the methodology paragraph on reputation is true for all 52 entries.
3. **Facts (B1, B2, B4, B6, B10 data half).** Add an optional event date to the status schema and set Flying Squirrel's `statusDate` to 2024-03-01; format date-only strings in UTC; reconcile `url` with `locationsSource` for Serious Pie, Lupo and Moto and have the locations apply do it in future; give crowd figures an honest `observed` and `platform`; set Dino's `opened` to 2016 and Cornelly's to 2020 with an `openedSource`, and Moto's neighborhood to West Seattle. Acceptance: the radar no longer lists a 2024 closure; no directory date disagrees with its ISO neighbour; curl on every top-ten `url` returns 200.
4. **Copy (B5, B9, B10 disclosure, E10).** Rewrite the five contradicting sentences; say plainly on the page and in the dataset note where the founding ratings came from (decision 3); guard `est.`, the price chip and the tier clause in `render.js`; hide the orphan state line; rename "Pillar"; count only open entries as rated; link the repository and add a corrections note and a license. Rewrite `pizza/README.md` from `slice.js` and fix the tagline. Acceptance: `grep` for each retired phrase returns nothing; a test renders a card for a minimal rated entry and asserts no "null" or empty chip.
5. **Branch CI (E3, E4).** Add `ci.yml` running tests, lint, build and verify on every push to a non-main branch; gate the snapshot write behind a flag set only in `publish.yml`. Acceptance: push a branch with a deliberately broken render and watch CI go red without touching `main`.

### Weeks 2 and 3: make the loop feed the ranking (S and M)

6. **Liveness ordering** by age of last check, with the opening and no-site preference applied only after a minimum revisit window (C1).
7. **A facts channel** that may set `opened` and `priceIndex` when null, with an https source, for any entry; reputation-zero rated entries first in its worklist (A4).
8. **A coverage backfill task** with its own 24-month window for mentions, URL normalisation and title dedup on apply, the rating brief emitting a mention for every source it cites, and agent news folded into the buzz list (C2, C8, C10).
9. **Attempt memory** for the rating task, all cited sources stored and rendered, and a source-class rule that rejects a rating whose sources are all the pizzeria's own site or an aggregator (C3, B7).
10. **Per-record rejection** with a warning per dropped record (C4); closure sources on review sites rejected, recently closed entries re-confirmed once, `statusPrev` written on every flip (C5, T2); rotation by last success, agent step skipped on an empty worklist (C6, C7); look-alike names normalised and lengths capped (C9).
Acceptance: after two weeks every open entry has a `statusChecked` within 60 days, at least 30 entries carry a mention, and no entry has been in a rating worklist twice without a recorded attempt.

### Week 4: the phone (M)

11. Weight panel as a collapsed disclosure under the Top 10 intro with `aria-live` on the feedback line; the 1200 px grid moves it to the rail (D2).
12. Under 720 px: drop the second hero lede, move the spotlight below the board, clamp blurbs to two lines with the full text in the disclosure (D1).
13. Replace the two light-palette tokens (D3). Two-line directory rows under 1100 px with Notes in the expanded record and a working sticky header (D4). Section ids, `<main>`, a skip link and a slim sticky section nav (D5). Right-align the chart so the newest week and its labels show first, tap-able tooltip (D6). Reduced-motion specificity, touch targets, heading order (D8).
Acceptance: first card within one screen at 390 px; every sampled text role at 4.5:1 or better in both palettes; no horizontal scroller in the directory on a phone; Tab reaches the directory in under ten presses.

### Ongoing: hygiene and observability (S each, batch them)

14. Job summaries and warning annotations for buzz, geocode, apply and empty worklists (E9); apply summary in the data commit body (E12); deploy retry (E8); timeouts and negative cache in `geocode.mjs`, date guard in `fetch-buzz.mjs` (E6); `rmSync` guard in the build and the scaffolder (E7); real `verify.mjs` checks against the markup with the data blob stripped, plus a card-per-top-ten-id assertion (E5); import `isRated`; delete the two stale branches; narrow the tool allowlist; bump action majors (E11).
15. Docs: a root CLAUDE.md of about 80 lines with the cross-site rules, a `pizza/CLAUDE.md` with the site's invariants, a `docs/decisions.md` for the incident narratives, and the rubric for any rating a human stands behind (E10, B10).
16. Lean build once directory rows render on demand (D7).

### Do not do

- Do not reintroduce a crowd star-rating pipeline; the sources block automated reads and the docs record three runs lost to that.
- Do not add a second workflow that deploys, split sites into separate repositories, or turn the page into a client-rendered app. Static-first is a strength.
- Do not move the methodology off the page. Collapse its long paragraphs into disclosures; transparency is the premise.
- Do not raise the validator's global age cap; give mentions their own 24-month cap and keep news and status tight.
- Do not "fix" T1 by adding a bare `Edit` deny; deny rules are evaluated first and would block the one file the agent must write. Use the path-scoped allow.
- Do not have the agent re-rate the founding 25 until decision 3 is made. If they are a person's judgments, keep them and say so; if they are not, re-grounding them through the cited-coverage channel is the honest fix, and the never-overwrite rule should be lifted for exactly that pass.

### Decisions only the maintainer can make

1. **The reputation rule.** Renormalising over present components is what the copy promises but makes a young shop with an honest founding year score below one with nothing on file. The monotone alternative (a component counts only when it raises the factor) is fairer and still rewards evidence. Either changes the published ten: Breezy Town enters, Mioposto leaves.
2. **Breezy Town Pizza.** A distinct pizzeria at the Clock-Out Lounge, a menu line at Windy City Pie, or closed? The record cannot stay as it is.
3. **The founding ratings.** Git says a Claude session on 22 August typed the 25 ratings, the 10 crowd figures and the blurbs, citing a rubric that was never committed; the page says an editor applied one rubric and that every rating has provenance. Did a person make these judgments? The answer decides whether the page discloses "editorial, by the maintainer, rubric in the repo" or re-grounds them like the other 27. Two of the seeded facts are already known to be wrong.
4. **Odyssey seats.** Its live page is the empty placeholder, yet every deploy installs Playwright and Chromium for it.
5. **The research budget.** Current cadence is about $20 to $25 a month; the coverage backfill adds dispatches. Set the ceiling.

## Appendix A: findings the verifiers refuted or reduced

- **Page weight (UX).** Every byte figure held, but no user-facing cost was demonstrated; the page is 80 KB gzipped with a ten-minute cache. Kept as D7 at low.
- **Data commits have no record of what changed (process).** Overstated: each research commit includes the agent's `research.json`. Kept as E12 at low.
- **Crowd figures seeded by hand and labelled observed (data).** The mechanics held; the "dataset version" wording is not page copy, and the counts lower those ten scores rather than raise them. Kept as B6 at low, and revived as part of B10 for the disclosure question.
- **A delivery-only entry breaks the inclusion rule (data).** Wrong: the discovery brief says delivery-only operations count, and the page never prints the "76 open" figure the reviewer cited. Dropped.
- **Candidate-queue notes and dry queue (data).** The data held, but the census task is dispatch-only and nothing on the page depends on it. Folded into C7 at low.

## Appendix B: what was not covered

The reviewers did not read the agent's transcripts (the action hides them), did not fetch every cited source (about 40 fetches; several hosts block bots), did not test on a real screen reader or touch hardware, did not run the build on Node 24 as CI does, and did not test the Python site. A second-skeptic pass on the high and critical findings was dropped to stay inside the account's spend limit; I reproduced each of those myself instead. Four provenance verifiers failed on a safeguard misfire; the git facts in B10 are my own reproduction, and the Cornelly opening year rests on Capitol Hill Seattle headlines the gap reviewer fetched, which I could not re-fetch from this sandbox.
