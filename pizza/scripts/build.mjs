#!/usr/bin/env node
/*
 * Static site build: load data, derive the ranking, render sections, write
 * dist/ and the weekly snapshot. Each step is a pure module under
 * pizza/build/; this file only composes them.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadContext } from '../build/load.mjs';
import { deriveContext } from '../build/derive.mjs';
import { pageHtml } from '../build/page.mjs';
import { writeDist, writeSnapshot } from '../build/emit.mjs';
import { controlsParts } from '../build/sections/controls.mjs';
import { recordSection } from '../build/sections/record.mjs';
import { bracketsSection } from '../build/sections/brackets.mjs';
import { radarSection } from '../build/sections/radar.mjs';
import { buzzSection } from '../build/sections/buzz.mjs';
import { directorySection } from '../build/sections/directory.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Output dir is overridable so the multi-site build can place this site at
// dist/<slug>/ while a standalone run still writes to dist/.
const dist = process.env.OUT_DIR
  ? path.resolve(process.env.OUT_DIR)
  : path.join(root, '..', 'dist');

const ctx = deriveContext(loadContext(root));
ctx.css = fs.readFileSync(path.join(root, 'src/styles.css'), 'utf8');
ctx.leafletCss = fs.readFileSync(path.join(root, 'src/vendor/leaflet.css'), 'utf8');

const html = pageHtml(ctx, {
  controls: controlsParts(ctx),
  recordSection: recordSection(ctx),
  bracketSection: bracketsSection(ctx),
  radarSection: radarSection(ctx),
  buzzSection: buzzSection(ctx),
  directorySection: directorySection(ctx)
});

writeDist(dist, ctx, html);
writeSnapshot(ctx);

const { ranked, week } = ctx;
console.log(`Built ${ranked.length} entries -> ${path.relative(process.cwd(), dist) || dist}/  (ISO week ${week})`);
for (const r of ranked) {
  const mv = r.previousRank == null ? 'new' : r.previousRank === r.rank ? '  -' :
    (r.previousRank > r.rank ? `+${r.previousRank - r.rank}` : `${r.previousRank - r.rank}`);
  console.log(`  ${String(r.rank).padStart(2)}. ${r.score.toFixed(1).padStart(5)}  ${mv.padStart(4)}  ${r.name}`);
}
