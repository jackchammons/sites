#!/usr/bin/env node
/*
 * Build for Airship Vibes.
 *
 * The page is a canvas; everything on it is drawn in the browser, live, by
 * the modules in src/. This build writes the shell, copies those modules
 * unchanged (so verify.mjs and the tests run the code that is deployed), and
 * turns the drawing set's parameter file into a module the page imports, so
 * it is stamped and cached with the scripts and not fetched separately.
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
const parameters = JSON.parse(fs.readFileSync(path.join(root, 'data/parameters.json'), 'utf8'));
const esc = s => String(s).replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// The tab icon: the airship in profile, a few pixels of it.
const icon = "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' shape-rendering='crispEdges'>"
  + "<rect width='16' height='16' fill='%23274a7a'/><rect x='3' y='5' width='10' height='5' fill='%23efe8d6'/>"
  + "<rect x='2' y='6' width='12' height='3' fill='%23efe8d6'/><rect x='4' y='5' width='8' height='1' fill='%2327344a'/>"
  + "<rect x='1' y='5' width='2' height='1' fill='%23c2410c'/><rect x='1' y='9' width='2' height='1' fill='%23c2410c'/>"
  + "<rect x='8' y='10' width='3' height='1' fill='%23ffd98a'/></svg>";

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(data.title)}</title>
<meta name="description" content="${esc(data.tagline)}">
<meta name="color-scheme" content="dark">
<meta name="theme-color" content="#101522">
<link rel="icon" href="${icon}">
<style>
html,body{margin:0;padding:0;height:100%;overflow:hidden;background:#101522}
canvas{position:fixed;inset:0;width:100%;height:100%;display:block;cursor:pointer;
  touch-action:manipulation;-webkit-tap-highlight-color:transparent}
canvas[hidden]{display:none}
#note,noscript{position:fixed;inset:0;display:grid;place-items:center;margin:0;padding:24px;text-align:center;
  font:16px/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:#e9e0c8;
  background:linear-gradient(#27407a,#6b8fc4 55%,#e8b58a)}
#note[hidden]{display:none}
</style>
</head>
<body>
<canvas id="view" role="img" aria-label="${esc(data.title)}"></canvas>
<p id="note" hidden></p>
<noscript>${esc(data.noscript)}</noscript>
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
const modules = fs.readdirSync(path.join(root, 'src')).filter(f => f.endsWith('.js')).sort();
for (const f of modules) fs.copyFileSync(path.join(root, 'src', f), path.join(dist, f));
fs.writeFileSync(path.join(dist, 'params.js'),
  `// The live-aboard airship's parameters, from the drawing set (data/parameters.json).\n`
  + `export const PARAMS = ${JSON.stringify(parameters)};\n`);
fs.writeFileSync(path.join(dist, '.nojekyll'), '');

console.log(`Built ${data.title} -> ${path.relative(process.cwd(), dist) || dist}/ (${modules.length + 1} modules)`);
