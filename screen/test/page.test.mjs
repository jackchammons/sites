/* The page script, run in Node on every push.
 *
 * screen.test.mjs and sweep.test.mjs see the maths. The grading rules, the
 * parsing, the formatting and the hash handling live in app.js, which wants a
 * document. This builds the site into a temporary directory, stands a small
 * DOM in for the browser (the ids, labels and hidden flags of the built
 * index.html and nothing more), imports the BUILT app.js and uses it the way
 * a visitor does: through the hash, by typing into fields, with the buttons.
 *
 * The rooms and what each must show are in page-checks.mjs, shared with
 * browser-sweep.mjs. A stand-in cannot tell what a layout engine decides
 * (real text widths, overflow, colour, a locale's number format, whether a
 * module links in a browser); the browser sweep covers those on the dev box.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as s from '../src/screen.js';
import { states, hashOf, checkState, checkShown, FACTS, FIELDS, SHOWN, TYPING_ROOM, TYPED, CARRY } from './page-checks.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/* ---- the stand-in DOM ----------------------------------------------- */
const CHAR = 7.2;       // px per character, about what the eye-bar label measures in Chromium

function element(id, attrs = new Map()) {
  let text = '', value = attrs.get('value') ?? '';
  const cls = new Set((attrs.get('class') || '').split(/\s+/).filter(Boolean));
  const on = new Map();
  const node = {
    id, hidden: attrs.has('hidden'), innerHTML: '', style: {},
    children: [], parent: null, clientWidth: 900, offsetWidth: 120, offsetTop: 0,
    get value() { return value; },
    set value(v) { value = String(v); },
    get textContent() { return text; },
    set textContent(v) { text = String(v); node.children.length = 0; },
    classList: {
      add: (...c) => c.forEach(x => cls.add(x)), remove: (...c) => c.forEach(x => cls.delete(x)),
      toggle: (c, force = !cls.has(c)) => { if (force) cls.add(c); else cls.delete(c); return force; },
      contains: c => cls.has(c),
    },
    get className() { return [...cls].join(' '); },
    set className(v) { cls.clear(); String(v).split(/\s+/).filter(Boolean).forEach(x => cls.add(x)); },
    setAttribute(k, v) { if (k === 'class') node.className = v; else attrs.set(k, String(v)); },
    getAttribute: k => (k === 'class' ? node.className : attrs.get(k) ?? null),
    removeAttribute: k => { attrs.delete(k); },
    addEventListener(type, fn) { on.set(type, [...(on.get(type) || []), fn]); },
    fire(type, ev = {}) { for (const fn of on.get(type) || []) fn({ preventDefault() {}, target: node, ...ev }); },
    append(...kids) { for (const k of kids) { k.parent = node; node.children.push(k); } },
    remove() { node.parent.children.splice(node.parent.children.indexOf(node), 1); node.parent = null; },
    closest: sel => (sel === '.field' ? fieldOf(id) : null),
    getBoundingClientRect: () => ({ left: 0, top: 0, width: node.clientWidth, height: 100 }),
    getComputedTextLength: () => text.length * CHAR,
  };
  return node;
}

/* Every element the page gives an id, with the attributes the script reads,
   and the <label class="field"> around each input: its invalid flag and its
   text. Both are read off the built index.html. */
const byId = new Map(), LABELS = new Map();
function readMarkup(html) {
  for (const [, rest] of html.matchAll(/<[a-z][a-z0-9]*\b([^>]*\bid="[^"]+"[^>]*)>/g)) {
    const attrs = new Map([...rest.matchAll(/([a-z][\w-]*)(?:="([^"]*)")?/g)].map(m => [m[1], m[2] ?? '']));
    byId.set(attrs.get('id'), element(attrs.get('id'), attrs));
  }
  byId.get('defaults').textContent = html.match(/id="defaults">([\s\S]*?)<\/script>/)[1];
  for (const m of html.matchAll(/<label class="field" for="([^"]+)">\s*<span class="lbl">([^<]*)<\/span>/g)) LABELS.set(m[1], m[2]);
}
const fields = new Map();
function fieldOf(id) {
  if (!fields.has(id)) {
    const field = element(null);
    field.querySelector = sel => (sel === '.lbl' ? { textContent: LABELS.get(id) } : null);
    fields.set(id, field);
  }
  return fields.get(id);
}

const missing = [];
const windowStub = element(null), documentStub = element(null);
const saved = Object.fromEntries(['document', 'window', 'location', 'history', 'navigator', 'setTimeout', 'clearTimeout']
  .map(k => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));
const install = (k, value) => Object.defineProperty(globalThis, k, { value, configurable: true, writable: true });
let copied = null;
install('document', Object.assign(documentStub, {
  getElementById: id => byId.get(id) ?? (missing.push(id), null),
  createElementNS: () => element(null),
}));
install('window', Object.assign(windowStub, { screen: { width: 1280, height: 900 }, devicePixelRatio: 1 }));
install('location', { hash: '', get href() { return 'http://localhost/screen/' + this.hash; } });
install('history', { replaceState: (_state, _title, hash) => { location.hash = hash; } });
install('navigator', { languages: ['en-US'], language: 'en-US', clipboard: { writeText: async text => { copied = text; } } });
/* The form debounces typing with a timer. Holding it here keeps the test
   from waiting on the clock, and shows that the page did go through it. */
let pending = null;
install('setTimeout', fn => { pending = fn; return 1; });
install('clearTimeout', () => { pending = null; });
after(() => {
  for (const [k, d] of Object.entries(saved)) { if (d) Object.defineProperty(globalThis, k, d); else delete globalThis[k]; }
});

/* ---- build into a directory of our own, and boot the page from it ---- */
/* The directory is needed only until the script has been imported, and is
   removed here whatever happens: a failed import ends the process without
   running exit handlers. */
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'screen-page-'));
try {
  const build = spawnSync(process.execPath, [path.join(root, 'scripts/build.mjs')],
    { cwd: root, env: { ...process.env, OUT_DIR: out }, encoding: 'utf8' });
  assert.equal(build.status, 0, `the build failed: ${build.stderr}`);
  readMarkup(fs.readFileSync(path.join(out, 'index.html'), 'utf8'));
  await import(pathToFileURL(path.join(out, 'app.js')).href);        // boot()
} finally {
  fs.rmSync(out, { recursive: true, force: true });
}

/* ---- driving and reading the page ----------------------------------- */
const $ = id => byId.get(id);
const go = hash => { location.hash = hash; windowStub.fire('hashchange'); };
const hashGet = k => new URLSearchParams(location.hash.slice(1)).get(k);
const click = id => $(id).fire('click');
function settle() {
  assert.ok(pending, 'an edit schedules a recompute');
  const run = pending; pending = null; run();
}
const type = (id, text) => { $(id).value = text; $('form').fire('input'); settle(); };
const choose = (id, value) => { $(id).value = value; $('form').fire('change'); settle(); };
const invalid = id => fieldOf(id).classList.contains('invalid');
const gradeOf = el => (el.className.match(/\b(good|ok|warn)\b/) || [''])[0];
const find = (node, cls, found = []) => {
  for (const k of node.children) { if (k.classList.contains(cls)) found.push(k); find(k, cls, found); }
  return found;
};
const strip = h => h.replace(/<[^>]*>/g, '').trim();
const rows = (id, attr = '') => [...$(id).innerHTML.matchAll(/<tr([^>]*)>([\s\S]*?)<\/tr>/g)]
  .filter(m => m[1].includes(attr))
  .map(m => [...m[2].matchAll(/<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/g)].map(c => strip(c[1])));

function snapshot() {
  return {
    boot: $('boot-error').hidden, stale: $('main').classList.contains('stale'),
    fov: $('out-fov').textContent, fovCls: gradeOf($('out-total')), fovWord: $('out-grade').textContent, sub: $('out-sub').textContent,
    facts: Object.fromEntries(FACTS.map(k => [k, { cls: gradeOf($('fact-' + k)), word: $('grade-' + k).textContent, main: $('sum-' + k).textContent, sub: $('sub-' + k).textContent }])),
    fields: Object.fromEntries(FIELDS.map(id => [id, String($(id).value)])),
    pjHidden: $('pj-section').hidden,
    you: find($('lanes'), 'you-lbl')[0]?.textContent,
    eyeLabel: find($('eye-bar'), 'eye-pct')[0]?.textContent,
    lanes: find($('lanes'), 'band').length,
    targets: rows('targets'), seats: rows('seats'), sizes: rows('sizes'), sizesHere: rows('sizes', 'class="here"')[0],
    matrixNote: $('matrix-note').textContent,
    matrixYou: $('matrix').innerHTML.match(/<td class="q\d you"[^>]*>([\s\S]*?)<\/td>/)?.[1],
    hash: location.hash,
  };
}

/* Collect failures the way the browser sweep does, then show the first few. */
function collector() {
  const failures = []; let checks = 0;
  const check = (ok, msg, st) => { checks++; if (!ok) failures.push(`${JSON.stringify(st)} :: ${msg}`); };
  const done = () => assert.equal(failures.length, 0, `${failures.length} of ${checks} checks failed:\n  ${failures.slice(0, 8).join('\n  ')}`);
  return { check, done };
}

/* ---- tests ----------------------------------------------------------- */

test('the built page boots, with every element it looks up in the markup', () => {
  assert.deepEqual(missing, []);
  assert.equal($('boot-error').hidden, true);
  assert.equal(windowStub.__screenBooted, true);
  assert.equal(hashGet('d'), '65');
  assert.equal(hashGet('v'), '108');
  assert.equal(snapshot().stale, false);
});

const GRID = states();
test(`every room in the sweep's grid shows what the maths says (${GRID.length} rooms)`, () => {
  const { check, done } = collector();
  for (const st of GRID) {
    go(hashOf(st));
    checkState(snapshot(), st, check);
  }
  assert.deepEqual(missing, []);
  done();
});

test('rooms with their answers written out show exactly those', () => {
  const { check, done } = collector();
  for (const [st, facts] of SHOWN) {
    go(hashOf(st));
    checkShown(snapshot(), st, facts, check);
  }
  done();
});

test('what a person types is read as they meant it, or refused', () => {
  const { check, done } = collector();
  for (const [id, key, cases] of TYPED) {
    go(hashOf(TYPING_ROOM));
    for (const [typed, want] of cases) {
      type(id, typed);
      const st = { field: id, typed };
      if (want === null) {
        check(invalid(id) && $(id).getAttribute('aria-invalid') === 'true', 'should be marked invalid', st);
        check($('out-fov').textContent === '—' && $('main').classList.contains('stale'), 'the page should stop presenting figures', st);
      } else {
        check(!invalid(id) && $(id).getAttribute('aria-invalid') === null, 'should not be marked invalid', st);
        check(Math.abs(+hashGet(key) - want) < 0.001, `stored ${key}=${hashGet(key)}, expected ${want}`, st);
        check(!$('main').classList.contains('stale'), 'the page should be current', st);
      }
    }
  }
  done();
});

test('an invalid field leaves nothing stale presented as current, and recovers', () => {
  go('#d=85&v=108&u=i&m=tv');
  assert.equal(gradeOf($('out-total')), 'good');
  type('in-dist', 'abc');
  assert.equal($('out-fov').textContent, '—');
  assert.equal($('out-total').className, 'total', 'the headline keeps no grade colour');
  assert.equal($('out-grade').textContent, '', 'and no grade word');
  assert.equal($('main').classList.contains('stale'), true);
  assert.equal($('out-sub').textContent, 'Check “Eyes to screen”.');
  assert.equal($('in-dist').getAttribute('aria-invalid'), 'true');
  assert.equal($('in-diag').getAttribute('aria-invalid'), null);

  // A second and third bad field are named too, in the order of the form.
  type('in-diag', 'big');
  assert.equal($('out-sub').textContent, 'Check “Diagonal” and “Eyes to screen”.');
  type('in-eye', '?');
  assert.equal($('out-sub').textContent, 'Check “Diagonal”, “Eyes to screen” and “Seated eye height”.');
  type('in-diag', '85'); type('in-eye', '42');
  assert.equal($('out-sub').textContent, 'Check “Eyes to screen”.');

  // A good edit elsewhere does not make the page current again.
  type('in-diag', '120');
  assert.equal($('main').classList.contains('stale'), true);
  assert.equal($('out-fov').textContent, '—');

  // Projector fields only count in projector mode.
  type('in-throw1', 'wide');
  assert.equal($('out-sub').textContent, 'Check “Eyes to screen”.');
  click('mode-pj');
  assert.equal($('out-sub').textContent, 'Check “Eyes to screen” and “Throw ratio, wide”.');
  click('mode-tv'); type('in-throw1', '1.2');

  type('in-dist', '9');
  const p = snapshot();
  assert.equal(p.stale, false);
  assert.equal(p.fovCls, 'good');
  assert.equal(p.fovWord, 'meets');
  assert.doesNotMatch(p.sub, /^Check/);
  assert.equal($('in-dist').getAttribute('aria-invalid'), null);
  assert.equal(invalid('in-dist'), false);
});

test('a unit switch converts what parsed and leaves the rest as typed', () => {
  const noNaN = () => { for (const id of FIELDS) assert.doesNotMatch(String($(id).value), /NaN|undefined/, `#${id}`); };
  for (const left of ['abc', '', '1,000 cm']) {
    go('#d=65&v=108&e=42&c=50&u=i&m=tv');
    type('in-dist', left);
    click('unit-metric');
    assert.equal($('in-dist').value, left, 'the unread field keeps its text');
    assert.equal($('in-eye').value, '106.7');
    assert.equal($('in-centre').value, '127');
    assert.equal(invalid('in-dist'), true);
    noNaN();
    click('unit-imperial');
    assert.equal($('in-dist').value, left);
    assert.equal($('in-eye').value, '42');
    noNaN();
  }
  // A decimal caught mid-typing is a number, so it converts.
  go('#d=65&v=108&u=i&m=tv');
  type('in-dist', '8.');
  assert.equal(invalid('in-dist'), false);
  click('unit-metric');
  assert.equal($('in-dist').value, '2.44');
  assert.equal(hashGet('v'), '96');
  // A projector field that does not read is left alone as well.
  go('#d=65&v=108&u=i&m=pj');
  type('in-gain', 'matte');
  click('unit-metric');
  assert.equal($('in-gain').value, 'matte');
  assert.equal($('in-dist').value, '2.74');
  noNaN();
});

test('a field the page fills keeps its exact value through unit switches', () => {
  go('#d=65&v=36&e=41.3&c=50.2&u=i&m=tv');
  click('unit-metric');
  assert.equal($('in-dist').value, '0.91');
  assert.equal($('in-dist-unit').textContent, 'm');
  assert.equal($('in-eye-unit').textContent, 'cm');
  assert.match($('sum-size').textContent, /cm/);
  assert.equal(hashGet('v'), '36', 'not the 35.83 that 0.91 m reads back as');
  assert.equal(hashGet('e'), '41.3');
  assert.equal(hashGet('u'), 'm');
  click('unit-imperial');
  assert.equal($('in-dist').value, '3');
  assert.equal(hashGet('v'), '36');
  assert.equal(hashGet('c'), '50.2');
  // Once edited, what was typed is what counts.
  click('unit-metric');
  type('in-dist', '0.92');
  assert.ok(Math.abs(+hashGet('v') - 36.22) < 0.001);
});

test('the distance field never reads "9 ft 12 in"', () => {
  for (const [inches, text] of CARRY) {
    go(`#d=65&v=${inches}&u=i&m=tv`);
    assert.equal($('in-dist').value, text, `${inches} in`);
    assert.equal(+hashGet('v'), inches, 'and the exact distance is kept');
  }
});

test('custom pixels, this screen, projector mode, reset, copy link and a bad hash', async () => {
  go('#d=65&v=108&u=i&m=tv');
  choose('in-res', 'custom');
  assert.equal($('custom-res').hidden, false);
  type('in-resw', '3440'); type('in-resh', '1440');
  assert.match($('sub-density').textContent, /3,440 × 1,440 is 43:18/);
  click('btn-this');
  assert.equal($('in-resw').value, '1280');
  assert.equal($('in-resh').value, '900');
  assert.match($('this-note').textContent, /1280 × 900/);
  assert.equal(hashGet('rw'), '1280');
  choose('in-res', '2160');
  assert.equal($('custom-res').hidden, true);

  click('mode-pj');
  assert.equal($('pj-section').hidden, false);
  assert.equal($('pj-fields').hidden, false);
  assert.equal($('mode-pj').getAttribute('aria-pressed'), 'true');
  assert.equal(hashGet('m'), 'pj');
  click('unit-metric');
  click('btn-reset');
  for (const [k, v] of Object.entries({ d: '65', v: '108', m: 'tv', r: '2160', u: 'i' })) assert.equal(hashGet(k), v, k);
  assert.equal($('status').textContent, 'Reset.');
  assert.equal($('pj-section').hidden, true);

  $('btn-copy').fire('click');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(copied, location.href);
  assert.equal($('status').textContent, 'Link copied.');

  // A hash nobody wrote falls back field by field instead of breaking.
  go('#d=abc&a=nope&r=zzz&v=-5');
  assert.equal($('in-aspect').value, '16:9');
  assert.equal($('in-res').value, '2160');
  assert.equal($('in-diag').value, '65');
  assert.equal($('out-sub').textContent, 'Check “Eyes to screen”.');
  go('#m=pj&l=1500.5&t1=Infinity&g=');
  assert.equal($('out-sub').textContent, 'Check “Screen gain”.', 'g= reads as a gain of zero');
  go('#m=pj&l=1500.5&t1=Infinity&g=1');
  assert.equal(snapshot().stale, false);
  assert.equal($('in-lumens').value, '1501', 'lumens are a whole number');
  assert.equal(hashGet('t1'), '1.2');
});

test('the eye-bar label and axis figures stay inside the chart at any width', () => {
  const box = t => {
    const x = +t.getAttribute('x'), w = t.getComputedTextLength(), a = t.getAttribute('text-anchor');
    return a === 'end' ? [x - w, x] : a === 'middle' ? [x - w / 2, x + w / 2] : [x, x + w];
  };
  for (const width of [300, 320, 390, 560, 660, 780, 1060, 1280]) {
    $('eye-bar').clientWidth = width;
    const W = Math.max(320, width);
    // 65-inch 4K from 1 ft to 100 ft: the marker runs the length of the bar.
    for (const v of [12, 30, 44, 52, 60, 72, 84, 96, 108, 120, 150, 300, 1200]) {
      go(`#d=65&r=2160&v=${v}&u=i&m=tv`);
      const [label] = find($('eye-bar'), 'eye-pct');
      const [lo, hi] = box(label);
      assert.ok(lo >= 8 - 1e-9 && hi <= W - 8 + 1e-9, `label [${lo.toFixed(0)}, ${hi.toFixed(0)}] leaves the ${W}px chart at v=${v}`);
      // Beside the marker whenever there is room on either side of it.
      const xp = +find($('eye-bar'), 'eye-you')[0].getAttribute('x1'), lw = hi - lo;
      if (xp + 6 + lw <= W - 8) assert.ok(Math.abs(lo - (xp + 6)) < 1e-9, `label should sit right of the marker at ${W}px, v=${v}`);
      else if (xp - 6 - lw >= 8) assert.ok(Math.abs(hi - (xp - 6)) < 1e-9, `label should sit left of the marker at ${W}px, v=${v}`);
    }
    const ticks = find($('eye-bar'), 'eye-axis')[0].children.map(box);
    ticks.forEach(([lo], i) => { if (i) assert.ok(lo >= ticks[i - 1][1], `axis figures overlap at ${W}px`); });
    assert.equal(ticks.length, W >= 660 ? 9 : 8, `axis figures at ${W}px`);
  }
  // A resize redraws at the new width.
  $('eye-bar').clientWidth = 900;
  windowStub.fire('resize');
  assert.equal(find($('eye-bar'), 'eye-axis')[0].children.length, 9);
});

test('a tapped tooltip stays until the next press; a hovered one leaves with the pointer', () => {
  go('#d=65&v=108&u=i&m=tv');
  const press = { clientX: 300, clientY: 40 };
  for (const [host, tip] of [['lanes', 'tip'], ['eye-bar', 'eye-tip']]) {
    const [hit] = find($(host), 'hit');
    hit.fire('pointerdown', { ...press, pointerType: 'touch' });
    assert.equal($(tip).hidden, false);
    assert.match($(tip).innerHTML, /<b>/);
    hit.fire('pointerleave', { pointerType: 'touch' });
    assert.equal($(tip).hidden, false, `${tip} survives the finger lifting`);
    documentStub.fire('pointerdown', { pointerType: 'touch' });
    assert.equal($(tip).hidden, true, `${tip} closes on the next press`);
    hit.fire('pointermove', { ...press, pointerType: 'mouse' });
    assert.equal($(tip).hidden, false);
    hit.fire('pointerleave', { pointerType: 'mouse' });
    assert.equal($(tip).hidden, true);
  }
});

test('the ITU rows are the distances the recommendation prints', () => {
  go('#d=65&a=16:9&r=2160&v=108&u=i&m=tv');
  const seats = rows('seats');
  const row = label => seats.find(r => r[0].startsWith(label));
  assert.deepEqual(row('ITU-R BT.500 — UHD 4K').slice(0, 3), ['ITU-R BT.500 — UHD 4K1.6 picture heights', '4 ft 3 in', '58.1°']);
  assert.deepEqual(row('ITU-R BT.500 — UHD 8K').slice(0, 3), ['ITU-R BT.500 — UHD 8K0.8 picture heights', '2 ft 1 in', '96°']);
  assert.deepEqual(row('ITU-R BT.500 — HDTV').slice(0, 3), ['ITU-R BT.500 — HDTV3.2 picture heights', '8 ft 6 in', '31°']);
  // Sitting at the ITU 4K distance on 16:9 is not called wider than a row of the same table.
  go(`#d=65&a=16:9&r=2160&v=${(1.6 * s.dims(65, 16 / 9).height).toFixed(3)}`);
  assert.match($('out-sub').textContent, /^at or inside THX’s best-seat 40°/);
  assert.equal(gradeOf($('out-total')), 'good');
});
