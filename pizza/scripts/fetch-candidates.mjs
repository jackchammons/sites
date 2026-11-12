#!/usr/bin/env node
/*
 * Seeds/refreshes data/candidates.json — the discovery funnel's registry top.
 *
 * Two sources, both free, keyless, and machine-readable:
 *   - King County food-establishment inspection data (data.kingcounty.gov,
 *     Socrata). Every operating restaurant holds a health permit, which makes
 *     this the ground truth for "exists and serves food" — including places
 *     with no web presence at all. Inspection rows are deduped to businesses;
 *     a business whose latest inspection is older than the cutoff is dropped
 *     as likely gone.
 *   - OpenStreetMap via Overpass: cuisine=pizza amenities inside Seattle's
 *     admin boundary. Staler, but catches what permit-name filtering misses.
 *
 * Candidates are LEADS, not entries: the census research task verifies each
 * one through the validated `directory` channel before it can join the site.
 * Existing resolutions (promoted/rejected/chain) survive a refresh.
 *
 *   node pizza/scripts/fetch-candidates.mjs                    refresh at once
 *   node pizza/scripts/fetch-candidates.mjs --max-age-days=30  only if the last
 *                                                              refresh is older
 *
 * The second form is the one a workflow runs on every pass: inside the window
 * it returns before any request is made, so the registries are asked about
 * once a month however often it is called.
 *
 * Nothing here is worth a failed run. A source that is down is skipped and the
 * other still refreshes the queue; if neither answers, or anything else goes
 * wrong, candidates.json is left exactly as it was and the exit code is 0.
 *
 * The file carries two stamps. `updated` is the last refresh that changed a
 * candidate, and the candidates are rewritten only then. `checked` is the last
 * refresh in which the permit register answered, changed or not, and is what
 * --max-age-days reads: without it a refresh that found nothing new would
 * leave no trace, and the next run would ask the registries all over again.
 *
 * The row handling and the stamps are pure and exported for the tests; the
 * requests and the file write happen in the CLI block at the end.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mergeCandidates, isSeattleCity, INSPECTION_CUTOFF_MONTHS } from '../src/census.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outPath = path.join(root, 'data/candidates.json');

const UA = 'Mozilla/5.0 (compatible; SeattlePizzaIndex/1.0; +https://sites.jackhammons.com/pizza/)';
/* Per request. The refresh runs inside a workflow job with its own deadline
 * and a commit still to make, so the worst case has to stay small: one
 * register request and three Overpass mirrors come to 100 seconds. */
const TIMEOUT_MS = 25_000;
export { INSPECTION_CUTOFF_MONTHS };

const title = s => String(s).toLowerCase().replace(/\b[a-z]/g, c => c.toUpperCase())
  .replace(/\bLlc\b/g, 'LLC').trim();

/* Inspection rows, newest first, to one candidate per business. The query
 * matches the city loosely, so the rows are held to isSeattleCity here. */
export function kingCountyCandidates(rows, nowMs = Date.now()) {
  // An error from Socrata is a JSON object, not a list of rows.
  if (!Array.isArray(rows)) throw new Error('Socrata answered with something that is not a list of rows');
  const seen = new Map();
  for (const row of rows) {
    if (!isSeattleCity(row?.city)) continue;
    const id = row?.business_id ?? `${row?.name}|${row?.address}`;
    if (seen.has(id)) continue;   // rows are newest-first, so first wins = latest inspection
    seen.set(id, row);
  }
  const cutoff = nowMs - INSPECTION_CUTOFF_MONTHS * 30 * 864e5;
  const out = [];
  for (const row of seen.values()) {
    if (!row?.name || !row.address) continue;
    if (Date.parse(row.inspection_date) < cutoff) continue;
    // The health department knows about closures before anyone else does.
    if (row.inspection_closed_business === 'Yes') continue;
    // Permit names carry store numbers up front ("#807 TUTTA BELLA").
    const cleanName = String(row.name).replace(/^#?\s*\d+\s+/, '');
    out.push({
      name: title(cleanName),
      address: `${title(row.address)}, Seattle, WA ${row.zip_code ?? ''}`.trim(),
      sources: ['kc-health'],
      lastInspection: String(row.inspection_date).slice(0, 10)
    });
  }
  return out;
}

/* Overpass elements to candidates; an element with no name is no lead. */
export function overpassCandidates(json) {
  const out = [];
  for (const el of json?.elements ?? []) {
    const t = el.tags ?? {};
    if (!t.name) continue;
    const lat = el.lat ?? el.center?.lat, lon = el.lon ?? el.center?.lon;
    const addr = t['addr:housenumber'] && t['addr:street']
      ? `${t['addr:housenumber']} ${t['addr:street']}, Seattle, WA ${t['addr:postcode'] ?? ''}`.trim()
      : null;
    out.push({
      name: t.name,
      ...(addr ? { address: addr } : {}),
      ...(lat != null ? { lat, lon } : {}),
      sources: ['osm'],
      ...(t.website ? { website: t.website } : {})
    });
  }
  return out;
}

/* The one option: --max-age-days=N, N a number of days from 0 up. Anything
 * else is refused rather than guessed at, since a mistyped flag would
 * otherwise mean a request to both registries on every run. */
export function parseArgs(argv) {
  let maxAgeDays = null;
  for (const arg of argv) {
    const m = /^--max-age-days=(\d+(?:\.\d+)?)$/.exec(arg);
    if (!m) throw new Error(`unrecognised argument "${arg}" (the only option is --max-age-days=N)`);
    maxAgeDays = Number(m[1]);
  }
  return { maxAgeDays };
}

/* Days since the registries were last read. A file written before `checked`
 * existed has only `updated`, which was then stamped on every refresh. */
export function seedAgeDays(file, nowMs = Date.now()) {
  const t = Date.parse(file?.checked ?? file?.updated);
  return Number.isFinite(t) ? (nowMs - t) / 864e5 : Infinity;
}

/* The file after a refresh, and whether it needs writing at all.
 *
 * `merged` is the queue with this refresh folded in. The comparison ignores
 * order: the apply step resolves candidates in place, which leaves the list
 * out of the merge's sort order without changing any candidate. When nothing
 * changed the stored list is kept byte for byte and only `checked` moves, and
 * that only if the permit register answered. With the register down there is
 * nothing to stamp, so the next run tries again. */
export function nextSeed(prior, merged, nowIso, registerAnswered) {
  const canon = list => JSON.stringify([...list].sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const before = prior?.candidates ?? [];
  const changed = canon(merged) !== canon(before);
  const checked = registerAnswered ? nowIso : prior?.checked;
  return {
    changed,
    write: changed || registerAnswered,
    file: {
      updated: changed ? nowIso : prior?.updated ?? nowIso,
      ...(checked ? { checked } : {}),
      cutoffMonths: INSPECTION_CUTOFF_MONTHS,
      candidates: changed ? merged : before
    }
  };
}

async function getJson(url, init = {}) {
  const res = await fetch(url, { ...init,
    headers: { 'user-agent': UA, accept: 'application/json', ...init.headers },
    signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/* The register request. Name-filtered and ordered server-side; deduped to
 * businesses client-side.
 *
 * The city is matched in upper case and by containment. SoQL's `=` is
 * case-sensitive and the register spells Seattle five ways, so
 * `city = 'SEATTLE'` leaves out about a quarter of the city's permits, Jet
 * City Pizza among them. Containment also returns the odd "Seattle tacoma";
 * kingCountyCandidates settles the exact set. */
export const KING_COUNTY_WHERE =
  "upper(city) like '%SEATTLE%' AND (upper(name) like '%PIZZ%' OR upper(name) like '%SLICE%')";
export const kingCountyUrl = () => 'https://data.kingcounty.gov/resource/r878-4sxa.json'
  + '?$select=business_id,name,address,city,zip_code,inspection_date,inspection_closed_business'
  + '&$where=' + encodeURIComponent(KING_COUNTY_WHERE)
  + '&$order=inspection_date DESC&$limit=20000';

async function fromKingCounty() {
  return kingCountyCandidates(await getJson(kingCountyUrl()));
}

async function fromOverpass() {
  const q = `[out:json][timeout:20];
area["name"="Seattle"]["boundary"="administrative"]["admin_level"="8"]->.sea;
( node["cuisine"~"pizza"](area.sea);
  way["cuisine"~"pizza"](area.sea); );
out center tags;`;
  // Mirrors tried in order: Overpass instances rate-limit and block ranges
  // unpredictably, and a seed refresh should survive any one of them sulking.
  const MIRRORS = ['https://overpass-api.de/api/interpreter',
                   'https://overpass.kumi.systems/api/interpreter',
                   'https://overpass.private.coffee/api/interpreter'];
  let lastErr = null;
  for (const url of MIRRORS) {
    try {
      return overpassCandidates(await getJson(url, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: 'data=' + encodeURIComponent(q)
      }));
    } catch (e) { lastErr = e; }
  }
  throw new Error(`all Overpass mirrors failed (${lastErr?.message})`);
}

async function refresh(argv) {
  const { maxAgeDays } = parseArgs(argv);
  const prior = fs.existsSync(outPath)
    ? JSON.parse(fs.readFileSync(outPath, 'utf8'))
    : { candidates: [] };

  const age = seedAgeDays(prior);
  if (maxAgeDays != null && age < maxAgeDays) {
    console.log(`candidates.json was refreshed ${age.toFixed(1)} day(s) ago, inside the ${maxAgeDays}-day window; nothing requested.`);
    return;
  }

  const dataset = JSON.parse(fs.readFileSync(path.join(root, 'data/restaurants.json'), 'utf8'));
  const incoming = [];
  const answered = new Set();
  for (const [label, fn] of [['kc-health', fromKingCounty], ['osm', fromOverpass]]) {
    try {
      const rows = await fn();
      // Both registries always hold Seattle pizzerias, so an answer with none
      // is a changed dataset or an error page, not an empty city.
      if (!rows.length) throw new Error('answered, but with no rows');
      console.log(`  ${label}: ${rows.length} candidate row(s)`);
      incoming.push(...rows);
      answered.add(label);
    } catch (e) {
      console.warn(`  ! ${label} failed (${e.message}) — continuing without it`);
    }
  }

  if (!answered.size) {
    console.warn('No source answered; candidates.json left as it was.');
    console.log('::warning title=candidates seed not refreshed::Neither King County nor Overpass answered, so the candidates queue was not refreshed. It is tried again on the next run.');
    return;
  }

  const merged = mergeCandidates(prior.candidates ?? [], incoming, dataset.restaurants);
  const next = nextSeed(prior, merged, new Date().toISOString(), answered.has('kc-health'));
  const stats = {};
  for (const c of next.file.candidates) stats[c.status] = (stats[c.status] ?? 0) + 1;
  const summary = `${next.file.candidates.length} candidate(s) — ${
    Object.entries(stats).map(([k, v]) => `${v} ${k}`).join(', ')}`;

  if (!next.write) {
    console.log(`candidates.json: ${summary}; nothing changed and the permit register did not answer, file left as it was.`);
    return;
  }
  fs.writeFileSync(outPath, JSON.stringify(next.file, null, 2) + '\n');
  console.log(`candidates.json: ${summary}${next.changed ? '' : '; nothing changed, refresh date stamped'}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1])) {
  // A seed refresh rides along on a research pass, and nothing in it is worth
  // failing that pass: an error anywhere is reported and the run carries on
  // with the candidates.json already on file.
  await refresh(process.argv.slice(2)).catch(e => {
    console.warn(`Candidates refresh abandoned; keeping the existing candidates.json unchanged.\n${e.stack ?? e}`);
    console.log(`::warning title=candidates refresh abandoned::${String(e.message ?? e).split('\n')[0]}`);
  });
}
