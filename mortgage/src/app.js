/* Mortgage Calculator — the live half of the page.
 *
 * Reads the form, runs src/mortgage.js (the same module the tests and the
 * deploy gate use), and writes every figure, the balance chart and the
 * schedule. State round-trips through the URL hash so a set of numbers can
 * be shared; the hash never reaches a server.
 */
import { describe, amortize, monthlyBreakdown, byYear } from './mortgage.js';

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
  const money0 = new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  const money2 = new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const plain = new Intl.NumberFormat(locale, { maximumFractionDigits: 3 });
  const monthFmt = new Intl.DateTimeFormat(locale, { month: 'short', year: 'numeric' });
  const usd = x => money0.format(Math.round(x));
  const usd2 = x => money2.format(x);

  const DEFAULTS = JSON.parse($('defaults').textContent);
  const els = {
    price: $('in-price'), down: $('in-down'), downpct: $('in-downpct'), rate: $('in-rate'),
    years: $('in-years'), start: $('in-start'), tax: $('in-tax'), ins: $('in-ins'),
    hoa: $('in-hoa'), pmi: $('in-pmi'), extra: $('in-extra'),
  };

  /* Accept what people type: "$750,000", "750k", "1.2m", "6.25%". */
  const parse = s => {
    const t = String(s).trim().toLowerCase().replace(/[$,%\s_]/g, '');
    const m = t.match(/^(-?\d*\.?\d+)([km]?)$/);
    if (!m) return NaN;
    return +m[1] * (m[2] === 'k' ? 1e3 : m[2] === 'm' ? 1e6 : 1);
  };
  const num = el => { const x = parse(el.value); return Number.isFinite(x) && x >= 0 ? x : NaN; };

  const nextMonth = () => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth() + 1, 1);
  };
  const ym = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  const startDate = () => {
    const m = /^(\d{4})-(\d{2})$/.exec(els.start.value);
    return m ? new Date(+m[1], +m[2] - 1, 1) : nextMonth();
  };
  const monthOf = (n, start) => new Date(start.getFullYear(), start.getMonth() + n - 1, 1);

  /* ---- state <-> form <-> hash ------------------------------------- */
  const KEYS = { price: 'p', down: 'd', rate: 'r', years: 'y', tax: 't', ins: 'i', hoa: 'h', pmi: 'm', extra: 'x', start: 's' };

  function fill(st) {
    els.price.value = st.price;
    els.down.value = st.down;
    els.downpct.value = st.price > 0 ? +(st.down / st.price * 100).toFixed(2) : 0;
    els.rate.value = st.rate;
    if (![...els.years.options].some(o => +o.value === +st.years)) {
      els.years.add(new Option(`${st.years} years`, st.years));
    }
    els.years.value = String(st.years);
    els.tax.value = st.taxRate;
    els.ins.value = st.insurance;
    els.hoa.value = st.hoa;
    els.pmi.value = st.pmiRate;
    els.extra.value = st.extra;
    els.start.value = st.start || ym(nextMonth());
  }

  function fromDefaults() {
    return { ...DEFAULTS, down: Math.round(DEFAULTS.price * DEFAULTS.downPct / 100) };
  }

  function fromHash() {
    const q = new URLSearchParams(location.hash.slice(1));
    if (![...q.keys()].length) return null;
    const st = fromDefaults();
    const map = { p: 'price', d: 'down', r: 'rate', y: 'years', t: 'taxRate', i: 'insurance', h: 'hoa', m: 'pmiRate', x: 'extra' };
    for (const [k, f] of Object.entries(map)) {
      const x = parse(q.get(k) ?? '');
      if (Number.isFinite(x) && x >= 0) st[f] = x;
    }
    const s = q.get('s');
    if (s && /^\d{4}-\d{2}$/.test(s)) st.start = s;
    return st;
  }

  function writeHash() {
    const q = new URLSearchParams();
    for (const [k, short] of Object.entries(KEYS)) q.set(short, els[k].value.trim().replace(/[$,\s]/g, ''));
    history.replaceState(null, '', '#' + q.toString());
  }

  /* ---- down payment: $ and % stay in step --------------------------- */
  els.down.addEventListener('input', () => {
    const p = num(els.price), d = num(els.down);
    if (p > 0 && Number.isFinite(d)) els.downpct.value = +(d / p * 100).toFixed(2);
  });
  els.downpct.addEventListener('input', () => {
    const p = num(els.price), pc = num(els.downpct);
    if (Number.isFinite(p) && Number.isFinite(pc)) els.down.value = Math.round(p * Math.min(pc, 100) / 100);
  });
  // Changing the price keeps the percentage, which is how people think about it.
  els.price.addEventListener('input', () => {
    const p = num(els.price), pc = num(els.downpct);
    if (Number.isFinite(p) && Number.isFinite(pc)) els.down.value = Math.round(p * Math.min(pc, 100) / 100);
  });

  /* ---- render ------------------------------------------------------- */
  let view = 'year';
  let last = null;

  function read() {
    const bad = [];
    const val = (el, key) => {
      const x = num(el);
      el.closest('.field').classList.toggle('invalid', !Number.isFinite(x));
      if (!Number.isFinite(x)) bad.push(key);
      return Number.isFinite(x) ? x : 0;
    };
    const rate = val(els.rate, 'rate');
    if (rate > 30) { els.rate.closest('.field').classList.add('invalid'); bad.push('rate'); }
    const d = describe({
      price: val(els.price, 'price'), down: val(els.down, 'down'), rate,
      years: +els.years.value, taxRate: val(els.tax, 'tax'), insurance: val(els.ins, 'ins'),
      hoa: val(els.hoa, 'hoa'), pmiRate: val(els.pmi, 'pmi'), extra: val(els.extra, 'extra'),
    });
    val(els.downpct, 'downpct');
    return { d, bad };
  }

  function render() {
    const { d, bad } = read();
    const start = startDate();
    const base = amortize(d, { extra: 0 });
    const fast = d.extra > 0 ? amortize(d) : base;
    const bd = monthlyBreakdown(d);
    const total = bd.pi + bd.tax + bd.insurance + bd.pmi + bd.hoa;
    last = { d, base, fast, start };

    $('out-total').textContent = bad.length ? '—' : usd(total);
    $('out-sub').textContent = bad.length
      ? 'Check the highlighted field.'
      : d.extra > 0
        ? `plus ${usd(d.extra)} extra principal, ${usd(total + d.extra)} in all`
        : d.loan > 0 ? `on a ${usd(d.loan)} loan over ${d.years} years` : 'Nothing borrowed, so nothing to repay.';

    for (const k of ['pi', 'tax', 'insurance', 'pmi', 'hoa']) {
      const x = bd[k];
      $('bd-' + k).textContent = usd2(x);
      $('row-' + k).classList.toggle('zero', x <= 0);
      const seg = $('seg-' + k);
      seg.style.flexGrow = total > 0 ? String(x / total) : '0';
      seg.hidden = x <= 0;
      seg.title = `${$('row-' + k).querySelector('.nm').textContent}: ${usd2(x)}`;
    }

    const payoff = fast.months ? monthOf(fast.months, start) : null;
    const set = (k, main, sub = '') => { $('sum-' + k).textContent = main; $('sub-' + k).textContent = sub; };
    set('loan', usd(d.loan), `${plain.format(+d.downPct.toFixed(1))}% down`);
    set('interest', usd(fast.totalInterest),
      d.loan > 0 ? `${plain.format(+(fast.totalInterest / d.loan * 100).toFixed(0))}% of the loan` : '');
    const paidAll = d.loan + fast.totalInterest + fast.totalPMI;
    set('cost', usd(paidAll), 'principal, interest and PMI');
    set('payoff', payoff ? monthFmt.format(payoff) : '—',
      fast.months ? `${Math.floor(fast.months / 12)} yr ${fast.months % 12 ? (fast.months % 12) + ' mo' : ''}`.trim() : '');
    if (fast.pmiMonths > 0) {
      set('pmiend', monthFmt.format(monthOf(fast.pmiMonths + 1, start)), `${usd(fast.totalPMI)} paid in total`);
    } else {
      set('pmiend', 'None', d.loan > 0 ? 'at least 20% down' : '');
    }
    $('fact-saved').classList.toggle('muted', !(d.extra > 0));
    if (d.extra > 0) {
      const mo = base.months - fast.months;
      set('saved', usd(base.totalInterest - fast.totalInterest + base.totalPMI - fast.totalPMI),
        `and ${Math.floor(mo / 12)} yr ${mo % 12} mo sooner`);
    } else {
      set('saved', '—', 'add an amount to see it');
    }

    drawChart();
    drawTable();
  }

  /* ---- chart -------------------------------------------------------- */
  const SVGNS = 'http://www.w3.org/2000/svg';
  const svgEl = (tag, attrs) => {
    const e = document.createElementNS(SVGNS, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    return e;
  };
  const compact = new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1 });

  function niceMax(x) {
    if (x <= 0) return 1;
    const p = Math.pow(10, Math.floor(Math.log10(x)));
    for (const m of [1, 1.25, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * p >= x) return m * p;
    return 10 * p;
  }

  function drawChart() {
    const { d, base, fast, start } = last;
    const host = $('chart');
    host.textContent = '';
    $('legend-extra').hidden = fast === base;
    $('legend-balance').textContent = fast === base ? 'Balance' : 'Balance on schedule';
    $('chart-note').textContent = d.loan > 0 ? `${d.years}-year term` : '';
    if (!(d.loan > 0) || !base.months) {
      host.innerHTML = '<p class="empty">Nothing borrowed — no balance to chart.</p>';
      return;
    }
    const W = Math.max(300, host.clientWidth || 640), H = W < 520 ? 220 : 280;
    /* Four series on one axis: the balance (on schedule, and with extra
       principal when there is any), and the running totals of principal and
       interest paid under the active schedule. All are dollars on the same
       scale, which is what lets them share a chart; interest paid can
       outgrow the loan, so the axis fits whichever is larger. */
    const running = (sch, key) => { let c = 0; return sch.rows.map(r => (c += key(r))); };
    const cumP = running(fast, r => r.principal + r.extra);
    const cumI = running(fast, r => r.interest);
    const yMax0 = niceMax(Math.max(d.loan, fast.totalInterest));
    const yLabels = [0, 1, 2, 3, 4].map(i => compact.format(yMax0 * i / 4));
    // Size the gutter to the widest tick label: locales differ a lot here
    // ("$600K" vs "600.000 $"), and a fixed gutter clipped the long ones.
    const m = { t: 12, r: 18, b: 28, l: 14 + 6.8 * Math.max(...yLabels.map(l => l.length)) };
    const iw = W - m.l - m.r, ih = H - m.t - m.b;
    const N = base.months;
    const yMax = yMax0;
    const X = n => m.l + n / N * iw, Y = b => m.t + ih - b / yMax * ih;
    const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: 'img',
      'aria-label': 'Loan balance, principal paid and interest paid over time' });

    const g = svgEl('g', { class: 'grid' });
    for (let i = 0; i <= 4; i++) {
      const val = yMax * i / 4, y = Y(val);
      g.append(svgEl('line', { x1: m.l, x2: W - m.r, y1: y, y2: y }));
      const t = svgEl('text', { x: m.l - 8, y: y + 4, 'text-anchor': 'end' });
      t.textContent = yLabels[i];
      g.append(t);
    }
    // Year ticks: the smallest step that leaves room for a four-digit label.
    const years = Math.ceil(N / 12);
    const stepY = [1, 2, 5, 10, 20].find(st => iw / years * st >= 52) || 20;
    for (let y = 0; y <= years; y += stepY) {
      const n = y * 12, x = X(Math.min(n, N));
      const anchor = y === 0 ? 'start' : x > W - m.r - 16 ? 'end' : 'middle';
      const t = svgEl('text', { x, y: H - 8, 'text-anchor': anchor });
      t.textContent = String(monthOf(n + 1, start).getFullYear());
      g.append(t);
    }
    svg.append(g);

    /* Each series: a value at payment n (0 = before the first), a colour slot
       and a tooltip label. Balance series fall to zero after payoff; the
       running totals hold their final value. */
    const balAt = sch => n => n <= 0 ? d.loan : n > sch.months ? 0 : sch.rows[n - 1].balance;
    const sumAt = arr => n => n <= 0 ? 0 : arr[Math.min(n, arr.length) - 1];
    const withExtra = fast !== base;
    const series = [
      { cls: 's1', label: withExtra ? 'Balance on schedule' : 'Balance', at: balAt(base) },
      withExtra && { cls: 's2', label: 'Balance with extra', at: balAt(fast) },
      { cls: 's3', label: `Principal paid${withExtra ? ' (with extra)' : ''}`, at: sumAt(cumP) },
      { cls: 's4', label: `Interest paid${withExtra ? ' (with extra)' : ''}`, at: sumAt(cumI) },
    ].filter(Boolean);
    for (const sr of series) {
      const pts = [];
      for (let n = 0; n <= N; n++) pts.push(`${X(n).toFixed(1)},${Y(sr.at(n)).toFixed(1)}`);
      svg.append(svgEl('path', { d: 'M' + pts.join('L'), class: `line ${sr.cls}` }));
    }

    const cross = svgEl('line', { class: 'cross', y1: m.t, y2: m.t + ih, x1: -10, x2: -10 });
    svg.append(cross);
    for (const sr of series) {
      sr.dot = svgEl('circle', { class: `dot ${sr.cls}`, r: 4.5, cx: -10, cy: -10 });
      svg.append(sr.dot);
    }
    const hit = svgEl('rect', { x: m.l, y: m.t, width: iw, height: ih, class: 'hit' });
    svg.append(hit);
    host.append(svg);

    const tip = $('tip');
    const move = ev => {
      const rect = svg.getBoundingClientRect();
      const px = (ev.clientX - rect.left) * (W / rect.width);
      const n = Math.max(1, Math.min(N, Math.round((px - m.l) / iw * N)));
      const x = X(n);
      cross.setAttribute('x1', x); cross.setAttribute('x2', x);
      for (const sr of series) { sr.dot.setAttribute('cx', x); sr.dot.setAttribute('cy', Y(sr.at(n))); }
      tip.innerHTML =
        `<b>${monthFmt.format(monthOf(n, start))}</b> · payment ${n}` +
        series.map(sr => `<div class="tr ${sr.cls}"><span class="sw"></span>${sr.label}<em>${usd(sr.at(n))}</em></div>`).join('');
      tip.hidden = false;
      const box = host.getBoundingClientRect();
      const left = (x / W) * box.width;
      const tw = tip.offsetWidth;
      tip.style.left = Math.max(0, Math.min(box.width - tw, left + (left > box.width / 2 ? -tw - 14 : 14))) + 'px';
      tip.style.top = (host.offsetTop + 8) + 'px';
    };
    const leave = () => {
      tip.hidden = true;
      cross.setAttribute('x1', -10); cross.setAttribute('x2', -10);
      for (const sr of series) sr.dot.setAttribute('cx', -10);
    };
    hit.addEventListener('pointermove', move);
    hit.addEventListener('pointerdown', move);
    hit.addEventListener('pointerleave', leave);
  }

  /* ---- schedule table ----------------------------------------------- */
  function drawTable() {
    const { fast, start } = last;
    const body = $('schedule');
    $('th-period').textContent = view === 'year' ? 'Year' : 'Month';
    const rows = view === 'year' ? byYear(fast.rows) : fast.rows;
    if (!rows.length) {
      body.innerHTML = '<tr><td colspan="6" class="empty">No payments — nothing is borrowed.</td></tr>';
      return;
    }
    const f = x => x > 0 ? usd(x) : '<span class="nil">—</span>';
    body.innerHTML = rows.map(r => {
      const label = view === 'year'
        ? `${r.year} <small>from ${monthFmt.format(monthOf((r.year - 1) * 12 + 1, start))}</small>`
        : `${r.n} <small>${monthFmt.format(monthOf(r.n, start))}</small>`;
      return `<tr><th scope="row">${label}</th><td>${f(r.principal)}</td><td>${f(r.interest)}</td><td>${f(r.extra)}</td><td>${f(r.pmi)}</td><td>${usd(r.balance)}</td></tr>`;
    }).join('');
  }

  for (const [id, v] of [['view-year', 'year'], ['view-month', 'month']]) {
    $(id).addEventListener('click', () => {
      view = v;
      $('view-year').setAttribute('aria-pressed', String(v === 'year'));
      $('view-month').setAttribute('aria-pressed', String(v === 'month'));
      drawTable();
    });
  }

  /* ---- wiring ------------------------------------------------------- */
  let t = 0;
  $('form').addEventListener('input', () => {
    clearTimeout(t);
    t = setTimeout(() => { render(); writeHash(); }, 60);
  });
  $('form').addEventListener('submit', e => e.preventDefault());
  $('btn-reset').addEventListener('click', () => {
    fill(fromDefaults());
    history.replaceState(null, '', location.pathname + location.search);
    render();
  });
  $('btn-share').addEventListener('click', async () => {
    writeHash();
    const status = $('share-status');
    try {
      await navigator.clipboard.writeText(location.href);
      status.textContent = 'Link copied.';
    } catch {
      status.textContent = 'Copy the address bar to share.';
    }
    setTimeout(() => { status.textContent = ''; }, 3000);
  });
  window.addEventListener('hashchange', () => { const st = fromHash(); if (st) { fill(st); render(); } });
  let rw = 0;
  window.addEventListener('resize', () => { clearTimeout(rw); rw = setTimeout(() => last && drawChart(), 120); });

  fill(fromHash() || fromDefaults());
  render();
  document.documentElement.classList.add('ready');
}
