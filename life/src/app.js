/* The live half of /life/: a canvas the size of the viewport, seeded at
   random when the page opens and stepped at a fixed rate until it closes.
   A board that has burnt down to still lifes and blinkers is seeded again,
   and a click, a tap or the space bar pauses it. There is nothing to see
   but the board, so both of those happen without any control on the page. */
import { createGrid, randomize, step, createWatch, settled } from './life.js';

const $ = id => document.getElementById(id);

const CELL = 8;                     // CSS pixels per cell, grid line included
const GENERATIONS_PER_SECOND = 10;  // the conventional "normal" speed
const CALM_GENERATIONS_PER_SECOND = 2;  // for a viewer who has asked for less motion
const REST_MS = 3000;               // how long a settled board stays on show before it is reseeded
const GRID_LINE = '#e0e0e0';
const CELL_INK = '#000000';

const canvas = $('board');
const ctx = canvas.getContext('2d', { alpha: false });

/* Read on every frame rather than once, so switching the setting while the
   page is open changes the pace straight away. */
const calm = window.matchMedia('(prefers-reduced-motion: reduce)');
const interval = () => 1000 / (calm.matches ? CALM_GENERATIONS_PER_SECOND : GENERATIONS_PER_SECOND);

let grid, next, scale;
let watch = createWatch();
let rest = -1;        // generations a settled board has left; -1 while it is still evolving
let paused = false;

function layout() {
  const w = window.innerWidth, h = window.innerHeight;
  const cols = Math.max(1, Math.floor(w / CELL));
  const rows = Math.max(1, Math.floor(h / CELL));
  scale = window.devicePixelRatio || 1;
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  canvas.style.width = w + 'px';
  canvas.style.height = h + 'px';

  if (!grid) {
    grid = randomize(createGrid(cols, rows));
  } else if (cols !== grid.cols || rows !== grid.rows) {
    /* The viewport changed shape: keep every cell that still fits and seed
       the new territory, rather than throwing the whole board away on a
       phone's address bar sliding in and out. */
    const fresh = randomize(createGrid(cols, rows));
    for (let y = 0; y < Math.min(rows, grid.rows); y++) {
      for (let x = 0; x < Math.min(cols, grid.cols); x++) {
        fresh.cells[y * cols + x] = grid.cells[y * grid.cols + x];
      }
    }
    grid = fresh;
    // New territory is new soup, so whatever the board had settled into is over.
    watch = createWatch();
    rest = -1;
  }
  next = new Uint8Array(cols * rows);
  draw();
}

function draw() {
  const { cols, rows, cells } = grid;
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = CELL_INK;
  for (let y = 0; y < rows; y++) {
    const row = y * cols;
    for (let x = 0; x < cols; x++) {
      if (cells[row + x]) ctx.fillRect(x * CELL, y * CELL, CELL, CELL);
    }
  }

  // Grid lines go on top so a live cell reads as a tile inside its square.
  ctx.fillStyle = GRID_LINE;
  const w = cols * CELL, h = rows * CELL;
  for (let x = 0; x <= cols; x++) ctx.fillRect(x * CELL, 0, 1, h);
  for (let y = 0; y <= rows; y++) ctx.fillRect(0, y * CELL, w, 1);
}

/* One generation. A settled board is left on show for a few seconds, still
   blinking, and then the whole of it is seeded afresh: left alone it would
   look exactly like this until the tab closed. */
function advance() {
  if (rest === 0) {
    randomize(grid);
    watch = createWatch();
    rest = -1;
    return;
  }
  const out = step(grid, next);
  next = grid.cells;
  grid.cells = out;
  if (rest > 0) rest--;
  else if (settled(watch, grid)) rest = Math.ceil(REST_MS / interval());
}

/* The frame loop keeps running while paused and simply steps nothing, which
   leaves one loop to reason about. Coming back from a pause, or from a
   hidden tab, plays one generation and carries on: the remainder below
   drops the time that passed, so there is no burst to catch up. */
let last = 0;
function tick(now) {
  const every = interval();
  if (!paused && now - last >= every) {
    last = now - ((now - last) % every);
    advance();
    draw();
  }
  requestAnimationFrame(tick);
}

function togglePause() { paused = !paused; }

layout();
window.addEventListener('resize', layout);
canvas.addEventListener('click', togglePause);
/* The canvas is the whole page and takes no focus of its own, so the space
   bar is heard on the window. */
window.addEventListener('keydown', e => {
  if (e.key !== ' ' || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
  e.preventDefault();
  togglePause();
});
requestAnimationFrame(tick);
