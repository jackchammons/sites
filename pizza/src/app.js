/* In-browser re-ranker: change how much you care about a factor and the
 * leaderboard re-sorts live.
 *
 * The control is a multiplier, not a raw weight. Each factor sits at one of five
 * steps -- 0, 0.5, 1, 1.5, 2 -- applied to the weight this site publishes for
 * it, and rank() renormalises the five to 100% afterwards. So the number shown
 * on the right of each row is the share that factor actually gets, which moves
 * when any other factor moves. Raw-percentage sliders made that relationship
 * invisible: dragging one to 40% silently shrank every other.
 */
import { rank, splitTiers, DEFAULT_WEIGHTS } from './slice.js';
import { boardHtml } from './render.js';

const KEYS = Object.keys(DEFAULT_WEIGHTS);
const DATA = window.__PIZZA__;
const BUILT_AT = new Date(DATA.builtAt);
const board = document.getElementById('board');

const care = Object.fromEntries(KEYS.map(k => [k, 1]));
const weightsNow = () =>
  Object.fromEntries(KEYS.map(k => [k, DEFAULT_WEIGHTS[k] * care[k]]));

const opts = () => ({
  weights: weightsNow(),
  now: BUILT_AT,
  applyFriction: document.getElementById('opt-friction').checked,
  applyFreshness: document.getElementById('opt-freshness').checked
});

const dirty = () =>
  KEYS.some(k => care[k] !== 1) ||
  !document.getElementById('opt-friction').checked ||
  !document.getElementById('opt-freshness').checked;

/* Every factor at 0 leaves nothing to rank on. Rather than divide by zero or
 * silently fall back to the published weights, the panel says so and the board
 * keeps the last usable ranking. */
const allZero = () => KEYS.every(k => care[k] === 0);

function syncLabels() {
  const w = weightsNow();
  const total = Object.values(w).reduce((a, b) => a + b, 0);
  for (const k of KEYS) {
    document.getElementById(`v-${k}`).textContent =
      total ? Math.round((w[k] / total) * 100) + '%' : '—';
  }
}

function render() {
  syncLabels();
  const note = document.getElementById('board-note');
  if (allZero()) {
    note.textContent = 'Every factor is set to 0%, so there is nothing to rank on. Turn one back up.';
    return;
  }

  const { top } = splitTiers(rank(DATA.dataset, opts()), 10);
  const ranked = top.map(r => ({ ...r, previousRank: DATA.baseline[r.id] ?? null }));

  const open = new Set([...board.querySelectorAll('details.math[open]')]
    .map(d => d.closest('.card').dataset.id));
  board.innerHTML = boardHtml(ranked);
  open.forEach(id => {
    const d = board.querySelector(`.card[data-id="${CSS.escape(id)}"] details.math`);
    if (d) d.open = true;
  });

  note.textContent = dirty()
    ? 'Your weights. The “from #n” markers compare against the published order.'
    : 'Published ranking.';
}

for (const k of KEYS) {
  for (const input of document.querySelectorAll(`input[name="care-${k}"]`)) {
    input.addEventListener('change', () => {
      care[k] = Number(input.value);
      render();
    });
  }
}
for (const id of ['opt-friction', 'opt-freshness']) {
  document.getElementById(id).addEventListener('change', render);
}
document.getElementById('reset').addEventListener('click', () => {
  for (const k of KEYS) {
    care[k] = 1;
    document.getElementById(`care-${k}-1`).checked = true;
  }
  document.getElementById('opt-friction').checked = true;
  document.getElementById('opt-freshness').checked = true;
  render();
});

document.getElementById('controls').hidden = false;
render();
