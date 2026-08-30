import { bumpChart } from '../chart.mjs';

export function recordSection(ctx) {
  const { history, weekKey, week, now, ranked, entriesById } = ctx;
const chartHtml = bumpChart(history.snapshots.concat(
  history.snapshots.at(-1)?.weekKey === weekKey ? [] : [{
    weekKey, week, date: now.toISOString().slice(0, 10),
    ranks: Object.fromEntries(ranked.map(r => [r.id, r.rank]))
  }]), entriesById);

const recordSection = chartHtml ? `
<section class="section">
  <div class="wrap">
    <div class="eyebrow">The record</div>
    <h2 class="sec-h">Twelve weeks of the top ten</h2>
    <p class="lede" style="margin-top:14px">
      One line per pizzeria, one column per ISO week, position by rank. A line that stops fell
      out of the ten; one that starts climbed in. The window shows up to twelve weeks and fills
      as they accumulate.
    </p>
    ${chartHtml}
  </div>
</section>
` : '';
  return recordSection;
}
