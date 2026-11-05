/* Card rendering for the static build. The ranking is computed once at build
 * time and served as HTML; nothing here runs in the browser. */
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

/* Every neighborhood for a multi-site pizzeria, printed under the meta line.
 * A single-location place already reads correctly in the meta line itself, so
 * this stays out of its way. */
function locationsHtml(r) {
  const sites = locationList(r);
  if (!sites || sites.length < 2) return '';
  const title = r.locationsVerified
    ? ` title="Verified ${esc(r.locationsVerified)} from ${esc(r.locationsSource ?? 'the pizzeria')}"` : '';
  return `<div class="locs"${title}>`
    + `<span class="locs-label">${esc(locationCount(r))}</span> ${sites.map(esc).join(' <em>·</em> ')}</div>`;
}

export const esc = s => String(s).replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const n1 = n => n.toFixed(1);
const signed = n => (n >= 0 ? '+' : '−') + Math.abs(n).toFixed(1);

function deltaHtml(r) {
  const t = 'Movement vs. last week’s published ranking';
  if (r.previousRank == null) return `<div class="delta flat" title="${t}">new this week</div>`;
  const d = r.previousRank - r.rank;
  if (d === 0) return `<div class="delta flat" title="${t}">— steady this week</div>`;
  return d > 0
    ? `<div class="delta up" title="${t}">▲ ${d} · was #${r.previousRank} last week</div>`
    : `<div class="delta down" title="${t}">▼ ${-d} · was #${r.previousRank} last week</div>`;
}

/* ---- the field: what every input is compared against ----
 * Means over the rated, open entries, so a factor reads as above or below the
 * competition rather than as a bare number. Reputation averages only the
 * entries that have one; an unmeasured entry has no score to average. */
export function fieldStats(scored) {
  const open = scored.filter(r => (r.status ?? 'open') === 'open');
  const mean = xs => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
  const means = {};
  for (const k of Object.keys(PILLAR_META)) {
    const xs = open.filter(r => k !== 'reputation' || r.reputationDetail?.measured).map(r => r.factorScores[k]);
    means[k] = mean(xs);
  }
  return { n: open.length, means, criticBase: mean(open.map(r => r.criticalDetail.base)) };
}

/* Three tones, by how an input compares with the field: a half point either
 * side of the mean is "about average". Deductions are their own case. */
const BAND = 0.5;
const toneOf = diff => diff >= BAND ? 'pos' : diff <= -BAND ? 'neg' : 'mid';
const tag = (tone, text) => `<span class="tone t-${tone}">${text}</span>`;
const vsField = (v, m) => tag(toneOf(v - m), `${signed(v - m)} vs field`);

function reputationRows(r, field) {
  const d = r.reputationDetail;
  if (!d.measured) {
    return [`<tr class="sub"><td colspan="5">${tag('mid', 'no data')} No founding year, review count or press on file, so reputation carries no weight for this entry and the other four factors share its ${Math.round(r.weightShares.reputation || 0) || 24}%.</td></tr>`];
  }
  const names = { longevity: 'Longevity', volume: 'Review volume', coverage: 'Press coverage' };
  const rows = d.parts.map(p => {
    const counted = d.counted.includes(p.key);
    const tone = p.x >= 0.6 ? 'pos' : p.x >= 0.3 ? 'mid' : 'neg';
    return `<tr class="sub"><td colspan="5">${tag(counted ? tone : 'mid', counted ? `${(p.x * 10).toFixed(1)}/10` : 'not counted')} ${names[p.key]}: ${esc(p.note)}${
      counted ? '' : ' — on file but below the level of the rest, so it would lower the mean and is left out'}</td></tr>`;
  });
  const missing = ['longevity', 'volume', 'coverage'].filter(k => !d.parts.some(p => p.key === k));
  if (missing.length) {
    const what = { longevity: 'no founding year', volume: 'no review count', coverage: 'no press in 24 months' };
    rows.push(`<tr class="sub"><td colspan="5">${tag('mid', 'no data')} ${missing.map(k => what[k]).join(', ')} on file; the factor is read from what is</td></tr>`);
  }
  return rows;
}

function criticalRows(r, field) {
  const d = r.criticalDetail;
  const recent = (r.mentions ?? []).length;
  return [
    `<tr class="sub"><td colspan="5">${vsField(d.base, field.criticBase)} Critic base ${n1(d.base)}/10, the graded rating; the field averages ${n1(field.criticBase)}</td></tr>`,
    d.boost > 0
      ? `<tr class="sub"><td colspan="5">${tag('pos', `+${n1(d.boost)}`)} Press boost from ${recent} cited mention${recent === 1 ? '' : 's'}, recency-weighted and capped at +1.5</td></tr>`
      : `<tr class="sub"><td colspan="5">${tag('mid', '+0.0')} No press boost: ${recent ? 'the mentions on file are too old to count' : 'no cited coverage on file'}</td></tr>`
  ];
}

function valueRows(r) {
  const d = r.valueDetail;
  const price = Number.isInteger(r.priceIndex) && r.priceIndex > 0 ? '$'.repeat(r.priceIndex) : null;
  const tone = d.mult > 1 ? 'pos' : d.mult < 1 ? 'neg' : 'mid';
  return [`<tr class="sub"><td colspan="5">${tag(tone, `×${d.mult.toFixed(2)}`)} Quality ${n1(d.quality)}/10 (the mean of craft and critical reception) ${
    price ? `scaled by the ${price} price tier` : 'at the neutral multiplier, since no price tier is on file'}</td></tr>`];
}

function whyLine(r, field) {
  const diffs = Object.keys(PILLAR_META)
    .filter(k => k !== 'reputation' || r.reputationDetail.measured)
    .map(k => ({ k, d: r.factorScores[k] - field.means[k] }));
  const up = diffs.filter(x => x.d >= BAND).sort((a, b) => b.d - a.d);
  const down = diffs.filter(x => x.d <= -BAND).sort((a, b) => a.d - b.d);
  const name = k => PILLAR_META[k].label.toLowerCase();
  const parts = [];
  if (up.length) parts.push(`ahead of the field on ${up.map(x => `${name(x.k)} (${signed(x.d)})`).join(', ')}`);
  if (down.length) parts.push(`behind it on ${down.map(x => `${name(x.k)} (${signed(x.d)})`).join(', ')}`);
  if (!up.length && !down.length) parts.push('within half a point of the field on every factor');
  const drags = [];
  if (r.penaltyApplied > 0) drags.push(`friction costs it ${n1(r.penaltyApplied)} points`);
  if (r.stalenessDecay >= 0.02) drags.push(`freshness decay takes ${(r.stalenessDecay * 100).toFixed(1)}%`);
  if (!r.reputationDetail.measured) drags.push('reputation is unmeasured, so its weight goes to the other four');
  const dragLine = drags.length ? ` ${drags[0][0].toUpperCase()}${drags.join('; ').slice(1)}.` : '';
  return `<b>Why #${r.rank}:</b> ${parts.join('; ')}.${dragLine}`;
}

export function cardHtml(r, field) {
  // The bar is a 100-point track. The coloured segments split the score itself
  // in proportion to each factor's contribution, so they end exactly at the
  // score; the hatched tail is what friction took off (after decay). A bar
  // that always filled the track made a 90 and an 80 look the same.
  const keep = 1 - r.stalenessDecay;
  const base = Object.values(r.contributions).reduce((a, b) => a + b, 0) || 1;
  const share = k => r.contributions[k] * r.score / base;
  const stack = Object.keys(PILLAR_META)
    .map(k => `<i style="width:${share(k).toFixed(2)}%;background:${PILLAR_META[k].color}" title="${PILLAR_META[k].label}: ${n1(share(k))} of ${n1(r.score)} pts"></i>`)
    .join('') +
    (r.penaltyApplied > 0
      ? `<i class="penalty" style="width:${(r.penaltyApplied * keep).toFixed(2)}%" title="Friction penalty: −${n1(r.penaltyApplied * keep)} pts"></i>`
      : '');

  const price = Number.isInteger(r.priceIndex) && r.priceIndex > 0 ? '$'.repeat(r.priceIndex) : '';
  const chips = [
    `<span class="chip">${esc(r.style)}</span>`,
    ...(price ? [`<span class="chip">${price}</span>`] : []),
    ...(r.frictionDetail.all || []).map(a => `<span class="chip fr">${esc(a.label)}</span>`),
    ...(r.instagram ? [`<a class="chip chip-ig" href="${esc(r.instagram)}" target="_blank" rel="noopener nofollow">Instagram</a>`] : [])
  ].join('');

  const subRows = {
    reputation: reputationRows(r, field),
    critical: criticalRows(r, field),
    value: valueRows(r)
  };
  const rows = Object.keys(PILLAR_META).map(k => {
    const measured = k !== 'reputation' || r.reputationDetail.measured;
    const v = r.factorScores[k];
    return `
        <tr class="fac">
          <td><span class="swatch" style="background:${PILLAR_META[k].color}"></span>${PILLAR_META[k].label}</td>
          <td class="num">${measured ? n1(v) : '—'}</td>
          <td class="num dim">${n1(field.means[k])}</td>
          <td class="num">${measured ? vsField(v, field.means[k]) : tag('mid', 'unmeasured')}</td>
          <td class="num">${Math.round(r.weightShares[k])}% → <b>${n1(r.contributions[k])}</b></td>
        </tr>${(subRows[k] ?? []).join('')}`;
  }).join('');

  const frictionRows = r.penaltyApplied > 0 ? `
        <tr class="fac"><td>Friction${r.frictionDetail.raw > r.frictionDetail.applied ? ' (capped at 6.0)' : ''}</td>
          <td class="num">—</td><td class="num dim">—</td>
          <td class="num">${tag('neg', `−${n1(r.penaltyApplied)}`)}</td><td class="num"><b>−${n1(r.penaltyApplied)}</b></td></tr>` +
        (r.frictionDetail.items || []).map(a =>
          `<tr class="sub"><td colspan="5">${tag('neg', `−${a.cost.toFixed(1)}`)} ${esc(a.label)}</td></tr>`).join('')
    : `
        <tr class="fac"><td>Friction</td><td class="num">—</td><td class="num dim">—</td>
          <td class="num">${tag('pos', 'none')}</td><td class="num"><b>−0.0</b></td></tr>`;

  const decayTone = r.stalenessDecay === 0 ? 'pos' : r.stalenessDecay < 0.02 ? 'mid' : 'neg';
  const decayRow = `
        <tr class="fac"><td>Freshness</td><td class="num">—</td><td class="num dim">—</td>
          <td class="num">${tag(decayTone, r.stalenessDecay === 0 ? 'current' : `−${(r.stalenessDecay * 100).toFixed(1)}%`)}</td>
          <td class="num"><b>×${(1 - r.stalenessDecay).toFixed(3)}</b></td></tr>
        <tr class="sub"><td colspan="5">${r.verified
          ? `Last verified by a ${esc(r.verified.source)} on ${esc(r.verified.date)}; decay runs 0.2% a week from there, capped at 6%`
          : 'Never verified, so decay sits at the 6% cap'}</td></tr>`;

  return `
    <article class="card${r.rank <= 3 ? ' top' : ''}" data-id="${esc(r.id)}">
      <div class="card-main">
        <div class="rankno">${r.rank}</div>
        <div>
          <div class="title-row">
            <h3>${r.url ? `<a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.name)}</a>` : esc(r.name)}</h3>
          </div>
          <div class="meta">${esc(locationLabel(r))} <em>·</em> ${esc(r.style)}${
            typeof r.opened === 'number' ? ` <em>·</em> est. ${r.opened}` : ''}</div>
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
      <div class="stack" title="${n1(r.score)} of 100">${stack}</div>
      ${r.evidenceHtml ? `<div class="why">${r.evidenceHtml}</div>` : ''}
      <div class="chips">${chips}</div>
      <details class="math">
        <summary>Why it ranks #${r.rank} <span class="hint">every input, against the other ${field.n - 1} rated pizzerias</span></summary>
        <div class="mathbody">
          <p class="whyline">${whyLine(r, field)}</p>
          <p class="legend"><span class="tone t-pos">green</span> helps the score against the field · <span class="tone t-mid">amber</span> about average, or no data · <span class="tone t-neg">red</span> holds it back</p>
          <table class="calc">
            <thead><tr><th>Input</th><th class="num">Here</th><th class="num">Field</th><th class="num">Read</th><th class="num"><span class="wide">Weight → </span>points</th></tr></thead>
            <tbody>
              ${rows}
              ${frictionRows}
              ${decayRow}
              <tr class="sum"><td>SLICE score</td><td class="num"></td><td class="num dim"></td><td class="num"></td><td class="num">${n1(r.score)}</td></tr>
            </tbody>
          </table>${r.crowd ? `
          <p class="note">Star average shown for context only: ${r.crowd.rating.toFixed(1)}★ across
            ~${r.crowd.reviews.toLocaleString('en-US')} reviews; the review count is what reputation reads.
            Figures on file ${esc(r.crowd.observed ? `from ${r.crowd.observed}` : 'since the index launched')}${
              r.crowd.source ? `, ${esc(r.crowd.source)}` : ''}.</p>` : ''}
        </div>
      </details>
    </article>`;
}

export function boardHtml(ranked, field) {
  return ranked.map(r => cardHtml(r, field)).join('\n');
}
