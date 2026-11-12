/* The validation suite (validation.mjs) run on src/mortgage.js, and a check
 * on the suite itself: it has to fail when the maths is broken. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as mortgage from '../src/mortgage.js';
import { validate, lumpSumTable } from './validation.mjs';
import { ratio, nearest, paymentCents, monthlyRate, payDown, withLumpSum, firstDollarSaving } from './oracle.mjs';

const result = validate(mortgage, { loans: 300 });

for (const s of result.sections) {
  test(`validation: ${s.title}`, () => {
    assert.ok(s.checks > 0, 'the section checked nothing');
    assert.equal(s.failures.length, 0, `${s.failures.length} failed:\n  ${s.failures.filter(Boolean).join('\n  ')}`);
  });
}

/* The oracle is held to figures worked by hand, so that it is not merely
   self-consistent. $200,000 at 6% over 30 years is the standard example:
   $1,199.10 a month. $100,000 at 12% for a year: r is exactly 0.01 and the
   payment is 100000 × 0.01 × 1.01^12 / (1.01^12 − 1) = $8,884.88. */
test('the oracle reproduces figures worked by hand', () => {
  assert.deepEqual(ratio(6.125), { n: 6125n, d: 1000n });
  assert.deepEqual(nearest(5n, 2n), [2n, 3n]);
  assert.deepEqual(nearest(7n, 3n), [2n]);
  assert.deepEqual(paymentCents(20000000n, monthlyRate(6), 360), [119910n]);
  assert.deepEqual(paymentCents(10000000n, monthlyRate(12), 12), [888488n]);
  assert.deepEqual(paymentCents(12000000n, monthlyRate(0), 120), [100000n]);
  // $1,000 at 12%, $100 a month: 10.59 months by the log formula, so ten
  // payments of $100 and an eleventh of $58.98; $58.98 interest in all.
  const p = payDown(1000, 12, 100);
  assert.equal(p.months, 11);
  assert.ok(Math.abs(p.interest - 58.98) < 0.005, String(p.interest));
  // Paying $495 with the first $100 leaves 1000 × 1.01 − 595 = $415.
  const l = withLumpSum(1000, 12, 100, 495);
  assert.equal(l.months, 1 + payDown(415, 12, 100).months);
  assert.equal(withLumpSum(1000, 12, 100, 5000).months, 1);
  assert.ok(Math.abs(firstDollarSaving(12, 13) - (Math.pow(1.01, 12) - 1)) < 1e-12);
});

/* The question the suite was written for: a one-time payment's saving per
   dollar changes with its size. It must: it falls, steadily, from the
   first-dollar figure towards nothing. Pinned on one loan so the shape is
   on record in a test a person can read. */
test('a one-time payment saves less per dollar the larger it is', () => {
  const L = { loan: 600000, rate: 7.25, years: 30 };
  const rows = lumpSumTable(mortgage, L, [1000, 5000, 10000, 25000, 50000, 100000, 200000, 400000]);
  const top = firstDollarSaving(7.25, 360);
  for (const [i, t] of rows.entries()) {
    assert.ok(Math.abs(t.saved - t.formulaSaved) < 1, `$${t.amount}: ${t.saved} against ${t.formulaSaved}`);
    assert.ok(t.perDollar < (i ? rows[i - 1].perDollar : top), `$${t.amount} saves ${t.perDollar} per dollar`);
  }
  // $1,000 is nearly the first dollar; $400,000 is far from it.
  assert.ok(rows[0].perDollar > top * 0.99 && rows.at(-1).perDollar < top * 0.3);
});

/* A validator that cannot fail is worth nothing. Each line below is a
   plausible mistake, made in a copy of the source held in memory; the suite
   has to object to every one. If the source is reworded so a mutation no
   longer applies, this fails and says which: reword the mutation, do not
   delete it. */
const MUTATIONS = [
  ['interest truncated instead of rounded', 'const interest = cents(bal * r);', 'const interest = Math.floor(bal * r * 100) / 100;'],
  ['one cent too much interest in a single month', 'const interest = cents(bal * r);', 'const interest = cents(bal * r) + (n === 100 ? 0.01 : 0);'],
  ['a daily rate where a monthly one belongs', 'const r = d.rate / 100 / 12;\n  const rows', 'const r = d.rate / 100 / 365 * 30;\n  const rows'],
  ['the payment formula off by one month', 'Math.pow(1 + r, -n)', 'Math.pow(1 + r, -(n + 1))'],
  ['the one-time payment applied a month late', ': n === 1;', ': n === 2;'],
  ['the cadence shifted off the first payment', '(n - 1) % extraEvery === 0', 'n % extraEvery === 0'],
  ['extra principal not capped at the balance', 'Math.min(extra, Math.max(0, bal - principal))', 'extra'],
  ['extra principal not fully credited', 'bal = cents(bal - principal - x);', 'bal = cents(bal - principal - x * 0.999);'],
  ['the balance left to drift in floating point', 'bal = cents(bal - principal - x);', 'bal = bal - principal - x + 1e-7;'],
  ['the last row left out of total interest', 'totalInterest: cents(totalInterest),', 'totalInterest: cents(totalInterest - rows.at(-1).interest),'],
  ['PMI cancelled at 80% instead of 78%', 'PMI_CANCEL_LTV = 0.78', 'PMI_CANCEL_LTV = 0.80'],
  ['PMI charged on the current balance', 'cents(d.original * d.pmiRate / 100 / 12)', 'cents(balance * d.pmiRate / 100 / 12)'],
  ['the final month not cleared', 'if (n === cap) principal = bal;', ''],
];

test('the suite fails on a broken calculator', async () => {
  const source = fs.readFileSync(fileURLToPath(new URL('../src/mortgage.js', import.meta.url)), 'utf8');
  for (const [name, from, to] of MUTATIONS) {
    assert.ok(source.includes(from), `mutation "${name}" no longer matches src/mortgage.js: reword it`);
    // mortgage.js imports nothing, so a copy loads from a data: URL and no
    // file is written.
    const url = 'data:text/javascript;base64,' + Buffer.from(source.replace(from, to)).toString('base64');
    let failures;
    try { failures = validate(await import(url), { loans: 60 }).failures; } catch { failures = 1; }
    assert.ok(failures > 0, `the suite passed a calculator with ${name}`);
  }
});
