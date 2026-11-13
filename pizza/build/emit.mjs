/* Writes everything a build produces: the output directory (page, modules,
 * vendor assets, rankings.json) and the weekly snapshot in data/history.json. */
import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_WEIGHTS, ALGORITHM } from '../src/slice.js';

const r1 = n => Math.round(n * 10) / 10;
import { locationLabel } from '../src/locations.js';

export function writeDist(dist, ctx, html) {
  const { root, now, week, allScored, baseline, brackets } = ctx;
  /* ---- emit ---- */
  // Clearing the target is only safe when it is a previous build or empty: OUT_DIR=. would
  // otherwise delete this site's source.
  const holdsSource = dist === root || root.startsWith(dist + path.sep);
  const foreign = fs.existsSync(dist) && fs.readdirSync(dist).length > 0
    && !fs.existsSync(path.join(dist, 'index.html'));
  if (holdsSource || foreign) {
    console.error(`refusing to clear ${dist}: it is not an empty directory or a previous build`);
    process.exit(1);
  }
  fs.rmSync(dist, { recursive: true, force: true });
  fs.mkdirSync(dist, { recursive: true });
  fs.writeFileSync(path.join(dist, 'index.html'), html);
  // Every module app.js can reach at runtime. Missing one is a 404 in the
  // browser; verify.mjs walks the import graph to catch it.
  for (const f of ['app.js', 'search.js', 'palette.js']) {
    fs.copyFileSync(path.join(root, 'src', f), path.join(dist, f));
  }
  // app.js fetches this one itself, when the map is about to be seen.
  fs.copyFileSync(path.join(root, 'src/vendor/leaflet.js'), path.join(dist, 'leaflet.js'));
  fs.writeFileSync(path.join(dist, '.nojekyll'), '');
  fs.writeFileSync(path.join(dist, 'rankings.json'), JSON.stringify({
    builtAt: now.toISOString(),
    week,
    algorithm: ALGORITHM,
    weights: DEFAULT_WEIGHTS,
    rankings: allScored.map(r => ({
      rank: r.rank, id: r.id, name: r.name, neighborhood: locationLabel(r),
      locations: r.locations ?? [], locationsVerified: r.locationsVerified ?? null,
      style: r.style, styleGroup: r.styleGroup,
      status: r.status ?? 'open',
      score: r.score, previousRank: baseline[r.id] ?? null,
      factors: Object.fromEntries(Object.entries(r.factorScores).map(([k, v]) => [k, r1(v)])),
      penalty: r1(r.penaltyApplied)
    })),
    directory: ctx.registry.entries.map(r => ({
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
  const snapshot = {
    weekKey,
    date: now.toISOString().slice(0, 10),
    week,
    algorithm: ALGORITHM,
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
  /* Bound growth: ranks/scores stay the full 52 weeks (the bump chart needs
   * them), but factor breakdowns only serve evidence lines, which look one
   * week back. Strip them beyond 13 weeks — every write self-heals the file,
   * so no migration pass is needed. */
  for (const s of history.snapshots.slice(0, -13)) delete s.factors;

  const serialised = JSON.stringify(history, null, 2) + '\n';
  if (!fs.existsSync(historyPath) || fs.readFileSync(historyPath, 'utf8') !== serialised) {
    fs.writeFileSync(historyPath, serialised);
  }
}
