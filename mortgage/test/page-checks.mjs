/* What the page must show for a loan, checked against a snapshot of it.
 *
 * test/page.test.mjs runs the built app.js in Node against a stand-in DOM and
 * feeds its snapshots through here. The checks are kept apart from that
 * runner, and take plain data, so the same loans and expectations can be put
 * to the page in a real browser without a second copy of them.
 *
 * Every figure is parsed back from what the page printed and compared with a
 * computation made here from the link's own keys: the arithmetic of the bill
 * directly, the schedules through src/mortgage.js. On top of that a set of
 * rules is checked that must hold whatever the inputs: the monthly total is
 * the sum of the rows shown, a whole-loan figure is the history plus what is
 * still to pay, the schedule adds up to the summary, the chart meets the
 * typed balance at today, "saves" is the difference it spells out.
 *
 * A loan here is the hash keys it is written with (see HASH_KEYS in
 * src/inputs.js), every one present, as links written before default-valued
 * keys were left out carried them:
 *   lm 0: p, d or dp, r, y, s            lm 1: b, r, y, s, nx, and op when a price is given
 *   both: t tu i iu, w wu em, h, m, x e
 *
 * A snapshot is plain data, however the runner collects it:
 *   boot                 the boot-error note is hidden
 *   total, sub           the headline figure and the line under it
 *   parts[k]             { text, hidden } for each row of the breakdown
 *   facts[k]             { main, sub } for each summary slot
 *   fields[id]           the text in each form field and the value of each select
 *   shown[id]            whether each mode-dependent block is visible
 *   invalid              ids of the fields marked invalid
 *   inferred             { loan, note } of the inferred-loan box
 *   hints                { tax, pmi }
 *   chartNote, chart     the chart's caption, and whether a chart was drawn
 *   tip                  the tooltip's text at payment todayPayment(st)
 *   schedule             table rows, each an array of cell texts
 *   noExtra, noPmi       whether the schedule dropped those columns
 *   hash                 location.hash
 */
import * as m from '../src/mortgage.js';

export const PARTS = ['pi', 'tax', 'insurance', 'escrow', 'pmi', 'hoa'];
export const FACTS = ['loan', 'interest', 'cost', 'payoff', 'extra', 'saved'];
export const FIELDS = ['in-price', 'in-down', 'in-downpct', 'in-balance', 'in-origprice', 'in-rate', 'in-years', 'in-start', 'in-maturity',
  'in-next', 'in-tax', 'in-tax-unit', 'in-ins', 'in-ins-unit', 'in-escrow', 'in-escrow-unit', 'in-hoa', 'in-pmi', 'in-extra', 'in-every'];
export const BLOCKS = ['price-field', 'new-fields', 'progress-fields', 'maturity-field', 'next-field', 'split-fields', 'escrow-fields'];

/* ---- months, as the hash writes them -------------------------------- */
const monthIndex = ymText => +ymText.slice(0, 4) * 12 + +ymText.slice(5) - 1;
export const monthsBetween = (a, b) => monthIndex(b) - monthIndex(a);
export const addMonths = (ymText, n) => {
  const i = monthIndex(ymText) + n;
  return `${Math.floor(i / 12)}-${String(i % 12 + 1).padStart(2, '0')}`;
};

/* ---- the grid ------------------------------------------------------- */
const COSTS = [
  { t: 0.92, tu: 'pct', i: 1800, iu: 'yr', w: 0, wu: 'mo', em: 0 },
  { t: 1.137, tu: 'pct', i: 150, iu: 'mo', w: 0, wu: 'mo', em: 0 },
  { t: 6431.17, tu: 'yr', i: 2100, iu: 'yr', w: 0, wu: 'mo', em: 0 },
  { t: 583.33, tu: 'mo', i: 95.5, iu: 'mo', w: 0, wu: 'mo', em: 0 },
  { t: 0.92, tu: 'pct', i: 1800, iu: 'yr', w: 725.5, wu: 'mo', em: 1 },
  { t: 0, tu: 'yr', i: 0, iu: 'yr', w: 9100, wu: 'yr', em: 1 },
];
const EXTRAS = [{ x: 0, e: 1 }, { x: 0, e: 1 }, { x: 200, e: 1 }, { x: 600, e: 3 }, { x: 1500, e: 6 }, { x: 5000, e: 12 }, { x: 20000, e: 0 }];

/** The loans the page is put through. `next` is the month after the one the
 *  page's clock reads, as "YYYY-MM": a loan under way is dated around it. */
export function states(next, quick = false) {
  let seed = 11;
  const rnd = () => (seed = (seed * 48271) % 2147483647) / 2147483647;
  const pick = arr => arr[Math.floor(rnd() * arr.length)];
  const out = [];
  for (let k = 0; k < (quick ? 24 : 90); k++) {
    const p = pick([437500, 612347, 750000, 1234567]);
    const down = pick([{ dp: 0 }, { dp: 3.5 }, { dp: 5 }, { dp: 12.5 }, { dp: 20 }, { dp: 100 }, { d: 50000 }, { d: 150000 }, { d: Math.round(p * 0.2) }]);
    out.push({ lm: 0, p, ...down, r: pick([0, 3.5, 6.25, 7.25, 11]), y: pick([10, 15, 30, 40]), s: addMonths(next, pick([0, 0, 3, -14])),
      ...pick(COSTS), h: pick([0, 0, 85, 412.5]), m: pick([0, 0.5, 1.1]), ...pick(EXTRAS) });
  }
  for (let k = 0; k < (quick ? 24 : 110); k++) {
    const y = pick([15, 30, 40]), r = pick([0, 3.5, 6.25, 7.25, 11]);
    const paid = pick([0, 1, 24, 60, 133, 170]);
    // A balance read off a real schedule, to the dollar as a statement gives it.
    const loan = pick([356250, 600000, 712500, 987654]);
    const b = paid ? Math.round(m.amortize(m.describe({ price: loan, down: 0, rate: r, years: y })).rows[paid - 1].balance) : loan;
    const nx = addMonths(next, pick([0, 0, 0, 1, -2]));
    // The price, when given: the down payments people make, one of them none.
    const ltv = pick([null, null, 0.95, 0.9, 0.85, 0.8, 0.75, 1]);
    out.push({ lm: 1, b, ...(ltv ? { op: Math.round(loan / ltv) } : {}), r, y, s: addMonths(nx, -paid), nx,
      ...pick(COSTS), h: pick([0, 0, 85]), m: pick([0, 0, 0.5, 1.1]), ...pick(EXTRAS) });
  }
  return out;
}

const KEY_ORDER = ['p', 'd', 'dp', 'b', 'op', 'r', 'y', 's', 'nx', 't', 'tu', 'i', 'iu', 'w', 'wu', 'h', 'm', 'x', 'e', 'em', 'lm'];
export const hashOf = st => '#' + KEY_ORDER.filter(k => st[k] !== undefined).map(k => `${k}=${st[k]}`).join('&');

/* ---- expectations, computed here, not in the page ------------------- */
const money0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const money2 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const monthFmt = new Intl.DateTimeFormat('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
export const usd = x => money0.format(Math.round(x));
export const usd2 = x => money2.format(x);
export const monthName = ymText => monthFmt.format(new Date(Date.UTC(+ymText.slice(0, 4), +ymText.slice(5) - 1, 1)));
/** A printed dollar figure back as a number; NaN when the text is not one. */
export const num = text => { const t = /-?\$?-?\d[\d,]*(?:\.\d+)?/.exec(String(text)); return t ? +t[0].replace(/[$,]/g, '') : NaN; };
const cents = x => Math.round(x * 100) / 100;
const perYear = (x, u) => (u === 'mo' ? x * 12 : x);
const termWord = months => [Math.floor(months / 12) ? `${Math.floor(months / 12)} yr` : '', months % 12 ? `${months % 12} mo` : ''].filter(Boolean).join(' ') || '0 mo';
const sumOf = (rows, key) => rows.reduce((t, r) => t + r[key], 0);

/** Everything the checks need to know about a loan, worked out from its keys. */
export function expected(st) {
  const n = st.y * 12, under = !!st.lm;
  const paid = under ? monthsBetween(st.s, st.nx) : 0;
  const original = under ? m.originalLoan(st.b, st.r, n, paid) : null;
  const price = under ? st.op ?? original : st.p;
  const down = under ? null : st.d ?? Math.ceil(+(st.p * st.dp / 100).toFixed(6));
  const loan = under ? st.b : Math.max(0, st.p - Math.min(st.p, down));
  const d = m.describe({
    rate: st.r, price, hoa: st.h, pmiRate: st.m, extra: st.x, extraEvery: st.e,
    ...(under ? { balance: st.b, months: n - paid, original, originalMargin: m.originalLoanMargin(st.r, n, paid) } : { down, years: st.y }),
  });
  const base = m.amortize(d, { extra: 0 }), fast = st.x > 0 ? m.amortize(d) : base;
  const past = m.pastPayments(d, paid);
  const left = n - paid;
  /* PMI as the rule states it: owed when the loan started over 80% of the
     price (a dollar's grace, and an inferred loan's margin), on the original
     loan, for as long as the balance is over 78% of the price. */
  const began = under ? original : loan, grace = 1 + (under ? m.originalLoanMargin(st.r, n, paid) : 0);
  const pmi = st.m > 0 && price > 0 && began > price * 0.8 + grace && loan > price * 0.78 ? cents(began * st.m / 100 / 12) : 0;
  const bill = {
    pi: cents(m.monthlyPI(loan, st.r, left / 12)),
    tax: st.em ? 0 : cents((st.tu === 'pct' ? price * st.t / 100 : perYear(st.t, st.tu)) / 12),
    insurance: st.em ? 0 : cents(perYear(st.i, st.iu) / 12),
    escrow: st.em ? cents(perYear(st.w, st.wu) / 12) : 0,
    pmi,
    hoa: cents(st.h),
  };
  return { n, under, paid, left, original, price, loan, d, base, fast, past, bill, total: PARTS.reduce((t, k) => t + bill[k], 0), start: under ? st.nx : st.s };
}

/** The payment the tooltip is read at: the last one made on a loan under way
 *  (where the reconstructed half of the chart meets the typed balance), the
 *  first one otherwise. 0 when nothing is charted. */
export function todayPayment(st) {
  const e = expected(st);
  return e.loan > 0 ? Math.max(1, e.paid) : 0;
}

/* Everything one valid loan must show. `check(ok, message, st)` records it.
   `fromLink` says the form was filled from the loan's link, so each field
   holds the link's value as the page writes it; a form someone typed into
   holds their text instead ("750k"), and only the figures are checked. */
export function checkState(p, st, check, { fromLink = true } = {}) {
  const e = expected(st);
  const { d, base, fast, past, bill } = e;
  const is = (got, want, what) => check(got === want, `${what}: shown "${got}", expected "${want}"`, st);
  const close = (got, want, tol, what) => check(Math.abs(got - want) <= tol + 1e-6, `${what}: shown ${got}, expected ${want} (±${tol})`, st);
  const has = (text, piece, what) => check(String(text).includes(piece), `${what}: "${text}" lacks "${piece}"`, st);

  check(p.boot, 'the boot-error note is showing', st);
  is(p.invalid.join(' '), '', 'fields marked invalid');
  for (const [id, text] of Object.entries(p.fields)) check(!/NaN|undefined|Infinity/.test(text), `field #${id} holds "${text}"`, st);

  // The form: which half is on screen, and what the link put in it.
  for (const [id, on] of Object.entries({ 'price-field': !e.under, 'new-fields': !e.under, 'progress-fields': e.under, 'maturity-field': e.under,
    'next-field': e.under, 'split-fields': !st.em, 'escrow-fields': !!st.em })) is(p.shown[id], on, `#${id} visible`);
  is(p.fields['in-years'], String(st.y), 'term');
  is(p.fields['in-start'], st.s, 'first payment');
  is(p.fields['in-maturity'], addMonths(st.s, e.n - 1), 'last payment');
  is(p.fields['in-every'], String(st.e), 'cadence');
  for (const id of ['in-tax', 'in-ins', 'in-escrow']) is(p.fields[`${id}-unit`], st[{ 'in-tax': 'tu', 'in-ins': 'iu', 'in-escrow': 'wu' }[id]], `${id} unit`);
  if (e.under) is(p.fields['in-next'], st.nx, 'next payment');
  if (fromLink) {
    close(+p.fields['in-rate'], st.r, 0, 'rate field');
    for (const [id, key, unit] of [['in-tax', 't', 'tu'], ['in-ins', 'i', 'iu'], ['in-escrow', 'w', 'wu']]) {
      close(+p.fields[id], st[key], st[unit] === 'pct' ? 1e-6 : 0.005, `${id} field`);
    }
    if (e.under) {
      close(+p.fields['in-balance'], st.b, 0.005, 'balance field');
      is(p.fields['in-origprice'], st.op === undefined ? '' : String(st.op), 'original price field');
    } else {
      close(+p.fields['in-price'], st.p, 0.005, 'price field');
      close(+p.fields['in-down'], st.d ?? Math.ceil(+(st.p * st.dp / 100).toFixed(6)), 0.005, 'down payment field');
      close(+p.fields['in-downpct'], st.dp ?? Math.min(100, st.d / st.p * 100), 0.0051, 'down % field');
    }
  }

  // The bill: each row, which rows are shown, and the total as their sum.
  for (const k of PARTS) is(p.parts[k].text, usd2(bill[k]), `breakdown ${k}`);
  for (const k of PARTS) is(p.parts[k].hidden, k === 'escrow' ? !st.em : (k === 'tax' || k === 'insurance') && !!st.em, `breakdown ${k} hidden`);
  is(p.total, usd(e.total), 'monthly total');
  const rowsShown = PARTS.filter(k => !p.parts[k].hidden).reduce((t, k) => t + num(p.parts[k].text), 0);
  close(num(p.total), rowsShown, 0.5, 'the total against the sum of the rows shown');

  // The line under the headline.
  if (st.x > 0) {
    has(p.sub, `plus ${usd(st.x)} extra principal`, 'sub-line');
    if (st.e === 1) has(p.sub, `${usd(e.total + st.x)} in all`, 'sub-line');
  } else if (e.loan > 0) {
    has(p.sub, e.under ? `on a ${usd(e.loan)} balance, ${termWord(e.left)} to go` : `on a ${usd(e.loan)} loan over ${st.y} years`, 'sub-line');
  } else {
    has(p.sub, 'Nothing borrowed', 'sub-line');
  }

  // Summary. A loan under way with payments behind it shows the whole loan
  // with what is still to pay beneath; everything else shows what is ahead.
  const life = past.length > 0;
  const ahead = { interest: fast.totalInterest, cost: e.loan + fast.totalInterest + fast.totalPMI };
  const behind = { interest: sumOf(past, 'interest'), pmi: sumOf(past, 'pmi') };
  is(p.facts.loan.main, usd(e.loan), 'loan fact');
  if (life) {
    has(p.facts.loan.sub, `of the ${usd(e.original)} loan`, 'loan fact sub');
    is(p.facts.interest.main, usd(behind.interest + ahead.interest), 'whole-loan interest');
    is(p.facts.interest.sub, `whole loan · ${usd(ahead.interest)} still to pay`, 'interest sub');
    is(p.facts.cost.main, usd(e.original + behind.interest + behind.pmi + ahead.interest + fast.totalPMI), 'whole-loan cost');
    is(p.facts.cost.sub, `whole loan · ${usd(ahead.cost)} still to pay`, 'cost sub');
    // The rule, on the printed figures: whole loan = history + still to pay.
    close(num(p.facts.interest.main) - num(p.facts.interest.sub), behind.interest, 1, 'whole-loan interest less still-to-pay against the interest already paid');
    close(num(p.facts.cost.main) - num(p.facts.cost.sub), e.original - e.loan + behind.interest + behind.pmi, 1, 'whole-loan cost less still-to-pay against what was already paid');
  } else {
    if (!e.under) has(p.facts.loan.sub, '% down', 'loan fact sub');
    is(p.facts.interest.main, usd(ahead.interest), 'total interest');
    is(p.facts.cost.main, usd(ahead.cost), 'total of all payments');
    close(num(p.facts.cost.main) - num(p.facts.loan.main) - num(p.facts.interest.main), fast.totalPMI, 1.5, 'cost less loan less interest against the PMI');
  }
  is(p.facts.payoff.main, fast.months ? monthName(addMonths(e.start, fast.months - 1)) : '—', 'payoff month');
  if (fast.months) is(p.facts.payoff.sub, `${Math.floor(fast.months / 12)} yr ${fast.months % 12 ? `${fast.months % 12} mo` : ''}`.trim(), 'payoff sub');
  if (st.x > 0) {
    is(p.facts.extra.main, usd(sumOf(fast.rows, 'extra')), 'total extra principal');
    const costOf = sch => sch.totalInterest + sch.totalPMI;
    is(p.facts.saved.main, usd(costOf(base) - costOf(fast)), 'extra principal saves');
    // The sub-line spells the figure out as a subtraction; hold it to that.
    const [onSchedule, withExtra] = p.facts.saved.sub.split('−').map(num);
    close(num(p.facts.saved.main), onSchedule - withExtra, 1, 'saves against the subtraction beside it');
    check(num(p.facts.saved.main) >= 0, `extra principal saves a negative amount: ${p.facts.saved.main}`, st);
    const sooner = base.months - fast.months;
    has(p.facts.saved.sub, `paid off ${Math.floor(sooner / 12)} yr ${sooner % 12} mo sooner`, 'saved sub');
  } else {
    is(p.facts.extra.main, '—', 'extra fact with no extra');
    is(p.facts.saved.main, '—', 'saved fact with no extra');
  }

  // The inferred loan and what the percentages are of.
  if (e.under) {
    is(p.inferred.loan, usd(e.original), 'inferred loan');
    has(p.inferred.note, `with ${e.paid} of ${e.n} payments made`, 'inferred note');
    has(p.inferred.note, st.op === undefined ? 'measured against it' : '% of the price', 'inferred note');
    has(p.hints.tax, st.op === undefined ? 'of the loan amount' : 'of the original price', 'tax hint');
    has(p.hints.pmi, st.op === undefined ? '78% of it' : '80% of the price', 'PMI hint');
  } else {
    has(p.hints.tax, 'of the price', 'tax hint');
    has(p.hints.pmi, '20% down', 'PMI hint');
  }

  // Chart: drawn when something is owed, captioned with the term, and at
  // today it reads the balance the loan really has.
  is(p.chart, e.loan > 0, 'a chart is drawn');
  if (e.loan > 0) {
    has(p.chartNote, e.under ? `${termWord(e.left)} left` : `${st.y}-year term`, 'chart caption');
    const at = todayPayment(st);
    has(p.tip, `payment ${at}`, 'tooltip');
    has(p.tip, monthName(addMonths(life ? st.s : e.start, at - 1)), 'tooltip month');
    const shownBalance = num((/Balance(?: on schedule)?(\$[\d,.]+)/.exec(p.tip) || [])[1]);
    // A reconstructed balance carries the cent rounding of every month before it.
    close(shownBalance, life ? e.loan : base.rows[0].balance, life ? 1 + 0.03 * e.paid : 0.005, 'chart balance at today');
  }

  // Schedule, by year: it runs to zero and adds up to the summary above it.
  const years = Math.ceil(fast.months / 12);
  if (!years) {
    check(p.schedule.length === 1 && /nothing is borrowed/.test(p.schedule[0][0]), 'empty schedule note', st);
  } else {
    is(p.schedule.length, years, 'schedule rows');
    const col = i => p.schedule.reduce((t, r) => t + (r[i] === '—' ? 0 : num(r[i])), 0);
    close(col(2), ahead.interest, years * 0.5 + 0.5, 'schedule interest against interest still to pay');
    close(col(1) + col(3), e.loan, years + 0.5, 'schedule principal and extra against the loan');
    close(col(4), fast.totalPMI, years * 0.5 + 0.5, 'schedule PMI against the PMI ahead');
    is(p.schedule.at(-1)[5], '$0', 'final balance');
    is(p.noExtra, !(st.x > 0), 'Extra column dropped');
    is(p.noPmi, !(fast.totalPMI > 0), 'PMI column dropped');
    has(p.schedule[0][0], monthName(e.start), 'first schedule row');
  }
}

/* ---- the link ------------------------------------------------------- */

/** What each key reads as when a link leaves it out. `defaults` is the
 *  inputs block of data/defaults.json; `next` the page's next month. */
export const keyDefaults = (defaults, next) => ({
  p: defaults.price, dp: defaults.downPct, r: defaults.rate, y: defaults.years, s: next, nx: next,
  t: defaults.taxRate, tu: defaults.taxUnit, i: defaults.insurance, iu: defaults.insUnit, w: defaults.escrow, wu: defaults.escrowUnit,
  h: defaults.hoa, m: defaults.pmiRate, x: defaults.extra, e: defaults.extraEvery, em: 0, lm: 0,
});

/* The hash the page wrote must give back every key of the loan: carried
   when it differs from the default, left out when it equals it. */
export function checkHash(hash, st, defaults, next, check) {
  const q = new URLSearchParams(hash.replace(/^#/, '')), dflt = keyDefaults(defaults, next);
  for (const [k, want] of Object.entries(st)) {
    // With dollars typed the percentage is not a key the page writes.
    if (k === 'dp' && st.d !== undefined) continue;
    const got = q.get(k) ?? (dflt[k] === undefined ? null : String(dflt[k]));
    const same = got !== null && (typeof want === 'number' ? Math.abs(+got - want) < 1e-9 : got === String(want));
    check(same, `the written link reads ${k}=${got}, the loan has ${k}=${want} (${hash})`, st);
  }
  for (const [k, v] of q) {
    // The balance a new loan's link carries is the one seeded on a visit to
    // the other mode; it is not part of the loan being checked.
    if (!(k in st) && k !== 'b') check(false, `the written link carries ${k}=${v}, which the loan does not have (${hash})`, st);
  }
  const fact = k => (k === 'w' && st.em) || ((k === 's' || k === 'nx') && st.lm);
  for (const k of Object.keys(dflt)) {
    if (q.has(k) && q.get(k) === String(dflt[k]) && !fact(k)) check(false, `the written link spells out the default ${k}=${q.get(k)} (${hash})`, st);
  }
}
