/* The shaders, as far as Node can read them.
 *
 * Only a browser can compile GLSL (test/browser-check.mjs does, on a dev
 * box). What can be checked here is the bookkeeping that goes wrong quietly:
 * a uniform the renderer sets that no shader declares is silently ignored,
 * and one a shader declares that nobody sets is zero. Either is a picture
 * that is subtly wrong with no error anywhere. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as G from '../src/glsl.js';
import { SCENES } from '../src/scenes.js';

const renderer = fs.readFileSync(new URL('../src/renderer.js', import.meta.url), 'utf8');

// Every program the renderer can build, assembled the way it assembles them.
function programs() {
  const out = [];
  const add = (name, vs, fs_, defs, lib) => out.push({ name, ...G.program(vs, fs_, defs, lib) });
  add('sky', G.FULLSCREEN_VS, G.SKY_FS, {}, '');
  add('point', G.POINT_VS, G.POINT_FS, {}, '');
  add('bird', G.BIRD_VS, G.BIRD_FS, {}, '');
  add('present', G.FULLSCREEN_VS, G.PRESENT_FS, {}, '');
  for (const s of SCENES) {
    const defs = { CLOUDS: s.cloud ? s.cloud.kind : 0, CLOUD_STEPS: s.cloud ? s.cloud.steps : 1 };
    const ground = { ...defs, TERRAIN: s.terrain, VS_OCT: 7 };
    let lib = G.CLOUD_LIB + G.TERRAIN_LIB;
    if (s.city) { Object.assign(ground, { BLOCK: '120.0', STREET: '20.0', LOT: '50.0' }); lib += G.CITY_LIB; }
    add(`${s.id} ground`, G.TERRAIN_VS, G.TERRAIN_FS, ground, lib);
    add(`${s.id} ship`, G.SHIP_VS, G.SHIP_FS, defs, G.CLOUD_LIB);
    add(`${s.id} composite`, G.FULLSCREEN_VS, G.COMPOSITE_FS, defs, G.CLOUD_LIB);
    if (s.city) add(`${s.id} buildings`, G.CITY_VS, G.CITY_FS, ground, lib);
  }
  return out;
}

const strip = src => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
const declared = src => new Set([...strip(src).matchAll(/^\s*uniform\s+\w+\s+(\w+)/gm)].map(m => m[1]));

test('every source is GLSL ES 3.00 from its first byte, and balanced', () => {
  for (const p of programs()) {
    for (const [stage, src] of [['vertex', p.vs], ['fragment', p.fs]]) {
      const where = `${p.name} ${stage}`;
      assert.ok(src.startsWith('#version 300 es\n'), `${where}: #version must be the first line`);
      assert.match(src, /precision highp float;/, where);
      assert.match(src, /void main\(\)/, where);
      const code = strip(src);
      for (const [open, close] of ['{}', '()', '[]']) {
        assert.equal(code.split(open).length, code.split(close).length, `${where}: unbalanced ${open}${close}`);
      }
      assert.equal((code.match(/^\s*#if/gm) || []).length, (code.match(/^\s*#endif/gm) || []).length, `${where}: #if without #endif`);
      assert.ok(!/\bgl_FragColor\b|\btexture2D\b|\bvarying\b|\battribute\b/.test(code), `${where}: GLSL 1 spelling`);
      if (stage === 'fragment') assert.match(code, /out vec4 frag;/, where);
    }
  }
});

test('no identifier is a word GLSL ES reserves', () => {
  // Each of these compiles on some drivers and not on others.
  const reserved = ['input', 'output', 'sample', 'filter', 'active', 'common', 'partition', 'half', 'fixed', 'smooth',
    'noise', 'patch', 'resource', 'packed', 'superp', 'cast', 'namespace', 'using', 'template', 'this', 'inline', 'union'];
  for (const p of programs()) {
    const code = strip(p.fs + p.vs);
    for (const word of reserved) {
      const decl = new RegExp(`\\b(?:float|int|vec[234]|ivec[234]|bool|mat[234])\\s+${word}\\s*[=;,)]`);
      if (word === 'noise') continue;        // noise() is this site's own function, declared with a body
      assert.ok(!decl.test(code), `${p.name}: "${word}" is used as a variable name`);
    }
  }
});

test('every uniform a shader declares is one the renderer sets, and the other way round', () => {
  const set = new Set([...renderer.matchAll(/\b(u[A-Z]\w*)\s*:/g)].map(m => m[1]));
  assert.ok(set.size > 50, 'found the frame\'s uniforms in renderer.js');
  const used = new Set();
  for (const p of programs()) {
    for (const name of [...declared(p.vs), ...declared(p.fs)]) {
      used.add(name);
      assert.ok(set.has(name), `${p.name} declares ${name}, which renderer.js never sets`);
    }
  }
  for (const name of set) assert.ok(used.has(name), `renderer.js sets ${name}, which no shader declares`);
});

test('the integer hash is the one rng.js has', () => {
  // lowbias32, constant for constant: the page hashes the same on the CPU and the GPU.
  assert.match(G.COMMON, /h \^= h >> 16; h \*= 0x7feb352du; h \^= h >> 15; h \*= 0x846ca68bu; h \^= h >> 16;/);
  const rng = fs.readFileSync(new URL('../src/rng.js', import.meta.url), 'utf8');
  assert.match(rng, /0x7feb352d/);
  assert.match(rng, /0x846ca68b/);
});

test('the renderer asks for the vertex layout mesh.js packs', () => {
  for (const offset of [0, 12, 24, 28]) assert.ok(new RegExp(`STRIDE, ${offset}\\)`).test(renderer), `no attribute at byte ${offset}`);
  assert.match(G.SHIP_VS, /layout\(location = 3\) in vec4 aTag;/);
});
