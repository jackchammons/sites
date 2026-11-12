#!/usr/bin/env node
/* Validate the mortgage maths and say what was checked.
 *
 *   node mortgage/scripts/validate.mjs            # src/mortgage.js, 1,000 loans
 *   node mortgage/scripts/validate.mjs --loans=5000 --seed=7
 *   node mortgage/scripts/validate.mjs --built    # the copy in dist/mortgage/
 *
 * The same suite runs smaller in CI (test/validation.test.mjs) and in the
 * deploy gate (verify.mjs). This is the one to run when the question is "is
 * the calculator right?": it prints each section's count, how close the
 * calculator came to the closed forms, and a worked table of one-time
 * payments on the page's example loan. Exits non-zero if anything fails. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { validate, lumpSumTable } from '../test/validation.mjs';
import { firstDollarSaving } from '../test/oracle.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = k => process.argv.find(a => a.startsWith(`--${k}=`))?.split('=')[1];
const built = process.argv.includes('--built');
const file = built ? path.join(root, '..', 'dist', 'mortgage', 'mortgage.js') : path.join(root, 'src', 'mortgage.js');
const m = await import(pathToFileURL(file).href);

const t0 = Date.now();
const res = validate(m, { loans: +(arg('loans') ?? 1000), seed: +(arg('seed') ?? 20261112) });
console.log(`Mortgage maths: ${path.relative(process.cwd(), file)}`);
console.log(`${res.loans.toLocaleString('en-US')} loans, ${res.checks.toLocaleString('en-US')} checks, ${((Date.now() - t0) / 1000).toFixed(1)}s\n`);
for (const s of res.sections) {
  console.log(`${s.failures.length ? '✗' : '✓'} ${s.title} (${s.checks.toLocaleString('en-US')} checks)`);
  for (const n of s.notes) console.log(`    ${n}`);
  for (const f of s.failures) if (f) console.log(`    ✗ ${f}`);
  if (s.failures.length > 25) console.log(`    … and ${s.failures.length - 25} more`);
}

/* The worked example: the page's own default loan. */
const defaults = JSON.parse(fs.readFileSync(path.join(root, 'data', 'defaults.json'), 'utf8')).inputs;
const loan = defaults.price - Math.ceil(defaults.price * defaults.downPct / 100);
const L = { loan, rate: defaults.rate, years: defaults.years };
const usd = (x, dp = 0) => x.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: dp, maximumFractionDigits: dp });
const table = lumpSumTable(m, L, [1000, 5000, 10000, 25000, 50000, 100000, 200000]);
console.log(`\nOne-time payments on the example loan (${usd(loan)} at ${defaults.rate}% over ${defaults.years} years):\n`);
console.log('  paid once    interest saved    closed form    saved per $1    paid off sooner');
for (const t of table) {
  const mo = t.monthsSooner;
  console.log(`  ${usd(t.amount).padStart(9)}    ${usd(t.saved, 2).padStart(14)}    ${usd(t.formulaSaved, 2).padStart(11)}    ${('$' + t.perDollar.toFixed(3)).padStart(12)}    ${`${Math.floor(mo / 12)} yr ${mo % 12} mo`.padStart(15)}`);
}
console.log(`\n  Saved per dollar falls as the payment grows, and that is the loan, not the`);
console.log(`  calculator. A dollar of principal removes the tail end of the last payment,`);
console.log(`  so the first dollar is spared interest for the whole term (at most $${firstDollarSaving(L.rate, L.years * 12).toFixed(3)}`);
console.log(`  here). Each further dollar shortens the loan, so it removes a payment that`);
console.log(`  was due sooner and is spared interest for less time.`);

if (res.failures) {
  console.error(`\nFAILED: ${res.failures} check${res.failures === 1 ? '' : 's'}.`);
  process.exit(1);
}
console.log('\nAll checks passed.');
