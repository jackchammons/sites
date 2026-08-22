#!/usr/bin/env node
/*
 * Validates data/research.json — the file the research agent writes.
 *
 * This is the gate between an agent's output and the published site. The agent
 * writes to its own file rather than to buzz.json so it can never damage the
 * keyless feed pipeline, and nothing it produces is committed unless it passes
 * every check here.
 *
 * Missing file is fine and exits 0: no research run yet, or the step was
 * skipped for want of a token.
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

const KINDS = new Set(['opening', 'closing', 'ranking', 'mention']);
const MAX_ITEMS = 40;
const MAX_AGE_DAYS = 180;
const ids = new Set(
  JSON.parse(fs.readFileSync(path.join(root, 'data/restaurants.json'), 'utf8'))
    .restaurants.map(r => r.id)
);

const fails = [];
const bad = (i, msg) => fails.push(`item[${i}]: ${msg}`);

let doc;
try {
  doc = JSON.parse(fs.readFileSync(file, 'utf8'));
} catch (e) {
  console.error(`research.json is not valid JSON: ${e.message}`);
  process.exit(1);
}

if (!doc || !Array.isArray(doc.items)) {
  console.error('research.json must be an object with an "items" array.');
  process.exit(1);
}
if (doc.items.length > MAX_ITEMS) {
  fails.push(`${doc.items.length} items exceeds the ${MAX_ITEMS} cap`);
}

const seen = new Set();
doc.items.forEach((it, i) => {
  if (typeof it?.title !== 'string' || it.title.trim().length < 8) bad(i, 'title missing or too short');
  if (typeof it?.source !== 'string' || !it.source.trim()) bad(i, 'source missing');

  // A claim without a working public link is not usable here.
  let url;
  try { url = new URL(it?.url); } catch { bad(i, `url is not a valid URL: ${it?.url}`); }
  if (url && url.protocol !== 'https:') bad(i, `url must be https: ${it.url}`);

  const t = Date.parse(it?.published);
  if (!Number.isFinite(t)) bad(i, `published is not a parseable date: ${it?.published}`);
  else if (t > Date.now() + 864e5) bad(i, `published is in the future: ${it.published}`);
  else if (t < Date.now() - MAX_AGE_DAYS * 864e5) bad(i, `published is older than ${MAX_AGE_DAYS} days`);

  if (!KINDS.has(it?.kind)) bad(i, `kind must be one of ${[...KINDS].join('|')}, got "${it?.kind}"`);

  if (it?.mentions !== undefined) {
    if (!Array.isArray(it.mentions)) bad(i, 'mentions must be an array');
    else for (const m of it.mentions) {
      if (!ids.has(m)) bad(i, `mentions unknown restaurant id "${m}"`);
    }
  }

  const key = String(it?.url || it?.title).toLowerCase();
  if (seen.has(key)) bad(i, 'duplicate of an earlier item');
  seen.add(key);
});

if (fails.length) {
  console.error(`research.json FAILED validation (${fails.length} problem(s)):`);
  for (const f of fails.slice(0, 25)) console.error('  ✗ ' + f);
  process.exit(1);
}
console.log(`research.json valid: ${doc.items.length} item(s).`);
