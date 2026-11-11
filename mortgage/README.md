# Mortgage Calculator

At `/mortgage/`: **[sites.jackhammons.com/mortgage/](https://sites.jackhammons.com/mortgage/)**

A monthly payment split into principal & interest, property tax, insurance (or one escrow
figure), PMI and HOA dues, with the loan's total interest, total of all payments and payoff
month, what extra principal saves, a chart of the loan over its life and the full
amortization schedule by year or by month. Everything is computed in the browser as the
viewer types; no network request is made.

## What the page does

**Two loan modes**, switched at the top of the form.

- *New loan*: home price, down payment, rate, term and first-payment month. The down
  payment is one fact shown twice, in dollars and as a percentage. Whichever the viewer
  typed last is kept and the other follows it: a typed percentage sets the dollars, rounded
  **up** so that 20% is never a dollar short of 20%, and typed dollars are never rewritten
  when the price changes. The percentage field never shows more than 100.
- *Already paying*: current balance, original term, first payment (or last payment; either
  sets the other from the term) and next payment. From those the page infers the original
  loan amount (`originalLoan()`, the amortization formula run backwards, assuming every
  payment was made on schedule) and shows it under the dates. **The inferred loan stands in
  for the home price wherever one is needed**: a property-tax percentage is a percentage of
  it, and PMI is charged while the balance is over 80% of it and stops at 78% of it. That is
  how the mode was asked for (no price or down-payment question), and it means PMI there is
  not what a statement shows for anyone who has it. The summary gives the whole loan (the
  reconstructed history plus what is ahead) with "still to pay" beneath, and the chart draws
  the whole original term with a Today rule.

**Costs on top.** Tax and insurance are entered separately or as one escrow amount.
Property tax takes `% /yr` (of the price, or of the inferred loan), `$ /yr` or `$ /mo`;
insurance and escrow take `/yr` or `/mo`. Picking another unit converts the number in the
field, so the bill does not change until the viewer types a different number. Switching to
escrow while it is empty or 0 seeds the amount from the tax and insurance figures. HOA dues
are per month; the PMI rate is a percentage of the loan per year.

**Extra principal** is paid every month, every quarter, twice a year, once a year, or once
with the first payment, and is compared against the same loan without it.

**The chart** has two y axes: balances and running totals on the left (solid lines), the
interest and principal inside each payment on the right (dashed). Each line is a toggle in
the legend; which ones are switched off is remembered per viewer in `localStorage` under
`mortgage.hide.totals`. Hovering shows a tooltip for that month. On touch it stays up after
the finger lifts, until a tap outside the chart, and under 560px it sits below the chart
rather than over it.

**The schedule** drops its Extra and PMI columns when no row has a value in them.

**Typed numbers** are read by `parseAmount()` in `src/inputs.js`, because the page prints
its figures in the viewer's locale and has to read the same shapes back:

- `$450,000`, `750k`, `1.2m` and `6.25%` work;
- a separator with nothing after it is a number still being typed (`6.` is 6);
- with both separators present the last one is the decimal (`1.234,56` = `1,234.56`);
- a single comma is a decimal point before one or two digits (`0,92`, `6,5`) and a
  thousands separator before exactly three (`750,000`);
- a single dot before exactly three digits is a thousands separator in **dollar fields
  only** (`750.000`); rate and percentage fields keep `6.125` as 6.125. Property tax counts
  as a dollar field unless its unit is `% /yr`;
- anything else is not a number.

Field values are plain numbers and never go through `Intl`. A value the page writes into a
field (a unit conversion, a value from a link) is shown rounded, to cents or to six
decimals of a percentage, and kept exact until the viewer edits it.

Month fields are `<input type="month">`. Where a browser renders that as a text box the
placeholder says `YYYY-MM`, and `2025-3`, `03/2025` and `3/2025` are read too.

**A field that cannot be read** is named in the line under the headline and marked
`aria-invalid`, and nothing is computed: the breakdown and summary are dashed and the chart
and schedule are replaced by a one-line note. No figure is ever worked out from a stand-in
value, and an unreadable month is an error, not "next month".

## The share link

The inputs round-trip through the URL hash, which never reaches a server. `encodeState()`
and `decodeState()` in `src/inputs.js` both walk one table, `HASH_KEYS`:

| Key | Field | Key | Field |
|---|---|---|---|
| `p` | home price | `t`, `tu` | property tax and its unit (`pct`, `yr`, `mo`) |
| `d` | down payment in dollars, when dollars were typed | `i`, `iu` | insurance and its unit (`yr`, `mo`) |
| `dp` | down payment as a percentage, when that was typed | `w`, `wu` | escrow and its unit (`mo`, `yr`) |
| `b` | current balance | `h` | HOA dues per month |
| `r` | interest rate | `m` | PMI rate |
| `y` | term in years | `x`, `e` | extra principal, and every how many months (0 = once) |
| `s` | first payment, `YYYY-MM` | `em` | 1 when one escrow amount is in use |
| `nx` | next payment, `YYYY-MM` | `lm` | 1 for a loan already under way |

- **A key equal to its default is left out.** An untouched page has no hash, and a new
  loan's first payment stays "next month" for whoever opens the link. The consequence:
  changing a value in `data/defaults.json` changes what existing links that left it out
  show.
- Three things are written even at their default: the escrow amount while escrow is in use
  (a typed 0 comes back as 0; the amount is seeded only when a link has `em=1` and no `w`),
  and both months of a loan under way, since the balance belongs to those dates.
- With neither `d` nor `dp` the down payment is the default percentage of the price; with
  both, `d` wins.
- A link cannot ask for what the form could not: a term or cadence that is not one of the
  offered options, a month outside 01–12, a negative or unreadable number or an unknown
  unit falls back to the default. There is no version key.
- Adding a field means adding a row to `HASH_KEYS`; the round-trip test fails if the table
  and the state disagree.

## How it is put together

```
data/defaults.json      example inputs, the term options, the footer note
src/mortgage.js         the maths: payment, schedule, PMI, yearly roll-up, loan inference
src/inputs.js           typed numbers and months, unit conversion, the share-link codec
src/app.js              reads the form, renders figures, chart and table
src/styles.css
scripts/build.mjs       renders the form and output slots into OUT_DIR
scripts/verify.mjs      deploy gate: ID seam, maths and input reading from the built copy
test/mortgage.test.mjs  unit tests for the maths
test/inputs.test.mjs    unit tests for parsing, units, the down payment and the link
```

`src/mortgage.js` and `src/inputs.js` are each the one implementation of what they do,
imported by `app.js`, by the tests and by `verify.mjs` (from the *built* copy). Do not fork
either into `app.js`: what is left there has no unit test.

PMI is charged above 80% loan-to-value and stops when the balance reaches 78% of the
original price, the Homeowners Protection Act's automatic cancellation point. The 80% test
allows one dollar, so a whole-dollar down payment of "20%" is never charged. Tax, insurance
and HOA are held flat.

Nothing date-dependent is rendered at build time: the first-payment month defaults to the
viewer's next month and the Today rule is read from the device clock. The rate in
`data/defaults.json` is an example, not a quote; the rate field's hint and the footer say
so. There is no method section on the page (removed on request); the maths is documented in
the comments of `src/mortgage.js` and in the tests.

The build references `./styles.css`, `./app.js`, `./mortgage.js` and `./inputs.js` as plain
relative paths. `scripts/build-all.mjs` stamps every asset URL with a content hash after
`verify.mjs` has run, so nothing here adds a `?v=`.

## Working on it

```bash
node --test mortgage/test/*.test.mjs
node mortgage/scripts/build.mjs && node mortgage/scripts/verify.mjs    # -> dist/mortgage/
```

A standalone build writes `dist/mortgage/`, where the multi-site build would put it, and
refuses to clear an `OUT_DIR` that holds this site's source or files that are not a
previous build. `app.js` is only exercised in a browser, so after changing it look at the
built page in both loan modes, at phone and desktop widths.
