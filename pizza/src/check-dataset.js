/*
 * Lint for data/restaurants.json — the dataset the whole site is computed
 * from. apply-research writes it and the build trusts it, so this gate runs
 * before any build and after any apply: a bad write fails the run instead of
 * shipping as a symptom for verify.mjs to maybe notice in the rendered page.
 *
 * Pure function of (dataset, registry, nowMs); the CLI wrapper does the I/O.
 */
import { PUGET_SOUND_ZIP, PUGET_SOUND_BOX, inPugetSound } from './bounds.js';
import { ENTRY_SCHEMA, ENTRY_KEYS, LOCATION_SHAPE, FACTOR_NAMES, FACTOR_SHAPE, MENTION_SHAPE,
  FACT_FIELDS, FACT_SOURCE_KEY } from './schema.js';

const STATUSES = new Set(['open', 'opening', 'closed']);
/* Every rating is the research agent's, read from published coverage. A
 * graded factor set by anyone else is a hand-entered value, and the lint
 * refuses it so one cannot come back. */
const SET_BY = new Set(['agent']);
/* The clocks apply-research stamps. Freshness, the worklists and the radar all
 * read them, so one in the future holds an entry fresh, or out of a worklist,
 * until that day comes. */
const STAMPS = ['statusChecked', 'statusDetected', 'locationsVerified', 'locationsAttempted',
  'ratingAttempted', 'factsAttempted', 'coverageAttempted', 'socialAttempted'];
/* Free text the page prints. The research validator refuses angle brackets in
 * what the agent writes; this holds a hand edit to the same rule, because the
 * map popup is assembled from these strings in the browser. */
const TEXT = ['name', 'neighborhood', 'style', 'styleGroup', 'signature', 'blurb',
  'statusNote', 'ratingNote', 'factsNote', 'locationsNote', 'coverageNote', 'socialNote'];

const isObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const namesOf = shape => new Set(shape.map(s => s.key));
const LOCATION_KEYS = namesOf(LOCATION_SHAPE);
const FACTOR_KEYS = namesOf(FACTOR_SHAPE);
const MENTION_KEYS = namesOf(MENTION_SHAPE);

/* How the lint reports an entry that lacks schema keys. The CLI looks for it
 * to say that normalising is the remedy. */
export const MISSING_KEYS = 'missing schema keys:';

export function checkDataset(dataset, registry = {}, nowMs = Date.now()) {
  const fails = [];
  const bad = (id, msg) => fails.push(`${id}: ${msg}`);

  for (const k of ['city', 'dataVersion']) {
    if (dataset?.[k] == null) fails.push(`dataset.${k} missing`);
  }
  if (!Array.isArray(dataset?.restaurants)) {
    return ['dataset.restaurants must be an array', ...fails];
  }

  const https = u => { try { return new URL(u).protocol === 'https:'; } catch { return false; } };
  const pastDate = v => {
    const t = Date.parse(v);
    return Number.isFinite(t) && t <= nowMs + 864e5;
  };

  const markup = v => typeof v === 'string' && /[<>]/.test(v);

  const ids = new Set();
  for (const r of dataset.restaurants) {
    const id = r?.id ?? '(missing id)';
    if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) bad(id, 'id must be kebab-case');
    if (ids.has(id)) bad(id, 'duplicate id');
    ids.add(id);

    if (typeof r.name !== 'string' || !r.name.trim()) bad(id, 'name missing');

    // One shape for every entry (src/schema.js). A key the schema does not
    // name is a field nothing reads, or a misspelling of one that is read. A
    // key that is absent cannot be told from one nobody has filled in, and
    // every worklist that draws on what is missing would then depend on how
    // an entry happened to be written. An empty value says "nothing on file",
    // and only a key that is present can say it.
    for (const k of Object.keys(r ?? {})) {
      if (k !== 'crowd' && k !== 'criticScore' && !ENTRY_KEYS.includes(k)) bad(id, `"${k}" is not a key of the schema`);
    }
    const absent = ENTRY_SCHEMA.filter(s => s.empty !== undefined && !Object.hasOwn(r ?? {}, s.key)).map(s => s.key);
    if (absent.length) bad(id, `${MISSING_KEYS} ${absent.join(', ')}`);
    for (const { key, empty } of ENTRY_SCHEMA) {
      if (empty == null || absent.includes(key)) continue;
      if (Array.isArray(empty) && !Array.isArray(r[key])) bad(id, `${key} must be a list, empty when there is nothing to record`);
      else if (!Array.isArray(empty) && !isObject(r[key])) bad(id, `${key} must be an object, empty when there is nothing to record`);
    }
    for (const k of TEXT) if (markup(r[k])) bad(id, `${k} contains < or >`);
    if (!STATUSES.has(r.status)) bad(id, `status must be open|opening|closed, got "${r.status}"`);
    if (r.status !== 'open') {
      if (!r.statusSource || !https(r.statusSource)) bad(id, `status "${r.status}" needs an https statusSource`);
      // A closure needs a date: the event date when the source gives one,
      // otherwise the day it was detected (which the radar labels as such).
      if (r.status === 'closed' && !pastDate(r.statusDate) && !pastDate(r.statusDetected)) {
        bad(id, 'closed entries need a statusDate (event) or statusDetected (when recorded)');
      }
    }
    if (r.statusDate != null && !/^\d{4}-\d{2}-\d{2}$/.test(String(r.statusDate))) bad(id, `statusDate must be YYYY-MM-DD: "${r.statusDate}"`);
    if (r.statusDate != null && r.statusDetected != null && Date.parse(r.statusDate) > Date.parse(r.statusDetected) + 864e5) {
      bad(id, `statusDate ${r.statusDate} is after it was detected (${r.statusDetected})`);
    }
    for (const k of Object.values(FACT_SOURCE_KEY)) {
      if (r[k] != null && !https(r[k])) bad(id, `${k} must be https`);
    }
    for (const k of Array.isArray(r.factsSought) ? r.factsSought : []) {
      if (!FACT_FIELDS.includes(k)) bad(id, `factsSought names "${k}", which is not one of ${FACT_FIELDS.join(', ')}`);
    }
    for (const k of STAMPS) if (r[k] != null && !pastDate(r[k])) bad(id, `${k} is not a past date`);
    if (r.url != null && !https(r.url)) bad(id, `url must be https, got "${r.url}"`);
    if (r.instagram != null && !/^https:\/\/(www\.)?instagram\.com\/[A-Za-z0-9._]{2,30}\/?$/.test(r.instagram)) {
      bad(id, `instagram must be an https instagram.com profile URL, got "${r.instagram}"`);
    }
    if (r.lastVerified != null && !pastDate(r.lastVerified)) bad(id, `lastVerified is not a past date: "${r.lastVerified}"`);

    // Every flag an entry carries must exist in the registry. Both are edited
    // by hand, and a flag with no row would score at a default cost and print
    // its raw key as its label.
    for (const k of Object.keys(r.attributes ?? {})) {
      if (!registry[k]) bad(id, `attribute "${k}" is not in the registry`);
    }

    // Provenance: an agent may only hold a rating it can cite.
    for (const k of Object.keys(isObject(r.factors) ? r.factors : {})) {
      if (!FACTOR_NAMES.includes(k)) bad(id, `factors.${k} is not a graded factor`);
    }
    for (const k of FACTOR_NAMES) {
      const f = r.factors?.[k];
      if (f == null) continue;
      for (const fk of Object.keys(f)) {
        if (!FACTOR_KEYS.has(fk)) bad(id, `factors.${k}.${fk} is not a key of the schema`);
      }
      if (typeof f.value !== 'number' || f.value < 0 || f.value > 10) bad(id, `factors.${k}.value out of range: ${f.value}`);
      if (!SET_BY.has(f.setBy)) bad(id, `factors.${k}.setBy must be agent: every rating comes from the research agent`);
      if (f.setBy === 'agent' && !(f.source && https(f.source))) bad(id, `factors.${k} is agent-set but carries no https source`);
      if (f.sources != null && !(Array.isArray(f.sources) && f.sources.every(https))) bad(id, `factors.${k}.sources must be https URLs`);
      if (markup(f.note)) bad(id, `factors.${k}.note contains < or >`);
    }
    if (r.criticScore !== undefined) bad(id, 'legacy top-level criticScore: migrate to factors.critical');
    if (r.opened != null && (typeof r.opened !== 'number' || r.opened < 1900 || r.opened > new Date(nowMs).getUTCFullYear())) {
      bad(id, `opened is not a plausible year: ${r.opened}`);
    }
    if (r.priceIndex != null && ![1, 2, 3, 4].includes(r.priceIndex)) bad(id, `priceIndex must be 1-4: ${r.priceIndex}`);
    // A star average or a review count cannot be kept current: the platforms
    // that hold them refuse automated reads. An entry that carried one would
    // hold a figure nothing can re-check, so the key itself is refused, empty
    // or not.
    if (r.crowd !== undefined) bad(id, 'crowd figures are not part of the dataset');

    const seenAddr = new Set();
    for (const loc of Array.isArray(r.locations) ? r.locations : []) {
      const where = `location "${loc?.address ?? '?'}"`;
      for (const k of Object.keys(loc ?? {})) {
        if (!LOCATION_KEYS.has(k)) bad(id, `${where}: "${k}" is not a key of the schema`);
      }
      if (typeof loc?.neighborhood !== 'string' || !loc.neighborhood.trim()) bad(id, `${where}: neighborhood missing`);
      if (typeof loc?.address !== 'string' || !/^\s*\d/.test(loc.address)) { bad(id, `${where}: not a street address`); continue; }
      if (markup(loc.address) || markup(loc.neighborhood)) bad(id, `${where}: address or neighborhood contains < or >`);
      if (!PUGET_SOUND_ZIP.test(loc.address)) bad(id, `${where}: no Puget Sound ZIP`);
      const box = PUGET_SOUND_BOX;
      if (loc.lat != null && !(loc.lat > box.latMin && loc.lat < box.latMax)) bad(id, `${where}: lat ${loc.lat} outside Puget Sound`);
      if (loc.lon != null && !(loc.lon > box.lonMin && loc.lon < box.lonMax)) bad(id, `${where}: lon ${loc.lon} outside Puget Sound`);
      const key = loc.address.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
      if (seenAddr.has(key)) bad(id, `${where}: duplicate address`);
      seenAddr.add(key);
    }

    for (const m of Array.isArray(r.mentions) ? r.mentions : []) {
      for (const k of Object.keys(m ?? {})) {
        if (!MENTION_KEYS.has(k)) bad(id, `mention "${m?.title ?? '?'}": "${k}" is not a key of the schema`);
      }
      if (!https(m?.url)) bad(id, `mention "${m?.title ?? '?'}" has no https url`);
      if (!pastDate(m?.date)) bad(id, `mention "${m?.title ?? '?'}" has a bad date`);
    }
  }
  return fails;
}

/*
 * Lint for data/candidates.json: only what this repository's own scripts
 * write into it.
 *
 * The geocoder gives a candidate coordinates and, when an address will not
 * resolve, the day it tried; the apply step keeps the serves sweep's cursor
 * at the top of the file. Those are checked. A candidate's name, address and
 * note are not: they are the permit register's text and a research pass's,
 * the page prints them as quoted data, and nothing a third party wrote may
 * stop a deploy. Coordinates are held to the box every location's are
 * (src/bounds.js), and they come as a pair, because the map plots a point or
 * nothing.
 *
 * Pure function of (file, nowMs). Returns the problems found, none for a
 * file with no candidates in it.
 */
export function checkCandidates(file, nowMs = Date.now()) {
  if (!Array.isArray(file?.candidates)) return ['candidates.json: candidates must be an array'];
  const fails = [];
  if (file.servesCursor !== undefined && !(Number.isInteger(file.servesCursor) && file.servesCursor >= 0)) {
    fails.push(`candidates.json: servesCursor must be a whole number from 0 up, got ${JSON.stringify(file.servesCursor)}`);
  }
  for (const c of file.candidates) {
    const who = `candidate "${String(c?.name ?? c?.key ?? '?').slice(0, 80)}"`;
    if ((c?.lat != null || c?.lon != null) && !inPugetSound(c.lat, c.lon)) {
      fails.push(`${who}: lat ${JSON.stringify(c.lat ?? null)}, lon ${JSON.stringify(c.lon ?? null)} is not a point inside Puget Sound`);
    }
    if (c?.geoTried != null) {
      const t = /^\d{4}-\d{2}-\d{2}$/.test(String(c.geoTried)) ? Date.parse(c.geoTried) : NaN;
      if (!(t <= nowMs + 864e5)) fails.push(`${who}: geoTried must be a past YYYY-MM-DD date, got ${JSON.stringify(c.geoTried)}`);
    }
  }
  return fails;
}
