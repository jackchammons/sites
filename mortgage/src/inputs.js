/* What the viewer types and what a share link carries — imported by the
 * browser (app.js), the unit tests and the deploy gate (verify.mjs), the
 * same three ways as mortgage.js beside it. Pure functions: no DOM, and no
 * clock (the caller says which month "next month" is).
 */

/**
 * A typed number, or NaN when the text is not one. Accepts "$750,000",
 * "750k", "1.2m", "6.25%", and the separators other locales use, because the
 * page prints its own figures in the viewer's locale and has to be able to
 * read back what it shows:
 *   - a separator with nothing after it is a number still being typed
 *     ("6." reads as 6);
 *   - with both separators present the last one is the decimal point
 *     ("1.234,56" and "1,234.56" are the same number);
 *   - a lone comma is a decimal point ("0,92", "6,5") unless exactly three
 *     digits follow it, when it groups thousands ("750,000");
 *   - a lone dot is a decimal point ("6.125"), except in a money field
 *     (`money: true`), where exactly three digits after it make it a
 *     thousands separator too ("750.000");
 *   - several of the same separator can only be grouping ("1.234.567").
 * A group has to look like one: one to three digits not starting with 0
 * before it, so "0,125" and "0.125" stay fractions. After a k or m suffix a
 * lone separator is always the decimal point ("1.250m" is 1.25 million).
 */
export function parseAmount(text, { money = false } = {}) {
  let t = String(text ?? '').trim().toLowerCase().replace(/[$%\s_'’]/g, '');
  const scale = t.endsWith('k') ? 1e3 : t.endsWith('m') ? 1e6 : 1;
  if (scale > 1) t = t.slice(0, -1);
  if (/\d[.,]$/.test(t)) t = t.slice(0, -1);
  if (!/^[\d.,]+$/.test(t) || !/\d/.test(t)) return NaN;

  const dots = t.split('.').length - 1, commas = t.split(',').length - 1;
  let dec = '';
  if (dots && commas) {
    dec = t.lastIndexOf('.') > t.lastIndexOf(',') ? '.' : ',';
  } else if (dots + commas === 1) {
    const sep = dots ? '.' : ',';
    const [head, tail] = t.split(sep);
    const groups = scale === 1 && tail.length === 3 && /^[1-9]\d{0,2}$/.test(head) && (sep === ',' || money);
    if (!groups) dec = sep;
  }
  const parts = dec ? t.split(dec) : [t, ''];
  if (parts.length !== 2 || !/^\d*$/.test(parts[1])) return NaN;
  const whole = parts[0];
  if (/\D/.test(whole) && !/^[1-9]\d{0,2}(?:[.,]\d{3})+$/.test(whole)) return NaN;
  const x = Number(`${whole.replace(/\D/g, '') || '0'}.${parts[1] || '0'}`);
  // Scaling can leave float dust (1.15m); a millionth of a dollar is plenty.
  return scale > 1 ? +(x * scale).toFixed(6) : x;
}

/**
 * A typed month as "YYYY-MM", or null. A month input gives that form itself;
 * where the browser renders it as a text box the viewer types it, so
 * "2025-3", "03/2025" and "3/2025" are read too. Years outside 1900–2200 are
 * refused: nothing here is that old, and Date maps a two-digit year to 19xx.
 */
export function parseMonth(text) {
  const t = String(text ?? '').trim();
  const a = /^(\d{4})\s*[-/.]\s*(\d{1,2})$/.exec(t), b = /^(\d{1,2})\s*[-/.]\s*(\d{4})$/.exec(t);
  const y = a ? +a[1] : b ? +b[2] : NaN, mo = a ? +a[2] : b ? +b[1] : NaN;
  if (!(y >= 1900 && y <= 2200) || !(mo >= 1 && mo <= 12)) return null;
  return `${y}-${String(mo).padStart(2, '0')}`;
}

/**
 * The same yearly cost expressed in another unit: 'pct' (percent of `base`
 * per year), 'yr' ($ per year) or 'mo' ($ per month). NaN when it cannot be
 * expressed, such as a percentage of nothing.
 */
export function convertUnit(x, from, to, base = NaN) {
  if (from === to) return x;
  const yearly = from === 'mo' ? x * 12 : from === 'pct' ? base * x / 100 : x;
  const out = to === 'mo' ? yearly / 12 : to === 'pct' ? yearly / base * 100 : yearly;
  // Eight decimals keeps the monthly figure to the cent and drops float dust.
  return Number.isFinite(out) ? +out.toFixed(8) : NaN;
}

/** Whole dollars for a typed down-payment percentage, rounded up so that a
 *  typed 20% is never a dollar short of 20% of the price. */
export function downFromPct(price, pct) {
  return Math.ceil(+(price * Math.min(pct, 100) / 100).toFixed(6));
}

/** The percentage a dollar down payment comes to, as the field shows it:
 *  two decimals, and never more than the whole price. */
export function downPctOf(down, price) {
  return price > 0 ? +Math.min(100, down / price * 100).toFixed(2) : 0;
}

/* ---- the share link ------------------------------------------------- */

const UNITS = { taxUnit: ['pct', 'yr', 'mo'], insUnit: ['yr', 'mo'], escrowUnit: ['mo', 'yr'] };

/* One row per key in the hash: [key, state field, kind]. Reading and writing
   both walk this table, so a field cannot be written and not read back. */
export const HASH_KEYS = [
  ['p', 'price', 'num'], ['d', 'down', 'num'], ['dp', 'downPct', 'pct'], ['b', 'balance', 'num'],
  ['r', 'rate', 'num'], ['y', 'years', 'term'], ['s', 'start', 'month'], ['nx', 'next', 'month'],
  ['t', 'taxRate', 'num'], ['tu', 'taxUnit', 'unit'], ['i', 'insurance', 'num'], ['iu', 'insUnit', 'unit'],
  ['w', 'escrow', 'num'], ['wu', 'escrowUnit', 'unit'], ['h', 'hoa', 'num'], ['m', 'pmiRate', 'num'],
  ['x', 'extra', 'num'], ['e', 'extraEvery', 'cadence'], ['em', 'escrowMode', 'flag'], ['lm', 'progressMode', 'flag'],
];

/**
 * The state the page opens with: data/defaults.json plus the fields that
 * have no fixed default. The down payment is a percentage until dollars are
 * typed (exactly one of `down` and `downPct` is set), the balance is unset,
 * and both months are `nextMonth` ("YYYY-MM"), which the caller reads from
 * the viewer's clock.
 */
export function defaultState(defaults, nextMonth) {
  return {
    ...defaults, down: null, balance: null, start: nextMonth, next: nextMonth,
    escrowMode: !!defaults.escrowMode, progressMode: false,
  };
}

/**
 * A state as the text after "#". A key whose value is the default is left
 * out, so an untouched page has no hash at all and a new loan's first
 * payment stays "next month" for whoever opens the link. Three things are
 * written even at their default, because they are facts rather than
 * starting points: the escrow amount while escrow is the mode in use (a
 * typed 0 must come back as 0), and both months of a loan under way (the
 * balance belongs to those dates). A field that is not a number (NaN, or
 * null for unset) is left out.
 */
export function encodeState(state, defaults, nextMonth) {
  const base = defaultState(defaults, nextMonth);
  const q = new URLSearchParams();
  for (const [key, field, kind] of HASH_KEYS) {
    const v = state[field];
    if (v == null || (typeof v === 'number' && !Number.isFinite(v))) continue;
    const fact = (field === 'escrow' && state.escrowMode)
      || ((field === 'start' || field === 'next') && state.progressMode);
    if (v === base[field] && !fact) continue;
    q.set(key, kind === 'flag' ? (v ? '1' : '0') : String(v));
  }
  return q.toString();
}

/**
 * The state a hash describes, laid over the defaults. Anything a link could
 * carry that the form could not is dropped in favour of the default: a term
 * or cadence that is not one of the offered options (a term of 50,000 years
 * would otherwise be scheduled), a month outside 01–12, a negative or
 * unreadable number, an unknown unit. `terms` and `cadences` are the option
 * lists of the two selects.
 *
 * `escrow` comes back null when escrow mode is on and the link gave no
 * amount: the page then works one out from tax and insurance, which it must
 * not do over an amount the link did give, 0 included.
 */
export function decodeState(hash, defaults, nextMonth, { terms = [], cadences = [] } = {}) {
  const q = new URLSearchParams(String(hash ?? '').replace(/^#/, ''));
  const st = defaultState(defaults, nextMonth);
  const amount = raw => { const x = parseAmount(raw); return Number.isFinite(x) && x >= 0 ? x : undefined; };
  const oneOf = (list, raw) => list.find(o => String(o) === raw);
  const read = {
    num: amount,
    pct: raw => { const x = amount(raw); return x <= 100 ? x : undefined; },
    term: raw => oneOf(terms, raw),
    cadence: raw => oneOf(cadences, raw),
    month: raw => (/^\d{4}-\d{2}$/.test(raw) && parseMonth(raw)) || undefined,
    unit: (raw, field) => oneOf(UNITS[field], raw),
    flag: raw => raw === '1' ? true : raw === '0' ? false : undefined,
  };
  for (const [key, field, kind] of HASH_KEYS) {
    if (!q.has(key)) continue;
    const v = read[kind](q.get(key), field);
    if (v !== undefined) st[field] = v;
  }
  // Dollars are the exact figure, so they win when a link carries both.
  if (st.down != null) st.downPct = null;
  if (st.escrowMode && !q.has('w')) st.escrow = null;
  return st;
}
