#!/usr/bin/env node
/*
 * Refreshes the crowd ratings in data/restaurants.json from the Yelp Fusion API.
 *
 * Requires a YELP_API_KEY. Without one this exits 0 immediately and changes
 * nothing, so the daily build works with or without the secret configured.
 *
 * Only the crowd figures and lastVerified are touched. The pillar scores are
 * editorial judgments and are never written by a script -- if that ever changes,
 * the page's claim that they are applied by one rubric stops being true.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const KEY = process.env.YELP_API_KEY;
if (!KEY) {
  console.log('YELP_API_KEY not set — leaving crowd ratings unchanged.');
  process.exit(0);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataPath = path.join(root, 'data/restaurants.json');
const dataset = JSON.parse(fs.readFileSync(dataPath, 'utf8'));

/* Guard rails. A wrong match is worse than stale data, so a result has to look
 * like the same business and the numbers have to move plausibly. */
const MAX_RATING_JUMP = 0.4;   // a real aggregate does not lurch overnight
const MIN_NAME_SCORE = 0.6;

const norm = s => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\b(the|pizza|pizzeria|co|inc)\b/g, '').trim();

/* Token overlap — good enough to catch "Windy City Pie" vs "Windy City Pie - Phinney". */
function nameScore(a, b) {
  const A = new Set(norm(a).split(' ').filter(Boolean));
  const B = new Set(norm(b).split(' ').filter(Boolean));
  if (!A.size || !B.size) return 0;
  const hit = [...A].filter(t => B.has(t)).length;
  return hit / Math.min(A.size, B.size);
}

async function search(term) {
  const url = 'https://api.yelp.com/v3/businesses/search?'
    + new URLSearchParams({ term, location: 'Seattle, WA', categories: 'pizza', limit: '5' });
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${KEY}` },
    signal: AbortSignal.timeout(20000)
  });
  if (!res.ok) throw new Error(`Yelp ${res.status} for "${term}"`);
  return (await res.json()).businesses || [];
}

const today = new Date().toISOString().slice(0, 10);
let updated = 0, skipped = 0, failed = 0;

for (const r of dataset.restaurants) {
  try {
    const hits = await search(r.name);
    const scored = hits
      .map(b => ({ b, score: nameScore(r.name, b.name) }))
      .sort((x, y) => y.score - x.score)[0];

    if (!scored || scored.score < MIN_NAME_SCORE) {
      console.warn(`  ? ${r.name}: no confident match (best "${scored?.b.name ?? 'none'}")`);
      skipped++; continue;
    }
    const { rating, review_count: reviews, name } = scored.b;
    if (typeof rating !== 'number' || typeof reviews !== 'number') { skipped++; continue; }

    const drift = Math.abs(rating - r.crowd.rating);
    if (drift > MAX_RATING_JUMP) {
      console.warn(`  ! ${r.name}: rating moved ${r.crowd.rating} -> ${rating} (>${MAX_RATING_JUMP}); ignoring, check the match ("${name}")`);
      skipped++; continue;
    }
    if (reviews < r.crowd.reviews * 0.5) {
      console.warn(`  ! ${r.name}: review count fell ${r.crowd.reviews} -> ${reviews}; ignoring, likely a different listing ("${name}")`);
      skipped++; continue;
    }

    const changed = rating !== r.crowd.rating || reviews !== r.crowd.reviews;
    if (changed) {
      console.log(`  ✓ ${r.name}: ${r.crowd.rating}★/${r.crowd.reviews} -> ${rating}★/${reviews}`);
      r.crowd.rating = rating;
      r.crowd.reviews = reviews;
      updated++;
    }
    r.lastVerified = today;   // we did just check it, even if nothing moved
  } catch (e) {
    console.warn(`  x ${r.name}: ${e.message}`);
    failed++;
  }
}

if (failed === dataset.restaurants.length) {
  console.warn('Every Yelp lookup failed — leaving the dataset unchanged.');
  process.exit(0);
}

dataset.dataVersion = today.slice(0, 7).replace('-', '.');
const serialised = JSON.stringify(dataset, null, 2) + '\n';
if (fs.readFileSync(dataPath, 'utf8') !== serialised) fs.writeFileSync(dataPath, serialised);

console.log(`\nratings: ${updated} updated, ${skipped} skipped, ${failed} failed.`);
