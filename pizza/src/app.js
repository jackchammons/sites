/* Browser behaviour for the published page: the directory (its categories,
 * search, rows and map), the record chart's tooltip, and opening a card's
 * explanation. The ranking itself is computed at build time and served as
 * HTML; nothing here re-scores it. */
import { fold, terms, matches } from './search.js';

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

/* Set while there is a map, or one still to load. `focus` opens a place's
 * pin; `sync` redraws the pins from the directory's state. */
const mapApi = { focus: null, sync: null };
/* Filled by the directory wiring below, for the map: which places are
 * showing, and what to do when a pin is clicked. */
const dirApi = { shows: () => false, fromPin: null, toolsMoved: null };

/* ---- The directory: categories, search, rows ----
 * The list is rendered whole, as one <details> per category, and works
 * without any of this. What this adds is one piece of state, the set of
 * categories that are on, and three things it drives: a category that is on
 * is expanded in the list, its toggle is pressed, and its places are on the
 * map. The toggles and the category headers both change that set, so they
 * cannot disagree.
 *
 * A search is a second, temporary view over the same rows: while there is a
 * query every category with a match is shown with only its matching rows and
 * the rest are hidden. The set from before the search is left alone, so
 * clearing the field brings it back. */
(() => {
  const list = document.getElementById('dir-list');
  const tools = document.getElementById('dir-tools');
  if (!list || !tools) return;
  const layout = list.parentElement;
  const input = document.getElementById('dir-q');
  const status = document.getElementById('dir-status');
  const clear = document.getElementById('dir-clear');
  const cats = document.getElementById('dir-cats');

  const groups = new Map([...list.querySelectorAll('details.dg')].map(d => [d.dataset.cat, d]));
  const chips = new Map([...cats.querySelectorAll('.cat-chip')].map(b => [b.dataset.cat, b]));
  const defaults = [...groups].filter(([, d]) => d.hasAttribute('open')).map(([cat]) => cat);
  const total = new Map([...groups].map(([cat, d]) => [cat, d.querySelector('.dg-n').textContent]));

  /* One item per row: the row, the line under it (an entry's reason, a
   * candidate's note) and, for an entry, its record. */
  const items = [];
  for (const [cat, d] of groups) {
    for (const row of d.querySelectorAll('tr.dir-row, tr.cq-row')) {
      const next = row.nextElementSibling;
      items.push({
        id: row.id, cat, row,
        under: next?.matches('.dir-why, .cq-note') ? next : null,
        record: row.dataset.id ? document.getElementById('dd-' + row.dataset.id) : null,
        text: null
      });
    }
  }
  const byId = new Map(items.map(it => [it.id, it]));
  const byEntry = new Map(items.filter(it => it.record).map(it => [it.row.dataset.id, it]));

  const state = {
    on: new Set(defaults),   // the categories that are on
    query: '',               // the words being searched for, folded
    hits: null,              // while searching: the items that match
    found: new Map(),        // while searching: matches per category
    off: new Set()           // while searching: categories collapsed by hand
  };
  const shown = cat => state.query ? state.found.has(cat) && !state.off.has(cat) : state.on.has(cat);
  dirApi.shows = id => {
    const it = byId.get(id);
    return Boolean(it) && shown(it.cat) && (!state.hits || state.hits.has(it));
  };

  /* The text a search reads for a row, read from the page once, the first
   * time it is needed: the row's own cells (name, neighbourhood, addresses,
   * style, notes, status) and whatever the build marked .q in its record or
   * note (style group, signature pie, every neighbourhood, a census note).
   * The score and the "+ 3 more" of a long address list are not words anyone
   * searches for. */
  const words = el => {
    const out = [];
    const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    while (walk.nextNode()) out.push(walk.currentNode.nodeValue);
    return out.join(' ');
  };
  const textOf = it => it.text ??= fold([
    ...(it.record
      ? [...it.row.cells].filter(c => !c.classList.contains('dir-score')).map(words)
      : [words(it.row.cells[0])]),
    ...[it.record, it.under].flatMap(el => el ? [...el.querySelectorAll('.q')].map(words) : [])
  ].join(' ').replace(/\+\s*\d+\s+more/g, ' '));

  /* ---- drawing the state ---- */
  const empty = document.createElement('p');
  empty.className = 'note dir-empty';
  empty.hidden = true;
  list.append(empty);
  const head = document.getElementById('candidates');

  const setRecord = (it, open) => {
    if (!it?.record) return;
    it.record.hidden = !open;
    it.row.classList.toggle('expanded', open);
    it.row.querySelector('.dir-toggle')?.setAttribute('aria-expanded', String(open));
  };
  let marked = null;
  const mark = it => {
    marked?.row.classList.remove('marked');
    marked = it ?? null;
    marked?.row.classList.add('marked');
  };

  const render = () => {
    const searching = state.query !== '';
    for (const it of items) {
      const hide = searching && !state.hits.has(it);
      it.row.hidden = hide;
      if (it.under) it.under.hidden = hide;
      if (hide && it.record && !it.record.hidden) setRecord(it, false);
    }
    for (const [cat, d] of groups) {
      const n = state.found.get(cat) ?? 0;
      d.hidden = searching && !n;
      const open = shown(cat);
      if (d.open !== open) d.open = open;
      d.querySelector('.dg-n').textContent = searching && n ? `${n} of ${total.get(cat)}` : total.get(cat);
      // A category with two tables (closed) may match in only one of them.
      for (const box of d.querySelectorAll('.dir-scroll, .cq-scroll')) {
        box.hidden = searching && !box.querySelector('tr.dir-row:not([hidden]), tr.cq-row:not([hidden])');
      }
      const chip = chips.get(cat);
      if (chip) {
        chip.setAttribute('aria-pressed', String(open));
        chip.disabled = searching && !n;
        chip.querySelector('b').textContent = searching ? n : total.get(cat);
      }
    }
    // The heading over the places not on file goes when none of them is listed.
    if (head) {
      let later = false, any = false;
      for (const el of list.children) {
        if (el === head) later = true;
        else if (later && !el.hidden && el !== empty) any = true;
      }
      head.hidden = searching && !any;
    }
    tools.classList.toggle('is-searching', searching);
    clear.hidden = !searching;
    const hits = state.hits?.size ?? 0;
    empty.hidden = !(searching && !hits);
    empty.textContent = searching && !hits ? 'Nothing in the directory matches that. Names, neighbourhoods, addresses and styles are searched.' : '';
    status.textContent = !searching ? ''
      : !hits ? 'No matches'
      : `${hits} ${hits === 1 ? 'match' : 'matches'} in ${state.found.size} ${state.found.size === 1 ? 'category' : 'categories'}`;
  };

  /* ---- where the visible list begins ----
   * Above the list sit the nav and, in the stacked layout, the pinned map
   * with the toggles (or the toggles alone when there is no map). Whatever is
   * stuck there is measured where it stands: its sticky offset plus its
   * height is the line the list scrolls under, at any screen height. A table
   * header that sticks adds its own height for a row. */
  const stacked = window.matchMedia('(max-width: 1099px)');
  const nav = document.querySelector('.site-nav');
  const stuckBottom = () => {
    const base = nav?.offsetHeight ?? 0;
    const pin = tools.closest('.dir-pin');
    const box = pin ? (stacked.matches ? pin : null) : tools;
    if (!box) return base;
    const top = parseFloat(getComputedStyle(box).top);
    return Number.isFinite(top) ? top + box.offsetHeight : Math.max(base, box.getBoundingClientRect().bottom);
  };
  const listTop = row => {
    const th = row.closest('table')?.tHead?.rows[0]?.cells[0];
    return stuckBottom() + (th && getComputedStyle(th).position === 'sticky' ? th.offsetHeight : 0);
  };
  /* Bring a row into view. Beside the map, that is the middle of the screen.
   * Under a pinned map the middle of the screen can be behind the map, so the
   * row and its open record are centred in the list's own area instead, or
   * the row is put at the top of it when the record is longer than the room. */
  const reveal = it => {
    const top = listTop(it.row);
    const height = it.row.offsetHeight + (it.under?.offsetHeight ?? 0) + (it.record && !it.record.hidden ? it.record.offsetHeight : 0);
    const spare = Math.max(0, window.innerHeight - top - height);
    // Rounded down, so a fraction of a pixel never tucks the row under the header.
    window.scrollBy({ top: Math.floor(it.row.getBoundingClientRect().top - top - spare / 2) });
  };
  /* Bring a category's header to the top of the visible list, unless it is
   * on screen already. */
  const revealGroup = (el, always = false) => {
    const top = stuckBottom() + 8;
    const at = el.getBoundingClientRect().top;
    if (always || at < top || at > window.innerHeight - 80) window.scrollBy({ top: Math.floor(at - top) });
  };
  /* After a change that shortens the list a great deal, the reader may be
   * left looking at whatever came after it. Put the list's start back. */
  const keepListInView = () => {
    if (list.getBoundingClientRect().top < stuckBottom() - 4) revealGroup(list, true);
  };

  /* ---- changing the state ---- */
  let mapTimer = 0;
  const syncMap = (later = false) => {
    clearTimeout(mapTimer);
    if (later) mapTimer = setTimeout(() => mapApi.sync?.(), 250);
    else mapApi.sync?.();
  };
  const setCategory = (cat, on) => {
    if (state.query) { if (on) state.off.delete(cat); else state.off.add(cat); }
    else if (on) state.on.add(cat); else state.on.delete(cat);
    render();
    syncMap();
  };
  const setAll = set => {
    state.on = new Set(set);
    render();
    syncMap();
    keepListInView();
  };
  /* The list follows every keystroke. The map follows when the typing
   * pauses, so it is fitted to a result and not to each letter on the way. */
  const setQuery = value => {
    const sought = terms(value);
    const query = sought.join(' ');
    if (query === state.query) return;
    state.query = query;
    state.off.clear();
    state.found = new Map();
    state.hits = null;
    if (query) {
      state.hits = new Set(items.filter(it => matches(textOf(it), sought)));
      for (const it of state.hits) state.found.set(it.cat, (state.found.get(it.cat) ?? 0) + 1);
    }
    render();
    syncMap(true);
    keepListInView();
  };
  const clearSearch = () => {
    if (input.value) input.value = '';
    setQuery('');
  };

  /* The category headers. A <details> reports a change of its own, whoever
   * made it, so this is also what keeps the state right when the browser
   * opens one itself (find-in-page, a link into it). */
  list.addEventListener('toggle', e => {
    const d = e.target;
    if (!d.classList?.contains('dg') || d.open === shown(d.dataset.cat)) return;
    setCategory(d.dataset.cat, d.open);
  }, true);
  cats.addEventListener('click', e => {
    const chip = e.target.closest('.cat-chip');
    if (!chip || chip.disabled) return;
    const cat = chip.dataset.cat;
    setCategory(cat, !shown(cat));
    revealGroup(groups.get(cat));
  });
  document.getElementById('dir-all').addEventListener('click', () => setAll(groups.keys()));
  document.getElementById('dir-reset').addEventListener('click', () => setAll(defaults));
  document.getElementById('dir-none').addEventListener('click', () => setAll([]));
  input.addEventListener('input', () => setQuery(input.value));
  input.addEventListener('keydown', e => { if (e.key === 'Escape' && input.value) { e.preventDefault(); clearSearch(); } });
  clear.addEventListener('click', () => { clearSearch(); input.focus(); });
  // "/" goes to the search field, as it does on most pages that have one.
  document.addEventListener('keydown', e => {
    if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target.closest?.('input, textarea, select, [contenteditable]')) return;
    e.preventDefault();
    input.focus();
  });

  /* ---- rows: expand the full record, focus the map ----
   * An accordion: one record open at a time, so the table stays scannable.
   * A row click expands and pans the map; a pin click expands and scrolls
   * the list to the row. A candidate has no record: its row is marked
   * instead. Links inside a row keep their own behaviour. */
  const expand = (it, { fromMap = false } = {}) => {
    for (const other of items) if (other !== it && other.record && !other.record.hidden) setRecord(other, false);
    setRecord(it, true);
    mark(it.record ? null : it);
    if (fromMap) { reveal(it); return; }
    // Closing the record above a tapped row pulls the row up the page, and
    // under a pinned map it must not come to rest behind the map.
    if (it.row.getBoundingClientRect().top < listTop(it.row)) reveal(it);
    mapApi.focus?.(it.id);
  };
  dirApi.fromPin = id => { const it = byId.get(id); if (it) expand(it, { fromMap: true }); };

  list.addEventListener('click', e => {
    if (e.target.closest('a, summary, .dir-more, .dir-detail')) return;
    const tr = e.target.closest('tr.dir-row, tr.dir-why, tr.cq-row, tr.cq-note');
    if (!tr) return;
    const it = byId.get(tr.matches('.dir-why, .cq-note') ? tr.previousElementSibling.id : tr.id);
    if (!it) return;
    if (it.record && !it.record.hidden) setRecord(it, false);
    else expand(it);
  });

  /* ---- links into the directory ----
   * A link, or the address the page was opened with, can name a category
   * (#cat-closed), a row (#r-<id>, #c-<key>) or an entry's record (#dd-<id>).
   * The target may be inside a category that is off, or hidden by a search,
   * so the category is turned on and the search cleared before it is brought
   * into view. The two fragments the Candidates section used to have are
   * read as what replaced them. */
  const ALIAS = { unranked: 'cat-unrated', queue: 'candidates' };
  const goTo = hash => {
    let id = '';
    try { id = decodeURIComponent(String(hash).replace(/^#/, '')); } catch { return false; }
    const el = id && document.getElementById(ALIAS[id] ?? id);
    if (!el || !list.contains(el)) return false;
    const d = el.closest('details.dg');
    if (state.query) clearSearch();
    if (!d) { revealGroup(el, true); return true; }
    if (!state.on.has(d.dataset.cat)) setCategory(d.dataset.cat, true);
    const it = byId.get(el.id) ?? byEntry.get(el.id.replace(/^dd-/, ''));
    if (!it) { revealGroup(d, true); return true; }
    if (it.record) { expand(it, { fromMap: true }); mapApi.focus?.(it.id); }
    else { mark(it); reveal(it); mapApi.focus?.(it.id); }
    return true;
  };
  document.addEventListener('click', e => {
    const a = e.target.closest?.('a[href^="#"]');
    if (!a || e.defaultPrevented || e.button || e.metaKey || e.ctrlKey || e.shiftKey) return;
    const hash = a.getAttribute('href');
    if (!goTo(hash)) return;
    // The scroll above is the one that knows about the pinned map, so the
    // browser's own jump is not wanted; the address still records the target.
    e.preventDefault();
    try { history.pushState(null, '', hash); } catch { /* the address stays as it was */ }
  });
  window.addEventListener('hashchange', () => goTo(location.hash));

  /* ---- start ---- */
  tools.hidden = false;
  layout.classList.add('has-tools');
  /* The sticky offsets below the toggles are written in CSS against their
   * height, which depends on how the chips wrap; this keeps the figure true. */
  const measure = () => layout.style.setProperty('--tools-h', tools.offsetHeight + 'px');
  if ('ResizeObserver' in window) new ResizeObserver(measure).observe(tools);
  dirApi.toolsMoved = measure;
  measure();
  render();
  if (location.hash) {
    // After the browser's own jump to the fragment, which may come first or last.
    goTo(location.hash);
    window.addEventListener('load', () => goTo(location.hash), { once: true });
  }
})();

/* ---- Directory map ----
 * The map sits ten to twenty screens down, so nothing of it loads with the
 * page: Leaflet (vendored, ./leaflet.js) is fetched when the rail comes within
 * a couple of screens of the viewport, or when a directory row asks for its
 * pin, whichever is first. Tiles follow from there.
 *
 * The rail is rendered hidden and revealed here, once there is at least one
 * point to plot; the search field and the toggles then move in beside the
 * map, so they are in reach wherever the map is. Everything that can go wrong
 * (the script fails to load, Leaflet throws on a bad coordinate) ends in
 * dropRail(): the toggles go back above the list, the map and its legend go
 * together and the list takes the full width. None of it can stop the
 * directory rows or the chart below from being wired up. Circle markers avoid
 * Leaflet's image assets entirely.
 */
(() => {
  const rail = document.getElementById('map-rail');
  const el = document.getElementById('map');
  if (!rail || !el) return;
  const layout = rail.parentElement;
  const pin = el.parentElement;
  const tools = document.getElementById('dir-tools');
  const dropRail = why => {
    if (why) console.warn('Directory map unavailable:', why);
    mapApi.focus = null;
    mapApi.sync = null;
    if (tools && rail.contains(tools)) layout.prepend(tools);
    layout.classList.remove('has-map');
    rail.remove();
    dirApi.toolsMoved?.();
  };

  let places = [];
  try {
    places = (DATA.places ?? []).filter(p => p.pts?.length);
  } catch (e) { dropRail(e); return; }
  if (!places.length) { dropRail(); return; }

  /* A popup is built from nodes, and every string from the dataset goes in as
   * text. Names and addresses are written by a research agent reading the
   * open web, or copied from a permit register, so they are never parsed as
   * markup; a link is made only from an http(s) URL. */
  const popupFor = (p, address) => {
    const box = document.createElement('div');
    box.className = 'map-pop';
    const title = document.createElement('b');
    if (/^https?:\/\//i.test(p.url ?? '')) {
      const a = document.createElement('a');
      a.href = p.url; a.target = '_blank'; a.rel = 'noopener';
      a.textContent = p.name;
      title.append(a);
    } else {
      title.textContent = p.name;
    }
    const line = text => {
      const div = document.createElement('div');
      div.className = 'addr';
      div.textContent = text;
      return div;
    };
    box.append(title);
    if (address) box.append(line(address));
    if (p.more) box.append(line(p.more));
    if (p.outside) box.append(line(`+ ${p.outside} location${p.outside > 1 ? 's' : ''} outside Seattle (see the list)`));
    return box;
  };

  const build = () => {
    const L = window.L;
    const topIds = new Set(
      [...document.querySelectorAll('#board .card')].map(c => 'r-' + c.dataset.id).slice(0, 10));

    /* A drag on the map always moves the map; wheel zoom follows the layout.
     * In the desktop rail the map is beside the table, and a wheel over it
     * reads as "zoom the map". In the stacked layout the map is pinned across
     * the top of the page while the list scrolls beneath it, so the pointer
     * comes to rest on it just by scrolling: a map that took the wheel there
     * would stop the page. A finger is different. The pinned map leaves most
     * of the screen to scroll the page with, so a drag that starts on the map
     * is meant for the map, and Leaflet takes it; one that starts on the list
     * scrolls the page. */
    const wideLayout = window.matchMedia('(min-width: 1100px)');
    const map = L.map(el, { scrollWheelZoom: wideLayout.matches });
    wideLayout.addEventListener?.('change', () => {
      if (wideLayout.matches) map.scrollWheelZoom.enable(); else map.scrollWheelZoom.disable();
    });
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(map);

    /* Leaflet pans a popup into the map, to within a margin of its edges. The
     * stacked map is narrow enough that a popup brought in from the left ends
     * up under the zoom buttons, so there the left margin is the width the
     * buttons take. Read each time a popup opens, so it follows the layout. */
    const popupInset = { get x() { return wideLayout.matches ? 5 : 50; }, y: 5 };

    /* One marker per point, made once and added to or taken off the map as
     * the directory's state changes. The colour is the category's, set in the
     * stylesheet from the class (the same custom properties colour the
     * toggles), so the options here are only what shows if that is missing.
     * A place that is not on file is drawn as a ring. */
    const pins = [];
    const first = new Map();   // the first (usually primary) pin of each place
    for (const p of places) {
      const top = topIds.has(p.id);
      for (const [lat, lon, address] of p.pts) {
        const marker = L.circleMarker([lat, lon], {
          radius: top ? 8 : 6,
          className: `pin pin-${p.cat}${p.lead ? ' pin-ring' : ''}${top ? ' pin-top' : ''}`,
          color: '#fff', weight: 1.5, fillColor: '#8a6a5a', fillOpacity: 0.92
        });
        marker.bindPopup(() => popupFor(p, address), { autoPanPaddingTopLeft: popupInset });
        marker.on('click', () => dirApi.fromPin?.(p.id));
        const pinned = { id: p.id, top, marker, at: [lat, lon], on: false };
        pins.push(pinned);
        if (!first.has(p.id)) first.set(p.id, pinned);
      }
    }

    /* A line over the map when it has nothing on it, so an empty map reads as
     * a choice and not as a failure. */
    const nothing = document.createElement('p');
    nothing.className = 'map-empty';
    nothing.hidden = true;
    pin.append(nothing);

    /* Put on the map exactly the pins the directory is showing. When that set
     * has changed, fit the map to it: the reader asked to see those places. */
    let fitted = false;
    const sync = () => {
      let changed = false;
      const bounds = [];
      for (const p of pins) {
        const want = dirApi.shows(p.id);
        if (want !== p.on) {
          if (want) p.marker.addTo(map); else p.marker.remove();
          p.on = want;
          changed = true;
        }
        if (want) bounds.push(p.at);
      }
      // The top ten are drawn last, so a neighbour never covers one.
      if (changed) for (const p of pins) if (p.on && p.top) p.marker.bringToFront();
      if (bounds.length && (changed || !fitted)) {
        map.fitBounds(bounds, { padding: [24, 24], maxZoom: 15 });
        fitted = true;
      }
      nothing.hidden = bounds.length > 0;
      nothing.textContent = bounds.length ? '' : 'Nothing to show on the map. Open a category to see its places.';
    };

    /* Seattle, until the first fit: Leaflet needs a view before it can draw. */
    map.setView([47.61, -122.33], 11);
    sync();

    /* Beside the table the map is a third of the row, which is small for
     * finding one corner of the city. The button trades the table's width for
     * the map's: the layout class does the resizing in CSS, and Leaflet is
     * told its box changed. The choice is the reader's, so it is remembered.
     * It is a control of the map's own, so it sits in the map's corner
     * whatever is above the map. */
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
    const Grow = L.Control.extend({
      options: { position: 'topright' },
      onAdd() { L.DomEvent.disableClickPropagation(grow); return grow; }
    });
    new Grow().addTo(map);
    let remembered = false;
    try { remembered = localStorage.getItem('pizza.mapLarge') === '1'; } catch {}
    setLarge(remembered);
    // The map's height follows the toggles above it, which wrap as they please.
    if ('ResizeObserver' in window) new ResizeObserver(() => map.invalidateSize()).observe(el);

    const focus = id => {
      const p = first.get(id);
      if (!p) return false;
      // A row can be clicked before the map has caught up with a search.
      if (!p.on) sync();
      if (!p.on) return false;
      map.setView(p.marker.getLatLng(), Math.max(map.getZoom(), 14));
      p.marker.openPopup();
      return true;
    };
    return { focus, sync };
  };

  /* One load, however it is asked for. Resolves to the map's functions, or to
   * null once the rail has been dropped. */
  let loading = null;
  const load = () => loading ??= new Promise(resolve => {
    const fail = why => { dropRail(why); resolve(null); };
    const script = document.createElement('script');
    script.src = './leaflet.js';
    script.onload = () => {
      try {
        const api = build();
        mapApi.sync = api.sync;
        resolve(api);
      } catch (e) { fail(e); }
    };
    script.onerror = () => fail('leaflet.js did not load');
    document.head.append(script);
  });

  rail.hidden = false;
  layout.classList.add('has-map');
  if (tools) pin.prepend(tools);
  dirApi.toolsMoved?.();
  mapApi.focus = id => { load().then(api => api?.focus(id)); };

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
