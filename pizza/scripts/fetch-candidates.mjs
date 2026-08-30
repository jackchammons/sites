#!/usr/bin/env node
/*
 * Seeds/refreshes data/candidates.json — the discovery funnel's registry top.
 *
 * Two sources, both free, keyless, and machine-readable:
 *   - King County food-establishment inspection data (data.kingcounty.gov,
 *     Socrata). Every operating restaurant holds a health permit, which makes
 *     this the ground truth for "exists and serves food" — including places
 *     with no web presence at all. Inspection rows are deduped to businesses;
 *     a business whose latest inspection is older than the cutoff is dropped
 *     as likely gone.
 *   - OpenStreetMap via Overpass: cuisine=pizza amenities inside Seattle's
 *     admin boundary. Staler, but catches what permit-name filtering misses.
 *
 * Candidates are LEADS, not entries: the census research task verifies each
 * one through the validated `directory` channel before it can join the site.
 * Existing resolutions (promoted/rejected/chain) survive a refresh.
 *
 * Run by hand (or a dispatch) when the queue needs topping up:
 *   node pizza/scripts/fetch-candidates.mjs
 * Fail-soft per source: one registry being down still refreshes from the other.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mergeCandidates } from '../src/census.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outPath = path.join(root, 'data/candidates.json');
const dataset = JSON.parse(fs.readFileSync(path.join(root, 'data/restaurants.json'), 'utf8'));

const INSPECTION_CUTOFF_MONTHS = 30;

const title = s => String(s).toLowerCase().replace(/\b[a-z]/g, c => c.toUpperCase())
  .replace(/\bLlc\b/g, 'LLC').trim();

async function fromKingCounty() {
  // Inspection rows, newest first, name-filtered server-side; deduped to one
  // candidate per business_id client-side, keeping the latest inspection date.
  const url = 'https://data.kingcounty.gov/resource/r878-4sxa.json'
    + '?$select=business_id,name,address,city,zip_code,inspection_date,inspection_closed_business'
    + '&$where=' + encodeURIComponent(
      "city = 'SEATTLE' AND (upper(name) like '%PIZZ%' OR upper(name) like '%SLICE%')")
    + '&$order=inspection_date DESC&$limit=20000';
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`Socrata HTTP ${res.status}`);
  const rows = await res.json();
  const seen = new Map();
  for (const row of rows) {
    const id = row.business_id ?? `${row.name}|${row.address}`;
    if (seen.has(id)) continue;   // rows are newest-first, so first wins = latest inspection
    seen.set(id, row);
  }
  const cutoff = Date.now() - INSPECTION_CUTOFF_MONTHS * 30 * 864e5;
  const out = [];
  for (const row of seen.values()) {
    if (!row.name || !row.address) continue;
    if (Date.parse(row.inspection_date) < cutoff) continue;
    // The health department knows about closures before anyone else does.
    if (row.inspection_closed_business === 'Yes') continue;
    // Permit names carry store numbers up front ("#807 TUTTA BELLA").
    const cleanName = String(row.name).replace(/^#?\s*\d+\s+/, '');
    out.push({
      name: title(cleanName),
      address: `${title(row.address)}, Seattle, WA ${row.zip_code ?? ''}`.trim(),
      sources: ['kc-health'],
      lastInspection: String(row.inspection_date).slice(0, 10)
    });
  }
  return out;
}

async function fromOverpass() {
  const q = `[out:json][timeout:60];
area["name"="Seattle"]["boundary"="administrative"]["admin_level"="8"]->.sea;
( node["cuisine"~"pizza"](area.sea);
  way["cuisine"~"pizza"](area.sea); );
out center tags;`;
  // Mirrors tried in order: Overpass instances rate-limit and block ranges
  // unpredictably, and a seed refresh should survive any one of them sulking.
  const MIRRORS = ['https://overpass-api.de/api/interpreter',
                   'https://overpass.kumi.systems/api/interpreter',
                   'https://overpass.private.coffee/api/interpreter'];
  let json = null, lastErr = null;
  for (const url of MIRRORS) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: 'data=' + encodeURIComponent(q),
        signal: AbortSignal.timeout(70_000)
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      json = await res.json();
      break;
    } catch (e) { lastErr = e; }
  }
  if (!json) throw new Error(`all Overpass mirrors failed (${lastErr?.message})`);
  const out = [];
  for (const el of json.elements ?? []) {
    const t = el.tags ?? {};
    if (!t.name) continue;
    const lat = el.lat ?? el.center?.lat, lon = el.lon ?? el.center?.lon;
    const addr = t['addr:housenumber'] && t['addr:street']
      ? `${t['addr:housenumber']} ${t['addr:street']}, Seattle, WA ${t['addr:postcode'] ?? ''}`.trim()
      : null;
    out.push({
      name: t.name,
      ...(addr ? { address: addr } : {}),
      ...(lat != null ? { lat, lon } : {}),
      sources: ['osm'],
      ...(t.website ? { website: t.website } : {})
    });
  }
  return out;
}

const existing = fs.existsSync(outPath)
  ? JSON.parse(fs.readFileSync(outPath, 'utf8')).candidates
  : [];

const incoming = [];
for (const [label, fn] of [['kc-health', fromKingCounty], ['osm', fromOverpass]]) {
  try {
    const rows = await fn();
    console.log(`  ${label}: ${rows.length} candidate row(s)`);
    incoming.push(...rows);
  } catch (e) {
    console.warn(`  ! ${label} failed (${e.message}) — continuing without it`);
  }
}

if (!incoming.length && !existing.length) {
  console.error('No sources reachable and no stored queue; nothing written.');
  process.exit(1);
}

const candidates = mergeCandidates(existing, incoming, dataset.restaurants);
const stats = {};
for (const c of candidates) stats[c.status] = (stats[c.status] ?? 0) + 1;

fs.writeFileSync(outPath, JSON.stringify({
  updated: new Date().toISOString(),
  cutoffMonths: INSPECTION_CUTOFF_MONTHS,
  candidates
}, null, 2) + '\n');
console.log(`candidates.json: ${candidates.length} candidate(s) — ${
  Object.entries(stats).map(([k, v]) => `${v} ${k}`).join(', ')}`);
