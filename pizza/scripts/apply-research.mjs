#!/usr/bin/env node
/*
 * Applies validated research to data/restaurants.json.
 *
 * Run only after verify-research.mjs passes. It touches exactly one thing: the
 * crowd figures, plus the lastVerified stamp that goes with them. Pillar scores
 * are editorial and no script writes them -- the page claims they are applied by
 * one rubric, and generating them would make that claim false.
 *
 * Ratings researched here carry a source URL, which is what makes them
 * checkable; the guard rails in verify-research.mjs have already rejected
 * implausible movement before anything reaches this script.
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
let updated = 0, promoted = 0;

for (const it of research.ratings ?? []) {
  const r = byId.get(it.id);
  if (!r) continue;
  const before = r.crowd ? `${r.crowd.rating}★/${r.crowd.reviews}` : 'unrated';
  const firstRating = !r.crowd;
  r.crowd = { rating: it.rating, reviews: it.reviews };
  r.lastVerified = today;
  if (firstRating) {
    // A bench entry with verified figures is no longer provisional; whether it
    // actually promotes is decided by the score, not by this script.
    promoted++;
    console.log(`  ✓ ${r.name}: ${before} -> ${it.rating}★/${it.reviews}  (now verified)`);
  } else {
    console.log(`  ✓ ${r.name}: ${before} -> ${it.rating}★/${it.reviews}`);
  }
  updated++;
}

for (const it of research.closures ?? []) {
  const r = byId.get(it.id);
  if (!r) continue;
  r.reportedClosed = { note: it.note, source: it.source, date: it.date ?? today };
  console.log(`  ! ${r.name}: reported closed — ${it.note.slice(0, 60)}`);
}

if (updated || (research.closures ?? []).length) {
  dataset.dataVersion = today.slice(0, 7).replace('-', '.');
  const out = JSON.stringify(dataset, null, 2) + '\n';
  if (fs.readFileSync(dataPath, 'utf8') !== out) fs.writeFileSync(dataPath, out);
}

console.log(`\napplied: ${updated} rating(s) refreshed, ${promoted} newly verified, ` +
            `${(research.closures ?? []).length} closure(s) flagged.`);
