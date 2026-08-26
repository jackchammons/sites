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

/* Follow every relative import from the shipped modules and confirm it landed.
 * The static build cannot notice a missing one -- it renders server-side and is
 * perfectly happy -- but the browser 404s and the re-ranker dies silently. The
 * copy list in build.mjs is hand-maintained, so this walks what the code
 * actually imports rather than trusting that list to stay in step. */
const seenMod = new Set();
const walkImports = file => {
  if (seenMod.has(file)) return;
  seenMod.add(file);
  const full = path.join(dist, file);
  if (!fs.existsSync(full)) return;
  const src = fs.readFileSync(full, 'utf8');
  for (const m of src.matchAll(/(?:^|\n)\s*(?:import|export)[^'"\n]*from\s+['"](\.[^'"]+)['"]/g)) {
    const dep = path.posix.normalize(path.posix.join(path.posix.dirname(file), m[1]));
    check(fs.existsSync(path.join(dist, dep)),
          `dist/${file} imports "${m[1]}" but dist/${dep} was not emitted — the browser will 404`);
    walkImports(dep);
  }
};
walkImports('app.js');

const html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
check(html.length > 20000, `index.html suspiciously small (${html.length} bytes)`);
check(/<title>[^<]+<\/title>/.test(html), 'missing <title>');

// The published split is computed, not stored: top 10 full cards, every other
// rated entry a compact row. Unrated entries (status "opening", discoveries)
// appear elsewhere on the page but never as ranked cards or rows.
const rated = dataset.restaurants.filter(r => r.factors?.craft && r.factors?.distinctiveness && typeof r.criticScore === 'number');
const topCount = Math.min(10, rated.length);

const cards = (html.match(/<article class="card/g) || []).length;
check(cards === topCount, `expected ${topCount} cards, found ${cards}`);

check(!/bench-row|bench-list/.test(html), 'bench markup should be gone');
check(/class="brackets"/.test(html), 'style brackets section missing');

// The directory lists every entry in the dataset, whatever its status.
const dirRows = (html.match(/<tr class="dir-row/g) || []).length;
check(dirRows === dataset.restaurants.length,
  `expected ${dataset.restaurants.length} directory rows, found ${dirRows}`);

// Any entry with a website must be linked wherever its name appears; checking
// the href is present catches a rendering path that dropped the link.
for (const r of dataset.restaurants) {
  if (r.url) check(html.includes(`href="${r.url}"`), `"${r.name}" has a url but no link on the page`);
}

// Every entry in the dataset must appear somewhere on the page.
for (const r of dataset.restaurants) {
  check(html.includes(r.name.replace(/'/g, '&#39;')) || html.includes(r.name),
    `"${r.name}" missing from the page`);
}
check(!/undefined|NaN|\[object Object\]/.test(html), 'page contains undefined/NaN/[object Object]');

const api = JSON.parse(fs.readFileSync(path.join(dist, 'rankings.json'), 'utf8'));
check(api.rankings.length === rated.length,
  `rankings.json length mismatch (${api.rankings.length} vs ${rated.length} rated)`);

api.rankings.forEach((r, i) => {
  check(r.rank === i + 1, `rank ${r.rank} out of sequence at index ${i}`);
  check(Number.isFinite(r.score) && r.score > 0 && r.score <= 100,
    `${r.name}: score ${r.score} out of range`);
  // One ladder now: every entry is measured the same way and competes on score,
  // so the whole list must descend. A reported closure is the only exception —
  // it is held below the top ten whatever it scores.
  const prev = api.rankings[i - 1];
  if (prev && r.status !== 'closed' && prev.status !== 'closed') {
    check(r.score <= prev.score,
      `${r.name}: score ${r.score} exceeds ${prev.name} above it`);
  }
});
// tier in the dataset is only a seed; the published split is computed by score.
check(api.rankings.filter(r => r.rank <= 10).length === 10, 'expected 10 published entries');
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
