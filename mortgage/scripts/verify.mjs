#!/usr/bin/env node
/* Post-build checks. Exiting non-zero here blocks the deploy.
 *
 * Two seams can break the page while the build stays happy: the maths
 * (shared by the browser through src/mortgage.js) and the IDs app.js looks
 * up in the rendered markup. Both are checked here against the built output,
 * not the source, since the output is what ships. */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = process.env.OUT_DIR
  ? path.resolve(process.env.OUT_DIR)
  : path.join(root, '..', 'dist');

const fails = [];
const check = (ok, msg) => { if (!ok) fails.push(msg); };
function report() {
  console.error('Build verification FAILED:');
  for (const f of fails) console.error('  ✗ ' + f);
  process.exit(1);
}

for (const f of ['index.html', 'app.js', 'mortgage.js', 'styles.css', '.nojekyll']) {
  check(fs.existsSync(path.join(dist, f)), `missing dist/${f}`);
}
if (fails.length) report();

const html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(dist, 'app.js'), 'utf8');

check(html.length > 6000, `index.html suspiciously small (${html.length} bytes)`);
check(/<title>[^<]+<\/title>/.test(html), 'missing <title>');
check(!/undefined|NaN|\[object Object\]/.test(html), 'page contains undefined/NaN/[object Object]');

/* Served from /mortgage/, so every asset reference must be relative. */
/* …and must carry a content stamp, or a redeploy leaves viewers running
   the cached old script against the new page. */
check(/src="\.\/app\.js\?v=[0-9a-f]{8}"/.test(html), 'script not linked relatively with a cache stamp');
check(/href="\.\/styles\.css\?v=[0-9a-f]{8}"/.test(html), 'stylesheet not linked relatively with a cache stamp');
check(/from '\.\/mortgage\.js\?v=[0-9a-f]{8}'/.test(app), 'app.js does not import ./mortgage.js relatively with a cache stamp');
for (const m of html.matchAll(/(?:href|src)="(\/[^/][^"]*)"/g)) {
  fails.push(`root-relative asset "${m[1]}" will 404 under /mortgage/`);
}

for (const f of ['app.js', 'mortgage.js']) {
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
const parts = ['pi', 'tax', 'insurance', 'pmi', 'hoa'];
const summary = ['loan', 'interest', 'cost', 'payoff', 'pmiend', 'saved'];
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
  for (const k of ['price', 'downPct', 'rate', 'years', 'taxRate', 'insurance', 'hoa', 'pmiRate', 'extra']) {
    check(Number.isFinite(defaults[k]), `default "${k}" is not a number`);
  }
  check(html.includes(`<option value="${defaults.years}" selected>`), 'default term is not one of the options');
  const d = m.describe({ ...defaults, down: defaults.price * defaults.downPct / 100 });
  const s = m.amortize(d);
  check(s.months === d.years * 12, `default loan schedules ${s.months} months, not ${d.years * 12}`);
  check(s.rows.at(-1)?.balance === 0, 'default schedule does not end at a zero balance');
  const fast = m.amortize(d, { extra: 500 });
  check(fast.months < s.months && fast.totalInterest < s.totalInterest, 'extra principal saves nothing');
}

check(/id="boot-error"[^>]*hidden/.test(html), 'the hidden boot-error note is missing');

if (fails.length) report();
console.log(`Build verified (${wanted.size} live slots, maths checked).`);
