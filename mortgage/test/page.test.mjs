/* The page script, run in Node on every push.
 *
 * mortgage.test.mjs and inputs.test.mjs see the two modules. What joins them
 * to the form lives in app.js, which wants a document: which price a tax
 * percentage is taken of, how a loan under way is inferred and its history
 * added to what is ahead, what a unit switch does to the number beside it,
 * what an unreadable field leaves on screen. This builds the site into a
 * temporary directory, stands a small DOM in for the browser (the element
 * tree of the built index.html and the handful of methods the script calls),
 * imports the BUILT app.js and uses it the way a visitor does: through the
 * hash, by typing into fields, with the buttons.
 *
 * It boots the page twice, once as a browser with a month picker and once as
 * one without, where the month fields are a select and a year box.
 *
 * The loans and what each must show are in page-checks.mjs. A stand-in cannot
 * tell what a layout engine decides (widths, overflow, colour, another
 * locale's number format, whether a module links in a browser); after
 * changing what the page draws, look at it in one.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { states, hashOf, checkState, checkHash, expected, todayPayment, addMonths, num, usd, usd2,
  PARTS, FACTS, FIELDS, BLOCKS } from './page-checks.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULTS = JSON.parse(fs.readFileSync(path.join(root, 'data/defaults.json'), 'utf8')).inputs;

/* The page reads the device clock for "next month" and the Today rule. Hold
   it still, so a run on the last night of a month cannot straddle two. */
const RealDate = Date, NOW = new Date(2026, 10, 15, 12).getTime();
class HeldDate extends RealDate {
  constructor(...args) { if (args.length) super(...args); else super(NOW); }
  static now() { return NOW; }
}
const NEXT = '2026-12';

/* ---- the stand-in DOM ----------------------------------------------- */
const VOID = new Set(['meta', 'link', 'input', 'br', 'hr', 'img']);
const ENTITIES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" };
const decode = s => s.replace(/&(?:amp|lt|gt|quot|#39);/g, e => ENTITIES[e]);
const strip = h => decode(String(h).replace(/<[^>]*>/g, ''));

/* One compound selector: tag, #id, .classes and a single [attr="value"] or
   [attr$="value"], which is all the script asks for. */
function matches(node, sel) {
  const m = /^([a-z0-9]+)?(?:#([\w-]+))?((?:\.[\w-]+)*)(?:\[([\w-]+)(\$?)="([^"]*)"\])?$/.exec(sel);
  if (!m) throw new Error(`the stand-in DOM cannot read the selector "${sel}"`);
  const [, tag, id, classes, attr, ends, value] = m;
  if (tag && node.tag !== tag) return false;
  if (id && node.id !== id) return false;
  for (const c of classes.split('.').filter(Boolean)) if (!node.classList.contains(c)) return false;
  if (attr) {
    const got = node.getAttribute(attr);
    if (got == null || (ends ? !got.endsWith(value) : got !== value)) return false;
  }
  return true;
}

function makePage(html, { monthPicker }) {
  const byId = new Map();
  const page = { missing: [], timers: new Map(), copied: null, focused: null };

  function element(tag, attrs = new Map()) {
    const on = new Map(), cls = new Set((attrs.get('class') || '').split(/\s+/).filter(Boolean));
    let value = attrs.get('value') ?? '', html = null;
    const node = {
      tag, tagName: tag.toUpperCase(), children: [], parent: null, style: {}, dataset: {},
      hidden: attrs.has('hidden'), clientWidth: 640, offsetWidth: 120, offsetTop: 0,
      get id() { return attrs.get('id') ?? ''; },
      set id(v) { attrs.set('id', String(v)); byId.set(String(v), node); },
      /* A browser with no month picker does not let type=month stick. */
      get type() { const t = attrs.get('type') ?? (tag === 'input' ? 'text' : ''); return t === 'month' && !monthPicker ? 'text' : t; },
      set type(v) { attrs.set('type', String(v)); },
      get options() { return node.children.filter(k => k.tag === 'option'); },
      get value() { return value; },
      // A select holds only what one of its options offers.
      set value(v) { value = tag === 'select' && !node.options.some(o => o.value === String(v)) ? '' : String(v); },
      get textContent() { return html != null ? strip(html) : node.children.map(k => k.textContent).join(''); },
      set textContent(v) { html = null; node.children = String(v) === '' ? [] : [{ textContent: String(v), parent: node, children: [] }]; },
      get innerHTML() { return html ?? ''; },
      set innerHTML(v) { html = String(v); node.children = []; },
      insertAdjacentHTML() {},
      classList: {
        add: (...c) => c.forEach(x => cls.add(x)), remove: (...c) => c.forEach(x => cls.delete(x)),
        toggle: (c, force = !cls.has(c)) => { if (force) cls.add(c); else cls.delete(c); return force; },
        contains: c => cls.has(c),
      },
      get className() { return [...cls].join(' '); },
      set className(v) { cls.clear(); String(v).split(/\s+/).filter(Boolean).forEach(x => cls.add(x)); },
      setAttribute(k, v) { if (k === 'class') node.className = v; else if (k === 'id') node.id = v; else attrs.set(k, String(v)); },
      getAttribute: k => (k === 'class' ? node.className : attrs.get(k) ?? (k.startsWith('data-') ? node.dataset[k.slice(5)] ?? null : null)),
      removeAttribute: k => { attrs.delete(k); },
      addEventListener(type, fn) { on.set(type, [...(on.get(type) || []), fn]); },
      /* Every event the script listens for bubbles, so a listener on the
         form or the document hears what happens inside it. */
      fire(type, init = {}) {
        const ev = { type, target: node, preventDefault() {}, ...init };
        for (let at = node; at; at = at.parent) for (const fn of at.listeners(type)) fn(ev);
      },
      listeners: type => on.get(type) || [],
      dispatchEvent(ev) { node.fire(ev.type); return true; },
      append(...kids) { for (const k of kids) { k.parent?.children.splice(k.parent.children.indexOf(k), 1); k.parent = node; node.children.push(k); } },
      after(...kids) { kids.forEach((k, i) => { k.parent = node.parent; node.parent.children.splice(node.parent.children.indexOf(node) + 1 + i, 0, k); }); },
      closest(sel) { for (let at = node; at && at.tag; at = at.parent) if (at.tag[0] !== '#' && matches(at, sel)) return at; return null; },
      querySelector: sel => find(node, k => matches(k, sel))[0] ?? null,
      contains(other) { for (let at = other; at; at = at.parent) if (at === node) return true; return false; },
      focus() { page.focused = node; },
      getBoundingClientRect: () => ({ left: 0, top: 0, width: +attrs.get('width') || node.clientWidth, height: 100 }),
    };
    if (tag === 'option') Object.defineProperty(node, 'value', { get: () => attrs.get('value') ?? node.textContent, set: v => { attrs.set('value', String(v)); } });
    if (attrs.has('id')) byId.set(attrs.get('id'), node);
    return node;
  }
  const find = (node, want, found = []) => {
    for (const k of node.children) if (k.tag) { if (want(k)) found.push(k); find(k, want, found); }
    return found;
  };

  /* The built index.html as a tree. It is the build's own output, so it is
     read strictly: a tag that does not close where expected is an error. */
  const doc = element('#document');
  let at = doc, i = 0;
  const TAG = /<([a-z][a-z0-9]*)((?:\s+[^\s"'>/=]+(?:=(?:"[^"]*"|'[^']*'|[^\s"'>]+))?)*)\s*\/?>/y;
  const ATTR = /([^\s"'>/=]+)(?:=(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
  while (i < html.length) {
    if (html[i] !== '<') {
      const end = html.indexOf('<', i) < 0 ? html.length : html.indexOf('<', i);
      if (html.slice(i, end).trim()) at.children.push({ textContent: decode(html.slice(i, end).replace(/\s+/g, ' ')), parent: at, children: [] });
      i = end;
    } else if (html.startsWith('<!', i)) {
      i = html.indexOf('>', i) + 1;
    } else if (html.startsWith('</', i)) {
      const end = html.indexOf('>', i), name = html.slice(i + 2, end).trim();
      assert.equal(name, at.tag, `the built page closes <${name}> inside <${at.tag}>`);
      at = at.parent; i = end + 1;
    } else {
      TAG.lastIndex = i;
      const t = TAG.exec(html);
      assert.ok(t, `the built page has a tag the stand-in cannot read at: ${html.slice(i, i + 60)}`);
      const node = element(t[1], new Map([...t[2].matchAll(ATTR)].map(a => [a[1], decode(a[2] ?? a[3] ?? a[4] ?? '')])));
      at.append(node);
      i = TAG.lastIndex;
      if (t[1] === 'script' || t[1] === 'style') {
        const end = html.indexOf(`</${t[1]}>`, i);
        node.textContent = html.slice(i, end);
        i = end + t[1].length + 3;
      } else if (!VOID.has(t[1])) {
        at = node;
      }
    }
  }
  assert.equal(at, doc, 'the built page leaves a tag open');
  // A select starts on its selected option, or its first.
  for (const sel of find(doc, k => k.tag === 'select')) sel.value = (sel.options.find(o => o.getAttribute('selected') != null) ?? sel.options[0]).value;

  const stored = new Map();
  return Object.assign(page, {
    find: id => byId.get(id) ?? null,
    all: want => find(doc, want),
    document: Object.assign(doc, {
      getElementById: id => byId.get(id) ?? (page.missing.push(id), null),
      createElement: tag => element(tag),
      createElementNS: (_ns, tag) => element(tag),
      documentElement: find(doc, k => k.tag === 'html')[0],
    }),
    window: element('#window'),
    location: { hash: '', pathname: '/mortgage/', search: '', get href() { return 'http://localhost/mortgage/' + this.hash; } },
    history: { replaceState: (_state, _title, url) => { page.location.hash = url.startsWith('#') ? url : ''; } },
    localStorage: { getItem: k => stored.get(k) ?? null, setItem: (k, v) => { stored.set(k, String(v)); } },
    navigator: { languages: ['en-US'], language: 'en-US', clipboard: { writeText: async text => { page.copied = text; } } },
  });
}

/* The script reaches the browser through globals. Two pages are alive at
   once, so the one being driven is the one installed. */
const GLOBALS = ['document', 'window', 'location', 'history', 'localStorage', 'navigator', 'setTimeout', 'clearTimeout', 'getComputedStyle', 'Date'];
const saved = Object.fromEntries(GLOBALS.map(k => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));
const install = (k, value) => Object.defineProperty(globalThis, k, { value, configurable: true, writable: true });
let page = null, timerId = 0;
function use(p) {
  page = p;
  for (const k of ['document', 'window', 'location', 'history', 'localStorage', 'navigator']) install(k, p[k]);
}
/* The form debounces typing with a timer. Holding the timers here keeps the
   test from waiting on the clock, and shows that the page went through one. */
install('setTimeout', (fn, ms) => { page.timers.set(++timerId, { fn, ms }); return timerId; });
install('clearTimeout', id => { page.timers.delete(id); });
install('getComputedStyle', () => ({ position: 'absolute' }));
install('Date', HeldDate);
after(() => {
  for (const [k, d] of Object.entries(saved)) { if (d) Object.defineProperty(globalThis, k, d); else delete globalThis[k]; }
});

/* ---- build into a directory of our own, and boot both pages from it -- */
/* The directory is needed only until the script has been imported, and is
   removed here whatever happens: a failed import ends the process without
   running exit handlers. The query string makes the second import a second
   run of the script; the two modules it imports are shared. */
let withPicker, noPicker;
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'mortgage-page-'));
try {
  const build = spawnSync(process.execPath, [path.join(root, 'scripts/build.mjs')],
    { cwd: root, env: { ...process.env, OUT_DIR: out }, encoding: 'utf8' });
  assert.equal(build.status, 0, `the build failed: ${build.stderr}`);
  const html = fs.readFileSync(path.join(out, 'index.html'), 'utf8');
  withPicker = makePage(html, { monthPicker: true });
  noPicker = makePage(html, { monthPicker: false });
  for (const [p, tag] of [[withPicker, 'picker'], [noPicker, 'no-picker']]) {
    use(p);
    await import(`${pathToFileURL(path.join(out, 'app.js')).href}?${tag}`);        // boot()
  }
} finally {
  fs.rmSync(out, { recursive: true, force: true });
}
use(withPicker);

/* ---- driving and reading the page ----------------------------------- */
const $ = id => page.find(id);
const go = hash => { page.location.hash = hash; page.window.fire('hashchange'); };
/* Runs what the page has put on a timer: the debounced recompute, and the
   redraw after a resize. The three-second status clear is left alone. */
function settle() {
  const due = [...page.timers].filter(([, t]) => t.ms < 1000);
  assert.ok(due.length, 'an edit schedules a recompute');
  for (const [id, t] of due) { page.timers.delete(id); t.fn(); }
}
const type = (id, text) => { $(id).value = text; $(id).fire('input'); settle(); };
const choose = type;
const click = id => $(id).fire('click');
const fieldOf = id => $(id).closest('.field');
const tableRows = () => [...$('schedule').innerHTML.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)]
  .map(r => [...r[1].matchAll(/<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/g)].map(c => strip(c[1]).trim()));
const hit = () => page.all(k => k.classList.contains('hit') && $('chart').contains(k))[0];

/* The tooltip at one payment: hover there, read it, take the pointer away. */
function tipAt(payment, of) {
  const h = hit();
  if (!h || !payment) return '';
  h.fire('pointermove', { clientX: +h.getAttribute('x') + payment / of * +h.getAttribute('width'), pointerType: 'mouse' });
  const text = strip($('tip').innerHTML);
  h.fire('pointerleave', { pointerType: 'mouse' });
  return text;
}

function snapshot(st) {
  const months = st ? (e => (e.under && e.paid > 0 ? e.n : e.base.months))(expected(st)) : 0;
  return {
    boot: $('boot-error').hidden,
    total: $('out-total').textContent, sub: $('out-sub').textContent,
    parts: Object.fromEntries(PARTS.map(k => [k, { text: $('bd-' + k).textContent, hidden: $('row-' + k).hidden }])),
    facts: Object.fromEntries(FACTS.map(k => [k, { main: $('sum-' + k).textContent, sub: $('sub-' + k).textContent }])),
    fields: Object.fromEntries(FIELDS.map(id => [id, String($(id).value)])),
    shown: Object.fromEntries(BLOCKS.map(id => [id, !$(id).hidden])),
    invalid: FIELDS.filter(id => !id.endsWith('-unit') && fieldOf(id).classList.contains('invalid')),
    inferred: { loan: $('inf-price').textContent, note: $('inf-note').textContent },
    hints: { tax: $('in-tax-hint').textContent, pmi: $('in-pmi-hint').textContent },
    chartNote: $('chart-note').textContent,
    chart: $('chart').children.some(k => k.tag === 'svg'),
    tip: st ? tipAt(todayPayment(st), months) : '',
    schedule: tableRows(),
    noExtra: $('schedule').closest('table').classList.contains('no-extra'),
    noPmi: $('schedule').closest('table').classList.contains('no-pmi'),
    hash: page.location.hash,
  };
}

/* Collect failures, then show the first few. */
function collector() {
  const failures = []; let checks = 0;
  const check = (ok, msg, st) => { checks++; if (!ok) failures.push(`${st ? hashOf(st) : ''} :: ${msg}`); };
  const done = () => assert.equal(failures.length, 0, `${failures.length} of ${checks} checks failed:\n  ${failures.slice(0, 8).join('\n  ')}`);
  return { check, done };
}
/* One loan, held to everything page-checks.mjs knows about it. `typed`
   is for a form that was typed into after its link filled it. */
function holds(st, why = '', { typed = false } = {}) {
  const { check, done } = collector();
  checkState(snapshot(st), st, (ok, msg, s) => check(ok, why ? `${why}: ${msg}` : msg, s), { fromLink: !typed });
  done();
}
const TYPED = { typed: true };

const COSTS = { t: DEFAULTS.taxRate, tu: DEFAULTS.taxUnit, i: DEFAULTS.insurance, iu: DEFAULTS.insUnit, w: DEFAULTS.escrow, wu: DEFAULTS.escrowUnit,
  em: 0, h: DEFAULTS.hoa, m: DEFAULTS.pmiRate, x: DEFAULTS.extra, e: DEFAULTS.extraEvery };
/* The loan the page opens with, and the one "Already paying" turns it into. */
const OPENING = { lm: 0, p: DEFAULTS.price, dp: DEFAULTS.downPct, r: DEFAULTS.rate, y: DEFAULTS.years, s: NEXT, ...COSTS };
const UNDER_WAY = { lm: 1, b: DEFAULTS.price * (1 - DEFAULTS.downPct / 100), r: DEFAULTS.rate, y: DEFAULTS.years, s: NEXT, nx: NEXT, ...COSTS };
/* $750k at 5% down and 6.25% with PMI at 0.5%, first paid in 2024-12: the
   loan whose PMI the page once got wrong by 21 months. */
const FIVE_DOWN = { lm: 0, p: 750000, dp: 5, r: 6.25, y: 30, s: '2024-12', ...COSTS, m: 0.5 };

/* ---- tests ----------------------------------------------------------- */

test('the built page boots in both kinds of browser, with every element it looks up', () => {
  for (const p of [withPicker, noPicker]) {
    use(p);
    assert.deepEqual(p.missing, []);
    assert.equal($('boot-error').hidden, true);
    assert.equal(p.document.documentElement.classList.contains('ready'), true);
    assert.equal(p.location.hash, '', 'an untouched page writes no hash');
    assert.equal($('in-origprice').value, '', 'the original price starts empty');
    holds(OPENING, 'the opening page');
  }
  use(withPicker);
});

const GRID = states(NEXT);
test(`every loan in the grid shows what the maths says, and comes back from its own link (${GRID.length} loans)`, () => {
  const { check, done } = collector();
  const figures = p => JSON.stringify([p.total, p.sub, p.parts, p.facts, p.fields, p.shown, p.inferred, p.schedule, p.tip]);
  for (const st of GRID) {
    go(hashOf(st));
    const first = snapshot(st);
    checkState(first, st, check);
    // The link the page writes for it, and the page that link opens.
    click('btn-share');
    const link = page.location.hash;
    checkHash(link, st, DEFAULTS, NEXT, check);
    go('#');
    go(link);
    check(figures(snapshot(st)) === figures(first), `the page its own link opens differs (${link})`, st);
    click('btn-share');
    check(page.location.hash === link, `the link is not stable: ${link} then ${page.location.hash}`, st);
  }
  assert.deepEqual(page.missing, []);
  done();
  go('#');
});

test('links written when every key was spelled out read as they did', () => {
  // Figures as the page printed them for these links before any key was left out.
  const OLD = [
    ['#p=750000&d=150000&b=&nx=2026-12&r=6.5&y=30&t=0.92&tu=pct&i=1800&iu=yr&w=0&wu=mo&h=0&m=0&x=0&e=1&s=2026-12',
      { total: '$4,517', pi: '$3,792.41', tax: '$575.00', cost: '$1,365,266', costSub: 'principal, interest and PMI', payoff: 'Nov 2056' }],
    ['#p=750000&d=150000&b=540000&nx=2026-12&r=6.5&y=30&t=0.92&tu=pct&i=1800&iu=yr&w=0&wu=mo&h=0&m=0&x=250&e=1&s=2021-06&lm=1',
      { total: '$4,272', cost: '$1,235,831', costSub: 'whole loan · $993,216 still to pay' }],
    ['#p=1.2m&d=240000&b=900000&nx=2027-01&r=5&y=40&t=9000&tu=yr&i=200&iu=mo&w=14000&wu=yr&h=120&m=0&x=1000&e=0&s=2023-01&em=1&lm=1',
      { total: '$5,783', escrow: '$1,166.67', cost: '$2,153,068', costSub: 'whole loan · $1,937,261 still to pay' }],
  ];
  for (const [link, want] of OLD) {
    go(link);
    const p = snapshot();
    assert.deepEqual(p.invalid, [], link);
    assert.equal(p.total, want.total, link);
    assert.equal(p.facts.cost.main, want.cost, link);
    assert.equal(p.facts.cost.sub, want.costSub, link);
    for (const k of PARTS) if (want[k]) assert.equal(p.parts[k].text, want[k], `${k} in ${link}`);
    if (want.payoff) assert.equal(p.facts.payoff.main, want.payoff);
    assert.equal($('in-origprice').value, '', 'a link from before the field has no price');
  }
  // And as the grid's loans: the same keys, held to the maths.
  go(OLD[0][0]);
  holds({ ...OPENING, d: 150000, dp: undefined, r: 6.5 });
  go(OLD[1][0]);
  holds({ ...UNDER_WAY, b: 540000, r: 6.5, s: '2021-06', x: 250 });
  go('#');
});

test('one loan entered as new and as a loan under way with its price: the same PMI and the same whole-loan cost', () => {
  // Counted by month, then back to the yearly view the checks read.
  const byMonth = read => { click('view-month'); const got = read(tableRows()); click('view-year'); return got; };
  const pmiRows = () => byMonth(rows => rows.filter(r => r[4] !== '—').length);
  for (const [dp, months] of [[5, 132], [15, 72], [25, 0]]) {
    const fresh = { ...FIVE_DOWN, dp };
    go(hashOf(fresh));
    holds(fresh);
    const asNew = { cost: num($('sum-cost').textContent), pmi: $('bd-pmi').textContent, months: pmiRows(), balance: byMonth(rows => num(rows[23][5])) };
    assert.equal(asNew.months, months, `${dp}% down as a new loan`);

    // 24 payments in, with the balance a statement would show and the price.
    const under = { ...UNDER_WAY, b: asNew.balance, op: 750000, r: 6.25, s: '2024-12', nx: '2026-12', m: 0.5 };
    go(hashOf(under));
    holds(under);
    assert.equal(pmiRows(), Math.max(0, months - 24), `${dp}% down: PMI months still ahead`);
    assert.ok(Math.abs(num($('bd-pmi').textContent) - num(asNew.pmi)) <= 0.011, `${dp}% down: PMI ${$('bd-pmi').textContent} against ${asNew.pmi}`);
    const whole = num($('sum-cost').textContent);
    assert.ok(Math.abs(whole - asNew.cost) <= 5, `${dp}% down: whole-loan cost ${whole} against ${asNew.cost} as a new loan`);
    // The 24 months of PMI already paid are in that figure.
    const paidPmi = whole - num($('sub-cost').textContent) - (expected(under).original - under.b) - expected(under).past.reduce((t, r) => t + r.interest, 0);
    assert.ok(Math.abs(paidPmi - (months ? 24 * num(asNew.pmi) : 0)) <= 1.5, `${dp}% down: PMI already paid comes to ${paidPmi}`);

    // Take the price away and the loan amount stands in for it again.
    type('in-origprice', '');
    holds({ ...under, op: undefined }, '', TYPED);
    assert.ok(pmiRows() > 0, 'measured against the loan amount, PMI is still being charged');
  }
  go('#');
});

test('the original price is asked for only on a loan under way, and is optional there', () => {
  go('#');
  assert.equal($('next-field').hidden, true);
  assert.equal($('in-origprice').closest('#next-field'), $('next-field'), 'the field sits with the loan-under-way fields');
  click('mode-progress');
  assert.equal($('next-field').hidden, false);
  assert.equal($('in-origprice').value, '', 'switching mode does not fill it in');
  holds(UNDER_WAY, 'Already paying, from the opening page');
  assert.equal(page.location.hash, `#b=${UNDER_WAY.b}&s=${NEXT}&nx=${NEXT}&lm=1`);

  // Given a price, a tax percentage is a percentage of it.
  type('in-origprice', '750k');
  holds({ ...UNDER_WAY, op: 750000 }, '', TYPED);
  assert.equal($('bd-tax').textContent, usd2(750000 * DEFAULTS.taxRate / 100 / 12));
  assert.equal(new URLSearchParams(page.location.hash.slice(1)).get('op'), '750000');
  type('in-origprice', '');
  holds(UNDER_WAY);
  assert.equal(new URLSearchParams(page.location.hash.slice(1)).get('op'), null);

  // A price that is not one is an error; an empty one is an answer.
  for (const bad of ['abc', '0', '-5']) {
    type('in-origprice', bad);
    assert.equal($('out-total').textContent, '—', bad);
    assert.equal($('out-sub').textContent, 'Original home price: enter the price, or leave it empty.');
    assert.equal($('in-origprice').getAttribute('aria-invalid'), 'true');
    assert.doesNotMatch($('inf-note').textContent, /NaN|undefined|Infinity/);
  }
  type('in-origprice', '');
  assert.equal($('in-origprice').getAttribute('aria-invalid'), null);

  // It is not a new loan's business: left with text in it, the other mode ignores it.
  type('in-origprice', 'abc');
  click('mode-new');
  holds(OPENING);
  go('#');
});

test('a unit switch alone never changes the tax, insurance or escrow figure', () => {
  const bill = () => JSON.stringify([$('out-total').textContent, ...PARTS.map(k => $('bd-' + k).textContent)]);
  const LOANS = [
    ['a new loan', OPENING],
    ['a new loan, odd price', { ...OPENING, p: 612347, dp: 12.5, t: 1.137 }],
    ['a loan under way', { ...UNDER_WAY, b: 695265, s: '2024-12' }],
    ['a loan under way with its price', { ...UNDER_WAY, b: 695265, s: '2024-12', op: 750000 }],
    ['one escrow amount', { ...OPENING, em: 1, w: 725.5 }],
  ];
  const WALKS = [['in-tax', ['yr', 'mo', 'pct', 'mo', 'yr', 'pct']], ['in-ins', ['mo', 'yr']], ['in-escrow', ['yr', 'mo']]];
  for (const [name, st] of LOANS) {
    go(hashOf(st));
    const before = bill();
    for (const [id, walk] of WALKS) {
      const typed = $(id).value;
      for (const unit of walk) {
        choose(`${id}-unit`, unit);
        assert.equal(bill(), before, `${name}: ${id} to ${unit}`);
        assert.doesNotMatch($(id).value, /NaN|undefined|Infinity/);
        assert.deepEqual(snapshot().invalid, []);
      }
      assert.equal($(id).value, typed, `${name}: ${id} is back to what it started as`);
    }
    // The converted number is the one the link carries, and it reads back the same.
    choose('in-tax-unit', 'mo'); choose('in-ins-unit', 'mo');
    const link = page.location.hash;
    if (!st.em) assert.match(link, /(^#|&)tu=mo(&|$)/);
    go('#'); go(link);
    assert.equal(bill(), before, `${name}: reopened from ${link}`);
  }
  // The number did change, to say the same thing: 0.92% of $750,000 is $6,900 a year.
  go(hashOf({ ...OPENING, p: 750000, t: 0.92 }));
  choose('in-tax-unit', 'yr');
  assert.equal($('in-tax').value, '6900');
  choose('in-tax-unit', 'mo');
  assert.equal($('in-tax').value, '575');
  go('#');
});

test('a field that cannot be read dashes every figure, names itself, and recovers', () => {
  const dashed = (id, why) => {
    const p = snapshot();
    assert.equal(p.total, '—', why);
    for (const k of PARTS) assert.equal(p.parts[k].text, '—', `${why}: ${k}`);
    for (const k of FACTS) assert.equal(p.facts[k].main, '—', `${why}: ${k}`);
    assert.equal(p.chart, false, why);
    assert.match($('chart').innerHTML, /No chart until/, why);
    assert.match($('schedule').innerHTML, /No schedule until/, why);
    assert.deepEqual(p.invalid, [id], why);
    assert.equal($(id).getAttribute('aria-invalid'), 'true', why);
    assert.match($(id).getAttribute('aria-describedby'), /\bout-sub\b/, why);
    assert.ok(p.sub.startsWith(fieldOf(id).querySelector('.lbl').textContent + ':'), `${why}: "${p.sub}" names the field`);
  };
  const CASES = [
    [OPENING, [['in-price', 'abc'], ['in-price', ''], ['in-down', '1.2.3'], ['in-rate', ''], ['in-rate', 'six'], ['in-rate', '31'], ['in-start', ''],
      ['in-tax', '1,2,3'], ['in-ins', '?'], ['in-hoa', '-5'], ['in-pmi', 'x'], ['in-extra', '1e5']]],
    [{ ...OPENING, em: 1, w: 725 }, [['in-escrow', 'abc']]],
    [{ ...UNDER_WAY, b: 695265, s: '2024-12' }, [['in-balance', ''], ['in-balance', 'lots'], ['in-next', ''], ['in-next', '2024-11'], ['in-next', '2060-01'],
      ['in-maturity', ''], ['in-origprice', '0'], ['in-rate', 'abc']]],
  ];
  for (const [st, cases] of CASES) {
    for (const [id, text] of cases) {
      go(hashOf(st));
      holds(st);
      const kept = $(id).value;
      type(id, text);
      dashed(id, `${id} = "${text}"`);
      // A good edit elsewhere does not bring the figures back.
      type('in-hoa', id === 'in-hoa' ? text : '85');
      assert.equal($('out-total').textContent, '—');
      type('in-hoa', id === 'in-hoa' ? text : String(st.h));
      type(id, kept);
      holds(st, `after ${id} is put right`);
      assert.equal($(id).getAttribute('aria-invalid'), null);
    }
  }
  // Two unreadable fields are both named.
  go('#');
  type('in-price', 'abc'); type('in-rate', '');
  assert.equal($('out-sub').textContent, 'Interest rate: enter a number. Also check Home price.');
  go('#');
});

test('what a person types is read as they meant it, and the link carries it', () => {
  const typed = (id, text, st) => {
    type(id, text);
    holds(st, `${id} = "${text}"`, TYPED);
    const { check, done } = collector();
    checkHash(page.location.hash, st, DEFAULTS, NEXT, check);
    done();
  };
  go('#');
  for (const [text, p] of [['437,500', 437500], ['750k', 750000], ['1.2m', 1200000], ['$612,347', 612347], ['750.000', 750000], ['437500.', 437500]]) {
    typed('in-price', text, { ...OPENING, p });
  }
  for (const [text, r] of [['6,5', 6.5], ['6.', 6], ['6.125', 6.125], ['7.25%', 7.25], ['0', 0]]) typed('in-rate', text, { ...OPENING, p: 437500, r });
  go('#');
  // The down payment is one fact in two fields: the one typed last is kept.
  typed('in-down', '50000', { ...OPENING, d: 50000, dp: undefined });
  assert.equal($('in-downpct').value, String(+(50000 / DEFAULTS.price * 100).toFixed(2)));
  typed('in-price', '437500', { ...OPENING, p: 437500, d: 50000, dp: undefined });
  assert.equal($('in-down').value, '50000', 'typed dollars are not rewritten by a price change');
  typed('in-downpct', '5', { ...OPENING, p: 437500, dp: 5 });
  typed('in-price', '612347', { ...OPENING, p: 612347, dp: 5 });
  typed('in-pmi', '0,5', { ...OPENING, p: 612347, dp: 5, m: 0.5 });
  typed('in-tax', '0,92', { ...OPENING, p: 612347, dp: 5, m: 0.5, t: 0.92 });
  typed('in-hoa', '85.5', { ...OPENING, p: 612347, dp: 5, m: 0.5, t: 0.92, h: 85.5 });
  typed('in-extra', '200', { ...OPENING, p: 612347, dp: 5, m: 0.5, t: 0.92, h: 85.5, x: 200 });
  typed('in-every', '3', { ...OPENING, p: 612347, dp: 5, m: 0.5, t: 0.92, h: 85.5, x: 200, e: 3 });
  typed('in-years', '15', { ...OPENING, p: 612347, dp: 5, m: 0.5, t: 0.92, h: 85.5, x: 200, e: 3, y: 15 });
  typed('in-start', '2025-03', { ...OPENING, p: 612347, dp: 5, m: 0.5, t: 0.92, h: 85.5, x: 200, e: 3, y: 15, s: '2025-03' });
  go('#');
});

test('the mode buttons: a loan under way seeds its balance, escrow seeds its amount, and both go back', () => {
  go('#');
  click('mode-progress');
  assert.equal($('mode-progress').getAttribute('aria-pressed'), 'true');
  assert.equal($('term-label').textContent, 'Original term');
  holds(UNDER_WAY);
  // First and last payment are one fact: either sets the other from the term.
  type('in-start', '2024-12');
  holds({ ...UNDER_WAY, s: '2024-12' });
  type('in-maturity', '2050-01');
  assert.equal($('in-start').value, addMonths('2050-01', -(DEFAULTS.years * 12 - 1)));
  type('in-years', '15');
  assert.equal($('in-maturity').value, addMonths($('in-start').value, 179));
  click('mode-new');
  assert.equal($('mode-new').getAttribute('aria-pressed'), 'true');
  assert.equal($('term-label').textContent, 'Term');
  go('#');

  // Escrow starts as the tax and insurance it replaces, so the total holds.
  for (const st of [OPENING, { ...UNDER_WAY, b: 695265, s: '2024-12' }, { ...UNDER_WAY, b: 695265, s: '2024-12', op: 750000 }]) {
    go(hashOf(st));
    const e = expected(st), yearly = (e.bill.tax + e.bill.insurance) * 12;
    click('mode-escrow');
    assert.equal($('in-escrow').value, String(Math.round(yearly / 12)));
    holds({ ...st, em: 1, w: Math.round(yearly / 12) });
    click('mode-split');
    holds(st, 'back to tax and insurance', TYPED);
  }
  // A typed escrow of 0 is an amount, and a link keeps it.
  go(hashOf({ ...OPENING, em: 1, w: 0 }));
  holds({ ...OPENING, em: 1, w: 0 });
  go('#em=1');
  holds({ ...OPENING, em: 1, w: Math.round(expected(OPENING).bill.tax + expected(OPENING).bill.insurance) });
  go('#');
});

test('where there is no month picker, a month select and a year box stand in for each month field', () => {
  use(withPicker);
  for (const id of ['in-start', 'in-maturity', 'in-next']) {
    assert.equal(page.find(`${id}-month`), null, 'a browser with a picker keeps its picker');
    assert.equal($(id).hidden, false);
  }
  use(noPicker);
  const shows = (id, month) => {
    assert.equal($(id).value, month, id);
    assert.equal($(`${id}-month`).value, month.slice(5), `${id} month`);
    assert.equal($(`${id}-year`).value, month.slice(0, 4), `${id} year`);
  };
  for (const id of ['in-start', 'in-maturity', 'in-next']) {
    const sel = $(`${id}-month`), year = $(`${id}-year`), label = fieldOf(id).querySelector('.lbl');
    assert.equal($(id).hidden, true, 'the field itself is out of sight');
    assert.equal(sel.closest('.field'), fieldOf(id));
    assert.equal(year.closest('.field'), fieldOf(id));
    assert.deepEqual(sel.options.map(o => o.value), ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12']);
    assert.deepEqual(sel.options.map(o => o.textContent).slice(0, 3), ['Jan', 'Feb', 'Mar']);
    assert.equal(year.type, 'number');
    assert.equal(label.htmlFor, sel.id, 'the label points at a control that is on screen');
    assert.equal(sel.getAttribute('aria-label'), `${label.textContent}, month`);
    assert.equal(year.getAttribute('aria-label'), `${label.textContent}, year`);
  }
  go('#');
  shows('in-start', NEXT);
  shows('in-maturity', addMonths(NEXT, DEFAULTS.years * 12 - 1));

  // Choosing a month and a year is the same edit as picking one in a picker.
  choose('in-start-month', '03');
  type('in-start-year', '2025');
  shows('in-start', '2025-03');
  shows('in-maturity', addMonths('2025-03', DEFAULTS.years * 12 - 1));
  holds({ ...OPENING, s: '2025-03' });
  assert.equal(page.location.hash, '#s=2025-03');

  // A loan under way reads all three, and each date moves the other.
  const st = { ...UNDER_WAY, b: 695265, s: '2024-12', op: 750000, m: 0.5 };
  go(hashOf(st));
  shows('in-start', '2024-12');
  shows('in-next', NEXT);
  holds(st);
  choose('in-maturity-month', '05');
  shows('in-start', addMonths(`${$('in-maturity-year').value}-05`, -(st.y * 12 - 1)));
  type('in-years', '15');
  shows('in-maturity', addMonths($('in-start').value, 179));
  go(hashOf(st));
  choose('in-next-month', '01'); type('in-next-year', '2027');
  shows('in-next', '2027-01');
  holds({ ...st, nx: '2027-01' });
  assert.match(page.location.hash, /(^#|&)nx=2027-01(&|$)/);

  // Half an answer is no month: the figures go, and the message says what to do.
  type('in-next-year', '');
  assert.equal($('in-next').value, '');
  assert.equal($('in-next-month').value, '01', 'what was chosen stays chosen');
  assert.equal($('out-total').textContent, '—');
  assert.equal($('out-sub').textContent, 'Next payment: choose the month and enter the year.');
  assert.equal(fieldOf('in-next').classList.contains('invalid'), true);
  for (const part of ['in-next-month', 'in-next-year']) {
    assert.equal($(part).getAttribute('aria-invalid'), 'true');
    assert.match($(part).getAttribute('aria-describedby'), /\bout-sub\b/);
  }
  for (const year of ['20', '202', '99999']) { type('in-next-year', year); assert.equal($('out-total').textContent, '—', year); }
  type('in-next-year', '2027');
  holds({ ...st, nx: '2027-01' });
  assert.equal($('in-next-month').getAttribute('aria-invalid'), null);

  // Reset and a link both fill the stand-ins.
  click('btn-reset');
  shows('in-start', NEXT);
  holds(OPENING);

  const { check, done } = collector();
  for (const s of states(NEXT, true)) {
    go(hashOf(s));
    checkState(snapshot(s), s, check);
    check($('in-start-month').value === s.s.slice(5) && $('in-start-year').value === s.s.slice(0, 4), 'the first-payment stand-ins lag the field', s);
    if (s.lm) check($('in-next-month').value === s.nx.slice(5) && $('in-next-year').value === s.nx.slice(0, 4), 'the next-payment stand-ins lag the field', s);
  }
  done();
  assert.deepEqual(page.missing, []);
  go('#');
  use(withPicker);
});

test('reset, copy link, the legend toggles, the tooltip and a bad hash', async () => {
  go(hashOf({ ...FIVE_DOWN, x: 200 }));
  click('mode-progress');
  click('btn-reset');
  assert.equal(page.location.hash, '');
  holds(OPENING, 'after Reset');

  type('in-rate', '6.875');
  click('btn-share');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(page.copied, 'http://localhost/mortgage/#r=6.875');
  assert.equal($('share-status').textContent, 'Link copied.');

  // A legend button switches its line off, remembers it, and keeps the focus.
  const button = id => page.all(k => k.tag === 'button' && k.dataset.series === id && $('chart-legend').contains(k))[0];
  const paths = () => page.all(k => k.tag === 'path' && $('chart').contains(k)).length;
  const lines = paths();
  assert.equal(button('balance').getAttribute('aria-pressed'), 'true');
  button('balance').fire('click');
  assert.equal(button('balance').getAttribute('aria-pressed'), 'false');
  assert.equal(paths(), lines - 1);
  assert.equal(page.focused, button('balance'));
  assert.equal(page.localStorage.getItem('mortgage.hide.totals'), '["balance"]');
  type('in-rate', '7');
  assert.equal(button('balance').getAttribute('aria-pressed'), 'false', 'the choice outlives a redraw');
  button('balance').fire('click');
  assert.equal(paths(), lines);

  // A tapped tooltip stays until a press elsewhere; a hovered one leaves with the pointer.
  const press = { clientX: 300, clientY: 40 };
  hit().fire('pointerdown', { ...press, pointerType: 'touch' });
  assert.equal($('tip').hidden, false);
  assert.match(strip($('tip').innerHTML), /payment \d+Balance\$/);
  hit().fire('pointerleave', { pointerType: 'touch' });
  assert.equal($('tip').hidden, false, 'it survives the finger lifting');
  $('form').fire('pointerdown', { pointerType: 'touch' });
  assert.equal($('tip').hidden, true, 'and closes on a press outside the chart');
  hit().fire('pointermove', { ...press, pointerType: 'mouse' });
  assert.equal($('tip').hidden, false);
  hit().fire('pointerleave', { pointerType: 'mouse' });
  assert.equal($('tip').hidden, true);

  // The schedule by month has a row for every payment.
  go('#');
  click('view-month');
  assert.equal(tableRows().length, DEFAULTS.years * 12);
  assert.equal($('th-period').textContent, 'Month');
  click('view-year');
  assert.equal(tableRows().length, DEFAULTS.years);

  // A hash nobody wrote falls back key by key instead of breaking the page.
  go('#p=abc&r=&y=50000&s=2026-13&tu=week&e=7&lm=2&op=-1&zz=1');
  holds(OPENING, 'a hash of nonsense');
  go('#y=15&r=5.5&junk');
  holds({ ...OPENING, y: 15, r: 5.5 });
  go('#');
});
