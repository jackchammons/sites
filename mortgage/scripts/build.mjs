#!/usr/bin/env node
/*
 * Build for the Mortgage Calculator.
 *
 * The calculator runs in the browser, so this renders the form (with the
 * example inputs from data/defaults.json), the labelled output slots, then
 * copies src/ beside it. src/app.js does every
 * calculation, importing the same src/mortgage.js and src/inputs.js that the
 * tests and the deploy gate exercise — one implementation of the maths and
 * of how typed numbers and share links are read.
 *
 * Nothing date-dependent is baked in: the loan's start month defaults to the
 * viewer's next month, filled in by app.js.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// The multi-site build sets OUT_DIR to dist/<slug>/; a standalone run writes the same place.
const dist = process.env.OUT_DIR
  ? path.resolve(process.env.OUT_DIR)
  : path.join(root, '..', 'dist', path.basename(root));

const data = JSON.parse(fs.readFileSync(path.join(root, 'data/defaults.json'), 'utf8'));

const esc = s => String(s).replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const v = data.inputs;
const downAmt = Math.round(v.price * v.downPct / 100);

/* A number field: an optional "$" adornment, a text input with the decimal
   keypad (cents and "750k" both need more than digits), then a fixed `post`
   adornment or, with `units` ([[value, label], ...]), a unit select in its
   place, and a hint line.
   Only the label names the input. The "$" is decoration; a trailing unit and
   the hint are its description, so a screen reader hears "HOA dues" and then
   "/mo" rather than one run-on name. */
const field = ({ id, label, value, pre, post, hint, units, unit }) => {
  const about = [post && !units && `${id}-post`, hint && `${id}-hint`].filter(Boolean).join(' ');
  return `
      <div class="field">
        <label class="lbl" for="${id}">${esc(label)}</label>
        <span class="box">${pre ? `<i aria-hidden="true">${esc(pre)}</i>` : ''}<input id="${id}" name="${id}" type="text" inputmode="decimal" autocomplete="off" spellcheck="false" value="${esc(value)}"${about ? ` aria-describedby="${about}"` : ''}>${
          units ? `<select class="unit" id="${id}-unit" name="${id}-unit" aria-label="${esc(label)} unit">${units.map(([u, l]) => `<option value="${u}"${u === unit ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>`
          : post ? `<i id="${id}-post" aria-hidden="true">${esc(post)}</i>` : ''}</span>
        ${hint ? `<span class="hint" id="${id}-hint">${hint}</span>` : ''}
      </div>`;
};

/* A month field. Browsers without a month picker show a plain text box, so
   the placeholder says what to type; app.js reads a few other spellings. */
const monthField = ({ id, label, hint, wrap = '' }) => `
      <div class="field"${wrap}>
        <label class="lbl" for="${id}">${esc(label)}</label>
        <span class="box"><input id="${id}" name="${id}" type="month" placeholder="YYYY-MM" autocomplete="off"${hint ? ` aria-describedby="${id}-hint"` : ''}></span>
        ${hint ? `<span class="hint" id="${id}-hint">${hint}</span>` : ''}
      </div>`;

/* How often the extra principal is paid, in months; 0 is a one-off. The
   option values are what app.js stores in the hash. */
const CADENCES = [[1, 'Every month'], [3, 'Every quarter'], [6, 'Twice a year'], [12, 'Once a year'], [0, 'Once, with the first payment']];
const cadences = CADENCES.map(([v2, label]) =>
  `<option value="${v2}"${v2 === (v.extraEvery ?? 1) ? ' selected' : ''}>${esc(label)}</option>`).join('');

const terms = data.terms.map(t =>
  `<option value="${t}"${t === v.years ? ' selected' : ''}>${t} years</option>`).join('');

/* The parts of a monthly bill. Order is fixed (it is the categorical colour
   order too) so a part keeps its colour whether or not it is present. */
const PARTS = [
  ['pi', 'Principal & interest'],
  ['tax', 'Property tax'],
  ['insurance', 'Home insurance'],
  ['escrow', 'Tax & insurance (escrow)'],
  ['pmi', 'Mortgage insurance (PMI)'],
  ['hoa', 'HOA dues'],
];
const SLOT = { pi: 1, tax: 2, insurance: 3, pmi: 4, hoa: 5, escrow: 6 };
const legend = PARTS.map(([k, label]) => `
          <li id="row-${k}" class="s${SLOT[k]}"><span class="sw"></span><span class="nm">${esc(label)}</span><b id="bd-${k}">—</b></li>`).join('');
const segs = PARTS.map(([k]) => `<span class="seg s${SLOT[k]}" id="seg-${k}"></span>`).join('');

const SUMMARY = [
  ['loan', 'Loan amount'],
  ['interest', 'Total interest'],
  ['cost', 'Total of all payments'],
  ['payoff', 'Paid off'],
  ['extra', 'Total extra principal'],
  ['saved', 'Extra principal saves'],
];
const summary = SUMMARY.map(([k, label]) => `
        <div class="fact" id="fact-${k}">
          <dt id="lbl-${k}">${esc(label)}</dt>
          <dd><span id="sum-${k}">—</span><small id="sub-${k}"></small></dd>
        </div>`).join('');

const built = new Date().toISOString();
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
    <div class="head h2-row"><h2>The loan</h2>
      <div class="seg-toggle" role="group" aria-label="New loan or one already under way">
        <button type="button" id="mode-new" aria-pressed="true">New loan</button>
        <button type="button" id="mode-progress" aria-pressed="false">Already paying</button>
      </div>
    </div>
    <div id="price-field">
      ${field({ id: 'in-price', label: 'Home price', value: v.price, pre: '$' })}
    </div>
    <div class="pair" id="new-fields">
      ${field({ id: 'in-down', label: 'Down payment', value: downAmt, pre: '$' })}
      ${field({ id: 'in-downpct', label: 'Down %', value: v.downPct, post: '%' })}
    </div>
    <div id="progress-fields" hidden>
      ${field({ id: 'in-balance', label: 'Current balance', value: '', pre: '$', hint: 'Principal owed today, from a statement' })}
    </div>
    <div class="pair">
      ${field({ id: 'in-rate', label: 'Interest rate', value: v.rate, post: '%', hint: 'Fixed, annual. The starting rate is an example: enter your own.' })}
      <div class="field" id="term-field">
        <label class="lbl" id="term-label" for="in-years">Term</label>
        <span class="box"><select id="in-years" name="in-years">${terms}</select></span>
      </div>
    </div>
    <div class="pair" id="date-fields">
      ${monthField({ id: 'in-start', label: 'First payment', wrap: ' id="start-field"' })}
      ${monthField({ id: 'in-maturity', label: 'Last payment', hint: 'Either date sets the other, from the term', wrap: ' id="maturity-field" hidden' })}
    </div>
    <div id="next-field" hidden>
      ${monthField({ id: 'in-next', label: 'Next payment' })}
      <div class="inferred" id="inferred">
        <span class="lbl">Loan amount, inferred from the balance</span>
        <p><b id="inf-price">—</b> <span id="inf-note"></span></p>
      </div>
    </div>

    <div class="head h2-row"><h2>Costs on top</h2>
      <div class="seg-toggle" role="group" aria-label="How tax and insurance are entered">
        <button type="button" id="mode-split" aria-pressed="${v.escrowMode ? 'false' : 'true'}">Tax + insurance</button>
        <button type="button" id="mode-escrow" aria-pressed="${v.escrowMode ? 'true' : 'false'}">One escrow amount</button>
      </div>
    </div>
    <div class="pair" id="split-fields"${v.escrowMode ? ' hidden' : ''}>
      ${field({ id: 'in-tax', label: 'Property tax', value: v.taxRate, units: [['pct', '% /yr'], ['yr', '$ /yr'], ['mo', '$ /mo']], unit: v.taxUnit, hint: '% is of the price' })}
      ${field({ id: 'in-ins', label: 'Insurance', value: v.insurance, pre: '$', units: [['yr', '/yr'], ['mo', '/mo']], unit: v.insUnit })}
    </div>
    <div id="escrow-fields"${v.escrowMode ? '' : ' hidden'}>
      ${field({ id: 'in-escrow', label: 'Escrow (tax + insurance)', value: v.escrow, pre: '$', units: [['mo', '/mo'], ['yr', '/yr']], unit: v.escrowUnit, hint: 'The combined figure from a servicer statement or an estimate' })}
    </div>
    <div class="pair">
      ${field({ id: 'in-hoa', label: 'HOA dues', value: v.hoa, pre: '$', post: '/mo' })}
      ${field({ id: 'in-pmi', label: 'PMI rate', value: v.pmiRate, post: '%/yr', hint: 'Charged under 20% down; 0 if none' })}
    </div>

    <h2>Pay it down faster</h2>
    <div class="pair">
      ${field({ id: 'in-extra', label: 'Extra principal', value: v.extra, pre: '$', hint: 'Goes straight to the balance' })}
      <div class="field">
        <label class="lbl" for="in-every">Paid</label>
        <span class="box"><select id="in-every" name="in-every">${cadences}</select></span>
      </div>
    </div>

    <div class="actions">
      <button type="button" id="btn-share">Copy link to these numbers</button>
      <button type="button" id="btn-reset" class="quiet">Reset</button>
      <span class="status" id="share-status" role="status" aria-live="polite"></span>
    </div>
  </form>

  <section class="panel results">
    <p class="eyebrow">Monthly payment</p>
    <div aria-live="polite" aria-atomic="true">
      <p class="total"><span id="out-total">—</span><small>/mo</small></p>
      <p class="sub" id="out-sub"></p>
    </div>
    <div class="stack" id="stack" role="img" aria-label="Monthly payment broken into its parts">${segs}</div>
    <ul class="legend">${legend}
    </ul>
    <dl class="facts">${summary}
    </dl>
  </section>

  </div>

  <section>
    <div class="head"><h2>Over the life of the loan</h2><span class="eyebrow" id="chart-note"></span></div>
    <div class="panel chart-panel">
      <ul class="chart-legend" id="chart-legend" aria-label="Series — click to show or hide"></ul>
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


  <p class="noscript" id="boot-error" hidden>The calculator could not start in this browser, so the figures above
    are blank. The console has the reason.</p>
  <noscript><p class="noscript">This calculator runs in your browser. With JavaScript switched off it can show the
    form but not the answer.</p></noscript>

</div></main>

<footer><div class="wrap">
  <p>An estimate, not an offer or financial advice. Lenders' figures will differ by fees, escrow
     cushions and rounding. ${esc(data.note)}</p>
  <p>Nothing you type leaves your browser: the numbers are computed on this page, and the share link
     carries them in the part of the address after the <code>#</code>, which is never sent to a server.</p>
  <p>Page built ${esc(built)} · <a href="../">all sites</a></p>
</div></footer>

</body>
</html>
`;

// Clearing the target is only safe when it is a previous build or empty: OUT_DIR=. would
// otherwise delete this site's source.
const holdsSource = dist === root || root.startsWith(dist + path.sep);
const foreign = fs.existsSync(dist) && fs.readdirSync(dist).length > 0
  && !fs.existsSync(path.join(dist, 'index.html'));
if (holdsSource || foreign) {
  console.error(`refusing to clear ${dist}: it is not an empty directory or a previous build`);
  process.exit(1);
}
fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });
fs.writeFileSync(path.join(dist, 'index.html'), html);
// Copied as written: the multi-site build stamps asset URLs with a content
// hash after verify has run, so nothing here adds one.
for (const asset of ['app.js', 'mortgage.js', 'inputs.js', 'styles.css']) {
  fs.copyFileSync(path.join(root, 'src', asset), path.join(dist, asset));
}
fs.writeFileSync(path.join(dist, '.nojekyll'), '');

console.log(`Built Mortgage Calculator -> ${path.relative(process.cwd(), dist) || dist}/`);
