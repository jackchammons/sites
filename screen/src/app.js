/* Screen & Seat — the live half of the page.
 *
 * Reads the form, runs src/screen.js (the module the tests and the deploy
 * gate also use), and writes every figure, the lanes chart, the tables and
 * the side view. State round-trips through the URL hash so a room can be
 * shared as a link; nothing is sent anywhere.
 */
import {
  ASPECTS, RESOLUTIONS, ANGLE_STANDARDS, RULE_OF_THUMB, BRIGHTNESS, PLACEMENT,
  aspect, resolution, dims, hfov, vfov, diagonalForWidth, diagonalForAngle,
  seatingDistances, ituDistances, pixelPitch, pixelAngle, pixelsPerDegree, acuityDistance,
  acuityTable, litImage, throwDistance, widthAtThrow, lensOffsetInches, footLamberts, nits,
  placement, describeAngle, describeResolution,
  noticeFraction, ppdForFraction, distanceForPpd, averagePpd, pixelDensity, aspectLabel,
  limitResolution, limitMatrix, subtended, verticalEquivalent, FRONT_ROW,
} from './screen.js';

const $ = id => document.getElementById(id);

try {
  boot();
} catch (e) {
  $('boot-error').hidden = false;
  throw e;
}

function boot() {
  /* Not every tag a browser reports is one Intl accepts ("en-US@posix"
     throws), so use the first that constructs. */
  const locale = (() => {
    const tags = [].concat(navigator.languages || [], navigator.language || [], 'en-US');
    for (const t of tags) {
      try { new Intl.NumberFormat(t); return t; } catch {}
    }
    return 'en-US';
  })();
  const nf = digits => new Intl.NumberFormat(locale, { maximumFractionDigits: digits, minimumFractionDigits: 0 });
  const n0 = nf(0), n1 = nf(1), n2 = nf(2), n3 = nf(3);
  const deg = (x, d = 1) => `${(d ? n1 : n0).format(x)}°`;

  const DATA = JSON.parse($('defaults').textContent);
  const DEFAULTS = DATA.inputs;

  const els = {
    diag: $('in-diag'), aspect: $('in-aspect'), res: $('in-res'), resw: $('in-resw'), resh: $('in-resh'), dist: $('in-dist'),
    eye: $('in-eye'), centre: $('in-centre'),
    throw1: $('in-throw1'), throw2: $('in-throw2'), offset: $('in-offset'),
    gain: $('in-gain'), lumens: $('in-lumens'),
  };

  /* ---- units -------------------------------------------------------- */
  let units = DEFAULTS.units;       // 'imperial' | 'metric'
  let mode = DEFAULTS.mode;         // 'tv' | 'projector'
  const metric = () => units === 'metric';

  /* A number as it is typed: "8", "8.5", ".5", and "8." on the way to "8.5",
     which must not flash the field invalid between two keystrokes. */
  const NUM = String.raw`(\d+\.?\d*|\.\d+)`;
  const UNIT = '(ft|feet|foot|in|inch|inches|cm|mm|m)';
  const ONE = new RegExp(`^${NUM} ?${UNIT}?$`);
  /* Feet then inches: the two numbers need a unit or a space between them,
     or "8.5.5" would read as 8.5 ft and half an inch. */
  const TWO = new RegExp(`^${NUM}(?: ?${UNIT} ?| )${NUM} ?(?:in|inch|inches)?$`);
  const DECIMAL = new RegExp(`^(-?)${NUM}$`);
  const PER = { ft: 12, feet: 12, foot: 12, in: 1, inch: 1, inches: 1, cm: 1 / 2.54, mm: 1 / 25.4, m: 100 / 2.54 };

  /* A length as people write it, to inches. `dflt` is the unit a bare
     number means. "8′6″", "8 ft 6 in", "8.5", "2.6 m", "260 cm" all work.
     A comma is a decimal point ("2,6 m") except where it could as well be
     grouping thousands: "1,000 cm" is ten metres to one reader and one
     centimetre to another, so it is refused rather than guessed. */
  function parseLength(s, dflt) {
    let t = String(s).trim().toLowerCase()
      .replace(/[′’']/g, ' ft ').replace(/[″”“"]/g, ' in ');
    if (/,\d{3}(?!\d)/.test(t)) return NaN;
    t = t.replace(/,/g, '.').replace(/\s+/g, ' ').trim();
    const two = t.match(TWO);
    if (two) {
      if (two[2] && !/^f/.test(two[2])) return NaN;      // "6 in 3" means nothing
      return +two[1] * 12 + +two[3];
    }
    const one = t.match(ONE);
    return one ? +one[1] * PER[one[2] || dflt] : NaN;
  }
  /* A ratio, a gain or a percentage. Half the world writes 1,2 and a phone's
     decimal keypad there offers nothing else, so one comma is the decimal
     point; it is never dropped as a thousands separator, which would turn a
     1,2 throw into 12. Only the lens offset can be negative. */
  const parseDecimal = (s, signed = false) => {
    const t = String(s).trim().replace(/[%\s]/g, '').replace(',', '.');
    const m = t.match(DECIMAL);
    return m && (signed || !m[1]) ? +t : NaN;
  };
  /* A whole number: lumens or a pixel count. Plain digits, or thousands
     grouped the way anyone writes them ("2,000", "2.000", "2 000"). Anything
     else with a separator ("2,5", "1.50") could be a decimal or a slip, and
     is invalid rather than guessed. */
  const parseCount = s => {
    const t = String(s).trim();
    if (/^\d+$/.test(t)) return +t;
    return /^[1-9]\d{0,2}([.,\s\u00a0\u202f])\d{3}(?:\1\d{3})*$/.test(t) ? +t.replace(/\D/g, '') : NaN;
  };

  /* Lengths for display. kind 'dist' is a room distance, 'dim' a picture
     dimension: feet-and-inches vs inches, metres vs centimetres. */
  function fmtLen(inches, kind = 'dist') {
    if (!Number.isFinite(inches)) return '—';
    if (metric()) {
      const cm = inches * 2.54;
      if (kind === 'dim' || cm < 100) return `${(kind === 'dim' ? n1 : n0).format(cm)} cm`;
      return `${n2.format(cm / 100)} m`;
    }
    if (kind === 'dim' || inches < 12) return `${n1.format(inches)} in`;
    let ft = Math.floor(inches / 12), rem = Math.round(inches - ft * 12);
    if (rem === 12) { ft += 1; rem = 0; }
    return rem ? `${ft} ft ${rem} in` : `${ft} ft`;
  }
  const fmtArea = in2 => metric()
    ? `${n2.format(in2 * 0.00064516)} m²`
    : `${n1.format(in2 / 144)} ft²`;
  /* What to put in a field so it reads back the same. Field values never
     go through Intl: a locale that writes "3,66" would be parsed as 366. */
  const plain = (x, digits) => String(+x.toFixed(digits));
  const distField = inches => {
    if (metric()) return plain(inches * 2.54 / 100, 2);
    /* The inches are rounded before they are split off, so 11.97 carries
       into the feet instead of reading "9 ft 12 in". */
    let ft = Math.floor(inches / 12), rem = +(inches - ft * 12).toFixed(1);
    if (rem === 12) { ft += 1; rem = 0; }
    return rem ? `${ft} ft ${rem} in` : String(ft);
  };
  const heightField = inches => metric() ? plain(inches * 2.54, 1) : plain(inches, 1);

  function applyUnits() {
    $('unit-imperial').setAttribute('aria-pressed', String(!metric()));
    $('unit-metric').setAttribute('aria-pressed', String(metric()));
    $('in-dist-unit').textContent = metric() ? 'm' : 'ft';
    $('in-eye-unit').textContent = metric() ? 'cm' : 'in';
    $('in-centre-unit').textContent = metric() ? 'cm' : 'in';
    $('in-eye-hint').textContent = metric() ? 'A sofa seats eyes at 95–115 cm' : 'A sofa seats eyes at 38–46 in';
    $('in-dist-hint').textContent = metric() ? '2.6 m, 260 cm or 8′6″ all work' : '8′6″, 8 ft 6 in or 2.6 m all work';
  }
  function applyMode() {
    const pj = mode === 'projector';
    $('mode-tv').setAttribute('aria-pressed', String(!pj));
    $('mode-pj').setAttribute('aria-pressed', String(pj));
    $('pj-fields').hidden = !pj;
    $('pj-section').hidden = !pj;
  }

  /* The panel in use: a preset, or the custom pixel counts. */
  const resOf = st => st.res === 'custom'
    ? { id: 'custom', label: `${n0.format(st.resw)} × ${n0.format(st.resh)} (${aspectLabel(st.resw, st.resh)})`, w: st.resw, h: st.resh }
    : resolution(st.res);
  const short = r => r.id === 'custom' ? `${n0.format(r.w)} × ${n0.format(r.h)}` : r.label.replace(/ \(.*$/, '');

  /* ---- state <-> form <-> hash ------------------------------------- */
  const KEYS = { diag: 'd', aspect: 'a', res: 'r', resw: 'rw', resh: 'rh', dist: 'v', eye: 'e', centre: 'c',
    throw1: 't1', throw2: 't2', offset: 'o', lumens: 'l', gain: 'g' };

  function stateFromDefaults() {
    return {
      diag: DEFAULTS.diagonal, aspect: DEFAULTS.aspect, res: DEFAULTS.resolution,
      resw: DEFAULTS.customW, resh: DEFAULTS.customH, dist: DEFAULTS.distance, eye: DEFAULTS.eyeHeight, centre: DEFAULTS.centreHeight,
      throw1: DEFAULTS.throwMin, throw2: DEFAULTS.throwMax, offset: DEFAULTS.lensOffset,
      lumens: DEFAULTS.lumens, gain: DEFAULTS.gain,
    };
  }

  /* A field written by fill() is displayed rounded (a metric distance to
     the centimetre). While it still holds that text the exact value is
     used, so a hash or a unit switch never drifts; the moment the person
     edits it, what they typed is what counts. */
  const exact = new Map();
  const write = (el, text, value) => { el.value = text; exact.set(el.id, { text, value }); };
  const lengthOf = (el, dflt) => {
    const e = exact.get(el.id);
    return e && e.text === el.value ? e.value : parseLength(el.value, dflt);
  };

  function fill(st) {
    write(els.diag, plain(st.diag, 1), st.diag);
    els.aspect.value = aspect(st.aspect).id;
    els.res.value = st.res === 'custom' ? 'custom' : resolution(st.res).id;
    els.resw.value = Math.round(st.resw); els.resh.value = Math.round(st.resh);
    $('custom-res').hidden = els.res.value !== 'custom';
    write(els.dist, distField(st.dist), st.dist);
    write(els.eye, heightField(st.eye), st.eye);
    write(els.centre, heightField(st.centre), st.centre);
    els.throw1.value = st.throw1; els.throw2.value = st.throw2;
    els.offset.value = st.offset; els.lumens.value = Math.round(st.lumens); els.gain.value = st.gain;
  }

  const bad = new Set();
  const mark = (el, ok) => {
    el.closest('.field').classList.toggle('invalid', !ok);
    if (ok) el.removeAttribute('aria-invalid'); else { el.setAttribute('aria-invalid', 'true'); bad.add(el.id); }
  };
  const labelOf = el => el.closest('.field').querySelector('.lbl').textContent;

  function read() {
    bad.clear();
    const hUnit = metric() ? 'cm' : 'in';
    const diag = lengthOf(els.diag, 'in');
    const custom = els.res.value === 'custom';
    $('custom-res').hidden = !custom;
    const resw = parseCount(els.resw.value), resh = parseCount(els.resh.value);
    mark(els.resw, !custom || (resw >= 16 && resw <= 100000));
    mark(els.resh, !custom || (resh >= 16 && resh <= 100000));
    const dist = lengthOf(els.dist, metric() ? 'm' : 'ft');
    const eye = lengthOf(els.eye, hUnit);
    const centre = lengthOf(els.centre, hUnit);
    const throw1 = parseDecimal(els.throw1.value), throw2 = parseDecimal(els.throw2.value);
    const offset = parseDecimal(els.offset.value, true);
    const lumens = parseCount(els.lumens.value), gain = parseDecimal(els.gain.value);
    mark(els.diag, diag > 0 && diag < 1000);
    mark(els.dist, dist > 0 && dist < 12000);
    mark(els.eye, eye >= 0 && eye < 2400);
    mark(els.centre, centre >= 0 && centre < 2400);
    if (mode === 'projector') {
      mark(els.throw1, throw1 > 0); mark(els.throw2, throw2 > 0);
      mark(els.offset, Number.isFinite(offset));
      mark(els.lumens, lumens > 0); mark(els.gain, gain > 0);
    } else {
      for (const el of [els.throw1, els.throw2, els.offset, els.lumens, els.gain]) mark(el, true);
    }
    return { diag, aspect: els.aspect.value, res: els.res.value, resw, resh, dist, eye, centre,
      throw1, throw2, offset, lumens, gain };
  }

  function writeHash(st) {
    const p = new URLSearchParams();
    for (const [k, key] of Object.entries(KEYS)) {
      const val = st[k];
      if (val == null || (typeof val === 'number' && !Number.isFinite(val))) continue;
      p.set(key, typeof val === 'number' ? String(+val.toFixed(3)) : val);
    }
    p.set('u', metric() ? 'm' : 'i');
    p.set('m', mode === 'projector' ? 'pj' : 'tv');
    const h = '#' + p.toString().replace(/%3A/g, ':');
    if (location.hash !== h) history.replaceState(null, '', h);
  }

  function readHash() {
    const st = stateFromDefaults();
    if (!location.hash.length) return st;
    const p = new URLSearchParams(location.hash.slice(1));
    for (const [k, key] of Object.entries(KEYS)) {
      if (!p.has(key)) continue;
      const raw = p.get(key);
      if (k === 'aspect') { if (ASPECTS.some(a => a.id === raw)) st[k] = raw; continue; }
      if (k === 'res') { st[k] = raw === 'custom' || RESOLUTIONS.some(r => r.id === raw) ? raw : st[k]; continue; }
      const x = +raw;
      if (Number.isFinite(x)) st[k] = x;
    }
    if (p.get('u') === 'm') units = 'metric';
    if (p.get('u') === 'i') units = 'imperial';
    if (p.get('m') === 'pj') mode = 'projector';
    if (p.get('m') === 'tv') mode = 'tv';
    return st;
  }

  /* ---- compute + render -------------------------------------------- */
  let last = null;

  /* A grade reaches the reader twice, as a colour and as a word beside the
     figure, because the colour alone says nothing to an eye that cannot tell
     red from green or to a screen reader. One word per grade, whatever the
     fact: it meets the limit the fact is graded on, it is marginal (inside a
     weaker limit only), or it fails every one. This is the only place either
     is written, so they cannot disagree: no grade clears both. */
  const GRADE_WORDS = { good: 'meets', ok: 'marginal', warn: 'fails' };
  const showGrade = (box, word, cls) => {
    const says = Object.hasOwn(GRADE_WORDS, cls) ? GRADE_WORDS[cls] : '';
    box.classList.remove(...Object.keys(GRADE_WORDS));
    if (says) box.classList.add(cls);
    word.textContent = says;
  };
  const set = (k, main, sub = '', cls = '') => {
    $('sum-' + k).textContent = main; $('sub-' + k).textContent = sub;
    showGrade($('fact-' + k), $('grade-' + k), cls);
  };

  function compute() {
    const st = read();
    const ok = bad.size === 0;
    const d = dims(ok ? st.diag : DEFAULTS.diagonal, aspect(st.aspect).ratio);
    const res = resOf(st);
    last = { st, d, res, ok };
    writeHash(st);

    /* Nothing below can be computed from a field that does not read, so
       nothing on the page may pass for current: the headline loses its figure
       and its grade, and everything else is dimmed until the next good read. */
    $('main').classList.toggle('stale', !ok);
    if (!ok) {
      const names = Object.values(els).filter(el => bad.has(el.id)).map(el => `“${labelOf(el)}”`);
      $('out-fov').textContent = '—';
      showGrade($('out-total'), $('out-grade'), '');
      $('out-sub').textContent = `Check ${names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0]}.`;
      return;
    }

    const fov = hfov(d, st.dist), vf = vfov(d, st.dist);
    /* Three colours throughout: green meets the standard, amber is inside a
       weaker one, red is outside every published limit. */
    const SMPTE = ANGLE_STANDARDS.find(s => s.id === 'smpte').angle;
    const THX_FAR = ANGLE_STANDARDS.find(s => s.id === 'thx-far').angle;
    const grade = (good, ok) => good ? 'good' : ok ? 'ok' : 'warn';
    const fovGrade = fov >= FRONT_ROW ? 'ok' : grade(fov >= SMPTE, fov >= THX_FAR);
    $('out-fov').textContent = deg(fov);
    $('out-sub').textContent = `${describeAngle(fov)} — a ${n1.format(st.diag)}-inch ${aspect(st.aspect).id} picture seen from ${fmtLen(st.dist)}.`;
    showGrade($('out-total'), $('out-grade'), fovGrade);

    set('size', `${fmtLen(d.width, 'dim')} × ${fmtLen(d.height, 'dim')}`,
      `${n1.format(st.diag)} in is ${n0.format(st.diag * 2.54)} cm`);
    set('area', fmtArea(d.area), `${n2.format(d.ratio)}:1`);
    /* Graded on the height a 16:9 picture shows at each seating standard,
       so the grade matches the headline on a 16:9 screen and a scope
       picture is judged on the height it actually gives. */
    const vSmpte = verticalEquivalent(SMPTE), vFar = verticalEquivalent(THX_FAR);
    set('vfov', deg(vf),
      `${n2.format(st.dist / d.height)} picture heights away; SMPTE 30° stands ${deg(vSmpte)} tall on 16:9, THX 26° ${deg(vFar)}`,
      vf >= verticalEquivalent(FRONT_ROW) ? 'ok' : grade(vf >= vSmpte, vf >= vFar));

    const pitch = pixelPitch(d, res);
    const ppd = pixelsPerDegree(pitch, st.dist);
    const dens = pixelDensity(pitch);
    set('density', `${n0.format(dens.ppi)} ppi`,
      `${n3.format(dens.mm)} mm pitch; ${short(res)} is ${aspectLabel(res.w, res.h)}`);
    const ppd95 = ppdForFraction(0.05);
    const ppdGrade = p => grade(p >= ppd95, p >= 60);
    set('pixel', `${n1.format(ppd)} px/°`,
      `${n2.format(pixelAngle(pitch, st.dist) * 60)}′ per pixel; 60 is 20/20, ${n0.format(ppd95)} satisfies 19 in 20 eyes`,
      ppdGrade(ppd));
    const imgV = subtended(pitch * res.h, st.dist);
    const avg = averagePpd(res.h, imgV);
    set('avg', `${n1.format(avg)} px/°`,
      `${n0.format(res.h)} rows over ${deg(imgV)}; edge pixels cover less angle`, ppdGrade(avg));
    const frac = noticeFraction(ppd);
    const pct = Math.round(frac * 100);
    set('eye', `${pct}% of people`,
      frac < 0.05 ? `could tell this from a perfect display: the Cambridge limit is met` : frac < 0.5 ? `could tell this from a perfect display; most could not` : `could tell this from a perfect display (Cambridge eye-limit model)`,
      grade(frac < 0.05, frac < 0.5));

    const rv = describeResolution(d, res, st.dist);
    if (rv.wasted) {
      set('res', `Past ${fmtLen(rv.limit)}`,
        `${short(res)} pixels merge beyond ${fmtLen(rv.limit)}, so none show from your seat${rv.lower ? `; ${short(rv.lower)} would look as sharp` : ''}`, 'good');
    } else {
      set('res', `Inside ${fmtLen(rv.limit)}`,
        `${short(res)} pixels stay distinct to 20/20 eyes out to ${fmtLen(rv.limit)}; from your seat the grid can show`,
        'warn');
    }

    const pl = placement(d, st.dist, st.eye, st.centre);
    const dir = Math.abs(pl.centre) < 0.5 ? 'level' : pl.centre > 0 ? 'up' : 'down';
    set('tilt', dir === 'level' ? 'Level' : `${deg(Math.abs(pl.centre))} ${dir}`,
      pl.ok ? `within ${PLACEMENT.maxUp}° up / ${PLACEMENT.maxDown}° down${Math.abs(pl.centre) > 5 ? ', but nearer eye level is easier' : ''}` : pl.centre > 0 ? `over ${PLACEMENT.maxUp}°: lower the screen or sit back` : `over ${PLACEMENT.maxDown}° down: raise the screen`,
      grade(pl.ok && Math.abs(pl.centre) <= 5, pl.ok));

    drawLanes();
    drawEye();
    drawMatrix();
    drawSeats();
    drawSizes();
    drawProjector();
    drawPlacement(pl);
  }

  /* The acuity table plus the panel in use, when that is a custom one. */
  const acuityRows = (d, res) => {
    const rows = acuityTable(d);
    if (rows.some(r => r.id === res.id)) return rows;
    const pitch = pixelPitch(d, res);
    return [...rows, { ...res, pitch, distance: acuityDistance(pitch) }];
  };

  /* ---- lanes chart: where the standards put the seat ---------------- */
  const SVGNS = 'http://www.w3.org/2000/svg';
  const svgEl = (tag, attrs, text) => {
    const e = document.createElementNS(SVGNS, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    if (text != null) e.textContent = text;
    return e;
  };
  /* Axis ticks: a step that leaves room for a label, in the display unit. */
  function axisTicks(maxIn, iw) {
    const per = metric() ? 100 / 2.54 : 12;         // inches per metre / foot
    const unitLabel = metric() ? 'm' : 'ft';
    const maxU = maxIn / per;
    const step = [0.25, 0.5, 1, 2, 5, 10, 20].find(s => iw / (maxU / s) >= 44) || 20;
    const ticks = [];
    for (let u = 0; u <= maxU + 1e-9; u += step) ticks.push({ at: u * per, label: `${n2.format(u)}${unitLabel === 'm' ? ' m' : '′'}` });
    return ticks;
  }

  function drawLanes() {
    const { st, d, res } = last;
    const host = $('lanes');
    host.textContent = '';
    const seats = seatingDistances(d);
    const at = id => seats.find(s => s.id === id).distance;
    const acuity = acuityRows(d, res);
    const resRows = acuity.filter(r => ['1080', '2160', res.id].includes(r.id)).sort((a, b) => b.w - a.w);
    const itu = ituDistances(d);
    const rows = [
      { fam: 's1', label: `THX best seat · ≥${seats[0].angle}°`, from: 0, to: at('thx-best'), open: true, tip: `Within ${fmtLen(at('thx-best'))} the picture fills ${seats[0].angle}° or more.` },
      { fam: 's1', label: `THX recommended · ${seats[1].angle}–${seats[0].angle}°`, from: at('thx-best'), to: at('thx'), tip: `${fmtLen(at('thx-best'))} to ${fmtLen(at('thx'))}.` },
      { fam: 's1', label: `SMPTE minimum · ${seats[2].angle}–${seats[1].angle}°`, from: at('thx'), to: at('smpte'), tip: `${fmtLen(at('thx'))} to ${fmtLen(at('smpte'))}.` },
      { fam: 's1', label: `THX back row · ${seats[3].angle}–${seats[2].angle}°`, from: at('smpte'), to: at('thx-far'), tip: `${fmtLen(at('smpte'))} to ${fmtLen(at('thx-far'))}. Past this a certified cinema would not seat you.` },
      ...itu.filter(s => s.res === '1080' || s.res === '2160').map(s => ({
        fam: 's3', label: `${s.short} · ${s.heights}H`, from: s.distance, to: s.distance, mark: true,
        tip: `${s.label}: ${s.heights} picture heights, ${fmtLen(s.distance)} (${deg(s.angle, 0)}).` })),
      ...resRows.map(r => ({
        fam: 's3', label: `${r.label.replace(/ \(.*$/, '')} pixels visible`, from: 0, to: r.distance, open: true,
        tip: `${r.label}: pixels distinct up to ${fmtLen(r.distance)} for 20/20 eyes; beyond that the resolution is not visible.` })),
      { fam: 's3', label: `${short(res)} · 1 in 20 see sharper`, from: 0, to: distanceForPpd(pixelPitch(d, res), ppdForFraction(0.05)), open: true,
        tip: `Cambridge eye-limit model: nearer than ${fmtLen(distanceForPpd(pixelPitch(d, res), ppdForFraction(0.05)))}, more than 5% of people could tell ${short(res)} from a perfect display.` },
      { fam: 's4', label: `Rule of thumb · ${RULE_OF_THUMB.near}–${RULE_OF_THUMB.far}× diagonal`, from: st.diag * RULE_OF_THUMB.near, to: st.diag * RULE_OF_THUMB.far,
        tip: `${fmtLen(st.diag * RULE_OF_THUMB.near)} to ${fmtLen(st.diag * RULE_OF_THUMB.far)}: the pre-HD shop-floor rule.` },
    ];

    const W = Math.max(320, host.clientWidth || 640);
    /* Narrow screens have no room for a label column, so each label sits
       above its band and the rows grow to make space. */
    const narrow = W < 560;
    const rowH = narrow ? 36 : 24, labelW = narrow ? 12 : 230;
    const m = { t: 22, r: 24, b: 30, l: labelW };
    const H = m.t + rows.length * rowH + m.b;
    const iw = W - m.l - m.r;
    const maxIn = Math.max(st.diag * (RULE_OF_THUMB.far + 0.2), st.dist * 1.12, ...rows.map(r => r.to * 1.04));
    const X = inches => m.l + Math.min(1, inches / maxIn) * iw;
    const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: 'img',
      'aria-label': 'Viewing distance bands by standard, with your seat marked' });

    const g = svgEl('g', { class: 'grid' });
    for (const t of axisTicks(maxIn, iw)) {
      const x = X(t.at);
      g.append(svgEl('line', { x1: x, x2: x, y1: m.t, y2: H - m.b }));
      g.append(svgEl('text', { x, y: H - m.b + 16, 'text-anchor': 'middle', class: 'tick' }, t.label));
    }
    svg.append(g);

    const tip = $('tip');
    rows.forEach((r, i) => {
      const y = m.t + i * rowH;
      const bandY = narrow ? y + 20 : y + 6, bandH = 12;
      const lbl = narrow
        ? svgEl('text', { x: m.l + 2, y: y + 13, 'text-anchor': 'start', 'font-size': '11' }, r.label)
        : svgEl('text', { x: m.l - 10, y: y + rowH / 2 + 4, 'text-anchor': 'end' }, r.label);
      svg.append(lbl);
      let x1 = X(r.from), x2 = X(r.to);
      if (r.mark) { x1 = X(r.from) - 2; x2 = x1 + 4; }
      if (x2 - x1 < 4) x2 = x1 + 4;
      const band = svgEl('rect', { x: x1, y: bandY, width: x2 - x1, height: bandH, class: `band ${r.fam}${r.open ? ' open' : ''}` });
      svg.append(band);
      const hit = svgEl('rect', { x: m.l, y, width: iw, height: rowH, class: 'hit' });
      const show = ev => {
        tip.innerHTML = `<b>${r.label}</b><br>${r.tip}`;
        tip.hidden = false;
        const box = host.getBoundingClientRect();
        const left = ev.clientX - box.left, top = ev.clientY - box.top;
        const tw = tip.offsetWidth;
        tip.style.left = Math.max(0, Math.min(box.width - tw, left + (left > box.width / 2 ? -tw - 12 : 12))) + 'px';
        tip.style.top = (host.offsetTop + top + 14) + 'px';
      };
      hit.addEventListener('pointermove', show);
      hit.addEventListener('pointerdown', show);
      hit.addEventListener('pointerleave', ev => { if (ev.pointerType !== 'touch') tip.hidden = true; });
      svg.append(hit);
    });

    const xy = X(st.dist);
    svg.append(svgEl('line', { x1: xy, x2: xy, y1: m.t - 4, y2: H - m.b, class: 'you' }));
    const anchor = xy > W - m.r - 70 ? 'end' : xy < m.l + 70 ? 'start' : 'middle';
    svg.append(svgEl('text', { x: xy, y: m.t - 8, class: 'you-lbl', 'text-anchor': anchor }, `you · ${fmtLen(st.dist)}`));
    host.append(svg);
  }

  /* ---- eye-limit bar and target distances --------------------------- */
  function drawEye() {
    const { st, d, res } = last;
    const host = $('eye-bar');
    host.textContent = '';
    const pitch = pixelPitch(d, res);
    const ppd = pixelsPerDegree(pitch, st.dist);
    const MAX = 160;
    const W = Math.max(320, host.clientWidth || 640), H = 64;
    const m = { l: 8, r: 8, t: 22, b: 20 };
    const iw = W - m.l - m.r, bh = H - m.t - m.b;
    const X = p => m.l + Math.min(1, p / MAX) * iw;
    const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: 'img',
      'aria-label': 'Share of people who could see a sharper display, by pixels per degree' });
    const defs = svgEl('defs', {});
    const grad = svgEl('linearGradient', { id: 'eye-grad', x1: 0, x2: 1, y1: 0, y2: 0 });
    for (let p = 0; p <= MAX; p += 4) {
      grad.append(svgEl('stop', { offset: `${(p / MAX * 100).toFixed(1)}%`, 'stop-color': 'var(--accent)', 'stop-opacity': (0.08 + 0.82 * noticeFraction(p)).toFixed(3) }));
    }
    defs.append(grad); svg.append(defs);
    svg.append(svgEl('rect', { x: m.l, y: m.t, width: iw, height: bh, fill: 'url(#eye-grad)', class: 'eye-grad' }));
    const ax = svgEl('g', { class: 'eye-axis' });
    for (let p = 0; p <= MAX; p += 20) {
      ax.append(svgEl('text', { x: X(p), y: H - 4, 'text-anchor': p === 0 ? 'start' : p === MAX ? 'end' : 'middle' }, `${p}${p === MAX ? ' px/°' : ''}`));
    }
    svg.append(ax);
    const xp = X(ppd);
    svg.append(svgEl('line', { x1: xp, x2: xp, y1: m.t - 6, y2: m.t + bh + 4, class: 'eye-you' }));
    const label = svgEl('text', { x: xp + 6, y: m.t - 9, class: 'eye-pct', 'text-anchor': 'start' },
      `${n1.format(ppd)} px/° · ${Math.round(noticeFraction(ppd) * 100)}% would notice`);
    svg.append(label);
    const tip = $('eye-tip');
    const hit = svgEl('rect', { x: m.l, y: m.t, width: iw, height: bh, class: 'hit' });
    const show = ev => {
      const rect = svg.getBoundingClientRect();
      const p = Math.max(0, Math.min(MAX, (ev.clientX - rect.left) * (W / rect.width) - m.l) / iw * MAX);
      tip.innerHTML = `<b>${n0.format(p)} px/°</b> · ${Math.round(noticeFraction(p) * 100)}% could tell it from a perfect display<br>${fmtLen(distanceForPpd(pitch, Math.max(1, p)))} from this screen`;
      tip.hidden = false;
      const box = host.getBoundingClientRect();
      const left = ev.clientX - box.left, tw = tip.offsetWidth;
      tip.style.left = Math.max(0, Math.min(box.width - tw, left + (left > box.width / 2 ? -tw - 12 : 12))) + 'px';
      tip.style.top = (host.offsetTop + H + 4) + 'px';
    };
    hit.addEventListener('pointermove', show);
    hit.addEventListener('pointerdown', show);
    hit.addEventListener('pointerleave', ev => { if (ev.pointerType !== 'touch') tip.hidden = true; });
    svg.append(hit);
    host.append(svg);

    /* Both of these need the text's real width, which exists only once the
       chart is in the page. The marker's label goes right of the marker when
       it fits there, left when it fits there, and otherwise as near the
       marker as the edges allow; it sits above the bar, so it can cross the
       marker line. An axis figure that would run into the last one, which
       carries the unit, is dropped. */
    const lw = label.getComputedTextLength();
    if (xp + 6 + lw <= W - m.r) label.setAttribute('x', xp + 6);
    else if (xp - 6 - lw >= m.l) label.setAttribute('x', xp - 6 - lw);
    else label.setAttribute('x', Math.max(m.l, Math.min(W - m.r - lw, xp + 6)));
    const ticks = [...ax.children];
    const unitLeft = W - m.r - ticks.at(-1).getComputedTextLength();
    for (const tick of ticks.slice(1, -1)) {
      if (+tick.getAttribute('x') + tick.getComputedTextLength() / 2 + 4 > unitLeft) tick.remove();
    }

    const targets = [
      { label: '20/20 vision', note: 'one arc-minute per pixel, the textbook limit', ppd: 60 },
      { label: 'Half of people', note: 'median measured limit, Cambridge 2025', ppd: ppdForFraction(0.5) },
      { label: '19 in 20 people', note: '95th percentile of the measured limit', ppd: ppdForFraction(0.05) },
    ];
    $('targets').innerHTML = targets.map(tg => {
      const dist = distanceForPpd(pitch, tg.ppd);
      const met = st.dist >= dist;
      return `<tr><th scope="row">${tg.label}<small>${tg.note}</small></th><td>${n0.format(tg.ppd)}</td><td>${fmtLen(dist)} or more</td>
        <td>${met ? `<span class="pill on">met</span>` : `<span class="nil">${fmtLen(dist - st.dist)} closer than that</span>`}</td></tr>`;
    }).join('');
  }

  /* ---- resolution matrix -------------------------------------------- */
  function drawMatrix() {
    const { st, d } = last;
    const per = metric() ? 100 / 2.54 : 12;
    const cols = [...new Set([...(metric() ? DATA.matrixMetres : DATA.matrixFeet).map(u => +(u * per).toFixed(2)), +st.dist.toFixed(2)])].sort((a, b) => a - b);
    const rows = [...new Set([...DATA.matrixSizes, +st.diag.toFixed(1)])].sort((a, b) => a - b);
    const cells = limitMatrix(rows, cols, d.ratio);
    const unit = metric() ? 'm' : 'ft';
    const colLabel = c => Math.abs(c - st.dist) < 0.01 ? `you · ${fmtLen(c)}` : `${+(c / per).toFixed(2)} ${unit}`;
    const head = `<thead><tr><th scope="col">size ↓ · seat →</th>${cols.map(c =>
      `<th scope="col"${Math.abs(c - st.dist) < 0.01 ? ' class="you"' : ''}>${colLabel(c)}</th>`).join('')}</tr></thead>`;
    const body = `<tbody>${rows.map((diag, i) => {
      const mine = Math.abs(diag - st.diag) < 0.05;
      return `<tr><th scope="row"${mine ? ' class="you"' : ''}>${mine ? 'you · ' : ''}${n1.format(diag)} in</th>${cells[i].map((c, j) => {
        const here = mine && Math.abs(cols[j] - st.dist) < 0.01;
        return `<td class="q${c ? c.rank + 1 : 0}${here ? ' you' : ''}" title="${n1.format(diag)} in at ${fmtLen(cols[j])}: ${c ? `${c.label} (${n0.format(c.w)} × ${n0.format(c.h)})` : 'more than 32K'}">${c ? c.label : '>32K'}</td>`;
      }).join('')}</tr>`;
    }).join('')}</tbody>`;
    $('matrix').innerHTML = head + body;
    const mine = limitResolution(d, st.dist);
    $('matrix-note').textContent = mine ? `${mine.label} is enough for you` : 'beyond 32K for you';
  }

  /* ---- table: how far to sit from this screen ---------------------- */
  function drawSeats() {
    const { st, d, res } = last;
    const rows = [];
    for (const s of seatingDistances(d)) rows.push({ label: s.label, note: s.note, distance: s.distance, angle: s.angle });
    for (const s of ituDistances(d)) rows.push({ label: s.label, note: `${s.heights} picture heights`, distance: s.distance, angle: s.angle });
    for (const r of acuityRows(d, res)) {
      if (['1080', '2160', '4320', res.id].includes(r.id)) {
        rows.push({ label: `${short(r)} pixels merge`, note: `one arc-minute per pixel; beyond this ${short(r)} is not visible`, distance: r.distance, angle: hfov(d, r.distance) });
      }
    }
    for (const [f, who] of [[0.5, 'half of people'], [0.05, '1 in 20 people']]) {
      const dist = distanceForPpd(pixelPitch(d, res), ppdForFraction(f));
      rows.push({ label: `${short(res)} sharp for all but ${who}`, note: `Cambridge eye-limit model, ${n0.format(ppdForFraction(f))} px/°`, distance: dist, angle: hfov(d, dist) });
    }
    rows.push({ label: 'Rule of thumb, near', note: `${RULE_OF_THUMB.near} × diagonal`, distance: st.diag * RULE_OF_THUMB.near, angle: hfov(d, st.diag * RULE_OF_THUMB.near) });
    rows.push({ label: 'Rule of thumb, far', note: `${RULE_OF_THUMB.far} × diagonal`, distance: st.diag * RULE_OF_THUMB.far, angle: hfov(d, st.diag * RULE_OF_THUMB.far) });
    rows.push({ label: 'Your seat', here: true, distance: st.dist, angle: hfov(d, st.dist) });
    rows.sort((a, b) => a.distance - b.distance);
    $('seats').innerHTML = rows.map(r => `<tr${r.here ? ' class="here"' : ''}>
      <th scope="row">${r.label}${r.note ? `<small>${r.note}</small>` : ''}</th>
      <td>${fmtLen(r.distance)}</td><td>${deg(r.angle)}</td>
      <td>${n2.format(r.distance / st.diag)}</td><td>${n2.format(r.distance / d.height)}</td></tr>`).join('');
  }

  /* ---- table: what size for your seat ------------------------------- */
  function drawSizes() {
    const { st, d, res } = last;
    const ratio = d.ratio;
    /* The viewer's own size joins the list as it is, to the tenth the
       headline prints: a 54.6-inch panel is not a 55. Its row is computed
       from the exact picture, so it agrees with every figure above it. */
    const mine = +st.diag.toFixed(1);
    const sizes = [...new Set([...DATA.sizes, mine])].sort((a, b) => a - b);
    $('sizes').innerHTML = sizes.map(diag => {
      const here = diag === mine;
      const dd = here ? d : dims(diag, ratio);
      const a = hfov(dd, st.dist);
      const vis = st.dist <= acuityDistance(pixelPitch(dd, res));
      return `<tr${here ? ' class="here"' : ''}>
        <th scope="row">${n1.format(diag)} in${here ? '<span class="pill on">yours</span>' : ''}</th>
        <td>${fmtLen(dd.width, 'dim')} × ${fmtLen(dd.height, 'dim')}</td>
        <td>${deg(a)}</td>
        <td class="verdict">${describeAngle(a)}</td>
        <td>${vis ? `<span class="pill bad">grid can show</span>` : `<span class="pill on">hidden</span>`}</td></tr>`;
    }).join('');
    const fit = ANGLE_STANDARDS.map(s => `${n0.format(diagonalForAngle(st.dist, s.angle, ratio))} in for ${s.short}`);
    $('sizes-note').textContent = `from ${fmtLen(st.dist)}: ${fit.join(' · ')}`;
  }

  /* ---- projector ---------------------------------------------------- */
  function drawProjector() {
    const { st, d, res } = last;
    if (mode !== 'projector') return;
    /* Every figure here is for the image the panel lights, the one the pixel
       facts describe. On a picture of another shape that is narrower or
       shorter than the picture, and the fact it changes says so, wherever the
       two sizes read differently. */
    const lit = litImage(d, res);
    const dim = x => fmtLen(x, 'dim');
    const narrower = dim(lit.width) !== dim(d.width), shorter = dim(lit.height) !== dim(d.height);
    const panel = `the ${aspectLabel(res.w, res.h)} panel`;
    const t1 = Math.min(st.throw1, st.throw2), t2 = Math.max(st.throw1, st.throw2);
    const near = throwDistance(lit.width, t1), far = throwDistance(lit.width, t2);
    const at = `at throw ${n2.format(t1)}${t1 === t2 ? '' : `–${n2.format(t2)}`}`;
    set('throw', t1 === t2 ? fmtLen(near) : `${fmtLen(near)} – ${fmtLen(far)}`,
      narrower ? `lens to screen for the ${dim(lit.width)}-wide lit image ${at}: ${panel} fills the height of the ${dim(d.width)}-wide picture`
        : `lens to screen for a ${dim(d.width)}-wide picture ${at}`);
    const off = lensOffsetInches(lit, st.offset);
    const lensH = st.centre - off;
    set('lens', fmtLen(lensH, 'dim'),
      `from the floor: ${dim(Math.abs(off))} ${off >= 0 ? 'below' : 'above'} the picture centre at ${n0.format(st.offset)}% offset${shorter ? ` of the ${dim(lit.height)} lit height: ${panel} fills the width of the ${dim(d.height)}-tall picture` : ''}${st.offset >= 0 ? '' : ' (ceiling mount, inverted)'}`);
    const fl = footLamberts(st.lumens, st.gain, lit);
    set('fl', `${n1.format(fl)} fL`,
      `${n0.format(nits(fl))} cd/m² from ${n0.format(st.lumens)} lm × ${n2.format(st.gain)} gain over ${narrower || shorter ? `the ${fmtArea(lit.area)} lit (${dim(lit.width)} × ${dim(lit.height)}: ${panel} fills the ${lit.fills})` : fmtArea(lit.area)}; cinema ${BRIGHTNESS.cinema}, home ≥${BRIGHTNESS.sdrHome}, bright room ~${BRIGHTNESS.bright}`,
      fl < BRIGHTNESS.cinema ? 'warn' : fl >= BRIGHTNESS.sdrHome ? 'good' : 'ok');
    /* The other way round: the image this lens throws from the seat, and the
       diagonal of the picture that image would light in the same way. */
    const wNear = widthAtThrow(st.dist, t2), wFar = widthAtThrow(st.dist, t1);
    const dg = w => n0.format(diagonalForWidth(w * (d.width / lit.width), d.ratio));
    set('width', t1 === t2 ? dim(wNear) : `${dim(wNear)} – ${dim(wFar)}`,
      `if the lens sat at your seat distance (${fmtLen(st.dist)}): ${narrower ? 'filling the height of ' : ''}a ${dg(wNear)}${t1 === t2 ? '' : `–${dg(wFar)}`} in diagonal`);
  }

  /* ---- placement ---------------------------------------------------- */
  function drawPlacement(pl) {
    const { st, d } = last;
    const updown = a => Math.abs(a) < 0.5 ? 'level' : `${deg(Math.abs(a))} ${a > 0 ? 'up' : 'down'}`;
    set('top', updown(pl.top), `${fmtLen(st.centre + d.height / 2, 'dim')} from the floor`);
    set('bottom', updown(pl.bottom), `${fmtLen(pl.bottomEdge, 'dim')} from the floor`);
    set('max', fmtLen(pl.maxCentre, 'dim'), `centre height for a ${PLACEMENT.maxUp}° eye line from ${fmtLen(st.dist)}`);
    set('stand', fmtLen(pl.bottomEdge, 'dim'),
      pl.bottomEdge < 0 ? 'below the floor: raise the centre' : `a stand or mount puts the bottom edge here`,
      pl.bottomEdge < 0 ? 'warn' : '');

    /* Side view, to scale: eye at left, screen at right. */
    const host = $('side-view');
    host.textContent = '';
    const W = 260, H = 190, pad = 16;
    const top = Math.max(st.centre + d.height / 2, st.eye, st.dist * Math.tan(PLACEMENT.maxUp * Math.PI / 180) + st.eye) * 1.08;
    const scale = Math.min((W - 2 * pad - 20) / st.dist, (H - 2 * pad - 14) / top);
    const ex = pad + 10, floorY = H - pad - 8;
    const sx = ex + st.dist * scale;
    const Y = h => floorY - h * scale;
    const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Side view: eye line to the screen' });
    // Comfort wedge from the eye to the screen plane.
    const upY = Y(st.eye + st.dist * Math.tan(PLACEMENT.maxUp * Math.PI / 180));
    const dnY = Y(st.eye - st.dist * Math.tan(PLACEMENT.maxDown * Math.PI / 180));
    svg.append(svgEl('polygon', { points: `${ex},${Y(st.eye)} ${sx},${upY} ${sx},${dnY}`, class: 'band' }));
    svg.append(svgEl('line', { x1: pad, x2: W - pad, y1: floorY, y2: floorY, class: 'floor' }));
    svg.append(svgEl('line', { x1: sx + 6, x2: sx + 6, y1: pad, y2: floorY, class: 'wall' }));
    svg.append(svgEl('rect', { x: sx, y: Y(st.centre + d.height / 2), width: 4, height: Math.max(2, d.height * scale), class: 'scr' }));
    svg.append(svgEl('line', { x1: ex, y1: Y(st.eye), x2: sx, y2: Y(st.centre + d.height / 2), class: 'ray edge' }));
    svg.append(svgEl('line', { x1: ex, y1: Y(st.eye), x2: sx, y2: Y(st.centre - d.height / 2), class: 'ray edge' }));
    svg.append(svgEl('line', { x1: ex, y1: Y(st.eye), x2: sx, y2: Y(st.centre), class: 'ray' }));
    svg.append(svgEl('circle', { cx: ex, cy: Y(st.eye), r: 4, class: 'eye' }));
    svg.append(svgEl('text', { x: (ex + sx) / 2, y: floorY + 12, 'text-anchor': 'middle' }, fmtLen(st.dist)));
    svg.append(svgEl('text', { x: ex - 4, y: Y(st.eye) - 7, 'text-anchor': 'start' }, `eye ${fmtLen(st.eye, 'dim')}`));
    svg.append(svgEl('text', { x: sx - 6, y: Y(st.centre + d.height / 2) - 5, 'text-anchor': 'end' }, `centre ${fmtLen(st.centre, 'dim')}`));
    host.append(svg);
  }

  /* ---- wiring ------------------------------------------------------- */
  let t = 0;
  const schedule = () => { clearTimeout(t); t = setTimeout(compute, 60); };
  $('form').addEventListener('input', schedule);
  $('form').addEventListener('change', schedule);
  $('form').addEventListener('submit', e => { e.preventDefault(); compute(); });

  const switchUnits = u => {
    if (u === units) return;
    const st = last && last.ok ? last.st : read();
    units = u;
    applyUnits();
    /* Only the room lengths are written in the unit. One that did not read
       keeps the text the person left in it, since there is nothing to convert. */
    for (const [el, k, text] of [[els.dist, 'dist', distField], [els.eye, 'eye', heightField], [els.centre, 'centre', heightField]]) {
      if (Number.isFinite(st[k])) write(el, text(st[k]), st[k]);
    }
    compute();
  };
  $('unit-imperial').addEventListener('click', () => switchUnits('imperial'));
  $('unit-metric').addEventListener('click', () => switchUnits('metric'));
  const switchMode = mo => { mode = mo; applyMode(); compute(); };
  $('mode-tv').addEventListener('click', () => switchMode('tv'));
  $('mode-pj').addEventListener('click', () => switchMode('projector'));

  $('btn-this').addEventListener('click', () => {
    const w = Math.round((window.screen?.width || 0) * (window.devicePixelRatio || 1));
    const h = Math.round((window.screen?.height || 0) * (window.devicePixelRatio || 1));
    if (!(w > 0 && h > 0)) { $('this-note').textContent = 'The browser did not report a screen size.'; return; }
    els.res.value = 'custom'; els.resw.value = w; els.resh.value = h;
    $('custom-res').hidden = false;
    $('this-note').textContent = `${w} × ${h} as this browser reports it.`;
    compute();
  });
  $('btn-reset').addEventListener('click', () => {
    units = DEFAULTS.units; mode = DEFAULTS.mode;
    applyUnits(); applyMode(); fill(stateFromDefaults()); compute();
    $('status').textContent = 'Reset.';
  });
  $('btn-copy').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(location.href);
      $('status').textContent = 'Link copied.';
    } catch {
      $('status').textContent = 'Copy the address bar instead.';
    }
  });
  /* A finger has no hover to end, so a tapped tooltip stays (pointerleave
     ignores touch above) until the next press anywhere. Capturing puts this
     ahead of a chart's own handler, which then shows the tooltip for the
     place pressed. */
  document.addEventListener('pointerdown', () => { $('tip').hidden = true; $('eye-tip').hidden = true; }, true);
  window.addEventListener('hashchange', () => { fill(readHash()); applyUnits(); applyMode(); compute(); });
  window.addEventListener('resize', () => { if (last && last.ok) { drawLanes(); drawEye(); } });

  const start = readHash();
  applyUnits(); applyMode();
  fill(start);
  compute();
  /* The page's own load check reads this to tell a script that ran from one
     that never arrived or never linked. */
  window.__screenBooted = true;
}
