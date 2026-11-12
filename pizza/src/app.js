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
 * The map sits ten to twenty screens down, so nothing of it loads with the
 * page: Leaflet (vendored, ./leaflet.js) is fetched when the rail comes within
 * a couple of screens of the viewport, or when a directory row asks for its
 * marker, whichever is first. Tiles follow from there.
 *
 * The rail is rendered hidden and revealed here, once there is at least one
 * point to plot. Everything that can go wrong (the script fails to load,
 * Leaflet throws on a bad coordinate) ends in dropRail(): the map and its
 * legend go together and the table takes the full width. None of it can stop
 * the directory rows or the chart below from being wired up. Circle markers
 * avoid Leaflet's image assets entirely.
 */
/* Set while there is a map, or one still to load, so the directory rows can
 * focus a marker; null when there is no map. */
const mapApi = { focus: null };
/* Filled by the directory wiring below, so map markers can focus a row. */
const dirApi = { expand: null };

(() => {
  const rail = document.getElementById('map-rail');
  const el = document.getElementById('map');
  if (!rail || !el) return;
  const layout = rail.parentElement;
  const dropRail = why => {
    if (why) console.warn('Directory map unavailable:', why);
    mapApi.focus = null;
    layout.classList.remove('has-map');
    rail.remove();
  };

  // The index is Seattle-focused: an entry qualifies by having a location
  // inside the city, and the map plots only those. Suburban branches stay in
  // the dataset and the directory table; each popup notes how many exist.
  const inSeattle = loc => /,\s*Seattle,\s*WA/i.test(loc.address ?? '');
  const pts = [];
  const suburban = new Map();
  try {
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
  } catch (e) { dropRail(e); return; }
  if (!pts.length) { dropRail(); return; }

  /* A popup is built from nodes, and every string from the dataset goes in as
   * text. Names and addresses are written by a research agent reading the
   * open web, so they are never parsed as markup; a link is made only from an
   * http(s) URL. */
  const popupFor = ({ r, loc }) => {
    const box = document.createElement('div');
    box.className = 'map-pop';
    const title = document.createElement('b');
    if (/^https?:\/\//i.test(r.url ?? '')) {
      const a = document.createElement('a');
      a.href = r.url; a.target = '_blank'; a.rel = 'noopener';
      a.textContent = r.name;
      title.append(a);
    } else {
      title.textContent = r.name;
    }
    const addr = document.createElement('div');
    addr.className = 'addr';
    addr.textContent = loc.address + (r.status === 'opening' ? ' · opening soon' : '');
    const outside = suburban.get(r.id);
    if (outside) {
      addr.append(document.createElement('br'),
        `+ ${outside} location${outside > 1 ? 's' : ''} outside Seattle (see the table)`);
    }
    box.append(title, addr);
    return box;
  };

  const build = () => {
    const L = window.L;
    const topIds = new Set(
      [...document.querySelectorAll('#board .card')].map(c => c.dataset.id).slice(0, 10));

    /* A drag on the map always moves the map; wheel zoom follows the layout.
     * In the desktop rail the map is beside the table, and a wheel over it
     * reads as "zoom the map". In the stacked layout the map is pinned across
     * the top of the page while the list scrolls beneath it, so the pointer
     * comes to rest on it just by scrolling: a map that took the wheel there
     * would stop the page. A finger is different. The pinned map leaves two
     * thirds of the screen to scroll the page with, so a drag that starts on
     * the map is meant for the map, and Leaflet takes it; one that starts on
     * the list scrolls the page. */
    const wideLayout = window.matchMedia('(min-width: 1100px)');
    const map = L.map(el, { scrollWheelZoom: wideLayout.matches });
    wideLayout.addEventListener?.('change', () => {
      if (wideLayout.matches) map.scrollWheelZoom.enable(); else map.scrollWheelZoom.disable();
    });
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(map);

    const color = ({ r }) =>
      r.status === 'opening' ? '#4a8c46'
      : topIds.has(r.id) ? '#c8401f'
      : '#b08968';

    /* Leaflet pans a popup into the map, to within a margin of its edges. The
     * stacked map is narrow enough that a popup brought in from the left ends
     * up under the zoom buttons, so there the left margin is the width the
     * buttons take. Read each time a popup opens, so it follows the layout. */
    const popupInset = { get x() { return wideLayout.matches ? 5 : 50; }, y: 5 };

    const bounds = [];
    const markersById = new Map();   // first (usually primary) Seattle marker per entry
    for (const p of pts) {
      const { r, loc } = p;
      const m = L.circleMarker([loc.lat, loc.lon], {
        radius: topIds.has(r.id) ? 8 : 6,
        color: '#fff', weight: 1.5,
        fillColor: color(p), fillOpacity: 0.92
      }).addTo(map);
      m.bindPopup(() => popupFor(p), { autoPanPaddingTopLeft: popupInset });
      bounds.push([loc.lat, loc.lon]);
      if (!markersById.has(r.id)) markersById.set(r.id, m);
      m.on('click', () => { if (dirApi.expand) dirApi.expand(r.id); });
    }

    map.fitBounds(bounds, { padding: [24, 24] });

    /* Beside the table the map is a third of the row, which is small for
     * finding one corner of the city. The button trades the table's width for
     * the map's: the layout class does the resizing in CSS, and Leaflet is
     * told its box changed. The choice is the reader's, so it is remembered. */
    const pin = el.parentElement;
    const grow = document.createElement('button');
    grow.type = 'button';
    grow.className = 'map-grow';
    const setLarge = large => {
      layout.classList.toggle('map-large', large);
      grow.textContent = large ? 'Smaller map' : 'Larger map';
      grow.setAttribute('aria-pressed', String(large));
      map.invalidateSize();
    };
    grow.addEventListener('click', () => {
      const large = !layout.classList.contains('map-large');
      setLarge(large);
      try { localStorage.setItem('pizza.mapLarge', large ? '1' : '0'); } catch {}
    });
    pin.append(grow);
    let remembered = false;
    try { remembered = localStorage.getItem('pizza.mapLarge') === '1'; } catch {}
    setLarge(remembered);

    return id => {
      const m = markersById.get(id);
      if (!m) return false;
      map.setView(m.getLatLng(), Math.max(map.getZoom(), 14));
      m.openPopup();
      return true;
    };
  };

  /* One load, however it is asked for. Resolves to the focus function, or to
   * null once the rail has been dropped. */
  let loading = null;
  const load = () => loading ??= new Promise(resolve => {
    const fail = why => { dropRail(why); resolve(null); };
    const script = document.createElement('script');
    script.src = './leaflet.js';
    script.onload = () => { try { resolve(build()); } catch (e) { fail(e); } };
    script.onerror = () => fail('leaflet.js did not load');
    document.head.append(script);
  });

  rail.hidden = false;
  layout.classList.add('has-map');
  mapApi.focus = id => { load().then(focus => focus?.(id)); };

  if ('IntersectionObserver' in window) {
    const near = new IntersectionObserver(entries => {
      if (!entries.some(e => e.isIntersecting)) return;
      near.disconnect();
      load();
    }, { rootMargin: '1200px 0px' });
    // The map, not the rail: in the stacked layout the rail has no box of its
    // own (display: contents), and an element without one never intersects.
    near.observe(el);
  } else {
    load();
  }
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

  /* In the stacked layout the map is pinned over the top of the list, and the
   * table header sticks under the map, so the header's sticky offset plus its
   * height is where the visible list begins, at any screen height. A browser
   * that will not report the offset as a length gets the header's bottom edge
   * as it stands: the same line once the header is stuck, lower before then,
   * and never one that hides the row. */
  const stacked = window.matchMedia('(max-width: 1099px)');
  const head = body.parentElement.querySelector('thead th');
  const listTop = () => {
    if (!head) return 0;
    const box = head.getBoundingClientRect();
    const offset = parseFloat(getComputedStyle(head).top);
    return Number.isFinite(offset) ? offset + box.height : box.bottom;
  };
  /* Bring a row into view. Beside the map, that is the middle of the screen.
   * Under a pinned map the middle of the screen can be behind the map, so the
   * row and its open record are centred in the list's own area instead, or
   * the row is put at the top of it when the record is longer than the room. */
  const reveal = row => {
    if (!stacked.matches) { row.scrollIntoView({ block: 'center' }); return; }
    const top = listTop();
    const record = row.nextElementSibling;
    const height = row.offsetHeight + (record && !record.hidden ? record.offsetHeight : 0);
    const spare = Math.max(0, window.innerHeight - top - height);
    // Rounded down, so a fraction of a pixel never tucks the row under the header.
    window.scrollBy({ top: Math.floor(row.getBoundingClientRect().top - top - spare / 2) });
  };
  const expand = (id, { fromMap = false } = {}) => {
    for (const d of body.querySelectorAll('.dir-detail:not([hidden])')) {
      if (d.id !== 'dd-' + id) setOne(d.id.slice(3), false);
    }
    setOne(id, true);
    const row = rowOf(id);
    if (fromMap) { if (row) reveal(row); return; }
    // Closing the record above a tapped row pulls the row up the page, and
    // under a pinned map it must not come to rest behind the map.
    if (row && stacked.matches && row.getBoundingClientRect().top < listTop()) reveal(row);
    if (mapApi.focus) mapApi.focus(id);
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
