# Airship Vibes

A live-aboard airship adrift: each visit opens on one of four living 3D scenes, a lush valley, a city at night, a sunset vista or a sea of clouds, drawn live in your browser to a slow lo-fi beat.

Published at `/airship-vibes/`: **[sites.jackhammons.com/airship-vibes/](https://sites.jackhammons.com/airship-vibes/)**

## What is on the page

One full-window canvas with a caption and two small controls over it. On load the page
picks a scene at random and plays it for as long as it is left open: the airship flies on,
the camera dissolves between a handful of shots, each on screen for most of a minute (wide
ones for scale, close ones on the gondola), birds cross, lights blink. The scene's name is
shown in the corner for a few seconds.

| To | Touch | Mouse | Keys |
|---|---|---|---|
| see the next shot | tap, or swipe left | click | Space, right arrow |
| go back a shot | swipe right | | left arrow |
| change scene | double tap | double click | Enter, down arrow; up arrow goes back; `1` to `4` pick one |
| turn the music off or on | the speaker, top right | the same | `M` |
| set how loud it is | touch the speaker: the slider comes out beside it for a few seconds | hover the speaker, then the slider | Tab to the slider, then the arrow keys |

Each scene has its own slow loop of music, made in the browser like the picture. A browser
will not let a page make sound until it has been touched, so the music begins with the
first tap, click or key, and the speaker turns it off; that choice is remembered. On an
iPhone it plays with the ringer switch off, as a music player's sound does.

The volume slider is folded away to the left of the speaker. It comes out while a pointer
is over the speaker or the slider, while either has the keyboard, and for four seconds
after the speaker is touched (a finger has no hover). All the way down is off, and turning
the sound on again returns to where the slider was. Loudness goes by the square of the
slider's position, which is nearer to how it is heard.

Changing scene does not stop the music. It is one performance: the band plays on to the
end of the bar, the new scene's song comes in on the bar line in a neighbouring key, and
the tempo eases to the new song's over the next few bars. From the moment the change is
asked for, a low-pass closes over the old song and opens again on the new one's first
beat, so the join sounds like a door between two rooms and not like a record being swapped.

Someone who has watched one scene for 45 seconds without changing it is shown a small hint,
"Double-tap for another scene", for 20 seconds. Dismissing it, or changing scene even once,
means it is not shown again. What the page remembers is in `localStorage`:
`airship-vibes.scenes` for the hint, `airship-vibes.sound` and `airship-vibes.volume` for the
speaker and its slider, and `airship-vibes.quality` for how sharp a picture this device was
last found able to draw.

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
and hide the controls), `?q=0.5` (hold the picture at half the pixels it could have),
`?px=2` (device pixels per drawn pixel), `?aa=0` (no antialiasing).

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
src/app.js              the page: canvas, clock, input, controls. The only module that touches the DOM
src/renderer.js         the only module that touches WebGL
src/audio.js            the only module that touches Web Audio: instruments, mix, player
src/music.js            the four songs as data, and the performance that runs through them
src/gesture.js          what a touch meant: tap, swipe, double tap
src/glsl.js             every shader, as source text
src/scenes.js           the four scenes, as data
src/director.js         time -> ship pose and camera; the playhead (which shot is on)
src/ship.js             the airship model
src/mesh.js             triangle builder and the 32-byte vertex
src/terrain.js          the ground grid, in blocks, and which of them a camera can see
src/flock.js            birds
src/noise.js            the noise the shaders read as textures: two lattices and the cloud volume
src/colour.js           hex colours, as the shaders want them
src/font.js             the caption's 5 x 7 bitmap face
src/layout.js           how many pixels the picture may have
src/pace.js             how many it gets: what this device can draw thirty times a second
src/vec.js, src/rng.js  vectors, matrices and frustums; seeded randomness
test/*.test.mjs         unit tests, run in CI
test/browser-check.mjs  Playwright check, run on a dev box
```

Everything except `app.js`, `renderer.js` and `audio.js` has no DOM, WebGL or Web Audio in
it, and `audio.js` only uses the context it is handed. The page, the
unit tests and `verify.mjs` (from the *built* copy) all import the same modules. One
implementation of each; never fork one.

### How a frame is drawn

1. **The scene**, antialiased (four samples a pixel), into a colour and a depth texture in
   ordinary continuous colour. Nearest things first, so that what they cover is never
   shaded: the airship, its lamps, birds, buildings, the ground, and last the sky, on the
   far plane with the depth test on. Then the window panes, blended. The colour texture's
   alpha is not transparency; it is how strongly a pixel glows.
2. **Cloud, at half size.** Cloud is the dearest thing in the picture (dozens of samples of
   a 3D texture along every ray) and it is soft, so it is marched for one pixel in four,
   between the eye and the depth already drawn, and enlarged in step 4. Each cloud pixel
   records the depth it was marched to, so that a pixel of airship in front of a cloud bank
   is not given its neighbour's cloud.
3. **Glow.** What is bright in the scene, weighted by that alpha, gathered into a small
   picture (one texel to two dots) and blurred.
4. **Composite**, onto the canvas: the scene, its glow, the cloud in front of it, an
   outline where the scene asks for one, the vignette.
5. **Twice, during a dissolve.** For the three seconds one shot takes to dissolve into the
   next, steps 1 to 4 are done for both cameras, each into a texture, and a fifth step
   cross-fades them: both shots keep moving and neither is a held frame. A change of scene
   is the same: the renderer keeps a "stage" per scene (its programs, grid and lamps), so
   the scene being left goes on being drawn, on its own clock, under the one arriving. A
   picture that is mostly faded out is drawn smaller (down to half size, in a corner of
   the same textures), so the two together cost little more than one.

The canvas is as many pixels as the picture is drawn with, and CSS stretches it over the
window, smoothly. The caption is a second, tiny canvas over the first, enlarged by a
whole number with hard edges: lettering is the one thing that wants to stay crisp.

### How sharp, and how it keeps time

The first two versions drew a fixed, small number of chunky pixels. On a phone that was
both too coarse and too slow, and making it coarser did not make it faster, because much
of the cost did not depend on the number of pixels at all. This version is built the other
way round.

- **A pixel is cheap.** Noise is read from textures that `noise.js` lays out (one fetch
  brings the four corners of a lattice cell; hashing them was sixty integer operations,
  and a pixel of mountain wanted that fifty times). The ground's height is worked out once
  a pixel, not three times: its slope comes from the difference between neighbouring
  pixels. Only the octaves a pixel can show are computed, the last one fading in, so the
  count changes smoothly with distance.
- **Nothing hidden is drawn.** The ground grid reaches forty kilometres in every direction
  and is cut into blocks; only the blocks inside the camera's view are sent, nearest first
  (`terrain.js`). The city's buildings likewise. Drawing front to back and the sky last
  means a pixel is shaded about once.
- **Sharpness is whatever the device can draw thirty times a second.** `layout.js` says
  the most pixels the picture may have (two a CSS pixel, and no more than a 1080p frame);
  `pace.js` finds the share of that a device can draw in time. It probes by drawing on
  every frame the screen offers and watching how far apart they arrive, raises or lowers
  the pixel count in proportion, and then holds at thirty a second, watching for frames
  running late. It probes again at each new shot, since shots differ in cost. The picture
  is never drawn softer than 0.6 pixels a CSS pixel.

### Rules that keep it working

- **Sizes on screen are in dots, never in drawn pixels.** A dot is a CSS pixel. A star, a
  lamp, a far-off window, a seam on the hull and the grain of the glitter on the sea are
  all sized in dots (`uRes.w` is radians per dot, `uRes.z` drawn pixels per dot,
  `dotAt()` the dot a pixel is in). The number of pixels drawn changes from device to
  device and from shot to shot, and it must only ever change how sharp the picture is.
  `browser-check.mjs` draws the same second at two sizes and fails if they are not the
  same picture; `glsl.test.mjs` fails a scene shader that uses `gl_FragCoord` directly.
- **Every surface ends in `shade()`**, which writes the colour with half a step of grain,
  different for every pixel. Without it a night sky or a bank of haze is stored in 8 bits
  as visible bands.
- **`land.range` in `scenes.js` must hold the ground.** The renderer leaves out ground the
  camera cannot see and judges that from the lowest and highest the scene says its ground
  can be. Too wide costs a little speed; too narrow cuts holes in mountains. If a scene's
  height function is changed, check its range.
- **Texture that cannot be resolved is faded out, not drawn.** A pattern finer than a
  couple of pixels is a different random number at every pixel on every frame. Ground
  texture goes through `fbmSoft()`, which fades each octave to its own average as it
  shrinks; forest canopy and the lumps on a cloud are read at a size that doubles with
  distance, each size blended into the next, so they neither sparkle nor go flat.
- **A cloud's detail must be no finer than the march can catch.** A ray through cloud is
  stepped, and a lump thinner than a step is hit by some rays and missed by their
  neighbours, which shows as streaks (`cloudLumps()`); a thin layer wants enough steps
  through it (`cloud.through`), or it is drawn only where it happens to cross a step and
  comes out in terraces.
- **A frame is a pure function of the seed, the second and the playhead.** `director.js`
  integrates nothing, `flock.js` simulates nothing, the shaders animate from `uTime`. A
  hidden tab, a slow phone and a test asking for second 437 all get the same picture, and
  `?seed=&t=` reproduces any frame of an untouched visit. The playhead (which shot is on,
  since when, and the one it came from) is the only state, it is a plain object, and only
  `advance()` and `move()` make a new one. Do not add state that advances per frame. (How
  many pixels a frame is drawn with is the one thing that does depend on the device, and
  by the rule above it does not change the picture.)
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
- **Noise comes from lattices of random bytes built in `noise.js`**, never from
  `fract(sin(x) * 43758.5)`, which gives different terrain on different GPUs. The shaders
  wrap the lattices by masking with 255 and are told the cloud volume's size by a
  `#define`; a test holds both to the constants in `noise.js`.
- **GLSL ES 3.00, written to the letter**: `#version 300 es` first, `highp` throughout
  (including `sampler3D`, which has no default precision), no implicit int/float
  conversion, no reserved words as names, and no backtick in a comment (the sources are
  template strings, and one ends them). `test/glsl.test.mjs` checks what can be checked
  without a compiler, and that every uniform a shader declares is one `renderer.js` sets
  and the reverse: a mismatch is otherwise silent.
- **The city's block size is written once**, in `scenes.js`, and reaches the shaders as
  `#define`s, because the renderer places the buildings' instance grid with it.
- **No dependencies, no model files, no images, no audio files.** Everything is generated:
  the meshes in `ship.js`, the textures in `noise.js`, the caption in `font.js`, every
  note in `audio.js`.
- **Sound only ever starts inside a gesture's handler** (`wake()` in `app.js`), because
  that is the only place a browser allows it, and stops when the tab is hidden.
- **A bar of music is a pure function of the song, the seed, the bar's number and the
  tempo**, and a `Sequence` asked for a stretch in pieces hands out exactly what it would
  if asked for it whole. The player schedules 0.4 s ahead and depends on both.
- **The bar count never restarts.** A change of scene changes which song the next bar is
  read from; it does not start a new performance. That is what keeps the beat going
  through the join, and it is why only the very first two bars are the piano alone.
- **Gestures are judged by the events' own timestamps**, which are when the finger moved,
  not when a busy page got round to hearing about it.

### The music

Four chords on an electric piano, a soft kick and snare with the off-beats late, a bass on
the root, a few notes of melody in some bars, the hiss and pop of a record and a little
wind. `music.js` says which notes fall where; `audio.js` makes each sound from oscillators
and filtered noise, and runs the mix through a low-pass, a slow wobble in pitch and a room
made from decaying noise.

The four songs are in C, C, F and G, the order the scenes come round in: each is a fourth,
a fifth or a whole step from the next, so most of one song's notes are also in the song it
gives way to. A `Sequence` (`music.js`) is the performance: it hands out the bars in order,
and when asked for another song it turns to it at the end of the bar being read, starting
on that song's first chord and moving the tempo toward its own by at most four beats a
minute per bar. `audio.js` adds the low-pass that closes over the old song until the bar
line (`close()`, `conduct()`), and lets the record's hiss and the wind drift to the new
scene's levels.

Nobody listened to it while it was written: it was balanced by measurement, rendering each
song to a buffer and looking at the level of every instrument and where the energy sits.
The first mix had 85% of its energy below 250 Hz, which a phone speaker cannot reproduce,
so the chords are voiced without their roots between G3 and A4, the bass and kick carry
overtones, and about half the energy is now between 250 and 800 Hz. `browser-check.mjs`
renders every song and fails if it is silent, clips, or is nearly all bass; it also renders
a change of song and fails if the mix dips or clips across the join, or if the old song's
top end is not drawn down before the bar line and back after it. To change the mix, use
`renderOffline(OfflineAudioContext, id, seed, seconds, only, 44100, turns)` from a page:
`only` solos one kind of note, and `turns` is a list of `{ at, id, seed }` scene changes.

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
these pages are finished by the GPU, and a frame can be valid and ugly. It also drives the
taps, swipes and keys, the speaker and its slider, a change of song and the hint.

Headless Chromium here renders with SwiftShader (software), which is slow but exact. It
says little about frame rate on a phone, and what it says is skewed: it makes texture
fetches dear and vertex work very dear, where a phone's chip makes them cheap. Judge a
change's cost by what it does per pixel and per vertex, and use the timings only to
compare a pass with itself before and after. The frame rate on a real device is what
`pace.js` is there to protect: `__vibes.state()` in the console of the device reports
the quality it settled on and the size it is drawing.
