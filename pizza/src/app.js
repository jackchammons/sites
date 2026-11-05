/* Browser behaviour for the published page: the directory map and rows, the
 * record chart's tooltip, and opening a card's explanation. The ranking itself
 * is computed at build time and served as HTML; nothing here re-scores it. */
const DATA = window.__PIZZA__;

/* ---- Ranked cards: click anywhere on a card to open its explanation ----
 * The summary line still works on its own; this makes the whole card the
 * target, since "why is this #2" is the question a card exists to answer.
 * Links keep their own behaviour. */
document.getElementById('board')?.addEventListener('click', e => {
  if (e.target.closest('a, details.math, summary')) return;
  const card = e.target.closest('.card');
  const d = card?.querySelector('details.math');
  if (d) d.open = !d.open;
});

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
    // Touch: a tap on a column shows that week; a second tap elsewhere hides it.
    z.addEventListener('click', e => { show(Number(z.dataset.i), e.clientX, e.clientY); e.stopPropagation(); });
  }
  const hide = () => { tip.style.display = 'none'; cursor.style.opacity = 0; };
  svg.addEventListener('mouseleave', hide);
  document.addEventListener('click', e => { if (!wrap.contains(e.target)) hide(); });
  // On a narrow screen the chart scrolls; start at the newest week and the
  // end labels, which are the legend, instead of the oldest column.
  const scroller = wrap.querySelector('.chart-scroll');
  if (scroller) scroller.scrollLeft = scroller.scrollWidth;
})();
