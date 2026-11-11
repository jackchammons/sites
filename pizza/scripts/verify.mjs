#!/usr/bin/env node
/* The deploy gate for this site: the unit suite, then checks on what the build
 * emitted. The page is finished by the browser, so the checks cover what a
 * server-side render cannot notice on its own: that the page's script parses
 * and finds the elements and data it reads, that every in-page link lands, and
 * that the cards, the chart and rankings.json tell the same story. A failure
 * here stops every site's deploy, so nothing in it may depend on what a
 * headline or an agent's note happens to say. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { isRated } from '../src/slice.js';
import { esc, hostOf } from '../build/html.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = process.env.OUT_DIR
  ? path.resolve(process.env.OUT_DIR)
  : path.join(root, '..', 'dist', path.basename(root));
const readJson = f => JSON.parse(fs.readFileSync(path.join(root, 'data', f), 'utf8'));
const dataset = readJson('restaurants.json');

/* The unit suite runs first: verify.mjs is the deploy gate the orchestrator
 * calls, so a failing rule test blocks a deploy exactly like a bad page would.
 * Explicit file list because this Node's --test does not take a directory. */
{
  const testDir = path.join(root, 'test');
  const files = fs.existsSync(testDir)
    ? fs.readdirSync(testDir).filter(f => f.endsWith('.test.mjs')).map(f => path.join(testDir, f))
    : [];
  if (files.length) {
    try {
      execFileSync(process.execPath, ['--test', ...files], { stdio: ['ignore', 'ignore', 'inherit'] });
      console.log(`unit tests passed (${files.length} file(s)).`);
    } catch {
      console.error('Build verification FAILED: unit tests failed. Run: node --test pizza/test/*.test.mjs');
      process.exit(1);
    }
  }
}

const fails = [];
const check = (ok, msg) => { if (!ok) fails.push(msg); };
const report = summary => {
  if (fails.length) {
    console.error('Build verification FAILED:');
    for (const f of fails) console.error('  ✗ ' + f);
    process.exit(1);
  }
  if (summary) console.log(summary);
};

for (const f of ['index.html', 'app.js', 'leaflet.js', 'rankings.json', '.nojekyll']) {
  check(fs.existsSync(path.join(dist, f)), `missing ${f} in the output`);
}
report();

/* ---------- the page's script ---------- */

/* Follow every relative import from the shipped modules and confirm it landed.
 * The static build cannot notice a missing one -- it renders server-side and is
 * perfectly happy -- but the browser 404s and the page's behaviour dies
 * silently. The copy list in build/emit.mjs is hand-maintained, so this walks
 * what the code actually imports rather than trusting that list to stay in
 * step. */
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
          `${file} imports "${m[1]}" but ${dep} was not emitted — the browser will 404`);
    walkImports(dep);
  }
};
walkImports('app.js');

// A syntax error anywhere in the module stops all of it in the browser, and
// nothing server-side would say so.
const appJs = fs.readFileSync(path.join(dist, 'app.js'), 'utf8');
try {
  execFileSync(process.execPath, ['--input-type=module', '--check'], { input: appJs, stdio: ['pipe', 'ignore', 'pipe'] });
} catch (e) {
  check(false, `app.js does not parse: ${String(e.stderr ?? e.message).trim().split('\n').slice(0, 5).join(' | ')}`);
}

// Leaflet is outside the import graph: app.js fetches it by name when the map
// is about to be seen. The emitted copy must be the vendored file, whole.
check(/(['"])\.\/leaflet\.js\1/.test(appJs), 'app.js no longer names "./leaflet.js"; the map has nothing to load');
check(fs.readFileSync(path.join(dist, 'leaflet.js')).equals(fs.readFileSync(path.join(root, 'src/vendor/leaflet.js'))),
  'the emitted leaflet.js differs from src/vendor/leaflet.js');

/* ---------- the page ---------- */

const html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]));
// Everything outside script and style blocks: what the reader is shown, with
// its tags still on.
const markup = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, ' ');

check(html.length > 20000, `index.html suspiciously small (${html.length} bytes)`);
check(/<title>[^<]+<\/title>/.test(html), 'missing <title>');
check(/<main>/.test(html) && /<nav class="site-nav"/.test(html), 'landmarks missing (main, nav)');
check(/<style>[\s\S]{5000,}<\/style>/.test(html), 'the inline stylesheet is missing or nearly empty');
// The sections every build renders. The record, the radar and the buzz are
// absent when they have nothing to show, and the nav then leaves them out.
for (const id of ['top-ten', 'board', 'styles', 'directory', 'dir-body', 'map', 'methodology']) {
  check(ids.has(id), `id "${id}" missing from the page`);
}
check(html.indexOf('id="methodology"') < html.indexOf('</main>'), 'the methodology section is outside <main>');

// Every in-page link lands on something: the nav, the skip link, and the
// "how it works" links in the evidence lines.
const nav = html.match(/<nav class="site-nav"[\s\S]*?<\/nav>/)?.[0] ?? '';
check((nav.match(/href="#/g) ?? []).length >= 3, 'the section nav has fewer than three links');
for (const [, target] of markup.matchAll(/href="#([^"]*)"/g)) {
  check(ids.has(target), `a link points at #${target}, which is not on the page`);
}

// Every element app.js looks up by a literal id has to be in the markup: a
// renamed id breaks only the browser. The chart's ids are owed only when the
// record section rendered.
const lookedUp = new Set([
  ...[...appJs.matchAll(/getElementById\(\s*['"]([^'"]+)['"]\s*\)/g)].map(m => m[1]),
  ...[...appJs.matchAll(/querySelector(?:All)?\(\s*['"]#([\w-]+)/g)].map(m => m[1])
]);
check(lookedUp.size > 0, 'found no id lookups in app.js; the id check is not checking anything');
for (const id of lookedUp) {
  if (/^(record-chart|chart-)/.test(id) && !ids.has('record')) continue;
  check(ids.has(id), `app.js looks up #${id}, which is not on the page`);
}

// The data the script reads has to parse, or the module stops at its first line.
let pageData = null;
const blob = html.match(/<script>window\.__PIZZA__ = ([\s\S]*?);<\/script>/)?.[1];
try {
  pageData = JSON.parse(blob ?? '');
} catch (e) {
  check(false, blob == null ? 'the inline __PIZZA__ data block is missing or cut short'
    : `the inline __PIZZA__ data does not parse: ${e.message}`);
}
if (pageData) {
  check(pageData.dataset?.restaurants?.length === dataset.restaurants.length,
    `inline data lists ${pageData.dataset?.restaurants?.length} entries, the dataset has ${dataset.restaurants.length}`);
}

// The published split is computed, not stored: the ten highest-scoring rated,
// open entries as full cards, every entry in the directory table.
const rated = dataset.restaurants.filter(isRated);
const openRated = rated.filter(r => (r.status ?? 'open') === 'open');
const topCount = Math.min(10, openRated.length);
const cardIds = [...html.matchAll(/<article class="card[^"]*" data-id="([^"]+)"/g)].map(m => m[1]);
check(cardIds.length === topCount, `expected ${topCount} cards, found ${cardIds.length}`);
check(/class="brackets"/.test(html), 'style brackets section missing');

// The record chart's newest column is this build's ten, in card order: the
// chart must never show a ranking the cards above it do not.
if (ids.has('record')) {
  const nameOf = new Map(dataset.restaurants.map(r => [r.id, r.name]));
  try {
    const raw = (html.match(/data-standings='([^']*)'/)?.[1] ?? '').replace(/&#39;/g, "'");
    const standings = JSON.parse(raw);
    check(Array.isArray(standings) && standings.length >= 2, 'the record chart has fewer than two weeks');
    const last = standings.at(-1)?.names ?? [];
    const cards = cardIds.map(id => nameOf.get(id));
    check(JSON.stringify(last) === JSON.stringify(cards),
      `the record chart's newest week (${last.join(', ')}) is not the ten on the cards (${cards.join(', ')})`);
  } catch (e) {
    check(false, `the record chart's data-standings does not parse: ${e.message}`);
  }
}

// The directory lists every entry in the dataset, whatever its status.
const dirRows = (html.match(/<tr class="dir-row/g) || []).length;
check(dirRows === dataset.restaurants.length,
  `expected ${dataset.restaurants.length} directory rows, found ${dirRows}`);

// Any entry with a website must be linked wherever its name appears; checking
// the href is present catches a rendering path that dropped the link.
for (const r of dataset.restaurants) {
  if (r.url) check(markup.includes(`href="${esc(r.url)}"`), `"${r.name}" has a url but no link on the page`);
}

// Every entry in the dataset must appear in the markup the reader sees. The
// inline data names every entry too, which is why script blocks are left out.
for (const r of dataset.restaurants) {
  check(markup.includes(esc(r.name)), `"${r.name}" missing from the page`);
}

/* A template that printed a missing value shows as one of these words in the
 * visible text. Text the page quotes from the data files may contain them
 * honestly -- a headline can say a closing date is "still undefined" -- and a
 * headline must not be able to stop a deploy, so every data string that
 * contains one is taken out of the text before the test. A field whose whole
 * value is one of the words is still a hit: that is a broken record, shown. */
{
  const LEAK = /\bundefined\b|\bNaN\b|\[object Object\]/;
  const quoted = new Set();
  const collect = v => {
    if (typeof v === 'string') {
      if (!LEAK.test(v) || /^\s*(?:undefined|NaN|\[object Object\])\s*$/.test(v)) return;
      quoted.add(esc(v));
      // A URL is shown as its host, or without its scheme.
      if (/^https?:\/\//i.test(v)) {
        quoted.add(esc(hostOf(v)));
        quoted.add(esc(v.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')));
      }
    } else if (v && typeof v === 'object') {
      Object.values(v).forEach(collect);
    }
  };
  for (const f of ['restaurants.json', 'attributes.json', 'buzz.json', 'research.json']) {
    if (fs.existsSync(path.join(root, 'data', f))) collect(readJson(f));
  }
  let text = markup.replace(/<[^>]+>/g, ' ');
  for (const q of [...quoted].sort((a, b) => b.length - a.length)) text = text.split(q).join(' ');
  const leak = LEAK.exec(text);
  check(!leak, leak && `page shows "${leak[0]}" near: ${text.slice(Math.max(0, leak.index - 40), leak.index + 40).replace(/\s+/g, ' ')}`);
  // Tested on the markup, where quoted text is escaped: the inline data keeps
  // its apostrophes, and a name or URL there may spell anything.
  check(!/=\s*(["'])(?:undefined|null|NaN)\1/.test(markup), 'an attribute is literally undefined/null/NaN');
}

/* ---------- rankings.json ---------- */

const api = JSON.parse(fs.readFileSync(path.join(dist, 'rankings.json'), 'utf8'));
check(api.rankings.length === rated.length,
  `rankings.json length mismatch (${api.rankings.length} vs ${rated.length} rated)`);

api.rankings.forEach((r, i) => {
  check(r.rank === i + 1, `rank ${r.rank} out of sequence at index ${i}`);
  check(Number.isFinite(r.score) && r.score > 0 && r.score <= 100,
    `${r.name}: score ${r.score} out of range`);
  // One ladder: every open entry competes on score, so the open field must
  // descend. An entry that is not open (closed, or closed for a move and
  // "opening" again) is held below the open field whatever it scores, so a
  // pair is compared only when both are open.
  const prev = api.rankings[i - 1];
  if (prev && r.status === 'open' && prev.status === 'open') {
    check(r.score <= prev.score,
      `${r.name}: score ${r.score} exceeds ${prev.name} above it`);
  }
});
check(JSON.stringify(api.rankings.slice(0, topCount).map(r => r.id)) === JSON.stringify(cardIds),
  'the first entries of rankings.json are not the cards on the page, in order');
check(api.rankings.slice(0, topCount).every(r => r.status === 'open'), 'a published entry is not open');
check(api.brackets.length > 0, 'rankings.json has no brackets');

report(`Build verified: ${cardIds.length} cards, ${api.rankings.length} ranked entries, ${html.length} bytes.`);
