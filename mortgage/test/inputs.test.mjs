import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseAmount, parseMonth, convertUnit, downFromPct, downPctOf, defaultState, encodeState, decodeState, HASH_KEYS } from '../src/inputs.js';
import { describe, needsPMI, monthlyBreakdown } from '../src/mortgage.js';

const data = JSON.parse(fs.readFileSync(new URL('../data/defaults.json', import.meta.url), 'utf8'));
const DEFAULTS = data.inputs;
const CHOICES = { terms: data.terms, cadences: [1, 3, 6, 12, 0] };
const NEXT = '2026-12';
const money = s => parseAmount(s, { money: true });

test('plain numbers, symbols and the k/m shorthand', () => {
  assert.equal(parseAmount('750000'), 750000);
  assert.equal(money('$450,000'), 450000);
  assert.equal(parseAmount('$450,000'), 450000);
  assert.equal(money('750k'), 750000);
  assert.equal(money('1.2m'), 1200000);
  assert.equal(money('$1.2M'), 1200000);
  assert.equal(money('1,5m'), 1500000);
  assert.equal(money('1.250m'), 1250000);
  assert.equal(money('1.15m'), 1150000);
  assert.equal(parseAmount('6.25%'), 6.25);
  assert.equal(parseAmount(' 6.25 '), 6.25);
  assert.equal(parseAmount('.5'), 0.5);
  assert.equal(parseAmount('0'), 0);
  assert.equal(parseAmount(1800), 1800);
});

test('a trailing separator is a number still being typed', () => {
  assert.equal(parseAmount('6.'), 6);
  assert.equal(parseAmount('6,'), 6);
  assert.equal(money('750.'), 750);
  assert.equal(money('1,234.'), 1234);
});

test('a single comma: decimal before one or two digits, thousands before three', () => {
  assert.equal(parseAmount('0,92'), 0.92);
  assert.equal(parseAmount('6,5'), 6.5);
  assert.equal(parseAmount('6,25'), 6.25);
  assert.equal(parseAmount('6,5%'), 6.5);
  assert.equal(money('750,000'), 750000);
  assert.equal(parseAmount('750,000'), 750000);
  assert.equal(money('1,800'), 1800);
  // A group needs something to group: these cannot be thousands.
  assert.equal(parseAmount('0,125'), 0.125);
  assert.equal(parseAmount('1234,567'), 1234.567);
  assert.equal(parseAmount('6,1250'), 6.125);
});

test('with both separators the last one is the decimal', () => {
  assert.equal(money('1.234,56'), 1234.56);
  assert.equal(money('1,234.56'), 1234.56);
  assert.equal(parseAmount('1.234,56'), 1234.56);
  assert.equal(parseAmount('1,234.56'), 1234.56);
  assert.equal(money('1.234.567,89'), 1234567.89);
  assert.equal(money('1,234,567.89'), 1234567.89);
  assert.equal(money('3 694,30 $'), 3694.3);
});

test('a single dot before three digits is thousands in a money field only', () => {
  assert.equal(money('750.000'), 750000);
  assert.equal(money('1.800'), 1800);
  assert.equal(parseAmount('6.125'), 6.125);
  assert.equal(parseAmount('750.000'), 750);
  assert.equal(money('1800.50'), 1800.5);
  assert.equal(money('0.125'), 0.125);
  assert.equal(money('1234.567'), 1234.567);
  // Several dots can only be grouping, whatever the field.
  assert.equal(money('1.234.567'), 1234567);
  assert.equal(parseAmount('1.234.567'), 1234567);
  assert.equal(money('1,234,567'), 1234567);
});

test('what is not a number is NaN, never a guess', () => {
  for (const s of ['', ' ', '.', ',', 'abc', '$', 'k', '6..5', '1.2.3', '1,23,456', '1.2,3.4', '12,3456,789', '-5', '1e5', '6 percent', null, undefined]) {
    assert.ok(Number.isNaN(money(s)), `money "${s}" read as ${money(s)}`);
    assert.ok(Number.isNaN(parseAmount(s)), `"${s}" read as ${parseAmount(s)}`);
  }
});

test('months: the picker form and the ones typed into a text box', () => {
  assert.equal(parseMonth('2025-03'), '2025-03');
  assert.equal(parseMonth('2025-3'), '2025-03');
  assert.equal(parseMonth('03/2025'), '2025-03');
  assert.equal(parseMonth('3/2025'), '2025-03');
  assert.equal(parseMonth(' 2025-12 '), '2025-12');
  for (const s of ['', '2025', '2025-00', '2025-13', '13/2025', '0/2025', 'March 2025', '25-03', '0001-01', '9999-12', '2025-03-01', null]) {
    assert.equal(parseMonth(s), null, `"${s}"`);
  }
});

test('a unit change restates the same cost and leaves the monthly bill alone', () => {
  assert.equal(convertUnit(0.92, 'pct', 'yr', 750000), 6900);
  assert.equal(convertUnit(0.92, 'pct', 'mo', 750000), 575);
  assert.equal(convertUnit(6900, 'yr', 'pct', 750000), 0.92);
  assert.equal(convertUnit(575, 'mo', 'pct', 750000), 0.92);
  assert.equal(convertUnit(1800, 'yr', 'mo'), 150);
  assert.equal(convertUnit(150, 'mo', 'yr'), 1800);
  assert.equal(convertUnit(42, 'yr', 'yr'), 42);
  assert.ok(Number.isNaN(convertUnit(6900, 'yr', 'pct', 0)));
  assert.ok(Number.isNaN(convertUnit(0.92, 'pct', 'yr')));
  assert.ok(Number.isNaN(convertUnit(NaN, 'yr', 'mo')));

  // The bill for a tax figure in a unit, as the page computes it.
  const bill = (x, unit, price) => monthlyBreakdown(describe({
    price, rate: 6, years: 30,
    ...(unit === 'pct' ? { taxRate: x } : { tax: unit === 'mo' ? x * 12 : x }),
  })).tax;
  const units = ['pct', 'yr', 'mo'];
  for (const price of [750000, 612347, 437500, 1234567]) {
    for (const [x0, u0] of [[0.92, 'pct'], [1.137, 'pct'], [7000, 'yr'], [6431.17, 'yr'], [583.33, 'mo']]) {
      const before = bill(x0, u0, price);
      // Round the units in every order, and back to where it started.
      for (const path of [[1, 2, 0], [2, 1, 0], [1, 0, 2, 0]]) {
        let x = x0, u = u0;
        for (const step of path) {
          const to = units[(units.indexOf(u0) + step) % 3];
          x = convertUnit(x, u, to, price);
          u = to;
          assert.equal(bill(x, u, price), before, `${x0} ${u0} at ${price} became ${x} ${u}`);
        }
      }
    }
  }
});

test('a typed 20% down is never charged PMI', () => {
  // Rounded to the nearest dollar instead, 20% of 80 of these 200 prices
  // leaves the loan a few cents over 80%.
  for (let price = 300000; price < 300200; price++) {
    const down = downFromPct(price, 20);
    assert.ok(down >= price * 0.2 && down < price * 0.2 + 1, `${price}: ${down}`);
    assert.equal(needsPMI(describe({ price, down, rate: 6, years: 30, pmiRate: 0.5 })), false, `price ${price}`);
  }
  assert.equal(downFromPct(612347, 20), 122470);
  assert.equal(downFromPct(750000, 20), 150000);
  assert.equal(downFromPct(612350, 20), 122470);
  assert.equal(downFromPct(500000, 150), 500000);
  // Dollars rounded the other way are within the tolerance too.
  assert.equal(needsPMI(describe({ price: 612347, down: 122469, rate: 6, years: 30, pmiRate: 0.5 })), false);
  assert.equal(needsPMI(describe({ price: 612347, down: 122000, rate: 6, years: 30, pmiRate: 0.5 })), true);
});

test('the percentage shown for a dollar down payment', () => {
  assert.equal(downPctOf(150000, 750000), 20);
  assert.equal(downPctOf(50000, 437500), 11.43);
  assert.equal(downPctOf(900000, 750000), 100);
  assert.equal(downPctOf(1000, 0), 0);
});

/* ---- the share link ---- */

const open = () => defaultState(DEFAULTS, NEXT);
const roundTrip = st => decodeState(encodeState(st, DEFAULTS, NEXT), DEFAULTS, NEXT, CHOICES);

test('an untouched page has no hash, and the hash of a few edits is only those edits', () => {
  assert.equal(encodeState(open(), DEFAULTS, NEXT), '');
  assert.deepEqual(decodeState('', DEFAULTS, NEXT, CHOICES), open());
  assert.equal(encodeState({ ...open(), price: 400000 }, DEFAULTS, NEXT), 'p=400000');
  assert.equal(encodeState({ ...open(), rate: 7.125, years: 15 }, DEFAULTS, NEXT), 'r=7.125&y=15');
});

test('every field survives the link, in both loan modes and both escrow modes', () => {
  // A second value for each field, different from its default.
  const other = {
    price: 437500, down: 50000, downPct: 11.5, balance: 381234.56, origPrice: 512345.5, rate: 7.125, years: 15,
    start: '2024-03', next: '2027-01', taxRate: 6431.17, taxUnit: 'yr', insurance: 150, insUnit: 'mo',
    escrow: 725.5, escrowUnit: 'yr', hoa: 85, pmiRate: 0.5, extra: 200, extraEvery: 0,
  };
  const fields = new Set(HASH_KEYS.map(([, field]) => field));
  assert.deepEqual([...fields].sort(), Object.keys(open()).sort(), 'the key table covers the state, field for field');

  for (const progressMode of [false, true]) {
    for (const escrowMode of [false, true]) {
      const base = { ...open(), progressMode, escrowMode };
      assert.deepEqual(roundTrip(base), base, `defaults, lm=${progressMode} em=${escrowMode}`);
      // One field at a time, so a key that is dropped cannot hide behind another.
      for (const [field, value] of Object.entries(other)) {
        const st = { ...base, [field]: value };
        // The down payment is dollars or a percentage, never both.
        if (field === 'down') st.downPct = null;
        if (field === 'downPct') st.down = null;
        assert.deepEqual(roundTrip(st), st, `${field}, lm=${progressMode} em=${escrowMode}`);
      }
      const all = { ...base, ...other, downPct: null };
      assert.deepEqual(roundTrip(all), all, `everything, lm=${progressMode} em=${escrowMode}`);
    }
  }
});

test('an escrow of 0 survives; an escrow the link never gave is left for the page to seed', () => {
  const zero = { ...open(), escrowMode: true, escrow: 0 };
  assert.equal(encodeState(zero, DEFAULTS, NEXT), 'w=0&em=1');
  assert.equal(roundTrip(zero).escrow, 0);
  assert.equal(decodeState('em=1', DEFAULTS, NEXT, CHOICES).escrow, null);
  assert.equal(decodeState('em=1&w=0', DEFAULTS, NEXT, CHOICES).escrow, 0);
  assert.equal(decodeState('', DEFAULTS, NEXT, CHOICES).escrow, DEFAULTS.escrow);
});

test('the original price of a loan under way is carried only when one was given', () => {
  const under = { ...open(), progressMode: true, balance: 695265 };
  assert.ok(!/(^|&)op=/.test(encodeState(under, DEFAULTS, NEXT)));
  assert.equal(roundTrip(under).origPrice, null);
  assert.match(encodeState({ ...under, origPrice: 750000 }, DEFAULTS, NEXT), /(^|&)op=750000(&|$)/);
  assert.equal(roundTrip({ ...under, origPrice: 750000 }).origPrice, 750000);
  assert.equal(decodeState('op=750k', DEFAULTS, NEXT, CHOICES).origPrice, 750000);
  for (const op of ['', 'abc', '-1']) assert.equal(decodeState(`lm=1&op=${op}`, DEFAULTS, NEXT, CHOICES).origPrice, null, `op=${op}`);
  // An empty field is NaN to the form and is left out like any unread one.
  assert.ok(!/(^|&)op=/.test(encodeState({ ...under, origPrice: NaN }, DEFAULTS, NEXT)));
});

test('an untouched start month stays relative to whoever opens the link', () => {
  const hash = encodeState({ ...open(), price: 500000 }, DEFAULTS, NEXT);
  assert.ok(!/(^|&)(s|nx)=/.test(hash), hash);
  const later = decodeState(hash, DEFAULTS, '2027-12', CHOICES);
  assert.equal(later.start, '2027-12');
  assert.equal(later.next, '2027-12');
  // A month the viewer chose is carried.
  assert.equal(decodeState(encodeState({ ...open(), start: '2027-03' }, DEFAULTS, NEXT), DEFAULTS, '2027-12', CHOICES).start, '2027-03');
  // A loan under way is dated: its balance belongs to those months.
  const under = encodeState({ ...open(), progressMode: true, balance: 500000 }, DEFAULTS, NEXT);
  const opened = decodeState(under, DEFAULTS, '2027-12', CHOICES);
  assert.equal(opened.start, NEXT);
  assert.equal(opened.next, NEXT);
});

test('the down payment follows the price unless dollars were typed', () => {
  const st = decodeState('p=400000', DEFAULTS, NEXT, CHOICES);
  assert.equal(st.down, null);
  assert.equal(st.downPct, DEFAULTS.downPct);
  const dollars = decodeState('p=400000&d=150000', DEFAULTS, NEXT, CHOICES);
  assert.equal(dollars.down, 150000);
  assert.equal(dollars.downPct, null);
  assert.equal(decodeState('dp=5', DEFAULTS, NEXT, CHOICES).downPct, 5);
  assert.equal(decodeState('dp=150', DEFAULTS, NEXT, CHOICES).downPct, DEFAULTS.downPct);
  const both = decodeState('d=90000&dp=5', DEFAULTS, NEXT, CHOICES);
  assert.equal(both.down, 90000);
  assert.equal(both.downPct, null);
});

test('a link cannot ask for what the form could not', () => {
  const read = hash => decodeState(hash, DEFAULTS, NEXT, CHOICES);
  for (const y of ['50000', '0', '7.5', '-30', '31', 'abc', '']) {
    assert.equal(read(`y=${y}`).years, DEFAULTS.years, `y=${y}`);
  }
  for (const y of CHOICES.terms) assert.equal(read(`y=${y}`).years, y);
  for (const e of ['2', '7', '-1', '1.5']) assert.equal(read(`e=${e}`).extraEvery, DEFAULTS.extraEvery, `e=${e}`);
  for (const e of CHOICES.cadences) assert.equal(read(`e=${e}`).extraEvery, e);
  for (const s of ['2026-13', '2026-00', '2026-1', '03/2026', '0026-01', 'soon']) {
    assert.equal(read(`s=${s}`).start, NEXT, `s=${s}`);
    assert.equal(read(`nx=${s}`).next, NEXT, `nx=${s}`);
  }
  assert.equal(read('s=2026-01').start, '2026-01');
  assert.equal(read('p=-5').price, DEFAULTS.price);
  assert.equal(read('p=abc&r=').rate, DEFAULTS.rate);
  assert.equal(read('tu=week&iu=pct&wu=').taxUnit, DEFAULTS.taxUnit);
  assert.equal(read('iu=pct').insUnit, DEFAULTS.insUnit);
  assert.equal(read('em=yes&lm=2').escrowMode, false);
  assert.equal(read('lm=2').progressMode, false);
  assert.deepEqual(read('#<script>=1&zz=9'), open());
});

test('a link that spells out every key, defaults included, reads the same', () => {
  const old = 'p=750000&d=150000&b=&nx=2026-12&r=6.5&y=30&t=0.92&tu=pct&i=1800&iu=yr&w=0&wu=mo&h=0&m=0&x=0&e=1&s=2026-12';
  const st = decodeState('#' + old, DEFAULTS, '2027-06', CHOICES);
  assert.equal(st.rate, 6.5);
  assert.equal(st.down, 150000);
  assert.equal(st.balance, null);
  assert.equal(st.start, '2026-12');
  assert.equal(st.progressMode, false);
  assert.equal(decodeState('p=750k&r=6.25%25', DEFAULTS, NEXT, CHOICES).price, 750000);
});

test('a field that cannot be read is left out of the link', () => {
  const hash = encodeState({ ...open(), price: NaN, rate: 7, start: null }, DEFAULTS, NEXT);
  assert.equal(hash, 'r=7');
});
