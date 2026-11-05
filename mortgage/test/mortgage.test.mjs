import test from 'node:test';
import assert from 'node:assert/strict';
import { monthlyPI, describe, amortize, monthlyBreakdown, byYear, needsPMI } from '../src/mortgage.js';

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
