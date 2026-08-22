#!/usr/bin/env node
/*
 * Multi-site build.
 *
 * Reads sites.config.json, builds each registered site into dist/<slug>/ by
 * running that site's own build script with OUT_DIR pointed at its subdirectory,
 * runs the site's verifier against that output, then renders the landing page at
 * dist/index.html.
 *
 * Each site stays self-contained: it keeps its own data, algorithm, styles and
 * build script, and can still be built standalone. This orchestrator only
 * decides where the output lands.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const config = JSON.parse(fs.readFileSync(path.join(root, 'sites.config.json'), 'utf8'));

const esc = s => String(s).replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });

const built = [];
for (const site of config.sites) {
  const siteRoot = path.join(root, site.dir);
  const out = path.join(dist, site.slug);
  const env = { ...process.env, OUT_DIR: out };

  console.log(`\n=== ${site.name} (/${site.slug}/) ===`);
  execFileSync('node', [path.join(siteRoot, site.build)], { stdio: 'inherit', env });
  if (site.verify) {
    execFileSync('node', [path.join(siteRoot, site.verify)], { stdio: 'inherit', env });
  }

  const index = path.join(out, 'index.html');
  if (!fs.existsSync(index)) {
    console.error(`\n${site.slug}: build produced no index.html at ${index}`);
    process.exit(1);
  }
  built.push({ ...site, bytes: fs.statSync(index).size });
}

/* ---- landing page ---- */
const now = new Date();
const cards = built.map(s => `
      <a class="card" href="./${esc(s.slug)}/" style="--accent:${esc(s.accent || '#e14434')}">
        <div class="emoji">${esc(s.emoji || '•')}</div>
        <div class="body">
          <h2>${esc(s.name)}</h2>
          <p>${esc(s.tagline)}</p>
          <div class="meta">
            <span>/${esc(s.slug)}/</span>
            ${s.cadence ? `<span>${esc(s.cadence)}</span>` : ''}
          </div>
        </div>
        <div class="arrow" aria-hidden="true">→</div>
      </a>`).join('');

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(config.title)}</title>
<meta name="description" content="${esc(config.tagline)}">
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🗂️</text></svg>">
<style>
:root{
  color-scheme:light dark;
  --bg:#14100e;--panel:#221c19;--panel-2:#2a2320;--line:#3a302b;
  --ink:#f6efe8;--ink-2:#c8b8ac;--ink-3:#948276;
  --mono:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
  --serif:"Iowan Old Style","Palatino Linotype",Palatino,Georgia,serif;
  --sans:system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
}
@media (prefers-color-scheme:light){
  :root{--bg:#fbf6ef;--panel:#fffdfa;--panel-2:#f7f1e8;--line:#e2d5c4;
        --ink:#23180f;--ink-2:#5d4c3e;--ink-3:#8b7767;}
}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font-family:var(--sans);
     line-height:1.6;-webkit-font-smoothing:antialiased;
     display:flex;flex-direction:column;min-height:100vh}
.wrap{width:min(760px,92vw);margin:0 auto}
header{padding:84px 0 40px}
.eyebrow{font-family:var(--mono);font-size:11px;letter-spacing:.22em;
         text-transform:uppercase;color:var(--ink-3);margin-bottom:14px}
h1{font-family:var(--serif);font-size:clamp(34px,6vw,58px);
   margin:0 0 16px;letter-spacing:-.02em;line-height:1.1}
header p{color:var(--ink-2);font-size:17px;margin:0;max-width:58ch}
main{flex:1;padding-bottom:60px}
.grid{display:flex;flex-direction:column;gap:14px}
.card{display:grid;grid-template-columns:auto 1fr auto;gap:20px;align-items:center;
      padding:24px;background:var(--panel);border:1px solid var(--line);
      border-radius:14px;text-decoration:none;color:inherit;
      transition:border-color .2s,transform .2s,background .2s}
.card:hover{border-color:var(--accent);background:var(--panel-2);transform:translateY(-2px)}
.emoji{font-size:34px;line-height:1}
.card h2{font-family:var(--serif);font-size:23px;margin:0 0 6px;letter-spacing:-.01em}
.card p{margin:0;color:var(--ink-2);font-size:14.5px;line-height:1.55}
.meta{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}
.meta span{font-family:var(--mono);font-size:10.5px;letter-spacing:.04em;
           color:var(--ink-3);border:1px solid var(--line);border-radius:999px;padding:3px 10px}
.arrow{font-size:20px;color:var(--ink-3);transition:color .2s,transform .2s}
.card:hover .arrow{color:var(--accent);transform:translateX(3px)}
footer{border-top:1px solid var(--line);padding:28px 0 44px;color:var(--ink-3);font-size:12.5px}
footer a{color:inherit}
code{font-family:var(--mono);font-size:12px;background:var(--panel-2);
     border:1px solid var(--line);border-radius:5px;padding:1px 6px}
@media (max-width:620px){
  header{padding:52px 0 30px}
  .card{grid-template-columns:auto 1fr;padding:20px;gap:14px}
  .arrow{display:none}
}
@media (prefers-reduced-motion:reduce){*{transition:none!important}}
</style>
</head>
<body>
<header><div class="wrap">
  <div class="eyebrow">${esc(config.owner)} · sites</div>
  <h1>${esc(config.title.split('/').pop().trim())}</h1>
  <p>${esc(config.tagline)}</p>
</div></header>

<main><div class="wrap">
  <div class="grid">${cards}
  </div>
</div></main>

<footer><div class="wrap">
  <p style="margin:0">
    ${built.length} site${built.length === 1 ? '' : 's'} · built ${now.toISOString()} ·
    published from <code>dist/</code> by GitHub Actions.
    Add a site by dropping its directory in and registering it in <code>sites.config.json</code>.
  </p>
</div></footer>
</body>
</html>
`;

fs.writeFileSync(path.join(dist, 'index.html'), html);
fs.writeFileSync(path.join(dist, '.nojekyll'), '');

console.log(`\n=== landing page ===`);
console.log(`Built ${built.length} site(s) -> dist/`);
for (const s of built) console.log(`  /${s.slug}/  ${s.name}  (${s.bytes.toLocaleString('en-US')} bytes)`);
