#!/usr/bin/env node
/*
 * Validates data/research.json — everything the research agent writes.
 *
 * This is the gate between an agent's output and the published site. The agent
 * writes its own file rather than editing restaurants.json or buzz.json
 * directly, and nothing it produces is used unless it passes every check here.
 *
 * Four sections, all optional:
 *   news       stories the feed sweep missed
 *   candidates pizzerias worth considering for the bench
 *   closures   places reported closed (relegation signals)
 *   locations  verified branches, read off the pizzeria's own site
 *
 * There is deliberately no ratings section: the sources that hold crowd
 * figures block automated reads, and no API key path is in use.
 *
 * A missing file is fine and exits 0: no research run yet, or no token.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const file = path.join(root, 'data/research.json');

if (!fs.existsSync(file)) {
  console.log('data/research.json not present — nothing to validate.');
  process.exit(0);
}

const dataset = JSON.parse(fs.readFileSync(path.join(root, 'data/restaurants.json'), 'utf8'));
const byId = new Map(dataset.restaurants.map(r => [r.id, r]));

const KINDS = new Set(['opening', 'closing', 'ranking', 'mention']);
const CAPS = { news: 20, candidates: 15, closures: 10, locations: 12 };
const MAX_AGE_DAYS = 180;

const fails = [];
const bad = (sec, i, msg) => fails.push(`${sec}[${i}]: ${msg}`);

let doc;
try { doc = JSON.parse(fs.readFileSync(file, 'utf8')); }
catch (e) { console.error(`research.json is not valid JSON: ${e.message}`); process.exit(1); }
if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
  console.error('research.json must be a JSON object.'); process.exit(1);
}

/* `items` was the original field name; keep reading it so older files still work. */
const news = doc.news ?? doc.items ?? [];
const sections = { news, candidates: doc.candidates ?? [], closures: doc.closures ?? [],
                   locations: doc.locations ?? [] };
if (Array.isArray(doc.ratings) && doc.ratings.length) {
  fails.push('ratings are no longer accepted: crowd figures are frozen, see CLAUDE.md');
}

for (const [name, arr] of Object.entries(sections)) {
  if (!Array.isArray(arr)) { fails.push(`${name} must be an array`); continue; }
  if (arr.length > CAPS[name]) fails.push(`${name}: ${arr.length} entries exceeds the ${CAPS[name]} cap`);
}
if (fails.length) report();

/* A claim we cannot check is not usable, so every section needs a live https source. */
const checkUrl = (sec, i, url, field = 'url') => {
  let u;
  try { u = new URL(url); } catch { bad(sec, i, `${field} is not a valid URL: ${url}`); return; }
  if (u.protocol !== 'https:') bad(sec, i, `${field} must be https: ${url}`);
};
const checkDate = (sec, i, v, field) => {
  const t = Date.parse(v);
  if (!Number.isFinite(t)) { bad(sec, i, `${field} is not a parseable date: ${v}`); return; }
  if (t > Date.now() + 864e5) bad(sec, i, `${field} is in the future: ${v}`);
  else if (t < Date.now() - MAX_AGE_DAYS * 864e5) bad(sec, i, `${field} is older than ${MAX_AGE_DAYS} days`);
};

const seen = new Set();
news.forEach((it, i) => {
  if (typeof it?.title !== 'string' || it.title.trim().length < 8) bad('news', i, 'title missing or too short');
  if (typeof it?.source !== 'string' || !it.source.trim()) bad('news', i, 'source missing');
  checkUrl('news', i, it?.url);
  checkDate('news', i, it?.published, 'published');
  if (!KINDS.has(it?.kind)) bad('news', i, `kind must be one of ${[...KINDS].join('|')}, got "${it?.kind}"`);
  for (const m of it?.mentions ?? []) if (!byId.has(m)) bad('news', i, `mentions unknown id "${m}"`);
  const key = String(it?.url || it?.title).toLowerCase();
  if (seen.has(key)) bad('news', i, 'duplicate of an earlier item');
  seen.add(key);
});

sections.candidates.forEach((it, i) => {
  if (typeof it?.name !== 'string' || it.name.trim().length < 2) bad('candidates', i, 'name missing');
  if (typeof it?.neighborhood !== 'string' || !it.neighborhood.trim()) bad('candidates', i, 'neighborhood missing');
  if (typeof it?.note !== 'string' || it.note.trim().length < 15) bad('candidates', i, 'note missing or too short');
  checkUrl('candidates', i, it?.source, 'source');
  if (byId.has(it?.id)) bad('candidates', i, `"${it.id}" is already ranked — not a candidate`);
});

sections.closures.forEach((it, i) => {
  if (!byId.has(it?.id)) bad('closures', i, `unknown restaurant id "${it?.id}"`);
  if (typeof it?.note !== 'string' || it.note.trim().length < 10) bad('closures', i, 'note missing or too short');
  checkUrl('closures', i, it?.source, 'source');
  if (it?.date) checkDate('closures', i, it.date, 'date');
});

/* ---- locations ----
 * Addresses are the one factual field an agent may write into the dataset,
 * because the business publishes them itself on a page that serves to anyone.
 * That makes them checkable, which crowd ratings (403) and pillar scores
 * (editorial) are not. These checks exist to catch a plausible invention: a
 * street address that is not one, a branch in another metro, the same branch
 * listed twice.
 */
/* Region check by ZIP, not by city name. The first version listed cities and
 * rejected a real Zeeks branch in Mill Creek on its first live run -- a chain
 * opens somewhere the list has never heard of and the gate calls the truth a
 * lie. ZIP prefixes are objective and need no maintenance as the field changes:
 *
 *   980xx  King and Snohomish suburbs (Bellevue, Kent, Mill Creek)
 *   981xx  Seattle proper
 *   982xx  Everett and north
 *   983xx  Kitsap and the Olympic Peninsula
 *   984xx  Pierce County (Tacoma)
 *   985xx  Thurston County (Olympia)
 *
 * That is wider than "Seattle metro" strictly means, and deliberately so: this
 * check exists to catch a fabricated address or an out-of-region outpost --
 * Spokane 992xx, Vancouver WA 986xx, Portland OR -- not to adjudicate which
 * suburbs count. A chain reporting its real Tacoma branch is telling the truth,
 * and a validator that calls that a lie is the more expensive failure. */
const PUGET_SOUND_ZIP = /\b98[0-5]\d{2}\b/;

sections.locations.forEach((it, i) => {
  if (!byId.has(it?.id)) bad('locations', i, `unknown restaurant id "${it?.id}"`);
  checkUrl('locations', i, it?.source, 'source');
  // Optional: omitted when a pizzeria genuinely has no site of its own.
  if (it?.homepage != null) checkUrl('locations', i, it.homepage, 'homepage');

  const sites = it?.sites;
  if (!Array.isArray(sites) || !sites.length) {
    bad('locations', i, 'sites must be a non-empty array');
    return;
  }
  if (sites.length > 40) bad('locations', i, `${sites.length} sites is implausible`);

  const seenSites = new Set();
  sites.forEach((st, j) => {
    const where = `sites[${j}]`;
    if (typeof st?.neighborhood !== 'string' || !st.neighborhood.trim()) {
      bad('locations', i, `${where}: neighborhood missing`);
    }
    const addr = st?.address;
    if (typeof addr !== 'string' || !addr.trim()) {
      bad('locations', i, `${where}: address missing`);
      return;
    }
    // A street address starts with a number and names a street. This rejects
    // "Capitol Hill" or "Seattle, WA" dressed up as an address.
    if (!/^\s*\d/.test(addr)) bad('locations', i, `${where}: address does not start with a street number: "${addr}"`);
    if (!/\bWA\b|\bWashington\b/i.test(addr)) bad('locations', i, `${where}: address is not in Washington: "${addr}"`);
    if (!PUGET_SOUND_ZIP.test(addr)) bad('locations', i, `${where}: no Puget Sound ZIP (980xx-983xx): "${addr}"`);
    const key = addr.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    if (seenSites.has(key)) bad('locations', i, `${where}: duplicate address "${addr}"`);
    seenSites.add(key);
  });
});

report();

function report() {
  if (fails.length) {
    console.error(`research.json FAILED validation (${fails.length} problem(s)):`);
    for (const f of fails.slice(0, 25)) console.error('  ✗ ' + f);
    process.exit(1);
  }
  const counts = Object.entries(sections).map(([k, v]) => `${v.length} ${k}`).join(', ');
  console.log(`research.json valid: ${counts}.`);
}
