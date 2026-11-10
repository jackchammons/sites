#!/usr/bin/env node
/* Post-build checks. Exiting non-zero here blocks the deploy.
 *
 * The page has almost no server-rendered content: it is a shell of empty,
 * ID'd slots that app.js writes into. A typo in an ID breaks the site in the
 * browser while the build stays perfectly happy, so the main job here is to
 * confirm every ID the script reaches for is actually in the markup, and that
 * every slot the markup offers is one the script fills. The second job is the
 * arithmetic: time.js is run from the built copy against dates with known
 * answers. */
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

for (const f of ['index.html', 'app.js', 'time.js', 'styles.css', '.nojekyll']) {
  check(fs.existsSync(path.join(dist, f)), `missing dist/${f}`);
}
if (fails.length) report();

const html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(dist, 'app.js'), 'utf8');
const data = JSON.parse(fs.readFileSync(path.join(root, 'data/clocks.json'), 'utf8'));

check(html.length > 4000, `index.html suspiciously small (${html.length} bytes)`);
check(/<title>[^<]+<\/title>/.test(html), 'missing <title>');
/* Visible text only: the markup carries no values, so one of these words in
   it is a template that interpolated nothing. Scripts, styles and attribute
   values are left out, and the second check covers the attributes. */
const text = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ');
const leak = /\bundefined\b|\bNaN\b|\[object Object\]/.exec(text);
check(!leak, leak && `page shows "${leak[0]}" near: ${text.slice(Math.max(0, leak.index - 40), leak.index + 40).replace(/\s+/g, ' ')}`);
check(!/=\s*(["'])(?:undefined|null|NaN)\1/.test(html), 'an attribute is literally undefined/null/NaN');
/* Nothing time-dependent belongs in the shell, the time of the build
   included: a deploy with no change of content should leave index.html byte
   for byte the same. */
check(!/\d{4}-\d\d-\d\dT\d\d:\d\d/.test(html), 'a build timestamp is baked into the page');

/* The site is served from /clock/, so every asset reference has to be
   relative — a leading slash would resolve against the domain root. */
check(/href="\.\/styles\.css"/.test(html), 'stylesheet not linked relatively');
check(/<script type="module" src="\.\/app\.js">/.test(html), 'app.js not linked relatively as a module');
for (const m of html.matchAll(/(?:href|src)="(\/[^/][^"]*)"/g)) {
  fails.push(`root-relative asset "${m[1]}" will 404 under /clock/`);
}

// The scripts have to at least parse; a syntax error is a blank page.
for (const f of ['app.js', 'time.js']) {
  try {
    execFileSync(process.execPath, ['--check', path.join(dist, f)], { stdio: 'pipe' });
  } catch (e) {
    fails.push(`${f} does not parse: ${String(e.stderr || e.message).trim().split('\n')[0]}`);
  }
}
if (fails.length) report();

/* app.js is a module, and a module that imports a name its dependency does
   not export never runs at all: no error on the page, no boot-error note,
   just the empty shell. So the import list is checked against what the built
   time.js really exports. */
const time = await import(pathToFileURL(path.join(dist, 'time.js')).href);
const imports = [...app.matchAll(/import\s*\{([^}]*)\}\s*from\s*'([^']+)'/g)];
check(imports.length === 1 && imports[0][2] === './time.js',
  'app.js is expected to import from ./time.js, relatively, and from nothing else');
for (const [, names] of imports) {
  for (const name of names.split(',').map(n => n.trim()).filter(Boolean)) {
    check(typeof time[name] === 'function', `app.js imports "${name}", which time.js does not export`);
  }
}

/* Every element the script looks up must be in the markup. Lookups come in
   two shapes. The plain ones name the id outright. */
const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]));
const wanted = new Set([...app.matchAll(/\$\('([^']+)'\)/g)].map(m => m[1]));
check(wanted.size >= 10, `only ${wanted.size} element lookups found in app.js — did it change shape?`);
for (const id of wanted) check(ids.has(id), `app.js looks up #${id}, which the page never renders`);

/* The rest are built from a prefix and a key, inside a loop over a list of
   keys: FACT_KEYS.forEach(function (k) { ... $('fact-' + k) ... }). Read each
   list and the prefixes used with it, then pair every prefix-key id with the
   markup in both directions: a key the page has no slot for throws in the
   browser, and a slot no key reaches shows its placeholder for ever. */
const keyLists = new Map([...app.matchAll(/\bvar (\w+_KEYS) = \[([^\]]*)\];/g)]
  .map(m => [m[1], [...m[2].matchAll(/'([^']+)'/g)].map(k => k[1])]));
const prefixed = new Map();   // prefix -> the keys it is used with
let attributed = 0;
for (const [, list, body] of app.matchAll(/\b(\w+_KEYS)\.(?:forEach|map)\(function \(k\) \{([\s\S]*?)\n  \}\);/g)) {
  for (const [, prefix] of body.matchAll(/\$\('([a-z]+-)' \+ k\)/g)) {
    prefixed.set(prefix, keyLists.get(list) || []);
    attributed++;
  }
}
/* Both regexes above depend on how app.js is written. Counting every call to
   $() and requiring each to be one of the two shapes understood here means a
   rewrite fails this check instead of quietly escaping it. */
const calls = [...app.matchAll(/\$\(/g)].length;
const plain = [...app.matchAll(/\$\('[^']+'\)/g)].length;
check(attributed >= 6 && calls === plain + attributed,
  `app.js makes ${calls} element lookups and only ${plain + attributed} are in a shape this check reads — did it change shape?`);
check([...app.matchAll(/getElementById|querySelector(?:All)?\('#/g)].length === 1,
  'app.js reaches for an element by id somewhere other than $(), which this check cannot see');
for (const [prefix, keys] of prefixed) {
  check(keys.length > 0, `no keys found for the ${prefix} slots`);
  for (const k of keys) {
    check(ids.has(prefix + k), `app.js looks up #${prefix}${k}, which the page never renders`);
  }
}
for (const id of ids) {
  const prefix = [...prefixed.keys()].find(p => id.startsWith(p));
  if (prefix && !prefixed.get(prefix).includes(id.slice(prefix.length))) {
    fails.push(`the page renders #${id}, which app.js never looks up`);
  }
}
/* A fact is filled by name (facts.week.value), so a name that is not a key
   is a TypeError on every paint, and a key never named is a slot left at
   its dash. */
const factKeys = keyLists.get('FACT_KEYS') || [];
for (const k of new Set([...app.matchAll(/\bfacts\.([A-Za-z]+)\./g)].map(m => m[1]))) {
  check(factKeys.includes(k), `app.js writes facts.${k}, which is not one of FACT_KEYS`);
}
for (const k of factKeys) {
  for (const part of ['value', 'note']) {
    check(app.includes(`facts.${k}.${part},`), `app.js never fills the ${part} of the "${k}" fact`);
  }
}

check([...html.matchAll(/class="fact"/g)].length >= 6, 'fewer facts rendered than expected');
check([...html.matchAll(/class="bar"/g)].length === 4, 'expected four progress bars');

/* World clocks: one row per configured zone, each with the parts app.js writes. */
const rows = [...html.matchAll(/<li data-tz="([^"]+)">([\s\S]*?)<\/li>/g)];
const rowParts = new Set([...app.matchAll(/\brow\.querySelector\('\.([\w-]+)'\)/g)].map(m => m[1]));
check(rowParts.size >= 5, `only ${rowParts.size} row parts found in app.js — did it change shape?`);
check(rows.length === data.zones.length,
  `expected ${data.zones.length} city rows, found ${rows.length}`);
for (const [, tz, body] of rows) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz }).format(new Date());
  } catch {
    fails.push(`"${tz}" is not a time zone this Node build recognises`);
  }
  for (const cls of rowParts) {
    const has = new RegExp(`class="(?:[^"]* )?${cls}(?: [^"]*)?"`).test(body);
    check(has, `app.js writes .${cls} in each city row, and the ${tz} row has none`);
  }
}

check(/id="boot-error"[^>]*hidden/.test(html),
  'the hidden boot-error note is missing — a script failure would leave a blank page');
/* A module that fails to load or link runs no code at all, so the page itself
   has to notice: an inline script reveals the note when the first paint never
   cleared the .pending marks. */
check(/<script>[^<]*addEventListener\('load'[^<]*querySelector\('\.pending'\)[^<]*getElementById\('boot-error'\)\.hidden = false[^<]*<\/script>/.test(html),
  'the inline check that reveals boot-error when app.js never starts is missing');
check(/class="[^"]*\bpending\b/.test(html) && /classList\.remove\('pending'\)/.test(app),
  'the .pending marks, or the paint that clears them, are missing — the inline check depends on both');

/* The hands are what make it a clock rather than a table of numbers. */
for (const id of ['hand-hour', 'hand-minute', 'hand-second']) {
  check(html.includes(`id="${id}"`), `dial is missing #${id}`);
}

if (fails.length) report();

/* The arithmetic, run from the built copy. Dates are built from calendar
   fields, so the answers are the same in whatever zone this machine keeps;
   test/time.test.mjs is where the zones with summer time are pinned. */
const eq = (got, want, what) => check(JSON.stringify(got) === JSON.stringify(want),
  `${what}: expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
eq(time.isoWeek(new Date(2027, 0, 1)), { year: 2026, week: 53 }, 'ISO week of 1 Jan 2027');
eq(time.isoWeek(new Date(2025, 11, 29)), { year: 2026, week: 1 }, 'ISO week of 29 Dec 2025');
eq(time.dayOfYear(new Date(2028, 11, 31, 12)), 366, 'day of year on 31 Dec 2028');
eq(time.daysInYear(2026), 365, 'days in 2026');
eq(time.daysLeftInMonth(new Date(2026, 9, 1, 0, 30)), 31, 'days left in October on the 1st');
eq(time.daysLeftInMonth(new Date(2028, 1, 29, 23, 59)), 1, 'days left in February on the 29th');
eq(time.daysLeftInYear(new Date(2026, 9, 1, 0, 30)), 92, 'days left in 2026 on 1 October');
eq(time.daysLeftInYear(new Date(2026, 11, 31, 23, 59)), 1, 'days left in 2026 on 31 December');
eq(time.offsetLabel(345), 'UTC+05:45', 'offset label for Kathmandu');
eq(time.offsetLabel(-210), 'UTC−03:30', 'offset label for Newfoundland');
eq(time.relativeOffset(0), 'same time', 'relative offset of the same zone');
eq(time.relativeOffset(540), '+9h', 'relative offset of nine hours');
eq(time.relativeOffset(-15), '−15m', 'relative offset of a quarter hour');
eq(time.relativeOffset(810), '+13h 30m', 'relative offset of thirteen and a half hours');
eq(time.offsetMinutes(new Date(Date.UTC(2026, 10, 10)), 'Asia/Kathmandu'), 345, 'offset of Kathmandu');
eq(time.offsetMinutes(new Date(Date.UTC(2026, 6, 1)), 'America/Los_Angeles'), -420, 'offset of Los Angeles in July');
eq(time.sameZone('UTC', 'UTC') && !time.sameZone('Europe/Berlin', 'Asia/Tokyo'), true, 'zone comparison');

function report() {
  console.error('Build verification FAILED:');
  for (const f of fails) console.error('  ✗ ' + f);
  process.exit(1);
}
if (fails.length) report();
const slots = wanted.size + [...prefixed.values()].reduce((n, keys) => n + keys.length, 0);
console.log(`Build verified (${rows.length} zones, ${slots} live slots, calendar checks pass).`);
