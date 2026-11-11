import { bumpChart } from '../chart.mjs';
import { ALGORITHM } from '../../src/slice.js';

export function recordSection(ctx) {
  const { history, weekKey, week, now, allScored, entriesById } = ctx;
/* The current week's column is always this build's standings. The stored
 * snapshot for the week was written by an earlier publish, so drawing it
 * would let the chart disagree with the cards above it until the next write.
 * It carries the algorithm so a formula change draws its rule in the week
 * it happens. */
const chartHtml = bumpChart([
  ...history.snapshots.filter(s => s.weekKey !== weekKey),
  { weekKey, week, date: now.toISOString().slice(0, 10), algorithm: ALGORITHM,
    ranks: Object.fromEntries(allScored.map(r => [r.id, r.rank])) }
], entriesById);

const recordSection = chartHtml ? `
<section class="section" id="record">
  <div class="wrap">
    <div class="eyebrow">The record</div>
    <h2 class="sec-h">Twelve weeks of the top ten</h2>
    <p class="lede" style="margin-top:14px">
      One line per pizzeria, one column per ISO week, position by rank. A line that stops fell
      out of the ten; one that starts climbed in. The window shows up to twelve weeks and fills
      as they accumulate.${chartHtml.includes('class="method-change"') ? `
      A dashed rule marks a week the scoring method changed: movement across it is the
      formula's, not the pizzerias'.` : ''}
    </p>
    ${chartHtml}
  </div>
</section>
` : '';
  return recordSection;
}
