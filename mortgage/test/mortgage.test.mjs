import test from 'node:test';
import assert from 'node:assert/strict';
import { monthlyPI, describe, amortize, monthlyBreakdown, byYear, needsPMI, originalLoan, originalLoanMargin, pastPayments } from '../src/mortgage.js';

const near = (a, b, eps = 0.01) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);

test('textbook payments', () => {
  near(monthlyPI(200000, 6, 30), 1199.10);
  near(monthlyPI(300000, 4.5, 15), 2294.98);
  near(monthlyPI(100000, 0, 10), 833.33);
  assert.equal(monthlyPI(0, 6, 30), 0);
});

test('schedule pays the loan off exactly, on time', () => {
  const d = describe({ price: 250000, down: 50000, rate: 6, years: 30 });
  const s = amortize(d);
  assert.equal(s.months, 360);
  assert.equal(s.rows.at(-1).balance, 0);
  const paid = s.rows.reduce((t, r) => t + r.principal + r.extra, 0);
  near(paid, 200000, 0.05);
  near(s.totalInterest, 1199.10 * 360 - 200000, 5);
});

test('zero-rate loans amortise too', () => {
  const s = amortize(describe({ price: 120000, down: 0, rate: 0, years: 10 }));
  assert.equal(s.months, 120);
  assert.equal(s.totalInterest, 0);
  assert.equal(s.rows.at(-1).balance, 0);
});

test('extra principal shortens the loan and cuts interest', () => {
  const d = describe({ price: 250000, down: 50000, rate: 6, years: 30, extra: 200 });
  const base = amortize(d, { extra: 0 });
  const fast = amortize(d);
  assert.ok(fast.months < base.months);
  assert.ok(fast.totalInterest < base.totalInterest);
  assert.equal(fast.rows.at(-1).balance, 0);
  // 6%, $200k, +$200/mo is a well-known ~22-year payoff.
  assert.ok(fast.months > 250 && fast.months < 275, `got ${fast.months}`);
});

test('extra cadence: quarterly, yearly and once', () => {
  const d = describe({ price: 250000, down: 50000, rate: 6, years: 30, extra: 600, extraEvery: 3 });
  const q = amortize(d);
  assert.deepEqual(q.rows.slice(0, 4).map(r => r.extra), [600, 0, 0, 600]);
  const y = amortize(d, { extraEvery: 12 });
  assert.deepEqual(y.rows.slice(0, 13).map(r => r.extra), [600, ...Array(11).fill(0), 600]);
  const once = amortize(d, { extra: 20000, extraEvery: 0 });
  assert.equal(once.rows[0].extra, 20000);
  assert.equal(once.rows.slice(1).reduce((t, r) => t + r.extra, 0), 0);
  for (const s of [q, y, once]) assert.equal(s.rows.at(-1).balance, 0);
  // $600 at the start of each quarter is $200 a month paid a little early,
  // so it lands within a hair of the monthly schedule, on the cheaper side.
  const monthly = amortize(d, { extra: 200, extraEvery: 1 });
  assert.ok(q.totalInterest <= monthly.totalInterest && q.totalInterest > monthly.totalInterest * 0.98);
  assert.equal(describe({ price: 1, extraEvery: undefined }).extraEvery, 1);
});

test('PMI applies only above 80% LTV and stops at 78% of price', () => {
  assert.equal(needsPMI(describe({ price: 400000, down: 80000, rate: 6, years: 30, pmiRate: 0.5 })), false);
  // Whole-dollar down payments land a few cents either side of 20%; within
  // a dollar of the line is not over it.
  assert.equal(needsPMI(describe({ price: 612347, down: 122469, rate: 6, years: 30, pmiRate: 0.5 })), false);
  assert.equal(needsPMI(describe({ price: 612347, down: 122467, rate: 6, years: 30, pmiRate: 0.5 })), true);
  const d = describe({ price: 400000, down: 20000, rate: 6, years: 30, pmiRate: 0.5 });
  assert.ok(needsPMI(d));
  const s = amortize(d);
  assert.ok(s.pmiMonths > 0 && s.pmiMonths < 360);
  const last = s.rows[s.pmiMonths - 1], next = s.rows[s.pmiMonths];
  assert.ok(next.pmi === 0 && last.pmi > 0);
  assert.equal(monthlyBreakdown(d).pmi, 158.33);
});

test('tax as a rate or a dollar figure; escrow replaces tax and insurance', () => {
  const byRate = monthlyBreakdown(describe({ price: 600000, down: 0, rate: 6, years: 30, taxRate: 1, insurance: 1200 }));
  assert.equal(byRate.tax, 500);
  assert.equal(byRate.insurance, 100);
  assert.equal(byRate.escrow, 0);
  const byDollar = monthlyBreakdown(describe({ price: 600000, down: 0, rate: 6, years: 30, tax: 7200, taxRate: 99 }));
  assert.equal(byDollar.tax, 600);
  const esc = monthlyBreakdown(describe({ price: 600000, down: 0, rate: 6, years: 30, taxRate: 1, insurance: 1200, escrow: 9000 }));
  assert.deepEqual([esc.tax, esc.insurance, esc.escrow], [0, 0, 750]);
  assert.equal(describe({ price: 1, escrow: 'x' }).escrow, null);
});

test('a loan under way: balance and remaining months instead of price and term', () => {
  const d = describe({ price: 500000, balance: 312000, rate: 5, months: 244, down: 999999, years: 30 });
  assert.equal(d.loan, 312000);
  assert.equal(d.down, 188000);
  assert.equal(d.months, 244);
  assert.ok(d.inProgress);
  const s = amortize(d);
  assert.equal(s.months, 244);
  assert.equal(s.rows.at(-1).balance, 0);
  near(s.pi, monthlyPI(312000, 5, 244 / 12));
  // Underwater is allowed; the down payment just reads as nothing.
  const u = describe({ price: 300000, balance: 320000, rate: 6, months: 120 });
  assert.equal(u.loan, 320000);
  assert.equal(u.down, 0);
  // Without a balance the old shape is unchanged.
  const n = describe({ price: 300000, down: 60000, rate: 6, years: 15 });
  assert.equal(n.inProgress, false);
  assert.equal(n.months, 180);
});

test('originalLoan inverts the schedule', () => {
  const d = describe({ price: 750000, down: 150000, rate: 6.25, years: 30 });
  const s = amortize(d);
  // The schedule rounds each month to the cent; projected back to the start
  // that error grows as the balance shrinks, so the bound widens with k.
  for (const [k, eps] of [[1, 1], [12, 1], [97, 1], [300, 10], [359, 600]]) {
    near(originalLoan(s.rows[k - 1].balance, 6.25, 360, k), 600000, eps);
  }
  near(originalLoan(600000, 6.25, 360, 0), 600000, 0.001);
  near(originalLoan(90000, 0, 120, 30), 120000, 0.001);
  assert.ok(Number.isNaN(originalLoan(1000, 5, 120, 120)));
  assert.ok(Number.isNaN(originalLoan(1000, 5, 120, -1)));
});

test('the margin on an inferred loan covers what statement rounding does to it', () => {
  for (const rate of [0, 3, 6.25, 9, 18]) for (const years of [10, 30, 40]) for (const loan of [50000, 123456.78, 712500]) {
    const s = amortize(describe({ price: loan, down: 0, rate, years }));
    for (let k = 1; k < years * 12; k += 7) for (const typed of [x => x, Math.round, Math.floor, Math.ceil]) {
      const off = Math.abs(originalLoan(typed(s.rows[k - 1].balance), rate, years * 12, k) - loan);
      assert.ok(off <= originalLoanMargin(rate, years * 12, k), `${rate}% ${years}y ${loan} after ${k}: off by ${off}`);
    }
  }
  // A few dollars for as long as PMI could still be owed, which is all it is for.
  assert.ok(originalLoanMargin(6.25, 360, 24) < 2);
  assert.ok(originalLoanMargin(6.25, 360, 133) < 5);
  assert.ok(Number.isNaN(originalLoanMargin(6.25, 360, 360)));
});

/* One loan, entered as new and as a loan `paid` payments in whose balance
   is read off the new loan's own schedule to the dollar. `price` is the
   original home price, or null for a viewer who did not give one. */
const sumOf = (rows, key) => rows.reduce((t, r) => t + r[key], 0);
function bothWays({ price = 750000, downPct, rate = 6.25, years = 30, pmiRate = 0.5, paid, given = price }) {
  const fresh = describe({ price, down: price * downPct / 100, rate, years, pmiRate });
  const whole = amortize(fresh);
  const balance = Math.round(whole.rows[paid - 1].balance), n = years * 12;
  const original = originalLoan(balance, rate, n, paid);
  const d = describe({ price: given ?? original, balance, months: n - paid, rate, pmiRate, original, originalMargin: originalLoanMargin(rate, n, paid) });
  const past = pastPayments(d, paid), ahead = amortize(d);
  return {
    fresh, whole, d, past, ahead,
    pmiMonths: past.filter(r => r.pmi > 0).length + ahead.pmiMonths,
    cost: d.original + sumOf(past, 'interest') + sumOf(past, 'pmi') + ahead.totalInterest + ahead.totalPMI,
    freshCost: fresh.loan + whole.totalInterest + whole.totalPMI,
  };
}

test('a loan under way with its price given carries the PMI of the same loan entered as new', () => {
  // $750k at 6.25% over 30 years with PMI at 0.5%: 5% down is the loan that
  // was charged 153 months of PMI instead of 132, and none of the 24 paid.
  for (const [downPct, months, monthly] of [[5, 132, 296.88], [10, 106, 281.25], [15, 72, 265.63], [20, 0, 0], [25, 0, 0]]) {
    for (const paid of [1, 24, 60, 131, 132, 133, 200, 300, 359]) {
      const b = bothWays({ downPct, paid }), at = `${downPct}% down, ${paid} paid`;
      assert.equal(b.whole.pmiMonths, months, at);
      assert.equal(b.pmiMonths, months, at);
      // The inferred loan is the real one to within its margin, and the
      // whole-loan cost follows it: a few dollars early on, more near the end.
      near(b.cost, b.freshCost, 6 + 3 * originalLoanMargin(6.25, 360, paid));
      // The charge is on the original loan, and is still in the bill only
      // while the new loan's own schedule would still be charging it.
      const due = paid < months ? monthly : 0;
      near(monthlyBreakdown(b.d).pmi, due, 0.011);
      assert.equal(monthlyBreakdown(b.d).pmi, b.ahead.rows[0].pmi, at);
      if (due) assert.equal(b.past.at(-1).pmi, b.ahead.rows[0].pmi, `${at}: the charge does not change at today`);
    }
  }
  const b = bothWays({ downPct: 5, paid: 24 });
  assert.equal(b.d.loan, 695265);
  near(b.cost, b.freshCost, 5);
  near(sumOf(b.past, 'pmi'), 24 * 296.88, 0.25);
  assert.equal(b.ahead.pmiMonths, 108);
  near(b.freshCost, 1618499.64);
});

test('with no price given the loan amount stands in for it, in the history as well', () => {
  const b = bothWays({ downPct: 5, paid: 24, given: null });
  assert.equal(b.d.price, b.d.original);
  // 100% of the "price" at the start, so PMI runs until 78% of the loan.
  assert.ok(needsPMI(b.d));
  assert.ok(b.past.every(r => r.pmi > 0));
  assert.equal(b.past[0].pmi, b.ahead.rows[0].pmi);
  const last = b.ahead.rows[b.ahead.pmiMonths - 1], next = b.ahead.rows[b.ahead.pmiMonths];
  assert.ok(last.balance + last.principal > b.d.original * 0.78 && next.balance + next.principal <= b.d.original * 0.78);
  // A balance already under 78% owes none, and the months paid still did.
  const late = bothWays({ downPct: 5, paid: 200, given: null });
  assert.equal(monthlyBreakdown(late.d).pmi, 0);
  assert.equal(late.ahead.totalPMI, 0);
  assert.ok(sumOf(late.past, 'pmi') > 0);
});

test('without a PMI rate the reconstructed payments are the plain schedule of the original loan', () => {
  for (const paid of [1, 24, 133, 359]) {
    const b = bothWays({ downPct: 20, paid, pmiRate: 0, given: null });
    const plainRows = amortize(describe({ price: b.d.original, down: 0, rate: 6.25, months: 360 }), { extra: 0 }).rows.slice(0, paid);
    assert.deepEqual(b.past, plainRows);
    assert.equal(sumOf(b.past, 'pmi'), 0);
  }
  assert.deepEqual(pastPayments(describe({ price: 1, balance: 1, months: 12, rate: 5 }), 0), []);
  // Extra principal belongs to what is ahead; the balance typed already holds what was paid.
  const x = describe({ price: 400000, balance: 300000, months: 300, rate: 6, original: 320000, extra: 500 });
  assert.equal(sumOf(pastPayments(x, 60), 'extra'), 0);
});

test('the original loan of a description', () => {
  assert.equal(describe({ price: 400000, down: 20000, rate: 6, years: 30 }).original, 380000);
  assert.equal(describe({ price: 400000, down: 20000, rate: 6, years: 30, original: 1 }).original, 380000);
  assert.equal(describe({ price: 400000, balance: 300000, months: 300, rate: 6 }).original, 300000);
  const d = describe({ price: 400000, balance: 300000, months: 300, rate: 6, original: 380000, pmiRate: 0.5 });
  assert.equal(d.original, 380000);
  assert.equal(d.originalMargin, 0);
  // Over 80% at the start: PMI is owed, on the original loan, for as long as
  // the balance is over 78% of the price, and this one no longer is.
  assert.ok(needsPMI(d));
  assert.equal(monthlyBreakdown(d).pmi, 0);
  assert.equal(monthlyBreakdown(describe({ price: 400000, balance: 340000, months: 300, rate: 6, original: 380000, pmiRate: 0.5 })).pmi, 158.33);
  // An inferred loan a few dollars over the line is within its margin of it.
  const edge = { price: 750000, balance: 500000, months: 227, rate: 6.25, pmiRate: 0.5, original: 600001.01 };
  assert.equal(needsPMI(describe(edge)), true);
  assert.equal(needsPMI(describe({ ...edge, originalMargin: originalLoanMargin(6.25, 360, 133) })), false);
});

test('down payment is clamped to the price', () => {
  const d = describe({ price: 100000, down: 250000, rate: 6, years: 30 });
  assert.equal(d.loan, 0);
  assert.equal(amortize(d).months, 0);
});

test('yearly roll-up conserves the totals', () => {
  const s = amortize(describe({ price: 500000, down: 100000, rate: 7, years: 15, extra: 100 }));
  const y = byYear(s.rows);
  near(y.reduce((t, r) => t + r.interest, 0), s.totalInterest, 0.05);
  assert.equal(y.at(-1).balance, 0);
});
