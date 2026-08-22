#!/usr/bin/env node
/*
 * Applies validated research to data/restaurants.json.
 *
 * Run only after verify-research.mjs passes. It applies closure flags and
 * verified locations. Crowd figures are frozen -- their sources block automated
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

for (const it of research.closures ?? []) {
  const r = byId.get(it.id);
  if (!r) continue;
  r.reportedClosed = { note: it.note, source: it.source, date: it.date ?? today };
  console.log(`  ! ${r.name}: reported closed — ${it.note.slice(0, 60)}`);
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
  const sites = it.sites.map(s => ({ neighborhood: s.neighborhood.trim(), address: s.address.trim() }));
  const before = JSON.stringify(r.locations ?? []);
  r.locations = sites;
  r.locationsVerified = it.verified ?? today;
  r.locationsSource = it.source;
  delete r.neighborhoodIsPlaceholder;
  located++;
  const changed = before !== JSON.stringify(sites);
  console.log(`  @ ${r.name}: ${sites.length} location(s)${changed ? '' : ' (unchanged)'} — ${sites.map(s => s.neighborhood).join(', ')}`);
}

if ((research.closures ?? []).length || located) {
  dataset.dataVersion = today.slice(0, 7).replace('-', '.');
  const out = JSON.stringify(dataset, null, 2) + '\n';
  if (fs.readFileSync(dataPath, 'utf8') !== out) fs.writeFileSync(dataPath, out);
}

console.log(`\napplied: ${(research.closures ?? []).length} closure(s) flagged, ${located} location set(s) verified.`);
