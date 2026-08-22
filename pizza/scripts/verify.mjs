#!/usr/bin/env node
/* Post-build sanity checks. A broken weekly run should fail loudly rather
 * than quietly publishing a broken page. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, '..', 'dist');
const dataset = JSON.parse(fs.readFileSync(path.join(root, 'data/restaurants.json'), 'utf8'));

const fails = [];
const check = (ok, msg) => { if (!ok) fails.push(msg); };

for (const f of ['index.html', 'app.js', 'slice.js', 'render.js', 'rankings.json', '.nojekyll']) {
  check(fs.existsSync(path.join(dist, f)), `missing dist/${f}`);
}
if (fails.length) { report(); }

const html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
check(html.length > 20000, `index.html suspiciously small (${html.length} bytes)`);
check(/<title>[^<]+<\/title>/.test(html), 'missing <title>');

const cards = (html.match(/<article class="card/g) || []).length;
check(cards === dataset.restaurants.length,
  `expected ${dataset.restaurants.length} cards, found ${cards}`);

for (const r of dataset.restaurants) {
  check(html.includes(r.name.replace(/'/g, '&#39;')) || html.includes(r.name),
    `"${r.name}" missing from the page`);
}
check(!/undefined|NaN|\[object Object\]/.test(html), 'page contains undefined/NaN/[object Object]');

const api = JSON.parse(fs.readFileSync(path.join(dist, 'rankings.json'), 'utf8'));
check(api.rankings.length === dataset.restaurants.length, 'rankings.json length mismatch');
api.rankings.forEach((r, i) => {
  check(r.rank === i + 1, `rank ${r.rank} out of sequence at index ${i}`);
  check(Number.isFinite(r.score) && r.score > 0 && r.score <= 100,
    `${r.name}: score ${r.score} out of range`);
  if (i > 0) {
    check(r.score <= api.rankings[i - 1].score,
      `${r.name}: score ${r.score} exceeds the entry ranked above it`);
  }
});

report();

function report() {
  if (fails.length) {
    console.error('Build verification FAILED:');
    for (const f of fails) console.error('  ✗ ' + f);
    process.exit(1);
  }
  console.log(`Build verified: ${cards ?? '?'} cards, ${api?.rankings.length ?? '?'} ranked entries, ${html?.length ?? 0} bytes.`);
}
