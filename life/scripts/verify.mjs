#!/usr/bin/env node
/* Post-build checks. Exiting non-zero here blocks the deploy.
 *
 * The page is an empty canvas until app.js runs, so a build can be "complete"
 * and still show a blank white page. The checks here cover the seams a build
 * never exercises: the script parses, every element it looks up exists, the
 * assets are linked relatively (the site lives under /life/), and the rules
 * engine in the *built* copy actually plays Life. */
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
const report = () => {
  if (!fails.length) return;
  console.error('Build verification FAILED:');
  for (const f of fails) console.error('  ✗ ' + f);
  process.exit(1);
};

for (const f of ['index.html', 'app.js', 'life.js', '.nojekyll']) {
  check(fs.existsSync(path.join(dist, f)), `missing dist/${f}`);
}
report();

const html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(dist, 'app.js'), 'utf8');

check(/<title>[^<]+<\/title>/.test(html), 'missing <title>');
check(!/undefined|NaN|\[object Object\]/.test(html),
  'page contains undefined/NaN/[object Object]');
check(/<script type="module" src="\.\/app\.js">/.test(html), 'app.js not linked relatively as a module');
for (const m of html.matchAll(/(?:href|src)="(\/[^/][^"]*)"/g)) {
  fails.push(`root-relative asset "${m[1]}" will 404 under /life/`);
}
check(/background:#fff/.test(html), 'body background is not white');

for (const f of ['app.js', 'life.js']) {
  try {
    execFileSync(process.execPath, ['--check', path.join(dist, f)], { stdio: 'pipe' });
  } catch (e) {
    fails.push(`${f} does not parse: ${String(e.stderr || e.message).trim().split('\n')[0]}`);
  }
}
check(/from '\.\/life\.js'/.test(app), 'app.js does not import ./life.js relatively');

const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]));
const wanted = [...app.matchAll(/\$\('([^']+)'\)/g)].map(m => m[1]);
check(wanted.length >= 1, 'app.js makes no element lookups — did it change shape?');
for (const id of wanted) check(ids.has(id), `app.js looks up #${id}, which the page never renders`);

/* The rules, run from the built copy. A blinker must oscillate with period 2,
   a block must hold still, and a glider must come back to itself displaced by
   (1,1) after four generations — including across the wrapped edge. */
const life = await import(pathToFileURL(path.join(dist, 'life.js')).href);
const make = (cols, rows, alive) => {
  const g = life.createGrid(cols, rows);
  for (const [x, y] of alive) g.cells[y * cols + x] = 1;
  return g;
};
const run = (g, n) => {
  let a = g.cells, b = new Uint8Array(a.length);
  for (let i = 0; i < n; i++) { life.step({ ...g, cells: a }, b); [a, b] = [b, a]; }
  return { ...g, cells: a };
};
const same = (a, b) => a.cells.length === b.cells.length && a.cells.every((c, i) => c === b.cells[i]);

const blinker = make(5, 5, [[1, 2], [2, 2], [3, 2]]);
check(same(run(blinker, 1), make(5, 5, [[2, 1], [2, 2], [2, 3]])), 'blinker did not rotate after one step');
check(same(run(blinker, 2), blinker), 'blinker is not period 2');

const block = make(4, 4, [[1, 1], [2, 1], [1, 2], [2, 2]]);
check(same(run(block, 5), block), 'block is not a still life');

const gliderAt = (dx, dy) => make(8, 8,
  [[1, 0], [2, 1], [0, 2], [1, 2], [2, 2]].map(([x, y]) => [(x + dx) % 8, (y + dy) % 8]));
check(same(run(gliderAt(0, 0), 4), gliderAt(1, 1)), 'glider did not travel (1,1) in four generations');
check(same(run(gliderAt(6, 6), 4), gliderAt(7, 7)), 'glider did not wrap across the torus edge');

const rnd = life.randomize(life.createGrid(200, 100));
const p = life.population(rnd);
check(p > 200 * 100 * 0.25 && p < 200 * 100 * 0.35, `random seed density off: ${p} of 20000 alive`);

report();
console.log(`Build verified (${wanted.length} live slot, rules pass on blinker, block and glider).`);
