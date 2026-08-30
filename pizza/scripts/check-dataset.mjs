#!/usr/bin/env node
/* CLI wrapper for src/check-dataset.js — lints data/restaurants.json. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkDataset } from '../src/check-dataset.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataset = JSON.parse(fs.readFileSync(path.join(root, 'data/restaurants.json'), 'utf8'));
const registryPath = path.join(root, 'data/attributes.json');
const registry = fs.existsSync(registryPath) ? JSON.parse(fs.readFileSync(registryPath, 'utf8')) : {};

const fails = checkDataset(dataset, registry);
if (fails.length) {
  console.error(`restaurants.json FAILED lint (${fails.length} problem(s)):`);
  for (const f of fails.slice(0, 30)) console.error('  ✗ ' + f);
  process.exit(1);
}
console.log(`restaurants.json clean: ${dataset.restaurants.length} entries.`);
