#!/usr/bin/env node
/*
 * Build for Screen & Seat.
 *
 * Everything is computed in the browser, so this renders the form (seeded
 * with the example room in data/defaults.json), the labelled output slots
 * and the method copy, then copies src/ beside it. src/app.js fills every
 * slot by importing the same src/screen.js the tests and the deploy gate
 * use — one implementation of the maths.
 *
 * Nothing room-specific is decided here: the defaults are an example, and
 * the page says so. The method section prints the constants from screen.js
 * so the copy can never drift from the code.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ASPECTS, RESOLUTIONS, ANGLE_STANDARDS, ITU_STANDARDS, RULE_OF_THUMB,
  BRIGHTNESS, PLACEMENT, EYE_LIMIT, MATRIX_RESOLUTIONS, ppdForFraction,
} from '../src/screen.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// The multi-site build sets OUT_DIR to dist/<slug>/; a standalone run writes dist/.
const dist = process.env.OUT_DIR
  ? path.resolve(process.env.OUT_DIR)
  : path.join(root, '..', 'dist');

const data = JSON.parse(fs.readFileSync(path.join(root, 'data/defaults.json'), 'utf8'));
const esc = s => String(s).replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const v = data.inputs;

if (!ASPECTS.some(a => a.id === v.aspect)) throw new Error(`unknown default aspect ${v.aspect}`);
if (!RESOLUTIONS.some(r => r.id === v.resolution)) throw new Error(`unknown default resolution ${v.resolution}`);

/* A text field with optional adornments. The unit adornment gets an id so
   app.js can swap it when the units change. */
const field = ({ id, label, value, pre, post, hint, mode = 'decimal' }) => `
      <label class="field" for="${id}">
        <span class="lbl">${esc(label)}</span>
        <span class="box">${pre ? `<i>${esc(pre)}</i>` : ''}<input id="${id}" name="${id}" type="text" inputmode="${mode}" autocomplete="off" spellcheck="false" value="${esc(value)}">${post ? `<i id="${id}-unit">${esc(post)}</i>` : ''}</span>
        ${hint ? `<span class="hint" id="${id}-hint">${hint}</span>` : ''}
      </label>`;

const select = ({ id, label, options, selected, hint }) => `
      <label class="field" for="${id}">
        <span class="lbl">${esc(label)}</span>
        <span class="box"><select id="${id}" name="${id}">${options.map(o =>
          `<option value="${esc(o.id)}"${o.id === selected ? ' selected' : ''}>${esc(o.label)}</option>`).join('')}</select></span>
        ${hint ? `<span class="hint">${hint}</span>` : ''}
      </label>`;

const FACTS = [
  ['size', 'Picture'],
  ['area', 'Area'],
  ['vfov', 'Vertical angle'],
  ['density', 'Pixel density'],
  ['pixel', 'At the centre'],
  ['avg', 'Across the picture'],
  ['res', '20/20 limit'],
  ['eye', 'Would see sharper'],
  ['tilt', 'Eye line to centre'],
];
const facts = FACTS.map(([k, label]) => `
        <div class="fact" id="fact-${k}">
          <dt>${esc(label)}</dt>
          <dd><span id="sum-${k}">—</span><small id="sub-${k}"></small></dd>
        </div>`).join('');

const PJ = [
  ['throw', 'Lens to screen'],
  ['lens', 'Lens height'],
  ['fl', 'Screen brightness'],
  ['width', 'Image width'],
];
const pjFacts = PJ.map(([k, label]) => `
        <div class="fact" id="fact-${k}">
          <dt>${esc(label)}</dt>
          <dd><span id="sum-${k}">—</span><small id="sub-${k}"></small></dd>
        </div>`).join('');

const built = new Date().toISOString();
const deg = x => `${x}°`;

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(data.title)} — TV and projector size, distance and placement</title>
<meta name="description" content="${esc(data.tagline)} Viewing distance by THX, SMPTE and ITU standards, field of view, when 4K stops mattering, screen dimensions by aspect ratio, projector throw and brightness, and mounting height.">
<meta name="theme-color" content="#111318" media="(prefers-color-scheme: dark)">
<meta name="theme-color" content="#f5f6fa" media="(prefers-color-scheme: light)">
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>📐</text></svg>">
<link rel="stylesheet" href="./styles.css">
<script type="application/json" id="defaults">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>
<script type="module" src="./app.js"></script>
</head>
<body>

<header><div class="wrap">
  <p class="eyebrow">sites.jackhammons.com · screen</p>
  <h1>${esc(data.title)}</h1>
  <p class="lede">${esc(data.tagline)}</p>
</div></header>

<main><div class="wrap">
  <p class="boot-error" id="boot-error" hidden>The calculator script did not start, so nothing below will update. Reload the page; if it persists, the browser may be too old for ES modules.</p>

  <div class="grid">

  <form class="panel inputs" id="form" autocomplete="off" novalidate>
    <div class="segs">
      <div class="seg" role="group" aria-label="Units">
        <button type="button" id="unit-imperial" aria-pressed="true">in / ft</button>
        <button type="button" id="unit-metric" aria-pressed="false">cm / m</button>
      </div>
      <div class="seg" role="group" aria-label="Display type">
        <button type="button" id="mode-tv" aria-pressed="true">TV</button>
        <button type="button" id="mode-pj" aria-pressed="false">Projector</button>
      </div>
    </div>

    <h2>The screen</h2>
    <div class="pair">
      ${field({ id: 'in-diag', label: 'Diagonal', value: v.diagonal, post: 'in' })}
      ${select({ id: 'in-aspect', label: 'Shape', options: ASPECTS, selected: v.aspect })}
    </div>
    ${select({ id: 'in-res', label: 'Resolution', options: [...RESOLUTIONS, { id: 'custom', label: 'Custom…' }], selected: v.resolution })}
    <div id="custom-res" hidden>
      <div class="pair">
        ${field({ id: 'in-resw', label: 'Pixels across', value: v.customW, mode: 'numeric' })}
        ${field({ id: 'in-resh', label: 'Pixels down', value: v.customH, mode: 'numeric' })}
      </div>
    </div>
    <div class="actions" style="margin:0 0 14px">
      <button type="button" class="quiet" id="btn-this">Use this screen’s pixels</button>
      <span class="status" id="this-note"></span>
    </div>

    <h2>The seat</h2>
    ${field({ id: 'in-dist', label: 'Eyes to screen', value: 9, post: 'ft', hint: '8′6″, 8 ft 6 in or 2.6 m all work' })}
    <div class="pair">
      ${field({ id: 'in-eye', label: 'Seated eye height', value: v.eyeHeight, post: 'in', hint: 'A sofa seats eyes at 38–46 in' })}
      ${field({ id: 'in-centre', label: 'Screen centre height', value: v.centreHeight, post: 'in' })}
    </div>

    <fieldset id="pj-fields" hidden>
      <h2>The projector</h2>
      <div class="pair">
        ${field({ id: 'in-throw1', label: 'Throw ratio, wide', value: v.throwMin })}
        ${field({ id: 'in-throw2', label: 'Throw ratio, tele', value: v.throwMax })}
      </div>
      <div class="pair">
        ${field({ id: 'in-offset', label: 'Lens offset', value: v.lensOffset, post: '%', hint: '% of picture height, lens axis to picture centre' })}
        ${field({ id: 'in-gain', label: 'Screen gain', value: v.gain, hint: 'Matte white is 1.0' })}
      </div>
      ${field({ id: 'in-lumens', label: 'Projector output', value: v.lumens, post: 'lm', mode: 'numeric', hint: 'Calibrated lumens are often half the box figure' })}
    </fieldset>

    <div class="actions">
      <button type="button" id="btn-copy">Copy link</button>
      <button type="button" class="quiet" id="btn-reset">Reset</button>
      <span class="status" id="status"></span>
    </div>
  </form>

  <section class="panel results" aria-live="polite">
    <p class="eyebrow">Horizontal viewing angle</p>
    <p class="total" id="out-total"><span id="out-fov">—</span><small>of view</small></p>
    <p class="sub" id="out-sub"></p>

    <dl class="facts">${facts}
    </dl>
  </section>

  </div>

  <section class="panel chart-panel">
    <div class="head">
      <h2>Where the standards put your seat</h2>
    </div>
    <ul class="chart-legend">
      <li><span class="sw s1"></span>Seating standards, by viewing angle</li>
      <li><span class="sw s3"></span>Resolution: where pixels stop being visible</li>
      <li><span class="sw s4"></span>Rule of thumb</li>
      <li><span class="sw you"></span>Your seat</li>
    </ul>
    <div class="lanes" id="lanes"></div>
    <div class="tip" id="tip" hidden></div>
  </section>

  <section class="panel chart-panel">
    <div class="head">
      <h2>Who could see a sharper display</h2>
    </div>
    <div class="lanes" id="eye-bar"></div>
    <div class="tip" id="eye-tip" hidden></div>
    <div class="table-wrap" style="margin-top:14px">
      <table class="list" aria-label="Distances at which each resolution target is met">
        <thead><tr><th>Target</th><th>Pixels per degree</th><th>Distance for this screen</th><th>Your seat</th></tr></thead>
        <tbody id="targets"></tbody>
      </table>
    </div>
  </section>

  <section class="panel">
    <div class="head" style="padding:18px 20px 0">
      <h2>Resolution worth paying for</h2>
      <p id="matrix-note"></p>
    </div>
    <p class="note" style="padding:0 20px;margin:0 0 12px">The lowest resolution 19 in 20 people could not tell from a perfect display; sharper buys nothing visible.</p>
    <div class="table-wrap" style="padding:0 20px 20px">
      <table class="mx" id="matrix" aria-label="Resolution limit by screen size and viewing distance"></table>
    </div>
  </section>

  <section class="panel">
    <div class="head" style="padding:18px 20px 0">
      <h2>How far to sit from this screen</h2>
    </div>
    <div class="table-wrap">
      <table class="list" aria-label="Viewing distance by standard">
        <thead><tr><th>Standard</th><th>Distance</th><th>Angle</th><th>× diagonal</th><th>× height</th></tr></thead>
        <tbody id="seats"></tbody>
      </table>
    </div>
  </section>

  <section class="panel">
    <div class="head" style="padding:18px 20px 0">
      <h2>What size for your seat</h2>
      <p id="sizes-note"></p>
    </div>
    <div class="table-wrap">
      <table class="list" aria-label="Screen sizes at your viewing distance">
        <thead><tr><th>Diagonal</th><th>Picture</th><th>Angle</th><th>Verdict</th><th>Pixels</th></tr></thead>
        <tbody id="sizes"></tbody>
      </table>
    </div>
  </section>

  <section class="panel" id="pj-section" hidden>
    <div class="head" style="padding:18px 20px 0">
      <h2>Projector placement</h2>
    </div>
    <div style="padding:0 20px 20px">
      <dl class="facts" style="margin-top:12px">${pjFacts}
      </dl>
    </div>
  </section>

  <section class="panel">
    <div class="head" style="padding:18px 20px 0">
      <h2>Height on the wall</h2>
    </div>
    <div class="side" style="padding:0 20px 20px">
      <div>
        <dl class="facts" style="margin-top:12px">
          <div class="fact" id="fact-top"><dt>Top of picture</dt><dd><span id="sum-top">—</span><small id="sub-top"></small></dd></div>
          <div class="fact" id="fact-bottom"><dt>Bottom of picture</dt><dd><span id="sum-bottom">—</span><small id="sub-bottom"></small></dd></div>
          <div class="fact" id="fact-max"><dt>Highest comfortable centre</dt><dd><span id="sum-max">—</span><small id="sub-max"></small></dd></div>
          <div class="fact" id="fact-stand"><dt>Bottom edge from floor</dt><dd><span id="sum-stand">—</span><small id="sub-stand"></small></dd></div>
        </dl>
      </div>
      <div id="side-view" aria-label="Side view of the seat and screen"></div>
    </div>
  </section>

  <section class="panel method">
    <h2>Method</h2>
    <p>Every figure comes from four inputs — the diagonal, the picture’s shape, the panel’s pixel count and how far your eyes are from the screen — plus the heights for placement and the lens figures for a projector. Nothing is looked up; the standards are constants, listed here as the code holds them.</p>

    <h3>Picture size</h3>
    <p>For a diagonal <code>D</code> and shape <code>r = width ÷ height</code>: <code>height = D ÷ √(1 + r²)</code> and <code>width = height × r</code>. The shapes offered are ${ASPECTS.map(a => `<code>${esc(a.id)}</code>`).join(', ')}.</p>

    <h3>Viewing angle</h3>
    <p>The horizontal angle is what the picture’s width subtends at your eye, viewed square-on from its centre: <code>2 × atan(width ÷ 2d)</code>. The vertical angle uses the height. Each seating standard is a horizontal angle, so the distance it implies is <code>width ÷ (2 × tan(angle ÷ 2))</code>:</p>
    <ul>${ANGLE_STANDARDS.map(s => `
      <li><b>${esc(s.label)}, ${deg(s.angle)}</b> — ${esc(s.note)}</li>`).join('')}
    </ul>
    <p>Colours grade each figure: green meets the standard, amber is inside a weaker one, red is outside every published limit. The headline angle is green from SMPTE’s 30°, amber from THX’s 26°; the vertical angle is graded on the height a 16:9 picture shows at those same angles (${esc(deg(+(2 * Math.atan(Math.tan(15 * Math.PI / 180) * 9 / 16) * 180 / Math.PI).toFixed(1)))} and ${esc(deg(+(2 * Math.atan(Math.tan(13 * Math.PI / 180) * 9 / 16) * 180 / Math.PI).toFixed(1)))}), so a scope picture is judged on the height it actually gives.</p>
    <p>The ITU figures are distances in picture heights rather than angles: ${ITU_STANDARDS.map(s => `${esc(s.label)} at <b>${s.heights}H</b>`).join(', ')}. Each is where one pixel of that format subtends about one minute of arc, which is why they fall close to the resolution limits below. The pre-HD rule of thumb, <b>${RULE_OF_THUMB.near}× to ${RULE_OF_THUMB.far}× the diagonal</b>, is shown for comparison; it dates from standard-definition tubes and lands well outside every cinema standard.</p>

    <h3>Resolution</h3>
    <p>A pixel’s pitch is the picture width divided by the panel’s pixel count across (the panel is scaled to fit inside the picture area, so a scope screen with a 16:9 panel uses the height instead). An eye with 20/20 (6/6) acuity resolves detail about one minute of arc apart, so individual pixels disappear beyond <code>pitch ÷ tan(1′)</code>, where the picture delivers 60 pixels per degree. Past that distance a sharper panel adds nothing you can see; closer, the next resolution down would show its structure. Sharper-than-average eyes push each limit out by their acuity in arc-minutes.</p>

    <h3>The eye’s own limit</h3>
    <p>One arc-minute is the textbook 20/20 figure, but a sliding-display experiment at Cambridge (Ashraf, Chapiro and Mantiuk, <a href="${esc(EYE_LIMIT.paper)}">“Resolution limit of the eye — how many pixels can we see?”</a>, Nature Communications 16:9086, 2025) measured where people actually stop seeing a difference: a median of about ${Math.round(ppdForFraction(0.5))} pixels per degree for black-and-white detail, with 19 in 20 people below about ${Math.round(ppdForFraction(0.05))}. Their <a href="${esc(EYE_LIMIT.calculator)}">display resolution calculator</a> fits the per-person limit as a normal distribution over the cube root of cycles per degree (half the pixels per degree) with mean <code>${EYE_LIMIT.mu}</code> and standard deviation <code>${EYE_LIMIT.sigma}</code>; the share of people who would notice a sharper display than one showing <code>p</code> pixels per degree is <code>1 − Φ((∛(p ÷ 2) − ${EYE_LIMIT.mu}) ÷ ${EYE_LIMIT.sigma})</code>. The same fit drives the bar, the target distances and the resolution matrix here, which climbs ${MATRIX_RESOLUTIONS.map(r => r.label).join(', ')}. Pixels per degree at the centre is <code>1 ÷ (2 × atan(pitch ÷ 2d))</code>; the average across the picture is the panel’s rows divided by the vertical angle, lower because a flat panel’s edge pixels are seen obliquely.</p>

    <h3>Projector</h3>
    <p>Throw ratio is lens-to-screen distance over image width, so a lens quoted at <code>${v.throwMin}–${v.throwMax}</code> fills a given width from <code>${v.throwMin} × width</code> to <code>${v.throwMax} × width</code>; the two ends of the zoom bound where the projector can sit. Lens offset is quoted as a percentage of picture height between the lens axis and the picture centre: 0% puts the lens level with the centre, 50% level with the bottom edge. Screen brightness in foot-lamberts is <code>lumens × gain ÷ area in ft²</code> (1 fL = 3.426 cd/m²). Targets: <b>${BRIGHTNESS.cinema} fL</b> is the SMPTE ST 431-1 cinema reference, <b>${BRIGHTNESS.sdrHome} fL</b> the floor home calibrators work above, and around <b>${BRIGHTNESS.bright} fL</b> for a bright room or HDR headroom. Use calibrated lumens, not the box figure.</p>

    <h3>Height</h3>
    <p>The eye line to the picture centre is <code>atan((centre − eye) ÷ d)</code>. Up to <b>${PLACEMENT.maxUp}°</b> above the eye and <b>${PLACEMENT.maxDown}°</b> below is comfortable for a long sitting; the highest comfortable centre is <code>eye + d × tan(${PLACEMENT.maxUp}°)</code>. The default seated eye height of ${v.eyeHeight} in is a typical sofa; measure yours.</p>

    <p>Inputs accept feet-and-inches (<code>8′6″</code>, <code>8 ft 6 in</code>, <code>8.5</code>) or metric (<code>2.6 m</code>, <code>260 cm</code>) whatever the unit toggle says. The defaults are an example room, not a recommendation. Nothing leaves your browser: the numbers live in the page’s URL hash so a link reproduces them.</p>
  </section>

</div></main>

<footer><div class="wrap">
  <span>Built ${built}</span>
  <span><a href="../">All sites</a> · <a href="https://github.com/jackchammons/sites/tree/main/screen">Source</a></span>
</div></footer>
</body>
</html>
`;

fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });
fs.writeFileSync(path.join(dist, 'index.html'), html);
for (const f of ['app.js', 'screen.js', 'styles.css']) {
  fs.copyFileSync(path.join(root, 'src', f), path.join(dist, f));
}
fs.writeFileSync(path.join(dist, '.nojekyll'), '');

console.log(`Built Screen & Seat -> ${path.relative(process.cwd(), dist) || dist}/`);
