/* Card rendering shared by the static build and the in-browser re-ranker. */
import { FRICTION_LABELS } from './slice.js';
import { locationLabel, locationList, locationCount } from './locations.js';

export const PILLAR_META = {
  crust:           { label: 'Crust Integrity',  color: 'var(--crust)',  icon: '🥖',
                     short: 'Dough, fermentation and bake' },
  toppings:        { label: 'Topping Craft',    color: 'var(--tomato)', icon: '🍅',
                     short: 'Sourcing, balance and restraint' },
  consensus:       { label: 'Critical Read',    color: '#5b8dd6',       icon: '📰',
                     short: 'What reviewers say about the pie' },
  distinctiveness: { label: 'Distinctiveness',  color: '#a06fd0',       icon: '✨',
                     short: 'Whether it owns a lane in this city' },
  value:           { label: 'Value Density',    color: 'var(--basil)',  icon: '💵',
                     short: 'Satisfaction per dollar spent' }
};

/* The five positions of the weight control. 100% is the published weight for
 * that factor; the others scale it before everything renormalises to 100. */
export const CARE_STEPS = [
  { mult: 0,   pct: '0%',   word: "Don't care" },
  { mult: 0.5, pct: '50%',  word: 'A little'   },
  { mult: 1,   pct: '100%', word: 'Standard'   },
  { mult: 1.5, pct: '150%', word: 'A lot'      },
  { mult: 2,   pct: '200%', word: 'Above all'  }
];


/* Every neighborhood for a multi-site pizzeria, printed under the meta line.
 * A single-location place already reads correctly in the meta line itself, so
 * this stays out of its way. */
function locationsHtml(r) {
  const sites = locationList(r);
  if (!sites || sites.length < 2) return '';
  return `<div class="locs" title="Verified ${esc(r.locationsVerified)} from ${esc(r.locationsSource ?? 'the pizzeria')}">`
    + `<span class="locs-label">${esc(locationCount(r))}</span> ${sites.map(esc).join(' <em>·</em> ')}</div>`;
}

export const esc = s => String(s).replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const n1 = n => n.toFixed(1);
const pct = n => Math.round(n * 100);

function deltaHtml(r) {
  if (r.previousRank == null) return '<div class="delta flat">new entry</div>';
  const d = r.previousRank - r.rank;
  if (d === 0) return '<div class="delta flat">— no change</div>';
  return d > 0
    ? `<div class="delta up">▲ ${d} from #${r.previousRank}</div>`
    : `<div class="delta down">▼ ${-d} from #${r.previousRank}</div>`;
}

export function cardHtml(r) {
  const total = Object.values(r.contributions).reduce((a, b) => a + b, 0) + r.penaltyApplied;
  const seg = v => (v / total) * 100;

  const stack = Object.keys(PILLAR_META)
    .map(k => `<i class="${k}" style="width:${seg(r.contributions[k]).toFixed(2)}%" title="${PILLAR_META[k].label}: ${n1(r.contributions[k])} pts"></i>`)
    .join('') +
    (r.penaltyApplied > 0
      ? `<i class="penalty" style="width:${seg(r.penaltyApplied).toFixed(2)}%" title="Friction penalty: -${n1(r.penaltyApplied)} pts"></i>`
      : '');

  const chips = [
    `<span class="chip">${esc(r.style)}</span>`,
    `<span class="chip">${'$'.repeat(r.priceIndex)}</span>`,
    `<span class="chip">${pct(r.confidence)}% data confidence</span>`,
    ...(r.friction || []).map(f => `<span class="chip fr">${esc(FRICTION_LABELS[f] || f)}</span>`)
  ].join('');

  const rows = Object.keys(PILLAR_META).map(k => `
        <tr>
          <td><span class="swatch" style="background:${PILLAR_META[k].color}"></span>${PILLAR_META[k].label}
            <span class="minibar"><i style="width:${(r.pillars[k] * 10).toFixed(1)}%;background:${PILLAR_META[k].color}"></i></span>
          </td>
          <td class="num">${n1(r.pillars[k])}<span style="color:var(--ink-3)">/10</span></td>
          <td class="num">${Math.round(r.weightShares[k])}%</td>
          <td class="num">${n1(r.contributions[k])}</td>
        </tr>`).join('');

  const penaltyRow = r.penaltyApplied > 0 ? `
        <tr class="neg"><td>Friction penalty${r.frictionDetail.raw > r.frictionDetail.applied ? ' (capped at 6.0)' : ''}</td>
          <td class="num">—</td><td class="num">—</td><td class="num">−${n1(r.penaltyApplied)}</td></tr>` : '';

  const decayRow = r.stalenessDecay > 0 ? `
        <tr class="neg"><td>Freshness factor · verified ${esc(r.lastVerified)}</td>
          <td class="num">—</td><td class="num">—</td>
          <td class="num">×${(1 - r.stalenessDecay).toFixed(3)}</td></tr>` : '';

  return `
    <article class="card${r.rank <= 3 ? ' top' : ''}" data-id="${esc(r.id)}">
      <div class="card-main">
        <div class="rankno">${r.rank}</div>
        <div>
          <div class="title-row">
            <h3>${r.url ? `<a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.name)}</a>` : esc(r.name)}</h3>
          </div>
          <div class="meta">${esc(locationLabel(r))} <em>·</em> ${esc(r.style)} <em>·</em> est. ${r.opened}</div>
          ${locationsHtml(r)}
          <p class="sig">“${esc(r.signature)}”</p>
          <p class="blurb">${esc(r.blurb)}</p>
        </div>
        <div class="scorebox">
          <div class="n">${n1(r.score)}</div>
          <div class="l">SLICE score</div>
          ${deltaHtml(r)}
        </div>
      </div>
      <div class="stack">${stack}</div>
      <div class="chips">${chips}</div>
      <details class="math">
        <summary>Show the math</summary>
        <div class="mathbody">
          <table class="calc">
            <thead><tr><th>Pillar</th><th class="num">Score</th><th class="num">Weight</th><th class="num">Points</th></tr></thead>
            <tbody>
              ${rows}
              ${penaltyRow}
              ${decayRow}
              <tr class="sum"><td>SLICE score</td><td class="num"></td><td class="num"></td><td class="num">${n1(r.score)}</td></tr>
            </tbody>
          </table>
          <p class="note">
            Critical Read is a straight ${n1(r.criticScore)}/10 — the same measurement for every
            entry.${r.crowd ? ` For context only, and <b>not part of the score</b>: a raw
            ${r.crowd.rating.toFixed(1)}★ across ~${r.crowd.reviews.toLocaleString('en-US')} reviews,
            which Bayesian shrinkage pulls to <b>${r.consensusDetail.adjusted.toFixed(3)}★</b>
            (${pct(r.confidence)}% weight on the crowd, ${100 - pct(r.confidence)}% on the city mean).
            Observed ${esc(r.lastVerified || 'at the dataset date')}.`
            : ` No crowd rating is shown for this entry. It makes no difference to the score, which
            uses the critical read for every entry alike.`}
          </p>
        </div>
      </details>
    </article>`;
}

export function boardHtml(ranked) {
  return ranked.map(cardHtml).join('\n');
}

/* Bench rows. Compact by design: fifteen full cards would bury the top ten. */
const cutoffOf = r => r.__cutoff ?? r.score;

export function benchRowHtml(r) {
  return `
        <li class="bench-row${r.status === 'closed' ? ' closed' : r.contender ? ' contender' : ''}">
          <span class="bench-rank">${r.rank}</span>
          <span class="bench-name">${r.url ? `<a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.name)}</a>` : esc(r.name)}</span>
          <span class="bench-meta">${esc(locationLabel(r))} · ${esc(r.style)}</span>
          <span class="bench-score">${r.score.toFixed(1)}</span>
          <span class="bench-flag">${r.status === 'closed' ? 'reported closed' : r.contender ? 'promotion range' : `${(r.score - cutoffOf(r)).toFixed(1)} off the cut`}</span>
        </li>`;
}

export function benchHtml(benched, cutoff) {
  return benched.map(r => benchRowHtml({ ...r, __cutoff: cutoff })).join('\n');
}
