# Life

Conway's Game of Life, at `/life/`. Live in the browser: **[sites.jackhammons.com/life/](https://sites.jackhammons.com/life/)**

A white page, a light grid, black tiles. The board is seeded at random the moment the
page opens and steps at ten generations a second until the tab closes. There is nothing
else on the page: no controls, no counter, no text.

## How it is put together

```
data/data.json       title and tagline
scripts/build.mjs    renders the shell (one canvas) into OUT_DIR, copies src/
scripts/verify.mjs   deploy gate
src/life.js          the rules: grid, random seed, one-generation step, on a torus
src/app.js           the live half: sizes the canvas, seeds, draws, ticks
```

Nothing about the game is decided at build time. A seed baked into the markup would replay
the same opening for every visitor, so the build emits only an empty canvas and
`src/app.js` does the rest from `Math.random` on load.

The grid is 8 CSS pixels per cell, so a laptop window holds roughly 180 by 110 cells and a
phone roughly 48 by 100: dense enough that gliders, oscillators and the occasional gun
turn up in the first few seconds, while each tile stays large enough to read as a tile.
Edges wrap (the board is a torus), so activity that drifts off one side comes back on the
other rather than dying against a wall. A resize keeps every cell that still fits and seeds
only the new territory, so a phone's address bar sliding in and out does not reset the game.

## Working on it

```bash
node life/scripts/build.mjs      # writes dist/
node life/scripts/verify.mjs
```

`src/life.js` is the one implementation of the rules; `verify.mjs` imports it from the
*built* copy and checks a blinker oscillates, a block holds still, and a glider travels
(1,1) in four generations, including across the wrapped edge. It also checks the single
element lookup in `app.js` exists in the markup and that every asset is linked relatively,
since the site lives under a subpath.
