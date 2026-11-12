/* The reference the calculator is validated against. It imports nothing from
 * src/: nothing here can be right only because mortgage.js is.
 *
 * This is the one deliberate exception to "one implementation of the maths".
 * It is not a second calculator and must never be imported by the page. It
 * holds two things mortgage.js is checked against by validation.mjs:
 *
 *   1. exact arithmetic. Money is whole cents in a BigInt and a rate is a
 *      ratio of two BigInts, so "6.25% of $287,431.96 for a month, to the
 *      nearest cent" has one answer with no floating point in it;
 *   2. closed forms. The textbook formulas for a balance after k payments,
 *      for the life of a loan with a larger payment, and for what a single
 *      early payment saves, none of which walks a schedule.
 */

/* ---- exact arithmetic -------------------------------------------------- */

/** A number as an exact ratio, read from its shortest decimal spelling:
 *  6.125 is 6125/1000, not the nearest binary fraction to it. */
export function ratio(x) {
  const s = String(x);
  const m = /^(\d+)(?:\.(\d+))?$/.exec(s);
  if (!m) throw new Error(`oracle: cannot read ${s} as a plain decimal`);
  const frac = m[2] || '';
  return { n: BigInt(m[1] + frac), d: 10n ** BigInt(frac.length) };
}

/** The monthly rate of an annual percentage, exactly: pct / 100 / 12. */
export function monthlyRate(pct) {
  const { n, d } = ratio(pct);
  return { n, d: d * 1200n };
}

/** Dollars as whole cents, or null when the figure is not whole cents. */
export function toCents(x) {
  const c = Math.round(x * 100);
  return Number.isFinite(x) && Math.abs(x * 100 - c) < 1e-6 ? BigInt(c) : null;
}

/** num/den to the nearest whole number, as the list of acceptable answers:
 *  one, or on an exact half both neighbours. Rounding a half up or down is a
 *  convention servicers differ on and a float cannot be held to; everything
 *  that is not an exact half has one answer and is held to it. */
export function nearest(num, den) {
  const q = num / den, twice = 2n * (num % den);
  if (twice < den) return [q];
  if (twice > den) return [q + 1n];
  return [q, q + 1n];
}

/** A month's interest on a balance in cents, in cents. */
export function interestCents(balance, r) {
  return nearest(balance * r.n, r.d);
}

/** The level payment that retires `loan` cents in `n` months, in cents:
 *  L·r·(1+r)^n / ((1+r)^n − 1), evaluated exactly. */
export function paymentCents(loan, r, n) {
  if (r.n === 0n) return nearest(loan, BigInt(n));
  const up = (r.n + r.d) ** BigInt(n), base = r.d ** BigInt(n);
  return nearest(loan * r.n * up, r.d * (up - base));
}

/* ---- closed forms ------------------------------------------------------ */

/** (g^k − 1) / r, the value after k months of a dollar paid in each: what
 *  a cent of rounding per month can have grown to, and the annuity factor. */
export function accumulated(ratePct, k) {
  const r = ratePct / 1200;
  return r === 0 ? k : (Math.pow(1 + r, k) - 1) / r;
}

/** Balance after k payments of `pay` on a loan of `loan`, nothing rounded. */
export function balanceAfter(loan, ratePct, pay, k) {
  const r = ratePct / 1200;
  return loan * Math.pow(1 + r, k) - pay * accumulated(ratePct, k);
}

/** Paying `pay` a month on `loan` until it is gone: how many months it
 *  takes and the interest paid, the last payment being whatever is left.
 *  Uses the logarithm for the count, not a loop. */
export function payDown(loan, ratePct, pay) {
  if (!(loan > 0)) return { months: 0, interest: 0, last: 0 };
  const r = ratePct / 1200, g = 1 + r;
  if (!(pay > loan * r)) return { months: Infinity, interest: Infinity, last: 0 };
  const exact = r === 0 ? loan / pay : -Math.log(1 - r * loan / pay) / Math.log(g);
  // Full payments, then one partial. A count within a rounding error of a
  // whole number is that whole number: there is no payment of nothing.
  let full = Math.floor(exact + 1e-9);
  let left = balanceAfter(loan, ratePct, pay, full);
  if (left < 1e-6) left = 0;
  const last = left * g;
  return { months: full + (last > 0 ? 1 : 0), interest: pay * full + last - loan, last };
}

/** A loan paid at `pay` a month with one extra sum `lump` alongside the
 *  first payment: months and interest, in closed form. */
export function withLumpSum(loan, ratePct, pay, lump) {
  const r = ratePct / 1200;
  const afterFirst = loan * (1 + r) - pay - lump;
  // The first payment and the lump clear the loan between them.
  if (afterFirst <= 1e-6) return { months: 1, interest: loan * r };
  const rest = payDown(afterFirst, ratePct, pay);
  return { months: 1 + rest.months, interest: loan * r + rest.interest };
}

/** The most a dollar paid with payment 1 of an n-month loan can save: it
 *  comes off the balance and so off the last payment, n − 1 months of
 *  compounding later. Every further dollar removes a payment that falls due
 *  earlier, and saves less. */
export function firstDollarSaving(ratePct, n) {
  return Math.pow(1 + ratePct / 1200, n - 1) - 1;
}
