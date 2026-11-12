#!/usr/bin/env node
/* Post-build checks. Exiting non-zero here blocks the deploy.
 *
 * Three seams can break the page while the build stays happy: the maths
 * (shared by the browser through src/mortgage.js), the reading of typed
 * numbers and share links (src/inputs.js), and the IDs app.js looks up in
 * the rendered markup. All are checked here against the built output, not
 * the source, since the output is what ships. */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = process.env.OUT_DIR
  ? path.resolve(process.env.OUT_DIR)
  : path.join(root, '..', 'dist', path.basename(root));

const fails = [];
const check = (ok, msg) => { if (!ok) fails.push(msg); };
function report() {
  console.error('Build verification FAILED:');
  for (const f of fails) console.error('  ✗ ' + f);
  process.exit(1);
}

for (const f of ['index.html', 'app.js', 'mortgage.js', 'inputs.js', 'styles.css', '.nojekyll']) {
  check(fs.existsSync(path.join(dist, f)), `missing dist/${f}`);
}
if (fails.length) report();

const html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(dist, 'app.js'), 'utf8');

check(html.length > 6000, `index.html suspiciously small (${html.length} bytes)`);
check(/<title>[^<]+<\/title>/.test(html), 'missing <title>');
/* Visible text only: the inline defaults are JSON, which cannot carry
   undefined or NaN, and a script is free to contain either word. */
const text = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ');
const leak = /\bundefined\b|\bNaN\b|\[object Object\]/.exec(text);
check(!leak, leak && `page shows "${leak[0]}" near: ${text.slice(Math.max(0, leak.index - 40), leak.index + 40).replace(/\s+/g, ' ')}`);
check(!/=\s*(["'])(?:undefined|null|NaN)\1/.test(html), 'an attribute is literally undefined/null/NaN');

/* Served from /mortgage/, so every asset reference must be relative. They
   are plain here: the multi-site build adds the content stamps afterwards. */
check(/<script type="module" src="\.\/app\.js">/.test(html), 'app.js not linked relatively as a module');
check(/href="\.\/styles\.css"/.test(html), 'stylesheet not linked relatively');
for (const dep of ['mortgage.js', 'inputs.js']) {
  check(app.includes(`from './${dep}'`), `app.js does not import ./${dep} relatively`);
}
for (const m of html.matchAll(/(?:href|src)="(\/[^/][^"]*)"/g)) {
  fails.push(`root-relative asset "${m[1]}" will 404 under /mortgage/`);
}

for (const f of ['app.js', 'mortgage.js', 'inputs.js']) {
  try {
    execFileSync(process.execPath, ['--check', '--input-type=module'],
      { input: fs.readFileSync(path.join(dist, f)), stdio: 'pipe' });
  } catch (e) {
    fails.push(`${f} does not parse: ${String(e.stderr || e.message).trim().split('\n')[0]}`);
  }
}

/* Every $('id') in the script has to exist in the markup. */
const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]));
const literal = [...app.matchAll(/\$\('([^']+)'\)/g)].map(m => m[1]);
// Prefixed lookups ($('bd-' + k)) are expanded from the parts list in the script.
const parts = ['pi', 'tax', 'insurance', 'escrow', 'pmi', 'hoa'];
const summary = ['loan', 'interest', 'cost', 'payoff', 'extra', 'saved'];
const wanted = new Set([
  ...literal,
  ...parts.flatMap(k => [`bd-${k}`, `row-${k}`, `seg-${k}`]),
  ...summary.flatMap(k => [`sum-${k}`, `sub-${k}`]),
]);
check(literal.length >= 20, `only ${literal.length} literal lookups in app.js — did it change shape?`);
for (const id of wanted) check(ids.has(id), `app.js looks up #${id}, which the page never renders`);
for (const k of parts) check(app.includes(`'${k}'`), `app.js no longer renders part "${k}"`);

/* The defaults blob the script parses must be valid and complete. */
const blob = html.match(/<script type="application\/json" id="defaults">([\s\S]*?)<\/script>/);
let defaults = null;
try { defaults = JSON.parse(blob[1]); } catch { fails.push('inline defaults JSON is missing or invalid'); }

/* The maths, from the built copy: a schedule that does not end at zero, or a
   textbook payment that comes out wrong, must never deploy. */
const m = await import(pathToFileURL(path.join(dist, 'mortgage.js')).href);
const near = (a, b, eps, msg) => check(Math.abs(a - b) <= eps, `${msg}: got ${a}, expected ${b}`);
near(m.monthlyPI(200000, 6, 30), 1199.10, 0.01, '$200k at 6% over 30y');
near(m.monthlyPI(300000, 4.5, 15), 2294.98, 0.01, '$300k at 4.5% over 15y');
if (defaults) {
  for (const k of ['price', 'downPct', 'rate', 'years', 'taxRate', 'insurance', 'escrow', 'hoa', 'pmiRate', 'extra']) {
    check(Number.isFinite(defaults[k]), `default "${k}" is not a number`);
  }
  check(html.includes(`<option value="${defaults.years}" selected>`), 'default term is not one of the options');
  for (const [k, u] of [['in-tax', defaults.taxUnit], ['in-ins', defaults.insUnit], ['in-escrow', defaults.escrowUnit]]) {
    check(new RegExp(`id="${k}-unit"[^>]*>(?:(?!</select>).)*<option value="${u}" selected>`, 's').test(html),
      `default unit "${u}" is not an option of #${k}-unit`);
  }
  const esc = m.monthlyBreakdown(m.describe({ ...defaults, down: 0, escrow: 12000 }));
  check(esc.tax === 0 && esc.insurance === 0 && esc.escrow === 1000, 'escrow does not replace tax and insurance in the breakdown');
  const d = m.describe({ ...defaults, down: defaults.price * defaults.downPct / 100 });
  const s = m.amortize(d);
  check(s.months === d.months && d.months === defaults.years * 12, `default loan schedules ${s.months} months, not ${defaults.years * 12}`);
  const sched = m.amortize(d);
  check(Math.abs(m.originalLoan(sched.rows[59].balance, defaults.rate, d.months, 60) - d.loan) < 1,
    'originalLoan does not invert the default schedule');
  const prog = m.amortize(m.describe({ ...defaults, balance: 250000, months: 200 }));
  check(prog.months === 200 && prog.rows.at(-1)?.balance === 0, 'a loan under way does not run its remaining months to zero');
  check(s.rows.at(-1)?.balance === 0, 'default schedule does not end at a zero balance');
  const fast = m.amortize(d, { extra: 500 });
  check(fast.months < s.months && fast.totalInterest < s.totalInterest, 'extra principal saves nothing');
}

/* The validation suite, on the built copy: every schedule row re-derived in
   exact arithmetic, the closed forms, and what one-time and recurring extra
   principal save (test/validation.mjs; `node scripts/validate.mjs` prints
   the full report). CI runs it on src/ with the unit tests; this run is on
   the file that ships. */
const { validate } = await import('../test/validation.mjs');
const validation = validate(m, { loans: 120 });
for (const s of validation.sections) {
  for (const f of s.failures.filter(Boolean).slice(0, 5)) fails.push(`maths validation, ${s.id}: ${f}`);
  if (s.failures.length > 5) fails.push(`maths validation, ${s.id}: ${s.failures.length - 5} more`);
}

/* What the viewer types and what a link carries, from the built copy: a
   parser that misreads a locale's decimal comma is off by a factor of a
   hundred, and a link that does not come back as it was written is a share
   button that lies. */
const inp = await import(pathToFileURL(path.join(dist, 'inputs.js')).href);
for (const [typed, money, want] of [['$450,000', true, 450000], ['750k', true, 750000], ['1.2m', true, 1200000],
  ['0,92', false, 0.92], ['6.', false, 6], ['6.125', false, 6.125], ['750.000', true, 750000], ['1.234,56', true, 1234.56]]) {
  const got = inp.parseAmount(typed, { money });
  check(got === want, `"${typed}" reads as ${got}, expected ${want}`);
}
check(Number.isNaN(inp.parseAmount('abc')), 'text that is not a number does not read as NaN');
check(inp.parseMonth('03/2025') === '2025-03' && inp.parseMonth('2025-13') === null, 'typed months are misread');
if (defaults) {
  const choices = {
    terms: [...html.match(/<select id="in-years"[^>]*>([\s\S]*?)<\/select>/)[1].matchAll(/value="(\d+)"/g)].map(o => +o[1]),
    cadences: [...html.match(/<select id="in-every"[^>]*>([\s\S]*?)<\/select>/)[1].matchAll(/value="(\d+)"/g)].map(o => +o[1]),
  };
  const open = inp.defaultState(defaults, '2026-12');
  check(inp.encodeState(open, defaults, '2026-12') === '', 'the untouched page writes a hash');
  const typed = { ...open, price: 437500, down: 50000, downPct: null, rate: 7.125, years: choices.terms[0], start: '2025-03',
    balance: 380000, next: '2027-01', taxRate: 6900, taxUnit: 'yr', insurance: 150, insUnit: 'mo', escrow: 0, escrowUnit: 'yr',
    escrowMode: true, hoa: 85, pmiRate: 0.5, extra: 200, extraEvery: choices.cadences.at(-1), progressMode: true };
  const back = inp.decodeState(inp.encodeState(typed, defaults, '2026-12'), defaults, '2026-12', choices);
  for (const k of Object.keys(typed)) check(back[k] === typed[k], `share link loses "${k}": wrote ${typed[k]}, read ${back[k]}`);
  check(inp.decodeState('y=50000', defaults, '2026-12', choices).years === defaults.years, 'a link can ask for a term the page does not offer');
}

check(/id="boot-error"[^>]*hidden/.test(html), 'the hidden boot-error note is missing');
for (const id of ['chart', 'chart-legend', 'tip']) {
  check(ids.has(id), `chart slot #${id} missing`);
}

if (fails.length) report();
console.log(`Build verified (${wanted.size} live slots, input reading checked, maths validated: ${validation.checks} checks on ${validation.loans} loans).`);
