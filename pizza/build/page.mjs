/* The page shell plus its static-copy sections (hero, ranking wrapper,
 * methodology, footer). The data-driven sections come in pre-rendered via
 * `sections`; this module owns everything that is mostly prose. */
import { boardHtml, fieldStats } from '../src/render.js';
import {
  FRICTION_CAP, ALGORITHM, MAX_STALENESS_DECAY, STALENESS_PER_WEEK, DEFAULT_WEIGHTS,
  REPUTATION_WEIGHTS, LONGEVITY_FULL_YEARS, COVERAGE_WINDOW_MONTHS,
  COVERAGE_FULL_MENTIONS, MENTION_WEIGHT, MENTION_WEIGHT_OTHER, MENTION_HALF_LIFE_MONTHS,
  CRITICAL_BOOST_SCALE, CRITICAL_BOOST_CAP, PRICE_MULT, PRICE_MULT_UNKNOWN
} from '../src/slice.js';
import { esc, nameLink, fmtDate } from './html.mjs';
import { locationLabel } from '../src/locations.js';

export function pageHtml(ctx, sections) {
  const { dataset, now, week, scoredAll, ranked, spotlight, css, leafletCss } = ctx;
  const openRated = scoredAll.filter(r => !r.status || r.status === 'open').length;
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
  const { factorCards, frictionRows, automation } = sections.method;
  const field = fieldStats(ctx.allScored);
  const { recordSection, bracketSection, radarSection, buzzSection, directorySection, candidatesSection } = sections;
  /* The nav lists the sections this build rendered. The record, the radar, the
   * buzz and the candidates each render nothing when they have nothing to
   * show, and a link to a section that is not there goes nowhere. */
  const nav = [
    ['top-ten', 'Top 10', true],
    ['record', 'Record', recordSection],
    ['styles', 'By style', bracketSection],
    ['radar', 'Radar', radarSection],
    ['buzz', 'Buzz', buzzSection],
    ['directory', 'Directory', directorySection],
    ['candidates', 'Candidates', candidatesSection],
    ['methodology', 'Method', true]
  ].filter(([, , rendered]) => rendered);
  /* Every constant the methodology prints is read from slice.js, in the form
   * the copy uses, so the page cannot describe a formula the code has left. */
  const W = REPUTATION_WEIGHTS;
  const repShare = DEFAULT_WEIGHTS.reputation;
  const x2 = n => `×${n.toFixed(2)}`;
  const kind = k => MENTION_WEIGHT[k].toFixed(MENTION_WEIGHT[k] ? 1 : 0);
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
<meta name="theme-color" content="#14100e" media="(prefers-color-scheme: dark)">
<meta name="theme-color" content="#fbf6ef" media="(prefers-color-scheme: light)">
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
    ${nav.map(([id, label]) => `<a href="#${id}">${label}</a>`).join('\n    ')}
  </div>
</nav>

<main>

<section class="section" id="top-ten">
  <div class="wrap">
    <div class="eyebrow">The ranking</div>
    <h2 class="sec-h">The Top 10</h2>
    <p class="lede" style="margin:14px 0 8px">
      The ten highest SLICE scores among ${openRated} rated, open pizzerias. Recomputed on
      every build; the ▲▼ markers show movement since last week. Click a card to see why it ranks
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
${candidatesSection}

<section class="section" id="methodology">
  <div class="wrap">
    <div class="eyebrow">Methodology</div>
    <h2 class="sec-h">How it works</h2>
    <p class="lede" style="margin-top:14px">
      The whole site is computed. A JSON dataset holds the facts; a scoring module (${ALGORITHM})
      turns them into the ranking; a daily pipeline keeps the facts current. Every number on this
      page comes from that build.
    </p>
    <p class="method-jump">
      <a href="#score">The score</a>
      <a href="#lifecycle">From a food permit to the top ten</a>
      <a href="#runs">What runs, and in what order</a>
      <a href="#rotation">How the day's task is chosen</a>
      <a href="#moves">What can move a score</a>
    </p>

    <h3 class="method-h" id="score">The score</h3>
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
      The three graded factors (craft, distinctiveness and the critic base) are set by a research
      agent from published coverage, and each is stored with the sources it read and the date it
      was set; an entry's record in the directory shows them. The agent proposes a rating and a
      validator decides whether it stands: one that is off the scale, has no published criticism
      behind it, or is for an entry the agent has already rated is dropped. An entry the agent
      cannot ground in real coverage stays unrated. The computed factors below are worked out
      from the stored values on every build.
    </p>
    <div class="grid2">
      <div class="mcard">
        <h4>Reputation — computed</h4>
        <p>Two components, each 0–1, weighted ${W.longevity} : ${W.coverage}, scored over whichever an entry
        actually has:</p>
        <pre>longevity = log(1+years) / log(1+${LONGEVITY_FULL_YEARS})
            capped at 1
coverage  = mentions in ${COVERAGE_WINDOW_MONTHS} mo / ${COVERAGE_FULL_MENTIONS}
            capped at 1

reputation = 10 × best weighted mean
             over the components on
             file, taken best-first</pre>
        <p>A component counts only if it raises that mean, so with both on file the factor is
        the higher of the two. The same rule holds one level up.
        Reputation carries its ${repShare}% only when it is on file <em>and</em> is at or above the
        weighted mean of the entry's other four factors. When nothing is on file, or when what
        is on file sits below the other four, reputation carries no weight and the other four
        share its ${repShare}% in proportion to their own weights. So a founding year or a first
        press mention can lift a score but never lower it, and each card says which of the
        three cases applies. The log curve means year two proves more than year twelve.</p>
      </div>
      <div class="mcard">
        <h4>Critical reception — computed</h4>
        <p>A critic base rating, refined by the press coverage the research pass files against
        the entry. Each story adds a signal by kind — list appearance ${kind('ranking')}, mention ${kind('mention')}, opening
        ${kind('opening')}, closing ${kind('closing')}, anything else ${MENTION_WEIGHT_OTHER.toFixed(1)} — which fades with a ${MENTION_HALF_LIFE_MONTHS}-month half-life:</p>
        <pre>signal   = Σ kind × 0.5^(months / ${MENTION_HALF_LIFE_MONTHS})
boost    = min( ${CRITICAL_BOOST_CAP.toFixed(1)}, ${CRITICAL_BOOST_SCALE.toFixed(1)} × signal )
critical = base + boost, capped at 10</pre>
        <p>The cap matters: a burst of coverage can lift a score by at most ${CRITICAL_BOOST_CAP.toFixed(1)} points, so press
        refines the rating and never replaces it.</p>
      </div>
      <div class="mcard">
        <h4>Value — computed</h4>
        <p>Quality per dollar. The quality half is the mean of craft and critical reception; the
        price tier scales it:</p>
        <pre>value = (craft + critical) / 2 × tier
        capped at 10

tier    $ ${x2(PRICE_MULT[1])}     $$ ${x2(PRICE_MULT[2])}
        $$$ ${x2(PRICE_MULT[3])}   $$$$ ${x2(PRICE_MULT[4])}
        none on file ${x2(PRICE_MULT_UNKNOWN)}</pre>
        <p>A cheap great pie outruns its quality score. An expensive one has to be better than
        its price to break even. An entry whose price tier is not yet on file takes the neutral
        multiplier, and its card says so.</p>
      </div>
      <div class="mcard">
        <h4>Craft &amp; Distinctiveness — graded</h4>
        <p>The two factors that require judgment: how good the pizza itself is, and whether the
        place owns a lane in this city. The research agent sets both from published coverage,
        and each is stored with the sources it read and the date; the directory links those
        sources under the entry. A rating needs published criticism behind it: a review, a
        roundup or a news story. The pizzeria's own site, a review aggregator or a social post
        may be cited beside one but never alone, and the validator refuses a rating with no
        published criticism among its sources. The weights are published above.</p>
      </div>
    </div>

    <h3 class="method-h">The deductions</h3>
    <div class="grid2">
      <div class="mcard">
        <h4>Friction</h4>
        <p>Points for the gap between wanting the pizza and eating it, read from each entry's
        attribute flags. Capped at −${FRICTION_CAP.toFixed(1)} so logistics can dent a ranking,
        never decide it.</p>
        <table class="calc" aria-label="Friction costs">
          <thead><tr><th scope="col">Condition</th><th scope="col" class="num">Cost</th></tr></thead>
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
      </div>
    </div>
${automation}

    <p class="method-p" style="margin-top:22px">
      Ties break on critical reception, then craft, then alphabetically. The dataset, the scoring
      module and this page's build script are public at
      <a href="${REPO}" target="_blank" rel="noopener">github.com/jackchammons/sites</a>; if a
      fact here is wrong, <a href="${REPO}/issues" target="_blank" rel="noopener">open an issue</a>
      or send a pull request against <code>pizza/data/restaurants.json</code>.
    </p>
  </div>
</section>

</main>

<footer>
  <div class="wrap">
    <p><b>The Seattle Pizza Index.</b> A static site: the ranking is computed at build time from a
    JSON dataset and served as files; the browser runs only the map and the page's own
    disclosures. No analytics, no cookies, no tracking.</p>
    <p style="margin-top:10px">Rebuilt daily by GitHub Actions from
    <a href="${REPO}" target="_blank" rel="noopener">jackchammons/sites</a>.
    ${ALGORITHM} · dataset v${esc(dataset.dataVersion)} · built ${now.toISOString()} ·
    <a href="../">all sites</a></p>
  </div>
</footer>

<script>window.__PIZZA__ = ${JSON.stringify({
  // Only what the map needs: the ranking is already rendered above.
  dataset: { restaurants: dataset.restaurants.map(r => ({
    id: r.id, name: r.name, url: r.url ?? null, status: r.status ?? 'open', locations: r.locations ?? []
  })) },
  builtAt: now.toISOString()
}).replace(/</g, '\\u003c')};</script>
<script type="module" src="./app.js"></script>
</body>
</html>
`;
}
