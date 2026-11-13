#!/usr/bin/env node
/*
 * Fills lat/lon for any Seattle location that lacks them, using Nominatim,
 * and then for the candidates the page lists.
 *
 * Runs in publish.yml before the build; results are cached into
 * restaurants.json and candidates.json and committed by the data-refresh
 * step, so an address that resolves is geocoded once, ever. Only Seattle
 * addresses are looked up: the map plots nothing else, so a suburban branch
 * needs no coordinates. Nominatim's usage policy asks for one request per
 * second and an identifying User-Agent, both honoured here.
 *
 * Restaurant locations come first and all of them are tried, on every run.
 * Candidates take what is left, inside the limits in src/rules.js
 * (CANDIDATE_GEOCODE): a number of requests and a number of seconds,
 * whichever runs out first. The queue is many times the size of the
 * directory and a publish has a site to build, so a backlog is worked off
 * over several runs and the log says how many are left. A candidate whose
 * address finds nothing is stamped `geoTried` and rests; a request that
 * fails (a timeout, a refusal) says nothing about the address, so it stamps
 * nothing and the candidate is tried again on the next run. A few failed
 * requests in a row end the run's work on candidates: the service is not
 * answering, and the rest of the queue would only ask it again.
 *
 * Which candidates: the ones the page lists by name (candidateIsShown in
 * src/census.js), with a Seattle address and no coordinates. A promoted
 * candidate and a duplicate are tied to an entry on file, which has its own.
 *
 * Fail-soft throughout: an address that will not geocode is logged and
 * skipped, and the map simply renders without that marker. Nothing here is
 * worth a failed publish, so whatever goes wrong the exit code is 0.
 *
 * geocode() is the whole of the logic and makes no request and reads no
 * clock of its own: the lookup, the pause and the clock are passed in, which
 * is how the tests drive it. The CLI block at the end reads the two files,
 * calls it once with Nominatim and writes back whichever of them changed.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inPugetSound, isSeattleAddress } from '../src/bounds.js';
import { candidateIsShown } from '../src/census.js';
import { CANDIDATE_GEOCODE } from '../src/rules.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const UA = 'seattle-pizza-index/2.0 (https://sites.jackhammons.com/pizza/)';
/* The pause after every request: Nominatim's limit is one a second. */
export const PAUSE_MS = 1100;
const DAY = 864e5;

// Nominatim chokes on suite numbers ("Suite J1", "#102"), on a bare unit
// between street and city ("41 Dravus St, S10, Seattle"; "1011 Pike St, C,
// Seattle"), and on building names. The street address alone still pins the
// right rooftop. It also wants OSM's spelling of a few local names that
// pizzerias write as one word.
const SPELLINGS = [[/\bgreenlake\b/i, 'Green Lake']];
export const simplify = addr => SPELLINGS
  .reduce((s, [re, to]) => s.replace(re, to), addr)
  .replace(/,?\s*(suite|ste\.?|unit|#)\s*[\w-]+/i, '')
  .replace(/,\s*(?:[A-Z]|[A-Z]?\d{1,4}[A-Z]?)(?=\s*,)/i, '')
  .replace(/\s{2,}/g, ' ');

/* One request to Nominatim: the first hit, or null when there is none. */
async function nominatim(addr) {
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(addr)}`;
  // A hung connection would otherwise hold the publish run until the job timeout.
  const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json())[0] ?? null;
}

/* A hit as coordinates, or null. The box is the one the dataset lint applies
 * (src/bounds.js); a geocode outside it is a mismatch, not a fact. */
const pointOf = hit => {
  const lat = Number(hit?.lat), lon = Number(hit?.lon);
  if (!hit || !inPugetSound(lat, lon)) return null;
  return { lat: Math.round(lat * 1e5) / 1e5, lon: Math.round(lon * 1e5) / 1e5 };
};

/* The restaurant locations to look up: every Seattle address with no
 * coordinates, in file order. */
export function locationsDue(restaurants) {
  const due = [];
  for (const r of restaurants ?? []) {
    for (const loc of r.locations ?? []) {
      if ((loc.lat == null || loc.lon == null) && isSeattleAddress(loc.address)) due.push({ r, loc });
    }
  }
  return due;
}

/* The candidates to look up: listed on the page, at a Seattle address, with
 * no coordinates, and not resting after a lookup that found nothing. Those
 * never tried go first, in file order, then the longest rested, so a backlog
 * larger than one run's limit is worked through and nobody is tried twice
 * before everyone has been tried once. */
export function candidatesDue(candidates, nowMs = Date.now()) {
  const tried = c => Date.parse(c.geoTried) || 0;
  return (candidates ?? [])
    .filter(c => candidateIsShown(c) && isSeattleAddress(c?.address)
      && (c.lat == null || c.lon == null)
      && !(nowMs - tried(c) < CANDIDATE_GEOCODE.retryDays * DAY))
    .sort((a, b) => tried(a) - tried(b));
}

/*
 * Looks up everything that is due and writes what it finds onto the objects
 * it was given. `restaurants` and `candidates` are the two lists as parsed
 * from their files (candidates may be null); they are changed in place.
 *
 *   lookup(address)  resolves to a geocoder hit ({ lat, lon }) or null, and
 *                    rejects when the request itself failed
 *   sleep(ms)        the pause between requests
 *   now              the day a failed lookup is stamped with, and what a
 *                    rest is measured from
 *   clock()          milliseconds, for the time limit on candidates
 *
 * Returns the counts, and which of the two lists changed.
 */
export async function geocode({ restaurants, candidates = null },
  { lookup, sleep, now = Date.now(), clock = Date.now, log = console.log } = {}) {
  /* One address: as written, and once more without its suite or unit if
   * that found nothing. `spend` is called before each request is made. */
  const resolve = async (address, spend = () => {}) => {
    spend();
    let point = pointOf(await lookup(address));
    if (!point && simplify(address) !== address) {
      await sleep(PAUSE_MS);
      spend();
      point = pointOf(await lookup(simplify(address)));
    }
    return point;
  };

  const pending = locationsDue(restaurants);
  const due = candidatesDue(candidates, now);
  const done = { filled: 0, failed: 0, candidates: { due: due.length, filled: 0, resting: 0, errors: 0, remaining: due.length, lookups: 0 },
    restaurantsChanged: false, candidatesChanged: false };
  if (!pending.length && !due.length) {
    log('geocode: nothing to do.');
    return done;
  }

  if (pending.length) log(`geocode: ${pending.length} address(es) missing coordinates.`);
  for (const { r, loc } of pending) {
    try {
      const point = await resolve(loc.address);
      if (point) {
        Object.assign(loc, point);
        done.filled++;
        log(`  + ${r.name}: ${loc.neighborhood} -> ${loc.lat}, ${loc.lon}`);
      } else {
        done.failed++;
        log(`  ? ${r.name}: no usable result for "${loc.address}"`);
      }
    } catch (e) {
      done.failed++;
      log(`  ! ${r.name}: ${e.message}`);
    }
    await sleep(PAUSE_MS);
  }
  done.restaurantsChanged = done.filled > 0;
  if (pending.length) log(`geocode: ${done.filled} filled, ${done.failed} skipped.`);

  if (!due.length) return done;
  const q = done.candidates;
  const today = new Date(now).toISOString().slice(0, 10);
  const restsUntil = new Date(Date.parse(today) + CANDIDATE_GEOCODE.retryDays * DAY).toISOString().slice(0, 10);
  const started = clock();
  log(`geocode: ${due.length} candidate address(es) missing coordinates.`);
  let failedInARow = 0;
  let stopped = '';
  for (const c of due) {
    if (q.lookups >= CANDIDATE_GEOCODE.lookupsPerRun) { stopped = `the ${CANDIDATE_GEOCODE.lookupsPerRun}-request limit was reached`; break; }
    if (clock() - started >= CANDIDATE_GEOCODE.secondsPerRun * 1000) { stopped = `the ${CANDIDATE_GEOCODE.secondsPerRun}-second limit was reached`; break; }
    // A service that is refusing requests is not asked again and again.
    if (failedInARow >= CANDIDATE_GEOCODE.stopAfterFailures) { stopped = `${failedInARow} requests in a row failed`; break; }
    try {
      const point = await resolve(c.address, () => q.lookups++);
      failedInARow = 0;
      if (point) {
        Object.assign(c, point);
        delete c.geoTried;
        q.filled++;
        log(`  + ${c.name} -> ${c.lat}, ${c.lon}`);
      } else {
        c.geoTried = today;
        q.resting++;
        log(`  ? ${c.name}: no usable result for "${c.address}"; not tried again before ${restsUntil}`);
      }
    } catch (e) {
      q.errors++;
      failedInARow++;
      log(`  ! ${c.name}: ${e.message}`);
    }
    await sleep(PAUSE_MS);
  }
  q.remaining = due.length - q.filled - q.resting;
  done.candidatesChanged = q.filled + q.resting > 0;
  log(`geocode: candidates: ${q.filled} filled, ${q.resting} resting ${CANDIDATE_GEOCODE.retryDays} days${
    q.errors ? `, ${q.errors} request(s) failed` : ''}; ${q.remaining} remain for a later run${
    stopped ? ` (${stopped})` : ''}.`);
  return done;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1])) {
  // Coordinates are a nicety on a publish that has a site to build: an error
  // anywhere is reported and the run carries on with the files already there.
  try {
    const dataPath = path.join(root, 'data/restaurants.json');
    const candPath = path.join(root, 'data/candidates.json');
    const d = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
    // The queue is optional, and a file that does not parse is left for the
    // lint to report: the restaurants are still worth their lookups.
    let candFile = null;
    if (fs.existsSync(candPath)) {
      try { candFile = JSON.parse(fs.readFileSync(candPath, 'utf8')); }
      catch (e) { console.log(`geocode: candidates.json could not be read (${e.message}); candidates skipped.`); }
    }
    const candidates = Array.isArray(candFile?.candidates) ? candFile.candidates : null;

    const done = await geocode({ restaurants: d.restaurants, candidates },
      { lookup: nominatim, sleep: ms => new Promise(r => setTimeout(r, ms)) });

    if (done.restaurantsChanged) fs.writeFileSync(dataPath, JSON.stringify(d, null, 2) + '\n');
    if (done.candidatesChanged) fs.writeFileSync(candPath, JSON.stringify(candFile, null, 2) + '\n');
  } catch (e) {
    console.log(`geocode: abandoned, nothing written (${String(e?.message ?? e).split('\n')[0]}).`);
    console.log(`::warning title=geocoding abandoned::${String(e?.message ?? e).split('\n')[0]}`);
  }
}
