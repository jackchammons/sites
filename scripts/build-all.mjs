#!/usr/bin/env node
/*
 * Multi-site build.
 *
 * Reads sites.config.json, builds each registered site into dist/<slug>/ by
 * running that site's own build script with OUT_DIR pointed at its subdirectory,
 * runs the site's verifier against that output, applies the checks every site
 * shares, and stamps its asset URLs. Then it renders what belongs to the domain
 * rather than to any one site: the landing page at dist/index.html, 404.html,
 * robots.txt and sitemap.xml.
 *
 * Each site stays self-contained: it keeps its own data, algorithm, styles and
 * build script, and can still be built standalone. This orchestrator only
 * decides where the output lands and what every output must satisfy.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validateRegistry } from './lib/registry.mjs';
import { checkOutput } from './lib/checks.mjs';
import { stampDir } from './lib/stamp.mjs';

// SITES_ROOT points the build at another checkout. The tests use it to build a
// fixture repository with this script instead of a copy of it.
const root = process.env.SITES_ROOT
  ? path.resolve(process.env.SITES_ROOT)
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');

/* Every failure is one line that names the site and the step, because the run
 * that prints it also carries every other site's output. Under Actions the
 * line is an annotation, so it shows on the run page without opening the log. */
const fail = lines => {
  for (const line of [].concat(lines)) {
    console.error(process.env.GITHUB_ACTIONS
      ? `::error::${line.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A')}`
      : `✗ ${line}`);
  }
  process.exit(1);
};

let config;
try {
  config = JSON.parse(fs.readFileSync(path.join(root, 'sites.config.json'), 'utf8'));
} catch (e) {
  fail(`sites.config.json: cannot be read as JSON (${e.message})`);
}

// Before anything is cleared or run: a bad entry must cost nothing.
const invalid = validateRegistry(config, root);
if (invalid.length) fail(invalid.map(p => `sites.config.json: ${p}`));

/* --only / --skip narrow the run while working on one site, so iterating on a
 * page neither waits on the other sites nor fails because one of them does.
 *
 * Refused under CI on purpose: a Pages deployment replaces the entire site, so
 * uploading a subset of dist/ would delete the sites left out. The deploy must
 * always build everything. */
const listFlag = name => {
  const i = process.argv.findIndex(a => a === `--${name}` || a.startsWith(`--${name}=`));
  if (i === -1) return null;
  const raw = process.argv[i].includes('=')
    ? process.argv[i].slice(process.argv[i].indexOf('=') + 1)
    : process.argv[i + 1];
  if (!raw) { console.error(`--${name} needs a comma-separated list of slugs`); process.exit(1); }
  return raw.split(',').map(s => s.trim()).filter(Boolean);
};
const only = listFlag('only');
const skip = listFlag('skip');

if ((only || skip) && process.env.CI) {
  console.error('--only/--skip are for local iteration and cannot be used in CI:\n'
    + 'a Pages deploy replaces the whole site, so a partial dist/ would delete the rest.');
  process.exit(1);
}

const known = new Set(config.sites.map(s => s.slug));
for (const slug of [...(only || []), ...(skip || [])]) {
  if (!known.has(slug)) {
    console.error(`unknown slug "${slug}" — registered sites: ${[...known].join(', ')}`);
    process.exit(1);
  }
}

const selected = config.sites.filter(s =>
  (!only || only.includes(s.slug)) && (!skip || !skip.includes(s.slug)));
if (!selected.length) { console.error('nothing left to build'); process.exit(1); }

const partial = selected.length !== config.sites.length;
if (partial) {
  const left = config.sites.filter(s => !selected.includes(s)).map(s => s.slug);
  console.log(`PARTIAL BUILD — skipping ${left.join(', ')}.`);
  console.log('dist/ will be incomplete and must not be deployed.\n');
}

const esc = s => String(s).replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });

const built = [];
for (const site of selected) {
  const siteRoot = path.join(root, site.dir);
  const out = path.join(dist, site.slug);
  const env = { ...process.env, OUT_DIR: out };
  const run = (step, cmd) => {
    const r = spawnSync(cmd[0], cmd.slice(1), { stdio: 'inherit', env, cwd: siteRoot });
    if (r.error) fail(`${site.slug}: ${step} could not start "${cmd[0]}" (${r.error.code || r.error.message})`);
    if (r.status !== 0) {
      fail(`${site.slug}: ${step} failed, "${cmd.join(' ')}" ${
        r.signal ? `was stopped by ${r.signal}` : `exited ${r.status}`}`);
    }
  };

  console.log(`\n=== ${site.name} (/${site.slug}/) ===`);
  fs.mkdirSync(out, { recursive: true });
  run('build', site.build);
  if (site.verify) run('verify', site.verify);

  // The site's verifier knows its content. These hold for any page served
  // from /<slug>/, so no site has to remember them.
  const problems = checkOutput(out);
  if (problems.length) fail(problems.map(p => `${site.slug}: ${p}`));

  // Last, so each verifier sees the plain ./app.js references its build wrote.
  const { stamps, missing } = stampDir(out);
  if (missing.length) {
    fail(missing.map(m => `${site.slug}: ${m.page} loads "${m.ref}" without a content stamp;`
      + ' it must be a .js or .css file inside the site, referenced with no query of its own'));
  }
  console.log(`  stamped ${stamps.size} asset URL${stamps.size === 1 ? '' : 's'}`);

  built.push({ ...site, bytes: fs.statSync(path.join(out, 'index.html')).size });
}

/* ---- pages that belong to the domain ---- */
const now = new Date();
const base = config.baseUrl.replace(/\/+$/, '');
// Where the Pages root sits on the host: / under a custom domain.
const home = new URL(base + '/').pathname;
const count = `${built.length} site${built.length === 1 ? '' : 's'}`;

// The landing page and the 404 page share one palette. The two backgrounds
// are also what the browser paints its own chrome with (theme-color).
const BG = { dark: '#14100e', light: '#fbf6ef' };
const palette = `:root{
  color-scheme:light dark;
  --bg:${BG.dark};--panel:#221c19;--panel-2:#2a2320;--line:#3a302b;
  --ink:#f6efe8;--ink-2:#c8b8ac;--ink-3:#948276;
  --mono:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
  --serif:"Iowan Old Style","Palatino Linotype",Palatino,Georgia,serif;
  --sans:system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
}
@media (prefers-color-scheme:light){
  :root{--bg:${BG.light};--panel:#fffdfa;--panel-2:#f7f1e8;--line:#e2d5c4;
        --ink:#23180f;--ink-2:#5d4c3e;--ink-3:#75624f;}
}`;
const chrome = `<meta name="theme-color" content="${BG.dark}" media="(prefers-color-scheme: dark)">
<meta name="theme-color" content="${BG.light}" media="(prefers-color-scheme: light)">
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🗂️</text></svg>">`;

/* ---- landing page ---- */
const cards = built.map(s => {
  // Everything a visitor might reasonably type, lowercased once at build time.
  // keywords are the words people search by that the card's own copy does not
  // happen to use ("tv size" for a page that says "sizing"); they are matched
  // and never shown.
  const haystack = [s.name, s.tagline, s.slug, s.cadence, s.dir, ...(s.keywords ?? [])]
    .filter(Boolean).join(' ').toLowerCase();
  return `
      <a class="card" href="./${esc(s.slug)}/" data-search="${esc(haystack)}" style="--accent:${esc(s.accent || '#e14434')}">
        <div class="emoji" aria-hidden="true">${esc(s.emoji || '•')}</div>
        <div class="body">
          <h2>${esc(s.name)}</h2>
          <p>${esc(s.tagline)}</p>
          <div class="meta">
            <span>/${esc(s.slug)}/</span>
            ${s.cadence ? `<span>${esc(s.cadence)}</span>` : ''}
          </div>
        </div>
        <div class="arrow" aria-hidden="true">→</div>
      </a>`;
}).join('');

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(config.title)}</title>
<meta name="description" content="${esc(config.tagline)}">
<link rel="canonical" href="${esc(base)}/">
<meta property="og:type" content="website">
<meta property="og:title" content="${esc(config.title)}">
<meta property="og:description" content="${esc(config.tagline)}">
<meta property="og:url" content="${esc(base)}/">
${chrome}
<style>
${palette}
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
.search{position:relative;display:flex;align-items:center;margin:0 0 20px}
.search[hidden]{display:none}
.search-icon{position:absolute;left:16px;width:17px;height:17px;fill:none;
  stroke:var(--ink-3);stroke-width:2;stroke-linecap:round;pointer-events:none}
#q{width:100%;padding:13px 46px 13px 44px;font:inherit;font-size:16px;
  color:var(--ink);background:var(--panel);border:1px solid var(--line);
  border-radius:12px;transition:border-color .15s,background .15s}
#q::placeholder{color:var(--ink-3)}
#q:focus{border-color:var(--ink-3);background:var(--panel-2)}
#q:focus-visible{outline:2px solid var(--ink);outline-offset:2px}
#q::-webkit-search-cancel-button{-webkit-appearance:none;appearance:none}
#hint{position:absolute;right:14px;font-family:var(--mono);font-size:11px;
  color:var(--ink-3);border:1px solid var(--line);border-radius:5px;
  padding:2px 7px;pointer-events:none;transition:opacity .15s}
.search.typing #hint{opacity:0}
@media (hover:none){#hint{display:none}}
.grid{display:flex;flex-direction:column;gap:14px}
.card[hidden]{display:none}
.empty{color:var(--ink-2);font-size:14.5px;text-align:center;padding:34px 0 10px;margin:0}
.empty b{color:var(--ink)}
.count{font-family:var(--mono);font-size:11px;color:var(--ink-3);
  margin:18px 0 0;text-align:center;letter-spacing:.04em}
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
  <div class="search" id="search" hidden>
    <svg class="search-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg>
    <input id="q" type="search" autocomplete="off" spellcheck="false"
           placeholder="Search sites…" aria-label="Search sites"
           aria-describedby="count">
    <kbd id="hint" aria-hidden="true">/</kbd>
  </div>
  <div class="grid" id="grid">${cards}
  </div>
  <p class="empty" id="empty" hidden>No sites match <b id="emptyq"></b>.</p>
  <p class="count" id="count" aria-live="polite"></p>
</div></main>

<footer><div class="wrap">
  <p style="margin:0">${count} · updated <time datetime="${now.toISOString()}">${
    now.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' })}</time></p>
</div></footer>

<script>
(function () {
  var search = document.getElementById('search');
  var q = document.getElementById('q');
  var grid = document.getElementById('grid');
  var empty = document.getElementById('empty');
  var emptyq = document.getElementById('emptyq');
  var count = document.getElementById('count');
  var cards = [].slice.call(grid.querySelectorAll('.card'));
  var total = cards.length;

  search.hidden = false;   // only offer search once we know JS can serve it

  function apply() {
    // Every word typed has to appear somewhere on the card, in any order.
    var terms = q.value.toLowerCase().split(/\\s+/).filter(Boolean);
    search.classList.toggle('typing', terms.length !== 0);
    var shown = 0;
    cards.forEach(function (card) {
      var hit = terms.every(function (t) { return card.dataset.search.indexOf(t) !== -1; });
      card.hidden = !hit;
      if (hit) shown++;
    });
    empty.hidden = shown !== 0;
    emptyq.textContent = q.value.trim();
    count.textContent = terms.length === 0
      ? total + (total === 1 ? ' site' : ' sites')
      : shown + ' of ' + total + ' sites';
  }

  q.addEventListener('input', apply);

  q.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      if (q.value === '') { q.blur(); } else { q.value = ''; apply(); }
    }
    if (e.key === 'Enter') {
      var first = cards.filter(function (c) { return !c.hidden; })[0];
      if (first) window.location.href = first.getAttribute('href');
    }
  });

  // "/" focuses search from anywhere, the way most doc sites behave.
  document.addEventListener('keydown', function (e) {
    if (e.key === '/' && document.activeElement !== q) {
      e.preventDefault();
      q.focus();
      q.select();
    }
  });

  apply();
})();
</script>
</body>
</html>
`;

// The landing page has no verifier of its own, so it is checked where it is
// rendered: exactly one card per built site, and no field that came out as
// the word "undefined".
const cardCount = (html.match(/<a class="card" /g) || []).length;
const unlisted = built.filter(s => !html.includes(`<a class="card" href="./${esc(s.slug)}/"`));
if (cardCount !== built.length || unlisted.length) {
  fail(`landing page: ${cardCount} card(s) for ${built.length} built site(s)`
    + (unlisted.length ? `, none for ${unlisted.map(s => s.slug).join(', ')}` : ''));
}
if (html.includes('>undefined<')) fail('landing page: a field rendered as "undefined"');

/* ---- 404 page ----
 * Pages serves a root 404.html for every missing path at any depth, so its
 * links are absolute from the Pages root and it loads no files of its own. */
const notFound = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Page not found · ${esc(config.title)}</title>
<meta name="description" content="There is no page at this address. These are the sites published at ${esc(new URL(base).host)}.">
<meta name="robots" content="noindex">
${chrome}
<style>
${palette}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font-family:var(--sans);
     line-height:1.6;-webkit-font-smoothing:antialiased}
.wrap{width:min(620px,92vw);margin:0 auto;padding:84px 0 60px}
.eyebrow{font-family:var(--mono);font-size:11px;letter-spacing:.22em;
         text-transform:uppercase;color:var(--ink-3);margin-bottom:14px}
h1{font-family:var(--serif);font-size:clamp(32px,6vw,50px);
   margin:0 0 16px;letter-spacing:-.02em;line-height:1.1}
p{color:var(--ink-2);font-size:17px;margin:0 0 28px;max-width:52ch}
ul{list-style:none;margin:0 0 28px;padding:0;display:flex;flex-direction:column;gap:10px}
li a{display:flex;gap:14px;align-items:center;padding:14px 18px;background:var(--panel);
     border:1px solid var(--line);border-radius:12px;text-decoration:none;color:inherit;
     font-family:var(--serif);font-size:19px}
li a:hover{border-color:var(--ink-3);background:var(--panel-2)}
.home{color:var(--ink-2);font-size:14.5px}
@media (max-width:620px){.wrap{padding-top:52px}}
</style>
</head>
<body>
<main class="wrap">
  <div class="eyebrow">Error 404</div>
  <h1>Page not found</h1>
  <p>There is nothing at this address. It may be mistyped, or the page may have been retired. These are the sites that live here:</p>
  <ul>${built.map(s => `
    <li><a href="${esc(home + s.slug)}/"><span aria-hidden="true">${esc(s.emoji || '•')}</span>${esc(s.name)}</a></li>`).join('')}
  </ul>
  <a class="home" href="${esc(home)}">← All sites</a>
</main>
</body>
</html>
`;

const xml = s => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${[`${base}/`, ...built.map(s => `${base}/${s.slug}/`)]
    .map(loc => `  <url><loc>${xml(loc)}</loc></url>`).join('\n')}
</urlset>
`;

fs.writeFileSync(path.join(dist, 'index.html'), html);
fs.writeFileSync(path.join(dist, '404.html'), notFound);
fs.writeFileSync(path.join(dist, 'robots.txt'), `User-agent: *\nAllow: /\n\nSitemap: ${base}/sitemap.xml\n`);
fs.writeFileSync(path.join(dist, 'sitemap.xml'), sitemap);
fs.writeFileSync(path.join(dist, '.nojekyll'), '');

// A Pages deploy from Actions can clear the custom domain unless the artifact
// carries a CNAME file, so it is generated from the registry rather than left
// to the repository setting.
if (config.customDomain) {
  fs.writeFileSync(path.join(dist, 'CNAME'), config.customDomain + '\n');
  console.log(`  CNAME -> ${config.customDomain}`);
}

console.log(`\n=== landing page ===`);
if (partial) console.log('  (partial — this landing page, the 404 page and the sitemap list only the sites that were built)');
console.log(`Built ${built.length} site(s) -> dist/`);
for (const s of built) console.log(`  /${s.slug}/  ${s.name}  (${s.bytes.toLocaleString('en-US')} bytes)`);
