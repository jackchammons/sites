/* In-browser re-ranker: move the sliders, the leaderboard re-sorts live. */
import { rank, splitTiers, DEFAULT_WEIGHTS } from './slice.js';
import { boardHtml, benchHtml, PILLAR_META } from './render.js';

const DATA = window.__PIZZA__;
const BUILT_AT = new Date(DATA.builtAt);
const board = document.getElementById('board');
const weights = { ...DEFAULT_WEIGHTS };

const opts = () => ({
  weights,
  now: BUILT_AT,
  applyFriction: document.getElementById('opt-friction').checked,
  applyFreshness: document.getElementById('opt-freshness').checked
});

function render() {
  const { top, bench: benched } = splitTiers(rank(DATA.dataset, opts()), 10);
  const ranked = top.map(r => ({ ...r, previousRank: DATA.baseline[r.id] ?? null }));

  // The bench re-ranks with the same weights: whether an entry sits in
  // promotion range depends on where you put the tenth-place cutoff.
  const bench = document.getElementById('bench-list');
  if (bench) bench.innerHTML = benchHtml(benched);
  const open = new Set([...board.querySelectorAll('details.math[open]')]
    .map(d => d.closest('.card').dataset.id));
  board.innerHTML = boardHtml(ranked);
  open.forEach(id => {
    const d = board.querySelector(`.card[data-id="${CSS.escape(id)}"] details.math`);
    if (d) d.open = true;
  });
  document.getElementById('board-note').textContent = dirty()
    ? 'Your weights — “from #n” compares against the published ranking.'
    : 'Published ranking, rebuilt daily.';
}

const dirty = () =>
  Object.keys(DEFAULT_WEIGHTS).some(k => weights[k] !== DEFAULT_WEIGHTS[k]) ||
  !document.getElementById('opt-friction').checked ||
  !document.getElementById('opt-freshness').checked;

function syncLabels() {
  const total = Object.values(weights).reduce((a, b) => a + b, 0) || 1;
  for (const k of Object.keys(DEFAULT_WEIGHTS)) {
    document.getElementById(`v-${k}`).textContent =
      Math.round((weights[k] / total) * 100) + '%';
  }
}

for (const k of Object.keys(DEFAULT_WEIGHTS)) {
  const el = document.getElementById(`w-${k}`);
  el.addEventListener('input', () => {
    weights[k] = Number(el.value);
    syncLabels();
    render();
  });
}
for (const id of ['opt-friction', 'opt-freshness']) {
  document.getElementById(id).addEventListener('change', render);
}
document.getElementById('reset').addEventListener('click', () => {
  Object.assign(weights, DEFAULT_WEIGHTS);
  for (const k of Object.keys(DEFAULT_WEIGHTS)) {
    document.getElementById(`w-${k}`).value = DEFAULT_WEIGHTS[k];
  }
  document.getElementById('opt-friction').checked = true;
  document.getElementById('opt-freshness').checked = true;
  syncLabels();
  render();
});

document.getElementById('controls').hidden = false;
syncLabels();
render();
