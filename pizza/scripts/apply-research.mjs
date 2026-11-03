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
import { matchEntry } from '../src/census.js';
import { normUrl, normTitle } from '../src/match.js';

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
 * advances statusChecked, which is what rotates the audit worklist.
 *
 * Two dates, kept apart on purpose: statusDate is when the status took
 * effect, as the source reports it, and stays null when the source does not
 * say; statusDetected is the day the pass recorded the change. Writing the
 * detection day into statusDate published a March 2024 closure as a 2026
 * one and listed it under "recently closed". */
for (const it of research.status ?? []) {
  const r = byId.get(it.id);
  if (!r) continue;
  const changed = r.status !== it.status;
  if (changed) {
    r.statusPrev = r.status;
    r.status = it.status;
    r.statusNote = it.note;
    r.statusSource = it.source;
    r.statusDate = it.date ?? null;
    r.statusDetected = today;
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
    statusDate: null,
    statusDetected: today,
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

/* mentions: coverage history feeding reputation and critical reception.
 * Dedup on a normalised URL (scheme, www, trailing slash, tracking params
 * stripped) OR a normalised title: the news pass re-files the same roundup
 * under a Google News redirect and the publisher's URL. */
for (const it of research.mentions ?? []) {
  const r = byId.get(it.id);
  if (!r) continue;
  r.mentions = r.mentions ?? [];
  if (r.mentions.some(m => normUrl(m.url) === normUrl(it.url) || normTitle(m.title) === normTitle(it.title))) continue;
  r.mentions.push({ url: it.url, title: it.title, source: it.source, date: String(it.date).slice(0, 10), kind: it.kind });
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
  if (r.factors?.craft && r.factors?.distinctiveness && r.factors?.critical) continue;
  const src = (it.sources ?? [])[0];
  const sources = (it.sources ?? []).slice(0, 4);
  r.factors = r.factors ?? {};
  for (const k of ['craft', 'distinctiveness']) {
    if (!r.factors[k]) r.factors[k] = { value: it[k], setBy: 'agent', source: src, sources, note: it.note, date: today };
  }
  // The proposal schema says criticScore; it lands as factors.critical so all
  // three graded factors share one shape and one provenance rule.
  r.factors.critical = { value: it.criticScore, setBy: 'agent', source: src, sources, note: it.note, date: today };
  r.ratingAttempted = today;
  if (it.opened != null && r.opened == null) r.opened = it.opened;
  if (it.priceIndex != null && r.priceIndex == null) r.priceIndex = it.priceIndex;
  if (it.styleGroup && !r.styleGroup) r.styleGroup = it.styleGroup.trim();
  r.lastVerified = today;
  ratedNow++;
  changes++;
  console.log(`  # ${r.name}: rated — craft ${it.craft}, distinctiveness ${it.distinctiveness}, critic ${it.criticScore} (${src})`);
}

/* ratingSkipped: the rating task tried and found no coverage. Recorded so the
 * worklist moves on; the entry is retried after a quarter. */
for (const it of research.ratingSkipped ?? []) {
  const r = byId.get(it.id);
  if (!r || (r.factors?.craft && r.factors?.distinctiveness && r.factors?.critical)) continue;
  r.ratingAttempted = today;
  r.ratingNote = it.note;
  changes++;
  console.log(`  . ${r.name}: no coverage found — ${it.note}`);
}

/* facts: founding year and price tier, fill-gaps-only. The two plain facts
 * reputation and value read, which an entry could otherwise never acquire
 * once rated (the rating apply was their only writer). */
for (const it of research.facts ?? []) {
  const r = byId.get(it.id);
  if (!r) continue;
  const did = [];
  if (it.opened != null && r.opened == null) { r.opened = it.opened; r.openedSource = it.source; did.push(`opened ${it.opened}`); }
  if (it.priceIndex != null && r.priceIndex == null) { r.priceIndex = it.priceIndex; r.priceSource = it.source; did.push(`price ${'$'.repeat(it.priceIndex)}`); }
  if (did.length) {
    changes++;
    console.log(`  = ${r.name}: ${did.join(', ')} (${it.source})`);
  }
}

/* news: stories the agent found that the feed sweep missed. Folded into
 * buzz.json so they survive the next pass overwriting research.json; the
 * sweep's own merge keeps them for its 120-day window and dedups on title. */
const buzzPath = path.join(root, 'data/buzz.json');
if ((research.news ?? []).length && fs.existsSync(buzzPath)) {
  const buzz = JSON.parse(fs.readFileSync(buzzPath, 'utf8'));
  const known = new Set(buzz.items.flatMap(b => [normUrl(b.url), normTitle(b.title)]));
  let added = 0;
  for (const it of research.news) {
    if (known.has(normUrl(it.url)) || known.has(normTitle(it.title))) continue;
    buzz.items.push({ title: it.title, url: it.url, source: it.source,
      published: new Date(it.published).toISOString(), kind: it.kind,
      mentions: it.mentions ?? [], via: 'research' });
    known.add(normUrl(it.url)); known.add(normTitle(it.title));
    added++;
  }
  if (added) {
    buzz.items.sort((a, b) => Date.parse(b.published) - Date.parse(a.published));
    fs.writeFileSync(buzzPath, JSON.stringify(buzz, null, 2) + '\n');
    changes += added;
    console.log(`  + ${added} researched stor${added === 1 ? 'y' : 'ies'} folded into buzz.json`);
  }
}

/* links: an entry's canonical web presence. Instagram is a pointer, not a
 * judgment, so a fresher one replaces the stored one. website fills in only
 * when the entry has no url at all -- the locations pass owns correcting an
 * existing official site, and for a place with no site of its own this is
 * where the best available link (often the Instagram itself) lands. */
for (const it of research.links ?? []) {
  const r = byId.get(it.id);
  if (!r) continue;
  const did = [];
  if (it.instagram && r.instagram !== it.instagram) { r.instagram = it.instagram; did.push('instagram'); }
  if (it.website && !r.url) { r.url = it.website; did.push('website'); }
  if (did.length) {
    changes++;
    console.log(`  & ${r.name}: ${did.join(' + ')}`);
  }
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
   * required finding the official site -- so the link comes free. A homepage
   * the agent actually read replaces whatever is stored: three ranked entries
   * linked a 404 or a dead domain while the working site sat in
   * locationsSource. With no homepage reported, the origin of the locations
   * page fills an empty url only (a hand-set deep link is a deliberate choice). */
  if (it.homepage && it.homepage !== r.url) {
    console.log(`    url: ${r.url ?? '(none)'} -> ${it.homepage}`);
    r.url = it.homepage;
  } else if (!r.url) {
    try { r.url = new URL(it.source).origin; }
    catch { /* validated upstream; a bad URL here just means no link */ }
  }
  located++;
  const changed = before !== JSON.stringify(sites);
  console.log(`  @ ${r.name}: ${sites.length} location(s)${changed ? '' : ' (unchanged)'} — ${sites.map(s => s.neighborhood).join(', ')}`);
}

/* candidateReview: census verdicts drain the registry queue. Promotions need
 * no record of their own -- any candidate whose name now matches a dataset
 * entry (usually one the same run just added through `directory`) is marked
 * promoted here, and verdicts mark the rest so they stop re-entering census
 * worklists. */
const candidatesPath = path.join(root, 'data/candidates.json');
if (fs.existsSync(candidatesPath)) {
  const candFile = JSON.parse(fs.readFileSync(candidatesPath, 'utf8'));
  let candChanges = 0;
  for (const it of research.candidateReview ?? []) {
    // Same-name candidates are branches of one business (permits are
    // per-location); one verdict resolves them all.
    const matches = candFile.candidates.filter(x =>
      x.status === 'pending' && x.name.toLowerCase().trim() === String(it.name).toLowerCase().trim());
    if (!matches.length) { console.warn(`  ? candidateReview names no pending candidate: "${it.name}"`); continue; }
    for (const c of matches) {
      c.status = it.verdict === 'chain' ? 'chain' : 'rejected';
      c.verdict = it.verdict;
      c.note = it.note;
      if (it.source && /^https:/i.test(it.source)) c.resolutionSource = it.source;
      c.resolvedDate = today;
      candChanges++;
    }
    console.log(`  - candidate "${it.name}": ${it.verdict} (${matches.length} location(s))`);
  }
  for (const c of candFile.candidates) {
    if (c.status !== 'pending') continue;
    const matched = matchEntry(c, dataset.restaurants);
    if (matched) {
      c.status = 'promoted';
      c.matchedId = matched.id;
      c.resolvedDate = today;
      candChanges++;
      console.log(`  ^ candidate "${c.name}" promoted -> ${matched.id}`);
    }
  }
  if (candChanges) {
    fs.writeFileSync(candidatesPath, JSON.stringify(candFile, null, 2) + '\n');
    changes += candChanges;
  }
}

if (changes || located) {
  dataset.dataVersion = today.slice(0, 7).replace('-', '.');
  const out = JSON.stringify(dataset, null, 2) + '\n';
  if (fs.readFileSync(dataPath, 'utf8') !== out) fs.writeFileSync(dataPath, out);
}

console.log(`\napplied: ${changes} change(s), ${located} location set(s) verified. ${ratedNow} newly rated.`);
