import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/* The real scaffolder and the real build, pointed by SITES_ROOT at a small
   repository made for the test, so this checkout gains no site. */
const NEW_SITE = fileURLToPath(new URL('../new-site.mjs', import.meta.url));
const BUILD_ALL = fileURLToPath(new URL('../build-all.mjs', import.meta.url));

// Everything a shell, a template literal, HTML or a Markdown table could trip on.
const NAME = 'Rain "Log" & `Co` ${x} <b>';
const TAGLINE = 'Days it\'s rained & <more> "quoted" `tick` ${y} */ | pipe';

const README = `# sites

| Site | URL | Source | Cadence |
|---|---|---|---|
| Alpha | [\`/alpha/\`](https://sites.example.com/alpha/) | [\`alpha/\`](alpha/) | Rebuilt daily |

## Layout
`;
// One short row per site.
const CLAUDE_SHORT = `# CLAUDE.md

## Sites

| Slug | Dir | Stack | Notes |
|---|---|---|---|
| \`alpha\` | \`alpha/\` | Node, no deps | The first site. |

## Things that will bite you
`;
// Rows whose last cell runs to a paragraph, with pipes and backticks of its own.
const CLAUDE_LONG = `# CLAUDE.md

## Sites

| Slug | Dir | Stack | Notes |
|---|---|---|---|
| \`alpha\` | \`alpha/\` | Node, no deps | \`src/a.js\` is the algorithm, run at build time only; \`verify.mjs\` gates the deploy. **Never** overwrite graded factors from a script. |
| \`old-site\` | \`old-site/\` | Python, Playwright + Pillow | Scrapes a page (\`MAIN_URL\`). Writes \`report.html\`, promoted to \`index.html\`. |

## Things that will bite you
`;
const PUBLISH = "on:\n  push:\n    branches: [main]\n    paths-ignore:\n      - '**.md'\n";

function fixture(t, claude = CLAUDE_SHORT) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sites-scaffold-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const write = (rel, body) => {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), body);
  };
  write('alpha/build.mjs', `import fs from 'node:fs';
fs.mkdirSync(process.env.OUT_DIR, { recursive: true });
fs.writeFileSync(process.env.OUT_DIR + '/index.html', '<!doctype html><title>Alpha</title><h1>Alpha</h1>');
`);
  write('sites.config.json', JSON.stringify({
    owner: 'someone', title: 'someone / sites', tagline: 'Some sites.',
    baseUrl: 'https://sites.example.com',
    sites: [{ slug: 'alpha', name: 'Alpha', tagline: 'The first site.', dir: 'alpha', build: ['node', 'build.mjs'] }],
  }, null, 2) + '\n');
  write('README.md', README);
  write('CLAUDE.md', claude);
  write('.github/workflows/publish.yml', PUBLISH);
  return root;
}

const env = root => {
  const e = { ...process.env, SITES_ROOT: root };
  for (const name of ['CI', 'GITHUB_ACTIONS', 'OUT_DIR']) delete e[name];
  return e;
};
const node = (root, args, opts = {}) => {
  const r = spawnSync(process.execPath, args, { encoding: 'utf8', env: env(root), ...opts });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, all: r.stdout + r.stderr };
};
const read = (root, rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const tree = root => fs.readdirSync(root, { recursive: true }).sort();

test('an awkward name scaffolds a site that parses, builds, verifies and renders', t => {
  const root = fixture(t);
  const r = node(root, [NEW_SITE, 'rain-log', NAME, TAGLINE, '🌧️', '--accent=#5b8dd6', '--cadence=Rebuilt | daily']);
  assert.equal(r.status, 0, r.all);
  assert.match(r.stdout, /Registered in three files:\n  \+ sites\.config\.json\n  \+ README\.md\n  \+ CLAUDE\.md\n/);

  for (const f of ['scripts/build.mjs', 'scripts/verify.mjs']) {
    const check = node(root, ['--check', path.join(root, 'rain-log', f)]);
    assert.equal(check.status, 0, `${f} does not parse: ${check.stderr}`);
  }
  // Neither typed value is in the generated source: both are read from data.json.
  assert.ok(!read(root, 'rain-log/scripts/build.mjs').includes('Rain'));
  assert.deepEqual(JSON.parse(read(root, 'rain-log/data/data.json')), { title: NAME, eyebrow: 'rain-log', tagline: TAGLINE });

  const entry = JSON.parse(read(root, 'sites.config.json')).sites[1];
  assert.deepEqual(entry, {
    slug: 'rain-log', name: NAME, emoji: '🌧️', tagline: TAGLINE, dir: 'rain-log',
    build: ['node', 'scripts/build.mjs'], verify: ['node', 'scripts/verify.mjs'],
    cadence: 'Rebuilt | daily', accent: '#5b8dd6',
  });

  const built = node(root, [BUILD_ALL]);
  assert.equal(built.status, 0, built.all);
  assert.match(built.stdout, /Build verified\./);
  const page = read(root, 'dist/rain-log/index.html');
  assert.ok(page.includes('<h1>Rain &quot;Log&quot; &amp; `Co` ${x} &lt;b&gt;</h1>'), page);
  assert.ok(page.includes('<a href="../">all sites</a>'));
  assert.equal((page.match(/<meta name="theme-color"/g) || []).length, 2);
  assert.ok(page.includes('--ink-3:#75624f'));
  assert.ok(page.includes(`font-size='90'>${encodeURIComponent('🌧️')}</text>`));
  assert.ok(read(root, 'dist/index.html').includes('<h2>Rain &quot;Log&quot; &amp; `Co` ${x} &lt;b&gt;</h2>'));
});

test('the two doc tables gain a row and the workflow is left alone', t => {
  const root = fixture(t);
  node(root, [NEW_SITE, 'rain-log', NAME, TAGLINE, '🌧️', '--cadence=Rebuilt | daily']);

  assert.equal(read(root, 'README.md'), README.replace('| Rebuilt daily |\n',
    '| Rebuilt daily |\n'
    + '| Rain "Log" & `Co` ${x} <b> | [`/rain-log/`](https://sites.example.com/rain-log/) | [`rain-log/`](rain-log/) | Rebuilt \\| daily |\n'));
  assert.equal(read(root, 'CLAUDE.md'), CLAUDE_SHORT.replace('| The first site. |\n',
    '| The first site. |\n'
    + '| `rain-log` | `rain-log/` | Node, no deps | Days it\'s rained & <more> "quoted" `tick` ${y} */ \\| pipe |\n'));
  assert.equal(read(root, '.github/workflows/publish.yml'), PUBLISH);

  const readme = read(root, 'rain-log/README.md');
  assert.ok(readme.startsWith(`# ${NAME}\n\n${TAGLINE}\n`));
  assert.ok(readme.includes('https://sites.example.com/rain-log/'));
  assert.ok(readme.includes('node rain-log/scripts/build.mjs               # writes dist/rain-log/'));
});

test('the CLAUDE.md row lands after the last one when the notes run long', t => {
  const root = fixture(t, CLAUDE_LONG);
  const r = node(root, [NEW_SITE, 'tide-table', 'Tide Table', 'High and low tides for Elliott Bay.']);
  assert.equal(r.status, 0, r.all);
  assert.equal(read(root, 'CLAUDE.md'), CLAUDE_LONG.replace('promoted to `index.html`. |\n',
    'promoted to `index.html`. |\n'
    + '| `tide-table` | `tide-table/` | Node, no deps | High and low tides for Elliott Bay. |\n'));
});

test('a table that has drifted is reported, and the scaffold still completes', t => {
  const root = fixture(t, '# CLAUDE.md\n\nNo table here.\n');
  fs.writeFileSync(path.join(root, 'README.md'), '# sites\n');
  const r = node(root, [NEW_SITE, 'tide-table', 'Tide Table', 'High and low tides.']);
  assert.equal(r.status, 0, r.all);
  assert.match(r.stdout, /  ! README\.md: add a row for tide-table to the site table\n  ! CLAUDE\.md: add a row for tide-table to the Sites table\n/);
  assert.equal(node(root, [BUILD_ALL, '--only', 'tide-table']).status, 0);
});

test('a standalone build writes dist/<slug>/ and will not clear a directory that is not a build', t => {
  const root = fixture(t);
  node(root, [NEW_SITE, 'tide-table', 'Tide Table', 'High and low tides.']);
  const site = path.join(root, 'tide-table');
  const source = tree(site);

  let r = node(root, ['scripts/build.mjs'], { cwd: site });
  assert.equal(r.status, 0, r.all);
  assert.deepEqual(tree(path.join(root, 'dist')), ['tide-table', 'tide-table/index.html']);
  assert.equal(node(root, ['scripts/verify.mjs'], { cwd: site }).status, 0);
  // A second run replaces the first: a previous build is fair to clear.
  assert.equal(node(root, ['scripts/build.mjs'], { cwd: site }).status, 0);

  for (const target of ['.', '..', path.join(root, 'alpha')]) {
    r = spawnSync(process.execPath, ['scripts/build.mjs'], { cwd: site, encoding: 'utf8', env: { ...env(root), OUT_DIR: target } });
    assert.equal(r.status, 1, `OUT_DIR=${target}`);
    assert.match(r.stderr, /^refusing to clear .*: it is not an empty directory or a previous build$/m);
  }
  assert.deepEqual(tree(site), source);
  assert.ok(fs.existsSync(path.join(root, 'alpha/build.mjs')));
  assert.ok(fs.existsSync(path.join(root, 'sites.config.json')));
});

test('the generated verifier reads visible text, and says where a leak is', t => {
  const root = fixture(t);
  node(root, [NEW_SITE, 'tide-table', 'Tide Table', 'High and low tides.']);
  const site = path.join(root, 'tide-table');
  const out = path.join(root, 'dist/tide-table');
  const verify = () => spawnSync(process.execPath, ['scripts/verify.mjs'], { cwd: site, encoding: 'utf8', env: env(root) });
  const withBody = extra => {
    node(root, ['scripts/build.mjs'], { cwd: site });
    const p = path.join(out, 'index.html');
    fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace('</body>', extra + '</body>'));
  };

  // The same letters inside a URL or an inline script mean nothing.
  withBody('<a href="https://news.example.com/articles/NaN/undefined/">story</a>'
    + '<script type="application/json">{"note":"undefined","n":"NaN"}</script>');
  assert.equal(verify().status, 0);

  withBody('<p>High tide at undefined feet</p>');
  let r = verify();
  assert.equal(r.status, 1);
  assert.match(r.stderr, /✗ page shows "undefined" near: .*High tide at undefined feet/);

  withBody('<p>Height: NaN m</p>');
  assert.match(verify().stderr, /✗ page shows "NaN" near: .*Height: NaN m/);

  withBody('<img alt="undefined" src="data:,">');
  r = verify();
  assert.equal(r.status, 1);
  assert.match(r.stderr, /✗ an attribute is literally undefined\/null\/NaN/);
});

test('bad arguments are refused before anything is written', t => {
  const root = fixture(t);
  const before = tree(root);
  const config = read(root, 'sites.config.json');
  for (const args of [
    ['../docs', 'Name', 'Tagline'],
    ['Has Space', 'Name', 'Tagline'],
    ['alpha', 'Name', 'Tagline'],
    ['fine', 'Name'],
    ['fine', '   ', 'Tagline'],
    ['fine', 'Name', 'Tagline', '--accent=red'],
  ]) {
    const r = node(root, [NEW_SITE, ...args]);
    assert.equal(r.status, 1, JSON.stringify(args));
  }
  assert.deepEqual(tree(root), before);
  assert.equal(read(root, 'sites.config.json'), config);
});
