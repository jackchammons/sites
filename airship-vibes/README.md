# Airship Vibes

A live-aboard airship adrift in pixel art: each visit opens on one of four living 3D scenes, a lush valley, a city at night, a sunset vista or a sea of clouds, drawn live in your browser to a slow lo-fi beat.

Published at `/airship-vibes/`: **[sites.jackhammons.com/airship-vibes/](https://sites.jackhammons.com/airship-vibes/)**

## What is on the page

One full-window canvas with two small controls over it. On load the page picks a scene at
random and plays it for as long as it is left open: the airship flies on, the camera
dissolves between a handful of shots, each on screen for most of a minute (wide ones for
scale, close ones on the gondola), birds cross, lights blink. The scene's name is drawn in
the corner for a few seconds.

| To | Touch | Mouse | Keys |
|---|---|---|---|
| see the next shot | tap, or swipe left | click | Space, right arrow |
| go back a shot | swipe right | | left arrow |
| change scene | double tap | double click | Enter, down arrow; up arrow goes back; `1` to `4` pick one |
| turn the music off or on | the speaker, top right | the same | `M` |

Each scene has its own slow loop of music, made in the browser like the picture. A browser
will not let a page make sound until it has been touched, so the music begins with the
first tap, click or key, and the speaker turns it off; that choice is remembered. On an
iPhone it plays with the ringer switch off, as a music player's sound does.

Someone who has watched one scene for 45 seconds without changing it is shown a small hint,
"Double-tap for another scene", for 20 seconds. Dismissing it, or changing scene even once,
means it is not shown again (`localStorage`: `airship-vibes.scenes`, and `airship-vibes.sound`
for the speaker).

| Scene | id | What it is |
|---|---|---|
| The Valley | `valley` | Morning in a river valley: hedged meadows, forest on the slopes, snow peaks, cumulus overhead |
| City Lights | `city` | Night over an endless street grid: lit windows, traffic, a river, the moon |
| Last Light | `sunset` | The sun going down over a drowned coast, its road on the sea, birds in the distance |
| Above the Clouds | `clouds` | A floor of cloud below and towers of it standing off the route |

With `prefers-reduced-motion` the page shows one still frame per shot and does not animate.
Without WebGL 2 it shows a sentence saying so.

For looking at one thing, the page takes query parameters: `?scene=sunset`, `?seed=7`
(a visit left alone is fully determined by its seed), `?shot=2`, `?t=40` (hold that second,
and hide the controls), `?raw=1` (the picture before the palette), `?px=4` (device pixels
per art pixel).

## The airship is the one in the drawings

`data/parameters.json` is `DATA_parameters.json` from the live-aboard airship drawing set
(dated 2026-11-19), unchanged: the model's inputs and the values the drawings derived from
them. `src/ship.js` has two halves:

- `derive()` is a port of the geometry in the drawing set's `airship_model.py`. Given the
  same inputs it returns the same hull radius, deck levels and stations, and
  `test/ship.test.mjs` holds it to the file's `derived` block to nine decimal places.
- `buildShip()` turns that into triangles: the 150 x 44 m ellipsoid, the X-tail, the open
  bay with its strong box, aero covers, landing deck, hoist rail and tender, the two decks
  of the gondola with the leaning windscreen and the glazed dining-room prow, eight
  propulsor pods on outriggers, the skids, the lidars, the top lookout.

What the parameter file does not carry is written once in `ship.js`: the window runs
(transcribed from GA-02's deck plans, as offsets from the entry bulkhead), the room behind
each run, the colours (`LIVERY`), and the lamps. The lamps are an aircraft's and nothing
else: red and green at the sides, white at the nose, tail and fin tips, a red beacon above
and below. The four landing lidars under the keel are sensors and carry no light; a test
fails if a lamp is ever put near one. Detail too fine for geometry is drawn by
the hull's shader from the same parameters: ring and longitudinal seams, the solar skin on
the crown, the slot gutters, and the observation rooms' glazing at the bow and stern. The
shader also cuts the hull open over the moon pool, the bay and the footprint of deck 2.

To follow a revised drawing set, replace `data/parameters.json` and run the tests. If the
revision moved a window, edit `WINDOWS` in `ship.js`.

## How it is put together

```
data/data.json          title, tagline, noscript line
data/parameters.json    the airship's parameters, from the drawing set
scripts/build.mjs       writes the shell, copies src/ unchanged, emits params.js
scripts/verify.mjs      deploy gate
scripts/fit-palette.mjs dev tool: fits a scene's palette to what it renders (needs Playwright)
src/app.js              the page: canvas, clock, input, controls. The only module that touches the DOM
src/renderer.js         the only module that touches WebGL
src/audio.js            the only module that touches Web Audio: instruments, mix, player
src/music.js            the four songs, as data: which note falls where
src/gesture.js          what a touch meant: tap, swipe, double tap
src/glsl.js             every shader, as source text
src/scenes.js           the four scenes, as data
src/director.js         time -> ship pose and camera; the playhead (which shot is on)
src/ship.js             the airship model
src/mesh.js             triangle builder and the 32-byte vertex
src/terrain.js          the ground grid
src/flock.js            birds
src/noise.js            the cloud volume (a tiling 3D texture)
src/palette.js          palettes and the colour -> palette lookup table
src/font.js             the caption's 5 x 7 bitmap face
src/layout.js           how many pixels the picture is
src/vec.js, src/rng.js  vectors and matrices; seeded randomness
test/*.test.mjs         unit tests, run in CI
test/browser-check.mjs  Playwright check, run on a dev box
```

Everything except `app.js`, `renderer.js` and `audio.js` has no DOM, WebGL or Web Audio in
it, and `audio.js` only uses the context it is handed. The page, the
unit tests and `verify.mjs` (from the *built* copy) all import the same modules. One
implementation of each; never fork one.

### How a frame is drawn

1. **The scene, small.** At most 190,000 pixels whatever the screen (`layout.js`: that is
   the least that gives a phone held upright four device pixels to the art pixel, about
   293 x 633; a 1080p monitor gets 480 x 270), into a
   colour and a depth texture, in ordinary continuous colour: sky, ground, buildings,
   airship, lamps, birds, then the window panes blended on top. The colour texture's alpha
   is not transparency; it is how strongly a pixel glows.
2. **Composite.** Outlines from depth, glow spread from the alpha, cloud marched between
   the eye and the depth already drawn, then every pixel is replaced by a colour from the
   scene's palette, with an ordered dither between the two nearest. The dissolve between
   shots and the caption are done here too, in the same pixels.
3. **Twice, during a dissolve.** For the three seconds one shot takes to dissolve into the
   next, steps 1 and 2 are done for both cameras, so both shots keep moving and neither is
   a held frame. A change of scene is the same: the renderer keeps a "stage" per scene
   (its palette table, caption, grid and lamps), so the scene being left goes on being
   drawn, on its own clock and in its own palette, under the one arriving.
4. **Present.** The small picture is scaled up by a whole number of device pixels.

### Rules that keep it working

- **Every pixel is a palette colour.** That is what makes it pixel art and not a low
  resolution render. `test/browser-check.mjs` reads the frame back and fails on a single
  pixel that is not in the scene's palette. Anything new that draws must draw before the
  palette step in the composite pass, never after it.
- **A frame is a pure function of the seed, the second and the playhead.** `director.js`
  integrates nothing, `flock.js` simulates nothing, the shaders animate from `uTime`. A
  hidden tab, a slow phone and a test asking for second 437 all get the same picture, and
  `?seed=&t=` reproduces any frame of an untouched visit. The playhead (which shot is on,
  since when, and the one it came from) is the only state, it is a plain object, and only
  `advance()` and `move()` make a new one. Do not add state that advances per frame.
- **A shot's camera travels for the shot's length plus the dissolve**, at a steady pace, so
  it is still moving while it is dissolved out of. Easing it to a stop at the end of the
  shot would bring back the frozen-looking fade.
- **Shots are written in the airship's frame** (x forward, y to port, z up, origin at the
  middle of the hull). `test/scenes.test.mjs` sweeps every shot of every scene at five
  aspect ratios and fails if the camera is ever inside the envelope or gondola, more than
  480 m off the route (where the ground stops being guaranteed flat or low), or too low.
  Run it after touching a shot.
- **The ground and the flight path share one formula.** `pathY` exists in `director.js`
  and in `COMMON` in `glsl.js`; the valley floor, the sea lane, the cloud corridor and the
  city's river are all placed relative to it. A test compares the two.
- **Noise in shaders comes from an integer hash**, the same `lowbias32` as `rng.js`.
  `fract(sin(x) * 43758.5)` gives different terrain on different GPUs; do not use it.
- **GLSL ES 3.00, written to the letter**: `#version 300 es` first, `highp` throughout
  (including `sampler3D`, which has no default precision), no implicit int/float
  conversion, no reserved words as names. `test/glsl.test.mjs` checks what can be checked
  without a compiler, and that every uniform a shader declares is one `renderer.js` sets
  and the reverse: a mismatch is otherwise silent.
- **The city's block size is written once**, in `scenes.js`, and reaches the shaders as
  `#define`s, because the renderer places the buildings' instance grid with it.
- **No dependencies, no model files, no images, no audio files.** Everything is generated:
  the meshes in `ship.js`, the textures in `noise.js` and `palette.js`, the caption in
  `font.js`, every note in `audio.js`.
- **Sound only ever starts inside a gesture's handler** (`wake()` in `app.js`), because
  that is the only place a browser allows it, and stops when the tab is hidden.
- **A bar of music is a pure function of the song, the seed and the bar's number**, and
  asking `eventsBetween()` for a stretch in pieces gives exactly what asking for it whole
  gives. The player schedules 0.4 s ahead and depends on both.
- **Gestures are judged by the events' own timestamps**, which are when the finger moved,
  not when a busy page got round to hearing about it.

### Palettes

A scene's palette is fitted to what the scene actually renders, not chosen in the
abstract. `scripts/fit-palette.mjs <scene>` draws a set of frames with the palette step
off, keeps the scene's hand-picked `anchors` (sky ramp, hull, accents, lamp colours) fixed,
and places the rest by k-means in Oklab; `--write` puts the result into `scenes.js`. Refit
after changing a scene's sun, haze, ground colours or cloud, and look at the result: a
palette that is far from what is rendered shows up as noisy dithering between unrelated
colours.

### The music

Four chords on an electric piano, a soft kick and snare with the off-beats late, a bass on
the root, a few notes of melody in some bars, the hiss and pop of a record and a little
wind. `music.js` says which notes fall where; `audio.js` makes each sound from oscillators
and filtered noise, and runs the mix through a low-pass, a slow wobble in pitch and a room
made from decaying noise.

Nobody listened to it while it was written: it was balanced by measurement, rendering each
song to a buffer and looking at the level of every instrument and where the energy sits.
The first mix had 85% of its energy below 250 Hz, which a phone speaker cannot reproduce,
so the chords are voiced without their roots between G3 and A4, the bass and kick carry
overtones, and about half the energy is now between 250 and 800 Hz. `browser-check.mjs`
renders every song and fails if it is silent, clips, or is nearly all bass. To change the
mix, use `renderOffline(OfflineAudioContext, id, seed, seconds, only)` from a page: `only`
solos one kind of note.

## Working on it

```bash
node airship-vibes/scripts/build.mjs               # writes dist/airship-vibes/
node airship-vibes/scripts/verify.mjs
node --test airship-vibes/test/*.test.mjs
node airship-vibes/test/browser-check.mjs          # dev box only: compiles every shader, draws every shot
node airship-vibes/test/browser-check.mjs --stills /tmp/stills   # and saves a PNG of each
node scripts/build-all.mjs --only airship-vibes    # the way the deploy builds it
```

The build refuses to clear an output directory that is neither empty nor a previous build
(one with an `index.html`), so a mistyped `OUT_DIR` cannot delete source.

CI cannot compile GLSL, so **a shader error will pass CI and deploy**, and the page will
show its "could not be drawn" sentence. Run `browser-check.mjs` after any change to
`glsl.js`, `renderer.js`, `scenes.js`, `audio.js` or `app.js`, and look at the stills:
these pages are finished by the GPU, and a frame can be valid, on-palette and ugly. It
also drives the taps, swipes and keys, the speaker and the hint. Headless Chromium here renders
with SwiftShader (software), which is slow but exact; it says nothing about frame rate on
a phone.
