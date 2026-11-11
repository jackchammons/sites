import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { stamp, stampDir, unstamped } from '../lib/stamp.mjs';

const sha = s => createHash('sha1').update(s).digest('hex').slice(0, 8);
const files = obj => new Map(Object.entries(obj).map(([k, v]) => [k, Buffer.from(v)]));

// The site as it stands after stamping: rewritten files over the originals.
const run = obj => {
  const input = files(obj);
  const { changed, stamps } = stamp(input);
  const out = {};
  for (const [name, bytes] of input) out[name] = (changed.get(name) || bytes).toString('utf8');
  return { out, stamps, changed };
};

const SITE = {
  'index.html': '<link rel="stylesheet" href="./styles.css">\n<script type="module" src="./app.js"></script>\n',
  'app.js': "import { a } from './lib.js';\nconsole.log(a);\n",
  'lib.js': "import { leaf } from './leaf.js';\nexport const a = leaf;\n",
  'leaf.js': 'export const leaf = 1;\n',
  'styles.css': 'body{margin:0}\n',
};

test('nested imports: each importer is stamped after, and over, what it imports', () => {
  const { out, stamps } = run(SITE);
  const leaf = sha(SITE['leaf.js']);
  assert.equal(stamps.get('leaf.js'), leaf);
  assert.equal(out['lib.js'], `import { leaf } from './leaf.js?v=${leaf}';\nexport const a = leaf;\n`);
  assert.equal(stamps.get('lib.js'), sha(out['lib.js']));
  assert.equal(out['app.js'], `import { a } from './lib.js?v=${stamps.get('lib.js')}';\nconsole.log(a);\n`);
  assert.equal(stamps.get('app.js'), sha(out['app.js']));
  assert.equal(out['index.html'],
    `<link rel="stylesheet" href="./styles.css?v=${sha(SITE['styles.css'])}">\n`
    + `<script type="module" src="./app.js?v=${stamps.get('app.js')}"></script>\n`);
});

test('a change three imports deep changes the URL the page asks for', () => {
  const before = run(SITE);
  const after = run({ ...SITE, 'leaf.js': 'export const leaf = 2;\n' });
  for (const f of ['leaf.js', 'lib.js', 'app.js']) {
    assert.notEqual(after.stamps.get(f), before.stamps.get(f), f);
  }
  assert.equal(after.stamps.get('styles.css'), before.stamps.get('styles.css'));
  assert.notEqual(after.out['index.html'], before.out['index.html']);
});

test('a file with no references keeps its bytes and still gets a stamp', () => {
  const { changed, stamps } = run(SITE);
  assert.ok(!changed.has('leaf.js'));
  assert.ok(!changed.has('styles.css'));
  assert.match(stamps.get('leaf.js'), /^[0-9a-f]{8}$/);
  assert.deepEqual([...stamps.keys()].sort(), ['app.js', 'leaf.js', 'lib.js', 'styles.css']);
});

test('a reference that already carries ?v= is re-stamped, not doubled', () => {
  const stale = {
    ...SITE,
    'index.html': '<link rel="stylesheet" href="./styles.css?v=00000000">\n<script type="module" src="./app.js?v=deadbeef"></script>\n',
    'app.js': "import { a } from './lib.js?v=0badc0de';\nconsole.log(a);\n",
  };
  const fresh = run(SITE);
  const again = run(stale);
  assert.deepEqual(again.out, fresh.out);
  assert.ok(!/\?v=[0-9a-f]+\?v=/.test(Object.values(again.out).join('')));
});

test('stamping its own output changes nothing', () => {
  const once = run(SITE);
  const twice = run(once.out);
  assert.deepEqual(twice.out, once.out);
  assert.equal(twice.changed.size, 0);
  assert.deepEqual([...twice.stamps], [...once.stamps]);
});

test('every import form is stamped', () => {
  const { out, stamps } = run({
    'app.js': [
      "import './side.js';",
      'import x from "./side.js";',
      "export { y } from './side.js';",
      "export * from './side.js';",
      "const m = await import('./side.js');",
      "const n = await import(`./side.js`);",
      'import{z}from"./side.js";',
    ].join('\n'),
    'side.js': 'export const y = 1, z = 2; export default 3;\n',
  });
  const v = `?v=${stamps.get('side.js')}`;
  assert.equal(out['app.js'], [
    `import './side.js${v}';`,
    `import x from "./side.js${v}";`,
    `export { y } from './side.js${v}';`,
    `export * from './side.js${v}';`,
    `const m = await import('./side.js${v}');`,
    `const n = await import(\`./side.js${v}\`);`,
    `import{z}from"./side.js${v}";`,
  ].join('\n'));
});

test('a quoted literal that is exactly a local asset path is stamped', () => {
  const { out, stamps } = run({
    'index.html': '<script src="./app.js"></script>',
    'app.js': "const w = new Worker('./worker.js');\nlink.href = \"./styles.css\";\n",
    'worker.js': 'postMessage(1);\n',
    'styles.css': 'a{}\n',
  });
  assert.equal(out['app.js'],
    `const w = new Worker('./worker.js?v=${stamps.get('worker.js')}');\nlink.href = "./styles.css?v=${stamps.get('styles.css')}";\n`);
  assert.equal(stamps.get('app.js'), sha(out['app.js']));
});

test('only whole literals naming an emitted file are touched', () => {
  const app = [
    "import d3 from 'https://cdn.example.com/d3.js';",
    "import pkg from 'pkg/lib.js';",
    "import gone from './not-emitted.js';",
    "fetch('./data.json');",
    "const base = './';",
    "const built = './' + name + '.js';",
    "const other = './lib.js#frag';",
    "const query = './lib.js?x=1';",
    '// see ./lib.js for the maths',
  ].join('\n');
  const { out, changed } = run({ 'app.js': app, 'lib.js': 'export default 1;\n', 'data.json': '{}' });
  assert.equal(out['app.js'], app);
  assert.ok(!changed.has('app.js'));
});

test('markup: only local references to emitted scripts and stylesheets are stamped', () => {
  const html = [
    '<link rel="icon" href="data:image/svg+xml,<svg xmlns=\'http://www.w3.org/2000/svg\'><text>x</text></svg>">',
    '<link rel="canonical" href="https://example.com/app.js">',
    '<script src="https://cdn.example.com/app.js"></script>',
    '<script src="//cdn.example.com/app.js"></script>',
    '<script src="/app.js"></script>',
    '<script src="./missing.js"></script>',
    '<a href="../">all sites</a>',
    '<a href="./rankings.json">data</a>',
    "<script src='./app.js'></script>",
    '<link rel="stylesheet" href="styles.css">',
  ].join('\n');
  const { out, stamps } = run({ 'index.html': html, 'app.js': '1;\n', 'styles.css': 'a{}\n', 'rankings.json': '[]' });
  const lines = out['index.html'].split('\n');
  assert.deepEqual(lines.slice(0, 8), html.split('\n').slice(0, 8));
  assert.equal(lines[8], `<script src='./app.js?v=${stamps.get('app.js')}'></script>`);
  assert.equal(lines[9], `<link rel="stylesheet" href="styles.css?v=${stamps.get('styles.css')}">`);
});

test('paths resolve from the file that holds them', () => {
  const { out, stamps } = run({
    'index.html': '<script type="module" src="./js/app.js"></script><link rel="stylesheet" href="css/site.css">',
    'js/app.js': "import '../shared.js';\nimport './util.js';\n",
    'js/util.js': 'export {};\n',
    'shared.js': 'export {};\n',
    'util.js': 'export const decoy = true;\n',
    'css/site.css': 'a{}\n',
    'about/index.html': '<script type="module" src="../js/app.js"></script>',
  });
  assert.equal(out['js/app.js'],
    `import '../shared.js?v=${stamps.get('shared.js')}';\nimport './util.js?v=${stamps.get('js/util.js')}';\n`);
  assert.notEqual(stamps.get('js/util.js'), stamps.get('util.js'));
  assert.equal(out['index.html'],
    `<script type="module" src="./js/app.js?v=${stamps.get('js/app.js')}"></script>`
    + `<link rel="stylesheet" href="css/site.css?v=${stamps.get('css/site.css')}">`);
  assert.equal(out['about/index.html'], `<script type="module" src="../js/app.js?v=${stamps.get('js/app.js')}"></script>`);
});

test('modules that import each other still get one URL each', () => {
  const { out, stamps } = run({
    'index.html': '<script type="module" src="./a.js"></script><script type="module" src="./b.js"></script>',
    'a.js': "import './b.js';\nexport const a = 1;\n",
    'b.js': "import './a.js';\nexport const b = 2;\n",
  });
  const urls = name => new Set(Object.values(out).join('\n').match(new RegExp(`${name}\\.js\\?v=[0-9a-f]{8}`, 'g')));
  assert.equal(urls('a').size, 1);
  assert.equal(urls('b').size, 1);
  assert.ok(out['b.js'].includes(`./a.js?v=${stamps.get('a.js')}`));
  assert.ok(out['a.js'].includes(`./b.js?v=${stamps.get('b.js')}`));
  assert.deepEqual(unstamped(out['index.html']), []);
});

test('unstamped() lists the local scripts and stylesheets a page loads without a stamp', () => {
  const html = [
    '<link rel="icon" href="data:image/svg+xml,<svg xmlns=\'http://www.w3.org/2000/svg\'><text>x</text></svg>">',
    '<link rel="canonical" href="https://example.com/">',
    '<link rel="stylesheet" href="https://fonts.example.com/a.css">',
    '<link rel="stylesheet" href="./styles.css?v=0123abcd">',
    '<link rel="stylesheet" href="./print.css">',
    '<script type="application/json" id="config">{"src":"./inline.js"}</script>',
    '<script>var s = \'<script src="./built-later.js">\';</script>',
    '<script src="./app.js?v=0123abcd" defer></script>',
    '<script src="./late.js?cache=no"></script>',
    '<script src="../shared/x.js"></script>',
    '<img src="./photo.png">',
  ].join('\n');
  assert.deepEqual(unstamped(html), ['./print.css', './late.js?cache=no', '../shared/x.js']);
});

test('stampDir rewrites a built site in place', t => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'sites-stamp-'));
  t.after(() => fs.rmSync(out, { recursive: true, force: true }));
  for (const [name, body] of Object.entries(SITE)) fs.writeFileSync(path.join(out, name), body);
  fs.writeFileSync(path.join(out, 'rankings.json'), '{"file":"./app.js"}');
  fs.writeFileSync(path.join(out, '.nojekyll'), '');

  const { stamps, missing } = stampDir(out);
  assert.deepEqual(missing, []);
  assert.equal(stamps.size, 4);
  const read = f => fs.readFileSync(path.join(out, f), 'utf8');
  assert.ok(read('index.html').includes(`src="./app.js?v=${sha(read('app.js'))}"`));
  assert.ok(read('app.js').includes(`'./lib.js?v=${sha(read('lib.js'))}'`));
  assert.equal(read('leaf.js'), SITE['leaf.js']);
  assert.equal(read('rankings.json'), '{"file":"./app.js"}');

  fs.writeFileSync(path.join(out, 'index.html'), read('index.html') + '<script src="./leaf.js?x=1"></script>');
  assert.deepEqual(stampDir(out).missing, [{ page: 'index.html', ref: './leaf.js?x=1' }]);
});
