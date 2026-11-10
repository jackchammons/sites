/*
 * Lint for data/restaurants.json — the dataset the whole site is computed
 * from. apply-research writes it and the build trusts it, so this gate runs
 * before any build and after any apply: a bad write fails the run instead of
 * shipping as a symptom for verify.mjs to maybe notice in the rendered page.
 *
 * Pure function of (dataset, registry, nowMs); the CLI wrapper does the I/O.
 */
import { PUGET_SOUND_ZIP, PUGET_SOUND_BOX } from './bounds.js';

const STATUSES = new Set(['open', 'opening', 'closed']);
const SET_BY = new Set(['editorial', 'agent']);
const FACTOR_KEYS = ['craft', 'distinctiveness', 'critical'];
/* The clocks apply-research stamps. Freshness, the worklists and the radar all
 * read them, so one in the future holds an entry fresh, or out of a worklist,
 * until that day comes. */
const STAMPS = ['statusChecked', 'statusDetected', 'locationsVerified', 'locationsAttempted',
  'ratingAttempted', 'factsAttempted'];
/* Free text the page prints. The research validator refuses angle brackets in
 * what the agent writes; this holds a hand edit to the same rule, because the
 * map popup is assembled from these strings in the browser. */
const TEXT = ['name', 'neighborhood', 'style', 'styleGroup', 'blurb',
  'statusNote', 'ratingNote', 'factsNote', 'locationsNote'];

export function checkDataset(dataset, registry = {}, nowMs = Date.now()) {
  const fails = [];
  const bad = (id, msg) => fails.push(`${id}: ${msg}`);

  for (const k of ['city', 'dataVersion', 'cityMeanRating', 'priorWeight']) {
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
    if (r.openedSource != null && !https(r.openedSource)) bad(id, `openedSource must be https`);
    if (r.priceSource != null && !https(r.priceSource)) bad(id, `priceSource must be https`);
    for (const k of STAMPS) if (r[k] != null && !pastDate(r[k])) bad(id, `${k} is not a past date`);
    if (r.crowd?.observed != null && !pastDate(r.crowd.observed)) bad(id, `crowd.observed is not a past date`);
    if (r.url != null && !https(r.url)) bad(id, `url must be https, got "${r.url}"`);
    if (r.instagram != null && !/^https:\/\/(www\.)?instagram\.com\/[A-Za-z0-9._]{2,30}\/?$/.test(r.instagram)) {
      bad(id, `instagram must be an https instagram.com profile URL, got "${r.instagram}"`);
    }
    if (r.lastVerified != null && !pastDate(r.lastVerified)) bad(id, `lastVerified is not a past date: "${r.lastVerified}"`);

    // Every flag an entry carries must exist in the registry: the same apply
    // step that sets a new flag also writes its registry row, so a missing row
    // is a write that went wrong, not a style choice.
    for (const k of Object.keys(r.attributes ?? {})) {
      if (!registry[k]) bad(id, `attribute "${k}" is not in the registry`);
    }

    // Provenance: an agent may only hold a rating it can cite.
    for (const k of FACTOR_KEYS) {
      const f = r.factors?.[k];
      if (f == null) continue;
      if (typeof f.value !== 'number' || f.value < 0 || f.value > 10) bad(id, `factors.${k}.value out of range: ${f.value}`);
      if (!SET_BY.has(f.setBy)) bad(id, `factors.${k}.setBy must be editorial|agent`);
      if (f.setBy === 'agent' && !(f.source && https(f.source))) bad(id, `factors.${k} is agent-set but carries no https source`);
      if (f.sources != null && !(Array.isArray(f.sources) && f.sources.every(https))) bad(id, `factors.${k}.sources must be https URLs`);
      if (markup(f.note)) bad(id, `factors.${k}.note contains < or >`);
    }
    if (r.criticScore != null) bad(id, 'legacy top-level criticScore: migrate to factors.critical');
    if (r.opened != null && (typeof r.opened !== 'number' || r.opened < 1900 || r.opened > new Date(nowMs).getUTCFullYear())) {
      bad(id, `opened is not a plausible year: ${r.opened}`);
    }
    if (r.priceIndex != null && ![1, 2, 3, 4].includes(r.priceIndex)) bad(id, `priceIndex must be 1-4: ${r.priceIndex}`);
    if (r.crowd != null) {
      if (!(r.crowd.rating >= 1 && r.crowd.rating <= 5)) bad(id, `crowd.rating out of range: ${r.crowd.rating}`);
      if (!(r.crowd.reviews >= 0)) bad(id, `crowd.reviews out of range: ${r.crowd.reviews}`);
    }

    const seenAddr = new Set();
    for (const loc of r.locations ?? []) {
      const where = `location "${loc?.address ?? '?'}"`;
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

    for (const m of r.mentions ?? []) {
      if (!https(m?.url)) bad(id, `mention "${m?.title ?? '?'}" has no https url`);
      if (!pastDate(m?.date)) bad(id, `mention "${m?.title ?? '?'}" has a bad date`);
    }
  }
  return fails;
}
