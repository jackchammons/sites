#!/usr/bin/env node
/*
 * Build for Now.
 *
 * The page is live, so this build renders only the shell: the hero, the dial,
 * the labelled slots for every figure, and one row per city in
 * data/clocks.json. src/app.js fills those slots from the viewer's own clock.
 * Nothing time-dependent is baked into the markup — a value rendered here
 * would be wrong by however long ago the site was published.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// The multi-site build sets OUT_DIR to dist/<slug>/; a standalone run writes dist/.
const dist = process.env.OUT_DIR
  ? path.resolve(process.env.OUT_DIR)
  : path.join(root, '..', 'dist');

const data = JSON.parse(fs.readFileSync(path.join(root, 'data/clocks.json'), 'utf8'));
const esc = s => String(s).replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ---- analog dial ---- */
const ticks = Array.from({ length: 60 }, (_, i) => {
  const major = i % 5 === 0;
  const a = (i * 6) * Math.PI / 180;
  const r1 = major ? 34 : 40.5, r2 = 43.5;
  const x = Math.sin(a), y = -Math.cos(a);
  const f = n => (50 + n).toFixed(2);
  return `<line class="tick${major ? ' major' : ''}" x1="${f(x * r1)}" y1="${f(y * r1)}" x2="${f(x * r2)}" y2="${f(y * r2)}"/>`;
}).join('');

const dial = `<svg class="dial" viewBox="0 0 100 100" role="img" aria-label="Analog clock showing the current time">
      <circle class="face" cx="50" cy="50" r="47"/>
      ${ticks}
      <line class="hand hour"   id="hand-hour"   x1="50" y1="54" x2="50" y2="27"/>
      <line class="hand minute" id="hand-minute" x1="50" y1="56" x2="50" y2="16"/>
      <line class="hand second" id="hand-second" x1="50" y1="60" x2="50" y2="14"/>
      <circle class="pin" cx="50" cy="50" r="2.6"/>
    </svg>`;

/* ---- facts ---- */
const FACTS = [
  ['iso', 'ISO 8601', 'the machine-readable form of this instant, with your offset'],
  ['utc', 'UTC', 'the same instant at the prime meridian'],
  ['unix', 'Unix time', 'seconds elapsed since the epoch'],
  ['tz', 'Time zone', 'the IANA zone your browser reports'],
  ['offset', 'UTC offset', 'how far your zone sits from UTC right now'],
  ['week', 'ISO week', 'weeks run Monday to Sunday'],
  ['doy', 'Day of year', 'counting from 1 January'],
  ['quarter', 'Quarter', 'calendar quarter'],
];

const factsHtml = FACTS.map(([key, label, title]) => `
        <div class="fact">
          <dt title="${esc(title)}">${esc(label)}</dt>
          <dd${key === 'iso' ? ' class="tight"' : ''}><span id="fact-${key}" class="pending">—</span><small id="note-${key}" class="pending"></small></dd>
        </div>`).join('');

/* ---- progress bars ---- */
const BARS = [
  ['day', 'Today'],
  ['week', 'This week'],
  ['month', 'This month'],
  ['year', 'This year'],
];

const barsHtml = BARS.map(([key, label]) => `
        <div class="bar">
          <div class="bar-top"><span>${esc(label)}</span><b id="pct-${key}" class="pending">—</b></div>
          <div class="track" id="track-${key}" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-label="${esc(label)} elapsed">
            <div class="fill" id="fill-${key}"></div>
          </div>
          <div class="rest" id="rest-${key}"></div>
        </div>`).join('');

/* ---- world clocks ---- */
const zonesHtml = data.zones.map(z => `
        <li data-tz="${esc(z.tz)}">
          <div class="zc"><span class="dot"></span><span>${esc(z.city)}</span></div>
          <div class="zt pending"><span class="zt-time">00:00</span><span class="zsuffix"></span></div>
          <div class="zmeta"><span class="off pending"></span><span class="dayrel pending"></span><span>${esc(z.region)}</span></div>
        </li>`).join('');

const built = new Date().toISOString();

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(data.title)} — ${esc(data.tagline)}</title>
<meta name="description" content="${esc(data.tagline)} A live clock and calendar readout — ISO timestamp, Unix time, week number, progress through the day, month and year, and ${data.zones.length} world clocks.">
<meta name="theme-color" content="#14100e" media="(prefers-color-scheme: dark)">
<meta name="theme-color" content="#fbf6ef" media="(prefers-color-scheme: light)">
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🕰️</text></svg>">
<link rel="stylesheet" href="./styles.css">
<script src="./app.js" defer></script>
</head>
<body>

<header><div class="wrap">
  <div class="hero">
    ${dial}
    <div>
      <p class="time pending" role="timer" aria-live="off"><span id="time-hm">00:00</span><span class="sec" id="time-sec">:00</span><span class="suffix" id="time-suffix"></span></p>
      <p class="date pending" id="date">—</p>
      <p class="zone pending" id="zone"></p>
    </div>
  </div>
  <div class="controls" id="controls" hidden>
    <button type="button" id="toggle-format" aria-pressed="false">24-hour</button>
    <button type="button" id="toggle-seconds" aria-pressed="true">Seconds</button>
  </div>
  <p class="noscript" id="boot-error" hidden>This clock could not start in this browser — the figures below
    are placeholders, not the time. The console has the reason.</p>
  <noscript><p class="noscript">This page is a clock, and a clock has to run: every figure below is
    computed in your browser, second by second. With JavaScript switched off there is nothing to show —
    a time baked in when the page was built would be wrong by however long ago that was.</p></noscript>
</div></header>

<main><div class="wrap">

  <section>
    <div class="head"><h2>This instant, written out</h2><span class="eyebrow">local</span></div>
    <dl class="facts">${factsHtml}
    </dl>
  </section>

  <section>
    <div class="head"><h2>How far through</h2><span class="eyebrow">elapsed</span></div>
    <div class="bars">${barsHtml}
    </div>
  </section>

  <section>
    <div class="head"><h2>Elsewhere</h2><span class="eyebrow">${data.zones.length} zones</span></div>
    <ul class="zones">${zonesHtml}
    </ul>
  </section>

</div></main>

<footer><div class="wrap">
  <p>${esc(data.note)}</p>
  <p>Offsets and zone names come from your browser's own copy of the IANA time zone database,
     so summer time is handled wherever the rules say it should be. The daylight dot beside each
     city is banded from the local hour, not from a sunrise table.</p>
  <p>Page built ${esc(built)} · <a href="../">all sites</a></p>
</div></footer>

</body>
</html>
`;

fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });
fs.writeFileSync(path.join(dist, 'index.html'), html);
for (const asset of ['app.js', 'styles.css']) {
  fs.copyFileSync(path.join(root, 'src', asset), path.join(dist, asset));
}
fs.writeFileSync(path.join(dist, '.nojekyll'), '');

console.log(`Built Now (${data.zones.length} zones) -> ${path.relative(process.cwd(), dist) || dist}/`);
