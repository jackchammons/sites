/* Writes everything a build produces: dist/ (page, modules, vendor assets,
 * rankings.json) and the weekly snapshot in data/history.json. */
import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_WEIGHTS } from '../src/slice.js';
import { locationLabel } from '../src/locations.js';

export function writeDist(dist, ctx, html) {
  const { root, dataset, now, week, ranked, allScored, baseline, brackets } = ctx;
  /* ---- emit ---- */
  fs.rmSync(dist, { recursive: true, force: true });
  fs.mkdirSync(dist, { recursive: true });
  fs.writeFileSync(path.join(dist, 'index.html'), html);
  // Every module app.js can reach at runtime, including render.js's own imports.
  // Missing one is a 404 in the browser and a dead re-ranker; verify.mjs walks
  // the import graph to catch it.
  for (const f of ['slice.js', 'render.js', 'locations.js', 'app.js']) {
    fs.copyFileSync(path.join(root, 'src', f), path.join(dist, f));
  }
  fs.copyFileSync(path.join(root, 'src/vendor/leaflet.js'), path.join(dist, 'leaflet.js'));
  fs.writeFileSync(path.join(dist, '.nojekyll'), '');
  fs.writeFileSync(path.join(dist, 'rankings.json'), JSON.stringify({
    builtAt: now.toISOString(),
    week,
    algorithm: 'SLICE v2',
    weights: DEFAULT_WEIGHTS,
    rankings: allScored.map(r => ({
      rank: r.rank, id: r.id, name: r.name, neighborhood: locationLabel(r),
      locations: r.locations ?? [], locationsVerified: r.locationsVerified ?? null,
      style: r.style, styleGroup: r.styleGroup,
      status: r.status ?? 'open',
      score: r.score, previousRank: baseline[r.id] ?? null,
      factors: r.factorScores, penalty: r.penaltyApplied
    })),
    directory: dataset.restaurants.map(r => ({
      id: r.id, name: r.name, url: r.url ?? null, status: r.status ?? 'open',
      neighborhood: locationLabel(r), locations: r.locations ?? []
    })),
    brackets: brackets.map(b => ({
      group: b.group, contenders: b.list.length,
      winner: { id: b.list[0].id, name: b.list[0].name, score: b.list[0].score }
    }))
  }, null, 2));
}

export function writeSnapshot(ctx) {
  const { root, dataset, now, week, weekKey, ranked, allScored, history } = ctx;
  const historyPath = path.join(root, 'data/history.json');
  /* ---- record this week's standings ----
   * One snapshot per ISO week; a rerun inside the same week overwrites it. */
  /* Full scored field, not just the ten: weekly deltas can then say
   * "was #14 last week" for a climber, and the factor breakdowns let next
   * week's build explain WHY an entry moved. */
  const r1 = n => Math.round(n * 10) / 10;
  const snapshot = {
    weekKey,
    date: now.toISOString().slice(0, 10),
    week,
    ranks: Object.fromEntries(allScored.map(r => [r.id, r.rank])),
    scores: Object.fromEntries(allScored.map(r => [r.id, r.score])),
    factors: Object.fromEntries(allScored.map(r => [r.id, {
      ...Object.fromEntries(Object.entries(r.factorScores).map(([k, v]) => [k, r1(v)])),
      penalty: r1(r.penaltyApplied)
    }]))
  };
  const last = history.snapshots.at(-1);
  if (last && last.weekKey === weekKey) history.snapshots.pop();
  history.snapshots.push(snapshot);
  history.snapshots = history.snapshots.slice(-52);

  const serialised = JSON.stringify(history, null, 2) + '\n';
  if (!fs.existsSync(historyPath) || fs.readFileSync(historyPath, 'utf8') !== serialised) {
    fs.writeFileSync(historyPath, serialised);
  }
}
