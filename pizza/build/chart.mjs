import { esc } from './html.mjs';

/* ---- the record: 12 weeks of the top ten as a bump chart ----
 * Server-rendered inline SVG. Every line and every dot is coloured.
 *
 * Colour: eight categorical hues, --series-1 to --series-8 in styles.css,
 * with a light and a dark step each, validated as a set against both page
 * surfaces for separation under colour-vision deficiency. Eight is as many as
 * stay apart; twelve weeks of a top ten holds about twenty pizzerias. So a
 * series is a hue AND a line style: the first eight are solid with a filled
 * dot, the next eight reuse the hues dashed with a ring for a dot, the eight
 * after that dotted with a diamond. No hue is ever generated for a ninth.
 *
 * Every line also carries its name at its end, so identity never rests on
 * colour, and four of the light steps sit under 3:1 on the page, which the
 * names are the relief for. The same record is in the markup as a table for a
 * reader who cannot see the chart; it is not drawn. */
export const SERIES_HUES = 8;
export const SERIES_STYLES = 3;
/* Which hue and which line style the nth series wears, n from 0. Past the
 * twenty-four combinations they come round again, and the names still tell
 * two lines apart. */
export const seriesSlot = n => ({ hue: n % SERIES_HUES + 1, style: Math.floor(n / SERIES_HUES) % SERIES_STYLES });

export function bumpChart(snaps, entriesById) {
  const weeks = snaps.slice(-12);
  if (weeks.length < 2) return null;

  // The plain styles go to the entities that give the eye the most work:
  // longest tenure in the ten first, best rank as the tie-break. The order is
  // stable within any one view and moves slowly from week to week.
  const stats = new Map();
  weeks.forEach((w, i) => {
    for (const [id, rk] of Object.entries(w.ranks)) {
      if (rk > 10) continue;
      const st = stats.get(id) ?? { weeks: 0, best: 99, first: i };
      st.weeks++; st.best = Math.min(st.best, rk);
      stats.set(id, st);
    }
  });
  const order = [...stats.keys()].sort((a, b) => {
    const A = stats.get(a), B = stats.get(b);
    return B.weeks - A.weeks || A.best - B.best || A.first - B.first;
  });
  const slotOf = id => seriesSlot(order.indexOf(id));
  const nameOf = id => entriesById.get(id)?.name ?? id;

  const padL = 34, padR = 200, padT = 26, padB = 22, rowH = 33;
  const plotW = 680;
  const W = padL + plotW + padR, H = padT + rowH * 9 + padB + 10;
  const x = i => padL + (weeks.length === 1 ? plotW / 2 : (plotW / (weeks.length - 1)) * i);
  const y = rank => padT + (rank - 1) * rowH + 5;

  const grid = Array.from({ length: 10 }, (_, i) => {
    const yy = y(i + 1);
    return `<line x1="${padL - 6}" y1="${yy}" x2="${padL + plotW}" y2="${yy}"/>` +
      `<text class="rank-lab" x="${padL - 12}" y="${yy + 3.5}" text-anchor="end">#${i + 1}</text>`;
  }).join('');

  const weekLabs = weeks.map((w, i) =>
    `<text class="week-lab" x="${x(i)}" y="${padT - 12}" text-anchor="middle">W${String(w.week).padStart(2, '0')}</text>`).join('');

  // A formula change is drawn as a rule between the two columns, so a line
  // that stops there reads as a re-scoring, not a pizzeria falling out. The
  // label is the version alone: changes in consecutive weeks are one column
  // apart, and the full name runs into its neighbour.
  const changes = weeks.map((w, i) => i > 0 && w.algorithm && weeks[i - 1].algorithm && w.algorithm !== weeks[i - 1].algorithm
    ? `<g class="method-change"><line x1="${(x(i - 1) + x(i)) / 2}" y1="${padT - 6}" x2="${(x(i - 1) + x(i)) / 2}" y2="${padT + rowH * 9 + 10}" stroke="var(--ink-3)" stroke-dasharray="4 4"/>` +
      `<text class="week-lab" x="${(x(i - 1) + x(i)) / 2}" y="${padT + rowH * 9 + 22}" text-anchor="middle" fill="var(--ink-3)" font-size="9">↑ ${esc(w.algorithm.replace(/^SLICE\s+/, ''))}<title>Scoring method changed to ${esc(w.algorithm)}</title></text></g>` : '').join('');

  /* A dot: a filled circle, a ring, or a diamond, by line style. The colour
   * comes from the series' class in CSS, never from an attribute here. */
  const mark = (style, px, py, title) => style === 2
    ? `<path class="mark" d="M${px},${py - 5.5} L${px + 5.5},${py} L${px},${py + 5.5} L${px - 5.5},${py} Z"><title>${title}</title></path>`
    : `<circle class="mark" cx="${px}" cy="${py}" r="4.5"><title>${title}</title></circle>`;

  /* Where the name of a line that has left the ten goes. There is room for
   * one line of text between two ranks, so two lines that stop a week apart
   * on the same rank would write their names over each other. Each name tries
   * four places round its last dot (above it ending at the dot, the default;
   * above it starting there; below, both ways) and takes the first that
   * overlaps no name already placed and stays inside the drawing. The width
   * is an estimate: the font is monospace, about 6px a character at this
   * size. A name with nowhere free takes the default and overlaps, which is
   * what all of them did before. */
  const placed = [];
  const CHAR_W = 6.1, LAB_H = 11;
  const placeOut = (px, py, name) => {
    const w = name.length * CHAR_W;
    const spots = [
      { x: px + 4, y: py - 9, anchor: 'end' }, { x: px - 4, y: py - 9, anchor: 'start' },
      { x: px + 4, y: py + 17, anchor: 'end' }, { x: px - 4, y: py + 17, anchor: 'start' }
    ].map(sp => ({ ...sp, x0: sp.anchor === 'end' ? sp.x - w : sp.x, x1: sp.anchor === 'end' ? sp.x : sp.x + w, y0: sp.y - LAB_H + 1, y1: sp.y + 2 }));
    const free = sp => sp.x0 >= 0 && sp.x1 <= W - 4 && sp.y0 >= 0 && sp.y1 <= H
      && !placed.some(q => sp.x0 < q.x1 + 4 && q.x0 < sp.x1 + 4 && sp.y0 < q.y1 && q.y0 < sp.y1);
    const spot = spots.find(free) ?? spots[0];
    placed.push(spot);
    return spot;
  };

  // The names in the right margin are fixed, so they are on the board first.
  const lastX = x(weeks.length - 1);
  for (const id of order) {
    const rk = weeks.at(-1).ranks[id];
    if (rk != null && rk <= 10) placed.push({ x0: lastX + 10, x1: lastX + 10 + nameOf(id).length * 6.7, y0: y(rk) - 7, y1: y(rk) + 6 });
  }

  const series = order.map(id => {
    const { hue, style } = slotOf(id);
    const pts = weeks.map((w, i) => (w.ranks[id] != null && w.ranks[id] <= 10) ? [x(i), y(w.ranks[id]), i] : null);
    // break the line where the entity leaves the ten
    let d = ''; let pen = false;
    for (const pt of pts) {
      if (!pt) { pen = false; continue; }
      d += `${pen ? 'L' : 'M'}${pt[0]},${pt[1]} `; pen = true;
    }
    const dots = pts.filter(Boolean).map(([px, py, i]) =>
      mark(style, px, py, `${esc(nameOf(id))} — #${weeks[i].ranks[id]} in W${weeks[i].week}`)).join('');
    const lastPt = [...pts].reverse().find(Boolean);
    // A line that reaches the newest week is named in the margin to its right.
    // One that stopped earlier has a column of newer dots there, so its name
    // sits beside its last point instead (placeOut).
    const current = lastPt && lastPt[2] === weeks.length - 1;
    const out = lastPt && !current ? placeOut(lastPt[0], lastPt[1], nameOf(id)) : null;
    const label = !lastPt ? ''
      : current
        ? `<text class="end-lab" x="${lastPt[0] + 10}" y="${lastPt[1] + 3.5}">${esc(nameOf(id))}</text>`
        : `<text class="end-lab out-lab" x="${out.x}" y="${out.y}" text-anchor="${out.anchor}">${esc(nameOf(id))}</text>`;
    return `<g class="series s${hue} t${style}"><path class="line" d="${d.trim()}"/>${dots}${label}</g>`;
  }).join('');

  const standings = weeks.map(w => ({
    week: 'W' + String(w.week).padStart(2, '0'),
    date: w.date,
    names: Object.entries(w.ranks).filter(([, rk]) => rk <= 10).sort((a, b) => a[1] - b[1]).map(([id]) => nameOf(id))
  }));

  const cols = weeks.map((w, i) =>
    `<rect class="colzone" x="${x(i) - (plotW / Math.max(1, weeks.length - 1)) / 2}" y="0" width="${plotW / Math.max(1, weeks.length - 1)}" height="${H}" fill="transparent" data-i="${i}"/>`).join('');

  /* The record as a table, for a reader who cannot see the chart. It is in
   * the markup and not on the screen: the chart is the only view drawn. The
   * wrapper is what hides it, since a table ignores a width and an overflow
   * set on itself and would stretch the page to its full size. */
  const table = `
    <div class="chart-data"><table aria-label="Top ten by week">
      <thead><tr><th scope="col">#</th>${standings.map(sw => `<th scope="col">${sw.week}</th>`).join('')}</tr></thead>
      <tbody>${Array.from({ length: 10 }, (_, i) =>
        `<tr><th scope="row">${i + 1}</th>${standings.map(sw => `<td>${esc(sw.names[i] ?? '')}</td>`).join('')}</tr>`).join('')}
      </tbody>
    </table></div>`;

  return `
    <div class="chart-wrap" id="record-chart" data-standings='${JSON.stringify(standings).replace(/'/g, '&#39;')}'>
      <div class="chart-scroll">
      <svg class="bump" viewBox="0 0 ${W} ${H}" role="img" aria-label="Top ten rank by week; the same record follows as a table">
        <g class="grid">${grid}</g>
        ${weekLabs}
        ${changes}
        <line class="cursor" id="chart-cursor" x1="0" y1="${padT - 6}" x2="0" y2="${padT + rowH * 9 + 10}"/>
        ${series}
        ${cols}
      </svg>
      </div>
      <div class="chart-tip" id="chart-tip"></div>
    </div>
    ${table}`;
}
