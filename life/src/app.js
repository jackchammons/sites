/* The live half of /life/: a canvas the size of the viewport, seeded at
   random when the page opens and stepped at a fixed rate until it closes. */
import { createGrid, randomize, step } from './life.js';

const $ = id => document.getElementById(id);

const CELL = 8;                     // CSS pixels per cell, grid line included
const GENERATIONS_PER_SECOND = 10;  // the conventional "normal" speed
const INTERVAL = 1000 / GENERATIONS_PER_SECOND;
const GRID_LINE = '#e0e0e0';
const CELL_INK = '#000000';

const canvas = $('board');
const ctx = canvas.getContext('2d', { alpha: false });

let grid, next, scale;

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

let last = 0;
function tick(now) {
  if (now - last >= INTERVAL) {
    last = now - ((now - last) % INTERVAL);
    const out = step(grid, next);
    next = grid.cells;
    grid.cells = out;
    draw();
  }
  requestAnimationFrame(tick);
}

layout();
window.addEventListener('resize', layout);
requestAnimationFrame(tick);
