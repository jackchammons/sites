#!/usr/bin/env node
/*
 * Build for Word Counter.
 *
 * The page is live: everything is counted in the viewer's browser as they
 * type, so this build renders only the shell — the text box, the labelled
 * slots for every figure, and the sample passage and rates as inline JSON
 * for src/app.js to read. src/count.js holds the counting rules and is
 * copied into dist unchanged, so the verifier can run the deployed copy.
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

/* The proof-mark column: [section, [[id, label], ...]]. Every id here must be
   one app.js writes to; verify.mjs checks the pairing from the built copy. */
const MARKS = [
  ['Characters', [
    ['s-chars', 'Characters'], ['s-chars-ns', 'Without spaces'], ['s-letters', 'Letters'],
    ['s-digits', 'Digits'], ['s-punct', 'Punctuation'],
  ]],
  ['Structure', [
    ['s-lines', 'Lines'], ['s-lines-ne', 'Non-empty lines'], ['s-sentences', 'Sentences'],
    ['s-paragraphs', 'Paragraphs'], ['s-unique', 'Unique words'],
  ]],
  ['Averages', [
    ['s-avg-word', 'Word length'], ['s-avg-sent', 'Words per sentence'], ['s-longest', 'Longest word'],
  ]],
  ['Time', [
    ['s-read', `Reading (${data.readingWpm} wpm)`], ['s-speak', `Speaking (${data.speakingWpm} wpm)`],
  ]],
];

const marksHtml = MARKS.map(([section, rows]) => `
        <h2>${esc(section)}</h2>${rows.map(([id, label]) => `
        <div class="mark"><dt>${esc(label)}</dt><dd id="${id}">—</dd></div>`).join('')}`).join('');

const config = JSON.stringify({
  readingWpm: data.readingWpm,
  speakingWpm: data.speakingWpm,
  sample: data.sample,
}).replace(/</g, '\\u003c');

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(data.title)}</title>
<meta name="description" content="${esc(data.tagline)}">
<meta name="theme-color" content="#1b1a17" media="(prefers-color-scheme: dark)">
<meta name="theme-color" content="#f3efe6" media="(prefers-color-scheme: light)">
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>📝</text></svg>">
<link rel="stylesheet" href="./styles.css">
<script id="config" type="application/json">${config}</script>
<script type="module" src="./app.js"></script>
</head>
<body>
<div class="wrap">
  <header>
    <div class="eyebrow">${esc(data.eyebrow)}</div>
    <h1>${esc(data.heading)}</h1>
    <p>${esc(data.intro)}</p>
    <noscript><p class="noscript">This page counts in your browser as you type, so with JavaScript switched off
      the figures stay blank. There is nothing to count until there is text.</p></noscript>
  </header>

  <div class="galley">
    <section class="sheet" aria-label="Your text">
      <div class="toolbar">
        <label for="text">Manuscript</label>
        <div class="buttons">
          <button type="button" id="paste-btn">Paste</button>
          <button type="button" id="sample-btn">Load sample</button>
          <button type="button" id="clear-btn">Clear</button>
        </div>
      </div>
      <textarea id="text" spellcheck="true" placeholder="Start typing, or paste a draft here…"></textarea>
      <div class="status" id="status" aria-live="polite"></div>
    </section>

    <aside class="proof" aria-label="Statistics">
      <div class="lede">
        <div class="n" id="s-words">—</div>
        <div class="l">words</div>
      </div>

      <dl class="marks">${marksHtml}
        <h2>Most used words</h2>
      </dl>
      <div class="freq" id="freq"><div class="freq-empty">Nothing to count yet.</div></div>
    </aside>
  </div>

  <footer>
    <p>${esc(data.note)}</p>
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
for (const asset of ['app.js', 'count.js', 'styles.css']) {
  fs.copyFileSync(path.join(root, 'src', asset), path.join(dist, asset));
}
fs.writeFileSync(path.join(dist, '.nojekyll'), '');

console.log(`Built ${data.title} -> ${path.relative(process.cwd(), dist) || dist}/`);
