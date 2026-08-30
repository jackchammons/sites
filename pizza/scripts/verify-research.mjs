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

const { fails, sections } = validateResearch(doc, dataset, registry, Date.now(),
  candidates ? { candidates } : {});

if (fails.length) {
  console.error(`research.json FAILED validation (${fails.length} problem(s)):`);
  for (const f of fails.slice(0, 25)) console.error('  ✗ ' + f);
  process.exit(1);
}
const counts = Object.entries(sections).map(([k, v]) => `${v.length} ${k}`).join(', ');
console.log(`research.json valid: ${counts}.`);
