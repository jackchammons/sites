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
import { tidyPossessive } from '../src/census.js';
import { buildRegistry, CATEGORIES, mapPoints, recentlyClosed } from '../src/registry.js';
import { paletteCss, CATEGORY_COLOR } from '../src/palette.js';
import { esc, hostOf } from '../build/html.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = process.env.OUT_DIR
  ? path.resolve(process.env.OUT_DIR)
  : path.join(root, '..', 'dist', path.basename(root));
const readJson = f => JSON.parse(fs.readFileSync(path.join(root, 'data', f), 'utf8'));
const dataset = readJson('restaurants.json');
/* The candidates queue, read the way the build reads it: a file that is
 * missing or does not parse is no queue, not a failed deploy. */
let candidatesFile = null;
try { candidatesFile = readJson('candidates.json'); } catch { /* the page renders without it */ }

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
// The sections every build renders, and the parts of the directory app.js
// works with. The record, the radar and the buzz are absent when they have
// nothing to show, and the nav then leaves them out.
for (const id of ['top-ten', 'board', 'styles', 'directory', 'dir-list', 'dir-tools', 'dir-q', 'dir-cats', 'dir-status', 'map', 'methodology']) {
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
  // The heading over the places that are not on file is there only when the
  // candidates queue holds something; the directory section checks that.
  if (id === 'candidates') continue;
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
  // Every line and every dot is coloured: a series gets its hue and its line
  // style from its classes, and nothing in a series is drawn in the muted ink
  // a line used to wear once the palette ran out. The record is not drawn as
  // a table; the table is in the markup, inside the block that hides it.
  const chart = html.slice(html.indexOf('id="record-chart"'), html.indexOf('id="chart-tip"'));
  const groups = [...chart.matchAll(/<g class="([^"]*\bseries\b[^"]*)">([\s\S]*?)<\/g>/g)];
  check(groups.length > 0, 'the record chart draws no series');
  for (const [, cls, body] of groups) {
    check(/\bs[1-8]\b/.test(cls) && /\bt[0-2]\b/.test(cls), `a record-chart series has no colour or line style: class="${cls}"`);
    check(!/var\(--ink-3\)|(?:stroke|fill)="/.test(body), `a record-chart series is drawn with a colour of its own, not its class: class="${cls}"`);
  }
  check(!/same record as a table/i.test(html), 'the record chart offers its table as a view again');
  check(/<div class="chart-data"><table /.test(html), 'the record chart has no table for a reader who cannot see it');
}

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

/* ---------- the directory, and the one list behind it ---------- */

/* The page lists places from one list, the registry (src/registry.js): every
 * pizzeria on file and every place known only from the candidates queue,
 * each in exactly one category. The directory renders a category as a
 * <details class="dg">; the radar, the map and every number of pizzerias the
 * page prints are drawn from the same list. What is checked here is that the
 * page agrees with that list everywhere, and that the list is whole: the
 * rows are counted against the two data files themselves. The split into
 * categories is the registry's own, so what this catches is a row or a
 * category that went missing between the data and the page, one that is in
 * two places or the wrong one, and a printed number that no longer matches
 * its rows. */
const registry = buildRegistry(dataset.restaurants, candidatesFile?.candidates ?? null);
const sectionOf = id => {
  const from = markup.indexOf(`<section class="section" id="${id}"`);
  return from < 0 ? '' : markup.slice(from, markup.indexOf('</section>', from));
};
const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
{
  const candidates = candidatesFile?.candidates ?? null;
  const queued = Array.isArray(candidates) ? candidates.length : 0;
  const dir = sectionOf('directory');

  // A category runs from its <details> to the next one, or to the map rail.
  // (Rows hold <details> of their own, so the closing tag cannot delimit it.)
  const starts = [...dir.matchAll(/<details class="dg" id="cat-([a-z-]+)" data-cat="([a-z-]+)"( open)?>/g)];
  const listEnd = dir.indexOf('<div class="dir-rail"');
  const groups = starts.map((m, i) => ({
    key: m[2], idKey: m[1], open: Boolean(m[3]), at: m.index,
    body: dir.slice(m.index, starts[i + 1]?.index ?? (listEnd < 0 ? dir.length : listEnd))
  }));
  const rowIds = body => [...body.matchAll(/<tr class="(?:dir|cq)-row[^"]*" id="([^"]+)"/g)].map(m => m[1]);
  const byKey = new Map(groups.map(g => [g.key, g]));
  check(byKey.size === groups.length, 'a directory category is rendered more than once');
  for (const g of groups) {
    check(g.key === g.idKey && CATEGORIES.includes(g.key), `the directory has a category "${g.key}" (id cat-${g.idKey}) the registry does not name`);
  }
  check(same(groups.map(g => g.key), CATEGORIES.filter(k => byKey.has(k))), `the directory's categories are out of order: ${groups.map(g => g.key).join(', ')}`);

  // Every category holds as many rows as the registry has for it, says that
  // number, and names each place. A category with nothing in it is not there.
  for (const key of CATEGORIES) {
    const want = registry.byCategory[key];
    const g = byKey.get(key);
    if (!want.length) { check(!g, `the directory shows a "${key}" category and the registry has nothing in it`); continue; }
    if (!g) { check(false, `the directory has no "${key}" category; the registry has ${want.length} place(s) in it`); continue; }
    const rows = rowIds(g.body);
    const printed = Number(g.body.match(/<span class="dg-n" data-count="[^"]*">(\d+)<\/span>/)?.[1]);
    check(rows.length === want.length, `the "${key}" category lists ${rows.length} row(s); the registry has ${want.length}`);
    check(printed === want.length, `the "${key}" category's header says ${printed}; the registry has ${want.length}`);
    // An entry is printed under its own name; a candidate under the queue's,
    // with a capitalised possessive put right the way the section does it.
    // The name has to be in the place's own row, as text a reader sees: a
    // note elsewhere in the category may name it, and so does the label of
    // the row's own button.
    for (const p of want) {
      const row = g.body.match(new RegExp(`<tr class="(?:dir|cq)-row[^"]*" id="${p.anchor}"[\\s\\S]*?</tr>`))?.[0] ?? '';
      check(row.replace(/<[^>]+>/g, ' ').includes(esc(p.kind === 'entry' ? p.name : tidyPossessive(p.name))),
        `"${p.name}" is not named in its row in the "${key}" category`);
    }
  }

  // Every place in the registry is in exactly one category, and it is its own.
  const where = new Map();
  for (const g of groups) for (const id of rowIds(g.body)) where.set(id, [...(where.get(id) ?? []), g.key]);
  const anchors = new Set(registry.places.map(p => p.anchor));
  for (const p of registry.places) {
    const at = where.get(p.anchor) ?? [];
    check(at.length === 1, `"${p.name}" is in ${at.length} categories of the directory${at.length ? ` (${at.join(', ')})` : ''}; every place is in exactly one`);
    if (at.length === 1) check(at[0] === p.category, `"${p.name}" is listed under "${at[0]}"; the registry has it under "${p.category}"`);
  }
  for (const id of where.keys()) check(anchors.has(id), `the directory lists a row "${id}" that is no place in the registry`);

  // The same, counted from the files and not from the registry: every entry
  // on file is one row in one category, and the candidates the page lists
  // plus the ones tied to an entry are the whole queue.
  const entryAt = new Map();
  let candidateRows = 0;
  for (const g of groups) {
    for (const m of g.body.matchAll(/<tr class="dir-row[^"]*" id="[^"]+" data-id="([^"]+)"/g)) entryAt.set(m[1], [...(entryAt.get(m[1]) ?? []), g.key]);
    candidateRows += (g.body.match(/<tr class="cq-row/g) ?? []).length;
  }
  let entryRows = 0;
  for (const r of dataset.restaurants) {
    const at = entryAt.get(esc(r.id)) ?? [];
    entryRows += at.length;
    check(at.length === 1, `the entry "${r.name}" is in ${at.length} categories of the directory${at.length ? ` (${at.join(', ')})` : ''}; every entry on file is in exactly one`);
  }
  check(entryRows === dataset.restaurants.length, `the directory lists ${entryRows} entry row(s); the dataset has ${dataset.restaurants.length}`);
  check(candidateRows + registry.tied === queued,
    `the directory accounts for ${candidateRows + registry.tied} candidate(s) (${candidateRows} listed, ${registry.tied} tied to an entry on file); the queue holds ${queued}`);
  const dupes = Number(dir.match(/<p class="note cq-dupes"[^>]*>\s*<b[^>]*>(\d+)<\/b>/)?.[1] ?? 0);
  check(dupes === registry.tiedPermits, `the directory counts ${dupes} further permit(s) of pizzerias on file; the queue has ${registry.tiedPermits}`);

  // By default the reader sees the ranking: that category is open, and no other.
  const openKeys = groups.filter(g => g.open).map(g => g.key);
  check(same(openKeys, registry.counts.ranked ? ['ranked'] : []),
    `the categories open by default are [${openKeys.join(', ')}]; it should be the ranked one alone`);

  // There is no Candidates section any more. Its id lives on at the head of
  // the categories that are not on file, exactly when the queue holds
  // something, so an old link still lands where the candidates are listed.
  check(!/href="#candidates"/.test(nav) && !/>\s*Candidates\s*</.test(nav), 'the nav still has a Candidates entry; the candidates are part of the directory');
  check(!markup.includes('<section class="section" id="candidates"'), 'the Candidates section is back; the candidates are part of the directory');
  check(ids.has('candidates') === queued > 0, queued
    ? `id "candidates" is missing: ${queued} candidate(s) are in the queue and old links to them land nowhere`
    : 'the "Not on file" heading rendered with no candidates queue');
  if (ids.has('candidates')) {
    const head = dir.indexOf('id="candidates"');
    const onFile = groups.filter(g => registry.byCategory[g.key].some(p => p.kind === 'entry'));
    const rest = groups.filter(g => !onFile.includes(g));
    check(head >= 0 && onFile.every(g => g.at < head) && rest.every(g => g.at > head),
      'id "candidates" is not at the head of the categories that are not on file');
  }

  // The search field and the toggles: there once, rendered hidden (they do
  // nothing without app.js), one toggle per category on the page, pressed
  // exactly where its category is open.
  const tools = dir.match(/<div class="dir-tools" id="dir-tools" hidden>([\s\S]*?)<div class="dir-list" id="dir-list">/)?.[1] ?? null;
  check(tools != null, 'the search field and the toggles (#dir-tools) are missing, are not rendered hidden, or are not ahead of the list');
  check((html.match(/\sid="dir-tools"/g) ?? []).length === 1, 'the toggles (#dir-tools) are on the page more than once');
  if (tools != null) {
    check(/<input type="search" id="dir-q"/.test(tools), 'the directory has no search field (#dir-q)');
    check(/<span id="dir-status" role="status" aria-live="polite">/.test(tools), 'the search has no polite live region (#dir-status) to announce its count in');
    for (const id of ['dir-clear', 'dir-all', 'dir-reset', 'dir-none']) {
      check(new RegExp(`<button type="button" class="dir-act" id="${id}"`).test(tools), `the directory's tools have no #${id} button`);
    }
    const chips = [...tools.matchAll(/<button type="button" class="cat-chip" data-cat="([a-z-]+)" aria-pressed="(true|false)">[\s\S]*?<b data-count="([a-z-]+)">\d+<\/b><\/button>/g)];
    check(same(chips.map(m => m[1]), groups.map(g => g.key)),
      `the toggles are for [${chips.map(m => m[1]).join(', ')}]; the categories on the page are [${groups.map(g => g.key).join(', ')}]`);
    for (const [, key, pressed, counted] of chips) {
      check(counted === key, `the "${key}" toggle prints the count of "${counted}"`);
      check((pressed === 'true') === Boolean(byKey.get(key)?.open), `the "${key}" toggle is ${pressed === 'true' ? 'pressed' : 'not pressed'} and its category is ${byKey.get(key)?.open ? 'open' : 'closed'}`);
    }
  }

  // Every number of places the page prints is the registry's. A count is
  // marked data-count wherever it is printed: the hero, the ranking's lede,
  // the directory's lede, each category's header and each toggle.
  const expected = { ...registry.counts, 'on-file': dataset.restaurants.length,
    'not-on-file': registry.places.filter(p => p.kind === 'candidate').length, 'tied-permits': registry.tiedPermits };
  const printed = [...markup.matchAll(/data-count="([^"]+)">(\d+)</g)];
  for (const [, key, n] of printed) {
    if (!Object.hasOwn(expected, key)) { check(false, `the page prints a count "${key}" the registry has no number for`); continue; }
    check(Number(n) === expected[key], `the page says ${n} for "${key}"; the registry has ${expected[key]}`);
  }
  const hero = markup.match(/<header class="hero">[\s\S]*?<\/header>/)?.[0] ?? '';
  check(/data-count="on-file">\d+</.test(hero) && /data-count="ranked">\d+</.test(hero), 'the hero no longer prints the registry\'s counts of pizzerias on file and rated');
  check(/data-count="ranked">\d+</.test(sectionOf('top-ten')), 'the ranking\'s lede no longer prints the registry\'s count of rated, open pizzerias');
  for (const g of groups) {
    const times = printed.filter(m => m[1] === g.key).length;
    check(times >= 2, `the count of "${g.key}" is printed ${times} time(s); its header and its toggle each print it`);
  }

  // The radar is two cuts of the same list: everything not open yet, and the
  // closed category's last six months, as of the moment the page was built.
  // Each place it names is in the directory under the matching category, and
  // its row links there.
  const builtAt = new Date(pageData?.builtAt ?? NaN);
  const wantRadar = {
    opening: registry.byCategory.opening.map(p => p.anchor),
    closed: Number.isFinite(builtAt.getTime()) ? recentlyClosed(registry, builtAt).map(p => p.anchor) : null
  };
  const radar = sectionOf('radar');
  const radarLists = Object.fromEntries([...radar.matchAll(/<ul class="cand-list" data-radar="(opening|closed)">([\s\S]*?)<\/ul>/g)]
    .map(m => [m[1], [...m[2].matchAll(/<li data-place="([^"]+)">([\s\S]*?)<\/li>/g)].map(x => ({ id: x[1], body: x[2] }))]));
  check(wantRadar.closed != null, 'the inline data carries no build time (builtAt), so the radar\'s six months cannot be checked');
  for (const kind of ['opening', 'closed']) {
    const items = radarLists[kind] ?? [];
    for (const it of items) {
      const at = where.get(it.id) ?? [];
      check(at.length === 1 && at[0] === kind,
        `the radar lists "${it.id}" as ${kind}; in the directory it is ${at.length ? `under "${at.join(', ')}"` : 'not listed'}`);
      check(it.body.includes(`href="#${it.id}"`), `the radar's row for "${it.id}" does not link to its row in the directory`);
    }
    if (wantRadar[kind]) {
      check(same(items.map(it => it.id).sort(), [...wantRadar[kind]].sort()),
        `the radar's ${kind} list names ${items.length} place(s); the registry has ${wantRadar[kind].length} (${wantRadar[kind].join(', ') || 'none'})`);
    }
  }

  // The map plots the registry's places, each as the row it has: a pin's
  // category is its row's, so a toggle shows the pins of the rows it opens.
  if (pageData) {
    const plotted = registry.places.filter(p => mapPoints(p).length);
    const places = Array.isArray(pageData.places) ? pageData.places : null;
    check(places != null && places.length === plotted.length,
      `the inline map data lists ${places?.length ?? 'no'} place(s); the registry has ${plotted.length} with a point to plot`);
    for (const p of places ?? []) {
      const at = where.get(p.id) ?? [];
      check(at.length === 1 && at[0] === p.cat,
        `the map data puts "${p.name}" in "${p.cat}"; its row is ${at.length ? `under "${at.join(', ')}"` : 'not in the directory'}`);
    }
    // A ranked pin is coloured by its rank among the ranked, so the data has
    // to say how many there are and give each ranked place a rank of its own.
    check(pageData.ranked === registry.counts.ranked, `the map data says ${pageData.ranked} places are ranked; the registry has ${registry.counts.ranked}`);
    const ranks = (places ?? []).filter(p => p.cat === 'ranked').map(p => p.rank);
    check(ranks.every(r => Number.isInteger(r) && r >= 1 && r <= registry.counts.ranked) && new Set(ranks).size === ranks.length,
      'a ranked place in the map data has no rank of its own between 1 and the number ranked; its pin has no colour to take');
  }
}

/* The colours are defined once, in src/palette.js. app.js reads that module
 * for the pins, and the build writes the same values into the page as custom
 * properties for the toggles and the category headers; a second definition
 * anywhere would let the two drift, and a pin would stop matching its toggle. */
{
  const sheets = [...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map(m => m[1]).join('\n');
  check(sheets.includes(paletteCss()), 'the page\'s stylesheet does not carry the palette that src/palette.js defines');
  for (const name of [...Object.keys(CATEGORY_COLOR).map(k => `--cat-${k}`), '--pin-line', '--rank-ramp']) {
    const times = (sheets.match(new RegExp(`${name}\\s*:`, 'g')) ?? []).length;
    check(times === 1, `${name} is defined ${times} time(s) in the page's stylesheet; the palette is defined once, in src/palette.js`);
  }
  const shipped = path.join(dist, 'palette.js');
  check(fs.existsSync(shipped) && fs.readFileSync(shipped).equals(fs.readFileSync(path.join(root, 'src/palette.js'))),
    'the emitted palette.js differs from src/palette.js, so the pins are not coloured from the palette the page was built with');
}

/* The page's visible text, for a test that looks for words the templates must
 * never print. Text the page quotes from the data files may contain such a
 * word honestly -- a headline can say a closing date is "still undefined" --
 * and a headline must not be able to stop a deploy, so every data string that
 * contains one is taken out of the text first. A field whose whole value is
 * one of the words is left in: printed, that is a template showing a raw
 * field. */
const dataFiles = ['restaurants.json', 'attributes.json', 'buzz.json', 'research.json']
  .filter(f => fs.existsSync(path.join(root, 'data', f))).map(readJson);
// A census note or a permit name is quoted on the page as well.
if (candidatesFile) dataFiles.push(candidatesFile);
const textWithoutQuoted = words => {
  const whole = new RegExp(`^\\s*(?:${words.source})\\s*$`, words.flags);
  const quoted = new Set();
  const collect = v => {
    if (typeof v === 'string') {
      if (!words.test(v) || whole.test(v)) return;
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
  dataFiles.forEach(collect);
  let text = markup.replace(/<[^>]+>/g, ' ');
  for (const q of [...quoted].sort((a, b) => b.length - a.length)) text = text.split(q).join(' ');
  return text;
};
const near = (text, m) => text.slice(Math.max(0, m.index - 40), m.index + 40).replace(/\s+/g, ' ');

/* A template that printed a missing value shows as one of these words in the
 * visible text. */
{
  const LEAK = /\bundefined\b|\bNaN\b|\[object Object\]/;
  const text = textWithoutQuoted(LEAK);
  const leak = LEAK.exec(text);
  check(!leak, leak && `page shows "${leak[0]}" near: ${near(text, leak)}`);
  // Tested on the markup, where quoted text is escaped: the inline data keeps
  // its apostrophes, and a name or URL there may spell anything.
  check(!/=\s*(["'])(?:undefined|null|NaN)\1/.test(markup), 'an attribute is literally undefined/null/NaN');
}

/* Every rating is described one way: read by the research agent from published
 * coverage. The page's own copy never says a rating was typed in by hand or
 * dates one to the index's launch, and it describes nothing as seeded: every
 * figure it prints is one the pipeline reads or computes. A factor's `setBy`
 * is one of these words whole, so it is not taken out as quoted text, and a
 * template that printed the raw field is caught as well. */
{
  const HAND_ENTERED = /editorial|founding entr|at launch|launched in|index launched|seeded/i;
  const text = textWithoutQuoted(HAND_ENTERED);
  const hit = HAND_ENTERED.exec(text);
  check(!hit, hit && `page describes hand-entered data ("${hit[0]}") near: ${near(text, hit)}`);
}

/* ---------- the pinned map ---------- */

/* Under 1100px the map is pinned below the nav while the list scrolls beneath
 * it. How that looks takes a layout engine, and is checked in Chromium on a
 * dev box; these are the parts a reading of the output can hold, each of
 * which has a quiet way to break on a phone and nowhere else. */
{
  const sheet = (html.match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? '').replace(/\/\*[\s\S]*?\*\//g, '');
  // The contents of every block that opens with `prelude`, nested blocks included.
  const blocksOf = prelude => {
    const out = [];
    for (let at = sheet.indexOf(prelude); at !== -1; at = sheet.indexOf(prelude, at + 1)) {
      const open = sheet.indexOf('{', at);
      let depth = 1, i = open + 1;
      for (; i < sheet.length && depth; i++) depth += sheet[i] === '{' ? 1 : sheet[i] === '}' ? -1 : 0;
      out.push(sheet.slice(open + 1, i - 1));
    }
    return out;
  };
  const stacked = blocksOf('@media (max-width: 1099px)').join('\n');
  const declared = selector => stacked.match(
    new RegExp(`(?:^|[{};])\\s*${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`))?.[1] ?? '';

  check(/position:\s*sticky/.test(declared('.dir-layout.has-map .dir-pin')),
    'under 1100px the map wrapper (.dir-pin) is not sticky; the map scrolls away from the list');
  // A sticky box holds only inside its parent, so the wrapper has to be laid
  // out as a child of the layout, not of the rail.
  check(/display:\s*contents/.test(declared('.dir-layout.has-map .dir-rail')),
    'under 1100px the rail keeps its own box, so the pinned map cannot outlast it');
  // app.js finds where the visible list begins from the header's sticky offset.
  check(/top:[^;]*var\(--map-h\)/.test(declared('.dir-layout.has-map .dir-table thead th')),
    'under 1100px the table header does not stick below the pinned map');
  // The rail is rendered hidden. An author rule that gives it a display value
  // beats the hidden attribute, so every one has to wait for .has-map.
  for (const [, selectors, body] of sheet.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!/(?:^|;)\s*display\s*:/.test(body)) continue;
    for (const sel of selectors.split(',').map(x => x.trim())) {
      check(!/\.dir-rail$/.test(sel) || sel.includes('.has-map'),
        `"${sel}" sets display on the map rail without .has-map; a reader without JavaScript gets an empty pinned box`);
      // The search field and the toggles are rendered hidden for the same reason.
      check(!/\.dir-tools$/.test(sel) || sel.includes('.has-tools'),
        `"${sel}" sets display on the directory's tools without .has-tools; a reader without JavaScript gets a search field and toggles that do nothing`);
    }
  }
  check(/<div class="dir-rail" id="map-rail" hidden>\s*<div class="dir-pin">\s*<div id="map"[^>]*><\/div>\s*<\/div>\s*<p class="note dir-map-note">/.test(html),
    'the map rail is not hidden > wrapper > map, with the legend after the wrapper; the legend would be pinned with the map, or the rail shown without one');
  // With no box of its own under 1100px, the rail never intersects anything.
  check(!/\.observe\(\s*rail\s*\)/.test(appJs),
    'app.js waits for the rail to near the viewport before loading the map; on a phone that never happens');
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

report(`Build verified: ${cardIds.length} cards, ${api.rankings.length} ranked entries, ${registry.places.length} places in ${CATEGORIES.filter(k => registry.counts[k]).length} categories, ${html.length} bytes.`);
