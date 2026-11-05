#!/usr/bin/env node
/* Post-build checks. Exiting non-zero here blocks the deploy.
 *
 * Two seams can break the page while the build stays happy: the maths
 * (shared with the browser through src/screen.js) and the IDs app.js looks
 * up in the rendered markup. Both are checked against the built output, not
 * the source, since the output is what ships. */
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

check(html.length > 8000, `index.html suspiciously small (${html.length} bytes)`);
check(/<title>[^<]+<\/title>/.test(html), 'missing <title>');
check(!/undefined|NaN|\[object Object\]/.test(html), 'page contains undefined/NaN/[object Object]');

/* Served from /screen/, so every asset reference must be relative. */
check(/src="\.\/app\.js"/.test(html), 'script not linked relatively');
check(/href="\.\/styles\.css"/.test(html), 'stylesheet not linked relatively');
check(/from '\.\/screen\.js'/.test(app), 'app.js does not import ./screen.js relatively');
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

/* Every $('id') in the script has to exist in the markup. Prefixed lookups
   ($('sum-' + k)) are expanded from the slot lists the build renders. */
const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]));
const literal = [...app.matchAll(/\$\('([^']+)'\)/g)].map(m => m[1]);
const facts = ['size', 'area', 'vfov', 'density', 'pixel', 'avg', 'res', 'eye', 'tilt', 'throw', 'lens', 'fl', 'width', 'top', 'bottom', 'max', 'stand'];
const wanted = new Set([...literal, ...facts.flatMap(k => [`sum-${k}`, `sub-${k}`, `fact-${k}`])]);
check(literal.length >= 30, `only ${literal.length} literal lookups in app.js — did it change shape?`);
for (const id of wanted) check(ids.has(id), `app.js looks up #${id}, which the page never renders`);
for (const k of facts) check(app.includes(`'${k}'`), `app.js no longer fills slot "${k}"`);
for (const k of ['in-dist', 'in-eye', 'in-centre']) check(ids.has(`${k}-unit`), `unit adornment #${k}-unit missing`);

/* The defaults blob the script parses must be valid and complete. */
const blob = html.match(/<script type="application\/json" id="defaults">([\s\S]*?)<\/script>/);
let data = null;
try { data = JSON.parse(blob[1]); } catch { fails.push('inline defaults JSON is missing or invalid'); }

/* The maths, from the built copy. A standard that comes out at the wrong
   distance, or a pixel limit on the wrong side of the ITU figure, must
   never deploy. */
const s = await import(pathToFileURL(path.join(dist, 'screen.js')).href);
const near = (a, b, eps, msg) => check(Math.abs(a - b) <= eps, `${msg}: got ${a}, expected ${b}`);
const d65 = s.dims(65, 16 / 9);
near(d65.width, 56.65, 0.01, '65" 16:9 width');
near(s.hfov(d65, 108), 29.4, 0.1, '65" at 9 ft horizontal angle');
near(s.seatingDistances(s.dims(100, 16 / 9)).find(x => x.id === 'thx-best').distance, 120, 0.5, 'THX 40° on a 100" is 1.2× diagonal');
near(s.acuityDistance(s.pixelPitch(d65, s.resolution('2160'))) / 12, 4.23, 0.05, '4K limit on a 65"');
near(s.acuityDistance(s.pixelPitch(d65, s.resolution('1080'))) / 12, 8.45, 0.05, '1080p limit on a 65"');
near(s.footLamberts(2000, 1, s.dims(120, 16 / 9)), 46.8, 0.1, '2000 lm on a 120"');
for (const st of s.ANGLE_STANDARDS) {
  check(html.includes(`${st.angle}°`), `method copy does not mention ${st.label}'s ${st.angle}°`);
}
for (const st of s.ITU_STANDARDS) check(html.includes(`${st.heights}H`), `method copy does not mention ${st.heights}H`);
check(html.includes(`${s.BRIGHTNESS.cinema} fL`), 'method copy does not state the cinema brightness reference');
check(html.includes(`${s.PLACEMENT.maxUp}°`), 'method copy does not state the comfort limit');
/* The Cambridge eye-limit model: its constants must be printed, and the fit
   must still put the median near 95 px/° and the 95th percentile near 113,
   which is what reproduces their published matrix. */
check(html.includes(String(s.EYE_LIMIT.mu)) && html.includes(String(s.EYE_LIMIT.sigma)), 'method copy does not print the eye-limit constants');
check(html.includes('Nature Communications') && html.includes(s.EYE_LIMIT.paper), 'method copy does not cite the Cambridge paper');
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
  check(Array.isArray(data.sizes) && data.sizes.length >= 5, 'size table has too few sizes');
}

check(/id="boot-error"[^>]*hidden/.test(html), 'the hidden boot-error note is missing');
check(ids.has('out-total'), 'the headline angle has no colourable wrapper');

if (fails.length) report();
console.log(`Build verified (${wanted.size} live slots, maths checked).`);
