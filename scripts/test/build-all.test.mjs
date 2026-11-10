import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/* End to end: the real build-all.mjs, pointed by SITES_ROOT at a small
   repository made for the test. Nothing in this checkout is built or cleared. */
const BUILD_ALL = fileURLToPath(new URL('../build-all.mjs', import.meta.url));
const sha = s => createHash('sha1').update(s).digest('hex').slice(0, 8);

/* A site build in the shape every real one has: clear OUT_DIR, then write. The
   clearing is what makes a bad slug dangerous, so the fixture keeps it. */
const buildScript = files => `import fs from 'node:fs';
import path from 'node:path';
const out = process.env.OUT_DIR;
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
for (const [name, body] of Object.entries(${JSON.stringify(files)})) fs.writeFileSync(path.join(out, name), body);
console.log('built ' + path.basename(out));
`;

const ALPHA = {
  'index.html': '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Alpha</title>'
    + '<link rel="stylesheet" href="./styles.css"></head><body><h1>Alpha</h1>'
    + '<a href="../">all sites</a><script type="module" src="./app.js"></script></body></html>\n',
  'app.js': "import { n } from './lib.js';\ndocument.title += n;\n",
  'lib.js': 'export const n = 1;\n',
  'styles.css': 'body{margin:0}\n',
};
const BETA = {
  'index.html': '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Beta</title></head>'
    + '<body><h1>Beta</h1></body></html>\n',
};
// Runs before stamping, so it sees the references exactly as the build wrote them.
const ALPHA_VERIFY = `import fs from 'node:fs';
const html = fs.readFileSync(process.env.OUT_DIR + '/index.html', 'utf8');
if (!html.includes('src="./app.js"') || !html.includes('href="./styles.css"')) {
  console.error('verify saw stamped references'); process.exit(1);
}
console.log('verified alpha');
`;

function fixture(t, change = () => {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sites-build-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const write = (rel, body) => {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), body);
  };
  write('alpha/build.mjs', buildScript(ALPHA));
  write('alpha/verify.mjs', ALPHA_VERIFY);
  write('beta/build.mjs', buildScript(BETA));
  write('docs/keep.md', 'source, not output\n');
  const config = {
    owner: 'someone', title: 'someone / sites', tagline: 'Two small sites.',
    baseUrl: 'https://sites.example.com', customDomain: 'sites.example.com',
    sites: [
      { slug: 'alpha', name: 'Alpha & Co', emoji: '🅰️', tagline: 'The first one.', dir: 'alpha',
        build: ['node', 'build.mjs'], verify: ['node', 'verify.mjs'], cadence: 'Rebuilt daily', accent: '#3366aa' },
      { slug: 'beta', name: 'Beta', tagline: 'The second one.', dir: 'beta', build: ['node', 'build.mjs'] },
    ],
  };
  change(config, write);
  write('sites.config.json', JSON.stringify(config, null, 2));
  return root;
}

function buildAll(root, args = [], extraEnv = {}) {
  const env = { ...process.env, SITES_ROOT: root, ...extraEnv };
  for (const name of ['CI', 'GITHUB_ACTIONS', 'OUT_DIR']) if (!(name in extraEnv)) delete env[name];
  const r = spawnSync(process.execPath, [BUILD_ALL, ...args], { encoding: 'utf8', env });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, all: r.stdout + r.stderr };
}

const read = (root, rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const failures = r => r.stderr.split('\n').filter(l => l.startsWith('✗ '));

test('a full build: layout, stamps, landing page, 404, robots and sitemap', t => {
  const root = fixture(t);
  const r = buildAll(root);
  assert.equal(r.status, 0, r.all);

  assert.deepEqual(fs.readdirSync(path.join(root, 'dist'), { recursive: true }).sort(), [
    '.nojekyll', '404.html', 'CNAME', 'alpha', 'alpha/app.js', 'alpha/index.html', 'alpha/lib.js',
    'alpha/styles.css', 'beta', 'beta/index.html', 'index.html', 'robots.txt', 'sitemap.xml',
  ]);
  assert.equal(read(root, 'dist/CNAME'), 'sites.example.com\n');

  // Each URL carries the hash of the file it names, as that file was written.
  const lib = sha(read(root, 'dist/alpha/lib.js'));
  assert.equal(read(root, 'dist/alpha/lib.js'), ALPHA['lib.js']);
  assert.equal(read(root, 'dist/alpha/app.js'), ALPHA['app.js'].replace('./lib.js', `./lib.js?v=${lib}`));
  const page = read(root, 'dist/alpha/index.html');
  assert.ok(page.includes(`src="./app.js?v=${sha(read(root, 'dist/alpha/app.js'))}"`), page);
  assert.ok(page.includes(`href="./styles.css?v=${sha(ALPHA['styles.css'])}"`), page);
  assert.equal(read(root, 'dist/beta/index.html'), BETA['index.html']);

  const landing = read(root, 'dist/index.html');
  assert.deepEqual([...landing.matchAll(/<a class="card" href="([^"]+)"/g)].map(m => m[1]), ['./alpha/', './beta/']);
  assert.ok(landing.includes('<h2>Alpha &amp; Co</h2>'));
  assert.ok(landing.includes('<link rel="canonical" href="https://sites.example.com/">'));
  assert.ok(landing.includes('<meta property="og:url" content="https://sites.example.com/">'));
  assert.ok(landing.includes('<meta property="og:description" content="Two small sites.">'));
  assert.equal((landing.match(/<meta name="theme-color"/g) || []).length, 2);
  assert.match(landing, /2 sites · updated <time datetime="\d{4}-\d\d-\d\dT[\d:.]+Z">[A-Z][a-z]+ \d{1,2}, \d{4}<\/time>/);
  assert.ok(!landing.includes('undefined'));
  assert.ok(!/(?:src|href)="\//.test(landing), 'the landing page must work under any base path');

  const notFound = read(root, 'dist/404.html');
  assert.deepEqual([...notFound.matchAll(/<a [^>]*href="([^"]+)"/g)].map(m => m[1]), ['/alpha/', '/beta/', '/']);
  assert.ok(notFound.includes('Alpha &amp; Co'));
  assert.match(notFound, /<meta name="description" content="[^"]+">/);
  assert.match(notFound, /<link rel="icon" href="data:image\/svg\+xml,/);
  assert.ok(notFound.includes('prefers-color-scheme:light'));
  assert.ok(!/<(?:script|link)[^>]+(?:src|href)="(?!data:)/.test(notFound), 'a 404 is served at any depth, so it loads no files');

  assert.equal(read(root, 'dist/robots.txt'), 'User-agent: *\nAllow: /\n\nSitemap: https://sites.example.com/sitemap.xml\n');
  assert.deepEqual([...read(root, 'dist/sitemap.xml').matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]),
    ['https://sites.example.com/', 'https://sites.example.com/alpha/', 'https://sites.example.com/beta/']);
});

test('a duplicate slug is refused before anything is cleared', t => {
  const root = fixture(t, (config, write) => {
    config.sites[1].slug = 'alpha';
    write('dist/previous.txt', 'the last good build\n');
  });
  const r = buildAll(root);
  assert.equal(r.status, 1);
  assert.deepEqual(failures(r), ['✗ sites.config.json: sites[1] "alpha": slug is already used by sites[0]']);
  assert.equal(read(root, 'dist/previous.txt'), 'the last good build\n');
  assert.ok(!r.stdout.includes('built '), 'no site build ran');
});

test('a slug that points outside dist/ deletes nothing', t => {
  const root = fixture(t, (config, write) => {
    config.sites[1].slug = '../docs';
    write('dist/previous.txt', 'the last good build\n');
  });
  const r = buildAll(root);
  assert.equal(r.status, 1);
  assert.equal(failures(r).length, 1);
  assert.match(failures(r)[0], /^✗ sites\.config\.json: sites\[1\] "\.\.\/docs": slug must be lowercase letters, digits and hyphens/);
  assert.equal(read(root, 'docs/keep.md'), 'source, not output\n');
  assert.deepEqual(fs.readdirSync(path.join(root, 'docs')), ['keep.md']);
  assert.equal(read(root, 'dist/previous.txt'), 'the last good build\n');
});

test('a registry that is not JSON is one line, not a stack trace', t => {
  const root = fixture(t);
  fs.writeFileSync(path.join(root, 'sites.config.json'), '{ "sites": [ }');
  const r = buildAll(root);
  assert.equal(r.status, 1);
  assert.equal(failures(r).length, 1);
  assert.match(failures(r)[0], /^✗ sites\.config\.json: cannot be read as JSON/);
  assert.ok(!r.stderr.includes('    at '), r.stderr);
});

test('a failing verify names the site and the step in one line', t => {
  const root = fixture(t, (config, write) => {
    write('beta/verify.mjs', 'console.error("verify says no"); process.exit(3);\n');
    config.sites[1].verify = ['node', 'verify.mjs'];
  });
  const r = buildAll(root);
  assert.equal(r.status, 1);
  assert.deepEqual(failures(r), ['✗ beta: verify failed, "node verify.mjs" exited 3']);
  assert.ok(r.stderr.includes('verify says no'), 'the site\'s own output is still shown');
  assert.ok(!/spawnSync|    at |pid:/.test(r.stderr), r.stderr);
  assert.ok(!fs.existsSync(path.join(root, 'dist/index.html')), 'no landing page for a failed run');
});

test('a failing build, and a command that does not exist', t => {
  let r = buildAll(fixture(t, (config, write) => write('alpha/build.mjs', 'throw new Error("boom");\n')));
  assert.equal(r.status, 1);
  assert.deepEqual(failures(r), ['✗ alpha: build failed, "node build.mjs" exited 1']);

  r = buildAll(fixture(t, config => { config.sites[1].build = ['no-such-toolchain-here', 'build']; }));
  assert.equal(r.status, 1);
  assert.deepEqual(failures(r), ['✗ beta: build could not start "no-such-toolchain-here" (ENOENT)']);
});

test('under Actions a failure is an error annotation', t => {
  const root = fixture(t, config => { config.sites[1].slug = 'alpha'; });
  const r = buildAll(root, [], { GITHUB_ACTIONS: 'true' });
  assert.equal(r.status, 1);
  assert.ok(r.all.split('\n').includes('::error::sites.config.json: sites[1] "alpha": slug is already used by sites[0]'), r.all);
});

test('the shared checks run on every site, with or without a verifier', t => {
  const broken = body => (config, write) => write('beta/build.mjs', buildScript({
    'index.html': `<!doctype html><html lang="en"><head><title>Beta</title></head><body>${body}</body></html>`,
  }));
  let r = buildAll(fixture(t, broken('<script src="/app.js"></script>')));
  assert.equal(r.status, 1);
  assert.equal(failures(r).length, 1);
  assert.match(failures(r)[0], /^✗ beta: index\.html: <script src="\/app\.js"> is root-relative/);

  r = buildAll(fixture(t, broken('<img src="./chart.png"><script src="app.js"></script>')));
  assert.equal(r.status, 1);
  assert.deepEqual(failures(r), [
    '✗ beta: index.html: <img src="./chart.png"> names a file the build did not emit',
    '✗ beta: index.html: <script src="app.js"> names a file the build did not emit',
  ]);

  r = buildAll(fixture(t, (config, write) => write('beta/build.mjs', buildScript({ 'report.html': 'x' }))));
  assert.equal(r.status, 1);
  assert.deepEqual(failures(r), ['✗ beta: the build produced no index.html']);

  r = buildAll(fixture(t, (config, write) => write('beta/build.mjs', buildScript({ 'index.html': '<p>no title</p>' }))));
  assert.deepEqual(failures(r), ['✗ beta: index.html has no <title>']);
});

test('a script the build cannot stamp fails the run', t => {
  const root = fixture(t, (config, write) => write('beta/build.mjs', buildScript({
    'index.html': '<!doctype html><title>Beta</title><script src="./app.js?cache=no"></script>',
    'app.js': '1;\n',
  })));
  const r = buildAll(root);
  assert.equal(r.status, 1);
  assert.equal(failures(r).length, 1);
  assert.match(failures(r)[0], /^✗ beta: index\.html loads "\.\/app\.js\?cache=no" without a content stamp/);
});

test('--only builds a subset and says it must not be deployed', t => {
  const root = fixture(t);
  const r = buildAll(root, ['--only', 'beta']);
  assert.equal(r.status, 0, r.all);
  assert.match(r.stdout, /PARTIAL BUILD — skipping alpha\./);
  assert.ok(!fs.existsSync(path.join(root, 'dist/alpha')));
  assert.deepEqual([...read(root, 'dist/index.html').matchAll(/<a class="card" href="([^"]+)"/g)].map(m => m[1]), ['./beta/']);
});

test('--only and --skip are refused when CI is set, and nothing is cleared', t => {
  const root = fixture(t, (config, write) => write('dist/previous.txt', 'the last good build\n'));
  for (const args of [['--only', 'beta'], ['--skip=alpha']]) {
    const r = buildAll(root, args, { CI: 'true' });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /--only\/--skip are for local iteration and cannot be used in CI/);
  }
  assert.equal(read(root, 'dist/previous.txt'), 'the last good build\n');
  assert.equal(buildAll(root, [], { CI: 'true' }).status, 0, 'a full build is what CI runs');
});
