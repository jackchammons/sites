# Mortgage Calculator

At `/mortgage/`: **[sites.jackhammons.com/mortgage/](https://sites.jackhammons.com/mortgage/)**

Enter a price, down payment, rate and term and it shows the monthly payment split into
principal & interest, property tax, insurance, PMI and HOA dues. It also shows the loan's
total interest and payoff date, when PMI drops off, a balance chart (hover it for any
month), and the full amortization schedule by year or by month. Extra monthly principal
is compared against the same loan without it.

## How it is put together

```
data/defaults.json     example inputs (the rate is a placeholder, not a quote)
src/mortgage.js        the maths: payment, schedule, PMI, yearly roll-up
src/app.js             reads the form, renders figures, chart and table
src/styles.css
scripts/build.mjs      renders the form + method copy into OUT_DIR
scripts/verify.mjs     deploy gate: ID seam + maths checked on the built copy
test/mortgage.test.mjs unit tests (node --test)
```

Everything runs in the browser and no network request is made. The inputs are kept in
the URL hash (`#p=750000&d=150000&r=6.25&y=30…`), so a link reproduces a scenario
without the numbers ever reaching a server. Inputs accept `750k`, `$1.2m`, `6.25%`.

PMI is charged above 80% loan-to-value and stops when the balance reaches 78% of the
original price, the Homeowners Protection Act's automatic cancellation point. Tax,
insurance and HOA are held flat.

## Working on it

```bash
node --test mortgage/test/*.test.mjs
node mortgage/scripts/build.mjs && node mortgage/scripts/verify.mjs
```
