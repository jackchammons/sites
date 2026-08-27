/* Card rendering shared by the static build and the in-browser re-ranker. */
import { locationLabel, locationList, locationCount } from './locations.js';

export const PILLAR_META = {
  reputation:      { label: 'Reputation',         color: 'var(--tomato)', icon: '🏛️',
                     short: 'Standing earned over time' },
  critical:        { label: 'Critical reception', color: '#5b8dd6',       icon: '📰',
                     short: 'What critics and press say' },
  craft:           { label: 'Craft',              color: 'var(--crust)',  icon: '🍕',
                     short: 'The pizza itself: dough, bake, toppings' },
  distinctiveness: { label: 'Distinctiveness',    color: '#a06fd0',       icon: '✨',
                     short: 'Whether it owns a lane in this city' },
  value:           { label: 'Value',              color: 'var(--basil)',  icon: '💵',
                     short: 'Quality delivered per dollar' }
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
  // Two comparison modes. The published board compares against last week's
  // snapshot; a custom-weighted board compares against the full published
  // order, so an entry pulled in from outside the ten names its real origin.
  const pub = r.deltaVs === 'published';
  const t = pub ? 'Movement vs. the published ranking'
              : 'Movement vs. last week\u2019s published ranking';
  if (r.previousRank == null) {
    return `<div class="delta flat" title="${t}">${pub ? 'unranked in published list' : 'new this week'}</div>`;
  }
  const d = r.previousRank - r.rank;
  const from = pub ? `published #${r.previousRank}` : `was #${r.previousRank} last week`;
  if (d === 0) return `<div class="delta flat" title="${t}">— ${pub ? 'published #' + r.previousRank : 'steady this week'}</div>`;
  return d > 0
    ? `<div class="delta up" title="${t}">▲ ${d} · ${from}</div>`
    : `<div class="delta down" title="${t}">▼ ${-d} · ${from}</div>`;
}

export function cardHtml(r) {
  const total = Object.values(r.contributions).reduce((a, b) => a + b, 0) + r.penaltyApplied;
  const seg = v => (v / total) * 100;

  const stack = Object.keys(PILLAR_META)
    .map(k => `<i style="width:${seg(r.contributions[k]).toFixed(2)}%;background:${PILLAR_META[k].color}" title="${PILLAR_META[k].label}: ${n1(r.contributions[k])} pts"></i>`)
    .join('') +
    (r.penaltyApplied > 0
      ? `<i class="penalty" style="width:${seg(r.penaltyApplied).toFixed(2)}%" title="Friction penalty: -${n1(r.penaltyApplied)} pts"></i>`
      : '');

  const chips = [
    `<span class="chip">${esc(r.style)}</span>`,
    `<span class="chip">${'$'.repeat(r.priceIndex)}</span>`,
    ...(r.frictionDetail.all || []).map(a => `<span class="chip fr">${esc(a.label)}</span>`)
  ].join('');

  const rows = Object.keys(PILLAR_META).map(k => `
        <tr>
          <td><span class="swatch" style="background:${PILLAR_META[k].color}"></span>${PILLAR_META[k].label}
            <span class="minibar"><i style="width:${(r.factorScores[k] * 10).toFixed(1)}%;background:${PILLAR_META[k].color}"></i></span>
          </td>
          <td class="num">${n1(r.factorScores[k])}<span style="color:var(--ink-3)">/10</span></td>
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
          ${r.signature ? `<p class="sig">“${esc(r.signature)}”</p>` : ''}
          ${r.blurb ? `<p class="blurb">${esc(r.blurb)}</p>` : ''}
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
            Critical reception starts from a critic base of ${n1(r.criticalDetail.base)}/10${
              r.criticalDetail.boost > 0
                ? `, lifted ${n1(r.criticalDetail.boost)} by recent press coverage`
                : ''}. Reputation combines ${r.reputationDetail.parts.map(p =>
                `${p.key} (${esc(p.note)})`).join(', ') || 'no measurable inputs yet'}.
            Value is ${n1(r.valueDetail.quality)}/10 quality &times; ${r.valueDetail.mult.toFixed(2)}
            for the ${'$'.repeat(r.priceIndex)} tier.${r.crowd ? `
            Star rating shown for context only, never scored: ${r.crowd.rating.toFixed(1)}★ across
            ~${r.crowd.reviews.toLocaleString('en-US')} reviews, de-noised to
            ${r.crowdContext.adjusted.toFixed(2)}★. Observed ${esc(r.lastVerified || 'at the dataset date')}.` : ''}
          </p>
        </div>
      </details>
    </article>`;
}

export function boardHtml(ranked) {
  return ranked.map(cardHtml).join('\n');
}
