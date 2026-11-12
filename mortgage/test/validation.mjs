/* The validation suite for the mortgage maths, as a function of the module
 * under test, so the same checks run three ways:
 *
 *   test/validation.test.mjs   on src/mortgage.js, with the unit tests (CI)
 *   scripts/verify.mjs         on the built copy, as part of the deploy gate
 *   scripts/validate.mjs       by hand, printing what was checked and how
 *                              close the calculator came
 *
 * Nothing here trusts mortgage.js. Every expectation comes from oracle.mjs
 * (exact arithmetic and closed-form formulas) or from an argument about what
 * any correct loan must do (more extra principal never costs more).
 *
 * The sections, in the order they build on each other:
 *
 *   payment    the level payment is the annuity formula, to the cent
 *   ledger     every row of every schedule, re-derived in exact arithmetic
 *              from the row before it: interest, principal, extra, PMI,
 *              balance; and the totals are the sums of the rows
 *   formulas   balances, payoff months and total interest against closed
 *              forms that never walk a schedule
 *   lump sum   one extra payment of varying size: what it saves, against the
 *              closed form, and the shape of saving-per-dollar as it grows
 *   extras     recurring extra principal: more never costs more
 *   pmi        savings that include PMI
 */
import {
  monthlyRate, ratio, toCents, nearest, interestCents, paymentCents,
  accumulated, balanceAfter, payDown, withLumpSum, firstDollarSaving,
} from './oracle.mjs';

/* ---- the loans --------------------------------------------------------- */

/* Seeded, so a run is the same everywhere and a failure can be reproduced. */
function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const RATES = [0, 0.125, 1.99, 2.875, 3.5, 4.25, 5, 5.375, 6, 6.25, 6.625, 6.99, 7.125, 7.5, 8.75, 10, 12.5];
const YEARS = [10, 15, 20, 25, 30, 40];

/* By hand: the page's example, the textbook loans, and the corners (no
   interest, a tiny loan, a huge one, odd cents, a short remaining term). */
const FIXED = [
  { loan: 200000, rate: 6, years: 30 },
  { loan: 300000, rate: 4.5, years: 15 },
  { loan: 100000, rate: 0, years: 10 },
  { loan: 1000, rate: 7.125, years: 10 },
  { loan: 3250000, rate: 6.875, years: 30 },
  { loan: 417000, rate: 2.875, years: 40 },
  { loan: 287431.96, rate: 6.25, months: 217 },
  { loan: 99999.99, rate: 12.5, months: 13 },
  { loan: 64250.5, rate: 3.5, months: 1 },
  { loan: 500000, rate: 0, months: 77 },
  { loan: 380000, rate: 6.5, years: 30, price: 400000, pmiRate: 0.5 },
  { loan: 285000, rate: 7, years: 30, price: 300000, pmiRate: 1.1 },
];

export function loanSet(count, seed) {
  const rnd = prng(seed), pick = a => a[Math.floor(rnd() * a.length)];
  const out = FIXED.slice(0, Math.max(0, count));
  while (out.length < count) {
    const rate = pick(RATES), kind = rnd();
    // Loan sizes spread evenly over orders of magnitude, $20k to $2m.
    const size = 20000 * Math.pow(100, rnd());
    if (kind < 0.45) out.push({ loan: Math.round(size / 100) * 100, rate, years: pick(YEARS) });
    else if (kind < 0.75) out.push({ loan: Math.round(size * 100) / 100, rate, months: 6 + Math.floor(rnd() * 470) });
    else {
      // Over 80% of the price, so PMI is owed.
      const price = Math.round(size / 1000) * 1000;
      const loan = Math.round(price * (0.82 + rnd() * 0.18));
      out.push({ loan, rate, years: pick(YEARS), price, pmiRate: pick([0.3, 0.5, 0.75, 1.1]) });
    }
  }
  return out;
}

const nameOf = L => `$${L.loan} at ${L.rate}% over ${L.years ? L.years + 'y' : L.months + ' mo'}${L.pmiRate ? `, price $${L.price}, PMI ${L.pmiRate}%` : ''}`;

/* A loan as the module describes it. Whole-year loans go in as price and
   down payment, the others as a balance with months left, so both of the
   page's ways in are exercised. */
function describeLoan(m, L, extra = 0, extraEvery = 1) {
  const common = { rate: L.rate, pmiRate: L.pmiRate || 0, extra, extraEvery };
  if (L.years) {
    const price = L.price ?? L.loan;
    return m.describe({ ...common, price, down: price - L.loan, years: L.years });
  }
  return m.describe({ ...common, price: L.price ?? 0, balance: L.loan, months: L.months });
}

/* How far a schedule of k months may sit from a formula with nothing
   rounded in it. Each month's interest is rounded by up to half a cent, and
   an error in the balance then compounds like the balance does, so k months
   of it are worth at most 0.005·(g^k − 1)/r. Doubled, plus a nickel, for the
   payment's own rounding. At 6% over 30 years that is $10 on a figure in the
   hundreds of thousands; what is actually observed is reported alongside. */
const slack = (rate, k) => 0.01 * accumulated(rate, k) + 0.05;

/* ---- the ledger audit --------------------------------------------------- */

/* Re-derive one schedule row by row in exact arithmetic. Returns the first
   thing found wrong, or null. */
function auditSchedule(d, s, extra, extraEvery) {
  const r = monthlyRate(d.rate);
  const loan = toCents(d.loan);
  if (loan == null) return `loan ${d.loan} is not whole cents`;
  const pi = toCents(s.pi);
  if (pi == null) return `payment ${s.pi} is not whole cents`;
  if (!paymentCents(loan, r, d.months).includes(pi)) {
    return `payment is ${s.pi}; the annuity formula gives ${paymentCents(loan, r, d.months).map(c => Number(c) / 100).join(' or ')}`;
  }
  const extraC = toCents(extra);
  // PMI: owed when the original loan is over 80% of the price by more than
  // a dollar, charged while the opening balance is over 78% of the price.
  const price = toCents(d.price), original = toCents(d.original), pmiRate = ratio(d.pmiRate);
  const owesPMI = price > 0n && pmiRate.n > 0n && original * 100n > price * 80n + 10000n;
  const pmiCharge = nearest(original * pmiRate.n, pmiRate.d * 1200n);

  let bal = loan, sumInterest = 0n, sumPMI = 0n, pmiMonths = 0;
  for (let i = 0; i < s.rows.length; i++) {
    const row = s.rows[i], n = i + 1, at = `month ${n}`;
    if (row.n !== n) return `${at}: row is numbered ${row.n}`;
    if (bal <= 0n) return `${at}: a payment after the balance reached zero`;
    const c = {};
    for (const k of ['interest', 'principal', 'extra', 'pmi', 'balance', 'payment']) {
      c[k] = toCents(row[k]);
      if (c[k] == null || c[k] < 0n) return `${at}: ${k} is ${row[k]}`;
    }
    if (!interestCents(bal, r).includes(c.interest)) {
      return `${at}: interest ${row.interest} on a balance of ${Number(bal) / 100}; exact is ${interestCents(bal, r).map(x => Number(x) / 100).join(' or ')}`;
    }
    const scheduled = pi - c.interest;
    if (scheduled <= 0n && n !== d.months) return `${at}: the payment does not cover the interest`;
    const closes = n === d.months || scheduled >= bal;
    const principal = closes ? bal : scheduled;
    if (c.principal !== principal) return `${at}: principal ${row.principal}, expected ${Number(principal) / 100}`;
    const due = extraEvery > 0 ? i % extraEvery === 0 : i === 0;
    const room = bal - principal;
    const x = due && !closes ? (extraC < room ? extraC : room) : 0n;
    if (c.extra !== x) return `${at}: extra ${row.extra}, expected ${Number(x) / 100}`;
    if (c.payment !== principal + c.interest) return `${at}: payment ${row.payment} is not principal + interest`;
    const charged = owesPMI && bal * 100n > price * 78n;
    if (charged ? !pmiCharge.includes(c.pmi) : c.pmi !== 0n) {
      return `${at}: PMI ${row.pmi}, expected ${charged ? pmiCharge.map(p => Number(p) / 100).join(' or ') : 0}`;
    }
    bal -= principal + x;
    if (c.balance !== bal) return `${at}: balance ${row.balance}, expected ${Number(bal) / 100}`;
    sumInterest += c.interest; sumPMI += c.pmi; if (c.pmi > 0n) pmiMonths++;
  }
  if (bal !== 0n) return `the schedule ends with ${Number(bal) / 100} still owed`;
  if (s.rows.length > d.months) return `${s.rows.length} payments on a ${d.months}-month loan`;
  if (extraC === 0n && s.rows.length !== d.months) return `on schedule the loan takes ${s.rows.length} months, not ${d.months}`;
  if (s.months !== s.rows.length) return `months is ${s.months} with ${s.rows.length} rows`;
  if (toCents(s.totalInterest) !== sumInterest) return `total interest ${s.totalInterest} is not the sum of the rows, ${Number(sumInterest) / 100}`;
  if (toCents(s.totalPMI) !== sumPMI) return `total PMI ${s.totalPMI} is not the sum of the rows, ${Number(sumPMI) / 100}`;
  if (s.pmiMonths !== pmiMonths) return `pmiMonths is ${s.pmiMonths}, the rows have ${pmiMonths}`;
  return null;
}

/* ---- the suite ---------------------------------------------------------- */

const CADENCES = [1, 3, 6, 12, 0];
/* One-time payments, as fractions of the loan, small to more than all of it. */
const LUMP_FRACTIONS = [0.0005, 0.001, 0.0025, 0.005, 0.01, 0.02, 0.035, 0.05, 0.075, 0.1, 0.15, 0.2, 0.3, 0.4, 0.5, 0.65, 0.8, 0.95, 1, 1.5];

/** What one-time payments of these sizes save on a loan, per the module and
 *  per the closed form. Used by the lump-sum section and printed by
 *  scripts/validate.mjs. */
export function lumpSumTable(m, L, amounts) {
  const d = describeLoan(m, L);
  const base = m.amortize(d, { extra: 0 });
  const formulaBase = payDown(d.loan, d.rate, base.pi);
  return amounts.map(x => {
    const fast = m.amortize(d, { extra: x, extraEvery: 0 });
    const paid = fast.rows.reduce((t, r) => t + r.extra, 0);
    const formula = withLumpSum(d.loan, d.rate, base.pi, x);
    const saved = base.totalInterest - fast.totalInterest;
    return {
      amount: x, paid, saved, perDollar: paid > 0 ? saved / paid : 0,
      formulaSaved: formulaBase.interest - formula.interest,
      months: fast.months, formulaMonths: formula.months, monthsSooner: base.months - fast.months,
      slack: slack(d.rate, base.months) + slack(d.rate, fast.months),
      base, fast, d,
    };
  });
}

export function validate(m, { loans = 240, seed = 20261112 } = {}) {
  const set = loanSet(loans, seed);
  const sections = [];
  const section = (id, title) => {
    const s = { id, title, checks: 0, failures: [], notes: [] };
    sections.push(s);
    s.ok = (cond, L, msg) => { s.checks++; if (!cond && s.failures.length < 25) s.failures.push(`${nameOf(L)}: ${typeof msg === 'function' ? msg() : msg}`); else if (!cond) s.failures.length++; return cond; };
    return s;
  };
  const usd = x => '$' + x.toFixed(2);

  /* payment */
  {
    const s = section('payment', 'The level payment is the annuity formula, to the cent');
    for (const L of set) {
      const loan = toCents(L.loan), n = L.years ? L.years * 12 : L.months;
      const want = paymentCents(loan, monthlyRate(L.rate), n);
      const got = toCents(Math.round(m.monthlyPI(L.loan, L.rate, n / 12) * 100) / 100);
      s.ok(want.includes(got), L, () => `monthlyPI gives ${Number(got) / 100}, exact is ${want.map(c => Number(c) / 100).join(' or ')}`);
    }
  }

  /* ledger */
  {
    const s = section('ledger', 'Every row of every schedule, re-derived in exact arithmetic');
    let rows = 0;
    for (const [i, L] of set.entries()) {
      const plans = [[0, 1]];
      // Each loan under each cadence, with amounts that move from loan to
      // loan: a few dollars, a real overpayment, and more than is owed.
      for (const [j, e] of CADENCES.entries()) {
        const frac = [0.0004, 0.003, 0.02, 0.3, 1.2][(i + j) % 5];
        plans.push([Math.round(L.loan * frac * 100) / 100, e]);
      }
      for (const [x, e] of plans) {
        const d = describeLoan(m, L, x, e);
        const sch = m.amortize(d);
        rows += sch.rows.length;
        const bad = auditSchedule(d, sch, x, e);
        s.ok(!bad, L, () => `with ${usd(x)} extra ${e ? `every ${e} mo` : 'once'}: ${bad}`);
      }
    }
    s.notes.push(`${rows.toLocaleString('en-US')} schedule rows audited`);
  }

  /* formulas */
  {
    const s = section('formulas', 'Balances, payoff months and total interest against closed forms');
    let worst = 0, worstShare = 0;
    const seen = (diff, allowed) => { worst = Math.max(worst, diff); worstShare = Math.max(worstShare, diff / allowed); };
    for (const L of set) {
      if (L.pmiRate) continue;
      const d = describeLoan(m, L);
      const base = m.amortize(d, { extra: 0 });
      // The balance after every payment but the last, which is trimmed.
      let off = null;
      for (let k = 1; k < base.rows.length; k++) {
        const diff = Math.abs(base.rows[k - 1].balance - balanceAfter(d.loan, d.rate, base.pi, k));
        const allowed = slack(d.rate, k);
        seen(diff, allowed);
        if (diff > allowed && !off) off = `balance after payment ${k} is ${usd(base.rows[k - 1].balance)}, the formula gives ${usd(balanceAfter(d.loan, d.rate, base.pi, k))}`;
      }
      s.ok(!off, L, off);
      // Total interest on schedule: n payments of the unrounded payment,
      // less the loan.
      const n = d.months, r = d.rate / 1200;
      const exactPay = r === 0 ? d.loan / n : d.loan * r / (1 - Math.pow(1 + r, -n));
      const want = exactPay * n - d.loan, diff = Math.abs(base.totalInterest - want);
      seen(diff, slack(d.rate, n));
      s.ok(diff <= slack(d.rate, n), L, () => `interest on schedule is ${usd(base.totalInterest)}, the formula gives ${usd(want)}`);
      // The last payment is a payment, not a balloon and not a refund.
      s.ok(Math.abs(base.rows.at(-1).payment - base.pi) <= slack(d.rate, n), L, () => `last payment ${usd(base.rows.at(-1).payment)} against a payment of ${usd(base.pi)}`);
      // A larger payment every month: the log formula for the term.
      for (const frac of [0.05, 0.25, 1, 4]) {
        const x = Math.round(base.pi * frac * 100) / 100;
        const fast = m.amortize(d, { extra: x, extraEvery: 1 });
        const f = payDown(d.loan, d.rate, base.pi + x);
        const allowed = slack(d.rate, fast.months);
        const idiff = Math.abs(fast.totalInterest - f.interest);
        seen(idiff, allowed);
        s.ok(idiff <= allowed, L, () => `with ${usd(x)} extra a month interest is ${usd(fast.totalInterest)}, the formula gives ${usd(f.interest)}`);
        // The count may differ by one only when the last payment is within
        // rounding of nothing, or of a whole payment.
        const edge = f.last <= allowed || base.pi + x - f.last <= allowed;
        s.ok(fast.months === f.months || (edge && Math.abs(fast.months - f.months) === 1), L,
          () => `with ${usd(x)} extra a month the loan takes ${fast.months} months, the formula gives ${f.months}`);
      }
    }
    s.notes.push(`largest gap from a formula ${usd(worst)}, at most ${(worstShare * 100).toFixed(1)}% of what rounding to the cent allows`);
  }

  /* lump sum */
  {
    const s = section('lump sum', 'A one-time payment: what it saves, and saving per dollar as it grows');
    let worst = 0, worstShare = 0, cases = 0;
    for (const L of set) {
      if (L.pmiRate) continue;
      const n = L.years ? L.years * 12 : L.months;
      const amounts = [...new Set(LUMP_FRACTIONS.map(f => Math.max(1, Math.round(L.loan * f))))];
      const table = lumpSumTable(m, L, amounts);
      const { d, base } = table[0];
      const ceiling = firstDollarSaving(d.rate, n);
      // What clears the loan alongside payment 1: the balance left after it.
      const clears = base.rows.length > 1 ? base.rows[0].balance : 0;
      let prev = null;
      for (const t of table) {
        cases++;
        const at = `a one-time ${usd(t.amount)}`;
        // The amount applied is the amount offered, up to what is owed.
        s.ok(Math.abs(t.paid - Math.min(t.amount, clears)) < 0.005, L, () => `${at}: ${usd(t.paid)} was applied, expected ${usd(Math.min(t.amount, clears))}`);
        // Saved interest is the closed form's.
        const diff = Math.abs(t.saved - t.formulaSaved);
        worst = Math.max(worst, diff); worstShare = Math.max(worstShare, diff / t.slack);
        s.ok(diff <= t.slack, L, () => `${at} saves ${usd(t.saved)}, the formula gives ${usd(t.formulaSaved)}`);
        const edgeMonths = Math.abs(t.months - t.formulaMonths) <= 1;
        s.ok(edgeMonths, L, () => `${at}: paid off in ${t.months} months, the formula gives ${t.formulaMonths}`);
        // The books balance: everything paid is the loan plus the interest.
        const paidIn = t.fast.rows.reduce((sum, r) => sum + r.payment + r.extra, 0);
        s.ok(Math.abs(paidIn - (d.loan + t.fast.totalInterest)) < 0.005 * t.fast.rows.length + 0.01, L, () => `${at}: payments total ${usd(paidIn)}, loan plus interest is ${usd(d.loan + t.fast.totalInterest)}`);
        // It never saves a negative amount, never more than the interest
        // there was, and no dollar does better than the first one can.
        s.ok(t.saved >= -t.slack && t.saved <= base.totalInterest + 0.005, L, () => `${at} saves ${usd(t.saved)} of ${usd(base.totalInterest)} interest`);
        s.ok(t.saved <= t.paid * ceiling + t.slack, L, () => `${at} saves ${usd(t.saved)}, more than ${usd(t.paid * ceiling)}, the most ${usd(t.paid)} could`);
        if (prev) {
          // A bigger payment saves more in total...
          s.ok(t.saved >= prev.saved - t.slack, L, () => `${at} saves ${usd(t.saved)}, less than the ${usd(prev.saved)} a one-time ${usd(prev.amount)} saves`);
          // ...and less per dollar. THIS is why the ratio of saved to paid
          // moves with the amount: it must, and only ever downwards.
          if (t.paid > prev.paid) {
            s.ok(t.perDollar <= prev.perDollar + t.slack / t.paid + prev.slack / prev.paid, L,
              () => `${at} saves ${t.perDollar.toFixed(4)} per dollar, more than the ${prev.perDollar.toFixed(4)} of a one-time ${usd(prev.amount)}`);
          }
          s.ok(t.months <= prev.months, L, () => `${at} pays off in ${t.months} months, later than ${usd(prev.amount)} does`);
        }
        prev = t;
      }
      // Paying everything with payment 1 leaves one month's interest.
      const all = table.at(-1);
      s.ok(all.months === 1 && Math.abs(all.fast.totalInterest - d.loan * d.rate / 1200) <= 0.005 + 1e-9, L,
        () => `paying the loan off with payment 1 takes ${all.months} months and ${usd(all.fast.totalInterest)} interest`);
    }
    s.notes.push(`${cases.toLocaleString('en-US')} one-time payments; largest gap from the closed form ${usd(worst)}, at most ${(worstShare * 100).toFixed(1)}% of what rounding allows`);
  }

  /* extras */
  {
    const s = section('extras', 'Recurring extra principal: more never costs more');
    for (const L of set) {
      if (L.pmiRate) continue;
      const d = describeLoan(m, L);
      const base = m.amortize(d, { extra: 0 });
      const tol = slack(d.rate, base.months);
      for (const e of CADENCES) {
        let prev = base;
        for (const frac of [0.1, 0.5, 2, 10]) {
          const x = Math.round(base.pi * frac * 100) / 100;
          const sch = m.amortize(d, { extra: x, extraEvery: e });
          s.ok(sch.totalInterest <= prev.totalInterest + tol && sch.months <= prev.months, L,
            () => `${usd(x)} every ${e || 'once'}: ${usd(sch.totalInterest)} interest over ${sch.months} months, worse than a smaller extra (${usd(prev.totalInterest)}, ${prev.months})`);
          const paid = sch.rows.reduce((t, r) => t + r.principal + r.extra, 0);
          s.ok(Math.abs(paid - d.loan) < 0.005 * sch.rows.length + 0.01, L, () => `principal repaid is ${usd(paid)}`);
          prev = sch;
        }
      }
      // The same money sooner is worth more: $3x at the start of a quarter
      // beats $x in each of its months, which beats nothing.
      const x = Math.round(base.pi * 0.2 * 100) / 100;
      const monthly = m.amortize(d, { extra: x, extraEvery: 1 });
      const quarterly = m.amortize(d, { extra: 3 * x, extraEvery: 3 });
      s.ok(quarterly.totalInterest <= monthly.totalInterest + tol && monthly.totalInterest <= base.totalInterest, L,
        () => `quarterly ${usd(quarterly.totalInterest)}, monthly ${usd(monthly.totalInterest)}, none ${usd(base.totalInterest)}`);
    }
  }

  /* pmi */
  {
    const s = section('pmi', 'Savings that include PMI');
    for (const L of set) {
      if (!L.pmiRate) continue;
      const d = describeLoan(m, L);
      const base = m.amortize(d, { extra: 0 });
      const tol = slack(d.rate, base.months);
      s.ok(base.pmiMonths > 0 && base.pmiMonths < base.months, L, `PMI is charged in ${base.pmiMonths} of ${base.months} months`);
      // Once it stops it does not come back.
      const lastPaid = base.rows.findLastIndex(r => r.pmi > 0);
      s.ok(base.rows.slice(0, lastPaid + 1).every(r => r.pmi > 0), L, 'PMI stops and starts again');
      let prev = base;
      for (const f of [0.005, 0.02, 0.05, 0.1, 0.2, 0.5]) {
        const x = Math.round(L.loan * f);
        const fast = m.amortize(d, { extra: x, extraEvery: 0 });
        // A one-time payment never lengthens PMI, and interest plus PMI
        // never goes up. (Per dollar it can go UP here, when the payment is
        // what carries the balance under 78%: that step is real.)
        s.ok(fast.pmiMonths <= prev.pmiMonths, L, () => `a one-time ${usd(x)} leaves ${fast.pmiMonths} months of PMI, more than a smaller payment's ${prev.pmiMonths}`);
        s.ok(fast.totalInterest + fast.totalPMI <= prev.totalInterest + prev.totalPMI + tol, L, () => `a one-time ${usd(x)} costs more in interest and PMI than a smaller payment`);
        // The interest alone is still the no-PMI closed form: PMI never
        // touches the balance.
        const formula = withLumpSum(d.loan, d.rate, base.pi, x);
        s.ok(Math.abs(fast.totalInterest - formula.interest) <= slack(d.rate, fast.months), L, () => `a one-time ${usd(x)}: interest ${usd(fast.totalInterest)}, the formula gives ${usd(formula.interest)}`);
        prev = fast;
      }
    }
  }

  const checks = sections.reduce((t, s) => t + s.checks, 0);
  const failures = sections.reduce((t, s) => t + s.failures.length, 0);
  return { loans: set.length, checks, failures, sections };
}
