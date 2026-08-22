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
const CAPS = { news: 20, candidates: 15, closures: 10 };
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
const sections = { news, candidates: doc.candidates ?? [], closures: doc.closures ?? [] };
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
