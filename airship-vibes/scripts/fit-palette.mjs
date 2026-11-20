#!/usr/bin/env node
/* Fit a scene's palette to what the scene renders. A dev tool, not part of
 * the build: it needs Chromium via Playwright, which CI does not have.
 *
 *   node scripts/fit-palette.mjs <scene> [--colours 52] [--write]
 *
 * It builds the site, draws every shot of the scene at a few moments with the
 * palette step switched off, and runs k-means in Oklab over the pixels. The
 * scene's `anchors` are held fixed, so the hand-picked colours survive and the
 * fit spends the rest where the picture is. Prints the palette, with how well
 * it fits; --write puts it into src/scenes.js.
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { oklab, hexToRgb } from '../src/palette.js';
import { SCENES, sceneById } from '../src/scenes.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf('--' + name); if (i < 0) return fallback; return args.splice(i, 2)[1]; };
const count = Number(opt('colours', '52'));
const write = args.includes('--write');
const scene = sceneById(args.find(a => !a.startsWith('--')));
if (!scene || !(count > scene.anchors.length && count <= 64)) {
  console.error(`usage: node scripts/fit-palette.mjs <${SCENES.map(s => s.id).join('|')}> [--colours 17..64] [--write]`);
  process.exit(1);
}

const require = createRequire(import.meta.url);
let chromium;
for (const p of ['/opt/node22/lib/node_modules/playwright', 'playwright']) {
  try { ({ chromium } = require(p)); break; } catch {}
}
if (!chromium) { console.error('playwright not found'); process.exit(2); }

const dist = fs.mkdtempSync(path.join(fs.realpathSync(process.env.TMPDIR || '/tmp'), 'vibes-fit-'));
execFileSync(process.execPath, [path.join(root, 'scripts/build.mjs')], { env: { ...process.env, OUT_DIR: dist }, stdio: 'ignore' });
const server = http.createServer((req, res) => {
  const f = path.join(dist, decodeURIComponent(req.url.split('?')[0]).replace(/\/$/, '/index.html'));
  if (!f.startsWith(dist) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': f.endsWith('.js') ? 'text/javascript' : 'text/html' });
  fs.createReadStream(f).pipe(res);
});
await new Promise(r => server.listen(0, r));

/* ---- the pixels ---- */
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 768, height: 432 }, deviceScaleFactor: 1 });
await page.goto(`http://localhost:${server.address().port}/?t=0&px=2&seed=7`);
await page.waitForFunction(() => window.__vibes && window.__vibes.ready, null, { timeout: 60000 });
let pixels = [];
for (let shot = 0; shot < scene.shots.length; shot++) {
  for (const t of [12, 70 + shot * 31]) {
    const info = await page.evaluate(([id, shot, t]) => window.__vibes.frame(t, { scene: id, shot, seed: 7, raw: true, caption: false, probe: true, pixels: true }), [scene.id, shot, t]);
    pixels.push(...info.pixels);
  }
}
await browser.close();
server.close();
fs.rmSync(dist, { recursive: true, force: true });

// a fixed, even sample: enough to place fifty colours, quick to iterate over
const STEP = Math.max(1, Math.floor(pixels.length / 60000));
pixels = pixels.filter((_, i) => i % STEP === 0);
const lab = pixels.map(c => oklab([(c >> 16 & 255) / 255, (c >> 8 & 255) / 255, (c & 255) / 255]));

/* ---- k-means, anchors fixed ---- */
const fixed = scene.anchors.map(h => oklab(hexToRgb(h)));
const d2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
let seed = 1;
const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
// start each free colour on a pixel the palette so far serves badly
const free = [];
const worst = lab.map(p => Math.min(...fixed.map(c => d2(p, c))));
for (let k = fixed.length; k < count; k++) {
  const total = worst.reduce((a, b) => a + b, 0);
  let r = rand() * total, i = 0;
  while (i < worst.length - 1 && (r -= worst[i]) > 0) i++;
  free.push(lab[i].slice());
  for (let j = 0; j < lab.length; j++) worst[j] = Math.min(worst[j], d2(lab[j], lab[i]));
}
const nearest = (p, cs) => { let b = 0, bd = Infinity; for (let i = 0; i < cs.length; i++) { const d = d2(p, cs[i]); if (d < bd) { bd = d; b = i; } } return [b, bd]; };
for (let it = 0; it < 20; it++) {
  const all = [...fixed, ...free];
  const sum = free.map(() => [0, 0, 0, 0]);
  for (const p of lab) {
    const [i] = nearest(p, all);
    if (i >= fixed.length) { const s = sum[i - fixed.length]; s[0] += p[0]; s[1] += p[1]; s[2] += p[2]; s[3]++; }
  }
  sum.forEach((s, i) => { if (s[3]) free[i] = [s[0] / s[3], s[1] / s[3], s[2] / s[3]]; });
}

/* ---- back to hex, ordered by hue then lightness ---- */
const toHex = ([L, a, b]) => {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3, m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3, s = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3;
  const lin = [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s];
  return '#' + lin.map(c => Math.min(1, Math.max(0, c))).map(c => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055))
    .map(c => Math.round(c * 255).toString(16).padStart(2, '0')).join('');
};
const all = [...fixed, ...free];
let hexes = [...scene.anchors, ...free.map(toHex)];
const order = hexes.map((_, i) => i).sort((i, j) => {
  const key = c => (Math.hypot(c[1], c[2]) > 0.035 ? Math.round(Math.atan2(c[2], c[1]) * 4 / Math.PI) : -9);
  return key(all[i]) - key(all[j]) || all[i][0] - all[j][0];
});
hexes = [...new Set(order.map(i => hexes[i]))];

const errs = lab.map(p => Math.sqrt(nearest(p, all)[1])).sort((a, b) => a - b);
console.log(`${scene.id}: ${hexes.length} colours from ${lab.length} pixels of ${scene.shots.length * 2} frames`);
console.log(`  mean error ${(errs.reduce((a, b) => a + b, 0) / errs.length).toFixed(4)}, 95th percentile ${errs[Math.floor(errs.length * 0.95)].toFixed(4)} (Oklab units; 0.02 is a just-visible step)`);
const rows = [];
for (let i = 0; i < hexes.length; i += 8) rows.push('    ' + hexes.slice(i, i + 8).map(h => `'${h}'`).join(', ') + ',');
const body = `palette: [\n${rows.join('\n')}\n  ],`;
console.log('  ' + body);

if (write) {
  const file = path.join(root, 'src/scenes.js');
  const src = fs.readFileSync(file, 'utf8');
  const at = src.indexOf(`id: '${scene.id}'`), a = src.indexOf('palette: [', at), b = src.indexOf('],', a) + 2;
  fs.writeFileSync(file, src.slice(0, a) + body + src.slice(b));
  console.log(`  written to ${path.relative(process.cwd(), file)}`);
}
