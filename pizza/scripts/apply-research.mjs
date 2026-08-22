#!/usr/bin/env node
/*
 * Applies validated research to data/restaurants.json.
 *
 * Run only after verify-research.mjs passes. It applies closure flags, and
 * nothing else. Crowd figures are frozen -- their sources block automated reads
 * and no API key path is in use -- and pillar scores are editorial, so no
 * script writes either.
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

if ((research.closures ?? []).length) {
  dataset.dataVersion = today.slice(0, 7).replace('-', '.');
  const out = JSON.stringify(dataset, null, 2) + '\n';
  if (fs.readFileSync(dataPath, 'utf8') !== out) fs.writeFileSync(dataPath, out);
}

console.log(`\napplied: ${(research.closures ?? []).length} closure(s) flagged.`);
