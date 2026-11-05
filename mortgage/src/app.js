/* Mortgage Calculator — the live half of the page.
 *
 * Reads the form, runs src/mortgage.js (the same module the tests and the
 * deploy gate use), and writes every figure, the balance chart and the
 * schedule. State round-trips through the URL hash so a set of numbers can
 * be shared; the hash never reaches a server.
 */
import { describe, amortize, monthlyBreakdown, byYear, originalLoan } from './mortgage.js';

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
    years: $('in-years'), start: $('in-start'), balance: $('in-balance'), maturity: $('in-maturity'), next: $('in-next'), assumed: $('in-assumed'), tax: $('in-tax'), ins: $('in-ins'),
    hoa: $('in-hoa'), pmi: $('in-pmi'), extra: $('in-extra'), every: $('in-every'),
    taxUnit: $('in-tax-unit'), insUnit: $('in-ins-unit'), escrow: $('in-escrow'), escrowUnit: $('in-escrow-unit'),
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
  const monthFrom = el => {
    const m = /^(\d{4})-(\d{2})$/.exec(el.value);
    return m ? new Date(+m[1], +m[2] - 1, 1) : null;
  };
  const monthsBetween = (a, b) => (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
  // Where the schedule starts: the first payment of a new loan, the next
  // payment of one under way.
  const startDate = () => monthFrom(progressMode ? els.next : els.start) || nextMonth();
  const monthOf = (n, start) => new Date(start.getFullYear(), start.getMonth() + n - 1, 1);

  /* ---- state <-> form <-> hash ------------------------------------- */
  const KEYS = { price: 'p', down: 'd', balance: 'b', next: 'nx', assumed: 'ad', rate: 'r', years: 'y', tax: 't', taxUnit: 'tu', ins: 'i', insUnit: 'iu', escrow: 'w', escrowUnit: 'wu', hoa: 'h', pmi: 'm', extra: 'x', every: 'e', start: 's' };
  let escrowMode = false;
  let progressMode = false;

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
    els.taxUnit.value = st.taxUnit;
    els.ins.value = st.insurance;
    els.insUnit.value = st.insUnit;
    els.escrow.value = st.escrow;
    els.escrowUnit.value = st.escrowUnit;
    setMode(!!st.escrowMode);
    els.hoa.value = st.hoa;
    els.pmi.value = st.pmiRate;
    els.extra.value = st.extra;
    els.every.value = String([...els.every.options].some(o => +o.value === +st.extraEvery) ? st.extraEvery : 1);
    els.start.value = st.start || ym(nextMonth());
    els.balance.value = st.balance ?? '';
    els.next.value = st.next || ym(nextMonth());
    els.assumed.value = st.assumed ?? st.downPct;
    syncMaturity();
    setLoanMode(!!st.progressMode);
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
    const e = parse(q.get('e') ?? '');
    if (Number.isFinite(e) && e >= 0) st.extraEvery = e;
    const w = parse(q.get('w') ?? '');
    if (Number.isFinite(w) && w >= 0) st.escrow = w;
    for (const [k, f, ok] of [['tu', 'taxUnit', ['pct', 'yr', 'mo']], ['iu', 'insUnit', ['yr', 'mo']], ['wu', 'escrowUnit', ['mo', 'yr']]]) {
      if (ok.includes(q.get(k))) st[f] = q.get(k);
    }
    st.escrowMode = q.get('em') === '1';
    const s = q.get('s');
    if (s && /^\d{4}-\d{2}$/.test(s)) st.start = s;
    const b = parse(q.get('b') ?? '');
    if (Number.isFinite(b) && b >= 0) st.balance = b;
    const nx = q.get('nx');
    if (nx && /^\d{4}-\d{2}$/.test(nx)) st.next = nx;
    const ad = parse(q.get('ad') ?? '');
    if (Number.isFinite(ad) && ad >= 0 && ad < 100) st.assumed = ad;
    st.progressMode = q.get('lm') === '1';
    return st;
  }

  function writeHash() {
    const q = new URLSearchParams();
    for (const [k, short] of Object.entries(KEYS)) q.set(short, els[k].value.trim().replace(/[$,\s]/g, ''));
    if (escrowMode) q.set('em', '1');
    if (progressMode) q.set('lm', '1');
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
    const inf = progressMode ? inferred(val) : null;
    const d = describe({
      rate,
      ...(progressMode
        ? { price: inf.price, balance: val(els.balance, 'balance'), months: inf.left }
        : { price: val(els.price, 'price'), down: val(els.down, 'down'), years: +els.years.value }),
      // Tax and insurance arrive in whatever unit the picker says; the
      // maths takes dollars per year (or a tax rate, when that is the unit).
      ...taxAndInsurance(val),
      hoa: val(els.hoa, 'hoa'), pmiRate: val(els.pmi, 'pmi'), extra: val(els.extra, 'extra'),
      extraEvery: +els.every.value,
    });
    if (!progressMode) val(els.downpct, 'downpct');
    if (progressMode) {
      $('inferred').classList.toggle('invalid', !inf.ok);
      if (!inf.ok) bad.push('dates');
      $('inf-price').textContent = inf.ok ? usd(inf.price) : '—';
      $('inf-note').textContent = inf.ok
        ? `home price at ${plain.format(inf.assumed)}% down, from an original loan of about ${usd(inf.loan)} with ${inf.paid} of ${inf.n} payments made`
        : inf.paid < 0 ? 'The next payment is before the first.'
        : inf.paid >= inf.n ? 'The next payment is after the last one — check the dates and term.'
        : 'Enter the balance and dates.';
    }
    return { d, bad };
  }

  /* First and last payment are two views of one fact, given the term:
     editing either rewrites the other. */
  function syncMaturity(fromMaturity = false) {
    const n = (+els.years.value || 30) * 12;
    if (fromMaturity) {
      const mt = monthFrom(els.maturity);
      if (mt) els.start.value = ym(new Date(mt.getFullYear(), mt.getMonth() - n + 1, 1));
    } else {
      const s0 = monthFrom(els.start) || nextMonth();
      els.maturity.value = ym(new Date(s0.getFullYear(), s0.getMonth() + n - 1, 1));
    }
  }
  els.maturity.addEventListener('input', () => syncMaturity(true));
  els.start.addEventListener('input', () => syncMaturity());
  els.years.addEventListener('input', () => syncMaturity());

  /* A loan under way: the balance, the term and how far along the loan is
     give back the original principal, and with an assumed down payment the
     home price. Assumes payments have been exactly on schedule. */
  function inferred(val) {
    const balance = val(els.balance, 'balance');
    const n = (+els.years.value || 30) * 12;
    const first = monthFrom(els.start) || nextMonth(), next = monthFrom(els.next) || nextMonth();
    const paid = monthsBetween(first, next);
    const assumed = Math.min(99, val(els.assumed, 'assumed'));
    const loan = originalLoan(balance, num(els.rate) || 0, n, paid);
    const ok = Number.isFinite(loan);
    return { ok, n, paid, left: ok ? n - paid : NaN, loan, assumed, price: ok ? loan / (1 - assumed / 100) : 0 };
  }
  const termWord = months => {
    const y = Math.floor(months / 12), mo = months % 12;
    return [y ? `${y} yr` : '', mo ? `${mo} mo` : ''].filter(Boolean).join(' ') || '0 mo';
  };

  /* Switching to "already paying" with nothing entered seeds the balance
     from the new-loan figures and the maturity from the term, so the page
     does not go blank; the next-payment month moves to next month. */
  function setLoanMode(progress) {
    progressMode = progress;
    $('price-field').hidden = progress;
    $('new-fields').hidden = progress;
    $('progress-fields').hidden = !progress;
    $('maturity-field').hidden = !progress;
    $('next-field').hidden = !progress;
    $('term-label').textContent = progress ? 'Original term' : 'Term';
    $('lbl-loan').textContent = progress ? 'Balance' : 'Loan amount';
    $('mode-new').setAttribute('aria-pressed', String(!progress));
    $('mode-progress').setAttribute('aria-pressed', String(progress));
    if (progress) {
      if (!(num(els.balance) >= 0) || els.balance.value.trim() === '') {
        const p = num(els.price) || 0, dn = num(els.down) || 0;
        els.balance.value = Math.max(0, Math.round(p - dn));
      }
      if (!monthFrom(els.next)) els.next.value = ym(nextMonth());
      if (els.assumed.value.trim() === '') els.assumed.value = els.downpct.value || 20;
      syncMaturity();
    }
  }
  $('mode-new').addEventListener('click', () => { setLoanMode(false); render(); writeHash(); });
  $('mode-progress').addEventListener('click', () => { setLoanMode(true); render(); writeHash(); });

  const perYear = (x, unit) => unit === 'mo' ? x * 12 : x;
  function taxAndInsurance(val) {
    if (escrowMode) {
      return { escrow: perYear(val(els.escrow, 'escrow'), els.escrowUnit.value) };
    }
    const t = val(els.tax, 'tax'), tu = els.taxUnit.value;
    return {
      ...(tu === 'pct' ? { taxRate: t } : { tax: perYear(t, tu) }),
      insurance: perYear(val(els.ins, 'ins'), els.insUnit.value),
    };
  }

  /* Switching to escrow with nothing entered seeds it from the split
     figures, so the total does not drop to nothing. */
  function setMode(escrow) {
    escrowMode = escrow;
    $('split-fields').hidden = escrow;
    $('escrow-fields').hidden = !escrow;
    $('mode-split').setAttribute('aria-pressed', String(!escrow));
    $('mode-escrow').setAttribute('aria-pressed', String(escrow));
    if (escrow && !(num(els.escrow) > 0)) {
      const p = num(els.price) || 0, t = num(els.tax) || 0, i = num(els.ins) || 0;
      const tax = els.taxUnit.value === 'pct' ? p * t / 100 : perYear(t, els.taxUnit.value);
      const yearly = tax + perYear(i, els.insUnit.value);
      els.escrow.value = Math.round(els.escrowUnit.value === 'mo' ? yearly / 12 : yearly);
    }
  }
  $('mode-split').addEventListener('click', () => { setMode(false); render(); writeHash(); });
  $('mode-escrow').addEventListener('click', () => { setMode(true); render(); writeHash(); });

  const cadenceWord = e => ({ 0: 'once', 3: 'each quarter', 6: 'twice a year', 12: 'each year' })[e] || `every ${e} months`;

  function render() {
    const { d, bad } = read();
    const start = startDate();
    const base = amortize(d, { extra: 0 });
    const fast = d.extra > 0 ? amortize(d) : base;
    const bd = monthlyBreakdown(d);
    const total = bd.pi + bd.tax + bd.insurance + bd.escrow + bd.pmi + bd.hoa;
    last = { d, base, fast, start };

    $('out-total').textContent = bad.length ? '—' : usd(total);
    $('out-sub').textContent = bad.length
      ? 'Check the highlighted field.'
      : d.extra > 0
        ? d.extraEvery === 1
          ? `plus ${usd(d.extra)} extra principal, ${usd(total + d.extra)} in all`
          : `plus ${usd(d.extra)} extra principal ${cadenceWord(d.extraEvery)}`
        : d.loan > 0
          ? d.inProgress ? `on a ${usd(d.loan)} balance, ${termWord(d.months)} to go` : `on a ${usd(d.loan)} loan over ${d.years} years`
          : 'Nothing borrowed, so nothing to repay.';

    for (const k of ['pi', 'tax', 'insurance', 'escrow', 'pmi', 'hoa']) {
      const x = bd[k];
      $('bd-' + k).textContent = usd2(x);
      $('row-' + k).classList.toggle('zero', x <= 0);
      // The rows for the mode not in use are hidden rather than shown at $0.
      $('row-' + k).hidden = k === 'escrow' ? !escrowMode : (k === 'tax' || k === 'insurance') && escrowMode;
      const seg = $('seg-' + k);
      seg.style.flexGrow = total > 0 ? String(x / total) : '0';
      seg.hidden = x <= 0;
      seg.title = `${$('row-' + k).querySelector('.nm').textContent}: ${usd2(x)}`;
    }

    const payoff = fast.months ? monthOf(fast.months, start) : null;
    const set = (k, main, sub = '') => { $('sum-' + k).textContent = main; $('sub-' + k).textContent = sub; };
    set('loan', usd(d.loan), d.inProgress
      ? (d.price > 0 ? `${plain.format(+(d.loan / d.price * 100).toFixed(1))}% of the inferred price` : '')
      : `${plain.format(+d.downPct.toFixed(1))}% down`);
    set('interest', usd(fast.totalInterest),
      d.loan > 0 ? `${plain.format(+(fast.totalInterest / d.loan * 100).toFixed(0))}% of the loan` : '');
    const paidAll = d.loan + fast.totalInterest + fast.totalPMI;
    set('cost', usd(paidAll), 'principal, interest and PMI');
    set('payoff', payoff ? monthFmt.format(payoff) : '—',
      fast.months ? `${Math.floor(fast.months / 12)} yr ${fast.months % 12 ? (fast.months % 12) + ' mo' : ''}`.trim() : '');
    if (fast.pmiMonths > 0) {
      set('pmiend', monthFmt.format(monthOf(fast.pmiMonths + 1, start)), `${usd(fast.totalPMI)} paid in total`);
    } else {
      set('pmiend', 'None', !(d.loan > 0) ? '' : d.downPct >= 20 ? 'at least 20% down' : 'no PMI rate entered');
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
    $('chart-note').textContent = d.loan > 0 ? (d.inProgress ? `${termWord(d.months)} left` : `${d.years}-year term`) : '';
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

    /* A loan already under way: mark the current month, so the viewer can
       see where on the curves they stand. Read from the device clock at
       draw time, never baked in. */
    const now = new Date();
    const nowN = (now.getFullYear() - start.getFullYear()) * 12 + (now.getMonth() - start.getMonth()) + 1;
    if (nowN > 1 && nowN <= N) {
      const x = X(nowN);
      svg.append(svgEl('line', { class: 'today', x1: x, x2: x, y1: m.t, y2: m.t + ih }));
      const flip = x > W - m.r - 48;
      const t = svgEl('text', { class: 'today-label', x: x + (flip ? -5 : 5), y: m.t + 11, 'text-anchor': flip ? 'end' : 'start' });
      t.textContent = 'Today';
      svg.append(t);
    }

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
