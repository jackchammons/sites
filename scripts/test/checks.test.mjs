import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkOutput, checkPage } from '../lib/checks.mjs';
import { tags } from '../lib/html.mjs';

const ICON = `<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🗂️</text></svg>">`;

function site(t, entries) {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'sites-checks-'));
  t.after(() => fs.rmSync(out, { recursive: true, force: true }));
  for (const [name, body] of Object.entries(entries)) {
    fs.mkdirSync(path.dirname(path.join(out, name)), { recursive: true });
    fs.writeFileSync(path.join(out, name), body);
  }
  return out;
}

const page = body => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>A page</title>${ICON}</head><body>${body}</body></html>`;

test('tags(): an attribute may hold markup of its own', () => {
  const found = tags(`${ICON}<script type="module" src="./app.js" defer></script><p class=lede hidden>it's</p>`);
  assert.deepEqual(found.map(x => x.name), ['link', 'script', 'p']);
  assert.equal(found[0].attrs.rel, 'icon');
  assert.ok(found[0].attrs.href.endsWith('</svg>'));
  assert.deepEqual(found[1].attrs, { type: 'module', src: './app.js', defer: '' });
  assert.deepEqual(found[2].attrs, { class: 'lede', hidden: '' });
});

test('tags(): script bodies, style bodies and comments are not markup', () => {
  const found = tags([
    '<!-- <img src="/commented.png"> -->',
    '<style>a::after{content:"<img src=/x.png>"}</style>',
    '<script>el.innerHTML = \'<a href="/root">x</a><img src="nope.png">\';</script>',
    '<script type="application/json">{"html":"<script src=\\"/x.js\\">"}</script>',
    '<a href="?page=2&amp;sort=asc">next</a>',
  ].join('\n'));
  assert.deepEqual(found.map(x => x.name), ['style', 'script', 'script', 'a']);
  assert.equal(found[3].attrs.href, '?page=2&sort=asc');
});

test('checkPage: root-relative src and href are refused on any tag', () => {
  const problems = checkPage(page(
    '<script src="/app.js"></script><link rel="stylesheet" href="/styles.css">'
    + '<a href="/">home</a><a href="/pizza/">pizza</a><img src=/logo.png>'), 'index.html', () => true);
  assert.equal(problems.length, 5);
  for (const p of problems) assert.match(p, /^index\.html: <\w+ (src|href)="\/[^"]*"> is root-relative/);
});

test('checkPage: other hosts, schemes, fragments and queries are left alone', () => {
  const problems = checkPage(page(
    '<script src="https://cdn.example.com/x.js"></script><script src="//cdn.example.com/x.js"></script>'
    + '<img src="data:image/png;base64,AAAA"><a href="#top">top</a><a href="mailto:a@example.com">mail</a>'
    + '<a href="?q=1">q</a><link rel="canonical" href="https://example.com/x/"><a href="../">all sites</a>'),
  'index.html', () => false);
  assert.deepEqual(problems, []);
});

test('checkPage: scripts, stylesheets and images must name files that exist', () => {
  const emitted = new Set(['app.js', 'styles.css', 'img/a b.png']);
  const asked = [];
  const problems = checkPage(page(
    '<script type="module" src="./app.js?v=12345678"></script><link rel="stylesheet" href="styles.css#x">'
    + '<img src="./img/a%20b.png"><script src="./gone.js"></script><img src="missing.png">'
    + '<link rel="stylesheet" href="./nope.css"><a href="./not-checked.html">a link is not an asset</a>'),
  'index.html', f => { asked.push(f); return emitted.has(path.posix.normalize(f)); });
  assert.deepEqual(problems, [
    'index.html: <script src="./gone.js"> names a file the build did not emit',
    'index.html: <img src="missing.png"> names a file the build did not emit',
    'index.html: <link href="./nope.css"> names a file the build did not emit',
  ]);
  assert.deepEqual(asked, ['./app.js', 'styles.css', './img/a b.png', './gone.js', 'missing.png', './nope.css']);
});

test('checkOutput: a complete site passes', t => {
  const out = site(t, {
    'index.html': page('<script type="module" src="./app.js"></script><link rel="stylesheet" href="./styles.css"><a href="../">all sites</a>'),
    'app.js': '1;', 'styles.css': 'a{}',
  });
  assert.deepEqual(checkOutput(out), []);
});

test('checkOutput: no index.html, or one without a title', t => {
  assert.deepEqual(checkOutput(site(t, { 'report.html': page('') })), ['the build produced no index.html']);
  assert.deepEqual(checkOutput(site(t, { 'index.html': '<!doctype html><title>  </title><p>x</p>' })),
    ['index.html has no <title>']);
  assert.deepEqual(checkOutput(site(t, { 'index.html': '<!doctype html><p>x</p>' })),
    ['index.html has no <title>']);
});

test('checkOutput: every page is checked, each from its own directory', t => {
  const out = site(t, {
    'index.html': page('<script src="./app.js"></script>'),
    'app.js': '1;',
    'about/index.html': page('<script src="../app.js"></script><img src="./me.png"><script src="/x.js"></script>'
      + '<script src="../../sibling/app.js"></script>'),
  });
  assert.deepEqual(checkOutput(out), [
    'about/index.html: <img src="./me.png"> names a file the build did not emit',
    'about/index.html: <script src="/x.js"> is root-relative and misses the site\'s own directory; use a relative path',
  ]);
});
