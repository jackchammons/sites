# Life

Conway's Game of Life, at `/life/`. Live in the browser: **[sites.jackhammons.com/life/](https://sites.jackhammons.com/life/)**

A white page, a light grid, black tiles. The board is seeded at random the moment the
page opens and steps at ten generations a second until the tab closes. There is nothing
else on the page: no controls, no counter, no text.

Two things happen without any control on the page:

- **A board that has run out is seeded again.** Random soup burns down to still lifes and
  a few blinkers within minutes (about two on a phone, five on a laptop), after which it
  would repeat for ever. The page notices, leaves the settled board on show for three
  seconds, and reseeds the whole of it.
- **A click, a tap or the space bar pauses it, and the same again resumes.** The canvas
  label says so, which is the only place it is written on the page. With
  `prefers-reduced-motion` set, the board runs at two generations a second instead of
  ten, and a change to that setting is followed while the page is open.

## How it is put together

```
data/data.json       title and tagline
scripts/build.mjs    renders the shell (one canvas) into OUT_DIR, copies src/
scripts/verify.mjs   deploy gate
src/life.js          the rules: grid, random seed, one-generation step, on a torus,
                     and the test for a board that has settled
src/app.js           the live half: sizes the canvas, seeds, draws, ticks, reseeds, pauses
```

Nothing about the game is decided at build time. A seed baked into the markup would replay
the same opening for every visitor, so the build emits only an empty canvas and
`src/app.js` does the rest from `Math.random` on load.

The grid is 8 CSS pixels per cell, so a laptop window holds roughly 180 by 110 cells and a
phone roughly 48 by 100: dense enough that gliders and oscillators turn up in the first
few seconds, while each tile stays large enough to read as a tile.
Edges wrap (the board is a torus), so activity that drifts off one side comes back on the
other rather than dying against a wall. A resize keeps every cell that still fits and seeds
only the new territory, so a phone's address bar sliding in and out does not reset the game.

### Reseeding

`settled()` in `src/life.js` is called once per generation. It keeps a copy of the board
and, every `SETTLE_PERIOD` (60) generations, answers whether the board is cell for cell
what it was at the last copy. 60 is a multiple of the periods soup settles into: 1 (still
lifes), 2 (blinkers, toads, beacons), 3 (pulsars) and 15 (the pentadecathlon). Anything
still travelling has moved after 60 generations, so a board with a glider in flight does
not match and is left alone. An empty board matches too. Once it answers yes, `app.js`
plays three more seconds of generations and then calls `randomize()` on the whole board.
A resize that changes the grid starts the watch again, since the new territory is new
soup. A paused board is never reseeded while it is paused.

### Pausing

`app.js` listens for `click` on the canvas (a tap arrives as a click) and for the space
bar on `window`, because the canvas is the whole page and takes no focus. The frame loop
keeps running while paused and steps nothing; on resume it plays one generation and
carries on, with no burst to catch up. A hidden tab pauses by itself, since the loop is
driven by `requestAnimationFrame`.

## Working on it

```bash
node life/scripts/build.mjs      # writes dist/life/, the same place build-all puts it
node life/scripts/verify.mjs
```

The build refuses to clear an output directory that is neither empty nor a previous
build (one with an `index.html`), so a mistyped `OUT_DIR` cannot delete source.

`src/life.js` is the one implementation of the rules; `verify.mjs` imports it from the
*built* copy and checks a blinker oscillates, a block holds still, and a glider travels
(1,1) in four generations, including across the wrapped edge. From the same copy it runs
the settled-board test: it must fire on a block with a blinker, on an empty board and on
a pentadecathlon, and must not fire on a board with a glider in flight. It also checks
the single element lookup in `app.js` exists in the markup, that every name `app.js`
imports is one `life.js` exports, that the canvas label mentions pausing, and that every
asset is linked relatively, since the site lives under a subpath.

There are no unit tests beside the gate: the rules and the settled-board test are small
enough that `verify.mjs` covers them, and what is left is in `app.js`, which only a
browser can exercise. After changing it, serve the build and check by hand or with
Playwright that a click, a tap and the space bar each pause and resume, and that the pace
drops to two generations a second with `reducedMotion: 'reduce'`.
