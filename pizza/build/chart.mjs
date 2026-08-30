import { esc } from './html.mjs';

/* ---- the record: 12 weeks of the top ten as a bump chart ----
 * Server-rendered inline SVG. Colors: six categorical hues validated for CVD
 * separation and contrast against both site surfaces; entities beyond six wear
 * the muted ink and rely on their end labels, which every line carries -- the
 * labels are the legend, so identity is never color alone. A table view of the
 * same record sits underneath. */
export const CHART_HUES = ['#c8341f', '#2f7fd0', '#a9761a', '#7c4fd0', '#3f8b3e', '#d94f8e'];

export function bumpChart(snaps, entriesById) {
  const weeks = snaps.slice(-12);
  if (weeks.length < 2) return null;

  // Hues go to the entities that give the eye the most work: longest tenure
  // in the ten first, best rank as the tie-break. Stable within any one view;
  // everyone else wears the muted ink and is identified by its end label.
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
  const colorOf = id => {
    const i = order.indexOf(id);
    return i < CHART_HUES.length ? CHART_HUES[i] : 'var(--ink-3)';
  };
  const nameOf = id => entriesById.get(id)?.name ?? id;

  const padL = 34, padR = 200, padT = 26, padB = 10, rowH = 33;
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

  const series = order.map(id => {
    const hue = colorOf(id);
    const pts = weeks.map((w, i) => (w.ranks[id] != null && w.ranks[id] <= 10) ? [x(i), y(w.ranks[id]), i] : null);
    // break the line where the entity leaves the ten
    let d = ''; let pen = false;
    for (const pt of pts) {
      if (!pt) { pen = false; continue; }
      d += `${pen ? 'L' : 'M'}${pt[0]},${pt[1]} `; pen = true;
    }
    const dots = pts.filter(Boolean).map(([px, py, i]) =>
      `<circle cx="${px}" cy="${py}" r="4.5" fill="${hue}"><title>${esc(nameOf(id))} — #${weeks[i].ranks[id]} in W${weeks[i].week}</title></circle>`).join('');
    const lastPt = [...pts].reverse().find(Boolean);
    const label = lastPt
      ? `<text class="end-lab" x="${lastPt[0] + 10}" y="${lastPt[1] + 3.5}">${esc(nameOf(id))}</text>`
      : '';
    return `<g class="series"><path d="${d.trim()}" stroke="${hue}"/>${dots}${label}</g>`;
  }).join('');

  const standings = weeks.map(w => ({
    week: 'W' + String(w.week).padStart(2, '0'),
    date: w.date,
    names: Object.entries(w.ranks).filter(([, rk]) => rk <= 10).sort((a, b) => a[1] - b[1]).map(([id]) => nameOf(id))
  }));

  const cols = weeks.map((w, i) =>
    `<rect class="colzone" x="${x(i) - (plotW / Math.max(1, weeks.length - 1)) / 2}" y="0" width="${plotW / Math.max(1, weeks.length - 1)}" height="${H}" fill="transparent" data-i="${i}"/>`).join('');

  const table = `
    <details class="chart-table"><summary>The same record as a table</summary>
      <div class="dir-scroll"><table>
        <thead><tr><th>#</th>${standings.map(sw => `<th>${sw.week}</th>`).join('')}</tr></thead>
        <tbody>${Array.from({ length: 10 }, (_, i) =>
          `<tr><td>${i + 1}</td>${standings.map(sw => `<td>${esc(sw.names[i] ?? '')}</td>`).join('')}</tr>`).join('')}
        </tbody>
      </table></div>
    </details>`;

  return `
    <div class="chart-wrap" id="record-chart" data-standings='${JSON.stringify(standings).replace(/'/g, '&#39;')}'>
      <div class="chart-scroll">
      <svg class="bump" viewBox="0 0 ${W} ${H}" role="img" aria-label="Top ten rank by week">
        <g class="grid">${grid}</g>
        ${weekLabs}
        <line class="cursor" id="chart-cursor" x1="0" y1="${padT - 6}" x2="0" y2="${padT + rowH * 9 + 10}"/>
        ${series}
        ${cols}
      </svg>
      </div>
      <div class="chart-tip" id="chart-tip"></div>
    </div>
    ${table}`;
}
