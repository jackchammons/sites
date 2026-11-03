#!/usr/bin/env node
/*
 * Build for the Mortgage Calculator.
 *
 * The calculator runs in the browser, so this renders the form (with the
 * example inputs from data/defaults.json), the labelled output slots and the
 * methodology copy, then copies src/ beside it. src/app.js does every
 * calculation, importing the same src/mortgage.js that the tests and the
 * deploy gate exercise — one implementation of the maths.
 *
 * Nothing date-dependent is baked in: the loan's start month defaults to the
 * viewer's next month, filled in by app.js.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PMI_CANCEL_LTV, PMI_REQUIRED_LTV } from '../src/mortgage.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// The multi-site build sets OUT_DIR to dist/<slug>/; a standalone run writes dist/.
const dist = process.env.OUT_DIR
  ? path.resolve(process.env.OUT_DIR)
  : path.join(root, '..', 'dist');

const data = JSON.parse(fs.readFileSync(path.join(root, 'data/defaults.json'), 'utf8'));
const esc = s => String(s).replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const v = data.inputs;
const downAmt = Math.round(v.price * v.downPct / 100);

/* A money field: a "$" adornment, a numeric text input, a hint line. */
const field = ({ id, label, value, pre, post, hint, step = 'any', mode = 'decimal' }) => `
      <label class="field" for="${id}">
        <span class="lbl">${esc(label)}</span>
        <span class="box">${pre ? `<i>${esc(pre)}</i>` : ''}<input id="${id}" name="${id}" type="text" inputmode="${mode}" autocomplete="off" spellcheck="false" value="${esc(value)}" data-step="${step}">${post ? `<i>${esc(post)}</i>` : ''}</span>
        ${hint ? `<span class="hint" id="${id}-hint">${hint}</span>` : ''}
      </label>`;

const terms = data.terms.map(t =>
  `<option value="${t}"${t === v.years ? ' selected' : ''}>${t} years</option>`).join('');

/* The parts of a monthly bill. Order is fixed (it is the categorical colour
   order too) so a part keeps its colour whether or not it is present. */
const PARTS = [
  ['pi', 'Principal & interest'],
  ['tax', 'Property tax'],
  ['insurance', 'Home insurance'],
  ['pmi', 'Mortgage insurance (PMI)'],
  ['hoa', 'HOA dues'],
];
const legend = PARTS.map(([k, label], i) => `
          <li id="row-${k}" class="s${i + 1}"><span class="sw"></span><span class="nm">${esc(label)}</span><b id="bd-${k}">—</b></li>`).join('');
const segs = PARTS.map(([k], i) => `<span class="seg s${i + 1}" id="seg-${k}"></span>`).join('');

const SUMMARY = [
  ['loan', 'Loan amount'],
  ['interest', 'Total interest'],
  ['cost', 'Total of all payments'],
  ['payoff', 'Paid off'],
  ['pmiend', 'PMI ends'],
  ['saved', 'Extra principal saves'],
];
const summary = SUMMARY.map(([k, label]) => `
        <div class="fact" id="fact-${k}">
          <dt>${esc(label)}</dt>
          <dd><span id="sum-${k}">—</span><small id="sub-${k}"></small></dd>
        </div>`).join('');

const built = new Date().toISOString();
const pct = x => `${Math.round(x * 100)}%`;

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(data.title)} — ${esc(data.tagline)}</title>
<meta name="description" content="${esc(data.tagline)} Monthly payment with property tax, insurance, PMI and HOA dues, the full amortization schedule, and how much extra principal saves.">
<meta name="theme-color" content="#101614" media="(prefers-color-scheme: dark)">
<meta name="theme-color" content="#f6f8f5" media="(prefers-color-scheme: light)">
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🏠</text></svg>">
<link rel="stylesheet" href="./styles.css">
<script type="application/json" id="defaults">${JSON.stringify(data.inputs).replace(/</g, '\\u003c')}</script>
<script type="module" src="./app.js"></script>
</head>
<body>

<header><div class="wrap">
  <p class="eyebrow">sites.jackhammons.com · mortgage</p>
  <h1>${esc(data.title)}</h1>
  <p class="lede">${esc(data.tagline)}</p>
</div></header>

<main><div class="wrap">
  <div class="grid">

  <form class="panel inputs" id="form" autocomplete="off" novalidate>
    <h2>The loan</h2>
    ${field({ id: 'in-price', label: 'Home price', value: v.price, pre: '$', mode: 'numeric' })}
    <div class="pair">
      ${field({ id: 'in-down', label: 'Down payment', value: downAmt, pre: '$', mode: 'numeric' })}
      ${field({ id: 'in-downpct', label: 'Down %', value: v.downPct, post: '%' })}
    </div>
    <div class="pair">
      ${field({ id: 'in-rate', label: 'Interest rate', value: v.rate, post: '%', hint: 'Fixed, annual' })}
      <label class="field" for="in-years">
        <span class="lbl">Term</span>
        <span class="box"><select id="in-years" name="in-years">${terms}</select></span>
      </label>
    </div>
    <label class="field" for="in-start">
      <span class="lbl">First payment</span>
      <span class="box"><input id="in-start" name="in-start" type="month"></span>
    </label>

    <h2>Costs on top</h2>
    <div class="pair">
      ${field({ id: 'in-tax', label: 'Property tax', value: v.taxRate, post: '%/yr', hint: 'Of the price' })}
      ${field({ id: 'in-ins', label: 'Insurance', value: v.insurance, pre: '$', post: '/yr', mode: 'numeric' })}
    </div>
    <div class="pair">
      ${field({ id: 'in-hoa', label: 'HOA dues', value: v.hoa, pre: '$', post: '/mo', mode: 'numeric' })}
      ${field({ id: 'in-pmi', label: 'PMI rate', value: v.pmiRate, post: '%/yr', hint: 'Under 20% down' })}
    </div>

    <h2>Pay it down faster</h2>
    ${field({ id: 'in-extra', label: 'Extra principal', value: v.extra, pre: '$', post: '/mo', mode: 'numeric', hint: 'Added to every payment' })}

    <div class="actions">
      <button type="button" id="btn-share">Copy link to these numbers</button>
      <button type="button" id="btn-reset" class="quiet">Reset</button>
      <span class="status" id="share-status" role="status" aria-live="polite"></span>
    </div>
  </form>

  <section class="panel results" aria-live="polite">
    <p class="eyebrow">Monthly payment</p>
    <p class="total"><span id="out-total">—</span><small>/mo</small></p>
    <p class="sub" id="out-sub"></p>
    <div class="stack" id="stack" role="img" aria-label="Monthly payment broken into its parts">${segs}</div>
    <ul class="legend">${legend}
    </ul>
    <dl class="facts">${summary}
    </dl>
  </section>

  </div>

  <section>
    <div class="head"><h2>The balance, year by year</h2><span class="eyebrow" id="chart-note"></span></div>
    <div class="panel chart-panel">
      <ul class="chart-legend" id="chart-legend">
        <li class="s1"><span class="sw"></span>Balance on schedule</li>
        <li class="s2" id="legend-extra"><span class="sw"></span>With extra principal</li>
      </ul>
      <div class="chart" id="chart"></div>
      <div class="tip" id="tip" hidden></div>
    </div>
  </section>

  <section>
    <div class="head"><h2>Amortization schedule</h2>
      <div class="seg-toggle" role="group" aria-label="Schedule detail">
        <button type="button" id="view-year" aria-pressed="true">By year</button>
        <button type="button" id="view-month" aria-pressed="false">By month</button>
      </div>
    </div>
    <div class="panel table-wrap">
      <table class="schedule">
        <thead><tr><th scope="col" id="th-period">Year</th><th scope="col">Principal</th><th scope="col">Interest</th><th scope="col">Extra</th><th scope="col">PMI</th><th scope="col">Balance</th></tr></thead>
        <tbody id="schedule"></tbody>
      </table>
    </div>
  </section>

  <section class="method">
    <div class="head"><h2>How it is worked out</h2><span class="eyebrow">method</span></div>
    <div class="panel prose">
      <p><b>Principal and interest</b> is the standard fixed-rate amortization payment:
        <code>P × r ÷ (1 − (1 + r)<sup>−n</sup>)</code>, where <code>P</code> is the loan,
        <code>r</code> the annual rate ÷ 12 and <code>n</code> the number of monthly payments.
        Each month's interest is the outstanding balance × <code>r</code>, rounded to the cent; the rest of
        the payment is principal. The final payment is trimmed so the balance ends at exactly zero.</p>
      <p><b>Property tax</b> is the rate × the price ÷ 12 — a stand-in for the assessed value, which is
        usually close to but not the same as what you pay. <b>Insurance</b> is the yearly premium ÷ 12, and
        <b>HOA</b> dues are taken as given. Both of those and the tax are held flat; in reality they rise.</p>
      <p><b>PMI</b> applies when the loan is more than ${pct(PMI_REQUIRED_LTV)} of the price, at the yearly rate
        × the original loan ÷ 12. It is dropped once the balance falls to ${pct(PMI_CANCEL_LTV)} of the original
        price, the point at which the Homeowners Protection Act requires a lender to cancel it automatically on
        a conventional loan. You may ask for it to be removed at ${pct(PMI_REQUIRED_LTV)}; the schedule assumes you don't.
        FHA mortgage insurance follows different rules and is not modelled.</p>
      <p><b>Extra principal</b> is added to every payment from the first month and goes straight to the
        balance, which shortens the loan rather than lowering the payment. The savings figure compares that
        schedule against the same loan with no extra.</p>
      <p>${esc(data.note)} Nothing you type leaves your browser: the numbers are computed on this page, and the
        share link carries them in the part of the address after the <code>#</code>, which is never sent to a server.</p>
    </div>
  </section>

  <p class="noscript" id="boot-error" hidden>The calculator could not start in this browser, so the figures above
    are blank. The console has the reason.</p>
  <noscript><p class="noscript">This calculator runs in your browser. With JavaScript switched off it can show the
    form but not the answer.</p></noscript>

</div></main>

<footer><div class="wrap">
  <p>An estimate, not an offer or financial advice. Lenders' figures will differ by fees, escrow
     cushions and rounding.</p>
  <p>Page built ${esc(built)} · <a href="../">all sites</a></p>
</div></footer>

</body>
</html>
`;

fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });
fs.writeFileSync(path.join(dist, 'index.html'), html);
for (const asset of ['app.js', 'mortgage.js', 'styles.css']) {
  fs.copyFileSync(path.join(root, 'src', asset), path.join(dist, asset));
}
fs.writeFileSync(path.join(dist, '.nojekyll'), '');

console.log(`Built Mortgage Calculator -> ${path.relative(process.cwd(), dist) || dist}/`);
