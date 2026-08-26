#!/usr/bin/env node
/*
 * Fills lat/lon for any location that lacks them, using Nominatim.
 *
 * Runs in publish.yml before the build; results are cached into
 * restaurants.json and committed by the existing data-refresh step, so each
 * address is geocoded once, ever. Nominatim's usage policy asks for one
 * request per second and an identifying User-Agent, both honoured here.
 * Fail-soft throughout: an address that will not geocode is logged and
 * skipped, and the map simply renders without that marker.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataPath = path.join(root, 'data/restaurants.json');
const d = JSON.parse(fs.readFileSync(dataPath, 'utf8'));

const UA = 'seattle-pizza-index/2.0 (https://sites.jackhammons.com/pizza/)';
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Sanity box around Puget Sound; a geocode outside it is a mismatch, not a fact.
const inRange = (lat, lon) => lat > 46.5 && lat < 48.8 && lon > -123.5 && lon < -121.0;

// Nominatim chokes on suite numbers ("Suite J1", "#102") and building names.
// The street address alone still pins the right rooftop.
const simplify = addr => addr
  .replace(/,?\s*(suite|ste\.?|unit|#)\s*[\w-]+/i, '')
  .replace(/\s{2,}/g, ' ');

async function lookup(addr) {
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(addr)}`;
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const hit = (await res.json())[0];
  if (hit && inRange(Number(hit.lat), Number(hit.lon))) return hit;
  return null;
}

let pending = [];
for (const r of d.restaurants) {
  for (const loc of r.locations ?? []) {
    if (loc.lat == null || loc.lon == null) pending.push({ r, loc });
  }
}
if (!pending.length) {
  console.log('geocode: nothing to do.');
  process.exit(0);
}
console.log(`geocode: ${pending.length} address(es) missing coordinates.`);

let filled = 0, failed = 0;
for (const { r, loc } of pending) {
  try {
    let hit = await lookup(loc.address);
    if (!hit && simplify(loc.address) !== loc.address) {
      await sleep(1100);
      hit = await lookup(simplify(loc.address));
    }
    if (hit) {
      loc.lat = Math.round(Number(hit.lat) * 1e5) / 1e5;
      loc.lon = Math.round(Number(hit.lon) * 1e5) / 1e5;
      filled++;
      console.log(`  + ${r.name}: ${loc.neighborhood} -> ${loc.lat}, ${loc.lon}`);
    } else {
      failed++;
      console.log(`  ? ${r.name}: no usable result for "${loc.address}"`);
    }
  } catch (e) {
    failed++;
    console.log(`  ! ${r.name}: ${e.message}`);
  }
  await sleep(1100);
}

if (filled) {
  fs.writeFileSync(dataPath, JSON.stringify(d, null, 2) + '\n');
}
console.log(`geocode: ${filled} filled, ${failed} skipped.`);
