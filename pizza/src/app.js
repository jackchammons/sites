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

/* The full published order, ranks 1 through the whole rated field, computed
 * once with the default weights. Custom-weight deltas compare against this --
 * not the weekly snapshot, which only covers the published ten -- so an entry
 * climbing in from #14 shows where it actually came from. */
const publishedRank = new Map(
  rank(DATA.dataset, { now: BUILT_AT }).map(r => [r.id, r.rank]));
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

  const custom = dirty();
  const { top } = splitTiers(rank(DATA.dataset, opts()), 10);
  const ranked = top.map(r => custom
    ? { ...r, previousRank: publishedRank.get(r.id) ?? null, deltaVs: 'published' }
    : { ...r, previousRank: DATA.baseline[r.id] ?? null });

  // The published evidence lines explain published movement; under custom
  // weights the movement is the reader's own doing, so they stay off.
  if (!custom) for (const r of ranked) r.evidenceHtml = DATA.evidence?.[r.id] ?? '';

  const open = new Set([...board.querySelectorAll('details.math[open]')]
    .map(d => d.closest('.card').dataset.id));

  // FLIP: record where each card was, re-render, then animate each card from
  // its old position to its new one. An instant repaint made a re-rank read as
  // the page jumping; a 400ms glide makes the reordering legible.
  const before = new Map([...board.querySelectorAll('.card')]
    .map(c => [c.dataset.id, c.getBoundingClientRect().top]));

  board.innerHTML = boardHtml(ranked);
  open.forEach(id => {
    const d = board.querySelector(`.card[data-id="${CSS.escape(id)}"] details.math`);
    if (d) d.open = true;
  });

  if (before.size && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    const ease = 'cubic-bezier(.22,.7,.3,1)';
    for (const c of board.querySelectorAll('.card')) {
      const old = before.get(c.dataset.id);
      if (old == null) {
        c.animate([{ opacity: 0, transform: 'translateY(16px)' }, { opacity: 1, transform: 'none' }],
          { duration: 420, easing: ease });
      } else {
        const dy = old - c.getBoundingClientRect().top;
        if (Math.abs(dy) > 2) c.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }],
          { duration: 420, easing: ease });
      }
    }
  }

  document.querySelector('.rank-layout')?.classList.toggle('customized', custom);
  if (custom) {
    const entered = ranked.filter(r => r.previousRank == null || r.previousRank > 10).length;
    const biggest = Math.max(0, ...ranked.map(r => r.previousRank != null ? r.previousRank - r.rank : 0));
    note.textContent = `Your weights — ${entered ? `${entered} climbed in from outside the published ten, ` : ''}biggest move ▲${biggest}. Markers show each card's published position.`;
  } else {
    note.textContent = 'Published ranking.';
  }
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
/* Filled by initMap so the directory rows can focus the map; stays empty when
 * the map never initialised (offline tiles, no coordinates). */
const mapApi = { focus: null };
/* Filled by the directory wiring below, so map markers can focus a row. */
const dirApi = { expand: null };

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

  /* Wheel zoom follows the layout. In the desktop rail the map is sticky
   * beside the table, and a wheel gesture over it reads as "zoom the map" --
   * with wheel zoom off it scrolled the page, which looked like the directory
   * list jumping away. Stacked layouts keep it off, where a map that traps
   * the wheel mid-page is the worse bug. */
  const map = L.map(el, { scrollWheelZoom: false });
  const wideLayout = window.matchMedia('(min-width: 1100px)');
  const setWheelZoom = () =>
    wideLayout.matches ? map.scrollWheelZoom.enable() : map.scrollWheelZoom.disable();
  setWheelZoom();
  wideLayout.addEventListener?.('change', setWheelZoom);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
  }).addTo(map);

  const color = ({ r }) =>
    r.status === 'opening' ? '#4a8c46'
    : topIds.has(r.id) ? '#c8401f'
    : '#b08968';

  const bounds = [];
  const markersById = new Map();   // first (usually primary) Seattle marker per entry
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
    if (!markersById.has(r.id)) markersById.set(r.id, m);
    m.on('click', () => { if (dirApi.expand) dirApi.expand(r.id); });
  }

  map.fitBounds(bounds, { padding: [24, 24] });

  mapApi.focus = id => {
    const m = markersById.get(id);
    if (!m) return false;
    map.setView(m.getLatLng(), Math.max(map.getZoom(), 14));
    m.openPopup();
    return true;
  };
})();

/* ---- Directory rows: expand the full record, focus the map ----
 * An accordion: one record open at a time, so the table stays scannable.
 * A row click expands and pans the map; a marker click expands and scrolls
 * the table to the row. Links inside a row keep their own behaviour. */
(() => {
  const body = document.getElementById('dir-body');
  if (!body) return;

  const rowOf = id => body.querySelector(`tr.dir-row[data-id="${id}"]`);
  const setOne = (id, open) => {
    const row = rowOf(id);
    const detail = document.getElementById('dd-' + id);
    if (!row || !detail) return;
    detail.hidden = !open;
    row.classList.toggle('expanded', open);
    const btn = row.querySelector('.dir-toggle');
    if (btn) btn.setAttribute('aria-expanded', String(open));
  };
  const expand = (id, { fromMap = false } = {}) => {
    for (const d of body.querySelectorAll('.dir-detail:not([hidden])')) {
      if (d.id !== 'dd-' + id) setOne(d.id.slice(3), false);
    }
    setOne(id, true);
    if (fromMap) rowOf(id)?.scrollIntoView({ block: 'center' });
    else if (mapApi.focus) mapApi.focus(id);
  };
  dirApi.expand = id => expand(id, { fromMap: true });

  body.addEventListener('click', e => {
    if (e.target.closest('a, details, .dir-detail')) return;
    const row = e.target.closest('tr.dir-row');
    if (!row) return;
    const detail = document.getElementById('dd-' + row.dataset.id);
    if (detail && !detail.hidden) setOne(row.dataset.id, false);
    else expand(row.dataset.id);
  });
})();


/* ---- record-chart hover: crosshair + that week's standings ---- */
(() => {
  const wrap = document.getElementById('record-chart');
  if (!wrap) return;
  const standings = JSON.parse(wrap.dataset.standings);
  const svg = wrap.querySelector('svg');
  const tip = document.getElementById('chart-tip');
  const cursor = document.getElementById('chart-cursor');
  const zones = [...wrap.querySelectorAll('.colzone')];
  const xOf = i => {
    const z = zones[i];
    return parseFloat(z.getAttribute('x')) + parseFloat(z.getAttribute('width')) / 2;
  };
  function show(i, clientX, clientY) {
    const sw = standings[i];
    tip.innerHTML = `<b>${sw.week} · ${sw.date}</b><ol>` +
      sw.names.map(n => `<li>${n.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</li>`).join('') + '</ol>';
    tip.style.display = 'block';
    const r = wrap.getBoundingClientRect();
    const left = Math.min(clientX - r.left + 14, r.width - tip.offsetWidth - 4);
    tip.style.left = Math.max(0, left) + 'px';
    tip.style.top = Math.max(0, clientY - r.top - 10) + 'px';
    cursor.setAttribute('x1', xOf(i)); cursor.setAttribute('x2', xOf(i));
    cursor.style.opacity = 1;
  }
  for (const z of zones) {
    z.addEventListener('mousemove', e => show(Number(z.dataset.i), e.clientX, e.clientY));
  }
  svg.addEventListener('mouseleave', () => { tip.style.display = 'none'; cursor.style.opacity = 0; });
})();
