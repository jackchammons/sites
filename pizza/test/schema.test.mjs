import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ENTRY_SCHEMA, ENTRY_KEYS, LOCATION_SHAPE, FACTOR_NAMES, FACTOR_SHAPE, MENTION_SHAPE, REFUSED_KEYS,
  FACT_FIELDS, FACT_SOURCE_KEY, missingFacts, normalizeEntry, normalizeDataset, serializeDataset } from '../src/schema.js';
import { checkDataset, MISSING_KEYS } from '../src/check-dataset.js';

const pizzaDir = fileURLToPath(new URL('../', import.meta.url));
const real = () => JSON.parse(fs.readFileSync(path.join(pizzaDir, 'data/restaurants.json'), 'utf8'));
const registry = JSON.parse(fs.readFileSync(path.join(pizzaDir, 'data/attributes.json'), 'utf8'));

/* ---- the schema itself ---- */
test('schema: every key once, a known kind, and an empty value that is null, [] or {}', () => {
  assert.equal(new Set(ENTRY_KEYS).size, ENTRY_KEYS.length);
  const kinds = new Set(['identity', 'fact', 'link', 'status', 'location', 'rating', 'coverage', 'stamp']);
  for (const s of ENTRY_SCHEMA) {
    assert.ok(kinds.has(s.kind), `${s.key}: kind ${s.kind}`);
    assert.equal(typeof s.by, 'string', s.key);
    if (s.empty !== undefined) {
      assert.ok(['null', '[]', '{}'].includes(JSON.stringify(s.empty)), `${s.key}: empty ${JSON.stringify(s.empty)}`);
    }
  }
  // the three keys an entry cannot be without have no empty value
  assert.deepEqual(ENTRY_SCHEMA.filter(s => s.empty === undefined).map(s => s.key), ['id', 'name', 'status']);
  assert.deepEqual(ENTRY_KEYS.slice(0, 2), ['id', 'name']);
});

test('schema: each fact the facts task fills has a key for the page that states it', () => {
  assert.deepEqual(FACT_FIELDS, ['opened', 'priceIndex', 'style', 'styleGroup', 'signature']);
  for (const k of FACT_FIELDS) {
    assert.ok(ENTRY_KEYS.includes(k), k);
    assert.ok(ENTRY_KEYS.includes(FACT_SOURCE_KEY[k]), FACT_SOURCE_KEY[k]);
    // the source sits directly after its fact, so a diff shows them together
    assert.equal(ENTRY_KEYS.indexOf(FACT_SOURCE_KEY[k]), ENTRY_KEYS.indexOf(k) + 1);
  }
  assert.deepEqual(FACTOR_NAMES, ['craft', 'distinctiveness', 'critical']);
  assert.deepEqual(LOCATION_SHAPE.map(s => s.key), ['neighborhood', 'address', 'lat', 'lon']);
  assert.deepEqual(MENTION_SHAPE.map(s => s.key), ['url', 'title', 'source', 'date', 'kind']);
  assert.deepEqual(FACTOR_SHAPE.filter(s => !s.optional).map(s => s.key), ['value', 'setBy', 'source', 'date']);
});

test('missingFacts: the facts an entry lacks, null, absent or blank', () => {
  assert.deepEqual(missingFacts({}), FACT_FIELDS);
  assert.deepEqual(missingFacts({ opened: 2009, priceIndex: null, style: '', styleGroup: 'Roman' }), ['priceIndex', 'style', 'signature']);
  assert.deepEqual(missingFacts({ opened: 2009, priceIndex: 2, style: 'Roman al taglio', styleGroup: 'Roman', signature: 'The potato slice' }), []);
});

/* ---- normalizeEntry ---- */
const sparse = () => ({
  mentions: [{ kind: 'mention', date: '2026-08-01', url: 'https://x.com/a', title: 'A review', source: 'Seattle Met' }],
  status: 'open',
  factors: {
    critical: { date: '2026-08-01', value: 8, note: 'well reviewed', setBy: 'agent', source: 'https://x.com/a', sourcedDate: '2026-09-01' },
    craft: { value: 8, setBy: 'agent', source: 'https://x.com/a', date: '2026-08-01' },
    distinctiveness: { value: 7, setBy: 'agent', source: 'https://x.com/a', date: '2026-08-01', sources: ['https://x.com/a'] }
  },
  name: 'Good Pie',
  locations: [{ lon: -122.3, address: '1 Main St, Seattle, WA 98117', neighborhood: 'Ballard', lat: 47.6 },
              { address: '2 Main St, Seattle, WA 98117', neighborhood: 'Ballard' }],
  id: 'good-pie',
  opened: 2015
});

test('normalizeEntry: every schema key, in schema order, with the empty value where there was none', () => {
  const out = normalizeEntry(sparse());
  assert.deepEqual(Object.keys(out), ENTRY_KEYS);
  for (const { key, empty } of ENTRY_SCHEMA) {
    if (Object.hasOwn(sparse(), key)) assert.deepEqual(out[key], sparse()[key], key);
    else assert.deepEqual(out[key], empty, key);
  }
  // nothing is filled in beyond the empty value
  assert.equal(out.signature, null);
  assert.deepEqual([out.attributes, out.factsSought], [{}, []]);
});

test('normalizeEntry: a location, a factor and a mention have their keys put in order, and gain none', () => {
  const out = normalizeEntry(sparse());
  assert.deepEqual(out.locations.map(l => Object.keys(l)), [['neighborhood', 'address', 'lat', 'lon'], ['neighborhood', 'address']]);
  assert.deepEqual(Object.keys(out.factors), ['craft', 'distinctiveness', 'critical']);
  assert.deepEqual(Object.keys(out.factors.critical), ['value', 'setBy', 'source', 'note', 'date', 'sourcedDate']);
  assert.deepEqual(Object.keys(out.factors.distinctiveness), ['value', 'setBy', 'source', 'sources', 'date']);
  assert.deepEqual(Object.keys(out.mentions[0]), ['url', 'title', 'source', 'date', 'kind']);
  // a location with no coordinates is what the geocoder looks for, so none is written
  assert.ok(!('lat' in out.locations[1]));
});

test('normalizeEntry: pure, idempotent, and each entry gets its own empty list and object', () => {
  const given = sparse();
  const before = JSON.stringify(given);
  const once = normalizeEntry(given);
  assert.equal(JSON.stringify(given), before);
  assert.equal(JSON.stringify(normalizeEntry(once)), JSON.stringify(once));
  const other = normalizeEntry(sparse());
  assert.notEqual(once.factsSought, other.factsSought);
  assert.notEqual(once.attributes, other.attributes);
});

test('normalizeEntry: nothing is invented and nothing is dropped except a key the dataset refuses', () => {
  // an identity key that is absent stays absent, for the lint to report
  const noStatus = normalizeEntry({ id: 'x', name: 'X' });
  assert.ok(!('status' in noStatus));
  assert.ok(checkDataset({ city: 'Seattle', dataVersion: '2026.11', restaurants: [noStatus] }, {}).some(f => f.includes('status must be')));
  // a key the schema does not name is kept, after the schema's own, and the lint names it
  const odd = normalizeEntry({ ...sparse(), signatureDish: 'The Brooklyn', criticScore: 8 });
  assert.deepEqual(Object.keys(odd), [...ENTRY_KEYS, 'signatureDish', 'criticScore']);
  assert.equal(odd.signatureDish, 'The Brooklyn');
  // crowd figures are the one thing dropped: the dataset does not hold them
  assert.deepEqual(REFUSED_KEYS, ['crowd']);
  assert.ok(!('crowd' in normalizeEntry({ ...sparse(), crowd: { rating: 4.5, reviews: 1200 } })));
  // a value of the wrong kind is left for the lint, not repaired
  assert.equal(normalizeEntry({ ...sparse(), locations: null }).locations, null);
});

/* ---- the real dataset: read, never written ---- */
test('real data: normalising changes no value, only adds empty keys and reorders', () => {
  const before = real();
  const after = normalizeDataset(real());
  assert.deepEqual(Object.keys(after), Object.keys(before));
  assert.equal(after.restaurants.length, before.restaurants.length);
  before.restaurants.forEach((was, i) => {
    const now = after.restaurants[i];
    assert.deepEqual(Object.keys(now), ENTRY_KEYS, was.id);
    for (const key of Object.keys(was)) {
      assert.ok(Object.hasOwn(now, key), `${was.id}: ${key} was dropped`);
      // deepEqual ignores the order of keys, which is the one thing allowed to change
      assert.deepEqual(now[key], was[key], `${was.id}.${key}`);
    }
    for (const { key, empty } of ENTRY_SCHEMA) {
      if (!Object.hasOwn(was, key)) assert.deepEqual(now[key], empty, `${was.id}.${key}`);
    }
    // inside a location, a factor and a mention nothing is added at all
    const inner = e => [...(e.locations ?? []), ...(e.mentions ?? []), ...Object.values(e.factors ?? {})];
    assert.deepEqual(inner(now).map(o => Object.keys(o).sort()), inner(was).map(o => Object.keys(o).sort()), was.id);
  });
});

test('real data: normalising is idempotent, and the result has the shape the lint asks for', () => {
  const once = normalizeDataset(real());
  assert.equal(serializeDataset(normalizeDataset(once)), serializeDataset(once));
  const shape = checkDataset(once, registry).filter(f => f.includes(MISSING_KEYS) || f.includes('is not a key of the schema')
    || f.includes('must be a list') || f.includes('must be an object'));
  assert.deepEqual(shape, []);
});

/* ---- the lint CLI and its --normalize flag, in a scratch copy ---- */
function scratch(dataset) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-dataset-'));
  for (const d of ['scripts', 'data']) fs.mkdirSync(path.join(dir, d));
  fs.copyFileSync(path.join(pizzaDir, 'scripts/check-dataset.mjs'), path.join(dir, 'scripts/check-dataset.mjs'));
  fs.mkdirSync(path.join(dir, 'src'));
  for (const f of ['check-dataset.js', 'schema.js', 'bounds.js']) fs.copyFileSync(path.join(pizzaDir, 'src', f), path.join(dir, 'src', f));
  fs.writeFileSync(path.join(dir, 'data/attributes.json'), JSON.stringify(registry));
  const file = path.join(dir, 'data/restaurants.json');
  fs.writeFileSync(file, typeof dataset === 'string' ? dataset : JSON.stringify(dataset, null, 2) + '\n');
  return {
    read: () => fs.readFileSync(file, 'utf8'),
    run: (...args) => spawnSync(process.execPath, [path.join(dir, 'scripts/check-dataset.mjs'), ...args], { encoding: 'utf8' }),
    done: () => fs.rmSync(dir, { recursive: true, force: true })
  };
}
const header = { city: 'Seattle, WA', dataVersion: '2026.11' };

test('CLI: without the flag the file is linted and never written', () => {
  const s = scratch({ ...header, restaurants: [sparse()] });
  try {
    const before = s.read();
    const res = s.run();
    assert.equal(res.status, 1);
    assert.match(res.stderr, /restaurants\.json FAILED lint \(1 problem\(s\)\)/);
    assert.match(res.stderr, /good-pie: missing schema keys: neighborhood, /);
    assert.match(res.stderr, /put right by: node pizza\/scripts\/check-dataset\.mjs --normalize/);
    assert.equal(s.read(), before);
  } finally { s.done(); }
});

test('CLI: --normalize rewrites the file in the schema\'s shape, says how many entries changed, and lints the result', () => {
  const tidy = normalizeEntry({ ...sparse(), id: 'tidy-pie', name: 'Tidy Pie' });
  const s = scratch({ ...header, restaurants: [sparse(), tidy] });
  try {
    const res = s.run('--normalize');
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /restaurants\.json normalised: 1 of 2 entries changed\.\n/);
    assert.match(res.stdout, /restaurants\.json clean: 2 entries\./);
    // exactly the bytes the apply step writes
    assert.equal(s.read(), serializeDataset({ ...header, restaurants: [normalizeEntry(sparse()), tidy] }));

    // a second run finds nothing to do and leaves the file alone
    const before = s.read();
    const again = s.run('--normalize');
    assert.equal(again.status, 0);
    assert.match(again.stdout, /normalised: 0 of 2 entries changed, file left as it was\./);
    assert.equal(s.read(), before);
    // and the plain lint passes on it
    assert.equal(s.run().status, 0);
  } finally { s.done(); }
});

test('CLI: --normalize repairs the shape and still fails on what it cannot repair', () => {
  const s = scratch({ ...header, restaurants: [{ ...sparse(), url: 'http://goodpie.com', signatureDish: 'The Brooklyn' }] });
  try {
    const res = s.run('--normalize');
    assert.equal(res.status, 1);
    assert.match(res.stdout, /normalised: 1 of 1 entries changed\./);
    assert.match(res.stderr, /url must be https/);
    assert.match(res.stderr, /"signatureDish" is not a key of the schema/);
    assert.doesNotMatch(res.stderr, /missing schema keys/);
    assert.equal(JSON.parse(s.read()).restaurants[0].signatureDish, 'The Brooklyn');
  } finally { s.done(); }
});

test('CLI: any other argument is refused and nothing is written', () => {
  const s = scratch({ ...header, restaurants: [sparse()] });
  try {
    const before = s.read();
    const res = s.run('--normalise');
    assert.equal(res.status, 2);
    assert.match(res.stderr, /unrecognised argument "--normalise" \(the only option is --normalize\)/);
    assert.equal(s.read(), before);
  } finally { s.done(); }
});
