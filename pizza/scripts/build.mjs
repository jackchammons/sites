#!/usr/bin/env node
/*
 * Static site build. Reads the dataset, runs SLICE v2, renders dist/index.html,
 * and records this week's standings in data/history.json so the next build can
 * show week-over-week movement.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { rank, splitTiers, isRated, DEFAULT_WEIGHTS, FRICTION_CAP, isoWeek, isoWeekKey } from '../src/slice.js';
import { boardHtml, PILLAR_META, esc, CARE_STEPS } from '../src/render.js';
import { locationLabel } from '../src/locations.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Output dir is overridable so the multi-site build can place this site at
// dist/<slug>/ while a standalone run still writes to dist/.
const dist = process.env.OUT_DIR
  ? path.resolve(process.env.OUT_DIR)
  : path.join(root, '..', 'dist');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');

const dataset = JSON.parse(read('data/restaurants.json'));
// The registry travels with the dataset so the browser re-ranker prices
// friction identically to the static build.
dataset.attributeRegistry = JSON.parse(read('data/attributes.json'));
delete dataset.attributeRegistry._comment;

const historyPath = path.join(root, 'data/history.json');
const history = fs.existsSync(historyPath)
  ? JSON.parse(fs.readFileSync(historyPath, 'utf8'))
  : { snapshots: [] };

const buzzPath = path.join(root, 'data/buzz.json');
const buzz = fs.existsSync(buzzPath)
  ? JSON.parse(fs.readFileSync(buzzPath, 'utf8'))
  : { updated: null, items: [] };

/* Stories the research agent found that the feeds missed. Additive, and
 * wrapped in try/catch so a malformed file can never take the site down --
 * verify-research.mjs is the real gate, this is the belt to its braces. */
const researchPath = path.join(root, 'data/research.json');
if (fs.existsSync(researchPath)) {
  try {
    const research = JSON.parse(fs.readFileSync(researchPath, 'utf8'));
    // `news` is the field the agent writes; `items` was the original name.
    const found = research.news ?? research.items ?? [];
    // Dedup on title as well as URL: the feed sweep stores Google News redirect
    // URLs while the agent links publishers directly.
    const norm = t => String(t).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    const knownUrls   = new Set(buzz.items.map(b => String(b.url).toLowerCase()));
    const knownTitles = new Set(buzz.items.map(b => norm(b.title)));
    const extra = found
      .filter(r => r && r.url && r.title
                && !knownUrls.has(String(r.url).toLowerCase())
                && !knownTitles.has(norm(r.title)))
      .map(r => ({ ...r, via: 'research' }));
    buzz.items = [...buzz.items, ...extra]
      .sort((a, b) => Date.parse(b.published) - Date.parse(a.published));
    if (extra.length) console.log(`  + ${extra.length} researched item(s)`);
  } catch (e) {
    console.warn(`  ! ignoring data/research.json: ${e.message}`);
  }
}

const now = new Date();
const weekKey = isoWeekKey(now);

// Movement markers compare against the most recent snapshot from an EARLIER
// week, so a mid-week rebuild never flattens the markers to "no change".
const previous = [...history.snapshots].reverse().find(s => s.weekKey !== weekKey);
const baseline = previous ? previous.ranks : {};

const scoredAll = rank(dataset, { now });
const { top, bench: restRaw } = splitTiers(scoredAll, 10);
const ranked = top.map(r => ({ ...r, previousRank: baseline[r.id] ?? null }));
const restScored = restRaw;   // ranks 11+, shown in the directory with scores

/* Weekly spotlight: rotates through the top ten by ISO week. */
const week = isoWeek(now);
const spotlight = ranked[week % ranked.length];

const FACTOR_COPY = {
  reputation:      'Standing earned over time: years in business, how many people have reviewed it, and whether the press keeps coming back. Computed from data.',
  critical:        'A critic base rating, lifted a bounded amount by recent coverage. New reviews and list appearances feed it daily.',
  craft:           'The pizza itself: dough, fermentation, bake, and what goes on top. An editorial rating, applied by one rubric.',
  distinctiveness: 'Does it own a lane in this city, or is it a competent copy of someone else? Editorial.',
  value:           'Quality delivered per dollar: the craft and reception scores, scaled by the price tier. Computed.'
};

const fmtDate = d => d.toLocaleDateString('en-US', {
  timeZone: 'America/Los_Angeles', year: 'numeric', month: 'long', day: 'numeric'
});
const shortDate = iso => new Date(iso).toLocaleDateString('en-US', {
  timeZone: 'America/Los_Angeles', month: 'short', day: 'numeric', year: 'numeric'
});

/* A pizzeria name, linked when a website is on file. Used everywhere a name
 * appears outside the ranked cards, so the rule holds across the page. */
const nameLink = (r, cls = '') =>
  r.url
    ? `<a${cls ? ` class="${cls}"` : ''} href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.name)}</a>`
    : (cls ? `<span class="${cls}">${esc(r.name)}</span>` : esc(r.name));

/* ---- Opening radar / recently closed ---- */
const opening = dataset.restaurants.filter(r => r.status === 'opening');
const RECENT_CLOSE_DAYS = 183;
const closedRecently = dataset.restaurants.filter(r =>
  r.status === 'closed' && r.statusDate &&
  (now - new Date(r.statusDate)) < RECENT_CLOSE_DAYS * 864e5);

const radarRow = r => `
      <li>
        <strong>${nameLink(r)}</strong>
        <span class="cand-meta">${esc(r.neighborhood ?? '')}${r.style ? ` · ${esc(r.style)}` : ''}</span>
        ${r.blurb ? `<span class="cand-note">${esc(r.blurb)}</span>` : ''}
        ${r.statusSource ? `<a href="${esc(r.statusSource)}" target="_blank" rel="noopener nofollow">source</a>` : ''}
      </li>`;

const closedRow = r => `
      <li>
        <strong>${esc(r.name)}</strong>
        <span class="cand-meta">${esc(r.neighborhood ?? '')}${r.style ? ` · ${esc(r.style)}` : ''}</span>
        ${r.statusNote ? `<span class="cand-note">${esc(r.statusNote)}</span>` : ''}
        ${r.statusSource ? `<a href="${esc(r.statusSource)}" target="_blank" rel="noopener nofollow">source</a>` : ''}
      </li>`;

const radarSection = (opening.length || closedRecently.length) ? `
<section class="section">
  <div class="wrap">
    <div class="eyebrow">The radar</div>
    <h2 class="sec-h">Opening soon${closedRecently.length ? ' &amp; recently closed' : ''}</h2>
    <p class="lede" style="margin-top:14px">
      Pizzerias on the way in${closedRecently.length ? ', and the ones Seattle just lost' : ''}.
      The daily research pass finds these in local coverage before they have review pages;
      each links to where it was reported. When one opens its doors it moves into the
      directory below, and into the ranking once it has been rated.
    </p>
    ${opening.length ? `
    <h3 class="buzz-head">Opening soon</h3>
    <ul class="cand-list">${opening.map(radarRow).join('')}</ul>` : ''}
    ${closedRecently.length ? `
    <h3 class="buzz-head">Recently closed</h3>
    <ul class="cand-list">${closedRecently.map(closedRow).join('')}</ul>` : ''}
  </div>
</section>
` : '';

/* ---- Style brackets ---- */
const allScored = [...ranked, ...restScored];
const byStyle = new Map();
for (const r of allScored) {
  if (!r.styleGroup) continue;
  if (!byStyle.has(r.styleGroup)) byStyle.set(r.styleGroup, []);
  byStyle.get(r.styleGroup).push(r);
}
const brackets = [...byStyle.entries()]
  .map(([group, list]) => ({ group, list: list.sort((a, b) => b.score - a.score) }))
  .sort((a, b) => b.list[0].score - a.list[0].score);

const bracketCard = ({ group, list }) => {
  const w = list[0];
  const rest = list.slice(1, 3);
  return `
        <div class="bracket">
          <div class="bracket-head">
            <h3>${esc(group)}</h3>
            <span>${list.length === 1 ? 'unopposed' : `${list.length} contenders`}</span>
          </div>
          <div class="bracket-win">
            <span class="bracket-medal">#${w.rank}</span>
            <div>
              <strong>${nameLink(w)}</strong>
              <div class="bracket-sub">${esc(locationLabel(w))} · ${w.score.toFixed(1)} SLICE</div>
            </div>
          </div>
          ${rest.length ? `<ul class="bracket-rest">${rest.map(r =>
            `<li><span>${nameLink(r)}</span><span>${r.score.toFixed(1)}</span></li>`).join('')}</ul>` : ''}
        </div>`;
};

const bracketSection = `
<section class="section">
  <div class="wrap">
    <div class="eyebrow">By style</div>
    <h2 class="sec-h">Best of each kind</h2>
    <p class="lede" style="margin-top:14px">
      A single list compares a Chicago deep pan to a Neapolitan margherita, which is not a fair
      fight in either direction. This table answers the question people actually arrive with:
      the best of the kind you want tonight.
    </p>
    <div class="brackets">${brackets.map(bracketCard).join('')}</div>
  </div>
</section>
`;

/* ---- The Buzz: one timeline, tagged with the pizzerias each story mentions ---- */
const KIND_LABEL = { opening: 'Opening', closing: 'Closing', ranking: 'List', mention: 'Mention' };
const entriesById = new Map(dataset.restaurants.map(r => [r.id, r]));

/* Conservative name matching: an entry tags a story only when its full name
 * appears in the title. The agent's explicit mentions[] ids are merged in. */
function storyTags(item) {
  const title = String(item.title).toLowerCase();
  const ids = new Set(item.mentions ?? []);
  for (const r of dataset.restaurants) {
    if (title.includes(r.name.toLowerCase())) ids.add(r.id);
  }
  return [...ids].map(id => entriesById.get(id)).filter(Boolean);
}

const buzzItem = b => {
  const tags = storyTags(b);
  return `
        <li class="buzz-item">
          <span class="buzz-kind k-${esc(b.kind || 'mention')}">${esc(KIND_LABEL[b.kind] || 'Mention')}</span>
          <div class="buzz-body">
            <a href="${esc(b.url)}" target="_blank" rel="noopener nofollow">${esc(b.title)}</a>
            <div class="buzz-meta">
              <span>${esc(b.source)}</span><span>${esc(shortDate(b.published))}</span>
              ${tags.map(r => nameLink(r, 'buzz-tag')).join('')}
            </div>
          </div>
        </li>`;
};

const buzzSources = [...new Set(buzz.items.map(b => b.source))].length;

const buzzSection = buzz.items.length ? `
<section class="section">
  <div class="wrap">
    <div class="eyebrow">The buzz</div>
    <h2 class="sec-h">What Seattle is writing about</h2>
    <p class="lede" style="margin-top:14px">
      Every day the build sweeps Google News and Eater Seattle for local pizza coverage and files
      it here, newest first. Stories that mention a pizzeria in the index are tagged with it.
      None of this feeds the score directly; press coverage reaches the ranking only through the
      bounded channels described in the methodology.
    </p>
    <div class="stamp" style="margin-top:18px">
      <span>${buzz.items.length} <b>stories</b></span>
      <span>${buzzSources} <b>outlets</b></span>
      ${buzz.updated ? `<span>Swept <b>${esc(shortDate(buzz.updated))}</b></span>` : ''}
    </div>
    <ul class="buzz-list">${buzz.items.map(buzzItem).join('')}</ul>
    <p class="note" style="max-width:70ch">
      Assembled automatically. A story is kept when it reads as local and about pizza;
      national-chain, crime and business-wire items are filtered out. Every item links to its
      original source.
    </p>
  </div>
</section>
` : '';

/* ---- Directory ---- */
const STATUS_LABEL = { open: 'Open', opening: 'Opening soon', closed: 'Closed' };
const scoreById = new Map(allScored.map(r => [r.id, r]));

const directoryEntries = [...dataset.restaurants].sort((a, b) => {
  const orderOf = r => r.status === 'closed' ? 2 : r.status === 'opening' ? 1 : 0;
  if (orderOf(a) !== orderOf(b)) return orderOf(a) - orderOf(b);
  const sa = scoreById.get(a.id)?.score ?? -1;
  const sb = scoreById.get(b.id)?.score ?? -1;
  return sb - sa || a.name.localeCompare(b.name);
});

const dirRow = r => {
  const scored = scoreById.get(r.id);
  const addr = (r.locations ?? []).map(l => l.address);
  const attrs = Object.keys(r.attributes ?? {}).filter(k => r.attributes[k])
    .map(k => dataset.attributeRegistry[k]?.label ?? k);
  return `
        <tr class="dir-row st-${esc(r.status ?? 'open')}" data-id="${esc(r.id)}">
          <td class="dir-name">${nameLink(r)}
            ${scored && scored.rank <= 10 ? `<span class="dir-rank">#${scored.rank}</span>` : ''}</td>
          <td class="dir-where">${esc(locationLabel(r))}${addr.length ? `
            <div class="dir-addr">${addr.slice(0, 3).map(esc).join('<br>')}${addr.length > 3 ? `
            <details class="dir-more"><summary>+ ${addr.length - 3} more</summary>${addr.slice(3).map(esc).join('<br>')}</details>` : ''}</div>` : ''}</td>
          <td class="dir-style">${esc(r.style ?? '')}</td>
          <td class="dir-attrs">${attrs.map(a => `<span class="chip">${esc(a)}</span>`).join('')}</td>
          <td class="num dir-score">${scored ? scored.score.toFixed(1) : '—'}</td>
          <td class="dir-status">${esc(STATUS_LABEL[r.status] ?? 'Open')}</td>
        </tr>`;
};

const directorySection = `
<section class="section" id="directory">
  <div class="wrap">
    <div class="eyebrow">The directory</div>
    <h2 class="sec-h">Every pizzeria on file</h2>
    <p class="lede" style="margin-top:14px">
      The full inventory behind the ranking: ${dataset.restaurants.length} entries, maintained by the
      daily research pass. Rated entries carry their SLICE score, so this is also where ranks 11
      and up live. Addresses are read from each pizzeria's own website and re-checked on a
      rotation; entries without a score have not been rated yet.
    </p>
    <div id="map" class="dir-map" aria-label="Map of Seattle pizzerias"></div>
    <p class="note dir-map-note">Seattle locations only — red for the top ten, brown for the
    rest of the field, green for places opening soon. Chains' branches outside the city are
    listed in the table, not mapped. Tiles &copy; OpenStreetMap contributors.</p>
    <div class="dir-scroll">
      <table class="dir-table">
        <thead><tr>
          <th>Pizzeria</th><th>Where</th><th>Style</th><th>Notes</th>
          <th class="num">SLICE</th><th>Status</th>
        </tr></thead>
        <tbody>${directoryEntries.map(dirRow).join('')}</tbody>
      </table>
    </div>
  </div>
</section>
`;

/* ---- controls ---- */
const careHeader = `
          <div class="care-corner" aria-hidden="true"></div>
          ${CARE_STEPS.map(st => `<div class="care-col"><b>${st.pct}</b><span>${st.word}</span></div>`).join('')}`;

const careRows = Object.keys(DEFAULT_WEIGHTS).map(k => `
          <div class="care-factor">
            <span class="factor-icon" aria-hidden="true">${PILLAR_META[k].icon}</span>
            <span class="factor-name">
              <b><span class="swatch" style="background:${PILLAR_META[k].color}"></span>${PILLAR_META[k].label}</b>
              <span class="factor-desc">${PILLAR_META[k].short}</span>
            </span>
            <span class="factor-val" id="v-${k}">${DEFAULT_WEIGHTS[k]}%</span>
          </div>
          ${CARE_STEPS.map(st => `
          <div class="care-cell">
            <input type="radio" name="care-${k}" id="care-${k}-${st.mult}" value="${st.mult}"
                   class="sr-only"${st.mult === 1 ? ' checked' : ''}
                   aria-label="${PILLAR_META[k].label}: ${st.pct}">
            <label for="care-${k}-${st.mult}"></label>
          </div>`).join('')}`).join('');

const factorCards = Object.keys(DEFAULT_WEIGHTS).map(k => `
        <div class="pillar">
          <div class="w">${DEFAULT_WEIGHTS[k]}<span style="font-size:15px;color:var(--ink-3)">%</span></div>
          <h3><span class="swatch" style="background:${PILLAR_META[k].color}"></span>${PILLAR_META[k].label}</h3>
          <p>${FACTOR_COPY[k]}</p>
        </div>`).join('');

const frictionRows = Object.entries(dataset.attributeRegistry)
  .filter(([, a]) => a.frictionCost > 0)
  .sort((a, b) => b[1].frictionCost - a[1].frictionCost)
  .map(([, a]) => `<tr><td>${esc(a.label)}</td><td class="num">−${a.frictionCost.toFixed(1)}</td></tr>`)
  .join('');

/* ---- page ---- */
const html = `<!doctype html>
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
<style>${read('src/vendor/leaflet.css')}
${read('src/styles.css')}</style>
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
</section>

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
    <ol class="flow">
      <li class="flow-step">
        <span class="flow-when">12:47 UTC</span>
        <b>Research</b>
        <p>An agent works a rotating task list: verifying addresses and websites against each
        pizzeria's own site, checking whether entries are still open, discovering pizzerias not
        yet on file, and finding coverage the feed sweep missed.</p>
      </li>
      <li class="flow-gate">
        <b>Validation</b>
        <p>Everything the agent returns is checked before anything is written: https sources on
        every claim, addresses that parse as addresses, Puget Sound ZIP codes, no duplicates,
        factor proposals bounded and cited. One bad entry rejects the whole file.</p>
      </li>
      <li class="flow-step">
        <span class="flow-when">13:17 UTC</span>
        <b>Rebuild</b>
        <p>Feeds are swept, validated research is merged, and every rated entry is scored from
        scratch. The ten highest open entries become the list; everything else files into the
        directory. Once per ISO week the standings are snapshotted, which is what the ▲▼
        markers compare against.</p>
      </li>
      <li class="flow-step flow-last">
        <b>Deploy</b>
        <p>The site is rebuilt and published. If any step fails, nothing deploys and yesterday's
        site stays up.</p>
      </li>
    </ol>

    <h3 class="method-h">What moves an entry</h3>
    <ul class="plain method-movers">
      <li><b>A closure</b> — immediate. A cited closure removes an entry from the top ten at the
        next build, whatever its score.</li>
      <li><b>Press coverage</b> — fast but bounded. New stories feed critical reception through
        the capped boost and reputation through the coverage component.</li>
      <li><b>Freshness decay</b> — continuous. The only input that moves with no news at all.</li>
      <li><b>Attribute changes</b> — when verified. Dropping preorder-only service returns up to
        ${FRICTION_CAP.toFixed(1)} points of friction.</li>
      <li><b>A re-rating</b> — rare and deliberate. Craft and distinctiveness change only when
        the judgment does, with the change and its source recorded.</li>
      <li><b>Your weights</b> — instant, local, and yours alone. Nothing you set here is saved
        or sent anywhere.</li>
    </ul>

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
  builtAt: now.toISOString()
}).replace(/</g, '\\u003c')};</script>
<script src="./leaflet.js"></script>
<script type="module" src="./app.js"></script>
</body>
</html>
`;

/* ---- emit ---- */
fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });
fs.writeFileSync(path.join(dist, 'index.html'), html);
// Every module app.js can reach at runtime, including render.js's own imports.
// Missing one is a 404 in the browser and a dead re-ranker; verify.mjs walks
// the import graph to catch it.
for (const f of ['slice.js', 'render.js', 'locations.js', 'app.js']) {
  fs.copyFileSync(path.join(root, 'src', f), path.join(dist, f));
}
fs.copyFileSync(path.join(root, 'src/vendor/leaflet.js'), path.join(dist, 'leaflet.js'));
fs.writeFileSync(path.join(dist, '.nojekyll'), '');
fs.writeFileSync(path.join(dist, 'rankings.json'), JSON.stringify({
  builtAt: now.toISOString(),
  week,
  algorithm: 'SLICE v2',
  weights: DEFAULT_WEIGHTS,
  rankings: allScored.map(r => ({
    rank: r.rank, id: r.id, name: r.name, neighborhood: locationLabel(r),
    locations: r.locations ?? [], locationsVerified: r.locationsVerified ?? null,
    style: r.style, styleGroup: r.styleGroup,
    status: r.status ?? 'open',
    score: r.score, previousRank: baseline[r.id] ?? null,
    factors: r.factorScores, penalty: r.penaltyApplied
  })),
  directory: dataset.restaurants.map(r => ({
    id: r.id, name: r.name, url: r.url ?? null, status: r.status ?? 'open',
    neighborhood: locationLabel(r), locations: r.locations ?? []
  })),
  brackets: brackets.map(b => ({
    group: b.group, contenders: b.list.length,
    winner: { id: b.list[0].id, name: b.list[0].name, score: b.list[0].score }
  }))
}, null, 2));

/* ---- record this week's standings ----
 * One snapshot per ISO week; a rerun inside the same week overwrites it. */
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
