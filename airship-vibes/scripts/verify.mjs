#!/usr/bin/env node
/* Post-build checks. Exiting non-zero here blocks the deploy.
 *
 * The page is an empty canvas until app.js runs, and what it draws is decided
 * by a dozen modules that only meet in the browser. A build can be complete
 * and still show nothing: one module importing a name another stopped
 * exporting is a blank page with an error in a console nobody is watching.
 * These checks cover the seams a build never exercises: every module parses,
 * every import resolves to a file that was emitted and a name it exports, the
 * markup has what the script looks up, and the built copies of the pure
 * modules (the ones that decide what is drawn) actually produce an airship,
 * four scenes and a camera.
 *
 * GLSL cannot be compiled here; test/browser-check.mjs does that on a dev box.
 * The checks every site shares (relative asset paths, referenced files exist)
 * are applied by the multi-site build, which also stamps asset URLs after this
 * has run, so neither belongs here. */
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

const MODULES = ['app.js', 'director.js', 'flock.js', 'font.js', 'glsl.js', 'layout.js', 'mesh.js', 'noise.js',
  'palette.js', 'params.js', 'renderer.js', 'rng.js', 'scenes.js', 'ship.js', 'terrain.js', 'vec.js'];
for (const f of ['index.html', '.nojekyll', ...MODULES]) check(fs.existsSync(path.join(dist, f)), `missing dist/${f}`);
report();
const emitted = fs.readdirSync(dist).filter(f => f.endsWith('.js')).sort();
check(JSON.stringify(emitted) === JSON.stringify(MODULES), `dist holds ${emitted.join(', ')}; expected exactly ${MODULES.join(', ')}`);

/* ---- the markup ---- */
const html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(dist, 'app.js'), 'utf8');
check(/<title>[^<]+<\/title>/.test(html), 'missing <title>');
check(/<meta name="description" content="[^"]{40,}"/.test(html), 'missing meta description');
check(/<canvas id="view" role="img" aria-label="[^"]+"><\/canvas>/.test(html), 'the canvas must be #view with role="img" and a label');
check(/<p id="note" hidden><\/p>/.test(html), 'missing the hidden #note the page falls back to');
check(/<noscript>[^<]{20,}<\/noscript>/.test(html), 'missing the noscript line');
check(/<script type="module" src="\.\/app\.js"><\/script>/.test(html), 'app.js must be loaded as a module by relative path');
// Visible text only: one of these words in it is a template that interpolated nothing.
const text = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ');
const leak = /\bundefined\b|\bNaN\b|\[object Object\]/.exec(text);
check(!leak, leak && `page shows "${leak[0]}"`);
check(!/=\s*(["'])(?:undefined|null|NaN)\1/.test(html), 'an attribute is literally undefined/null/NaN');
for (const m of app.matchAll(/getElementById\('([^']+)'\)/g)) {
  check(new RegExp(`id="${m[1]}"`).test(html), `app.js looks up #${m[1]}, which is not in the markup`);
}
check(/prefers-reduced-motion/.test(app), 'app.js must honour prefers-reduced-motion');
check(/webglcontextlost/.test(app), 'app.js must survive a lost WebGL context');

/* ---- every module parses, and every import lands ---- */
const source = Object.fromEntries(MODULES.map(f => [f, fs.readFileSync(path.join(dist, f), 'utf8')]));
const exportsOf = src => {
  const names = new Set();
  for (const m of src.matchAll(/^export\s+(?:async\s+)?(?:const|let|function\*?|class)\s+([A-Za-z_$][\w$]*)/gm)) names.add(m[1]);
  for (const m of src.matchAll(/^export\s*\{([^}]*)\}/gm)) {
    for (const part of m[1].split(',')) { const n = part.trim().split(/\s+as\s+/).pop(); if (n) names.add(n); }
  }
  return names;
};
for (const f of MODULES) {
  try { execFileSync(process.execPath, ['--check', path.join(dist, f)], { stdio: 'pipe' }); }
  catch (e) { check(false, `${f} does not parse: ${String(e.stderr).split('\n').slice(0, 4).join(' ')}`); }
  for (const m of source[f].matchAll(/^import\s+([\s\S]*?)\s+from\s+'([^']+)';/gm)) {
    const [, clause, spec] = m;
    check(spec.startsWith('./'), `${f} imports "${spec}"; modules are siblings, imported by relative path`);
    const target = spec.replace(/^\.\//, '');
    if (!source[target]) { check(false, `${f} imports ${spec}, which the build did not emit`); continue; }
    const named = /\{([\s\S]*)\}/.exec(clause);
    if (!named) continue;                       // import * as X: any export will do
    const have = exportsOf(source[target]);
    for (const part of named[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/)[0];
      if (name) check(have.has(name), `${f} imports { ${name} } from ${spec}, which does not export it`);
    }
  }
}
report();

/* ---- the built modules, run ---- */
const load = f => import(pathToFileURL(path.join(dist, f)).href);
const parameters = JSON.parse(fs.readFileSync(path.join(root, 'data/parameters.json'), 'utf8'));
const { PARAMS } = await load('params.js');
check(JSON.stringify(PARAMS) === JSON.stringify(parameters), 'params.js is not data/parameters.json');

const { buildShip, derive, ROOMS } = await load('ship.js');
const g = derive(PARAMS.inputs);
for (const key of ['z1', 'z2', 'z3', 'nose', 'protrude', 'fin_tip_r']) {
  check(Math.abs(g[key] - PARAMS.derived[key]) < 1e-9, `derive().${key} is ${g[key]}; the drawing set says ${PARAMS.derived[key]}`);
}
const ship = buildShip(PARAMS.inputs);
check(ship.body.count > 30000 && ship.body.count % 3 === 0, `the airship has ${ship.body.count} vertices`);
check(Math.abs(ship.body.bounds.hi[0] - ship.body.bounds.lo[0] - PARAMS.inputs.L) < 0.05, 'the airship is not as long as the drawings say');
check(ship.glass.count > 0 && ship.prop.count > 0 && ship.propMounts.length === 8 && ship.lamps.length >= 10,
  'the airship is missing its panes, propellers or lamps');

const { SCENES } = await load('scenes.js');
const { frameAt, roomLights } = await load('director.js');
const { buildLut, extremes } = await load('palette.js');
const { renderText, hasGlyph } = await load('font.js');
const { axis, buildGrid } = await load('terrain.js');
const { buildCloudNoise } = await load('noise.js');
const { birdsAt } = await load('flock.js');
const { artSize } = await load('layout.js');
const G = await load('glsl.js');
check(JSON.stringify(SCENES.map(s => s.id).sort()) === '["city","clouds","sunset","valley"]', `scenes are ${SCENES.map(s => s.id)}`);
for (const s of SCENES) {
  const lut = buildLut(s.palette, 8);
  check(lut.length === 8 * 8 * 8 * 4 && lut.every((v, i) => i % 4 > 1 || v < s.palette.length), `${s.id}: the palette table points outside the palette`);
  const ink = extremes(s.palette);
  check(ink.light !== ink.dark, `${s.id}: the caption has no contrast`);
  check([...s.title].every(hasGlyph) && renderText(s.title).data.some(v => v), `${s.id}: the caption "${s.title}" cannot be drawn`);
  for (const aspect of [16 / 9, 9 / 19.5]) {
    for (const t of [0, 30, 3600]) {
      const f = frameAt(s, 12345, t, aspect);
      const nums = [...f.camera.eye, ...f.camera.target, f.camera.fov, ...f.origin, ...f.ship.pos, f.ship.yaw];
      check(nums.every(Number.isFinite), `${s.id}: frame at ${t}s is not finite`);
    }
  }
  check(roomLights(s, 1).length === ROOMS.length, `${s.id}: lights for ${roomLights(s, 1).length} rooms, ship has ${ROOMS.length}`);
  if (s.birds) check(birdsAt(s.birds.flocks, 1, 10).every(Number.isFinite), `${s.id}: a bird is nowhere`);
  const grid = buildGrid(axis(s.grid.x), axis(s.grid.y));
  check(grid.indices.length > 1000 && grid.vertices.every(Number.isFinite), `${s.id}: the ground grid is empty`);
  // the programs this scene needs, assembled as the renderer assembles them
  const defs = { CLOUDS: s.cloud ? s.cloud.kind : 0, CLOUD_STEPS: s.cloud ? s.cloud.steps : 1, TERRAIN: s.terrain, VS_OCT: 7 };
  for (const [name, p] of [['ground', G.program(G.TERRAIN_VS, G.TERRAIN_FS, defs, G.CLOUD_LIB + G.TERRAIN_LIB + (s.city ? G.CITY_LIB : ''))],
    ['composite', G.program(G.FULLSCREEN_VS, G.COMPOSITE_FS, defs, G.CLOUD_LIB)]]) {
    check(p.vs.startsWith('#version 300 es\n') && p.fs.startsWith('#version 300 es\n') && p.fs.includes('void main()'), `${s.id}: the ${name} shader is malformed`);
  }
}
const noise = buildCloudNoise(8, 7);
check(noise.length === 8 * 8 * 8 * 4 && new Set(noise).size > 20, 'the cloud volume is flat');
const art = artSize(1170, 2532);
check(art.scale >= 1 && art.width * art.height <= 90000, `a phone would draw ${art.width}x${art.height}`);
report();

console.log(`Build verified: ${ship.body.count / 3} triangles of airship, ${SCENES.length} scenes, ${SCENES.reduce((n, s) => n + s.shots.length, 0)} shots.`);
