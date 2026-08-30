/* The page shell plus its static-copy sections (hero, ranking wrapper,
 * methodology, footer). The data-driven sections come in pre-rendered via
 * `sections`; this module owns everything that is mostly prose. */
import { boardHtml } from '../src/render.js';
import { FRICTION_CAP } from '../src/slice.js';
import { esc, nameLink, fmtDate } from './html.mjs';
import { locationLabel } from '../src/locations.js';

export function pageHtml(ctx, sections) {
  const { dataset, now, week, scoredAll, ranked, spotlight, baseline, evidenceMap, history, css, leafletCss } = ctx;
  const { careHeader, careRows, factorCards, frictionRows } = sections.controls;
  const { recordSection, bracketSection, radarSection, buzzSection, directorySection } = sections;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>The Seattle Pizza Index</title>
<meta name="description" content="Seattle's pizzerias, tracked daily: a ranked top ten, a full directory, openings and closings, and the news. Scored by SLICE, a published five-factor method you can re-weight yourself.">
<meta property="og:title" content="The Seattle Pizza Index">
<meta property="og:description" content="Seattle's pizzerias, tracked daily. A ranked top ten and a full directory, scored by a published method.">
<meta property="og:type" content="website">
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🍕</text></svg>">
<style>${leafletCss}
${css}</style>
</head>
<body>

<header class="hero">
  <div class="wrap">
    <div class="eyebrow">Seattle, WA · updated daily</div>
    <h1>The Seattle <em>Pizza Index</em></h1>
    <div class="hero-cols">
      <div class="hero-main">
        <p class="lede">
          A running record of Seattle's pizzerias: who's best, who's new, who's gone, and what
          the city is saying about them. Each rated pizzeria gets a <b>SLICE score</b> out of
          100 from five weighted factors, and the ten highest make the list. The full method is
          further down this page, and you can change the weights yourself.
        </p>
        <p class="lede" style="margin-top:10px;font-size:14.5px">
          To be included, a pizzeria must have at least one location inside Seattle itself.
          Chains that qualify are tracked with all their branches, but the suburbs are never
          the subject.
        </p>
        <div class="stamp">
          <span>Updated <b>${fmtDate(now)}</b></span>
          <span>On file <b>${dataset.restaurants.length} pizzerias</b></span>
          <span>Rated <b>${scoredAll.length}</b></span>
          <span>Week <b>${week}</b></span>
        </div>
      </div>
      <div class="hero-side">
        <div class="spotlight">
          <div class="big">🍕</div>
          <div>
            <h3>Pie of the Week · ${nameLink(spotlight)}</h3>
            <p><b>#${spotlight.rank}, ${spotlight.score.toFixed(1)} SLICE.</b> ${esc(spotlight.signature)} — ${esc(locationLabel(spotlight))}.
            Rotates through the top ten each Monday.</p>
          </div>
        </div>
      </div>
    </div>
  </div>
</header>

<section class="section">
  <div class="wrap">
    <div class="eyebrow">The ranking</div>
    <h2 class="sec-h">The Top 10</h2>
    <p class="lede" style="margin:14px 0 8px">
      The ten highest SLICE scores among ${scoredAll.length} rated pizzerias. Recomputed every
      morning; the ▲▼ markers show movement since last week. Open <em>Show the math</em> on any
      card for the full calculation.
    </p>
    <p class="lede" style="margin:0 0 26px" id="board-note">Published ranking.</p>

    <div class="rank-layout">
    <div class="board" id="board">
${boardHtml(ranked)}
    </div>

    <div class="controls" id="controls" hidden>
      <div class="controls-head">
        <strong>How much do you care about each factor?</strong>
        <span>The list above uses the published weights. Set any factor from 0% (ignore it) to
        200% (double it) and the list re-sorts in your browser. The five weights always rescale
        to total 100%; the number beside each factor is the share it currently gets.</span>
      </div>
      <div class="care-grid">
        ${careHeader}
        ${careRows}
      </div>
      <div class="ctl-row">
        <label class="toggle"><input type="checkbox" id="opt-friction" checked> Apply friction penalty</label>
        <label class="toggle"><input type="checkbox" id="opt-freshness" checked> Apply freshness decay</label>
        <button class="reset" id="reset" type="button">Back to the published ranking</button>
      </div>
    </div>
    </div>
  </div>
</section>

${recordSection}
${bracketSection}
${radarSection}
${buzzSection}
${directorySection}

<section class="section" id="methodology">
  <div class="wrap">
    <div class="eyebrow">Methodology</div>
    <h2 class="sec-h">How it works</h2>
    <p class="lede" style="margin-top:14px">
      The whole site is computed. A JSON dataset holds the facts; a scoring module turns them
      into the ranking; a daily pipeline keeps the facts current. Nothing on this page is placed
      by hand, and the same scoring code runs in your browser when you change the weights.
    </p>

    <h3 class="method-h">The score</h3>
    <p class="method-p">
      Each factor is a 0–10 rating. Divide by 10, multiply by the factor's weight, and sum: a
      perfect entry scores exactly 100. Friction is then subtracted and freshness decay applied.
    </p>
    <div class="formula">
      <b>SLICE</b> = ( Σ factor<sub>i</sub> ÷ 10 × weight<sub>i</sub> − min( friction, ${FRICTION_CAP.toFixed(1)} ) ) × ( 1 − decay )
    </div>
    <div class="pillars">${factorCards}</div>

    <h3 class="method-h">Where the factor values come from</h3>
    <p class="method-p">
      Ratings are produced by a bounded research loop, not hand edits. Each day the research
      job assembles a worklist — stalest facts first; for ratings, unrated entries with cited
      press first — and hands it to a Claude agent as an explicit brief: these ids, this search
      budget, write one JSON file, run nothing. The agent reads what has actually been
      published about each place and proposes craft and distinctiveness on a 0.5 grid plus a
      critic base, citing one to four https sources it actually read; an entry it cannot ground
      in real coverage stays unrated, which is a correct outcome. A validator then rejects the
      entire file if any value is off-grid, unsourced, or would overwrite an existing rating.
      What survives is applied with provenance — who set it, from what source, when — which
      every entry shows in the directory, and the computed factors below run from those stored
      values at build time.
    </p>
    <div class="grid2">
      <div class="mcard">
        <h3>Reputation — computed</h3>
        <p>Three components, each 0–1, weighted 3 : 2 : 1 and renormalised over whichever an
        entry actually has, so nobody is zeroed for data that was never collected:</p>
        <pre>longevity = log(1+years) / log(1+15)   capped at 1
volume    = reviews / (reviews + 500)
coverage  = press mentions in 24 mo / 6, capped at 1

reputation = 10 × Σ(wᵢ·xᵢ) / Σ(wᵢ present)</pre>
        <p>The log curve means year two proves more than year twelve. The review <em>count</em>
        is used, never the star average: how many people rated a place is durable, while stored
        averages go stale.</p>
      </div>
      <div class="mcard">
        <h3>Critical reception — computed</h3>
        <p>A critic base rating, refined by press coverage as it happens. Each story the pipeline
        files adds a signal by kind — list appearance 1.0, mention 0.4, opening 0.3 — which fades
        with a 12-month half-life:</p>
        <pre>boost = min( 1.5, 0.5 × Σ kindWeight × 0.5^(months/12) )
critical = base + boost</pre>
        <p>The cap matters: a burst of coverage can lift a score by at most 1.5 points, so press
        refines the rating and never replaces it.</p>
      </div>
      <div class="mcard">
        <h3>Value — computed</h3>
        <p>Quality per dollar. The quality half is the mean of craft and critical reception; the
        price tier scales it:</p>
        <pre>value = (craft + critical) / 2 × tier
tier: $ ×1.20   $$ ×1.05   $$$ ×0.90   $$$$ ×0.75</pre>
        <p>A cheap great pie outruns its quality score. An expensive one has to be better than
        its price to break even.</p>
      </div>
      <div class="mcard">
        <h3>Craft &amp; Distinctiveness — editorial</h3>
        <p>The two factors that require judgment: how good the pizza itself is, and whether the
        place owns a lane in this city. Both are stored with provenance — who set them, from what
        source, and when — and the research agent may propose them for new entries only from
        cited critical coverage. The weights are published and yours to overrule.</p>
      </div>
    </div>

    <h3 class="method-h">The deductions</h3>
    <div class="grid2">
      <div class="mcard">
        <h3>Friction</h3>
        <p>Points for the gap between wanting the pizza and eating it, read from each entry's
        attribute flags. Capped at −${FRICTION_CAP.toFixed(1)} so logistics can dent a ranking,
        never decide it.</p>
        <table class="calc">
          <thead><tr><th>Condition</th><th class="num">Cost</th></tr></thead>
          <tbody>${frictionRows}</tbody>
        </table>
      </div>
      <div class="mcard">
        <h3>Freshness decay</h3>
        <p>Every entry records when it was last checked. Its score loses 0.2% per week since
        then, capped at 6%. Data nobody has verified in a year says so in the score, and an
        entry left alone slides slowly down the board until the rotation reaches it again.</p>
        <p>Star ratings shown on cards are context, not score input. They are de-noised first —
        small samples are pulled toward the Seattle mean of ${dataset.cityMeanRating.toFixed(2)}★
        in proportion to how small they are (prior weight ${dataset.priorWeight}).</p>
      </div>
    </div>

    <h3 class="method-h">The daily pipeline</h3>
    <p class="method-p">
      Two scheduled jobs, half an hour apart, keep the dataset moving — and the whole design
      assumes any given day can fail without consequence.
    </p>
    <div class="pipe">
      <div class="pipe-stage">
        <span class="pipe-num">01</span>
        <span class="pipe-when">12:47 UTC</span>
        <b>Research</b>
        <p>A Claude research agent gets one bounded brief: an explicit worklist, a web-search
        budget, no ability to run anything. It reads pizzerias' own sites and published local
        coverage and writes a single file of proposals — facts with sources, never scores
        applied directly.</p>
        <div class="pipe-rota" aria-label="Task rotation">
          <span>discovery</span><span>locations</span><span>liveness</span><span>news</span><span>rating</span>
        </div>
        <p class="pipe-sub">one task per day, rotating — a week covers every kind of upkeep</p>
      </div>
      <div class="pipe-stage pipe-check">
        <span class="pipe-num">02</span>
        <span class="pipe-when">on return</span>
        <b><span class="pipe-tick">✓</span> Validation</b>
        <p>Every proposal is checked before anything is written: an https source on each claim,
        addresses that parse with Puget Sound ZIPs, dates that exist, ratings on the 0.5 grid
        that never overwrite an existing one, no duplicates.</p>
        <p class="pipe-reject">One bad entry rejects the whole file — the dataset stays exactly
        as it was, and tomorrow's run starts fresh.</p>
      </div>
      <div class="pipe-stage">
        <span class="pipe-num">03</span>
        <span class="pipe-when">13:17 UTC</span>
        <b>Rebuild</b>
        <p>The site recomputes from the dataset: feeds swept, validated research merged, every
        rated entry re-scored from scratch, the ten highest open entries published. Once per
        ISO week the standings are snapshotted — the ▲▼ markers, the record chart and the
        "why it moved" lines all compare against those.</p>
      </div>
      <div class="pipe-stage">
        <span class="pipe-num">04</span>
        <span class="pipe-when">on green</span>
        <b>Deploy</b>
        <p>Unit tests, a dataset lint and a rendered-page verifier gate the publish. If
        anything fails, nothing ships and yesterday's site stays up — the gate has already
        refused real deploys.</p>
      </div>
      <div class="pipe-loop"><span>↺ tomorrow: the next task in the rotation</span></div>
    </div>
    <p class="method-p">
      The result is eventual consistency, on purpose. No single run is load-bearing: a failed
      research pass costs a day, a failed build leaves the last good site standing, and every
      fact on file — an address, an open-or-closed status, a rating — has a task in the
      rotation that will re-verify it within days. Freshness decay makes the waiting visible:
      data nobody has re-checked slowly costs its entry score until the rotation comes back
      around. Errors do not accumulate here; they age out.
    </p>

    <p class="method-p" style="margin-top:22px">
      Ties break on critical reception, then craft, then alphabetically. The dataset, the scoring
      module and this page's build script are public; if the data is wrong, it takes pull requests.
    </p>
  </div>
</section>

<footer>
  <div class="wrap">
    <p><b>The Seattle Pizza Index.</b> A static site: the ranking is computed at build time from a
    JSON dataset and served as files. The same scoring module runs in your browser, which is how
    the weight controls re-sort the list without a request to anything. No analytics, no cookies,
    no tracking.</p>
    <p style="margin-top:10px">Rebuilt daily at 13:17 UTC (6:17am Pacific) by GitHub Actions.
    Dataset v${esc(dataset.dataVersion)} · built ${now.toISOString()}</p>
  </div>
</footer>

<script>window.__PIZZA__ = ${JSON.stringify({
  dataset,
  baseline,
  evidence: evidenceMap,
  builtAt: now.toISOString()
}).replace(/</g, '\\u003c')};</script>
<script src="./leaflet.js"></script>
<script type="module" src="./app.js"></script>
</body>
</html>
`;
}
