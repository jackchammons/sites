import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { geocode, candidatesDue, locationsDue, simplify, PAUSE_MS } from '../scripts/geocode.mjs';
import { candidateIsShown, mergeCandidates } from '../src/census.js';
import { checkCandidates } from '../src/check-dataset.js';
import { CANDIDATE_GEOCODE } from '../src/rules.js';

const script = fileURLToPath(new URL('../scripts/geocode.mjs', import.meta.url));
const srcDir = fileURLToPath(new URL('../src/', import.meta.url));
const NOW = Date.parse('2026-11-13T12:00:00Z');
const TODAY = '2026-11-13';
const DAY = 864e5;
const daysBefore = n => new Date(NOW - n * DAY).toISOString().slice(0, 10);

const HIT = { lat: '47.6062095', lon: '-122.3320708' };
const POINT = { lat: 47.60621, lon: -122.33207 };
const cand = (n, over = {}) => ({ key: `lead ${n}|${n}`, name: `Lead ${n}`, address: `${n} Pine St, Seattle, WA 98101`,
  sources: ['kc-health'], lastInspection: '2026-06-11', status: 'pending', ...over });
const place = (id, locations) => ({ id, name: id, status: 'open', locations });

/* A geocoder that never leaves the process. `answers` maps an address to a
 * hit, null (nothing found) or an Error (the request failed); an address it
 * does not name finds HIT. The clock moves only when the run pauses or a
 * request takes time, so a test can say exactly how long a run has been
 * going. */
function harness(answers = {}, { requestMs = 0 } = {}) {
  const asked = [], lines = [];
  let t = NOW;
  return {
    asked, lines,
    elapsed: () => t - NOW,
    opts: {
      now: NOW,
      clock: () => t,
      sleep: async ms => { t += ms; },
      log: l => lines.push(l),
      lookup: async address => {
        asked.push(address);
        t += requestMs;
        const answer = Object.hasOwn(answers, address) ? answers[address] : HIT;
        if (answer instanceof Error) throw answer;
        return answer;
      }
    }
  };
}

/* ---- what is due ---- */
test('simplify: a suite, a bare unit and a one-word Green Lake are what Nominatim trips on', () => {
  assert.equal(simplify('41 Dravus St, S10, Seattle, WA 98109'), '41 Dravus St, Seattle, WA 98109');
  assert.equal(simplify('1011 Pike St, C, Seattle, WA 98101'), '1011 Pike St, Seattle, WA 98101');
  assert.equal(simplify('223 W Galer St, A, Seattle, WA 98119'), '223 W Galer St, Seattle, WA 98119');
  assert.equal(simplify('400 Pine St, Suite J1, Seattle, WA 98101'), '400 Pine St, Seattle, WA 98101');
  assert.equal(simplify('7900 E Greenlake Dr N, Seattle, WA 98103'), '7900 E Green Lake Dr N, Seattle, WA 98103');
  assert.equal(simplify('1415 NW 70th St, Seattle, WA 98117'), '1415 NW 70th St, Seattle, WA 98117');
});

test('restaurants: every Seattle location with no coordinates is due, and nothing else', () => {
  const rs = [
    place('a', [{ neighborhood: 'Ballard', address: '1 A St, Seattle, WA 98107' },
      { neighborhood: 'Bellevue', address: '2 B St, Bellevue, WA 98004' },
      { neighborhood: 'Fremont', address: '3 C St, Seattle, WA 98103', ...POINT }]),
    place('b', [{ neighborhood: 'Georgetown', address: '4 D St, Seattle, WA 98108', lat: 47.5, lon: null }]),
    { id: 'c', name: 'c', status: 'opening' }
  ];
  assert.deepEqual(locationsDue(rs).map(d => [d.r.id, d.loc.address]),
    [['a', '1 A St, Seattle, WA 98107'], ['b', '4 D St, Seattle, WA 98108']]);
  assert.deepEqual(locationsDue([]), []);
});

test('candidates: due when the page lists it, its address is in Seattle and it has no point', () => {
  const queue = [
    cand(1),
    cand(2, { status: 'chain' }),
    cand(3, { status: 'rejected', verdict: 'not-pizza', resolvedDate: '2026-08-31' }),
    cand(4, { status: 'rejected', verdict: 'unverifiable' }),
    cand(5, { status: 'rejected', verdict: 'closed' }),
    cand(6, { sources: ['research'], status: 'rejected', verdict: 'not-pizza', neighborhood: 'Downtown', lastInspection: undefined }),
    // tied to an entry on file, which has coordinates of its own
    cand(7, { status: 'promoted', matchedId: 'a' }),
    cand(8, { status: 'rejected', verdict: 'duplicate', matchedId: 'a' }),
    // nothing to look up, or nothing the map would plot
    cand(9, { ...POINT }),
    cand(10, { address: '10 Main St, Bellevue, WA 98004' }),
    cand(11, { address: undefined }),
    cand(12, { lat: 47.6, lon: undefined })
  ];
  assert.deepEqual(candidatesDue(queue, NOW).map(c => c.name), ['Lead 1', 'Lead 2', 'Lead 3', 'Lead 4', 'Lead 5', 'Lead 6', 'Lead 12']);
  // exactly the candidates the page lists by name
  for (const c of candidatesDue(queue, NOW)) assert.ok(candidateIsShown(c), c.name);
  assert.deepEqual(candidatesDue(null, NOW), []);
  assert.deepEqual(candidatesDue([], NOW), []);
});

test('candidates: one whose address found nothing rests, and then goes behind those never tried', () => {
  const rest = CANDIDATE_GEOCODE.retryDays;
  const queue = [
    cand(1, { geoTried: daysBefore(rest + 40) }),
    cand(2, { geoTried: daysBefore(rest - 1) }),     // still resting
    cand(3),
    cand(4, { geoTried: daysBefore(rest) }),         // the rest ends on the day rules.js states
    cand(5, { geoTried: daysBefore(1) }),
    cand(6)
  ];
  assert.deepEqual(candidatesDue(queue, NOW).map(c => c.name), ['Lead 3', 'Lead 6', 'Lead 1', 'Lead 4']);
  // a stamp that is no date rests nothing
  assert.deepEqual(candidatesDue([cand(1, { geoTried: 'soon' })], NOW).length, 1);
});

/* ---- the run ---- */
test('nothing due: no request is made and nothing is marked as changed', async () => {
  const h = harness();
  const done = await geocode({ restaurants: [place('a', [{ neighborhood: 'Ballard', address: '1 A St, Seattle, WA 98107', ...POINT }])],
    candidates: [cand(1, { ...POINT }), cand(2, { status: 'promoted' })] }, h.opts);
  assert.deepEqual(h.asked, []);
  assert.deepEqual(h.lines, ['geocode: nothing to do.']);
  assert.deepEqual([done.restaurantsChanged, done.candidatesChanged], [false, false]);
});

test('restaurants: looked up as before, with the pause after every request and a second try without the suite', async () => {
  const rs = [place('Delancey', [{ neighborhood: 'Ballard', address: '1415 NW 70th St, Seattle, WA 98117' }]),
    place('Suite Pie', [{ neighborhood: 'Downtown', address: '400 Pine St, Suite J1, Seattle, WA 98101' }]),
    place('Lost Pie', [{ neighborhood: 'SoDo', address: '9 Nowhere Way, Seattle, WA 98134' }]),
    place('Down Pie', [{ neighborhood: 'Fremont', address: '3 C St, Seattle, WA 98103' }]),
    place('Far Pie', [{ neighborhood: 'Queen Anne', address: '5 E St, Seattle, WA 98109' }])];
  const h = harness({ '400 Pine St, Suite J1, Seattle, WA 98101': null, '9 Nowhere Way, Seattle, WA 98134': null,
    '3 C St, Seattle, WA 98103': new Error('HTTP 503'), '5 E St, Seattle, WA 98109': { lat: '45.52', lon: '-122.68' } });
  const done = await geocode({ restaurants: rs }, h.opts);
  assert.deepEqual(h.asked, ['1415 NW 70th St, Seattle, WA 98117', '400 Pine St, Suite J1, Seattle, WA 98101',
    '400 Pine St, Seattle, WA 98101', '9 Nowhere Way, Seattle, WA 98134', '3 C St, Seattle, WA 98103', '5 E St, Seattle, WA 98109']);
  // one pause after each of the six requests
  assert.equal(h.elapsed(), 6 * PAUSE_MS);
  assert.deepEqual(rs.map(r => [r.locations[0].lat ?? null, r.locations[0].lon ?? null]),
    [[47.60621, -122.33207], [47.60621, -122.33207], [null, null], [null, null], [null, null]]);
  assert.deepEqual([done.filled, done.failed, done.restaurantsChanged, done.candidatesChanged], [2, 3, true, false]);
  assert.deepEqual(h.lines, [
    'geocode: 5 address(es) missing coordinates.',
    '  + Delancey: Ballard -> 47.60621, -122.33207',
    '  + Suite Pie: Downtown -> 47.60621, -122.33207',
    '  ? Lost Pie: no usable result for "9 Nowhere Way, Seattle, WA 98134"',
    '  ! Down Pie: HTTP 503',
    // a point in another state is a mismatch, not a fact
    '  ? Far Pie: no usable result for "5 E St, Seattle, WA 98109"',
    'geocode: 2 filled, 3 skipped.'
  ]);
  // a location that would not resolve carries no stamp: it is tried again on every run
  assert.deepEqual(Object.keys(rs[2].locations[0]), ['neighborhood', 'address']);
});

test('candidates: a point is written, an address that finds nothing is stamped, and a failed request stamps nothing', async () => {
  const queue = [cand(1), cand(2), cand(3, { address: '3 Pine St, C, Seattle, WA 98101' }), cand(4), cand(5, { geoTried: daysBefore(60) }),
    cand(6, { status: 'promoted' })];
  const h = harness({ '2 Pine St, Seattle, WA 98101': null, '3 Pine St, C, Seattle, WA 98101': null, '3 Pine St, Seattle, WA 98101': null,
    '4 Pine St, Seattle, WA 98101': new Error('HTTP 429') });
  const done = await geocode({ restaurants: [], candidates: queue }, h.opts);

  assert.deepEqual(queue[0], cand(1, POINT));
  assert.deepEqual(queue[1], cand(2, { geoTried: TODAY }));
  assert.deepEqual(queue[2], cand(3, { address: '3 Pine St, C, Seattle, WA 98101', geoTried: TODAY }));
  assert.deepEqual(queue[3], cand(4));
  // found this time: the old stamp goes, since there is nothing left to rest
  assert.deepEqual(queue[4], cand(5, POINT));
  assert.deepEqual(queue[5], cand(6, { status: 'promoted' }));
  assert.deepEqual(done.candidates, { due: 5, filled: 2, resting: 2, errors: 1, remaining: 1, lookups: 6 });
  assert.deepEqual([done.restaurantsChanged, done.candidatesChanged], [false, true]);
  const until = new Date(Date.parse(TODAY) + CANDIDATE_GEOCODE.retryDays * DAY).toISOString().slice(0, 10);
  assert.deepEqual(h.lines, [
    'geocode: 5 candidate address(es) missing coordinates.',
    '  + Lead 1 -> 47.60621, -122.33207',
    `  ? Lead 2: no usable result for "2 Pine St, Seattle, WA 98101"; not tried again before ${until}`,
    `  ? Lead 3: no usable result for "3 Pine St, C, Seattle, WA 98101"; not tried again before ${until}`,
    '  ! Lead 4: HTTP 429',
    '  + Lead 5 -> 47.60621, -122.33207',
    `geocode: candidates: 2 filled, 2 resting ${CANDIDATE_GEOCODE.retryDays} days, 1 request(s) failed; 1 remain for a later run.`
  ]);
  // what it wrote passes the lint, and the next run has only the failed request left to make
  assert.deepEqual(checkCandidates({ candidates: queue }, NOW), []);
  assert.deepEqual(candidatesDue(queue, NOW).map(c => c.name), ['Lead 4']);
  assert.deepEqual(candidatesDue(queue, NOW + CANDIDATE_GEOCODE.retryDays * DAY).map(c => c.name), ['Lead 4', 'Lead 2', 'Lead 3']);
});

test('candidates: a point outside the box is not a point, and coordinates are rounded to five places', async () => {
  const queue = [cand(1), cand(2), cand(3)];
  const h = harness({ '1 Pine St, Seattle, WA 98101': { lat: '45.5231', lon: '-122.6765' },
    '2 Pine St, Seattle, WA 98101': { lat: 'x', lon: 'y' }, '3 Pine St, Seattle, WA 98101': { lat: '47.614784999', lon: '-122.345614999' } });
  await geocode({ restaurants: [], candidates: queue }, h.opts);
  assert.deepEqual(queue.map(c => [c.lat ?? null, c.lon ?? null, c.geoTried ?? null]),
    [[null, null, TODAY], [null, null, TODAY], [47.61478, -122.34561, null]]);
  assert.deepEqual(checkCandidates({ candidates: queue }, NOW), []);
});

test('the cap: restaurants are all looked up, and candidates stop at the request limit with the rest left for a later run', async () => {
  const cap = CANDIDATE_GEOCODE.lookupsPerRun;
  const rs = Array.from({ length: cap + 5 }, (_, i) => place(`pie-${i}`, [{ neighborhood: 'Ballard', address: `${i + 1} A St, Seattle, WA 98107` }]));
  const queue = Array.from({ length: cap + 25 }, (_, i) => cand(i + 1));
  const h = harness();
  const done = await geocode({ restaurants: rs, candidates: queue }, h.opts);

  // every restaurant first, however many there are
  assert.equal(done.filled, cap + 5);
  assert.deepEqual(h.asked.slice(0, cap + 5), rs.map(r => r.locations[0].address));
  // then candidates, in order, up to the limit and not one request past it
  assert.deepEqual(h.asked.slice(cap + 5), queue.slice(0, cap).map(c => c.address));
  assert.deepEqual(done.candidates, { due: cap + 25, filled: cap, resting: 0, errors: 0, remaining: 25, lookups: cap });
  assert.equal(queue.filter(c => c.lat != null).length, cap);
  assert.equal(h.lines.at(-1),
    `geocode: candidates: ${cap} filled, 0 resting ${CANDIDATE_GEOCODE.retryDays} days; 25 remain for a later run (the ${cap}-request limit was reached).`);

  // the next run takes up where this one stopped, and the one after has nothing to do
  const second = harness();
  const next = await geocode({ restaurants: rs, candidates: queue }, second.opts);
  assert.deepEqual(second.asked, queue.slice(cap).map(c => c.address));
  assert.deepEqual([next.candidates.filled, next.candidates.remaining], [25, 0]);
  assert.equal(second.lines.at(-1), `geocode: candidates: 25 filled, 0 resting ${CANDIDATE_GEOCODE.retryDays} days; 0 remain for a later run.`);
  const third = harness();
  await geocode({ restaurants: rs, candidates: queue }, third.opts);
  assert.deepEqual(third.lines, ['geocode: nothing to do.']);
});

test('the cap: an address that takes two requests counts twice, and a candidate started under the limit is finished', async () => {
  const cap = CANDIDATE_GEOCODE.lookupsPerRun;
  // every address has a unit, and the first form of each finds nothing
  const queue = Array.from({ length: cap }, (_, i) => cand(i + 1, { address: `${i + 1} Pine St, C, Seattle, WA 98101` }));
  const h = harness(Object.fromEntries(queue.map(c => [c.address, null])));
  const done = await geocode({ restaurants: [], candidates: queue }, h.opts);
  assert.equal(done.candidates.lookups, cap);
  assert.equal(done.candidates.filled, cap / 2);
  assert.equal(h.asked.length, cap);
  assert.equal(done.candidates.remaining, cap / 2);

  // one request short of the limit when a two-request address comes up: it is seen through
  const odd = [cand(0), ...queue.map(c => ({ ...c, lat: undefined, lon: undefined }))];
  const g = harness(Object.fromEntries(queue.map(c => [c.address, null])));
  const over = await geocode({ restaurants: [], candidates: odd }, g.opts);
  assert.equal(over.candidates.lookups, cap + 1);
  assert.equal(g.asked.at(-1), simplify(odd[cap / 2].address));
  assert.deepEqual([odd[cap / 2].lat, odd[cap / 2 + 1].lat], [POINT.lat, undefined]);
});

test('the cap: a slow service ends the candidates\' share of the run at the time limit, whatever the count', async () => {
  const seconds = CANDIDATE_GEOCODE.secondsPerRun;
  const queue = Array.from({ length: 40 }, (_, i) => cand(i + 1));
  // each request takes 8.9 seconds, so with the pause one address costs ten
  const h = harness({}, { requestMs: 10_000 - PAUSE_MS });
  const done = await geocode({ restaurants: [], candidates: queue }, h.opts);
  assert.equal(done.candidates.filled, seconds / 10);
  assert.ok(done.candidates.lookups < CANDIDATE_GEOCODE.lookupsPerRun);
  assert.equal(h.elapsed(), seconds * 1000);
  assert.equal(done.candidates.remaining, 40 - seconds / 10);
  assert.match(h.lines.at(-1), new RegExp(`${40 - seconds / 10} remain for a later run \\(the ${seconds}-second limit was reached\\)\\.$`));

  // the limit is on the candidates alone: time spent on restaurants first does not come out of it
  const rs = Array.from({ length: 30 }, (_, i) => place(`pie-${i}`, [{ neighborhood: 'Ballard', address: `${i + 1} A St, Seattle, WA 98107` }]));
  const g = harness({}, { requestMs: 10_000 - PAUSE_MS });
  const both = await geocode({ restaurants: rs, candidates: queue.map(c => cand(Number(c.name.split(' ')[1]))) }, g.opts);
  assert.deepEqual([both.filled, both.candidates.filled], [30, seconds / 10]);
});

test('the cap: a service that is refusing requests is left alone after a few in a row', async () => {
  const stop = CANDIDATE_GEOCODE.stopAfterFailures;
  const queue = Array.from({ length: 20 }, (_, i) => cand(i + 1));
  const down = harness(Object.fromEntries(queue.map(c => [c.address, new Error('HTTP 403')])));
  const done = await geocode({ restaurants: [], candidates: queue }, down.opts);
  assert.equal(down.asked.length, stop);
  assert.deepEqual(done.candidates, { due: 20, filled: 0, resting: 0, errors: stop, remaining: 20, lookups: stop });
  assert.equal(done.candidatesChanged, false);
  assert.ok(queue.every(c => !('geoTried' in c) && !('lat' in c)));
  assert.equal(down.lines.at(-1), `geocode: candidates: 0 filled, 0 resting ${CANDIDATE_GEOCODE.retryDays} days, ${stop} request(s) failed; `
    + `20 remain for a later run (${stop} requests in a row failed).`);

  // failures that are not in a row are single addresses going wrong, and the run carries on
  const flaky = harness({ [queue[0].address]: new Error('timeout'), [queue[2].address]: new Error('timeout'), [queue[4].address]: new Error('timeout'),
    [queue[6].address]: new Error('timeout') });
  const some = await geocode({ restaurants: [], candidates: queue }, flaky.opts);
  assert.deepEqual([some.candidates.filled, some.candidates.errors, some.candidates.remaining], [16, 4, 4]);
});

test('a point survives what happens to the candidate next: a seed refresh, and the same address coming round again', async () => {
  const queue = [cand(1, { status: 'rejected', verdict: 'not-pizza', resolvedDate: '2026-08-31', lastInspection: '2026-03-01' }), cand(2)];
  await geocode({ restaurants: [], candidates: queue }, harness({ '2 Pine St, Seattle, WA 98101': null }).opts);
  const refreshed = mergeCandidates(queue, [
    { name: 'Lead 1', address: '1 Pine St, Seattle, WA 98101', sources: ['kc-health'], lastInspection: '2026-11-12' },
    { name: 'Lead 2', address: '2 Pine St, Seattle, WA 98101', sources: ['kc-health'], lastInspection: '2026-11-12' }], []);
  const [one, two] = ['Lead 1', 'Lead 2'].map(n => refreshed.find(c => c.name === n));
  // inspected since its verdict, so it is pending again, and it is still where it was
  assert.deepEqual([one.status, one.lat, one.lon], ['pending', POINT.lat, POINT.lon]);
  assert.equal(two.geoTried, TODAY);
  assert.deepEqual(candidatesDue(refreshed, NOW), []);
});

/* ---- the CLI, on a scratch tree, with a fetch that never leaves the process ---- */
const STUB = `
import fs from 'node:fs';
globalThis.fetch = async (url, init = {}) => {
  const q = new URL(url).searchParams.get('q');
  fs.appendFileSync(process.env.FETCH_LOG, JSON.stringify({ host: new URL(url).host, q, ua: init.headers?.['User-Agent'] ?? null,
    signal: init.signal instanceof AbortSignal }) + '\\n');
  const mode = process.env.FETCH_MODE;
  if (mode === 'down') throw new TypeError('fetch failed');
  if (mode === 'busy') return new Response('busy', { status: 503 });
  if (/Nowhere/.test(q)) return Response.json([]);
  return Response.json([{ lat: '47.6062095', lon: '-122.3320708' }]);
};
// One request a second is the service's rule, not the test's.
const real = globalThis.setTimeout;
globalThis.setTimeout = (fn, ms, ...rest) => real(fn, 0, ...rest);
`;

function scratch({ restaurants, candidates }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'geocode-'));
  for (const d of ['scripts', 'src', 'data']) fs.mkdirSync(path.join(dir, d));
  fs.copyFileSync(script, path.join(dir, 'scripts/geocode.mjs'));
  // The script's whole import graph.
  for (const f of ['bounds.js', 'census.js', 'locations.js', 'rules.js', 'schema.js']) fs.copyFileSync(path.join(srcDir, f), path.join(dir, 'src', f));
  fs.writeFileSync(path.join(dir, 'stub.mjs'), STUB);
  const files = { restaurants: path.join(dir, 'data/restaurants.json'), candidates: path.join(dir, 'data/candidates.json') };
  const put = (file, value) => fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n');
  if (restaurants != null) put(files.restaurants, restaurants);
  if (candidates != null) put(files.candidates, candidates);
  const log = path.join(dir, 'fetch.log');
  return {
    text: name => fs.readFileSync(files[name], 'utf8'),
    read: name => JSON.parse(fs.readFileSync(files[name], 'utf8')),
    has: name => fs.existsSync(files[name]),
    requests: () => fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').map(l => JSON.parse(l)) : [],
    run: (mode = 'ok') => {
      if (fs.existsSync(log)) fs.rmSync(log);
      return spawnSync(process.execPath, ['--import', path.join(dir, 'stub.mjs'), path.join(dir, 'scripts/geocode.mjs')],
        { encoding: 'utf8', env: { ...process.env, FETCH_LOG: log, FETCH_MODE: mode } });
    },
    done: () => fs.rmSync(dir, { recursive: true, force: true })
  };
}
const dataset = () => ({ city: 'Seattle', dataVersion: '2026.11', restaurants: [
  place('Delancey', [{ neighborhood: 'Ballard', address: '1415 NW 70th St, Seattle, WA 98117' }]),
  place('Placed Pie', [{ neighborhood: 'Fremont', address: '3 C St, Seattle, WA 98103', ...POINT }])] });
const queueFile = () => ({ updated: '2026-11-12T05:30:31.005Z', checked: '2026-11-12T05:30:31.005Z', cutoffMonths: 30, servesCursor: 8,
  candidates: [cand(1), cand(2, { address: '9 Nowhere Way, Seattle, WA 98134' }), cand(3, { status: 'promoted', matchedId: 'delancey' })] });

test('CLI: fills restaurants, then candidates, and writes each file only when it changed', () => {
  const s = scratch({ restaurants: dataset(), candidates: queueFile() });
  try {
    const res = s.run();
    assert.equal(res.status, 0, res.stderr);
    const requests = s.requests();
    assert.deepEqual(requests.map(r => r.q), ['1415 NW 70th St, Seattle, WA 98117', '1 Pine St, Seattle, WA 98101', '9 Nowhere Way, Seattle, WA 98134']);
    for (const r of requests) assert.deepEqual([r.host, r.signal, /seattle-pizza-index/.test(r.ua)], ['nominatim.openstreetmap.org', true, true]);

    // restaurants.json: the point, in the bytes the script has always written
    const expected = dataset();
    Object.assign(expected.restaurants[0].locations[0], POINT);
    assert.equal(s.text('restaurants'), JSON.stringify(expected, null, 2) + '\n');

    // candidates.json: a point, a stamp, and everything else as it was, top-level keys included
    const queue = s.read('candidates');
    const today = new Date().toISOString().slice(0, 10);
    assert.deepEqual(queue, { ...queueFile(), candidates: [cand(1, POINT), cand(2, { address: '9 Nowhere Way, Seattle, WA 98134', geoTried: today }),
      cand(3, { status: 'promoted', matchedId: 'delancey' })] });
    assert.deepEqual(Object.keys(queue), ['updated', 'checked', 'cutoffMonths', 'servesCursor', 'candidates']);
    assert.deepEqual(checkCandidates(queue), []);
    assert.match(res.stdout, /geocode: 1 address\(es\) missing coordinates\.\n {2}\+ Delancey: Ballard -> 47\.60621, -122\.33207\ngeocode: 1 filled, 0 skipped\./);
    assert.match(res.stdout, /geocode: candidates: 1 filled, 1 resting 30 days; 0 remain for a later run\.\n$/);

    // the next run has nothing to ask for and touches neither file
    const before = [s.text('restaurants'), s.text('candidates')];
    const again = s.run();
    assert.equal(again.status, 0);
    assert.equal(again.stdout, 'geocode: nothing to do.\n');
    assert.deepEqual(s.requests(), []);
    assert.deepEqual([s.text('restaurants'), s.text('candidates')], before);
  } finally { s.done(); }
});

test('CLI: with no candidates file, or one that does not parse, the restaurants are geocoded as they always were', () => {
  for (const candidates of [null, '{ "updated": ']) {
    const s = scratch({ restaurants: dataset(), candidates });
    try {
      const res = s.run();
      assert.equal(res.status, 0, res.stderr);
      assert.equal(s.requests().length, 1);
      assert.deepEqual(s.read('restaurants').restaurants[0].locations[0], { neighborhood: 'Ballard', address: '1415 NW 70th St, Seattle, WA 98117', ...POINT });
      if (candidates == null) assert.equal(s.has('candidates'), false);
      else {
        assert.equal(s.text('candidates'), candidates);
        assert.match(res.stdout, /candidates\.json could not be read .*; candidates skipped\./);
      }
    } finally { s.done(); }
  }
});

test('CLI: whatever fails, the exit code is 0 and no file is written', () => {
  // the service is down, or answering 503: nothing found, nothing stamped
  for (const mode of ['down', 'busy']) {
    const s = scratch({ restaurants: dataset(), candidates: queueFile() });
    try {
      const before = [s.text('restaurants'), s.text('candidates')];
      const res = s.run(mode);
      assert.equal(res.status, 0, mode);
      assert.deepEqual([s.text('restaurants'), s.text('candidates')], before, mode);
      assert.match(res.stdout, /geocode: 0 filled, 1 skipped\./, mode);
      assert.match(res.stdout, /geocode: candidates: 0 filled, 0 resting 30 days, 2 request\(s\) failed; 2 remain for a later run\./, mode);
    } finally { s.done(); }
  }
  // a dataset that does not parse, and no dataset at all
  for (const restaurants of ['{ "city": ', null]) {
    const s = scratch({ restaurants, candidates: queueFile() });
    try {
      const before = s.text('candidates');
      const res = s.run();
      assert.equal(res.status, 0);
      assert.deepEqual(s.requests(), []);
      assert.equal(s.text('candidates'), before);
      assert.match(res.stdout, /geocode: abandoned, nothing written \(/);
      assert.match(res.stdout, /::warning title=geocoding abandoned::/);
    } finally { s.done(); }
  }
});

test('importing the module requests nothing and writes nothing', () => {
  const res = spawnSync(process.execPath, ['--input-type=module', '-e',
    `import fs from 'node:fs'; fs.writeFileSync = () => { throw new Error('wrote'); };
     globalThis.fetch = () => { throw new Error('fetched'); }; await import(${JSON.stringify(script)});`],
    { encoding: 'utf8' });
  assert.equal(res.status, 0, res.stderr);
  assert.equal(res.stdout, '');
});
