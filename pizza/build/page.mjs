/* The page shell plus its static-copy sections (hero, ranking wrapper,
 * methodology, footer). The data-driven sections come in pre-rendered via
 * `sections`; this module owns everything that is mostly prose. */
import { boardHtml, fieldStats } from '../src/render.js';
import { FRICTION_CAP, ALGORITHM, MAX_STALENESS_DECAY, STALENESS_PER_WEEK } from '../src/slice.js';
import { esc, nameLink, fmtDate } from './html.mjs';
import { locationLabel } from '../src/locations.js';

export function pageHtml(ctx, sections) {
  const { dataset, now, week, scoredAll, ranked, spotlight, history, css, leafletCss } = ctx;
  const openRated = scoredAll.filter(r => !r.status || r.status === 'open').length;
  const founding = dataset.restaurants.filter(r => r.factors?.craft?.setBy === 'editorial').length;
  const agentRated = dataset.restaurants.filter(r => r.factors?.craft?.setBy === 'agent').length;
  const foundingCited = dataset.restaurants.filter(r => r.factors?.craft?.setBy === 'editorial'
    && (r.factors.craft.sources?.length || r.factors.craft.source)).length;
  const capWeeks = Math.round(MAX_STALENESS_DECAY / STALENESS_PER_WEEK);
  const REPO = 'https://github.com/jackchammons/sites';
  /* Rendered twice: in the hero beside the lede on wide screens, and under
   * the board on phones, where the hero must get out of the ranking's way. */
  const spotlightHtml = `
        <div class="spotlight">
          <div class="big">🍕</div>
          <div>
            <p class="spot-title">Pie of the Week · ${nameLink(spotlight)}</p>
            <p><b>#${spotlight.rank}, ${spotlight.score.toFixed(1)} SLICE.</b> ${
              /* Discovered entries have no hand-written signature; their
               * discovery blurb (or just the location) stands in. */
              esc(spotlight.signature ?? spotlight.blurb ?? spotlight.style ?? '')} — ${esc(locationLabel(spotlight))}.
            Rotates through the top ten each Monday.</p>
          </div>
        </div>`;
  const { factorCards, frictionRows } = sections.method;
  const field = fieldStats(ctx.allScored);
  const { recordSection, bracketSection, radarSection, buzzSection, directorySection } = sections;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>The Seattle Pizza Index</title>
<meta name="description" content="Seattle's pizzerias, tracked daily: a ranked top ten, a full directory, openings and closings, and the news. Scored by SLICE, a published five-factor method, with every input shown.">
<meta property="og:title" content="The Seattle Pizza Index">
<meta property="og:description" content="Seattle's pizzerias, tracked daily. A ranked top ten and a full directory, scored by a published method.">
<meta property="og:type" content="website">
<meta property="og:url" content="https://sites.jackhammons.com/pizza/">
<meta property="og:site_name" content="jackchammons / sites">
<meta name="twitter:card" content="summary">
<link rel="canonical" href="https://sites.jackhammons.com/pizza/">
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🍕</text></svg>">
<style>${leafletCss}
${css}</style>
</head>
<body>
<a class="skip" href="#board">Skip to the ranking</a>

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
          further down this page, and every card shows the inputs behind its number.
        </p>
        <p class="lede lede-rule" style="margin-top:10px;font-size:14.5px">
          To be included, a pizzeria must have at least one location inside Seattle itself.
          Chains that qualify are tracked with all their branches, but the suburbs are never
          the subject.
        </p>
        <div class="stamp">
          <span>Updated <b>${fmtDate(now)}</b></span>
          <span>On file <b>${dataset.restaurants.length} pizzerias</b></span>
          <span>Rated <b>${openRated}</b></span>
          <span>Week <b>${week}</b></span>
        </div>
      </div>
      <div class="hero-side">
        ${spotlightHtml}
      </div>
    </div>
  </div>
</header>

<nav class="site-nav" aria-label="Sections">
  <div class="wrap">
    <a href="#top-ten">Top 10</a>
    <a href="#record">Record</a>
    <a href="#styles">By style</a>
    <a href="#radar">Radar</a>
    <a href="#buzz">Buzz</a>
    <a href="#directory">Directory</a>
    <a href="#methodology">Method</a>
  </div>
</nav>

<main>

<section class="section" id="top-ten">
  <div class="wrap">
    <div class="eyebrow">The ranking</div>
    <h2 class="sec-h">The Top 10</h2>
    <p class="lede" style="margin:14px 0 8px">
      The ten highest SLICE scores among ${openRated} rated, open pizzerias. Recomputed every
      morning; the ▲▼ markers show movement since last week. Click a card to see why it ranks
      where it does: every input, read against the rest of the rated field.
    </p>

    <div class="board" id="board">
${boardHtml(ranked, field)}
    </div>
    <div class="spotlight-inline">${spotlightHtml}</div>
  </div>
</section>

${recordSection}
${bracketSection}
${radarSection}
${buzzSection}
${directorySection}

</main>

<section class="section" id="methodology">
  <div class="wrap">
    <div class="eyebrow">Methodology</div>
    <h2 class="sec-h">How it works</h2>
    <p class="lede" style="margin-top:14px">
      The whole site is computed. A JSON dataset holds the facts; a scoring module (${ALGORITHM})
      turns them into the ranking; a daily pipeline keeps the facts current. Every number on this
      page comes from that build, and the same scoring code runs in your browser when you change
      the weights.
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
      The three graded factors have two sources, and the directory says which applies to each
      entry. The ${founding} founding entries were rated editorially when the index launched in
      August 2026, with nothing cited at the time; a backfill task has since attached published
      coverage to ${foundingCited} of them, values untouched, and the rest say so plainly. The
      ${agentRated} entries added since are
      rated by a research agent. Each day the research job assembles a worklist and hands it to
      a Claude agent as an explicit brief: these ids, this search budget, write one JSON file,
      run nothing. For ratings, the agent reads what has actually been published about each
      place and proposes craft and distinctiveness on a 0.5 grid plus a critic base, citing one
      to four https sources it read; an entry it cannot ground in real coverage stays unrated. A
      validator rejects the file if any value is off-grid, unsourced, or would overwrite an
      existing rating. A rating is set once and never rewritten; what the rotation re-checks is
      whether a place is open, where it is, and what has been written about it. The computed
      factors below run from the stored values at build time.
    </p>
    <div class="grid2">
      <div class="mcard">
        <h4>Reputation — computed</h4>
        <p>Three components, each 0–1, weighted 3 : 2 : 1, scored over whichever an entry
        actually has:</p>
        <pre>longevity = log(1+years) / log(1+15)   capped at 1
volume    = reviews / (reviews + 500)
coverage  = press mentions in 24 mo / 6, capped at 1

reputation = 10 × best weighted mean over
             the components present, taken
             best-first (a component counts
             only if it raises the mean)</pre>
        <p>Taking the best prefix keeps the factor honest about evidence: a stored review count
        or a first press mention can lift a score but never lower it. An entry with none of the
        three on file has no reputation score at all; its 24% is shared by the other four
        factors rather than scored as zero. The log curve means year two proves more than year
        twelve. The review <em>count</em> is used, never the star average: how many people rated
        a place is durable, while stored averages go stale.</p>
      </div>
      <div class="mcard">
        <h4>Critical reception — computed</h4>
        <p>A critic base rating, refined by the press coverage the research pass files against
        the entry. Each story adds a signal by kind — list appearance 1.0, mention 0.4, opening
        0.3, closing 0, anything else 0.3 — which fades with a 12-month half-life:</p>
        <pre>boost = min( 1.5, 0.5 × Σ kindWeight × 0.5^(months/12) )
critical = base + boost</pre>
        <p>The cap matters: a burst of coverage can lift a score by at most 1.5 points, so press
        refines the rating and never replaces it.</p>
      </div>
      <div class="mcard">
        <h4>Value — computed</h4>
        <p>Quality per dollar. The quality half is the mean of craft and critical reception; the
        price tier scales it:</p>
        <pre>value = (craft + critical) / 2 × tier
tier: $ ×1.20   $$ ×1.05   $$$ ×0.90   $$$$ ×0.75
      no tier on file ×1.00</pre>
        <p>A cheap great pie outruns its quality score. An expensive one has to be better than
        its price to break even. An entry whose price tier is not yet on file takes the neutral
        multiplier, and its card says so.</p>
      </div>
      <div class="mcard">
        <h4>Craft &amp; Distinctiveness — graded</h4>
        <p>The two factors that require judgment: how good the pizza itself is, and whether the
        place owns a lane in this city. Both are stored with who set them and when; for
        agent-rated entries, with the coverage they were read from. The founding entries' values
        are editorial; where coverage has been attached after the fact the directory links it,
        and where none is on file it says so. The research agent may propose these factors for
        unrated entries only, from cited critical coverage, and may attach sources to an
        existing rating but never change its value. The
        weights are published above.</p>
      </div>
    </div>

    <h3 class="method-h">The deductions</h3>
    <div class="grid2">
      <div class="mcard">
        <h4>Friction</h4>
        <p>Points for the gap between wanting the pizza and eating it, read from each entry's
        attribute flags. Capped at −${FRICTION_CAP.toFixed(1)} so logistics can dent a ranking,
        never decide it.</p>
        <table class="calc">
          <thead><tr><th>Condition</th><th class="num">Cost</th></tr></thead>
          <tbody>${frictionRows}</tbody>
        </table>
      </div>
      <div class="mcard">
        <h4>Freshness decay</h4>
        <p>Every entry records when it was last verified: the newest of a liveness check, a
        locations check or the date it was rated. Its score loses ${(STALENESS_PER_WEEK * 100).toFixed(1)}% per
        week since then, capped at ${(MAX_STALENESS_DECAY * 100).toFixed(0)}% after ${capWeeks} weeks. An entry left
        alone slides slowly down the board until the rotation checks it again, and the card
        names which check reset the clock.</p>
        <p>Star averages shown on cards are context, not score input; the review <em>count</em>
        is what reputation reads. Averages are de-noised for display — small samples are pulled
        toward the Seattle mean of ${dataset.cityMeanRating.toFixed(2)}★ in proportion to how
        small they are (prior weight ${dataset.priorWeight}). The figures on file were seeded
        when the index launched and are not refreshed.</p>
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
      research pass costs a day and a failed build leaves the last good site standing. The
      facts the rotation re-checks are an entry's status, its addresses and its coverage; a
      rating is set once, with its provenance, and stays. Freshness decay makes the waiting
      visible: an entry nobody has re-checked slowly costs score until the rotation comes back
      around.
    </p>

    <p class="method-p" style="margin-top:22px">
      Ties break on critical reception, then craft, then alphabetically. The dataset, the scoring
      module and this page's build script are public at
      <a href="${REPO}" target="_blank" rel="noopener">github.com/jackchammons/sites</a>; if a
      fact here is wrong, <a href="${REPO}/issues" target="_blank" rel="noopener">open an issue</a>
      or send a pull request against <code>pizza/data/restaurants.json</code>.
    </p>
  </div>
</section>

<footer>
  <div class="wrap">
    <p><b>The Seattle Pizza Index.</b> A static site: the ranking is computed at build time from a
    JSON dataset and served as files; the browser runs only the map and the page's own
    disclosures. No analytics, no cookies, no tracking.</p>
    <p style="margin-top:10px">Rebuilt daily by GitHub Actions from
    <a href="${REPO}" target="_blank" rel="noopener">jackchammons/sites</a>.
    ${ALGORITHM} · dataset v${esc(dataset.dataVersion)} · built ${now.toISOString()}</p>
  </div>
</footer>

<script>window.__PIZZA__ = ${JSON.stringify({
  // Only what the map needs: the ranking is already rendered above.
  dataset: { restaurants: dataset.restaurants.map(r => ({
    id: r.id, name: r.name, url: r.url ?? null, status: r.status ?? 'open', locations: r.locations ?? []
  })) },
  builtAt: now.toISOString()
}).replace(/</g, '\\u003c')};</script>
<script src="./leaflet.js"></script>
<script type="module" src="./app.js"></script>
</body>
</html>
`;
}
