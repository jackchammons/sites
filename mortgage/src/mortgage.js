/* The mortgage math — one implementation, imported by the browser (app.js),
 * the unit tests and the deploy gate (verify.mjs). Pure functions, no DOM.
 *
 * Conventions:
 *   - rates are annual percentages (6.25 means 6.25%), compounded monthly;
 *   - money is in dollars, kept as floats while scheduling and rounded to
 *     cents per period so the schedule sums to what a servicer would bill;
 *   - the final payment is trimmed so the balance lands on exactly zero.
 */

/** Scheduled principal + interest for a fully amortising fixed-rate loan. */
export function monthlyPI(principal, annualRatePct, years) {
  const n = Math.round(years * 12);
  if (!(principal > 0) || !(n > 0)) return 0;
  const r = annualRatePct / 100 / 12;
  if (r === 0) return principal / n;
  return principal * r / (1 - Math.pow(1 + r, -n));
}

const cents = x => Math.round(x * 100) / 100;

/** The original principal of a loan that, over `months` at the given rate,
 *  has `balance` left after `paid` payments — the amortization formula run
 *  backwards. Assumes the loan has been paid exactly on schedule. */
export function originalLoan(balance, annualRatePct, months, paid) {
  const n = Math.round(months), k = Math.round(paid);
  if (!(balance >= 0) || !(n > 0) || !(k >= 0) || k >= n) return NaN;
  // Nothing paid yet: the loan is the balance itself, to the last bit. Run
  // through the multiply and divide below it can come back a hair under,
  // which is enough to round a PMI charge of $653.125 down instead of up.
  if (k === 0) return balance;
  const r = annualRatePct / 100 / 12;
  if (r === 0) return balance * n / (n - k);
  const g = Math.pow(1 + r, n);
  return balance * (g - 1) / (g - Math.pow(1 + r, k));
}

/** How far originalLoan() may be from what the loan really started at, in
 *  dollars. The balance it works from is a statement figure: up to a dollar
 *  off as typed, and up to a cent further from the formula for every month
 *  paid, because the payment and each month's interest are rounded to the
 *  cent. Run backwards, that error grows by the factor the balance does. */
export function originalLoanMargin(annualRatePct, months, paid) {
  const n = Math.round(months), k = Math.round(paid);
  if (!(n > 0) || !(k >= 0) || k >= n) return NaN;
  const r = annualRatePct / 100 / 12;
  if (r === 0) return (1 + 0.01 * k) * n / (n - k);
  const g = Math.pow(1 + r, n), gk = Math.pow(1 + r, k);
  return (1 + 0.01 * (gk - 1) / r) * (g - 1) / (g - gk);
}

/** Normalise raw inputs into a loan description. Everything optional but
 *  price, down, rate and years defaults to zero. */
export function describe(input) {
  const price = Math.max(0, +input.price || 0);
  // A loan under way is described by its balance rather than price minus
  // down payment; the balance may exceed the price (underwater), so it is
  // not clamped. `down` is then price minus balance, floored at zero.
  const inProgress = input.balance != null && Number.isFinite(+input.balance);
  const loan = inProgress ? Math.max(0, +input.balance) : price - Math.min(price, Math.max(0, +input.down || 0));
  const down = Math.max(0, price - loan);
  // Term in months: `months` wins (the remaining term of a loan under way),
  // else whole years.
  const months = input.months != null && Number.isFinite(+input.months)
    ? Math.max(1, Math.round(+input.months))
    : Math.max(1, Math.round(+input.years || 30)) * 12;
  return {
    price, down, loan, inProgress,
    rate: Math.max(0, +input.rate || 0),
    months,
    years: months / 12,
    // What the loan started at, which PMI is charged on. A new loan starts
    // at its loan amount; a loan under way says so with `original`, and
    // without it is treated as starting at today's balance.
    original: inProgress && input.original != null && Number.isFinite(+input.original)
      ? Math.max(0, +input.original) : loan,
    // Dollars that figure may be out by when it was inferred, not entered.
    originalMargin: Math.max(0, +input.originalMargin || 0),
    taxRate: Math.max(0, +input.taxRate || 0),       // % of price per year
    // Property tax as $ per year: given directly, or derived from taxRate.
    tax: input.tax != null && Number.isFinite(+input.tax)
      ? Math.max(0, +input.tax)
      : price * Math.max(0, +input.taxRate || 0) / 100,
    insurance: Math.max(0, +input.insurance || 0),   // $ per year
    // One escrow figure ($ per year) standing in for tax + insurance
    // together, as a servicer's statement often shows it. null when the
    // two are entered separately.
    escrow: input.escrow != null && Number.isFinite(+input.escrow) ? Math.max(0, +input.escrow) : null,
    hoa: Math.max(0, +input.hoa || 0),               // $ per month
    pmiRate: Math.max(0, +input.pmiRate || 0),       // % of the original loan per year
    extra: Math.max(0, +input.extra || 0),           // $ extra principal per payment
    // Every how many months the extra is paid: 1 monthly, 3 quarterly,
    // 12 yearly. 0 means once, with the first payment.
    extraEvery: input.extraEvery == null ? 1 : Math.max(0, Math.round(+input.extraEvery) || 0),
    downPct: price > 0 ? down / price * 100 : 0,
  };
}

/* PMI is decided once, at the start of the loan: it is owed when the
   original loan is over 80% of the price, as a yearly percentage of that
   original loan, and is charged until the balance is down to 78% of the
   original price, the point at which the Homeowners Protection Act makes
   lenders cancel it automatically on a conventional loan. (A borrower may ask
   at 80%; the calculator assumes nobody asks.) A loan under way follows the
   same rule from its own original loan, so the payments still ahead carry
   what the same loan would have carried had it been entered as new. */
export const PMI_CANCEL_LTV = 0.78;
export const PMI_REQUIRED_LTV = 0.80;

/* The comparison allows a dollar: the down payment is whole dollars, so 20%
   of a price that does not divide evenly sits a few cents either side of
   the line, and "20% down" must not be charged PMI over them. An original
   loan that was inferred is allowed its margin as well, for the same
   reason: a loan that started at exactly 80% comes back a few dollars
   either side of it. */
export function needsPMI(d) {
  return d.price > 0 && d.original > d.price * PMI_REQUIRED_LTV + 1 + d.originalMargin && d.pmiRate > 0;
}

/** PMI in a month that opens with `balance` owed: the flat monthly charge,
 *  or nothing once the balance has reached the cancellation point. */
export function pmiDue(d, balance) {
  return needsPMI(d) && balance > d.price * PMI_CANCEL_LTV ? cents(d.original * d.pmiRate / 100 / 12) : 0;
}

/**
 * Month-by-month schedule. `extra` is additional principal, paid every
 * `extraEvery` months starting with the first payment (0: once only).
 * Returns { rows, pi, months, totalInterest, totalPMI, pmiMonths }.
 * Each row: { n, payment, principal, interest, extra, pmi, balance }.
 */
export function amortize(d, { extra = d.extra, extraEvery = d.extraEvery ?? 1 } = {}) {
  const pi = cents(monthlyPI(d.loan, d.rate, d.months / 12));
  const r = d.rate / 100 / 12;
  const rows = [];
  let bal = d.loan, totalInterest = 0, totalPMI = 0, pmiMonths = 0;
  const cap = d.months;
  for (let n = 1; bal > 0.005 && n <= cap; n++) {
    const interest = cents(bal * r);
    const pmi = pmiDue(d, bal);
    let principal = cents(pi - interest);
    // Final scheduled month: whatever float drift remains is cleared here.
    if (n === cap) principal = bal;
    const due = extraEvery > 0 ? (n - 1) % extraEvery === 0 : n === 1;
    let x = due ? Math.min(extra, Math.max(0, bal - principal)) : 0;
    if (principal >= bal) { principal = cents(bal); x = 0; }
    bal = cents(bal - principal - x);
    totalInterest += interest;
    totalPMI += pmi;
    if (pmi) pmiMonths++;
    rows.push({ n, payment: cents(principal + interest), principal, interest, extra: x, pmi, balance: Math.max(0, bal) });
  }
  return {
    rows, pi, months: rows.length,
    totalInterest: cents(totalInterest),
    totalPMI: cents(totalPMI),
    pmiMonths,
  };
}

/**
 * The payments already made on a loan under way, as rows of the same shape
 * as amortize(): the loan as it was taken out (`d.original` over the whole
 * term, `paid` months longer than what is left), run on schedule for its
 * first `paid` payments. PMI is charged in them by the rule the payments
 * ahead follow, so the two halves add up to what the same loan costs when it
 * is entered as new. Extra principal is not part of it: the balance the
 * viewer typed already reflects whatever was paid.
 */
export function pastPayments(d, paid) {
  const k = Math.max(0, Math.round(paid) || 0);
  if (!k) return [];
  return amortize({ ...d, loan: d.original, months: d.months + k }, { extra: 0 }).rows.slice(0, k);
}

/** The first month's bill, split into its parts. Tax and insurance are
 *  either two parts or one escrow part, never both. */
export function monthlyBreakdown(d) {
  const pi = cents(monthlyPI(d.loan, d.rate, d.months / 12));
  return {
    pi,
    tax: d.escrow == null ? cents(d.tax / 12) : 0,
    insurance: d.escrow == null ? cents(d.insurance / 12) : 0,
    escrow: d.escrow == null ? 0 : cents(d.escrow / 12),
    pmi: pmiDue(d, d.loan),
    hoa: cents(d.hoa),
  };
}

/** Roll a monthly schedule up into calendar-year-of-loan rows. */
export function byYear(rows) {
  const out = [];
  for (const r of rows) {
    const y = Math.ceil(r.n / 12);
    let o = out[y - 1];
    if (!o) o = out[y - 1] = { year: y, principal: 0, interest: 0, extra: 0, pmi: 0, balance: 0 };
    o.principal = cents(o.principal + r.principal);
    o.interest = cents(o.interest + r.interest);
    o.extra = cents(o.extra + r.extra);
    o.pmi = cents(o.pmi + r.pmi);
    o.balance = r.balance;
  }
  return out;
}
