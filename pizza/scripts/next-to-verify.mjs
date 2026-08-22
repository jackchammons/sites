#!/usr/bin/env node
/*
 * Prints the handful of restaurants most in need of verified crowd figures.
 *
 * The research agent used to read restaurants.json itself and decide. That cost
 * turns and context on a 25-entry file with long blurbs, for a decision a sort
 * makes better. This hands it a short, explicit worklist instead.
 *
 *   node pizza/scripts/next-to-verify.mjs [count]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { restaurants } = JSON.parse(fs.readFileSync(path.join(root, 'data/restaurants.json'), 'utf8'));
const count = Number(process.argv[2] || 5);

// Unverified first (they cannot be promoted at all until confirmed), then the
// stalest. Date.parse(null) is NaN, so unverified sorts first on its own.
const ranked = [...restaurants].sort((a, b) => {
  const av = a.crowd ? 1 : 0, bv = b.crowd ? 1 : 0;
  if (av !== bv) return av - bv;
  return (Date.parse(a.lastVerified) || 0) - (Date.parse(b.lastVerified) || 0);
});

for (const r of ranked.slice(0, count)) {
  const state = r.crowd ? `has ${r.crowd.rating}★/${r.crowd.reviews}, last checked ${r.lastVerified}` : 'UNVERIFIED';
  console.log(`- id: ${r.id} | ${r.name} | ${r.neighborhood} | ${state}`);
}
