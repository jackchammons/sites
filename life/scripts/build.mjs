#!/usr/bin/env node
/*
 * Build for Life.
 *
 * The page is a white canvas and nothing else; the board is seeded and run in
 * the browser by src/app.js. Nothing about the game is decided at build time:
 * a random state baked into the markup would replay the same opening for every
 * visitor, which is the opposite of "random when the page opens".
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// The multi-site build sets OUT_DIR to dist/<slug>/; a standalone run writes the same place.
const dist = process.env.OUT_DIR
  ? path.resolve(process.env.OUT_DIR)
  : path.join(root, '..', 'dist', path.basename(root));

const data = JSON.parse(fs.readFileSync(path.join(root, 'data/data.json'), 'utf8'));
const esc = s => String(s).replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(data.title)}</title>
<meta name="description" content="${esc(data.tagline)}">
<meta name="color-scheme" content="light">
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 3 3' shape-rendering='crispEdges'><rect width='3' height='3' fill='white'/><rect x='1' y='0' width='1' height='1'/><rect x='2' y='1' width='1' height='1'/><rect x='0' y='2' width='3' height='1'/></svg>">
<style>
html,body{margin:0;padding:0;height:100%;overflow:hidden;background:#fff}
canvas{display:block}
noscript{position:fixed;inset:0;display:grid;place-items:center;
  font:16px system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:#000}
</style>
</head>
<body>
<canvas id="board" aria-label="${esc(data.title)}: Conway's Game of Life. Click, tap or press Space to pause or resume." role="img"></canvas>
<noscript>${esc(data.title)} needs JavaScript to run.</noscript>
<script type="module" src="./app.js"></script>
</body>
</html>
`;

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
for (const f of ['app.js', 'life.js']) {
  fs.copyFileSync(path.join(root, 'src', f), path.join(dist, f));
}
fs.writeFileSync(path.join(dist, '.nojekyll'), '');

console.log(`Built ${data.title} -> ${path.relative(process.cwd(), dist) || dist}/`);
