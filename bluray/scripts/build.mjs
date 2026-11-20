#!/usr/bin/env node
/*
 * Build for /bluray/. Writes a complete static site into OUT_DIR.
 *
 * The whole collection is rendered here: the drawn shelf of spines and the
 * list under it, both in shelf order, with every count taken from the data.
 * The page is complete without JavaScript; src/app.js only adds the filter
 * chips and the order menu, and reads the entries it needs from inline JSON.
 * src/shelf.js holds the rules for both halves and is copied into dist
 * unchanged, so the verifier can run the deployed copy.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FORMATS, SHOWS, SORTS, arrange, summarize, years, edition, problems } from '../src/shelf.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// The multi-site build sets OUT_DIR to dist/<slug>/; a standalone run writes to the same place.
const dist = process.env.OUT_DIR
  ? path.resolve(process.env.OUT_DIR)
  : path.join(root, '..', 'dist', path.basename(root));

const data = JSON.parse(fs.readFileSync(path.join(root, 'data/data.json'), 'utf8'));
const esc = s => String(s).replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* A bad entry stops the build here, naming the entry, instead of reaching the
   page as a blank spine or the word "undefined". */
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
  'September', 'October', 'November', 'December'];
const day = /^(\d{4})-(\d\d)-(\d\d)$/.exec(data.updated ?? '');
const faults = [
  ...['title', 'eyebrow', 'tagline', 'heading'].filter(k => typeof data[k] !== 'string' || !data[k].trim())
    .map(k => `${k} must be a non-empty string`),
  ...(day && MONTHS[day[2] - 1] ? [] : ['updated must be a date written YYYY-MM-DD']),
  ...problems(data.discs),
];
if (faults.length) {
  console.error('data/data.json cannot be built:');
  for (const f of faults) console.error('  ✗ ' + f);
  process.exit(1);
}

const discs = data.discs;
const sum = summarize(discs);
const format = d => FORMATS.find(f => f.id === d.format);
const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;

/* The colours and sizes of a spine travel as custom properties. problems()
   has already held them to hex colours and plain numbers. */
const look = ({ look: l }) => [
  `--s-bg:${l.bg}`, `--s-ink:${l.ink}`, ...(l.cap ? [`--s-cap:${l.cap}`] : []),
  `--w:${l.width}`, ...(l.height ? [`--h:${l.height}`] : []),
].join(';');

/* The words on a spine are sized to fit it, from --len: how many characters
   one line has to hold. A long title on a box wide enough for it is set in
   two lines, as the box itself is, and --len is then the longer half with a
   little slack for a break that falls off-centre. */
const label = d => d.spine ?? d.title;
const twoLines = d => d.look.width >= 1.6 && label(d).length > 18;
const len = d => twoLines(d) ? Math.ceil(label(d).length / 2) + 3 : label(d).length;

// What the shelf needs to size a case so the row fits: how many there are,
// and their widths added up, in case-widths.
const units = Math.round(discs.reduce((n, d) => n + d.look.width, 0) * 100) / 100;

const spinesHtml = discs.map(d => `
      <li><a class="spine face-${d.look.face ?? 'sans'}${twoLines(d) ? ' two' : ''}" href="#d-${d.id}" data-id="${d.id}" style="${look(d)};--len:${len(d)}" title="${esc(d.title)}">${d.look.cap ? `
        <span class="cap"></span>` : ''}
        <span class="t">${esc(label(d))}</span>
        <span class="m">${esc(format(d).short)}${d.number ? `<br>${d.number}` : ''}</span>
      </a></li>`).join('');

const rowsHtml = arrange(discs).map(d => `
      <li class="disc" id="d-${d.id}" data-id="${d.id}">
        <span class="swatch" style="--s-bg:${d.look.bg}"></span>
        <div class="what">
          <h3>${esc(d.title)}</h3>
          <p class="by">${esc(years(d))} · ${esc(d.director)}</p>
          <p class="ed">${edition(d).map(esc).join(' · ')}</p>
        </div>
        <span class="fmt fmt-${format(d).short.toLowerCase()}">${esc(d.format)}</span>
      </li>`).join('');

// A chip that would show nothing is left out; Everything always stays.
const chipsHtml = SHOWS.filter(s => s.id === 'all' || sum.shows[s.id] > 0).map(s => `
        <label class="chip"><input type="radio" name="show" value="${s.id}"${s.id === 'all' ? ' checked' : ''}><span>${esc(s.label)} <b>${sum.shows[s.id]}</b></span></label>`).join('');

const sortsHtml = SORTS.map(s => `<option value="${s.id}">${esc(s.label)}</option>`).join('');

const span = sum.total
  ? `, from ${esc(sum.oldest.title)} (${sum.oldest.year}) to ${esc(sum.newest.title)} (${sum.newest.yearEnd ?? sum.newest.year})` : '';
const lede = `The shelf holds ${plural(sum.total, 'title')}${span}: `
  + `${sum.shows['4k']} in 4K Ultra HD and ${sum.shows.bluray} on Blu-ray`
  + (sum.shows.criterion ? `, ${sum.shows.criterion} of them from the Criterion Collection` : '')
  + '. They are listed in the order they stand, left to right. Pick a spine to find it in the list.';

// Only what arrange() reads goes to the browser.
const inline = JSON.stringify(discs.map(({ id, title, year, yearEnd, format, label }) =>
  ({ id, title, year, yearEnd, format, label }))).replace(/</g, '\\u003c');

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(data.title)}</title>
<meta name="description" content="${esc(data.tagline)}">
<meta name="theme-color" content="#131210" media="(prefers-color-scheme: dark)">
<meta name="theme-color" content="#f3f0e9" media="(prefers-color-scheme: light)">
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>📀</text></svg>">
<link rel="stylesheet" href="./styles.css">
<script id="discs" type="application/json">${inline}</script>
<script type="module" src="./app.js"></script>
</head>
<body>
<div class="wrap">
  <header>
    <div class="eyebrow">${esc(data.eyebrow)}</div>
    <h1>${esc(data.heading)}</h1>
    <p class="lede">${lede}</p>
  </header>

  <nav class="shelf" aria-label="The shelf, left to right" style="--n:${discs.length};--units:${units}">
    <ol class="spines" id="spines">${spinesHtml}
    </ol>
    <div class="plank"></div>
  </nav>

  <main>
    <div class="bar">
      <h2>The list</h2>
      <form class="controls" id="controls" hidden>
        <fieldset class="chips">
          <legend class="vh">Show</legend>${chipsHtml}
        </fieldset>
        <label class="order">Order <select name="sort" id="sort">${sortsHtml}</select></label>
      </form>
    </div>
    <p class="tally" id="tally" aria-live="polite"></p>
    <ol class="list" id="list">${rowsHtml}
    </ol>
  </main>

  <footer>
    <p>Catalogued from the shelf on <time datetime="${esc(data.updated)}">${Number(day[3])} ${MONTHS[day[2] - 1]} ${day[1]}</time>.
      Editions are listed as their spines read.</p>
    <p><a href="../">all sites</a></p>
  </footer>
</div>
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
for (const asset of ['app.js', 'shelf.js', 'styles.css']) {
  fs.copyFileSync(path.join(root, 'src', asset), path.join(dist, asset));
}

console.log(`Built ${data.title} (${plural(sum.total, 'title')}) -> ${path.relative(process.cwd(), dist) || dist}/`);
