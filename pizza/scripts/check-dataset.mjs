#!/usr/bin/env node
/*
 * CLI wrapper for src/check-dataset.js — lints data/restaurants.json.
 *
 *   node pizza/scripts/check-dataset.mjs               lint, write nothing
 *   node pizza/scripts/check-dataset.mjs --normalize   put every entry into
 *       the schema's shape first (src/schema.js: every key present, in one
 *       order, an empty value where there is nothing on file), write the file
 *       back if that changed it, then lint the result
 *
 * --normalize is for a dataset that was written before a key existed, or
 * edited by hand: it changes no value, so it is safe to run on any checkout.
 * The file is serialised exactly as apply-research.mjs writes it.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkDataset, MISSING_KEYS } from '../src/check-dataset.js';
import { normalizeDataset, serializeDataset } from '../src/schema.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataPath = path.join(root, 'data/restaurants.json');
const args = process.argv.slice(2);
if (args.some(a => a !== '--normalize')) {
  console.error(`unrecognised argument "${args.find(a => a !== '--normalize')}" (the only option is --normalize)`);
  process.exit(2);
}

const text = fs.readFileSync(dataPath, 'utf8');
let dataset = JSON.parse(text);
const registryPath = path.join(root, 'data/attributes.json');
const registry = fs.existsSync(registryPath) ? JSON.parse(fs.readFileSync(registryPath, 'utf8')) : {};

if (args.includes('--normalize') && Array.isArray(dataset?.restaurants)) {
  const normalized = normalizeDataset(dataset);
  const changed = normalized.restaurants
    .filter((r, i) => JSON.stringify(r) !== JSON.stringify(dataset.restaurants[i])).length;
  const out = serializeDataset(normalized);
  if (out !== text) fs.writeFileSync(dataPath, out);
  console.log(`restaurants.json normalised: ${changed} of ${normalized.restaurants.length} entries changed${
    out !== text ? '' : ', file left as it was'}.`);
  dataset = normalized;
}

const fails = checkDataset(dataset, registry);
if (fails.length) {
  console.error(`restaurants.json FAILED lint (${fails.length} problem(s)):`);
  for (const f of fails.slice(0, 30)) console.error('  ✗ ' + f);
  if (fails.some(f => f.includes(MISSING_KEYS))) {
    console.error('Entries that lack schema keys are put right by: node pizza/scripts/check-dataset.mjs --normalize');
  }
  process.exit(1);
}
console.log(`restaurants.json clean: ${dataset.restaurants.length} entries.`);
