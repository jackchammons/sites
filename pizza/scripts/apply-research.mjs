#!/usr/bin/env node
/*
 * Applies validated research to data/restaurants.json.
 *
 * Run only after verify-research.mjs passes. It applies status changes,
 * verified locations, discovered directory entries, mention records, proposed
 * factor ratings and new attribute-registry rows. Crowd figures are frozen -- their sources block automated
 * reads and no API key path is in use -- and pillar scores are editorial, so no
 * script writes either.
 *
 * Locations are the exception that proves the rule: a pizzeria publishes its own
 * addresses on a page that serves to anyone, so they are checkable in a way a
 * rating behind a 403 or an editorial judgement is not.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const researchPath = path.join(root, 'data/research.json');
const dataPath = path.join(root, 'data/restaurants.json');

if (!fs.existsSync(researchPath)) {
  console.log('No research.json — nothing to apply.');
  process.exit(0);
}

const research = JSON.parse(fs.readFileSync(researchPath, 'utf8'));
const dataset = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
const byId = new Map(dataset.restaurants.map(r => [r.id, r]));

const today = new Date().toISOString().slice(0, 10);
let updated = 0;

let changes = 0;

/* status: liveness confirmations. A confirmation with no change still
 * advances statusChecked, which is what rotates the audit worklist. */
for (const it of research.status ?? []) {
  const r = byId.get(it.id);
  if (!r) continue;
  const changed = r.status !== it.status;
  if (changed) {
    r.status = it.status;
    r.statusNote = it.note;
    r.statusSource = it.source;
    r.statusDate = it.date ?? today;
  }
  r.statusChecked = today;
  changes++;
  console.log(`  ${changed ? '!' : '='} ${r.name}: ${it.status}${changed ? '' : ' (confirmed)'}`);
}

/* directory: discovered pizzerias join the dataset unrated. */
const slug = s => s.toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
for (const it of research.directory ?? []) {
  const id = slug(it.name);
  if (byId.has(id)) continue;
  const entry = {
    id,
    name: it.name,
    neighborhood: it.neighborhood,
    style: it.style ?? null,
    blurb: it.note,
    url: it.url ?? null,
    status: it.status,
    statusSource: it.source,
    statusDate: today,
    statusChecked: today,
    attributes: {},
    locations: it.address ? [{ neighborhood: it.neighborhood, address: it.address }] : [],
    locationsVerified: null,
    locationsSource: null,
    mentions: []
  };
  dataset.restaurants.push(entry);
  byId.set(id, entry);
  changes++;
  console.log(`  + ${it.name} (${id}): ${it.status}, ${it.neighborhood}`);
}

/* mentions: coverage history feeding reputation and critical reception. */
for (const it of research.mentions ?? []) {
  const r = byId.get(it.id);
  if (!r) continue;
  r.mentions = r.mentions ?? [];
  if (r.mentions.some(m => m.url.toLowerCase() === it.url.toLowerCase())) continue;
  r.mentions.push({ url: it.url, title: it.title, source: it.source, date: it.date, kind: it.kind });
  r.mentions = r.mentions.slice(-50);
  changes++;
  console.log(`  ~ ${r.name}: mention from ${it.source}`);
}

/* factorRatings: the proposal that makes an unrated entry rankable. Applied
 * only to entries still missing a rating -- editorial and prior agent ratings
 * are never overwritten -- with provenance on every factor and lastVerified
 * set to today, since the entry was just researched. */
let ratedNow = 0;
for (const it of research.factorRatings ?? []) {
  const r = byId.get(it.id);
  if (!r) continue;
  if (r.factors?.craft && r.factors?.distinctiveness && typeof r.criticScore === 'number') continue;
  const src = (it.sources ?? [])[0];
  r.factors = r.factors ?? {};
  for (const k of ['craft', 'distinctiveness']) {
    if (!r.factors[k]) r.factors[k] = { value: it[k], setBy: 'agent', source: src, note: it.note, date: today };
  }
  r.criticScore = it.criticScore;
  if (it.opened != null && r.opened == null) r.opened = it.opened;
  if (it.priceIndex != null && r.priceIndex == null) r.priceIndex = it.priceIndex;
  if (it.styleGroup && !r.styleGroup) r.styleGroup = it.styleGroup.trim();
  r.lastVerified = today;
  ratedNow++;
  changes++;
  console.log(`  # ${r.name}: rated — craft ${it.craft}, distinctiveness ${it.distinctiveness}, critic ${it.criticScore} (${src})`);
}

/* newAttributes: registry rows plus the flags on the entries that need them. */
const registryPath = path.join(root, 'data/attributes.json');
if ((research.newAttributes ?? []).length) {
  const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
  for (const it of research.newAttributes) {
    if (registry[it.key]) continue;
    registry[it.key] = { label: it.label, ...(it.frictionCost != null ? { frictionCost: it.frictionCost } : {}) };
    for (const id of it.entries) {
      const r = byId.get(id);
      if (r) { r.attributes = r.attributes ?? {}; r.attributes[it.key] = true; }
    }
    changes++;
    console.log(`  # new attribute "${it.key}" (${it.label}) on ${it.entries.join(', ')}`);
  }
  fs.writeFileSync(registryPath, JSON.stringify(registry, null, 2) + '\n');
}

/* Locations replace whatever was stored rather than merging: the agent reads the
 * pizzeria's own locations page, so what it returns is the current set, and a
 * merge would keep a branch that has since closed. neighborhood is left alone as
 * the editorial fallback, but a placeholder like "Citywide" stops being used for
 * display the moment a real set of sites lands. */
let located = 0;
for (const it of research.locations ?? []) {
  const r = byId.get(it.id);
  if (!r) continue;
  // Carry geocoded coordinates over for any address that has not changed;
  // re-verifying an unchanged branch must not throw away its lat/lon.
  const coordKey = a => a.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const oldCoords = new Map((r.locations ?? [])
    .filter(l => l.lat != null)
    .map(l => [coordKey(l.address), { lat: l.lat, lon: l.lon }]));
  const sites = it.sites.map(s => ({
    neighborhood: s.neighborhood.trim(),
    address: s.address.trim(),
    ...(oldCoords.get(coordKey(s.address)) ?? {})
  }));
  const before = JSON.stringify(r.locations ?? []);
  r.locations = sites;
  r.locationsVerified = it.verified ?? today;
  r.locationsSource = it.source;
  delete r.neighborhoodIsPlaceholder;

  /* Every entry on the page should be a link, and verifying locations already
   * required finding the official site -- so the link comes free. Only filled
   * in when absent: a hand-set url is a deliberate choice (a Tom Douglas
   * restaurant page rather than the group homepage, say) and outranks the
   * origin guessed from a locations URL. */
  if (!r.url) {
    try { r.url = it.homepage ?? new URL(it.source).origin; }
    catch { /* validated upstream; a bad URL here just means no link */ }
  }
  located++;
  const changed = before !== JSON.stringify(sites);
  console.log(`  @ ${r.name}: ${sites.length} location(s)${changed ? '' : ' (unchanged)'} — ${sites.map(s => s.neighborhood).join(', ')}`);
}

if (changes || located) {
  dataset.dataVersion = today.slice(0, 7).replace('-', '.');
  const out = JSON.stringify(dataset, null, 2) + '\n';
  if (fs.readFileSync(dataPath, 'utf8') !== out) fs.writeFileSync(dataPath, out);
}

console.log(`\napplied: ${changes} change(s), ${located} location set(s) verified. ${ratedNow} newly rated.`);
