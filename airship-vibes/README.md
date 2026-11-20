# Airship Vibes

A live-aboard airship adrift in pixel art: each visit opens on one of four living 3D scenes, a lush valley, a city at night, a sunset vista or a sea of clouds, drawn live in your browser.

Published at `/airship-vibes/`: **[sites.jackhammons.com/airship-vibes/](https://sites.jackhammons.com/airship-vibes/)**

## What is on the page

One full-window canvas and nothing else. On load the page picks a scene at random and
plays it for as long as it is left open: the airship flies on, the camera cuts between a
handful of shots (wide ones for scale, close ones on the gondola), birds cross, lights
blink. A click, a tap, Space or the right arrow moves to the next scene; the left arrow
goes back; `1` to `4` pick one. The scene's name is drawn in the corner for a few seconds.

| Scene | id | What it is |
|---|---|---|
| The Valley | `valley` | Morning, a river valley under snow peaks, cumulus overhead, the ship's shadow on the meadows |
| City Lights | `city` | Night over an endless street grid: lit windows, traffic, a river, the moon |
| Last Light | `sunset` | The sun going down over a drowned coast, its road on the sea, birds in the distance |
| Above the Clouds | `clouds` | A floor of cloud below and towers of it standing off the route |

With `prefers-reduced-motion` the page shows one still frame per scene and does not animate.
Without WebGL 2 it shows a sentence saying so.

For looking at one thing, the page takes query parameters: `?scene=sunset`, `?seed=7`
(a visit is fully determined by its seed), `?shot=2`, `?t=40` (hold that second),
`?raw=1` (the picture before the palette), `?px=4` (device pixels per art pixel).

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
each run, the colours (`LIVERY`), and the lamps. Detail too fine for geometry is drawn by
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
src/app.js              the page: canvas, clock, input. The only module that touches the DOM
src/renderer.js         the only module that touches WebGL
src/glsl.js             every shader, as source text
src/scenes.js           the four scenes, as data
src/director.js         time -> ship pose, camera, shot
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

Everything except `app.js` and `renderer.js` has no DOM and no WebGL in it. The page, the
unit tests and `verify.mjs` (from the *built* copy) all import the same modules. One
implementation of each; never fork one.

### How a frame is drawn

1. **The scene, small.** About 84,000 pixels whatever the screen (`layout.js`), into a
   colour and a depth texture, in ordinary continuous colour: sky, ground, buildings,
   airship, lamps, birds, then the window panes blended on top. The colour texture's alpha
   is not transparency; it is how strongly a pixel glows.
2. **Composite.** Outlines from depth, glow spread from the alpha, cloud marched between
   the eye and the depth already drawn, then every pixel is replaced by a colour from the
   scene's palette, with an ordered dither between the two nearest. The caption and the
   dissolve between shots are done here too, in the same pixels.
3. **Present.** The small picture is scaled up by a whole number of device pixels.

### Rules that keep it working

- **Every pixel is a palette colour.** That is what makes it pixel art and not a low
  resolution render. `test/browser-check.mjs` reads the frame back and fails on a single
  pixel that is not in the scene's palette. Anything new that draws must draw before the
  palette step in the composite pass, never after it.
- **A frame is a pure function of the seed and the second.** `director.js` integrates
  nothing, `flock.js` simulates nothing, the shaders animate from `uTime`. A hidden tab, a
  slow phone and a test asking for second 437 all get the same picture, and `?seed=&t=`
  reproduces any frame. Do not add state that advances per frame.
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
- **No dependencies, no model files, no images.** Everything is generated: the meshes in
  `ship.js`, the textures in `noise.js` and `palette.js`, the caption in `font.js`.

### Palettes

A scene's palette is fitted to what the scene actually renders, not chosen in the
abstract. `scripts/fit-palette.mjs <scene>` draws a set of frames with the palette step
off, keeps the scene's hand-picked `anchors` (sky ramp, hull, accents, lamp colours) fixed,
and places the rest by k-means in Oklab; `--write` puts the result into `scenes.js`. Refit
after changing a scene's sun, haze, ground colours or cloud, and look at the result: a
palette that is far from what is rendered shows up as noisy dithering between unrelated
colours.

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
`glsl.js`, `renderer.js` or `scenes.js`, and look at the stills: these pages are finished
by the GPU, and a frame can be valid, on-palette and ugly. Headless Chromium here renders
with SwiftShader (software), which is slow but exact; it says nothing about frame rate on
a phone.
