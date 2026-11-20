#!/usr/bin/env node
/*
 * Build for Airship Vibes.
 *
 * The page is a canvas and two small controls over it (a speaker, and a hint
 * that comes up once); everything on the canvas is drawn in the browser,
 * live, by the modules in src/. This build writes the shell, copies those modules
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
  touch-action:none;user-select:none;-webkit-user-select:none;-webkit-touch-callout:none;
  -webkit-tap-highlight-color:transparent}
canvas[hidden]{display:none}
#note,noscript{position:fixed;inset:0;display:grid;place-items:center;margin:0;padding:24px;text-align:center;
  font:16px/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:#e9e0c8;
  background:linear-gradient(#27407a,#6b8fc4 55%,#e8b58a)}
#note[hidden]{display:none}
/* The two controls sit over the picture and stay out of its way: small, dim
   until wanted, drawn in whole pixels like everything under them. */
button{font:inherit;color:inherit;background:none;border:0;padding:0;margin:0;cursor:pointer;
  -webkit-tap-highlight-color:transparent}
#sound{position:fixed;top:max(6px,env(safe-area-inset-top));right:max(6px,env(safe-area-inset-right));
  width:44px;height:44px;display:grid;place-items:center;color:#fff;opacity:.5;transition:opacity .2s}
#sound:hover,#sound:focus-visible{opacity:.95}
#sound svg{width:22px;height:22px;filter:drop-shadow(1px 1px 0 rgba(0,0,0,.55))}
#sound[aria-pressed="true"] .off,#sound[aria-pressed="false"] .on{display:none}
#tip{position:fixed;left:50%;bottom:max(18px,env(safe-area-inset-bottom));transform:translateX(-50%);
  display:flex;align-items:center;gap:4px;padding:0 0 0 12px;white-space:nowrap;
  font:11px/1 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;letter-spacing:.14em;text-transform:uppercase;
  color:#fff;background:rgba(10,14,28,.62);border:1px solid rgba(255,255,255,.28);animation:tip .6s steps(4) both}
#tip-close{width:36px;height:36px;font-size:15px;line-height:1;opacity:.7}
#tip-close:hover,#tip-close:focus-visible{opacity:1}
#tip[hidden],#sound[hidden],.held #sound,.held #tip{display:none}
:focus-visible{outline:1px solid #fff;outline-offset:-3px}
@keyframes tip{from{opacity:0}to{opacity:1}}
@media (prefers-reduced-motion:reduce){#tip{animation:none}#sound{transition:none}}
</style>
</head>
<body>
<canvas id="view" role="img" aria-label="${esc(data.title)}"></canvas>
<button id="sound" type="button" aria-pressed="true" aria-label="Sound"><svg viewBox="0 0 11 11" shape-rendering="crispEdges" fill="currentColor" aria-hidden="true"><path d="M0 4h2v3H0zM2 3h1v5H2zM3 2h1v7H3zM4 1h1v9H4z"/><path class="on" d="M6 4h1v3H6zM8 2h1v1H8zM9 3h1v5H9zM8 8h1v1H8z"/><path class="off" d="M6 3h1v1H6zM7 4h1v1H7zM8 5h1v1H8zM9 6h1v1H9zM10 7h1v1h-1zM10 3h1v1h-1zM9 4h1v1H9zM7 6h1v1H7zM6 7h1v1H6z"/></svg></button>
<div id="tip" role="status" hidden><span id="tip-text"></span><button id="tip-close" type="button" aria-label="Dismiss this hint">&#215;</button></div>
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
