#!/usr/bin/env node
/*
 * Scaffold a new site.
 *
 *   node scripts/new-site.mjs <slug> "Name" "One-sentence tagline" [emoji]
 *
 * Creates <slug>/ with a working build + verify that already honour the
 * OUT_DIR contract, a short README and a CLAUDE.md that loads it, and
 * registers the site in three files: sites.config.json and the site tables
 * in README.md and CLAUDE.md. The
 * generated site builds and deploys as-is, so you can confirm the pipeline end
 * to end before writing any real content.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SLUG, ACCENT } from './lib/registry.mjs';

const argv = process.argv.slice(2);
// --accent and --cadence are the two registry fields worth setting up front;
// everything else about the entry is derived from the positional arguments.
const flag = name => {
  const i = argv.findIndex(a => a === `--${name}` || a.startsWith(`--${name}=`));
  if (i === -1) return null;
  const [a] = argv.splice(i, 1);
  return a.includes('=') ? a.slice(a.indexOf('=') + 1) : argv.splice(i, 1)[0];
};
const accent = flag('accent') || '#e14434';
const cadence = flag('cadence') || 'Rebuilt daily';

const [slug, name, tagline, emoji = '📄'] = argv;
if (![slug, name, tagline, emoji, cadence].every(v => v && v.trim())) {
  console.error('usage: node scripts/new-site.mjs <slug> "Name" "Tagline" [emoji]'
    + ' [--accent=#rrggbb] [--cadence="Rebuilt daily"]');
  process.exit(1);
}
if (!ACCENT.test(accent)) {
  console.error(`invalid --accent "${accent}" — use #rrggbb`);
  process.exit(1);
}
if (!SLUG.test(slug)) {
  console.error(`invalid slug "${slug}" — use lowercase letters, digits and hyphens`);
  process.exit(1);
}

// SITES_ROOT points the scaffolder at another checkout, which is how the tests
// run it without touching this one.
const root = process.env.SITES_ROOT
  ? path.resolve(process.env.SITES_ROOT)
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, slug);
const configPath = path.join(root, 'sites.config.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

if (fs.existsSync(dir)) { console.error(`${slug}/ already exists`); process.exit(1); }
if (config.sites.some(s => s.slug === slug)) {
  console.error(`"${slug}" is already registered in sites.config.json`); process.exit(1);
}

fs.mkdirSync(path.join(dir, 'scripts'), { recursive: true });
fs.mkdirSync(path.join(dir, 'data'), { recursive: true });

/* The name, tagline and emoji are whatever was typed, so none of them is ever
 * pasted into the generated source as code. The name and tagline live in
 * data.json and are read at build time; the emoji, the one value the template
 * needs inline, goes in as a JSON string literal, which a backtick, a quote
 * or ${ cannot break out of. */
const q = s => JSON.stringify(s);

fs.writeFileSync(path.join(dir, 'scripts', 'build.mjs'), `#!/usr/bin/env node
/* Build for /${slug}/. Writes a complete static site into OUT_DIR. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// The multi-site build sets OUT_DIR to dist/<slug>/; a standalone run writes to the same place.
const dist = process.env.OUT_DIR
  ? path.resolve(process.env.OUT_DIR)
  : path.join(root, '..', 'dist', path.basename(root));

const data = JSON.parse(fs.readFileSync(path.join(root, 'data/data.json'), 'utf8'));
const esc = s => String(s).replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// The tab icon is an emoji drawn by an inline SVG. It sits inside a URL inside
// an attribute, so it is escaped for the SVG and then for the URL.
const icon = encodeURIComponent(esc(${q(emoji)}));

const now = new Date();
const html = \`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>\${esc(data.title)}</title>
<meta name="description" content="\${esc(data.tagline)}">
<meta name="theme-color" content="#14100e" media="(prefers-color-scheme: dark)">
<meta name="theme-color" content="#fbf6ef" media="(prefers-color-scheme: light)">
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>\${icon}</text></svg>">
<style>
:root{color-scheme:light dark;--bg:#14100e;--panel:#221c19;--line:#3a302b;
  --ink:#f6efe8;--ink-2:#c8b8ac;--ink-3:#948276;
  --mono:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
  --serif:"Iowan Old Style","Palatino Linotype",Palatino,Georgia,serif;
  --sans:system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
@media(prefers-color-scheme:light){:root{--bg:#fbf6ef;--panel:#fffdfa;--line:#e2d5c4;
  --ink:#23180f;--ink-2:#5d4c3e;--ink-3:#75624f}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font-family:var(--sans);line-height:1.6}
.wrap{width:min(880px,92vw);margin:0 auto;padding:72px 0}
.eyebrow{font-family:var(--mono);font-size:11px;letter-spacing:.22em;
  text-transform:uppercase;color:var(--ink-3);margin-bottom:14px}
h1{font-family:var(--serif);font-size:clamp(34px,6vw,54px);margin:0 0 16px;
  letter-spacing:-.02em;line-height:1.1}
.lede{color:var(--ink-2);font-size:17px;max-width:62ch;margin:0}
.card{background:var(--panel);border:1px solid var(--line);border-radius:14px;
  padding:22px;margin-top:28px}
footer{color:var(--ink-3);font-size:12.5px;margin-top:40px;
  border-top:1px solid var(--line);padding-top:22px}
a{color:inherit}
</style>
</head>
<body>
<div class="wrap">
  <div class="eyebrow">\${esc(data.eyebrow)}</div>
  <h1>\${esc(data.title)}</h1>
  <p class="lede">\${esc(data.tagline)}</p>

  <div class="card">
    <p style="margin:0;color:var(--ink-2)">Replace this with the real content.
    Data lives in <code>data/data.json</code>; rendering lives in
    <code>scripts/build.mjs</code>.</p>
  </div>

  <footer>Built <time datetime="\${now.toISOString()}">\${now.toLocaleDateString('en-US',
    { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' })}</time> · <a href="../">all sites</a></footer>
</div>
</body>
</html>
\`;

// Clearing the target is only safe when it is a previous build or empty: OUT_DIR=. would
// otherwise delete this site's source.
const holdsSource = dist === root || root.startsWith(dist + path.sep);
const foreign = fs.existsSync(dist) && fs.readdirSync(dist).length > 0
  && !fs.existsSync(path.join(dist, 'index.html'));
if (holdsSource || foreign) {
  console.error(\`refusing to clear \${dist}: it is not an empty directory or a previous build\`);
  process.exit(1);
}
fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });
fs.writeFileSync(path.join(dist, 'index.html'), html);

console.log(\`Built \${data.title} -> \${path.relative(process.cwd(), dist) || dist}/\`);
`);

fs.writeFileSync(path.join(dir, 'scripts', 'verify.mjs'), `#!/usr/bin/env node
/* Post-build checks. Exiting non-zero here blocks the deploy.
 *
 * These cover what is particular to this page. The multi-site build adds the
 * checks every site shares (relative asset paths, referenced files exist) and
 * stamps asset URLs afterwards, so neither belongs here. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = process.env.OUT_DIR
  ? path.resolve(process.env.OUT_DIR)
  : path.join(root, '..', 'dist', path.basename(root));

const fails = [];
const check = (ok, msg) => { if (!ok) fails.push(msg); };

const indexPath = path.join(dist, 'index.html');
check(fs.existsSync(indexPath), 'missing index.html');

if (fs.existsSync(indexPath)) {
  const html = fs.readFileSync(indexPath, 'utf8');
  check(html.length > 500, \`index.html suspiciously small (\${html.length} bytes)\`);
  check(/<title>[^<]+<\\/title>/.test(html), 'missing <title>');
  // A value that failed to render shows up as one of these words. Only the
  // text a visitor reads is searched: a URL or an inline script may contain
  // the same letters and mean nothing by them.
  const text = html.replace(/<script[\\s\\S]*?<\\/script>|<style[\\s\\S]*?<\\/style>/g, ' ').replace(/<[^>]+>/g, ' ');
  const leak = /\\bundefined\\b|\\bNaN\\b|\\[object Object\\]/.exec(text);
  check(!leak, leak && \`page shows "\${leak[0]}" near: \${text.slice(Math.max(0, leak.index - 40), leak.index + 40).replace(/\\s+/g, ' ')}\`);
  check(!/=\\s*(["'])(?:undefined|null|NaN)\\1/.test(html), 'an attribute is literally undefined/null/NaN');
}

if (fails.length) {
  console.error('Build verification FAILED:');
  for (const f of fails) console.error('  ✗ ' + f);
  process.exit(1);
}
console.log('Build verified.');
`);

fs.writeFileSync(path.join(dir, 'data', 'data.json'), JSON.stringify({
  title: name, eyebrow: slug, tagline
}, null, 2) + '\n');

const base = (config.baseUrl || '').replace(/\/+$/, '');
fs.writeFileSync(path.join(dir, 'README.md'), [
  `# ${name}`,
  '',
  tagline,
  '',
  `Published at \`/${slug}/\`: **[${base.replace(/^https?:\/\//, '')}/${slug}/](${base}/${slug}/)**`,
  '',
  '## How it is put together',
  '',
  '```',
  'data/data.json       title, eyebrow and tagline',
  'scripts/build.mjs    renders the page into OUT_DIR',
  'scripts/verify.mjs   deploy gate',
  '```',
  '',
  'Reference assets by plain relative path (`./app.js`, `./styles.css`). The multi-site build',
  'stamps those URLs with a content hash after `verify.mjs` has run, so the site never',
  'versions its own files.',
  '',
  '## Working on it',
  '',
  '```bash',
  `node ${slug}/scripts/build.mjs               # writes dist/${slug}/`,
  `node ${slug}/scripts/verify.mjs`,
  `node scripts/build-all.mjs --only ${slug}    # the way the deploy builds it`,
  '```',
  '',
].join('\n'));

// A session working in this directory gets the README loaded for it, so the
// README is the one place the site's rules are written down.
fs.writeFileSync(path.join(dir, 'CLAUDE.md'),
  'The rules for this site are in README.md in this directory. Read it before editing anything here.\n\n@README.md\n');

config.sites.push({
  slug, name, emoji, tagline, dir: slug,
  build: ['node', 'scripts/build.mjs'],
  verify: ['node', 'scripts/verify.mjs'],
  cadence,
  accent
});
fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');

/* Registering a site touches three files, and the registry is only one of
 * them. The other two are the site tables in README.md and CLAUDE.md, patched
 * here rather than left as a checklist. The deploy workflow is not among
 * them: publish.yml runs on every push to main that is not docs-only, so a
 * new directory redeploys without being listed anywhere.
 *
 * Each patch is anchored on a pattern that may drift as the docs are edited,
 * so a miss warns and names what to add by hand instead of aborting a scaffold
 * that has already written files. */
const patches = [];
const patch = (file, describe, fn) => {
  const full = path.join(root, file);
  try {
    const before = fs.readFileSync(full, 'utf8');
    const after = fn(before);
    if (after === null) { patches.push(`  ! ${file}: ${describe}`); return; }
    if (after === before) { patches.push(`  = ${file} already lists ${slug}`); return; }
    fs.writeFileSync(full, after);
    patches.push(`  + ${file}`);
  } catch (e) {
    patches.push(`  ! ${file}: ${e.message} — ${describe}`);
  }
};

// One table cell: a | would start a new column and a line break would end the row.
const cell = s => String(s).replace(/\s+/g, ' ').trim().replace(/\|/g, '\\|');

// The README site table.
patch('README.md', `add a row for ${slug} to the site table`, src => {
  if (src.includes(`](${slug}/)`)) return src;
  const rows = [...src.matchAll(/^\|.*\|\s*\[`\/[a-z0-9-]+\/`\].*\|$/gm)];
  if (!rows.length) return null;
  const last = rows[rows.length - 1];
  const row = `| ${cell(name)} | [\`/${slug}/\`](${base}/${slug}/) | [\`${slug}/\`](${slug}/) | ${cell(cadence)} |`;
  const at = last.index + last[0].length;
  return src.slice(0, at) + '\n' + row + src.slice(at);
});

// The CLAUDE.md site table: one short row per site, so the tagline is the note.
patch('CLAUDE.md', `add a row for ${slug} to the Sites table`, src => {
  if (src.includes(`| \`${slug}\` |`)) return src;
  const rows = [...src.matchAll(/^\| `[a-z0-9-]+` \| `[a-z0-9-]+\/` \|.*\|$/gm)];
  if (!rows.length) return null;
  const last = rows[rows.length - 1];
  const row = `| \`${slug}\` | \`${slug}/\` | Node, no deps | ${cell(tagline)} |`;
  const at = last.index + last[0].length;
  return src.slice(0, at) + '\n' + row + src.slice(at);
});

console.log(`Scaffolded ${slug}/ and registered it.

  ${slug}/data/data.json        content
  ${slug}/scripts/build.mjs     rendering  (writes to OUT_DIR)
  ${slug}/scripts/verify.mjs    deploy gate
  ${slug}/README.md             what the site is and how to work on it
  ${slug}/CLAUDE.md             loads the README for a session working here

Registered in three files:
  + sites.config.json
${patches.join('\n')}

Next:
  node scripts/build-all.mjs --only ${slug}   # build just this one while iterating
  node scripts/build-all.mjs                 # then the whole set, as the deploy runs it

Nothing is published until this reaches main: the branch build deploys nothing.
`);
