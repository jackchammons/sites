#!/usr/bin/env node
/* Post-build checks. Exiting non-zero here blocks the deploy.
 *
 * The page is an empty canvas until app.js runs, so a build can be "complete"
 * and still show a blank white page. The checks here cover the seams a build
 * never exercises: the script parses, every element it looks up exists, the
 * assets are linked relatively (the site lives under /life/), and the rules
 * engine in the *built* copy actually plays Life and can tell a board that
 * has settled from one that is still going. */
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
/* Visible text only, which here is the noscript line: one of these words in
   it is a template that interpolated nothing. Scripts, styles and attribute
   values are left out, and the second check covers the attributes. */
const text = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ');
const leak = /\bundefined\b|\bNaN\b|\[object Object\]/.exec(text);
check(!leak, leak && `page shows "${leak[0]}" near: ${text.slice(Math.max(0, leak.index - 40), leak.index + 40).replace(/\s+/g, ' ')}`);
check(!/=\s*(["'])(?:undefined|null|NaN)\1/.test(html), 'an attribute is literally undefined/null/NaN');
check(/<script type="module" src="\.\/app\.js">/.test(html), 'app.js not linked relatively as a module');
for (const m of html.matchAll(/(?:href|src)="(\/[^/][^"]*)"/g)) {
  fails.push(`root-relative asset "${m[1]}" will 404 under /life/`);
}
check(/background:#fff/.test(html), 'body background is not white');
/* The page has no controls, so the label on the canvas is the only place the
   pause gesture is written down. */
check(/<canvas id="board" aria-label="[^"]*\bpause\b[^"]*"/.test(html),
  'the canvas label does not mention how to pause');

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
/* A module that imports a name its dependency does not export never runs:
   the page stays a blank white canvas with nothing to say why. */
for (const [, names] of app.matchAll(/import\s*\{([^}]*)\}\s*from\s*'\.\/life\.js'/g)) {
  for (const name of names.split(',').map(n => n.trim()).filter(Boolean)) {
    check(typeof life[name] === 'function', `app.js imports "${name}", which life.js does not export`);
  }
}
report();
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

/* The settled-board test, from the built copy. It has to fire on a board that
   only repeats, or the page freezes into still lifes and blinkers for good,
   and it must not fire while anything is still travelling, or a board that
   is alive gets wiped. `firesBy` steps a board, asking after every generation
   as app.js does, and returns the generation at which it fired. */
const firesBy = (g, generations) => {
  const watch = life.createWatch();
  let a = g.cells, b = new Uint8Array(a.length);
  for (let i = 1; i <= generations; i++) {
    life.step({ ...g, cells: a }, b); [a, b] = [b, a];
    if (life.settled(watch, { ...g, cells: a })) return i;
  }
  return null;
};
const P = life.SETTLE_PERIOD;
check(Number.isInteger(P) && [1, 2, 3, 15].every(n => P % n === 0),
  `SETTLE_PERIOD is ${P}, which is not a multiple of the periods soup settles into (1, 2, 3, 15)`);
const blockAndBlinker = make(12, 12, [[1, 1], [2, 1], [1, 2], [2, 2], [6, 7], [7, 7], [8, 7]]);
check(firesBy(blockAndBlinker, 2 * P + 1) !== null, 'a block and a blinker did not read as settled');
check(firesBy(make(12, 12, []), 2 * P + 1) !== null, 'an empty board did not read as settled');
// A row of ten cells becomes the pentadecathlon, the period-15 oscillator.
const rowOfTen = make(24, 24, Array.from({ length: 10 }, (_, i) => [7 + i, 12]));
check(firesBy(rowOfTen, 3 * P + 1) !== null, 'a pentadecathlon did not read as settled');
const loneGlider = life.createGrid(48, 105);
for (const [x, y] of [[1, 0], [2, 1], [0, 2], [1, 2], [2, 2]]) loneGlider.cells[y * 48 + x] = 1;
check(firesBy(loneGlider, 20 * P) === null, 'a board with a glider in flight read as settled');
// A change of size is a different board: the watch starts again and does not compare across it.
const resized = life.createWatch();
life.settled(resized, make(4, 4, []));
check(life.settled(resized, make(5, 5, [])) === false && resized.cells.length === 25,
  'the watch compared boards of different sizes');

report();
console.log(`Build verified (${wanted.length} live slot, rules pass on blinker, block and glider, settled-board test passes).`);
