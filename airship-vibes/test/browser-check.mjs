#!/usr/bin/env node
/* Drive the BUILT page in Chromium and check what only a browser can answer.
 *
 * The unit tests cover the modules that decide what is drawn, and verify.mjs
 * the seams between them. Neither can compile a shader. This compiles every
 * program by drawing every shot of every scene, wide and tall, and holds each
 * frame to what the page promises: no WebGL error, a picture and not a blank,
 * and every pixel one of the scene's palette colours. Then it checks the page
 * itself: it animates, a click changes scene, reduced motion holds still, a
 * resize is survived and a browser without WebGL 2 gets a sentence instead of
 * a black page.
 *
 * Needs Chromium via Playwright (installed on the dev box, not in CI):
 *   node scripts/build.mjs && node test/browser-check.mjs
 * OUT_DIR names the build to drive, as it does for build.mjs and verify.mjs;
 * a build that build-all has already stamped is fine. --stills DIR also saves
 * a PNG of every frame checked.
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = process.env.OUT_DIR
  ? path.resolve(process.env.OUT_DIR)
  : path.join(root, '..', 'dist', path.basename(root));
if (!fs.existsSync(path.join(dist, 'index.html'))) {
  console.error(`no build at ${dist}; run scripts/build.mjs first`); process.exit(2);
}
const stillsAt = process.argv.indexOf('--stills');
const stills = stillsAt > 0 ? path.resolve(process.argv[stillsAt + 1]) : null;
if (stills) fs.mkdirSync(stills, { recursive: true });

const require = createRequire(import.meta.url);
let chromium;
for (const p of ['/opt/node22/lib/node_modules/playwright', 'playwright']) {
  try { ({ chromium } = require(p)); break; } catch {}
}
if (!chromium) { console.error('playwright not found'); process.exit(2); }

// The build is served under /airship-vibes/, as it is deployed.
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const server = http.createServer((req, res) => {
  const p = decodeURIComponent(req.url.split('?')[0].split('#')[0]);
  const f = path.join(dist, p.replace(/^\/airship-vibes\//, '/').replace(/\/$/, '/index.html'));
  if (!p.startsWith('/airship-vibes/') || !f.startsWith(dist) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
await new Promise(r => server.listen(0, r));
const url = (query = '') => `http://localhost:${server.address().port}/airship-vibes/${query}`;

const failures = [];
let checks = 0;
const check = (ok, msg, detail = '') => { checks++; if (!ok) failures.push(detail ? `${msg} :: ${detail}` : msg); };

const browser = await chromium.launch();
const pageErrors = [];
async function open(query, opts = {}, init = null) {
  const ctx = await browser.newContext({ viewport: { width: 768, height: 432 }, deviceScaleFactor: 1, ...opts });
  const page = await ctx.newPage();
  page.on('pageerror', e => pageErrors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') pageErrors.push(m.text()); });
  if (init) await page.addInitScript(init);
  await page.goto(url(query));
  await page.waitForFunction(() => window.__vibes !== undefined, null, { timeout: 60000 });
  return { ctx, page };
}

/* ---- every shot of every scene, wide and tall ------------------------- */
const { scenes, shots } = await (async () => {
  const { ctx, page } = await open('?t=0&px=2');
  const out = await page.evaluate(async () => {
    const { SCENES } = await import('./scenes.js');
    return { scenes: SCENES.map(s => s.id), shots: Object.fromEntries(SCENES.map(s => [s.id, s.shots.map(x => x.name)])) };
  });
  await ctx.close();
  return out;
})();
check(scenes.length === 4, 'four scenes', scenes.join(','));

for (const [label, viewport, px] of [['wide', { width: 768, height: 432 }, 2], ['tall', { width: 390, height: 844 }, 2]]) {
  const { ctx, page } = await open(`?t=0&px=${px}&seed=7`, { viewport });
  check(await page.evaluate(() => window.__vibes.ready), `${label}: the page starts`, await page.textContent('#note'));
  for (const scene of scenes) {
    for (let shot = 0; shot < shots[scene].length; shot++) {
      for (const t of [3, 17]) {
        const where = `${scene}/${shots[scene][shot]} ${label} t=${t}`;
        const info = await page.evaluate(([scene, shot, t]) => window.__vibes.frame(t, { scene, shot, seed: 7, probe: true, caption: t < 10 }), [scene, shot, t]);
        check(info.error === 0, `${where}: WebGL error`, String(info.error));
        check(info.scene === scene && info.shot === shot, `${where}: drew ${info.scene}/${info.shot}`);
        check(info.width * info.scale >= viewport.width && info.height * info.scale >= viewport.height, `${where}: the art does not cover the canvas`);
        check(info.offPalette === 0, `${where}: pixels off the palette`, `${info.offPalette} of ${info.samples}`);
        check(info.colours >= 6, `${where}: only ${info.colours} colours, so nothing much was drawn`);
        check(info.largest < 0.85, `${where}: one colour fills ${(info.largest * 100).toFixed(0)}% of the frame`);
        if (stills) await page.locator('#view').screenshot({ path: path.join(stills, `${scene}-${shots[scene][shot]}-${label}-${t}.png`) });
      }
    }
  }
  await ctx.close();
}

/* ---- the page as a visitor gets it ----------------------------------- */
{
  // It animates: two frames a moment apart differ, and nothing is thrown meanwhile.
  const { ctx, page } = await open('?seed=7&scene=clouds');
  await page.waitForTimeout(1500);
  const a = await page.locator('#view').screenshot();
  await page.waitForTimeout(2500);
  const b = await page.locator('#view').screenshot();
  check(!a.equals(b), 'the picture moves');
  check((await page.getAttribute('#view', 'aria-label')).includes('above the clouds'), 'the canvas is labelled with its scene');

  // A click, a tap's equivalent, moves to the next scene; so does the space bar.
  const before = await page.getAttribute('#view', 'aria-label');
  await page.click('#view');
  await page.waitForTimeout(300);
  const after = await page.getAttribute('#view', 'aria-label');
  check(before !== after, 'a click changes the scene', after);
  await page.keyboard.press('Space');
  await page.waitForTimeout(300);
  check(await page.getAttribute('#view', 'aria-label') !== after, 'the space bar changes the scene');
  for (const key of ['1', '2', '3', '4']) { await page.keyboard.press(key); await page.waitForTimeout(700); }
  check(await page.evaluate(() => window.__vibes.frame(1, { probe: true }).error) === 0, 'all four scenes can be visited in one sitting');

  // A resize is survived, and the canvas follows the window.
  await page.setViewportSize({ width: 500, height: 900 });
  await page.waitForTimeout(600);
  const size = await page.evaluate(() => { const c = document.getElementById('view'); return [c.width, c.height]; });
  check(size[0] === 500 && size[1] === 900, 'the canvas follows a resize', size.join('x'));
  check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight), 'nothing scrolls');
  await ctx.close();
}
{
  // Reduced motion: one still picture, and a click still changes it.
  const { ctx, page } = await open('?seed=7&scene=valley', { reducedMotion: 'reduce' });
  await page.waitForTimeout(600);
  const a = await page.locator('#view').screenshot();
  await page.waitForTimeout(1200);
  const b = await page.locator('#view').screenshot();
  check(a.equals(b), 'with reduced motion the picture holds still');
  await page.click('#view');
  await page.waitForTimeout(300);
  check(!(await page.locator('#view').screenshot()).equals(a), 'with reduced motion a click still changes the scene');
  await ctx.close();
}
{
  // A high-density phone: the art is still about 80,000 pixels, drawn in whole device pixels.
  const { ctx, page } = await open('?t=5&seed=7&scene=sunset', { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 });
  const info = await page.evaluate(() => window.__vibes.frame(5, { probe: true }));
  check(info.width * info.height < 90000 && info.width * info.height > 40000, 'a phone draws about the usual number of pixels', `${info.width}x${info.height}`);
  check(info.scale >= 4 && info.offPalette === 0, 'a phone gets whole-number scaling and the palette', JSON.stringify(info));
  await ctx.close();
}
{
  // No WebGL 2: a sentence, not a black page.
  const { ctx, page } = await open('', {}, () => { HTMLCanvasElement.prototype.getContext = () => null; });
  check(await page.isVisible('#note') && /WebGL 2/.test(await page.textContent('#note')), 'without WebGL 2 the page says so');
  check(await page.isHidden('#view'), 'without WebGL 2 the canvas is put away');
  await ctx.close();
}

check(pageErrors.length === 0, 'no errors on the console', pageErrors.slice(0, 5).join(' | '));
await browser.close();
server.close();

if (failures.length) {
  console.error(`browser check FAILED (${failures.length} of ${checks}):`);
  for (const f of failures) console.error('  ✗ ' + f);
  process.exit(1);
}
console.log(`browser check passed: ${checks} checks, every shot of ${scenes.length} scenes wide and tall.`);
