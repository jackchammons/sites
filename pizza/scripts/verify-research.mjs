#!/usr/bin/env node
/*
 * CLI gate for data/research.json — everything the research agent writes.
 *
 * The rules themselves live in src/validate-research.js as a pure function so
 * they are unit-tested in pizza/test/; this wrapper only does the I/O. Nothing
 * the agent produces is used downstream unless this exits 0.
 *
 * A missing file is fine and exits 0: no research run yet, or no token.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateResearch } from '../src/validate-research.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const file = path.join(root, 'data/research.json');

if (!fs.existsSync(file)) {
  console.log('data/research.json not present — nothing to validate.');
  process.exit(0);
}

let doc;
try { doc = JSON.parse(fs.readFileSync(file, 'utf8')); }
catch (e) { console.error(`research.json is not valid JSON: ${e.message}`); process.exit(1); }

const dataset = JSON.parse(fs.readFileSync(path.join(root, 'data/restaurants.json'), 'utf8'));
const registryPath = path.join(root, 'data/attributes.json');
const registry = fs.existsSync(registryPath) ? JSON.parse(fs.readFileSync(registryPath, 'utf8')) : {};

const candidatesPath = path.join(root, 'data/candidates.json');
const candidates = fs.existsSync(candidatesPath)
  ? JSON.parse(fs.readFileSync(candidatesPath, 'utf8')).candidates
  : null;

const { fails, fatal, accepted, unknown } = validateResearch(doc, dataset, registry, Date.now(),
  candidates ? { candidates } : {});

if (fatal) {
  console.error(`research.json FAILED validation (${fails.length} problem(s)):`);
  for (const f of fails.slice(0, 25)) console.error('  ✗ ' + f);
  process.exit(1);
}

/* Per-record rejection. Every record is validated on its own, so dropping
 * the ones that failed cannot let an unchecked claim through; rejecting the
 * whole file over one http:// source threw away three complete passes. The
 * accepted records are written back so apply-research reads exactly what
 * passed, and each drop is a workflow warning with the reason. */
if (fails.length) {
  console.warn(`research.json: ${fails.length} record(s) rejected, the rest accepted:`);
  for (const f of fails) {
    console.warn('  ✗ ' + f);
    console.log(`::warning title=research record rejected::${f}`);
  }
}

/* A top-level key that is no section is never applied, whatever it holds. A
 * misspelt section name is the usual cause, and without a warning the pass
 * would read as a clean one that found nothing. */
for (const k of unknown) {
  const n = Array.isArray(doc[k]) ? `${doc[k].length} record(s)` : 'its contents';
  console.warn(`  ✗ "${k}" is not a section; ${n} ignored`);
  console.log(`::warning title=research section ignored::"${k.slice(0, 60)}" is not a section of research.json, so ${n} were not applied. Check the spelling against the schema.`);
}

/* The file is rewritten whenever something was dropped, and holds only what
 * the gate knows: the timestamp, the accepted records and what was refused. */
if (fails.length || unknown.length) {
  const kept = {
    ...(typeof doc.updated === 'string' ? { updated: doc.updated.slice(0, 40) } : {}),
    ...Object.fromEntries(Object.entries(accepted).filter(([, v]) => v.length)),
    ...(fails.length ? { rejected: fails } : {}),
    ...(unknown.length ? { ignored: unknown.map(k => k.slice(0, 60)) } : {})
  };
  fs.writeFileSync(file, JSON.stringify(kept, null, 2) + '\n');
}
const counts = Object.entries(accepted).filter(([, v]) => v.length).map(([k, v]) => `${v.length} ${k}`).join(', ') || 'nothing';
console.log(`research.json valid: ${counts}.`);
