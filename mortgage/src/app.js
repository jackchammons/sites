/* Mortgage Calculator — the live half of the page.
 *
 * Reads the form, runs src/mortgage.js (the same module the tests and the
 * deploy gate use), and writes every figure, the balance chart and the
 * schedule. State round-trips through the URL hash so a set of numbers can
 * be shared; the hash never reaches a server. How a typed number, a typed
 * month and that hash are read lives in src/inputs.js, tested the same way.
 */
import { describe, amortize, monthlyBreakdown, byYear, originalLoan } from './mortgage.js';
import { parseAmount, parseMonth, convertUnit, downFromPct, downPctOf, defaultState, encodeState, decodeState } from './inputs.js';

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
    years: $('in-years'), start: $('in-start'), balance: $('in-balance'), maturity: $('in-maturity'), next: $('in-next'), tax: $('in-tax'), ins: $('in-ins'),
    hoa: $('in-hoa'), pmi: $('in-pmi'), extra: $('in-extra'), every: $('in-every'),
    taxUnit: $('in-tax-unit'), insUnit: $('in-ins-unit'), escrow: $('in-escrow'), escrowUnit: $('in-escrow-unit'),
  };
  const TYPED = [els.price, els.down, els.downpct, els.balance, els.rate, els.start, els.maturity, els.next,
    els.tax, els.ins, els.escrow, els.hoa, els.pmi, els.extra];
  // What a share link may ask for: the options the two selects offer.
  const optionsOf = sel => [...sel.options].map(o => +o.value);
  const CHOICES = { terms: optionsOf(els.years), cadences: optionsOf(els.every) };

  /* Reading a field. Dollar fields take "750.000" as thousands; a rate or a
     percentage never does (6.125 is a rate). Property tax is whichever its
     unit says. */
  const MONEY = new Set([els.price, els.down, els.balance, els.ins, els.escrow, els.hoa, els.extra]);
  const UNIT_SELECT = new Map([[els.tax, els.taxUnit], [els.ins, els.insUnit], [els.escrow, els.escrowUnit]]);
  // The unit the number beside each select is in; it trails the select for
  // the moment between the viewer picking a unit and the number converting.
  const unit = new Map();
  const isMoney = el => el === els.tax ? unit.get(els.taxUnit) !== 'pct' : MONEY.has(el);
  /* A figure the page works out for a field (a unit conversion, a value from
     a link) is shown rounded, to cents or to six decimals of a percentage,
     and kept exact here for as long as the text is the text the page wrote,
     so the monthly figure does not move by a cent until the viewer edits it. */
  const exact = new Map();
  const num = el => {
    const kept = exact.get(el);
    if (kept && kept.text === el.value) return kept.value;
    return parseAmount(el.value, { money: isMoney(el) });
  };
  const put = (el, value) => {
    const text = String(+value.toFixed(unit.get(UNIT_SELECT.get(el)) === 'pct' ? 6 : 2));
    el.value = text;
    if (+text === value) exact.delete(el); else exact.set(el, { text, value });
  };

  const nextMonth = () => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth() + 1, 1);
  };
  const ym = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  const monthFrom = el => {
    const m = parseMonth(el.value);
    return m ? new Date(+m.slice(0, 4), +m.slice(5) - 1, 1) : null;
  };
  const monthsBetween = (a, b) => (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
  const monthOf = (n, start) => new Date(start.getFullYear(), start.getMonth() + n - 1, 1);
  // Where the month is a text box, tidy what was typed ("3/2025") into the
  // form the page writes itself once the viewer leaves the field.
  for (const el of [els.start, els.maturity, els.next]) {
    el.addEventListener('change', () => {
      const m = parseMonth(el.value);
      if (m && el.value !== m) el.value = m;
    });
  }

  /* ---- state <-> form <-> hash ------------------------------------- */
  let escrowMode = false;
  let progressMode = false;
  // Which of the two down-payment fields the viewer typed last: 'pct' or 'usd'.
  let downBy = 'pct';

  /* Dollar fields are written with put(), never as the bare number: a link
     can carry 85.125, and those digits in a money field would read back as
     eighty-five thousand. */
  function fill(st) {
    exact.clear();
    put(els.price, st.price);
    downBy = st.down != null ? 'usd' : 'pct';
    if (downBy === 'usd') {
      put(els.down, st.down);
      els.downpct.value = downPctOf(st.down, st.price);
    } else {
      els.downpct.value = st.downPct;
      els.down.value = downFromPct(st.price, st.downPct);
    }
    els.rate.value = st.rate;
    els.years.value = String(st.years);
    for (const [el, u, x] of [[els.tax, st.taxUnit, st.taxRate], [els.ins, st.insUnit, st.insurance], [els.escrow, st.escrowUnit, st.escrow ?? 0]]) {
      UNIT_SELECT.get(el).value = u;
      unit.set(UNIT_SELECT.get(el), u);
      put(el, x);
    }
    put(els.hoa, st.hoa);
    els.pmi.value = st.pmiRate;
    put(els.extra, st.extra);
    els.every.value = String(st.extraEvery);
    els.start.value = st.start;
    if (st.balance == null) els.balance.value = ''; else put(els.balance, st.balance);
    els.next.value = st.next;
    syncMaturity();
    setLoanMode(!!st.progressMode);
    // After the loan mode, which decides what a tax percentage is taken of.
    setMode(!!st.escrowMode, st.escrow == null);
  }

  const fromDefaults = () => defaultState(DEFAULTS, ym(nextMonth()));
  const fromHash = () => decodeState(location.hash, DEFAULTS, ym(nextMonth()), CHOICES);

  /* The form as a state. A field that does not read as a number is NaN and
     a month that does not read is null; the link leaves both out. */
  function formState() {
    const month = el => parseMonth(el.value);
    return {
      price: num(els.price),
      down: downBy === 'usd' ? num(els.down) : null,
      downPct: downBy === 'pct' ? num(els.downpct) : null,
      balance: num(els.balance), rate: num(els.rate), years: +els.years.value,
      start: month(els.start), next: month(els.next),
      taxRate: num(els.tax), taxUnit: els.taxUnit.value,
      insurance: num(els.ins), insUnit: els.insUnit.value,
      escrow: num(els.escrow), escrowUnit: els.escrowUnit.value, escrowMode,
      hoa: num(els.hoa), pmiRate: num(els.pmi), extra: num(els.extra), extraEvery: +els.every.value,
      progressMode,
    };
  }

  function writeHash() {
    const q = encodeState(formState(), DEFAULTS, ym(nextMonth()));
    history.replaceState(null, '', q ? '#' + q : location.pathname + location.search);
  }

  /* ---- down payment: $ and % stay in step --------------------------- */
  /* Whichever of the two the viewer typed is the fact and the other follows
     it. A typed percentage sets the dollars, rounded up so 20% is never a
     dollar short of 20%; typed dollars set the percentage and are never
     rewritten from it, since the percentage is only shown to two places. */
  els.down.addEventListener('input', () => {
    downBy = 'usd';
    const p = num(els.price), d = num(els.down);
    if (Number.isFinite(p) && Number.isFinite(d)) els.downpct.value = downPctOf(d, p);
  });
  els.downpct.addEventListener('input', () => {
    downBy = 'pct';
    const p = num(els.price), pc = num(els.downpct);
    if (pc > 100) els.downpct.value = 100;
    if (Number.isFinite(p) && Number.isFinite(pc)) els.down.value = downFromPct(p, pc);
  });
  els.price.addEventListener('input', () => {
    const p = num(els.price), d = num(els.down), pc = num(els.downpct);
    if (!Number.isFinite(p)) return;
    if (downBy === 'pct') { if (Number.isFinite(pc)) els.down.value = downFromPct(p, pc); }
    else if (Number.isFinite(d)) els.downpct.value = downPctOf(d, p);
  });

  /* ---- render ------------------------------------------------------- */
  let view = 'year';
  let last = null;

  const nameOf = el => el.closest('.field').querySelector('.lbl').textContent;
  // What describes each field when nothing is wrong with it, as built.
  const ABOUT = new Map(TYPED.map(el => [el, el.getAttribute('aria-describedby') || '']));

  /* Reads the form. `problems` lists every field in use that cannot be
     read, each named; with any problem there is no loan description at all,
     so nothing downstream can be computed from a stand-in value. */
  function read() {
    const problems = new Map();
    const flag = (el, what) => { if (!problems.has(el)) problems.set(el, { name: nameOf(el), text: `${nameOf(el)}: ${what}` }); };
    const val = el => {
      const x = num(el);
      if (!Number.isFinite(x)) flag(el, 'enter a number.');
      return x;
    };
    const month = el => {
      const d = monthFrom(el);
      if (!d) flag(el, 'enter a month as YYYY-MM.');
      return d;
    };

    const rate = val(els.rate);
    if (rate > 30) flag(els.rate, 'enter 30 or less.');
    let loan, start, inf = null;
    if (progressMode) {
      const balance = val(els.balance), first = month(els.start);
      month(els.maturity);
      start = month(els.next);
      inf = inferred(balance, rate, first, start);
      if (inf.paid < 0) flag(els.next, 'it is before the first payment.');
      else if (inf.paid >= inf.n) flag(els.next, 'it is after the last payment; check the dates and the term.');
      else if (!inf.ok && !problems.size) flag(els.balance, 'the loan amount cannot be worked out from it.');
      loan = { price: inf.price, balance, months: inf.left };
    } else {
      loan = { price: val(els.price), down: val(els.down), years: +els.years.value };
      val(els.downpct);
      start = month(els.start);
    }
    const input = {
      rate, ...loan,
      // Tax and insurance arrive in whatever unit the picker says; the
      // maths takes dollars per year (or a tax rate, when that is the unit).
      ...taxAndInsurance(val),
      hoa: val(els.hoa), pmiRate: val(els.pmi), extra: val(els.extra),
      extraEvery: +els.every.value,
    };

    for (const el of TYPED) {
      const bad = problems.has(el);
      el.closest('.field').classList.toggle('invalid', bad);
      if (bad) el.setAttribute('aria-invalid', 'true'); else el.removeAttribute('aria-invalid');
      // The message is in the headline's sub-line; an invalid field points at it.
      const about = [ABOUT.get(el), bad && 'out-sub'].filter(Boolean).join(' ');
      if (about) el.setAttribute('aria-describedby', about); else el.removeAttribute('aria-describedby');
    }
    if (inf) {
      $('inferred').classList.toggle('invalid', !inf.ok);
      $('inf-price').textContent = inf.ok ? usd(inf.price) : '—';
      $('inf-note').textContent = inf.ok
        ? `original loan amount, with ${inf.paid} of ${inf.n} payments made; tax and PMI are measured against it`
        : inf.paid < 0 ? 'The next payment is before the first.'
        : inf.paid >= inf.n ? 'The next payment is after the last one — check the dates and term.'
        : 'Enter the balance and dates.';
    }
    return { d: problems.size ? null : describe(input), problems: [...problems.values()], inf, start };
  }

  /* First and last payment are two views of one fact, given the term:
     editing either rewrites the other. */
  function syncMaturity(fromMaturity = false) {
    const n = +els.years.value * 12;
    if (fromMaturity) {
      const mt = monthFrom(els.maturity);
      if (mt) els.start.value = ym(new Date(mt.getFullYear(), mt.getMonth() - n + 1, 1));
    } else {
      const s0 = monthFrom(els.start);
      if (s0) els.maturity.value = ym(new Date(s0.getFullYear(), s0.getMonth() + n - 1, 1));
    }
  }
  els.maturity.addEventListener('input', () => syncMaturity(true));
  els.start.addEventListener('input', () => syncMaturity());
  els.years.addEventListener('input', () => syncMaturity());

  /* A loan under way: the balance, the term and how far along the loan is
     give back the original principal, which stands in for the home price
     wherever one is needed. Assumes payments have been exactly on schedule.
     `first` and `next` are the two payment months, or null when unreadable. */
  function inferred(balance, rate, first, next) {
    const n = +els.years.value * 12;
    const paid = first && next ? monthsBetween(first, next) : NaN;
    const loan = originalLoan(balance, rate, n, paid);
    return { ok: Number.isFinite(loan), n, paid, left: n - paid, loan, price: loan };
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
    $('in-tax-hint').textContent = progress ? '% is of the loan amount' : '% is of the price';
    $('in-pmi-hint').textContent = progress ? 'Charged while over 80% of the loan amount; 0 if none' : 'Charged under 20% down; 0 if none';
    $('mode-new').setAttribute('aria-pressed', String(!progress));
    $('mode-progress').setAttribute('aria-pressed', String(progress));
    if (progress) {
      if (!(num(els.balance) >= 0)) {
        const p = num(els.price) || 0, dn = num(els.down) || 0;
        els.balance.value = Math.max(0, Math.round(p - dn));
      }
      if (!monthFrom(els.next)) els.next.value = ym(nextMonth());
      syncMaturity();
    }
  }
  $('mode-new').addEventListener('click', () => { setLoanMode(false); render(); writeHash(); });
  $('mode-progress').addEventListener('click', () => { setLoanMode(true); render(); writeHash(); });

  const perYear = (x, u) => u === 'mo' ? x * 12 : x;
  function taxAndInsurance(val) {
    if (escrowMode) {
      return { escrow: perYear(val(els.escrow), unit.get(els.escrowUnit)) };
    }
    const t = val(els.tax), tu = unit.get(els.taxUnit);
    return {
      ...(tu === 'pct' ? { taxRate: t } : { tax: perYear(t, tu) }),
      insurance: perYear(val(els.ins), unit.get(els.insUnit)),
    };
  }
  // What a tax percentage is a percentage of: the price, or for a loan under
  // way the inferred loan that stands in for it.
  const taxBase = () => progressMode
    ? inferred(num(els.balance), num(els.rate), monthFrom(els.start), monthFrom(els.next)).price
    : num(els.price);

  /* Picking another unit restates the same cost in it (0.92% of the price
     becomes 6900 a year, 1800 a year becomes 150 a month), so the bill does
     not change until the viewer types a different number. A field that
     cannot be read, or a percentage of no price, is left as typed. */
  for (const [el, sel] of UNIT_SELECT) {
    sel.addEventListener('input', () => {
      const converted = convertUnit(num(el), unit.get(sel), sel.value, taxBase());
      unit.set(sel, sel.value);
      if (Number.isFinite(converted)) put(el, converted);
    });
  }

  /* Switching to escrow with nothing entered seeds it from the split
     figures, so the total does not drop to nothing. `seed` is the caller's
     call: a click seeds over an empty or zero amount, a link only when it
     carried none, so an escrow of 0 in a link stays 0. */
  function setMode(escrow, seed = false) {
    escrowMode = escrow;
    $('split-fields').hidden = escrow;
    $('escrow-fields').hidden = !escrow;
    $('mode-split').setAttribute('aria-pressed', String(!escrow));
    $('mode-escrow').setAttribute('aria-pressed', String(escrow));
    if (escrow && seed) {
      const t = num(els.tax) || 0, i = num(els.ins) || 0, tu = unit.get(els.taxUnit);
      const tax = tu === 'pct' ? (taxBase() || 0) * t / 100 : perYear(t, tu);
      const yearly = tax + perYear(i, unit.get(els.insUnit));
      put(els.escrow, Math.round(unit.get(els.escrowUnit) === 'mo' ? yearly / 12 : yearly));
    }
  }
  $('mode-split').addEventListener('click', () => { setMode(false); render(); writeHash(); });
  $('mode-escrow').addEventListener('click', () => { setMode(true, !(num(els.escrow) > 0)); render(); writeHash(); });

  const cadenceWord = e => ({ 0: 'once', 1: 'each month', 3: 'each quarter', 6: 'twice a year', 12: 'each year' })[e] || `every ${e} months`;

  const PARTS = ['pi', 'tax', 'insurance', 'escrow', 'pmi', 'hoa'];
  const FACTS = ['loan', 'interest', 'cost', 'payoff', 'extra', 'saved'];
  const setFact = (k, main, sub = '') => { $('sum-' + k).textContent = main; $('sub-' + k).textContent = sub; };
  // The rows for the mode not in use are hidden rather than shown at $0.
  const partHidden = k => k === 'escrow' ? !escrowMode : (k === 'tax' || k === 'insurance') && escrowMode;
  const listOf = names => names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0];

  /* A field that cannot be read leaves nothing to compute: every figure is
     dashed and the chart and schedule give way to a line saying why, so no
     number on the page comes from a value the viewer did not type. */
  function renderInvalid(problems) {
    last = null;
    $('out-total').textContent = '—';
    $('out-sub').textContent = problems[0].text
      + (problems.length > 1 ? ` Also check ${listOf(problems.slice(1).map(p => p.name))}.` : '');
    for (const k of PARTS) {
      $('bd-' + k).textContent = '—';
      $('row-' + k).classList.remove('zero');
      $('row-' + k).hidden = partHidden(k);
      $('seg-' + k).hidden = true;
    }
    for (const k of FACTS) setFact(k, '—');
    $('fact-extra').classList.add('muted');
    $('fact-saved').classList.add('muted');
    $('chart-note').textContent = '';
    $('chart-legend').textContent = '';
    $('tip').hidden = true;
    $('chart').innerHTML = '<p class="empty">No chart until the highlighted field is fixed.</p>';
    $('schedule').innerHTML = '<tr><td colspan="6" class="empty">No schedule until the highlighted field is fixed.</td></tr>';
  }

  function render() {
    const { d, problems, inf, start } = read();
    if (!d) { renderInvalid(problems); return; }
    const base = amortize(d, { extra: 0 });
    const fast = d.extra > 0 ? amortize(d) : base;
    /* What the chart draws. A new loan: the schedule as is. A loan under
       way: the whole original term, with the elapsed payments reconstructed
       on schedule from the inferred original loan and the rest being the
       real schedule from today's balance, so the two halves meet at the
       balance the viewer typed. */
    let chart = { start, loan0: d.loan, baseRows: base.rows, fastRows: fast.rows, note: d.loan > 0 ? `${d.years}-year term` : '' };
    if (d.inProgress && inf.paid > 0) {
      const hist = amortize(describe({ price: inf.loan, down: 0, rate: d.rate, months: inf.n }), { extra: 0 }).rows.slice(0, inf.paid);
      const shift = rows => rows.map(r => ({ ...r, n: r.n + inf.paid }));
      chart = {
        start: monthFrom(els.start), loan0: inf.loan, hist,
        baseRows: hist.concat(shift(base.rows)), fastRows: hist.concat(shift(fast.rows)),
        note: `${termWord(inf.n)} term, ${termWord(d.months)} left`,
      };
    } else if (d.inProgress) {
      chart.note = d.loan > 0 ? `${termWord(d.months)} left` : '';
    }
    const bd = monthlyBreakdown(d);
    const total = bd.pi + bd.tax + bd.insurance + bd.escrow + bd.pmi + bd.hoa;
    last = { d, base, fast, start, chart };

    $('out-total').textContent = usd(total);
    $('out-sub').textContent = d.extra > 0
      ? d.extraEvery === 1
        ? `plus ${usd(d.extra)} extra principal, ${usd(total + d.extra)} in all`
        : `plus ${usd(d.extra)} extra principal ${cadenceWord(d.extraEvery)}`
      : d.loan > 0
        ? d.inProgress ? `on a ${usd(d.loan)} balance, ${termWord(d.months)} to go` : `on a ${usd(d.loan)} loan over ${d.years} years`
        : 'Nothing borrowed, so nothing to repay.';

    for (const k of PARTS) {
      const x = bd[k];
      $('bd-' + k).textContent = usd2(x);
      $('row-' + k).classList.toggle('zero', x <= 0);
      $('row-' + k).hidden = partHidden(k);
      const seg = $('seg-' + k);
      seg.style.flexGrow = total > 0 ? String(x / total) : '0';
      seg.hidden = x <= 0;
      seg.title = `${$('row-' + k).querySelector('.nm').textContent}: ${usd2(x)}`;
    }

    const payoff = fast.months ? monthOf(fast.months, start) : null;
    const set = setFact;
    /* A loan under way has two horizons: the whole loan, first payment to
       last (the reconstructed history plus what is ahead), and what is
       still to pay from today. The headline is the whole loan; the line
       beneath carries the remainder. */
    const hist = chart.hist || [];
    const sumOf = (rows, key) => rows.reduce((t, r) => t + key(r), 0);
    const life = hist.length ? {
      interest: sumOf(hist, r => r.interest) + fast.totalInterest,
      pmi: sumOf(hist, r => r.pmi) + fast.totalPMI,
    } : null;
    set('loan', usd(d.loan), d.inProgress
      ? (life ? `balance today, ${plain.format(+(d.loan / chart.loan0 * 100).toFixed(1))}% of the ${usd(chart.loan0)} loan` : d.price > 0 ? `${plain.format(+(d.loan / d.price * 100).toFixed(1))}% of the original loan` : '')
      : `${plain.format(+d.downPct.toFixed(1))}% down`);
    if (life) {
      set('interest', usd(life.interest), `whole loan · ${usd(fast.totalInterest)} still to pay`);
      set('cost', usd(chart.loan0 + life.interest + life.pmi), `whole loan · ${usd(d.loan + fast.totalInterest + fast.totalPMI)} still to pay`);
    } else {
      set('interest', usd(fast.totalInterest),
        d.loan > 0 ? `${plain.format(+(fast.totalInterest / d.loan * 100).toFixed(0))}% of the loan` : '');
      set('cost', d.loan + fast.totalInterest + fast.totalPMI ? usd(d.loan + fast.totalInterest + fast.totalPMI) : usd(0), 'principal, interest and PMI');
    }
    set('payoff', payoff ? monthFmt.format(payoff) : '—',
      fast.months ? `${Math.floor(fast.months / 12)} yr ${fast.months % 12 ? (fast.months % 12) + ' mo' : ''}`.trim() : '');
    $('fact-extra').classList.toggle('muted', !(d.extra > 0));
    $('fact-saved').classList.toggle('muted', !(d.extra > 0));
    if (d.extra > 0) {
      const paidExtra = fast.rows.reduce((t, r) => t + r.extra, 0);
      const times = fast.rows.filter(r => r.extra > 0).length;
      set('extra', usd(paidExtra), d.extraEvery === 0 ? 'one payment' : `${usd(d.extra)} ${cadenceWord(d.extraEvery).replace(/^each /, 'every ')}, ${times} times`);
    } else {
      set('extra', '—', 'add an amount to see it');
    }
    if (d.extra > 0) {
      const mo = base.months - fast.months;
      const costOf = sch => sch.totalInterest + sch.totalPMI;
      // The figure is the equation, spelled out: what the loan costs in
      // interest (and PMI) on schedule, less what it costs with the extra.
      set('saved', usd(costOf(base) - costOf(fast)),
        `${usd(costOf(base))} interest${base.totalPMI > 0 ? ' + PMI' : ''} on schedule − ${usd(costOf(fast))} with extra; paid off ${Math.floor(mo / 12)} yr ${mo % 12} mo sooner`);
    } else {
      set('saved', '—', 'add an amount to see it');
    }

    drawCharts();
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

  /* ---- charts ------------------------------------------------------- */
  /* Which lines are switched off, per chart, remembered per viewer. */
  const hiddenLines = key => {
    try { return new Set(JSON.parse(localStorage.getItem('mortgage.hide.' + key) || '[]')); } catch { return new Set(); }
  };
  const rememberHidden = (key, set) => {
    try { localStorage.setItem('mortgage.hide.' + key, JSON.stringify([...set])); } catch {}
  };

  /* The chart: a legend of toggles, the grid, the lines, the Today rule
     and a crosshair tooltip. Two y axes — balances and running totals on
     the left (solid lines), each payment's parts on the right (dashed),
     because a $600,000 balance and a $3,000 payment cannot share a scale.
     `series` is [{ id, cls, label, axis, at(n), from? }] with n the payment
     number (0 = before the first); each axis fits the lines switched on. */
  const AXES = [
    { side: 'left', cap: '◀ left axis: balance & totals', title: 'balance & totals' },
    { side: 'right', cap: 'right axis: each payment ▶', title: 'per payment' },
  ];
  // Puts away whatever tooltip the chart on screen is showing.
  let clearTip = () => {};
  function drawLineChart({ key, host, legend, tip, start, N, series, ariaLabel }) {
    host.textContent = '';
    tip.hidden = true;
    const hidden = hiddenLines(key);
    legend.textContent = '';
    for (const ax of AXES) {
      const group = series.filter(sr => sr.axis === ax.side);
      if (!group.length) continue;
      if (ax.side === 'right') legend.insertAdjacentHTML('beforeend', '<li class="gap" aria-hidden="true"></li>');
      legend.insertAdjacentHTML('beforeend', `<li class="axis-cap">${ax.cap}</li>`);
      for (const sr of group) {
        const li = document.createElement('li');
        const btn = document.createElement('button');
        btn.type = 'button'; btn.className = `${sr.cls}${ax.side === 'right' ? ' dashed' : ''}`;
        btn.setAttribute('aria-pressed', String(!hidden.has(sr.id)));
        btn.innerHTML = `<span class="sw"></span>${sr.label}`;
        btn.dataset.series = sr.id;
        btn.addEventListener('click', () => {
          if (hidden.has(sr.id)) hidden.delete(sr.id); else hidden.add(sr.id);
          rememberHidden(key, hidden);
          drawCharts();
          // The redraw rebuilt the legend, this button included; focus goes
          // to its replacement so a keyboard user stays where they were.
          legend.querySelector(`button[data-series="${sr.id}"]`)?.focus();
        });
        li.append(btn); legend.append(li);
      }
    }
    const shown = series.filter(sr => !hidden.has(sr.id));
    const onLeft = shown.filter(sr => sr.axis === 'left'), onRight = shown.filter(sr => sr.axis === 'right');

    const W = Math.max(300, host.clientWidth || 640), H = W < 520 ? 230 : 290;
    const topOf = group => { let t = 0; for (const sr of group) for (let n = 0; n <= N; n++) t = Math.max(t, sr.at(n)); return t; };
    const yMaxL = niceMax(topOf(onLeft)), yMaxR = niceMax(topOf(onRight));
    const labelsL = [0, 1, 2, 3, 4].map(i => compact.format(yMaxL * i / 4));
    const labelsR = [0, 1, 2, 3, 4].map(i => compact.format(yMaxR * i / 4));
    // Size each gutter to its widest tick label: locales differ a lot here
    // ("$600K" vs "600.000 $"), and a fixed gutter clipped the long ones.
    const gutter = labels => 14 + 6.8 * Math.max(...labels.map(l => l.length));
    const m = { t: W < 520 ? 14 : 26, b: 28, l: onLeft.length ? gutter(labelsL) : 18, r: onRight.length ? gutter(labelsR) : 18 };
    const iw = W - m.l - m.r, ih = H - m.t - m.b;
    const X = n => m.l + n / N * iw;
    const YL = v => m.t + ih - v / yMaxL * ih, YR = v => m.t + ih - v / yMaxR * ih;
    const Y = sr => (sr.axis === 'right' ? YR : YL);
    const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: 'img', 'aria-label': ariaLabel });

    const g = svgEl('g', { class: 'grid' });
    for (let i = 0; i <= 4; i++) {
      const y = m.t + ih - ih * i / 4;
      g.append(svgEl('line', { x1: m.l, x2: W - m.r, y1: y, y2: y }));
      if (onLeft.length) {
        const t = svgEl('text', { x: m.l - 8, y: y + 4, 'text-anchor': 'end' });
        t.textContent = labelsL[i];
        g.append(t);
      }
      if (onRight.length) {
        const t = svgEl('text', { x: W - m.r + 8, y: y + 4, 'text-anchor': 'start' });
        t.textContent = labelsR[i];
        g.append(t);
      }
    }
    // Axis titles only where there is room; narrow screens rely on the
    // legend captions, which say the same thing.
    for (const ax of (W < 520 ? [] : AXES)) {
      const group = ax.side === 'left' ? onLeft : onRight;
      if (!group.length) continue;
      const t = svgEl('text', { class: 'axis-title', x: ax.side === 'left' ? m.l - 8 : W - m.r + 8, y: m.t - 10,
        'text-anchor': ax.side === 'left' ? 'start' : 'end' });
      t.textContent = ax.title;
      t.setAttribute('x', ax.side === 'left' ? m.l : W - m.r);
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

    /* A loan already under way: a dashed rule marks the current month, so
       the viewer can see where on the curves they stand. Read from the
       device clock at draw time, never baked in. */
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

    for (const sr of shown) {
      const pts = [], y = Y(sr);
      // Running figures start before the first payment; per-payment ones at it.
      for (let n = sr.from || 0; n <= N; n++) pts.push(`${X(n).toFixed(1)},${y(sr.at(n)).toFixed(1)}`);
      svg.append(svgEl('path', { d: 'M' + pts.join('L'), class: `line ${sr.cls}${sr.axis === 'right' ? ' dashed' : ''}` }));
    }
    if (!shown.length) {
      const t = svgEl('text', { class: 'empty-lines', x: m.l + iw / 2, y: m.t + ih / 2, 'text-anchor': 'middle' });
      t.textContent = 'Every line is switched off — click one in the legend.';
      svg.append(t);
    }

    const cross = svgEl('line', { class: 'cross', y1: m.t, y2: m.t + ih, x1: -10, x2: -10 });
    svg.append(cross);
    for (const sr of shown) {
      sr.dot = svgEl('circle', { class: `dot ${sr.cls}`, r: 4.5, cx: -10, cy: -10 });
      svg.append(sr.dot);
    }
    const hit = svgEl('rect', { x: m.l, y: m.t, width: iw, height: ih, class: 'hit' });
    svg.append(hit);
    host.append(svg);

    const move = ev => {
      const rect = svg.getBoundingClientRect();
      const px = (ev.clientX - rect.left) * (W / rect.width);
      const n = Math.max(1, Math.min(N, Math.round((px - m.l) / iw * N)));
      const x = X(n);
      cross.setAttribute('x1', x); cross.setAttribute('x2', x);
      for (const sr of shown) { sr.dot.setAttribute('cx', x); sr.dot.setAttribute('cy', Y(sr)(sr.at(n))); }
      const row = sr => `<div class="tr ${sr.cls}${sr.axis === 'right' ? ' dashed' : ''}"><span class="sw"></span>${sr.label}<em>${usd2(sr.at(n))}${sr.axis === 'right' ? '<small>/mo</small>' : ''}</em></div>`;
      tip.innerHTML = `<b>${monthFmt.format(monthOf(n, start))}</b> · payment ${n}` + shown.map(row).join('');
      tip.hidden = false;
      const box = host.getBoundingClientRect();
      const left = (x / W) * box.width;
      const tw = tip.offsetWidth;
      tip.style.left = Math.max(0, Math.min(box.width - tw, left + (left > box.width / 2 ? -tw - 14 : 14))) + 'px';
      tip.style.top = (host.offsetTop + 8) + 'px';
    };
    clearTip = () => {
      tip.hidden = true;
      cross.setAttribute('x1', -10); cross.setAttribute('x2', -10);
      for (const sr of shown) sr.dot.setAttribute('cx', -10);
    };
    /* A mouse takes the tooltip with it when it leaves. A finger lifting is
       also a leave, and would take the reading away the moment it appeared,
       so after a touch it stays until a tap elsewhere. It stays too where
       the tooltip sits under the chart instead of over it (narrow screens):
       nothing is covered there, and removing it would make the page jump. */
    const leave = ev => {
      if (ev.pointerType === 'touch' || getComputedStyle(tip).position === 'static') return;
      clearTip();
    };
    hit.addEventListener('pointermove', move);
    hit.addEventListener('pointerdown', move);
    hit.addEventListener('pointerleave', leave);
  }
  document.addEventListener('pointerdown', ev => { if (!$('chart').contains(ev.target)) clearTip(); });

  // The container width the chart on screen was drawn to.
  let drawnAt = 0;
  function drawCharts() {
    const { d, chart } = last;
    const { start, loan0, baseRows, fastRows } = chart;
    drawnAt = $('chart').clientWidth;
    const withExtra = d.extra > 0;
    $('chart-note').textContent = chart.note;
    if (!(loan0 > 0) || !baseRows.length) {
      $('chart').innerHTML = '<p class="empty">Nothing borrowed — nothing to chart.</p>';
      $('chart-legend').textContent = '';
      return;
    }
    const N = baseRows.length;
    const running = (rows, key) => { let c = 0; return rows.map(r => (c += key(r))); };
    const cumP = running(fastRows, r => r.principal + r.extra);
    const cumI = running(fastRows, r => r.interest);
    const cumX = running(fastRows, r => r.extra);
    /* Balance series fall to zero after payoff; running totals hold their
       final value; per-payment figures are zero once nothing is owed. */
    const balAt = rows => n => n <= 0 ? loan0 : n > rows.length ? 0 : rows[n - 1].balance;
    const sumAt = arr => n => n <= 0 ? 0 : arr[Math.min(n, arr.length) - 1];
    const rowAt = (rows, key) => n => n <= 0 || n > rows.length ? 0 : key(rows[n - 1]);
    const tag = withExtra ? ' (with extra)' : '';

    drawLineChart({
      key: 'totals', host: $('chart'), legend: $('chart-legend'), tip: $('tip'), start, N,
      ariaLabel: 'Loan balance, principal and interest paid so far, and each payment\'s split, over time',
      series: [
        { id: 'balance', axis: 'left', cls: 's1', label: withExtra ? 'Balance on schedule' : 'Balance', at: balAt(baseRows) },
        withExtra && { id: 'balance-extra', axis: 'left', cls: 's2', label: 'Balance with extra principal', at: balAt(fastRows) },
        { id: 'principal', axis: 'left', cls: 's3', label: `Principal paid so far${tag}`, at: sumAt(cumP) },
        { id: 'interest', axis: 'left', cls: 's4', label: `Interest paid so far${tag}`, at: sumAt(cumI) },
        withExtra && { id: 'extra', axis: 'left', cls: 's6', label: 'Extra principal paid so far', at: sumAt(cumX) },
        { id: 'm-interest', axis: 'right', cls: 's4', label: 'Interest in the payment', from: 1, at: rowAt(fastRows, r => r.interest) },
        { id: 'm-principal', axis: 'right', cls: 's3', label: 'Principal in the payment', from: 1, at: rowAt(fastRows, r => r.principal) },
      ].filter(Boolean),
    });
  }

  /* ---- schedule table ----------------------------------------------- */
  function drawTable() {
    const { fast, start } = last;
    const body = $('schedule');
    $('th-period').textContent = view === 'year' ? 'Year' : 'Month';
    const rows = view === 'year' ? byYear(fast.rows) : fast.rows;
    // Extra and PMI are blank for most loans; a column with nothing in it is
    // dropped, which is what leaves Balance on a phone's screen.
    const table = body.closest('table');
    table.classList.toggle('no-extra', !rows.some(r => r.extra > 0));
    table.classList.toggle('no-pmi', !rows.some(r => r.pmi > 0));
    if (!rows.length) {
      body.innerHTML = '<tr><td colspan="6" class="empty">No payments — nothing is borrowed.</td></tr>';
      return;
    }
    const f = x => x > 0 ? usd(x) : '<span class="nil">—</span>';
    body.innerHTML = rows.map(r => {
      const label = view === 'year'
        ? `${r.year} <small><span class="wide">from </span>${monthFmt.format(monthOf((r.year - 1) * 12 + 1, start))}</small>`
        : `${r.n} <small>${monthFmt.format(monthOf(r.n, start))}</small>`;
      return `<tr><th scope="row">${label}</th><td>${f(r.principal)}</td><td>${f(r.interest)}</td><td>${f(r.extra)}</td><td>${f(r.pmi)}</td><td>${usd(r.balance)}</td></tr>`;
    }).join('');
  }

  for (const [id, v] of [['view-year', 'year'], ['view-month', 'month']]) {
    $(id).addEventListener('click', () => {
      view = v;
      $('view-year').setAttribute('aria-pressed', String(v === 'year'));
      $('view-month').setAttribute('aria-pressed', String(v === 'month'));
      if (last) drawTable();
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
  window.addEventListener('hashchange', () => { fill(fromHash()); render(); });
  /* The chart is drawn to its container's width, so only a change of width
     needs a redraw. A phone fires resize as its address bar slides away on
     scroll, and a redraw then would take the tooltip the viewer just opened. */
  let rw = 0;
  window.addEventListener('resize', () => {
    clearTimeout(rw);
    rw = setTimeout(() => { if (last && $('chart').clientWidth !== drawnAt) drawCharts(); }, 120);
  });

  fill(fromHash());
  render();
  document.documentElement.classList.add('ready');
}
