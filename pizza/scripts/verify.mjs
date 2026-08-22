#!/usr/bin/env node
/* Post-build sanity checks. A broken weekly run should fail loudly rather
 * than quietly publishing a broken page. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = process.env.OUT_DIR
  ? path.resolve(process.env.OUT_DIR)
  : path.join(root, '..', 'dist');
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

// Only the top tier gets full cards; the bench renders as compact rows.
const top = dataset.restaurants.filter(r => (r.tier || 'top') === 'top');
const benchEntries = dataset.restaurants.filter(r => r.tier === 'bench');

const cards = (html.match(/<article class="card/g) || []).length;
check(cards === top.length, `expected ${top.length} cards, found ${cards}`);

if (benchEntries.length) {
  const rows = (html.match(/<li class="bench-row/g) || []).length;
  check(rows === benchEntries.length, `expected ${benchEntries.length} bench rows, found ${rows}`);
  check(/class="brackets"/.test(html), 'style brackets section missing');
}

// Every restaurant, both tiers, must appear somewhere on the page.
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
  // Scores descend within a tier, but the bench is a separate ladder — a
  // provisional entry may legitimately outscore the tenth-place cutoff.
  const prev = api.rankings[i - 1];
  if (prev && prev.tier === r.tier) {
    check(r.score <= prev.score,
      `${r.name}: score ${r.score} exceeds ${prev.name} in the same tier`);
  }
});
check(api.rankings.filter(r => r.tier === 'top').length === top.length, 'top tier count mismatch');
check(api.brackets.length > 0, 'rankings.json has no brackets');

report();

function report() {
  if (fails.length) {
    console.error('Build verification FAILED:');
    for (const f of fails) console.error('  ✗ ' + f);
    process.exit(1);
  }
  console.log(`Build verified: ${cards ?? '?'} cards, ${api?.rankings.length ?? '?'} ranked entries, ${html?.length ?? 0} bytes.`);
}
