#!/usr/bin/env node
/* Post-build checks. Exiting non-zero here blocks the deploy.
 *
 * The page has almost no server-rendered content: it is a shell of empty,
 * ID'd slots that app.js writes into. A typo in an ID breaks the site in the
 * browser while the build stays perfectly happy, so the main job here is to
 * confirm every ID the script reaches for is actually in the markup. */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = process.env.OUT_DIR
  ? path.resolve(process.env.OUT_DIR)
  : path.join(root, '..', 'dist');

const fails = [];
const check = (ok, msg) => { if (!ok) fails.push(msg); };

for (const f of ['index.html', 'app.js', 'styles.css', '.nojekyll']) {
  check(fs.existsSync(path.join(dist, f)), `missing dist/${f}`);
}
if (fails.length) report();

const html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(dist, 'app.js'), 'utf8');
const data = JSON.parse(fs.readFileSync(path.join(root, 'data/clocks.json'), 'utf8'));

check(html.length > 4000, `index.html suspiciously small (${html.length} bytes)`);
check(/<title>[^<]+<\/title>/.test(html), 'missing <title>');
check(!/undefined|NaN|\[object Object\]/.test(html),
  'page contains undefined/NaN/[object Object]');

/* The site is served from /clock/, so every asset reference has to be
   relative — a leading slash would resolve against the domain root. */
check(/href="\.\/styles\.css"/.test(html), 'stylesheet not linked relatively');
check(/src="\.\/app\.js"/.test(html), 'script not linked relatively');
for (const m of html.matchAll(/(?:href|src)="(\/[^/][^"]*)"/g)) {
  fails.push(`root-relative asset "${m[1]}" will 404 under /clock/`);
}

// app.js has to at least parse; a syntax error is a blank page.
try {
  execFileSync(process.execPath, ['--check', path.join(dist, 'app.js')], { stdio: 'pipe' });
} catch (e) {
  fails.push(`app.js does not parse: ${String(e.stderr || e.message).trim().split('\n')[0]}`);
}

/* Every getElementById the script makes with a literal must find something. */
const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]));
const wanted = new Set([...app.matchAll(/\$\('([^']+)'\)/g)].map(m => m[1]));
check(wanted.size >= 10, `only ${wanted.size} element lookups found in app.js — did it change shape?`);
for (const id of wanted) check(ids.has(id), `app.js looks up #${id}, which the page never renders`);

/* The prefixed slots are built from lists on both sides; check they pair up. */
for (const m of html.matchAll(/\bid="fact-([a-z]+)"/g)) {
  check(ids.has(`note-${m[1]}`), `fact "${m[1]}" has no matching note-${m[1]} slot`);
}
for (const m of html.matchAll(/\bid="track-([a-z]+)"/g)) {
  for (const p of ['pct', 'fill', 'rest']) {
    check(ids.has(`${p}-${m[1]}`), `progress bar "${m[1]}" has no ${p}-${m[1]} slot`);
  }
}
check([...html.matchAll(/class="fact"/g)].length >= 6, 'fewer facts rendered than expected');
check([...html.matchAll(/class="bar"/g)].length === 4, 'expected four progress bars');

/* World clocks: one row per configured zone, each with the parts app.js writes. */
const rows = [...html.matchAll(/<li data-tz="([^"]+)">([\s\S]*?)<\/li>/g)];
check(rows.length === data.zones.length,
  `expected ${data.zones.length} city rows, found ${rows.length}`);
for (const [, tz, body] of rows) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz }).format(new Date());
  } catch {
    fails.push(`"${tz}" is not a time zone this Node build recognises`);
  }
  for (const cls of ['dot', 'zt-time', 'zsuffix', 'off', 'dayrel']) {
    const has = new RegExp(`class="[^"]*\\b${cls}\\b[^"]*"`).test(body);
    check(has, `${tz} row is missing .${cls}`);
  }
}

check(/id="boot-error"[^>]*hidden/.test(html),
  'the hidden boot-error note is missing — a script failure would leave a blank page');

/* The hands are what make it a clock rather than a table of numbers. */
for (const id of ['hand-hour', 'hand-minute', 'hand-second']) {
  check(html.includes(`id="${id}"`), `dial is missing #${id}`);
}

function report() {
  console.error('Build verification FAILED:');
  for (const f of fails) console.error('  ✗ ' + f);
  process.exit(1);
}
if (fails.length) report();
console.log(`Build verified (${rows.length} zones, ${wanted.size} live slots).`);
