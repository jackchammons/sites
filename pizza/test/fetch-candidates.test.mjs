import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { kingCountyCandidates, overpassCandidates, parseArgs, seedAgeDays, nextSeed, INSPECTION_CUTOFF_MONTHS,
  KING_COUNTY_WHERE, kingCountyUrl } from '../scripts/fetch-candidates.mjs';
import { mergeCandidates } from '../src/census.js';

const script = fileURLToPath(new URL('../scripts/fetch-candidates.mjs', import.meta.url));
const srcDir = fileURLToPath(new URL('../src/', import.meta.url));
const NOW = Date.parse('2026-11-10T12:00:00Z');
const NOW_ISO = '2026-11-10T12:00:00.000Z';

const row = over => ({ business_id: 'PR-1', name: 'BELLTOWN PIZZA', address: '2422 1ST AVE', city: 'SEATTLE',
  zip_code: '98121', inspection_date: '2026-10-05T00:00:00.000', inspection_closed_business: 'No', ...over });

/* ---- reading the permit register ---- */
test('king county: one candidate per business, from its latest inspection', () => {
  const out = kingCountyCandidates([
    row({}), row({ inspection_date: '2025-04-01T00:00:00.000' }),
    row({ business_id: 'PR-2', name: '#807 TUTTA BELLA LLC', address: '2746 NE 45TH ST', zip_code: '98105' })
  ], NOW);
  assert.deepEqual(out, [
    { name: 'Belltown Pizza', address: '2422 1st Ave, Seattle, WA 98121', sources: ['kc-health'], lastInspection: '2026-10-05' },
    { name: 'Tutta Bella LLC', address: '2746 Ne 45th St, Seattle, WA 98105', sources: ['kc-health'], lastInspection: '2026-10-05' }
  ]);
});

test('king county: a lapsed permit, a closed business and a row with no address are dropped', () => {
  const lapsed = new Date(NOW - (INSPECTION_CUTOFF_MONTHS * 30 + 1) * 864e5).toISOString();
  assert.deepEqual(kingCountyCandidates([
    row({ business_id: 'PR-3', inspection_date: lapsed }),
    row({ business_id: 'PR-4', inspection_closed_business: 'Yes' }),
    row({ business_id: 'PR-5', address: undefined }),
    row({ business_id: 'PR-6', name: '' })
  ], NOW), []);
});

test('king county: Seattle in every spelling the register uses is kept, and a longer city name is not', () => {
  const spelt = ['SEATTLE', 'Seattle', 'seattle', 'Seattle,', 'WEST SEATTLE', 'West Seattle', ' Seattle ', 'SEATTLE.'];
  const out = kingCountyCandidates(spelt.map((city, i) =>
    row({ business_id: `PR-${i}`, name: `PIZZA NUMBER ${i}`, address: `${i + 1} PINE ST`, city })), NOW);
  assert.deepEqual(out.map(c => c.address), spelt.map((_, i) => `${i + 1} Pine St, Seattle, WA 98121`));

  const elsewhere = ['Seattle tacoma', 'SEATTLE TACOMA', 'SeaTac', 'Seattle Heights', 'North Seattle Park',
    'East Seattle', 'BELLEVUE', '', undefined];
  assert.deepEqual(kingCountyCandidates(elsewhere.map((city, i) =>
    row({ business_id: `PR-${i}`, name: `PIZZA NUMBER ${i}`, city })), NOW), []);
});

test('king county: the request compares the city in upper case, never by a case-sensitive equality', () => {
  // SoQL's `=` is case-sensitive, so `city = 'SEATTLE'` cannot see a permit
  // filed as "Seattle", and about a quarter of the city's are.
  assert.equal(KING_COUNTY_WHERE,
    "upper(city) like '%SEATTLE%' AND (upper(name) like '%PIZZ%' OR upper(name) like '%SLICE%')");
  assert.doesNotMatch(KING_COUNTY_WHERE, /(^|[^(\w])city\s*(=|in\b|like\b)/i);
  const url = new URL(kingCountyUrl());
  assert.equal(url.origin + url.pathname, 'https://data.kingcounty.gov/resource/r878-4sxa.json');
  assert.equal(url.searchParams.get('$where'), KING_COUNTY_WHERE);
  assert.match(url.searchParams.get('$select'), /\bcity\b/);
  assert.equal(url.searchParams.get('$order'), 'inspection_date DESC');
});

test('king county: an answer that is not a list of rows is an error, not an empty register', () => {
  assert.throws(() => kingCountyCandidates({ error: true, message: 'Unrecognized arguments' }, NOW), /not a list of rows/);
  assert.throws(() => kingCountyCandidates(null, NOW), /not a list of rows/);
  assert.deepEqual(kingCountyCandidates([], NOW), []);
});

test('overpass: named elements become candidates, with an address only when both parts are tagged', () => {
  const out = overpassCandidates({ elements: [
    { type: 'node', lat: 47.61, lon: -122.33, tags: { name: 'Corner Slice', 'addr:housenumber': '500', 'addr:street': 'Pine St',
      'addr:postcode': '98101', website: 'https://cornerslice.example' } },
    { type: 'way', center: { lat: 47.66, lon: -122.31 }, tags: { name: 'No Address Pie', 'addr:street': 'Roosevelt Way NE' } },
    { type: 'node', lat: 47.6, lon: -122.3, tags: { cuisine: 'pizza' } }
  ] });
  assert.deepEqual(out, [
    { name: 'Corner Slice', address: '500 Pine St, Seattle, WA 98101', lat: 47.61, lon: -122.33, sources: ['osm'],
      website: 'https://cornerslice.example' },
    { name: 'No Address Pie', lat: 47.66, lon: -122.31, sources: ['osm'] }
  ]);
  assert.deepEqual(overpassCandidates({}), []);
  assert.deepEqual(overpassCandidates({ remark: 'runtime error: Query timed out', elements: [] }), []);
});

/* ---- the option and the two stamps ---- */
test('--max-age-days is the only option, and a value that is not a number of days is refused', () => {
  assert.deepEqual(parseArgs([]), { maxAgeDays: null });
  assert.deepEqual(parseArgs(['--max-age-days=30']), { maxAgeDays: 30 });
  assert.deepEqual(parseArgs(['--max-age-days=0']), { maxAgeDays: 0 });
  assert.deepEqual(parseArgs(['--max-age-days=0.5']), { maxAgeDays: 0.5 });
  for (const bad of ['--max-age-days', '--max-age-days=', '--max-age-days=soon', '--max-age-days=-3', '--max-age=30', 'census']) {
    assert.throws(() => parseArgs([bad]), /unrecognised argument/, bad);
  }
});

test('the age of the seed is read from `checked`, and from `updated` where there is none', () => {
  assert.equal(seedAgeDays({ updated: '2026-08-30T12:00:00Z', checked: '2026-11-09T12:00:00Z' }, NOW), 1);
  assert.equal(seedAgeDays({ updated: '2026-10-11T12:00:00Z' }, NOW), 30);
  for (const never of [{}, null, { updated: 'last month' }, { candidates: [] }]) {
    assert.equal(seedAgeDays(never, NOW), Infinity);
  }
});

const stored = () => ({ updated: '2026-08-30T23:47:42.261Z', cutoffMonths: 30, candidates: [
  { key: 'belltown|2422', name: 'Belltown Pizza', address: '2422 1st Ave, Seattle, WA 98121', sources: ['kc-health'],
    lastInspection: '2026-10-05', status: 'rejected', verdict: 'not-pizza', note: 'a bar' },
  { key: 'tutta bella|2746', name: 'Tutta Bella LLC', address: '2746 Ne 45th St, Seattle, WA 98105', sources: ['kc-health'],
    lastInspection: '2026-10-05', status: 'promoted', matchedId: 'tutta-bella' }
] });
const restaurants = [{ id: 'tutta-bella', name: 'Tutta Bella' }];
const sameRows = () => stored().candidates.map(({ name, address, lastInspection }) =>
  ({ name, address, sources: ['kc-health'], lastInspection }));

test('a refresh that finds nothing new keeps the list byte for byte and stamps only `checked`', () => {
  const prior = stored();
  // The stored list is out of the merge's sort order, as it is after the
  // apply step has resolved a candidate in place.
  const merged = mergeCandidates(prior.candidates, sameRows(), restaurants);
  assert.notEqual(JSON.stringify(merged), JSON.stringify(prior.candidates));
  const next = nextSeed(prior, merged, NOW_ISO, true);
  assert.equal(next.changed, false);
  assert.equal(next.write, true);
  assert.equal(JSON.stringify(next.file.candidates), JSON.stringify(stored().candidates));
  assert.deepEqual([next.file.updated, next.file.checked], ['2026-08-30T23:47:42.261Z', NOW_ISO]);
  assert.deepEqual(Object.keys(next.file), ['updated', 'checked', 'cutoffMonths', 'candidates']);
  // A second refresh inside the window then has nothing to ask for.
  assert.ok(seedAgeDays(next.file, NOW + 864e5) < 30);
});

test('a refresh that changes a candidate rewrites the list and moves both stamps', () => {
  const prior = stored();
  const incoming = [...sameRows(), { name: 'Pizza Rasoi', address: '1011 Valley St, Seattle, WA 98109',
    sources: ['kc-health'], lastInspection: '2026-10-05' }];
  const next = nextSeed(prior, mergeCandidates(prior.candidates, incoming, restaurants), NOW_ISO, true);
  assert.deepEqual([next.changed, next.write, next.file.updated, next.file.checked], [true, true, NOW_ISO, NOW_ISO]);
  assert.deepEqual(next.file.candidates.map(c => [c.name, c.status]),
    [['Pizza Rasoi', 'pending'], ['Tutta Bella LLC', 'promoted'], ['Belltown Pizza', 'rejected']]);

  // A newer inspection of a candidate already stored is a change too.
  const reinspected = sameRows().map(r => ({ ...r, lastInspection: '2026-11-02' }));
  assert.equal(nextSeed(prior, mergeCandidates(prior.candidates, reinspected, restaurants), NOW_ISO, true).changed, true);
});

test('with the permit register down, nothing is stamped: an unchanged list is not written at all', () => {
  const prior = { ...stored(), checked: '2026-10-01T00:00:00.000Z' };
  const quiet = nextSeed(prior, mergeCandidates(prior.candidates, [], restaurants), NOW_ISO, false);
  assert.deepEqual([quiet.changed, quiet.write], [false, false]);

  // Overpass alone turning up a lead is still worth keeping, but the refresh
  // has not happened as far as --max-age-days is concerned.
  const osm = [{ name: 'Corner Slice', sources: ['osm'] }];
  const some = nextSeed(prior, mergeCandidates(prior.candidates, osm, restaurants), NOW_ISO, false);
  assert.deepEqual([some.changed, some.write, some.file.updated, some.file.checked],
    [true, true, NOW_ISO, '2026-10-01T00:00:00.000Z']);
  assert.ok(!('checked' in nextSeed(stored(), mergeCandidates(stored().candidates, osm, restaurants), NOW_ISO, false).file));
});

test('a first seed, with no file on disk, is written whole', () => {
  const next = nextSeed({ candidates: [] }, mergeCandidates([], sameRows(), restaurants), NOW_ISO, true);
  assert.deepEqual([next.changed, next.write, next.file.updated, next.file.checked], [true, true, NOW_ISO, NOW_ISO]);
  assert.equal(next.file.candidates.length, 2);
});

/* ---- the CLI, against a copy of the script in a scratch tree and a fetch
 * that never leaves the process ---- */
const STUB = `
import fs from 'node:fs';
const log = process.env.FETCH_LOG;
globalThis.fetch = async (url, init = {}) => {
  fs.appendFileSync(log, JSON.stringify({ url: String(url), ua: init.headers?.['user-agent'] ?? null,
    signal: init.signal instanceof AbortSignal }) + '\\n');
  const mode = process.env.FETCH_MODE;
  if (mode === 'down') throw new TypeError('fetch failed');
  if (mode === 'html') return new Response('<!doctype html><title>Maintenance</title>', { status: 200 });
  if (String(url).includes('data.kingcounty.gov')) return Response.json(JSON.parse(process.env.KC_ROWS));
  return new Response('busy', { status: 503 });
};
`;

function scratch(candidates) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fetch-candidates-'));
  for (const d of ['scripts', 'src', 'data']) fs.mkdirSync(path.join(dir, d));
  fs.copyFileSync(script, path.join(dir, 'scripts/fetch-candidates.mjs'));
  // The script's whole import graph: census.js reads the street key from
  // locations.js and the census worklist size from rules.js, which reads the
  // list of descriptive facts from schema.js.
  for (const f of ['census.js', 'locations.js', 'rules.js', 'schema.js']) fs.copyFileSync(path.join(srcDir, f), path.join(dir, 'src', f));
  fs.writeFileSync(path.join(dir, 'stub.mjs'), STUB);
  fs.writeFileSync(path.join(dir, 'data/restaurants.json'), JSON.stringify({ restaurants }));
  const file = path.join(dir, 'data/candidates.json');
  if (candidates != null) fs.writeFileSync(file, typeof candidates === 'string' ? candidates : JSON.stringify(candidates, null, 2) + '\n');
  const log = path.join(dir, 'fetch.log');
  return {
    file,
    read: () => fs.readFileSync(file, 'utf8'),
    requests: () => fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').map(l => JSON.parse(l)) : [],
    run: (args, mode = 'ok', rows = [row({}), row({ business_id: 'PR-2', name: '#807 TUTTA BELLA LLC', address: '2746 NE 45TH ST', zip_code: '98105' })]) => {
      if (fs.existsSync(log)) fs.rmSync(log);
      return spawnSync(process.execPath, ['--import', path.join(dir, 'stub.mjs'), path.join(dir, 'scripts/fetch-candidates.mjs'), ...args],
        { encoding: 'utf8', env: { ...process.env, FETCH_LOG: log, FETCH_MODE: mode, KC_ROWS: JSON.stringify(rows) } });
    },
    done: () => fs.rmSync(dir, { recursive: true, force: true })
  };
}
const daysAgo = n => new Date(Date.now() - n * 864e5).toISOString();

test('CLI: inside the window nothing is requested and the file is not touched', () => {
  const s = scratch({ ...stored(), checked: daysAgo(3) });
  try {
    const before = s.read();
    const res = s.run(['--max-age-days=30']);
    assert.equal(res.status, 0);
    assert.deepEqual(s.requests(), []);
    assert.equal(s.read(), before);
    assert.match(res.stdout, /inside the 30-day window; nothing requested/);
  } finally { s.done(); }
});

test('CLI: outside the window both registries are asked, each request with a User-Agent and a timeout', () => {
  const lastChanged = daysAgo(72);
  const s = scratch({ ...stored(), updated: lastChanged });
  try {
    const res = s.run(['--max-age-days=30']);
    assert.equal(res.status, 0, res.stderr);
    const requests = s.requests();
    assert.equal(requests.length, 4);   // the register, then three Overpass mirrors that are all busy
    assert.match(requests[0].url, /^https:\/\/data\.kingcounty\.gov\/resource\//);
    assert.equal(requests[0].url, kingCountyUrl());
    for (const r of requests) {
      assert.match(r.ua, /SeattlePizzaIndex/);
      assert.equal(r.signal, true);
    }
    assert.match(res.stderr, /osm failed .* continuing without it/);
    // Nothing new in the register: the candidates are byte-identical, `updated`
    // stays, and `checked` records that the refresh ran.
    const after = JSON.parse(s.read());
    assert.equal(JSON.stringify(after.candidates), JSON.stringify(stored().candidates));
    assert.equal(after.updated, lastChanged);
    assert.ok(Date.now() - Date.parse(after.checked) < 60_000);

    // The next day's run is inside the window again.
    const again = s.run(['--max-age-days=30']);
    assert.equal(again.status, 0);
    assert.deepEqual(s.requests(), []);
  } finally { s.done(); }
});

test('CLI: a new permit joins as pending, and with no flag the refresh always runs', () => {
  const s = scratch({ ...stored(), checked: daysAgo(1) });
  try {
    const res = s.run([], 'ok', [row({}), row({ business_id: 'PR-9', name: 'PIZZA RASOI', address: '1011 VALLEY ST', zip_code: '98109' })]);
    assert.equal(res.status, 0, res.stderr);
    assert.equal(s.requests().length, 4);
    const after = JSON.parse(s.read());
    assert.deepEqual(after.candidates.filter(c => c.status === 'pending').map(c => c.name), ['Pizza Rasoi']);
    assert.equal(after.updated, after.checked);
    assert.match(res.stdout, /3 candidate\(s\) — 1 pending, 1 promoted, 1 rejected/);
  } finally { s.done(); }
});

test('CLI: a candidate the register has inspected since it was set aside goes back to pending, verdict kept beside it', () => {
  const judged = stored();
  Object.assign(judged.candidates[0], { resolvedDate: '2026-08-31', resolutionSource: 'https://news.example/belltown', lastInspection: '2026-03-01' });
  const s = scratch({ ...judged, checked: daysAgo(40) });
  try {
    // the register's row for it is dated 2026-10-05, after the verdict
    const res = s.run(['--max-age-days=30']);
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /1 candidate\(s\) inspected since they were set aside, back to pending: Belltown Pizza \(not-pizza\)/);
    assert.match(res.stdout, /2 candidate\(s\) — 1 pending, 1 promoted/);
    const after = JSON.parse(s.read());
    assert.deepEqual(after.candidates.find(c => c.name === 'Belltown Pizza'), { key: 'belltown|2422', name: 'Belltown Pizza',
      address: '2422 1st Ave, Seattle, WA 98121', sources: ['kc-health'], lastInspection: '2026-10-05', status: 'pending',
      previousVerdict: { verdict: 'not-pizza', note: 'a bar', resolvedDate: '2026-08-31', source: 'https://news.example/belltown' } });
    assert.equal(after.updated, after.checked);

    // The same inspection does not bring it back a second time, and says nothing.
    const again = s.run([]);
    assert.doesNotMatch(again.stdout, /back to pending/);
    assert.equal(JSON.stringify(JSON.parse(s.read()).candidates), JSON.stringify(after.candidates));
  } finally { s.done(); }
});

test('CLI: when no source answers, or answers with something else, the file is untouched and the exit code is 0', () => {
  for (const mode of ['down', 'html']) {
    const s = scratch({ ...stored(), updated: daysAgo(72) });
    try {
      const before = s.read();
      const res = s.run(['--max-age-days=30'], mode);
      assert.equal(res.status, 0, mode);
      assert.equal(s.read(), before, mode);
      assert.equal(s.requests().length, 4, mode);
      assert.match(res.stdout, /::warning title=candidates seed not refreshed::/, mode);
    } finally { s.done(); }
  }
});

test('CLI: a register that answers with no rows is a failed source, not an empty city', () => {
  const s = scratch({ ...stored(), updated: daysAgo(72) });
  try {
    const before = s.read();
    const res = s.run(['--max-age-days=30'], 'ok', []);
    assert.equal(res.status, 0);
    assert.equal(s.read(), before);
    assert.match(res.stderr, /kc-health failed \(answered, but with no rows\)/);
  } finally { s.done(); }
});

test('CLI: a corrupt file, a missing dataset and a mistyped flag all exit 0 with a warning and write nothing', () => {
  const corrupt = scratch('{ "updated": ');
  try {
    const res = corrupt.run(['--max-age-days=30']);
    assert.equal(res.status, 0);
    assert.equal(corrupt.read(), '{ "updated": ');
    assert.deepEqual(corrupt.requests(), []);
    assert.match(res.stdout, /::warning title=candidates refresh abandoned::/);
  } finally { corrupt.done(); }

  const typo = scratch({ ...stored(), updated: daysAgo(72) });
  try {
    const before = typo.read();
    const res = typo.run(['--max-age-day=30']);
    assert.equal(res.status, 0);
    assert.equal(typo.read(), before);
    assert.deepEqual(typo.requests(), []);
    assert.match(res.stdout, /::warning title=candidates refresh abandoned::unrecognised argument/);
  } finally { typo.done(); }
});

test('CLI: with no file on disk the first run writes a seed', () => {
  const s = scratch(null);
  try {
    const res = s.run(['--max-age-days=30']);
    assert.equal(res.status, 0, res.stderr);
    const after = JSON.parse(s.read());
    assert.deepEqual(after.candidates.map(c => [c.name, c.status]), [['Belltown Pizza', 'pending'], ['Tutta Bella LLC', 'promoted']]);
    assert.equal(after.cutoffMonths, INSPECTION_CUTOFF_MONTHS);
  } finally { s.done(); }
});

test('importing the module requests nothing and writes nothing', () => {
  const res = spawnSync(process.execPath, ['--input-type=module', '-e',
    `import fs from 'node:fs'; fs.writeFileSync = () => { throw new Error('wrote'); };
     globalThis.fetch = () => { throw new Error('fetched'); }; await import(${JSON.stringify(script)});`],
    { encoding: 'utf8' });
  assert.equal(res.status, 0, res.stderr);
  assert.equal(res.stdout, '');
});
