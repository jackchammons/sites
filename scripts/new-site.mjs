#!/usr/bin/env node
/*
 * Scaffold a new site.
 *
 *   node scripts/new-site.mjs <slug> "Name" "One-sentence tagline" [emoji]
 *
 * Creates <slug>/ with a working build + verify that already honour the
 * OUT_DIR contract, and registers it in sites.config.json. The generated site
 * builds and deploys as-is, so you can confirm the pipeline end to end before
 * writing any real content.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
if (!slug || !name || !tagline) {
  console.error('usage: node scripts/new-site.mjs <slug> "Name" "Tagline" [emoji]'
    + ' [--accent=#rrggbb] [--cadence="Rebuilt daily"]');
  process.exit(1);
}
if (!/^#[0-9a-fA-F]{6}$/.test(accent)) {
  console.error(`invalid --accent "${accent}" — use #rrggbb`);
  process.exit(1);
}
if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) {
  console.error(`invalid slug "${slug}" — use lowercase letters, digits and hyphens`);
  process.exit(1);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, slug);
const configPath = path.join(root, 'sites.config.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

if (fs.existsSync(dir)) { console.error(`${slug}/ already exists`); process.exit(1); }
if (config.sites.some(s => s.slug === slug)) {
  console.error(`"${slug}" is already registered in sites.config.json`); process.exit(1);
}

fs.mkdirSync(path.join(dir, 'scripts'), { recursive: true });
fs.mkdirSync(path.join(dir, 'data'), { recursive: true });

const q = s => JSON.stringify(s);

fs.writeFileSync(path.join(dir, 'scripts', 'build.mjs'), `#!/usr/bin/env node
/* Build for ${name}. Writes a complete static site into OUT_DIR. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// The multi-site build sets OUT_DIR to dist/<slug>/; a standalone run writes dist/.
const dist = process.env.OUT_DIR
  ? path.resolve(process.env.OUT_DIR)
  : path.join(root, '..', 'dist');

const data = JSON.parse(fs.readFileSync(path.join(root, 'data/data.json'), 'utf8'));
const esc = s => String(s).replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const now = new Date();
const html = \`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>\${esc(data.title)}</title>
<meta name="description" content="\${esc(data.tagline)}">
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>${emoji}</text></svg>">
<style>
:root{color-scheme:light dark;--bg:#14100e;--panel:#221c19;--line:#3a302b;
  --ink:#f6efe8;--ink-2:#c8b8ac;--ink-3:#948276;
  --mono:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
  --serif:"Iowan Old Style","Palatino Linotype",Palatino,Georgia,serif;
  --sans:system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
@media(prefers-color-scheme:light){:root{--bg:#fbf6ef;--panel:#fffdfa;--line:#e2d5c4;
  --ink:#23180f;--ink-2:#5d4c3e;--ink-3:#8b7767}}
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

  <footer>Built \${now.toISOString()} · <a href="../">all sites</a></footer>
</div>
</body>
</html>
\`;

fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });
fs.writeFileSync(path.join(dist, 'index.html'), html);

console.log(\`Built ${name} -> \${path.relative(process.cwd(), dist) || dist}/\`);
`);

fs.writeFileSync(path.join(dir, 'scripts', 'verify.mjs'), `#!/usr/bin/env node
/* Post-build checks. Exiting non-zero here blocks the deploy. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = process.env.OUT_DIR
  ? path.resolve(process.env.OUT_DIR)
  : path.join(root, '..', 'dist');

const fails = [];
const check = (ok, msg) => { if (!ok) fails.push(msg); };

const indexPath = path.join(dist, 'index.html');
check(fs.existsSync(indexPath), 'missing index.html');

if (fs.existsSync(indexPath)) {
  const html = fs.readFileSync(indexPath, 'utf8');
  check(html.length > 500, \`index.html suspiciously small (\${html.length} bytes)\`);
  check(/<title>[^<]+<\\/title>/.test(html), 'missing <title>');
  check(!/undefined|NaN|\\[object Object\\]/.test(html),
    'page contains undefined/NaN/[object Object]');
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

config.sites.push({
  slug, name, emoji, tagline, dir: slug,
  build: ['node', 'scripts/build.mjs'],
  verify: ['node', 'scripts/verify.mjs'],
  cadence,
  accent
});
fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');

/* Registering a site touches four files, and the registry is only one of them.
 * The other three are patched here rather than left as a checklist: the one
 * that matters most is invisible when you forget it -- publish.yml filters
 * pushes by path, so a site missing from that list simply never redeploys,
 * with no error anywhere to say so.
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

// The deploy filter. Anchored on the last site directory already listed.
patch('.github/workflows/publish.yml', `add "- '${slug}/**'" to the push paths`, src => {
  if (src.includes(`'${slug}/**'`)) return src;
  // Anchored on the site directories already registered, so the new entry
  // joins them rather than landing after 'scripts/**'.
  const dirs = config.sites.filter(x => x.slug !== slug).map(x => x.dir);
  const entries = [...src.matchAll(/^ *- '([a-z0-9-]+)\/\*\*'$/gm)]
    .filter(m => dirs.includes(m[1]));
  if (!entries.length) return null;
  const last = entries[entries.length - 1];
  const at = last.index + last[0].length;
  return src.slice(0, at) + `\n${last[0].replace(/- '.*/, `- '${slug}/**'`)}` + src.slice(at);
});

// The README site table.
patch('README.md', `add a row for ${slug} to the site table`, src => {
  if (src.includes(`](${slug}/)`)) return src;
  const rows = [...src.matchAll(/^\|.*\|\s*\[`\/[a-z0-9-]+\/`\].*\|$/gm)];
  if (!rows.length) return null;
  const last = rows[rows.length - 1];
  const base = (config.baseUrl || '').replace(/\/$/, '');
  const row = `| ${name} | [\`/${slug}/\`](${base}/${slug}/) | [\`${slug}/\`](${slug}/) | ${cadence} |`;
  const at = last.index + last[0].length;
  return src.slice(0, at) + '\n' + row + src.slice(at);
});

// The CLAUDE.md site table -- the notes column is where a future session looks
// first, so it gets a prompt rather than being left blank.
patch('CLAUDE.md', `add a row for ${slug} to the Sites table`, src => {
  if (src.includes(`| \`${slug}\` |`)) return src;
  const rows = [...src.matchAll(/^\| `[a-z0-9-]+` \| `[a-z0-9-]+\/` \|.*\|$/gm)];
  if (!rows.length) return null;
  const last = rows[rows.length - 1];
  const row = `| \`${slug}\` | \`${slug}/\` | Node, no deps | _Replace this note: what would a future`
    + ` session need to know before editing ${slug}/ ?_ |`;
  const at = last.index + last[0].length;
  return src.slice(0, at) + '\n' + row + src.slice(at);
});

console.log(`Scaffolded ${slug}/ and registered it.

  ${slug}/data/data.json        content
  ${slug}/scripts/build.mjs     rendering  (writes to OUT_DIR)
  ${slug}/scripts/verify.mjs    deploy gate

Registered in:
  + sites.config.json
${patches.join('\n')}

Next:
  node scripts/build-all.mjs --only ${slug}   # build just this one while iterating
  node scripts/build-all.mjs                 # then the whole set, as the deploy runs it

Nothing is published until this reaches main: the branch build deploys nothing.
`);
