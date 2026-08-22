#!/usr/bin/env node
/*
 * Prints the handful of entries whose locations most need verifying.
 *
 * The agent gets a short explicit worklist rather than reading a 25-entry file
 * with long blurbs and deciding for itself. That cost turns and context on a
 * decision a sort makes better, and turns are what this workflow keeps running
 * out of.
 *
 * Order is locationWorklist(): placeholders first, since "Multiple locations"
 * and "Citywide" are actively wrong on the page rather than merely unverified;
 * then never-verified; then stalest.
 *
 *   node pizza/scripts/next-locations.mjs [count]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { locationWorklist } from '../src/locations.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { restaurants } = JSON.parse(fs.readFileSync(path.join(root, 'data/restaurants.json'), 'utf8'));
const count = Number(process.argv[2] || 5);

for (const r of locationWorklist(restaurants).slice(0, count)) {
  const state = r.neighborhoodIsPlaceholder
    ? `PLACEHOLDER, stored as "${r.neighborhood}" — find every branch`
    : (r.locations ?? []).length
      ? `${r.locations.length} site(s) verified ${r.locationsVerified}`
      : `UNVERIFIED, stored as "${r.neighborhood}"`;
  console.log(`- id: ${r.id} | ${r.name} | site: ${r.url ?? 'unknown, search for it'} | ${state}`);
}
