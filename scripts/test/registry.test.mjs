import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { validateRegistry, SLUG } from '../lib/registry.mjs';

/* A repository with two site directories and a registry that passes. Each
   case changes one thing about it. */
function repo(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sites-registry-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'alpha'));
  fs.mkdirSync(path.join(root, 'beta'));
  fs.mkdirSync(path.join(root, 'dist', 'alpha'), { recursive: true });
  fs.writeFileSync(path.join(root, 'notes.txt'), 'a file, not a directory');
  const site = slug => ({
    slug, name: `Site ${slug}`, tagline: `What ${slug} is.`, dir: slug,
    build: ['node', 'scripts/build.mjs'], verify: ['node', 'scripts/verify.mjs'],
    emoji: '📄', cadence: 'Rebuilt daily', accent: '#e14434',
  });
  const config = {
    owner: 'someone', title: 'someone / sites', tagline: 'Some sites.',
    baseUrl: 'https://sites.example.com', customDomain: 'sites.example.com',
    sites: [site('alpha'), site('beta')],
  };
  return { root, config };
}

// The problems after one change to the second entry.
const withSite = (t, change) => {
  const { root, config } = repo(t);
  change(config.sites[1], config);
  return validateRegistry(config, root);
};

test('a well-formed registry has no problems', t => {
  const { root, config } = repo(t);
  assert.deepEqual(validateRegistry(config, root), []);
});

test('optional fields may be left out', t => {
  assert.deepEqual(withSite(t, s => {
    delete s.verify; delete s.emoji; delete s.cadence; delete s.accent;
  }), []);
  assert.deepEqual(withSite(t, (s, c) => { delete c.customDomain; }), []);
});

test('a duplicate slug names both entries', t => {
  const problems = withSite(t, s => { s.slug = 'alpha'; });
  assert.deepEqual(problems, ['sites[1] "alpha": slug is already used by sites[0]']);
});

test('a slug that is a path is refused', t => {
  for (const slug of ['../docs', 'a/b', '.', '..', '', 'My Site', 'UPPER', '-lead', 'under_score', 'dot.ted']) {
    const problems = withSite(t, s => { s.slug = slug; });
    assert.equal(problems.length, 1, `slug ${JSON.stringify(slug)}`);
    assert.match(problems[0], /^sites\[1\] ".*": slug must be lowercase letters, digits and hyphens/);
  }
  for (const slug of [undefined, 7, null, ['x']]) {
    const problems = withSite(t, s => { s.slug = slug; });
    assert.match(problems[0], /^sites\[1\]: slug must be/);
  }
});

test('slugs the scaffolder accepts pass', () => {
  for (const slug of ['a', 'rain-log', '2048', 'x-1-y']) assert.ok(SLUG.test(slug), slug);
});

test('dir must be an existing directory inside the repository', t => {
  const one = dir => withSite(t, s => { s.dir = dir; });
  assert.deepEqual(one('no-such-dir'), ['sites[1] "beta": dir "no-such-dir" is not a directory in the repository']);
  assert.deepEqual(one('notes.txt'), ['sites[1] "beta": dir "notes.txt" is not a directory in the repository']);
  assert.deepEqual(one('.'), ['sites[1] "beta": dir must be a site directory, not the repository root']);
  assert.deepEqual(one('beta/..'), ['sites[1] "beta": dir must be a site directory, not the repository root']);
  assert.deepEqual(one('..'), ['sites[1] "beta": dir ".." is outside the repository']);
  assert.deepEqual(one('../elsewhere'), ['sites[1] "beta": dir "../elsewhere" is outside the repository']);
  assert.deepEqual(one(os.tmpdir()), [`sites[1] "beta": dir "${os.tmpdir()}" is outside the repository`]);
  assert.deepEqual(one('dist'), ['sites[1] "beta": dir "dist" is inside dist/, which every build clears']);
  assert.deepEqual(one('dist/alpha'), ['sites[1] "beta": dir "dist/alpha" is inside dist/, which every build clears']);
  assert.match(one(undefined)[0], /dir must be a non-empty string/);
  // A sibling that merely starts with the same letters is a different directory.
  assert.deepEqual(one('./beta/'), []);
});

test('build and verify must be non-empty arrays of strings', t => {
  for (const build of [undefined, 'node scripts/build.mjs', [], ['node', 3], ['']]) {
    const problems = withSite(t, s => { s.build = build; });
    assert.equal(problems.length, 1, JSON.stringify(build));
    assert.match(problems[0], /^sites\[1\] "beta": build must be a non-empty array of strings/);
  }
  for (const verify of ['node scripts/verify.mjs', [], [null]]) {
    const problems = withSite(t, s => { s.verify = verify; });
    assert.deepEqual(problems, ['sites[1] "beta": verify must be a non-empty array of strings when set']);
  }
});

test('name and tagline must be non-empty strings', t => {
  for (const field of ['name', 'tagline']) {
    for (const value of [undefined, '', '   ', 5]) {
      const problems = withSite(t, s => { s[field] = value; });
      assert.deepEqual(problems, [`sites[1] "beta": ${field} must be a non-empty string`]);
    }
  }
});

test('accent must be #rrggbb when set', t => {
  for (const accent of ['red', '#fff', '#12345g', 'red;background:url(x)', 0x123456]) {
    assert.deepEqual(withSite(t, s => { s.accent = accent; }),
      ['sites[1] "beta": accent must be a #rrggbb colour']);
  }
  assert.deepEqual(withSite(t, s => { s.accent = '#AbCdEf'; }), []);
});

test('every problem in an entry is reported, one line each', t => {
  const problems = withSite(t, s => {
    s.slug = '../docs'; delete s.name; s.build = 'make'; s.dir = 'gone'; s.accent = 'blue';
  });
  assert.equal(problems.length, 5);
  for (const p of problems) {
    assert.ok(!p.includes('\n'), p);
    assert.ok(p.startsWith('sites[1] "../docs": '), p);
  }
});

test('the registry itself must have the fields the landing page is rendered from', t => {
  const { root, config } = repo(t);
  assert.deepEqual(validateRegistry(null, root), ['the registry must be a JSON object']);
  assert.deepEqual(validateRegistry([], root), ['the registry must be a JSON object']);
  assert.deepEqual(validateRegistry({ ...config, sites: [] }, root), ['sites must be a non-empty array']);
  assert.deepEqual(validateRegistry({ ...config, sites: [null] }, root), ['sites[0] must be an object']);
  assert.deepEqual(validateRegistry({ ...config, title: undefined }, root), ['title must be a non-empty string']);
  assert.deepEqual(validateRegistry({ ...config, baseUrl: 'sites.example.com' }, root),
    ['baseUrl must be an absolute http(s) URL']);
  assert.deepEqual(validateRegistry({ ...config, customDomain: 'https://sites.example.com/' }, root),
    ['customDomain must be a bare host name']);
});

test('validating changes nothing on disk', t => {
  const { root, config } = repo(t);
  const before = fs.readdirSync(root, { recursive: true }).sort();
  config.sites[0].slug = '../notes.txt';
  config.sites[1].dir = 'dist';
  validateRegistry(config, root);
  assert.deepEqual(fs.readdirSync(root, { recursive: true }).sort(), before);
});
