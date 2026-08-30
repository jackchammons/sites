/*
 * Lint for data/restaurants.json — the dataset the whole site is computed
 * from. apply-research writes it and the build trusts it, so this gate runs
 * before any build and after any apply: a bad write fails the run instead of
 * shipping as a symptom for verify.mjs to maybe notice in the rendered page.
 *
 * Pure function of (dataset, registry, nowMs); the CLI wrapper does the I/O.
 */

const STATUSES = new Set(['open', 'opening', 'closed']);
const SET_BY = new Set(['editorial', 'agent']);
const PUGET_SOUND_ZIP = /\b98[0-5]\d{2}\b/;
const FACTOR_KEYS = ['craft', 'distinctiveness', 'critical'];

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

  const ids = new Set();
  for (const r of dataset.restaurants) {
    const id = r?.id ?? '(missing id)';
    if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) bad(id, 'id must be kebab-case');
    if (ids.has(id)) bad(id, 'duplicate id');
    ids.add(id);

    if (typeof r.name !== 'string' || !r.name.trim()) bad(id, 'name missing');
    if (!STATUSES.has(r.status)) bad(id, `status must be open|opening|closed, got "${r.status}"`);
    if (r.status !== 'open') {
      if (!r.statusSource || !https(r.statusSource)) bad(id, `status "${r.status}" needs an https statusSource`);
      if (r.status === 'closed' && !pastDate(r.statusDate)) bad(id, 'closed entries need a real statusDate');
    }
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
      if (!PUGET_SOUND_ZIP.test(loc.address)) bad(id, `${where}: no Puget Sound ZIP`);
      if (loc.lat != null && !(loc.lat > 46.5 && loc.lat < 48.5)) bad(id, `${where}: lat ${loc.lat} outside Puget Sound`);
      if (loc.lon != null && !(loc.lon > -123.5 && loc.lon < -121.5)) bad(id, `${where}: lon ${loc.lon} outside Puget Sound`);
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
