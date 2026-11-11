#!/usr/bin/env node
/* Post-build checks. Exiting non-zero here blocks the deploy.
 *
 * Three seams can break the page while the build stays happy: the maths
 * (shared with the browser through src/screen.js), the names app.js imports
 * from it, and the IDs app.js looks up in the rendered markup. All three are
 * checked against the built output, not the source, since the output is what
 * ships. What app.js does once it is running is test/page.test.mjs's job. */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = process.env.OUT_DIR ? path.resolve(process.env.OUT_DIR) : path.join(root, '..', 'dist', path.basename(root));

const fails = [];
const check = (ok, msg) => { if (!ok) fails.push(msg); };
function report() {
  console.error('Build verification FAILED:');
  for (const f of fails) console.error('  ✗ ' + f);
  process.exit(1);
}

for (const f of ['index.html', 'app.js', 'screen.js', 'styles.css', '.nojekyll']) {
  check(fs.existsSync(path.join(dist, f)), `missing dist/${f}`);
}
if (fails.length) report();

const html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(dist, 'app.js'), 'utf8');

check(html.length > 6000, `index.html suspiciously small (${html.length} bytes)`);
check(/<title>[^<]+<\/title>/.test(html), 'missing <title>');
/* A value that failed to render shows as one of these words. Only what a
   reader sees is searched, so a word inside a script or a style is not a hit. */
const text = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ');
const leak = /\bundefined\b|\bNaN\b|\[object Object\]/.exec(text);
check(!leak, leak && `page shows "${leak[0]}" near: ${text.slice(Math.max(0, leak.index - 40), leak.index + 40).replace(/\s+/g, ' ')}`);
check(!/=\s*(["'])(?:undefined|null|NaN)\1/.test(html), 'an attribute is literally undefined/null/NaN');

/* Served from /screen/, so every asset reference must be relative. The
   multi-site build adds a content stamp (?v=…) to each after this runs; it is
   allowed for here so the published copy verifies too. */
const STAMP = String.raw`(?:\?v=[0-9a-f]+)?`;
check(new RegExp(`src="\\./app\\.js${STAMP}"`).test(html), 'script not linked relatively');
check(new RegExp(`href="\\./styles\\.css${STAMP}"`).test(html), 'stylesheet not linked relatively');
check(new RegExp(`from '\\./screen\\.js${STAMP}'`).test(app), 'app.js does not import ./screen.js relatively');
for (const m of html.matchAll(/(?:href|src)="(\/[^/][^"]*)"/g)) {
  fails.push(`root-relative asset "${m[1]}" will 404 under /screen/`);
}

for (const f of ['app.js', 'screen.js']) {
  try {
    execFileSync(process.execPath, ['--check', '--input-type=module'],
      { input: fs.readFileSync(path.join(dist, f)), stdio: 'pipe' });
  } catch (e) {
    fails.push(`${f} does not parse: ${String(e.stderr || e.message).trim().split('\n')[0]}`);
  }
}
if (fails.length) report();

/* Parsing is not linking: a name app.js imports that screen.js does not
   export stops the page before its first line runs, and only a browser would
   say so. The built module is loaded here for the maths below anyway. */
const s = await import(pathToFileURL(path.join(dist, 'screen.js')).href);
const imports = app.match(new RegExp(`^import\\s*\\{([^}]*)\\}\\s*from\\s*'\\./screen\\.js${STAMP}';`, 'm'));
check(imports, 'app.js has no import list from ./screen.js to check');
const imported = imports ? imports[1].split(',').map(n => n.trim().split(/\s+as\s+/)[0]).filter(Boolean) : [];
check(imported.length >= 20, `only ${imported.length} names imported from screen.js — did the import change shape?`);
for (const name of imported) check(name in s, `app.js imports "${name}", which screen.js does not export`);
check([...app.matchAll(/^import\b/gm)].length === 1, 'app.js has an import this check does not follow');

/* Every $('id') in the script has to exist in the markup. Prefixed lookups
   ($('sum-' + k)) are checked in both directions against what was built: a
   slot the page renders must be filled by a set('<k>', …) call, and a call
   must have its three elements. The call is matched as written, since a bare
   'eye' or 'res' also appears in code that fills nothing. */
const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]));
const literal = [...app.matchAll(/\$\('([^']+)'\)/g)].map(m => m[1]);
const slots = [...ids].filter(id => id.startsWith('sum-')).map(id => id.slice(4));
const filled = new Set([...app.matchAll(/(?<![.\w])set\('([^']+)'/g)].map(m => m[1]));
check(literal.length >= 30, `only ${literal.length} literal lookups in app.js — did it change shape?`);
check(slots.length >= 17, `only ${slots.length} fact slots in the page — did the markup change shape?`);
for (const id of new Set(literal)) check(ids.has(id), `app.js looks up #${id}, which the page never renders`);
for (const k of slots) check(filled.has(k), `the page renders slot "${k}", which app.js never fills`);
for (const k of new Set([...slots, ...filled])) {
  for (const id of [`sum-${k}`, `sub-${k}`, `fact-${k}`]) check(ids.has(id), `app.js fills slot "${k}", but the page has no #${id}`);
}
/* A grade is a colour class and a word, and a fact must not be able to get
   the first without the second. Every fact, and the headline, has a slot for
   the word; and one function in the script adds the class and writes the word
   together, with no other statement able to add a class or replace a class
   list. Whether each grade is the right one is test/page.test.mjs's job. */
for (const k of slots) check(new RegExp(`<span id="sum-${k}">[^<]*</span> <span class="grade" id="grade-${k}"></span>`).test(html), `fact "${k}" has no slot for its grade word`);
check(/<p class="total" id="out-total">.*<span class="grade" id="out-grade"><\/span><\/p>/.test(html), 'the headline has no slot for its grade word');
const grader = app.match(/const showGrade = \(box, word, cls\) => \{\n([\s\S]*?)\n  \};/);
check(grader, 'app.js has no showGrade(box, word, cls) to check');
if (grader) {
  check(/box\.classList\.add\(cls\)/.test(grader[1]) && /word\.textContent = /.test(grader[1]), 'showGrade no longer sets the grade class and the grade word together');
  check(/\$\('fact-' \+ k\), \$\('grade-' \+ k\)/.test(app) && /\$\('out-total'\), \$\('out-grade'\)/.test(app), 'a grade is shown without its word slot');
}
check([...app.matchAll(/classList\.add\(/g)].length === 1 && !/\bclassName\b/.test(app), 'app.js sets a class outside showGrade, where a grade could be coloured without its word');
for (const k of ['in-dist', 'in-eye', 'in-centre']) check(ids.has(`${k}-unit`), `unit adornment #${k}-unit missing`);
for (const k of ['in-dist', 'in-eye']) check(ids.has(`${k}-hint`), `hint #${k}-hint missing`);
/* An invalid field is named by the label around it. */
for (const [, id] of html.matchAll(/<input id="([^"]+)"/g)) {
  check(new RegExp(`<label class="field" for="${id}">\\s*<span class="lbl">[^<]+</span>`).test(html), `input #${id} has no labelled field around it`);
}
/* The fields that accept "8 ft 6 in", "2.6 m" or a minus sign need a
   keyboard that can type them; a decimal keypad cannot. */
for (const id of ['in-diag', 'in-dist', 'in-eye', 'in-centre', 'in-offset']) {
  check(new RegExp(`<input id="${id}"[^>]*inputmode="text"`).test(html), `#${id} does not ask for a full keyboard`);
}

/* The defaults blob the script parses must be valid and complete. */
const blob = html.match(/<script type="application\/json" id="defaults">([\s\S]*?)<\/script>/);
let data = null;
try { data = JSON.parse(blob[1]); } catch { fails.push('inline defaults JSON is missing or invalid'); }

/* The maths, from the built copy. A standard that comes out at the wrong
   distance, or a pixel limit on the wrong side of the ITU figure, must
   never deploy. */
const near = (a, b, eps, msg) => check(Math.abs(a - b) <= eps, `${msg}: got ${a}, expected ${b}`);
const d65 = s.dims(65, 16 / 9);
near(d65.width, 56.65, 0.01, '65" 16:9 width');
near(s.hfov(d65, 108), 29.4, 0.1, '65" at 9 ft horizontal angle');
near(s.seatingDistances(s.dims(100, 16 / 9)).find(x => x.id === 'thx-best').distance, 120, 0.5, 'THX 40° on a 100" is 1.2× diagonal');
near(s.acuityDistance(s.pixelPitch(d65, s.resolution('2160'))) / 12, 4.23, 0.05, '4K limit on a 65"');
near(s.acuityDistance(s.pixelPitch(d65, s.resolution('1080'))) / 12, 8.45, 0.05, '1080p limit on a 65"');
near(s.footLamberts(2000, 1, s.dims(120, 16 / 9)), 46.8, 0.1, '2000 lm on a 120"');
/* The Cambridge eye-limit model must still put the median near 95 px/° and
   the 95th percentile near 113, which is what reproduces their matrix. */
check(html.includes(s.EYE_LIMIT.paper) && html.includes(s.EYE_LIMIT.calculator), 'the footer no longer credits the Cambridge model');
near(s.ppdForFraction(0.5), 95.4, 0.3, 'median eye limit');
near(s.ppdForFraction(0.05), 113.4, 0.5, '95th percentile eye limit');
const M = 100 / 2.54;
check(s.limitResolution(s.dims(50, 16 / 9), 2 * M)?.label === '4K', 'matrix: 50" at 2 m should be 4K');
check(s.limitResolution(s.dims(30, 16 / 9), 6 * M)?.label === 'HD', 'matrix: 30" at 6 m should be HD');
check(s.limitResolution(s.dims(100, 16 / 9), 0.4 * M) === null, 'matrix: 100" at 0.4 m should exceed 32K');
check(html.includes('<option value="custom">'), 'custom resolution option missing');
for (const id of ['in-resw', 'in-resh', 'custom-res', 'btn-this', 'eye-bar', 'eye-tip', 'targets', 'matrix']) check(ids.has(id), `#${id} missing`);
if (data) {
  const v = data.inputs;
  for (const k of ['diagonal', 'distance', 'eyeHeight', 'centreHeight', 'throwMin', 'throwMax', 'lensOffset', 'lumens', 'gain']) {
    check(Number.isFinite(v[k]), `default "${k}" is not a number`);
  }
  check(s.ASPECTS.some(a => a.id === v.aspect), `default aspect ${v.aspect} is not offered`);
  check(s.RESOLUTIONS.some(r => r.id === v.resolution), `default resolution ${v.resolution} is not offered`);
  check(html.includes(`<option value="${v.aspect}" selected>`), 'default shape is not the selected option');
  check(html.includes(`<option value="${v.resolution}" selected>`), 'default resolution is not the selected option');
  /* Everything else app.js reads from the blob. A missing list throws inside
     a draw function, after the headline has already rendered. */
  for (const k of ['customW', 'customH']) check(Number.isFinite(v[k]) && v[k] >= 16, `default "${k}" is not a pixel count`);
  check(['imperial', 'metric'].includes(v.units), `default units "${v.units}" is neither imperial nor metric`);
  check(['tv', 'projector'].includes(v.mode), `default mode "${v.mode}" is neither tv nor projector`);
  for (const [k, min] of [['sizes', 5], ['matrixSizes', 3], ['matrixFeet', 3], ['matrixMetres', 3]]) {
    const list = data[k];
    check(Array.isArray(list) && list.length >= min && list.every(x => Number.isFinite(x) && x > 0), `"${k}" is not a list of at least ${min} positive numbers`);
  }
}

/* The note that says the script did not start, and the three things that
   can reveal it when the script is what is missing. */
check(/id="boot-error"[^>]*hidden/.test(html), 'the hidden boot-error note is missing');
check(new RegExp(`<script type="module" src="\\./app\\.js${STAMP}" onerror="bootFailed\\(\\)">`).test(html), 'the module script has no onerror fallback');
check(/<script nomodule>[^<]*bootFailed/.test(html), 'no fallback for a browser without modules');
check(/addEventListener\('load'[^<]*__screenBooted[^<]*bootFailed\(\)/.test(html), 'no check after load that the script booted');
check(/window\.__screenBooted = true;/.test(app), 'app.js never reports that it booted');
check(/aria-live="polite"[^>]*>\s*<p class="total" id="out-total"/.test(html) && !/<section[^>]*aria-live/.test(html), 'the live region should be the headline, not the whole results panel');
check(/id="status" role="status"/.test(html), '#status is not announced');
check(ids.has('out-total'), 'the headline angle has no colourable wrapper');

if (fails.length) report();
console.log(`Build verified (${new Set(literal).size + slots.length * 3} live slots, maths checked).`);
