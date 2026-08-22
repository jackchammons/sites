#!/usr/bin/env node
/*
 * Static site build. Reads the dataset, runs the SLICE algorithm, renders
 * dist/index.html, and records this week's standings in data/history.json so
 * the next build can show week-over-week movement.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { rank, DEFAULT_WEIGHTS, FRICTION_COSTS, FRICTION_LABELS, FRICTION_CAP, isoWeek, isoWeekKey } from '../src/slice.js';
import { boardHtml, PILLAR_META, esc } from '../src/render.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Output dir is overridable so the multi-site build can place this site at
// dist/<slug>/ while a standalone run still writes to dist/.
const dist = process.env.OUT_DIR
  ? path.resolve(process.env.OUT_DIR)
  : path.join(root, '..', 'dist');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');

const dataset = JSON.parse(read('data/restaurants.json'));
const historyPath = path.join(root, 'data/history.json');
const history = fs.existsSync(historyPath)
  ? JSON.parse(fs.readFileSync(historyPath, 'utf8'))
  : { snapshots: [] };

const now = new Date();
const weekKey = isoWeekKey(now);

// Movement markers compare against the most recent snapshot from an EARLIER
// week, so re-running the publish workflow mid-week never flattens the ▲/▼
// markers to "no change".
const previous = [...history.snapshots].reverse().find(s => s.weekKey !== weekKey);
const baseline = previous ? previous.ranks : {};

const ranked = rank(dataset, { now }).map(r => ({
  ...r,
  previousRank: baseline[r.id] ?? null
}));

/* Deterministic weekly spotlight: rotates through the field by ISO week. */
const week = isoWeek(now);
const spotlight = ranked[week % ranked.length];

const PILLAR_COPY = {
  crust:           'Fermentation, hydration, structure and bake. The single thing a pizzeria cannot fake.',
  toppings:        'Sourcing and restraint. Points for what is left off as much as what goes on.',
  consensus:       'Critical reads blended with a crowd rating that has been de-noised for sample size.',
  distinctiveness: 'Does it own a lane in this city, or is it a competent copy of someone else?',
  value:           'Satisfaction per dollar, folded together with the raw price tier.'
};

const fmtDate = d => d.toLocaleDateString('en-US', {
  timeZone: 'America/Los_Angeles', year: 'numeric', month: 'long', day: 'numeric'
});

const frictionRows = Object.entries(FRICTION_COSTS)
  .sort((a, b) => b[1] - a[1])
  .map(([tag, cost]) => `<tr><td>${esc(FRICTION_LABELS[tag] || tag)}</td><td class="num">−${cost.toFixed(1)}</td></tr>`)
  .join('');

const sliders = Object.keys(DEFAULT_WEIGHTS).map(k => `
        <div class="slider">
          <label for="w-${k}">
            <span><span class="swatch" style="background:${PILLAR_META[k].color}"></span>${PILLAR_META[k].label}</span>
            <b id="v-${k}">${DEFAULT_WEIGHTS[k]}%</b>
          </label>
          <input type="range" id="w-${k}" min="0" max="50" step="1" value="${DEFAULT_WEIGHTS[k]}" aria-label="${PILLAR_META[k].label} weight">
        </div>`).join('');

const pillarCards = Object.keys(DEFAULT_WEIGHTS).map(k => `
        <div class="pillar">
          <div class="w">${DEFAULT_WEIGHTS[k]}<span style="font-size:15px;color:var(--ink-3)">%</span></div>
          <h3><span class="swatch" style="background:${PILLAR_META[k].color}"></span>${PILLAR_META[k].label}</h3>
          <p>${PILLAR_COPY[k]}</p>
        </div>`).join('');

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>The Seattle Pizza Index — Top 10, ranked by the SLICE Score</title>
<meta name="description" content="The ten best pizzerias in Seattle, ranked by the SLICE Score: a transparent five-pillar algorithm with Bayesian-adjusted ratings and a friction penalty. Rebuilt every week. Move the sliders and re-rank it yourself.">
<meta property="og:title" content="The Seattle Pizza Index">
<meta property="og:description" content="Seattle's top 10 pizzerias, ranked by a transparent algorithm you can re-weight yourself.">
<meta property="og:type" content="website">
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🍕</text></svg>">
<style>${read('src/styles.css')}</style>
</head>
<body>

<header class="hero">
  <div class="wrap">
    <div class="eyebrow">Seattle, WA · rebuilt every Monday</div>
    <h1>The Seattle<br><em>Pizza Index</em></h1>
    <p class="lede">
      Ten pizzerias, one algorithm, no hand-waving. Every restaurant below is scored out of 100 by the
      <b>SLICE Score</b> — five weighted pillars, a crowd rating corrected for sample size, and a penalty
      for how hard the pie is to actually get into your hands. The whole formula is on this page, and you
      can re-weight it yourself.
    </p>
    <div class="stamp">
      <span>Updated <b>${fmtDate(now)}</b></span>
      <span>ISO week <b>${week}</b></span>
      <span>Dataset <b>v${esc(dataset.dataVersion)}</b></span>
      <span>Field <b>${ranked.length} pizzerias</b></span>
      <span>Snapshots on record <b>${history.snapshots.length + 1}</b></span>
    </div>

    <div class="spotlight">
      <div class="big">🍕</div>
      <div>
        <h3>Slice of the Week · ${esc(spotlight.name)}</h3>
        <p><b>#${spotlight.rank}, ${spotlight.score.toFixed(1)} SLICE.</b> ${esc(spotlight.signature)} — ${esc(spotlight.neighborhood)}.
        Rotates every Monday by ISO week number, so it is a fair rotation and not a favourite.</p>
      </div>
    </div>
  </div>
</header>

<section class="section">
  <div class="wrap">
    <div class="eyebrow">The algorithm</div>
    <h2 style="font-family:var(--serif);font-size:clamp(28px,4vw,40px)">Five pillars, one honest penalty</h2>
    <p class="lede" style="margin-top:14px">
      Most "best of" lists are a ranked opinion with the ranking hidden. This one publishes the weights.
      Each pillar is scored 0–10, multiplied by its weight, and summed to a base out of 100. Then reality
      intervenes: a <b>friction penalty</b> for preorder-only drops, hour-long waits and doors that are
      open twenty hours a week, because a pie you cannot get is worth less than one you can.
    </p>

    <div class="pillars">${pillarCards}</div>

    <div class="formula">
      <b>SLICE</b> = ( Σ pillar<sub>i</sub> ÷ 10 × weight<sub>i</sub> ) − min( friction, ${FRICTION_CAP.toFixed(1)} ) × ( 1 − freshness&nbsp;decay )
    </div>
  </div>
</section>

<section class="section">
  <div class="wrap">
    <div class="eyebrow">The ranking</div>
    <h2 style="font-family:var(--serif);font-size:clamp(28px,4vw,40px)">Seattle's top 10, right now</h2>
    <p class="lede" style="margin:14px 0 26px" id="board-note">Published ranking, rebuilt every Monday.</p>

    <div class="controls" id="controls" hidden>
      <div class="controls-head">
        <strong>Disagree? Re-rank it.</strong>
        <span>Drag a weight and the leaderboard re-sorts instantly. Weights normalise to 100%.</span>
      </div>
      <div class="sliders">${sliders}</div>
      <div class="ctl-row">
        <label class="toggle"><input type="checkbox" id="opt-friction" checked> Apply friction penalty</label>
        <label class="toggle"><input type="checkbox" id="opt-freshness" checked> Apply freshness decay</label>
        <button class="reset" id="reset" type="button">Reset to published weights</button>
      </div>
    </div>

    <div class="board" id="board">
${boardHtml(ranked)}
    </div>
  </div>
</section>

<section class="section">
  <div class="wrap">
    <div class="eyebrow">Methodology</div>
    <h2 style="font-family:var(--serif);font-size:clamp(28px,4vw,40px)">How the numbers are made</h2>

    <div class="grid2">
      <div class="mcard">
        <h3>De-noising the crowd</h3>
        <p>A 4.9★ from 80 diners is a rumour. A 4.7★ from 4,000 is evidence. Every crowd rating is pulled
        toward the city mean in proportion to how little data stands behind it:</p>
        <pre>adjusted = (v / (v + m)) · R
         + (m / (v + m)) · C

v = review count
m = ${dataset.priorWeight}   (prior weight)
R = raw rating
C = ${dataset.cityMeanRating.toFixed(2)}  (Seattle mean)</pre>
        <p>The result is remapped from the ${dataset ? '3.5–5.0' : ''} band that restaurant ratings actually
        occupy onto a 0–10 scale, then blended <b>55/45</b> with a critical read. A newcomer needs volume
        before its rating carries full weight.</p>
      </div>

      <div class="mcard">
        <h3>The friction penalty</h3>
        <p>Points subtracted for the gap between wanting the pizza and eating it. Capped at
        <span class="inline-code">−${FRICTION_CAP.toFixed(1)}</span> so logistics can dent a ranking but never
        decide it.</p>
        <table class="calc">
          <thead><tr><th>Condition</th><th class="num">Cost</th></tr></thead>
          <tbody>${frictionRows}</tbody>
        </table>
      </div>

      <div class="mcard">
        <h3>Freshness decay</h3>
        <p>Each entry carries a <span class="inline-code">lastVerified</span> date. Scores decay by
        <b>0.2% per week</b> since that date, capped at <b>6%</b>. Stale data quietly drifts down instead of
        sitting at the top forever, and the weekly rebuild has something real to recompute.</p>
        <p>Toggle it off in the controls above to see the undecayed field.</p>
      </div>

      <div class="mcard">
        <h3>Ties, movement and honesty</h3>
        <ul class="plain">
          <li>Ties break on Consensus Signal, then Crust Integrity, then alphabetically.</li>
          <li>The <b>▲ / ▼</b> markers compare against the previous weekly snapshot stored in
              <span class="inline-code">pizza/data/history.json</span>.</li>
          <li>Pillar scores are editorial judgments applied by one rubric to every restaurant. They are
              opinions — but they are <em>declared</em> opinions, and you can overrule their weights above.</li>
          <li>Crowd figures are rounded aggregates observed across major review platforms at the dataset
              version shown, not a live API feed.</li>
        </ul>
      </div>
    </div>
  </div>
</section>

<footer>
  <div class="wrap">
    <p><b>The Seattle Pizza Index.</b> Built from <span class="inline-code">pizza/data/restaurants.json</span>
    by <span class="inline-code">pizza/scripts/build.mjs</span>, scored by
    <span class="inline-code">pizza/src/slice.js</span>, and redeployed automatically by GitHub Actions every
    Monday at 13:00 UTC (6am Pacific).</p>
    <p style="margin-top:10px">Dataset v${esc(dataset.dataVersion)} · built ${now.toISOString()} ·
    ${esc(dataset.notes)}</p>
    <p style="margin-top:10px">Disagree with the rankings? Good — that is what the sliders are for. Disagree
    with the data? Open a pull request against the dataset.</p>
  </div>
</footer>

<script>window.__PIZZA__ = ${JSON.stringify({
  dataset,
  baseline,
  builtAt: now.toISOString()
}).replace(/</g, '\\u003c')};</script>
<script type="module" src="./app.js"></script>
</body>
</html>
`;

/* ---- emit ---- */
fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });
fs.writeFileSync(path.join(dist, 'index.html'), html);
for (const f of ['slice.js', 'render.js', 'app.js']) {
  fs.copyFileSync(path.join(root, 'src', f), path.join(dist, f));
}
fs.writeFileSync(path.join(dist, '.nojekyll'), '');
fs.writeFileSync(path.join(dist, 'rankings.json'), JSON.stringify({
  builtAt: now.toISOString(),
  week,
  algorithm: 'SLICE',
  weights: DEFAULT_WEIGHTS,
  rankings: ranked.map(r => ({
    rank: r.rank, id: r.id, name: r.name, neighborhood: r.neighborhood,
    style: r.style, score: r.score, previousRank: r.previousRank,
    pillars: r.pillars, penalty: r.penaltyApplied
  }))
}, null, 2));

/* ---- record this week's standings ----
 * One snapshot per ISO week. A rerun inside the same week overwrites that
 * week's entry rather than appending, so history stays weekly (52 = a year)
 * even though the workflow itself runs every few hours. */
const snapshot = {
  weekKey,
  date: now.toISOString().slice(0, 10),
  week,
  ranks: Object.fromEntries(ranked.map(r => [r.id, r.rank])),
  scores: Object.fromEntries(ranked.map(r => [r.id, r.score]))
};
const last = history.snapshots.at(-1);
if (last && last.weekKey === weekKey) history.snapshots.pop();
history.snapshots.push(snapshot);
history.snapshots = history.snapshots.slice(-52);

const serialised = JSON.stringify(history, null, 2) + '\n';
if (!fs.existsSync(historyPath) || fs.readFileSync(historyPath, 'utf8') !== serialised) {
  fs.writeFileSync(historyPath, serialised);
}

console.log(`Built ${ranked.length} entries -> ${path.relative(process.cwd(), dist) || dist}/  (ISO week ${week})`);
for (const r of ranked) {
  const mv = r.previousRank == null ? 'new' : r.previousRank === r.rank ? '  -' :
    (r.previousRank > r.rank ? `+${r.previousRank - r.rank}` : `${r.previousRank - r.rank}`);
  console.log(`  ${String(r.rank).padStart(2)}. ${r.score.toFixed(1).padStart(5)}  ${mv.padStart(4)}  ${r.name}`);
}
