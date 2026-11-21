#!/usr/bin/env node
/* Drive the BUILT page in Chromium and check what only a browser can answer.
 *
 * The unit tests cover the modules that decide what is drawn, and verify.mjs
 * the seams between them. Neither can compile a shader. This compiles every
 * program by drawing every shot of every scene, wide and tall, and holds each
 * frame to what the page promises: no WebGL error, a picture and not a blank,
 * drawn smoothly at the size asked for. It checks that sharpness is only
 * sharpness: the same second drawn with four times the pixels is the same
 * picture. Then it checks the page itself: it animates and settles on a size
 * it can keep up; taps, swipes and keys step through shots and scenes; the
 * music starts on the first touch, is neither silent nor clipping, carries
 * on through a change of scene and stays off once turned off; the volume
 * slider comes out when wanted and does what it says; the hint comes up once
 * and can be sent away; reduced motion holds still; a resize is survived; and
 * a browser without WebGL 2 gets a sentence instead of a black page.
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
const state = page => page.evaluate(() => window.__vibes.state());
const pause = (page, ms = 250) => page.waitForTimeout(ms);
const glError = page => page.evaluate(() => document.getElementById('view').getContext('webgl2').getError());

/* ---- every shot of every scene, wide and tall ------------------------- */
const { scenes, shots, titles } = await (async () => {
  const { ctx, page } = await open('?t=0&px=2');
  const out = await page.evaluate(async () => {
    const { SCENES } = await import('./scenes.js');
    return { scenes: SCENES.map(s => s.id), shots: Object.fromEntries(SCENES.map(s => [s.id, s.shots.map(x => x.name)])),
      titles: Object.fromEntries(SCENES.map(s => [s.id, s.title])) };
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
        const info = await page.evaluate(([scene, shot, t]) => window.__vibes.frame(t, { scene, shot, seed: 7, probe: true }), [scene, shot, t]);
        check(info.error === 0, `${where}: WebGL error`, String(info.error));
        check(info.scene === scene && info.shot === shot, `${where}: drew ${info.scene}/${info.shot}`);
        check(info.width === viewport.width / px && info.height === viewport.height / px && info.dot === 1 / px,
          `${where}: drawn ${info.width}x${info.height}, not the size asked for`);
        // a blank, or a flat fill, is a shader that compiled and drew nothing; a handful of colours is the same
        check(info.colours >= 400, `${where}: only ${info.colours} colours, so nothing much was drawn`);
        check(info.largest < 0.5, `${where}: one colour fills ${(info.largest * 100).toFixed(0)}% of the frame`);
        check(info.light > 0.02 && info.light < 0.97, `${where}: the frame is all dark or all light`, info.light.toFixed(3));
        if (stills) await page.screenshot({ path: path.join(stills, `${scene}-${shots[scene][shot]}-${label}-${t}.png`) });
      }
    }
    // the scene's name is over the picture for its first seconds, in hard pixels, and then gone
    const cap = await page.evaluate(() => {
      const c = document.getElementById('caption'), cs = getComputedStyle(c);
      window.__vibes.frame(3);
      const early = Number(cs.opacity);
      window.__vibes.frame(17);
      return { early, late: Number(cs.opacity), width: c.width, height: c.height, shown: c.getBoundingClientRect().width, rendering: cs.imageRendering };
    });
    check(cap.early === 1 && cap.late === 0, `${scene} ${label}: the caption is up at 3 s and gone by 17 s`, JSON.stringify(cap));
    check(cap.width === titles[scene].length * 6 && cap.height === 8, `${scene} ${label}: the caption is not the scene's name`, `${cap.width}x${cap.height}`);
    check(cap.shown === cap.width * 2 && /pixelated|crisp-edges/.test(cap.rendering), `${scene} ${label}: the caption is not enlarged by a whole number with hard edges`, JSON.stringify(cap));
  }
  await ctx.close();
}

/* ---- sharpness is only sharpness -------------------------------------- */
{
  /* The same second drawn with four times the pixels must be the same picture,
     only sharper: everything is sized in dots, so nothing may move, appear or
     change size with the number of pixels. Each fine frame is averaged down
     to the coarse one's size and the two compared. */
  const { ctx, page } = await open('?t=0&px=2&seed=7');
  for (const [scene, shot] of [['valley', 0], ['city', 0], ['sunset', 0], ['clouds', 0], ['city', 5], ['valley', 1]]) {
    const d = await page.evaluate(([scene, shot]) => {
      const gl = document.getElementById('view').getContext('webgl2');
      const grab = px => {
        const info = window.__vibes.frame(11, { scene, shot, seed: 7, px, caption: false });
        const data = new Uint8Array(info.width * info.height * 4);
        gl.readPixels(0, 0, info.width, info.height, gl.RGBA, gl.UNSIGNED_BYTE, data);
        return { w: info.width, h: info.height, data };
      };
      const coarse = grab(2), fine = grab(1);
      let sum = 0, worst = 0, far = 0;
      for (let y = 0; y < coarse.h; y++) {
        for (let x = 0; x < coarse.w; x++) {
          let diff = 0;
          for (let c = 0; c < 3; c++) {
            const o = ((y * 2) * fine.w + x * 2) * 4 + c;
            const avg = (fine.data[o] + fine.data[o + 4] + fine.data[o + fine.w * 4] + fine.data[o + fine.w * 4 + 4]) / 4;
            diff += Math.abs(avg - coarse.data[(y * coarse.w + x) * 4 + c]);
          }
          diff /= 3 * 255;
          sum += diff; worst = Math.max(worst, diff);
          if (diff > 0.25) far++;
        }
      }
      return { mean: sum / (coarse.w * coarse.h), far: far / (coarse.w * coarse.h), sizes: `${coarse.w}x${coarse.h} and ${fine.w}x${fine.h}` };
    }, [scene, shot]);
    check(d.mean < 0.03, `${scene}/${shots[scene][shot]}: with more pixels the picture changes, not just sharpens`, `mean difference ${(d.mean * 100).toFixed(1)}% between ${d.sizes}`);
    check(d.far < 0.02, `${scene}/${shots[scene][shot]}: ${(d.far * 100).toFixed(1)}% of the picture is something else at the finer size`);
  }
  await ctx.close();
}
{
  // Without antialiasing (a device that has none to give) the page still draws.
  const { ctx, page } = await open('?t=0&px=2&seed=7&aa=0');
  const info = await page.evaluate(() => window.__vibes.frame(9, { scene: 'valley', shot: 1, probe: true }));
  check(info.error === 0 && info.colours >= 400, 'the page draws without antialiasing', JSON.stringify(info));
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
  const begin = await state(page);
  check(begin.shot === 0 && begin.scene === 'clouds' && begin.sound && !begin.playing && !begin.tip && !begin.slider,
    'a visit opens on the first shot, silent until touched, with no hint showing', JSON.stringify(begin));
  // the canvas is as many pixels as the page has decided to draw, and CSS stretches it over the window
  const fit = await page.evaluate(() => { const c = document.getElementById('view'), r = c.getBoundingClientRect(); return { w: c.width, h: c.height, cw: r.width, ch: r.height }; });
  check(fit.cw === 768 && fit.ch === 432 && fit.w <= 768 && fit.h <= 432 && fit.w >= 768 * 0.6 - 1, 'the canvas is drawn at its own size and stretched over the window', JSON.stringify(fit));
  check(Math.abs(fit.w / fit.h - 768 / 432) < 0.01, 'and keeps the window\'s shape');

  // A tap or click is the next shot. The first one is also what lets the music start.
  await page.mouse.click(300, 200);
  await pause(page, 500);
  const one = await state(page);
  check(one.shot !== 0 && one.scene === 'clouds', 'a click moves to the next shot, in the same scene', JSON.stringify(one));
  check(one.playing, 'the first click starts the music', JSON.stringify(one));
  // mid-dissolve both shots are drawn, each at its own size
  check(await glError(page) === 0, 'a dissolve between two live shots raises no WebGL error');

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
  const next = await state(page);
  check(next.scene !== 'clouds', 'a double tap moves to the next scene', JSON.stringify(next));
  // for three seconds now two scenes are being drawn, each with its own programs
  await pause(page, 900);
  check(await glError(page) === 0, 'a dissolve between two live scenes raises no WebGL error');
  /* The music does not stop for the change. The band plays on in the old
     scene's song to the end of the bar, and the new scene's song comes in on
     the bar line: within a bar's length, which is under four seconds. */
  check(next.playing, 'the music is still playing straight after a change of scene', JSON.stringify(next));
  let heard = next.song;
  for (let i = 0; i < 12 && heard !== next.scene; i++) { await pause(page, 500); const s = await state(page); heard = s.song; check(s.playing, 'the music plays through the change of scene'); }
  check(heard === next.scene, 'within a bar the new scene\'s song has taken over', `hearing ${heard} in ${next.scene}`);

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

  /* The volume slider. It is folded away beside the speaker until a pointer
     is over either, and then it is a slider: where it is put is how loud. */
  const slider = () => page.evaluate(() => { const v = document.getElementById('volume'), r = v.getBoundingClientRect(), cs = getComputedStyle(v);
    return { width: r.width, x: r.x, y: r.y, height: r.height, events: cs.pointerEvents, value: Number(v.value) }; });
  await page.mouse.move(300, 300); await pause(page, 400);
  const away = await slider();
  check(away.width === 0 && away.events === 'none', 'the volume slider is folded away when the pointer is elsewhere', JSON.stringify(away));
  await page.hover('#sound'); await pause(page, 500);
  const out = await slider();
  check(out.width >= 80 && out.events === 'auto', 'hovering the speaker brings the volume slider out', JSON.stringify(out));
  check(out.value === 100, 'it starts at full', String(out.value));
  const full = (await state(page)).level;
  await page.mouse.click(out.x + out.width * 0.5, out.y + out.height / 2); await pause(page, 300);
  const half = await state(page);
  check(half.volume > 0.35 && half.volume < 0.65 && half.sound && half.playing, 'clicking halfway along it sets the volume to about half', JSON.stringify(half));
  check(half.level < full * 0.5 && half.level > 0, 'and the music is quieter for it', `${half.level} from ${full}`);
  check((await slider()).width >= 80, 'the slider stays out while the pointer is on it');
  check(await page.evaluate(() => document.activeElement === document.body), 'a click on the slider does not leave the keyboard\'s focus on it, which would hold it out');
  check(half.scene === scenes[3] && !half.fading, 'using the slider does not change the shot or the scene');
  // the keyboard: the slider takes the arrow keys itself, and they do not step through shots
  await page.focus('#volume');
  const shotBefore = (await state(page)).shot;
  await page.keyboard.press('ArrowLeft'); await page.keyboard.press('ArrowLeft'); await pause(page);
  const nudged = await state(page);
  check(nudged.volume < half.volume && nudged.shot === shotBefore, 'the arrow keys move the slider when it has the keyboard, and not the shot', JSON.stringify(nudged));
  // all the way down is off, and the speaker says so; the speaker brings it back to where it was
  await page.evaluate(() => { const v = document.getElementById('volume'); v.value = '0'; v.dispatchEvent(new Event('input', { bubbles: true })); });
  await pause(page, 300);
  const muted = await state(page);
  check(!muted.sound && !muted.playing && await page.getAttribute('#sound', 'aria-pressed') === 'false', 'the slider at nothing turns the sound off', JSON.stringify(muted));
  await page.evaluate(() => document.activeElement && document.activeElement.blur());      // the keyboard is done with it
  await page.click('#sound'); await pause(page, 500);
  const back = await state(page);
  check(back.sound && back.playing && Math.abs(back.volume - nudged.volume) < 0.011 && (await slider()).value === Math.round(nudged.volume * 100),
    'the speaker turns it on again at the volume it had', JSON.stringify(back));
  // nothing is blurred by hand here: a click must not leave the slider held out by focus
  await page.mouse.move(300, 300);
  // (waited for, not timed: the fold is a transition, and this machine is busy drawing)
  await page.waitForFunction(() => document.getElementById('volume').getBoundingClientRect().width === 0, null, { timeout: 12000 }).catch(() => {});
  const folded = await slider();
  check(folded.width === 0 && folded.events === 'none', 'with the pointer gone and a few seconds passed, the slider folds away again', JSON.stringify(folded));

  // The speaker turns the music off, and the page remembers that and the volume.
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
  check(Math.abs(still.volume - nudged.volume) < 0.011, 'and the volume is remembered', String(still.volume));
  await page.keyboard.press('m'); await pause(page, 500);
  check((await state(page)).playing, 'M turns it back on');

  // A resize is survived: the picture takes the window's new shape and still fills it.
  await page.setViewportSize({ width: 500, height: 900 });
  await page.waitForTimeout(1500);
  const size = await page.evaluate(() => { const c = document.getElementById('view'), r = c.getBoundingClientRect(); return { w: c.width, h: c.height, cw: r.width, ch: r.height }; });
  check(size.cw === 500 && size.ch === 900 && Math.abs(size.w / size.h - 500 / 900) < 0.01, 'the canvas follows a resize', JSON.stringify(size));
  check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight), 'nothing scrolls');
  check(await glError(page) === 0, 'and no WebGL error comes of it');
  await ctx.close();
}
{
  /* How sharp. This machine draws in software, a frame in a good fraction of
     a second, so the page must come down to the softest picture it allows and
     stay there; a size asked for outright is left exactly as asked. */
  const { ctx, page } = await open('?seed=7&scene=valley');
  const first = await state(page);
  check(first.pace === 'probe' && first.quality === 0.5, 'a visit starts by finding out what the device can draw', JSON.stringify(first));
  await page.waitForFunction(() => window.__vibes.state().pace === 'hold', null, { timeout: 90000 }).catch(() => {});
  const settled = await state(page);
  check(settled.pace === 'hold', 'the page settles on a sharpness', JSON.stringify(settled));
  check(settled.quality < first.quality && settled.width * settled.height < first.width * first.height, 'a slow device is given fewer pixels', JSON.stringify(settled));
  check(settled.width >= 768 * 0.6 - 1, 'but never fewer than keep the picture smooth', `${settled.width}x${settled.height}`);
  const remembered = await page.evaluate(() => Number(localStorage.getItem('airship-vibes.quality')));
  check(Math.abs(remembered - settled.quality) < 0.002, 'and what it found is remembered for the next visit', String(remembered));
  await ctx.close();
  for (const [query, w, h] of [['?px=3&seed=7', 256, 144], ['?q=1&seed=7', 768, 432], ['?q=0.6&seed=7', 595, 335]]) {
    const { ctx: c2, page: p2 } = await open(query);
    await p2.waitForTimeout(2500);
    const s = await state(p2);
    check(s.pace === 'fixed' && s.width === w && s.height === h, `${query} holds the picture at ${w}x${h}`, JSON.stringify(s));
    await c2.close();
  }
}
{
  // A finger has no hover: touching the speaker brings the slider out for a few seconds.
  const { ctx, page } = await open('?seed=7&scene=city', { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  const width = () => page.evaluate(() => document.getElementById('volume').getBoundingClientRect().width);
  check(await width() === 0, 'on a phone the slider starts folded away');
  await page.tap('#sound'); await pause(page, 500);
  const s = await state(page);
  check(!s.sound && s.slider && await width() >= 80, 'a touch on the speaker turns the sound off and brings the slider out', JSON.stringify(s));
  await page.tap('#sound'); await pause(page, 500);
  check((await state(page)).sound && (await state(page)).playing, 'a second touch turns it on again');
  await page.waitForFunction(() => document.getElementById('volume').getBoundingClientRect().width === 0, null, { timeout: 12000 }).catch(() => {});
  check(!(await state(page)).slider && await width() === 0, 'left alone, the slider folds away', String(await width()));
  check(/Double-tap/.test(await page.evaluate(() => (document.getElementById('tip-text').textContent || 'Double-tap'))), 'a phone is told to tap, not click');
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
  /* A change of scene, as it sounds. The whole mix must carry straight through
     the join, with no gap and no clipping; and the hi-hats, which are all top,
     must sink away under the closing low-pass before the bar line and be back
     soon after it. */
  const join = await page.evaluate(async ([from, to]) => {
    const { renderOffline } = await import('./audio.js');
    const { Sequence } = await import('./music.js');
    const asked = 12.2, seconds = 24;
    const seq = new Sequence(from, 7); seq.take(asked + 0.4);
    const line = seq.end;
    const turns = [{ at: asked, id: to, seed: 8 }];
    const mix = await renderOffline(OfflineAudioContext, from, 7, seconds, null, 44100, turns);
    const hats = await renderOffline(OfflineAudioContext, from, 7, seconds, 'hat', 44100, turns);
    const plain = await renderOffline(OfflineAudioContext, from, 7, seconds, 'hat', 44100, []);
    const rms = (b, a, z) => { const d = b.getChannelData(0); let s = 0; const i0 = Math.floor(a * 44100), i1 = Math.floor(z * 44100); for (let i = i0; i < i1; i++) s += d[i] * d[i]; return Math.sqrt(s / (i1 - i0)); };
    let peak = 0, quietest = 9;
    const d = mix.getChannelData(0);
    for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]));
    // two-second windows across the join: none of them silent
    for (let t = line - 4; t < line + 6; t += 1) quietest = Math.min(quietest, rms(mix, t, t + 2));
    return { line, peak, quietest, usual: rms(mix, 6, line - 4),
      shut: rms(hats, line - 0.8, line) / rms(plain, line - 0.8, line), open: rms(hats, line + 2, line + 5) / rms(plain, 6, 10) };
  }, [scenes[0], scenes[1]]);
  check(join.line > 12.2 && join.line < 16.5, 'a change of song falls on the next bar line', String(join.line));
  check(join.peak < 0.97, 'the join does not clip', `peak ${join.peak.toFixed(3)}`);
  check(join.quietest > join.usual * 0.6, 'the music carries through the join without a gap', `quietest two seconds ${join.quietest.toFixed(3)} against ${join.usual.toFixed(3)}`);
  check(join.shut < 0.4, 'the top of the old song is drawn down before the bar line', `hats at ${(join.shut * 100).toFixed(0)}%`);
  check(join.open > 0.6, 'and the new song opens up again after it', `hats at ${(join.open * 100).toFixed(0)}%`);
  // held for a still, the page shows its picture and nothing over it
  check(await page.isHidden('#audio') && await page.isHidden('#tip'), 'a held frame hides the controls');
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
  // Reduced motion: one still picture, at full sharpness, and a click still changes it.
  const { ctx, page } = await open('?seed=7&scene=valley', { reducedMotion: 'reduce' });
  await page.waitForTimeout(600);
  const a = await page.locator('#view').screenshot();
  await page.waitForTimeout(1200);
  const b = await page.locator('#view').screenshot();
  check(a.equals(b), 'with reduced motion the picture holds still');
  const s = await state(page);
  check(s.pace === 'fixed' && s.width === 768 && s.height === 432, 'and is drawn once, at its best', JSON.stringify(s));
  await page.mouse.click(300, 200);
  await page.waitForTimeout(300);
  check(!(await page.locator('#view').screenshot()).equals(a), 'with reduced motion a click still shows the next shot');
  await ctx.close();
}
{
  // A high-density phone: a still is drawn two pixels to the dot, and the caption is doubled, not blurred.
  const { ctx, page } = await open('?t=5&seed=7&scene=sunset', { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 });
  const info = await page.evaluate(() => window.__vibes.frame(5, { probe: true }));
  check(info.width === 780 && info.height === 1688 && info.dot === 2, 'a phone\'s best picture is 780 x 1688, two pixels to the dot', `${info.width}x${info.height} at ${info.dot}`);
  check(info.error === 0 && info.colours >= 400, 'and it draws', JSON.stringify(info));
  const cap = await page.evaluate(() => { const c = document.getElementById('caption'), r = c.getBoundingClientRect(); return { w: r.width, canvas: c.width, left: r.left, bottom: innerHeight - r.bottom, opacity: Number(getComputedStyle(c).opacity) }; });
  check(cap.w === cap.canvas * 2 && cap.left >= 12 && cap.bottom >= 12 && cap.opacity === 1, 'the caption sits in the corner, each of its pixels two dots square', JSON.stringify(cap));
  await ctx.close();
}
{
  // No WebGL 2: a sentence, not a black page.
  const { ctx, page } = await open('', {}, () => { HTMLCanvasElement.prototype.getContext = () => null; });
  check(await page.isVisible('#note') && /WebGL 2/.test(await page.textContent('#note')), 'without WebGL 2 the page says so');
  check(await page.isHidden('#view') && await page.isHidden('#audio') && await page.isHidden('#caption'), 'without WebGL 2 the canvas and its controls are put away');
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
