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

/* ---- Directory map ----
 * Leaflet is loaded as a plain script tag (window.L); if it failed to load, or
 * no location has coordinates yet, the map div collapses and the directory
 * table stands alone. Circle markers avoid Leaflet's image assets entirely.
 */
(function initMap() {
  const el = document.getElementById('map');
  if (!el || typeof window.L === 'undefined') { if (el) el.remove(); return; }

  const topIds = new Set(
    [...document.querySelectorAll('#board .card')].map(c => c.dataset.id).slice(0, 10));

  // The index is Seattle-focused: an entry qualifies by having a location
  // inside the city, and the map plots only those. Suburban branches stay in
  // the dataset and the directory table; each popup notes how many exist.
  const inSeattle = loc => /,\s*Seattle,\s*WA/i.test(loc.address ?? '');
  const pts = [];
  const suburban = new Map();
  for (const r of DATA.dataset.restaurants) {
    if (r.status === 'closed') continue;
    for (const loc of r.locations ?? []) {
      if (!inSeattle(loc)) {
        suburban.set(r.id, (suburban.get(r.id) ?? 0) + 1);
        continue;
      }
      if (loc.lat == null || loc.lon == null) continue;
      pts.push({ r, loc });
    }
  }
  if (!pts.length) { el.remove(); return; }

  const map = L.map(el, { scrollWheelZoom: false });
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
  }).addTo(map);

  const color = ({ r }) =>
    r.status === 'opening' ? '#4a8c46'
    : topIds.has(r.id) ? '#c8401f'
    : '#b08968';

  const bounds = [];
  for (const p of pts) {
    const { r, loc } = p;
    const m = L.circleMarker([loc.lat, loc.lon], {
      radius: topIds.has(r.id) ? 8 : 6,
      color: '#fff', weight: 1.5,
      fillColor: color(p), fillOpacity: 0.92
    }).addTo(map);
    const name = r.url
      ? `<a href="${r.url.replace(/"/g, '&quot;')}" target="_blank" rel="noopener">${r.name}</a>`
      : r.name;
    const outside = suburban.get(r.id);
    m.bindPopup(`<div class="map-pop"><b>${name}</b>` +
      `<div class="addr">${loc.address}${r.status === 'opening' ? ' · opening soon' : ''}${
        outside ? `<br>+ ${outside} location${outside > 1 ? 's' : ''} outside Seattle (see the table)` : ''}</div></div>`);
    bounds.push([loc.lat, loc.lon]);
  }

  map.fitBounds(bounds, { padding: [24, 24] });
})();
