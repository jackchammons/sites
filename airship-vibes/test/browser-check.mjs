#!/usr/bin/env node
/* Drive the BUILT page in Chromium and check what only a browser can answer.
 *
 * The unit tests cover the modules that decide what is drawn, and verify.mjs
 * the seams between them. Neither can compile a shader. This compiles every
 * program by drawing every shot of every scene, wide and tall, and holds each
 * frame to what the page promises: no WebGL error, a picture and not a blank,
 * and every pixel one of the scene's palette colours. Then it checks the page
 * itself: it animates; taps, swipes and keys step through shots and scenes;
 * the music starts on the first touch, is neither silent nor clipping, and
 * stays off once turned off; the hint comes up once and can be sent away;
 * reduced motion holds still; a resize is survived; and a browser without
 * WebGL 2 gets a sentence instead of a black page.
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
const state = page => page.evaluate(() => window.__vibes.state());
const pause = (page, ms = 250) => page.waitForTimeout(ms);
{
  // It animates: two frames a moment apart differ, and nothing is thrown meanwhile.
  const { ctx, page } = await open('?seed=7&scene=clouds');
  await page.waitForTimeout(1500);
  const a = await page.locator('#view').screenshot();
  await page.waitForTimeout(2500);
  const b = await page.locator('#view').screenshot();
  check(!a.equals(b), 'the picture moves');
  check((await page.getAttribute('#view', 'aria-label')).includes('above the clouds'), 'the canvas is labelled with its scene');
  const begin = await state(page);
  check(begin.shot === 0 && begin.scene === 'clouds' && begin.sound && !begin.playing && !begin.tip,
    'a visit opens on the first shot, silent until touched, with no hint showing', JSON.stringify(begin));

  // A tap or click is the next shot. The first one is also what lets the music start.
  await page.mouse.click(300, 200);
  await pause(page, 500);
  const one = await state(page);
  check(one.shot !== 0 && one.scene === 'clouds', 'a click moves to the next shot, in the same scene', JSON.stringify(one));
  check(one.playing, 'the first click starts the music', JSON.stringify(one));
  // mid-dissolve both shots are drawn: still no WebGL error, still every pixel on the palette
  const mid = await page.evaluate(() => { const g = document.getElementById('view').getContext('webgl2'); return g.getError(); });
  check(mid === 0, 'a dissolve between two live shots raises no WebGL error', String(mid));

  // Swipe right goes back, swipe left goes on.
  // A finger, as the canvas sees one: down here, up there. Both are sent in one go, because
  // nothing here keeps time: under software rendering a frame can take a second, a scripted
  // drag takes ten, and a ten-second drag is rightly not a swipe. How long a tap or a swipe
  // may take is test/play.test.mjs's business; this checks what each one does.
  const finger = (x0, y0, x1, y1) => page.evaluate(([x0, y0, x1, y1]) => {
    const c = document.getElementById('view');
    const send = (type, x, y) => c.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, pointerId: 9, pointerType: 'touch', isPrimary: true, bubbles: true }));
    send('pointerdown', x0, y0);
    send('pointerup', x1, y1);
  }, [x0, y0, x1, y1]);
  const drag = async (x0, x1) => { await finger(x0, 220, x1, 226); await pause(page); };
  await drag(200, 420);
  check((await state(page)).shot === 0, 'a swipe right goes back a shot', JSON.stringify(await state(page)));
  await drag(420, 200);
  check((await state(page)).shot === one.shot, 'a swipe left goes forward a shot');
  await finger(300, 100, 310, 330); await pause(page);
  check((await state(page)).shot === one.shot, 'a drag up or down does nothing');
  // two touches, one straight after the other: the next scene. Put back afterwards, for the checks below.
  await page.evaluate(() => {
    const c = document.getElementById('view');
    for (const [x, y] of [[300, 200], [303, 202]]) {
      for (const type of ['pointerdown', 'pointerup']) c.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, pointerId: 9, pointerType: 'touch', isPrimary: true, bubbles: true }));
    }
  });
  await pause(page, 400);
  check((await state(page)).scene !== 'clouds', 'a double tap moves to the next scene', JSON.stringify(await state(page)));
  await page.keyboard.press(String(scenes.indexOf('clouds') + 1)); await pause(page, 600);
  check((await state(page)).scene === 'clouds' && (await state(page)).shot === 0, 'a number key returns to the clouds, on the first shot');
  // a new visit to a scene shuffles its shots afresh, so find out again which one comes second
  await page.mouse.click(300, 200); await pause(page, 400);
  one.shot = (await state(page)).shot;
  check(one.shot !== 0, 'and a click moves on from there');

  // The keys do the same.
  await page.keyboard.press('ArrowLeft'); await pause(page);
  check((await state(page)).shot === 0, 'the left arrow goes back a shot');
  await page.keyboard.press('ArrowRight'); await pause(page);
  check((await state(page)).shot === one.shot, 'the right arrow goes forward a shot');
  await page.keyboard.press('Space'); await pause(page);
  check((await state(page)).shot !== one.shot && (await state(page)).scene === 'clouds', 'the space bar goes forward a shot');

  // A double tap or double click is the next scene, which starts on its own first shot.
  await page.mouse.dblclick(300, 200);
  await pause(page, 400);
  const two = await state(page);
  check(two.scene !== 'clouds' && two.shot === 0, 'a double click moves to the next scene', JSON.stringify(two));
  check((await page.getAttribute('#view', 'aria-label')).includes(two.scene === 'valley' ? 'the valley' : ''), 'and the label follows');
  await page.keyboard.press('Enter'); await pause(page);
  check((await state(page)).scene !== two.scene, 'Enter moves to the next scene');
  for (const key of ['1', '2', '3', '4']) { await page.keyboard.press(key); await page.waitForTimeout(700); }
  check((await state(page)).scene === scenes[3], 'the number keys pick a scene');
  check(await page.evaluate(() => window.__vibes.frame(1, { probe: true }).error) === 0, 'all four scenes can be visited in one sitting');

  // The speaker turns the music off, and the page remembers.
  await page.click('#sound');
  await pause(page, 400);
  const quiet = await state(page);
  check(!quiet.sound && !quiet.playing, 'the speaker button turns the music off', JSON.stringify(quiet));
  check(await page.getAttribute('#sound', 'aria-pressed') === 'false', 'and says so to a screen reader');
  check(quiet.scene === scenes[3], 'pressing the speaker does not also change the shot or scene');
  await page.reload();
  await page.waitForFunction(() => window.__vibes !== undefined);
  await page.mouse.click(300, 200); await pause(page, 400);
  const still = await state(page);
  check(!still.sound && !still.playing, 'sound stays off on the next visit', JSON.stringify(still));
  await page.keyboard.press('m'); await pause(page, 500);
  check((await state(page)).playing, 'M turns it back on');

  // A resize is survived, and the canvas follows the window.
  await page.setViewportSize({ width: 500, height: 900 });
  await page.waitForTimeout(600);
  const size = await page.evaluate(() => { const c = document.getElementById('view'); return [c.width, c.height]; });
  check(size[0] === 500 && size[1] === 900, 'the canvas follows a resize', size.join('x'));
  check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight), 'nothing scrolls');
  await ctx.close();
}
{
  // The music itself, rendered to a buffer: there is some, it does not clip, and it is not all bass.
  const { ctx, page } = await open('?t=0');
  for (const id of scenes) {
    const m = await page.evaluate(async id => {
      const { renderOffline } = await import('./audio.js');
      const buf = await renderOffline(OfflineAudioContext, id, 7, 14);
      let peak = 0, sum = 0, n = 0, bad = 0, flips = 0, last = 0;
      for (let c = 0; c < buf.numberOfChannels; c++) {
        const d = buf.getChannelData(c);
        for (let i = Math.floor(d.length / 2); i < d.length; i++) {
          const v = d[i];
          if (!Number.isFinite(v)) bad++;
          peak = Math.max(peak, Math.abs(v)); sum += v * v; n++;
          if ((v >= 0) !== (last >= 0)) flips++;
          last = v;
        }
      }
      // zero crossings a second: a rough centre of where the energy is
      return { peak, rms: Math.sqrt(sum / n), bad, crossings: flips / (n / buf.sampleRate) };
    }, id);
    check(m.bad === 0, `${id}: the music has a sample that is not a number`);
    check(m.rms > 0.05 && m.rms < 0.3, `${id}: the music is too quiet or too loud`, `rms ${m.rms.toFixed(3)}`);
    check(m.peak < 0.97, `${id}: the music clips`, `peak ${m.peak.toFixed(3)}`);
    check(m.crossings > 500, `${id}: the music is all bass, which a phone cannot play`, `${m.crossings.toFixed(0)} crossings a second`);
  }
  // held for a still, the page shows its picture and nothing over it
  check(await page.isHidden('#sound') && await page.isHidden('#tip'), 'a held frame hides the controls');
  await ctx.close();
}
{
  // The hint: after three quarters of a minute on one scene, once, and it can be sent away for good.
  const ctx = await browser.newContext({ viewport: { width: 768, height: 432 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.on('pageerror', e => pageErrors.push(e.message));
  // The page's clock is taken over and stopped, so that 45 seconds is 45 seconds however long
  // this machine takes to draw a frame, and the first shot (56 s here) cannot run out meanwhile.
  await page.clock.install();
  await page.goto(url('?seed=7&scene=sunset'));
  await page.waitForFunction(() => window.__vibes !== undefined, null, { timeout: 60000 });
  // (stopped five seconds on, not at once: on a slow machine "now" is already past by the time it is asked for)
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 5000));
  await page.clock.fastForward(24000);
  check(await page.isHidden('#tip'), 'no hint in the first half minute');
  await page.clock.fastForward(16000);
  check(await page.isVisible('#tip'), 'after 45 seconds on one scene the hint appears');
  check(/double-(click|tap) for another scene/i.test(await page.textContent('#tip-text')), 'and says how to change scene', await page.textContent('#tip-text'));
  const box = await page.locator('#tip').boundingBox();
  check(box && box.height < 60 && box.width < 420, 'the hint is small', JSON.stringify(box));
  // dismissing it must not also count as a tap on the picture, which would start the next shot dissolving in
  const fadeBefore = await page.evaluate(() => window.__vibes.state().fading);
  await page.click('#tip-close');
  check(await page.isHidden('#tip'), 'the hint can be dismissed');
  check(!fadeBefore && !(await page.evaluate(() => window.__vibes.state().fading)), 'dismissing it does not also change the shot');
  await page.reload();
  await page.waitForFunction(() => window.__vibes !== undefined);
  await page.clock.fastForward(60000);
  await page.clock.runFor(1000);
  check(await page.isHidden('#tip'), 'once dismissed it does not come back on a later visit');
  await ctx.close();

  // Someone who has already changed scene never sees it; left alone it goes away by itself.
  const ctx2 = await browser.newContext({ viewport: { width: 768, height: 432 }, deviceScaleFactor: 1 });
  const p2 = await ctx2.newPage();
  await p2.clock.install();
  await p2.goto(url('?seed=7&scene=sunset'));
  await p2.waitForFunction(() => window.__vibes !== undefined, null, { timeout: 60000 });
  await p2.clock.pauseAt(await p2.evaluate(() => Date.now() + 5000));
  await p2.clock.fastForward(41000);
  check(await p2.isVisible('#tip'), 'the hint appears for a new visitor');
  await p2.clock.fastForward(21000);
  check(await p2.isHidden('#tip'), 'left alone, the hint goes away by itself');
  await p2.reload();
  await p2.waitForFunction(() => window.__vibes !== undefined);
  await p2.keyboard.press('Enter');
  await p2.clock.fastForward(60000);
  await p2.clock.runFor(1000);
  check(await p2.isHidden('#tip'), 'someone who has changed scene is not told how');
  await ctx2.close();
}
{
  // Reduced motion: one still picture, and a click still changes it.
  const { ctx, page } = await open('?seed=7&scene=valley', { reducedMotion: 'reduce' });
  await page.waitForTimeout(600);
  const a = await page.locator('#view').screenshot();
  await page.waitForTimeout(1200);
  const b = await page.locator('#view').screenshot();
  check(a.equals(b), 'with reduced motion the picture holds still');
  await page.mouse.click(300, 200);
  await page.waitForTimeout(300);
  check(!(await page.locator('#view').screenshot()).equals(a), 'with reduced motion a click still shows the next shot');
  await ctx.close();
}
{
  // A high-density phone: four device pixels to the art pixel, and the palette.
  const { ctx, page } = await open('?t=5&seed=7&scene=sunset', { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 });
  const info = await page.evaluate(() => window.__vibes.frame(5, { probe: true }));
  check(info.scale === 4 && info.width === 293 && info.height === 633, 'a phone draws 293 x 633, four device pixels each', `${info.width}x${info.height} at ${info.scale}`);
  check(info.offPalette === 0, 'a phone gets the palette', JSON.stringify(info));
  await ctx.close();
}
{
  // No WebGL 2: a sentence, not a black page.
  const { ctx, page } = await open('', {}, () => { HTMLCanvasElement.prototype.getContext = () => null; });
  check(await page.isVisible('#note') && /WebGL 2/.test(await page.textContent('#note')), 'without WebGL 2 the page says so');
  check(await page.isHidden('#view') && await page.isHidden('#sound'), 'without WebGL 2 the canvas and its controls are put away');
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
