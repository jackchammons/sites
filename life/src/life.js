/* Conway's Game of Life on a torus.
 *
 * One implementation, imported by both the browser (app.js) and the deploy
 * gate (verify.mjs, which runs it from the built copy). Cells are a flat
 * Uint8Array, row-major, 1 = alive. Edges wrap, so a glider that leaves the
 * right side re-enters on the left and the board never empties out at the
 * borders the way a walled grid does.
 *
 * It also holds the test for a board that has run out of things to do, so
 * the gate can run that from the built copy too.
 */

export const DEFAULT_DENSITY = 0.3;

export function createGrid(cols, rows) {
  return { cols, rows, cells: new Uint8Array(cols * rows) };
}

export function randomize(grid, density = DEFAULT_DENSITY, rand = Math.random) {
  const { cells } = grid;
  for (let i = 0; i < cells.length; i++) cells[i] = rand() < density ? 1 : 0;
  return grid;
}

/* Advance one generation: reads `grid.cells`, writes into `next` (a
   Uint8Array of the same length) and returns it. Callers swap the buffers. */
export function step(grid, next) {
  const { cols, rows, cells } = grid;
  for (let y = 0; y < rows; y++) {
    const up = ((y + rows - 1) % rows) * cols;
    const mid = y * cols;
    const down = ((y + 1) % rows) * cols;
    for (let x = 0; x < cols; x++) {
      const l = (x + cols - 1) % cols;
      const r = (x + 1) % cols;
      const n = cells[up + l] + cells[up + x] + cells[up + r]
              + cells[mid + l]               + cells[mid + r]
              + cells[down + l] + cells[down + x] + cells[down + r];
      const i = mid + x;
      next[i] = (n === 3 || (n === 2 && cells[i] === 1)) ? 1 : 0;
    }
  }
  return next;
}

export function population(grid) {
  let n = 0;
  for (const c of grid.cells) n += c;
  return n;
}

/* Random soup burns down. Within minutes all that is left is still lifes and
   a few short-period oscillators, and from then on nothing new can happen:
   the board repeats for ever. A board in that state is cell for cell what it
   was SETTLE_PERIOD generations earlier. 60 is a multiple of every period
   that soup leaves behind in practice: 1 for still lifes, 2 for blinkers,
   toads and beacons, 3 for the pulsar, 15 for the pentadecathlon, and 4, 5,
   6 and 12 besides. Anything still travelling is somewhere else after 60
   generations (a glider is 15 cells along its diagonal), so a board with a
   glider in flight does not match and is left to run. */
export const SETTLE_PERIOD = 60;

export function createWatch(period = SETTLE_PERIOD) {
  return { period, age: 0, cells: null };
}

/* Call once per generation, after the step. Keeps a copy of the board and,
   every `period` generations, answers whether the board has come back to
   that copy before taking the next one. A board of a different size starts
   the watch again. */
export function settled(watch, grid) {
  const { cells } = grid;
  if (!watch.cells || watch.cells.length !== cells.length) {
    watch.cells = Uint8Array.from(cells);
    watch.age = 0;
    return false;
  }
  if (++watch.age < watch.period) return false;
  let same = true;
  for (let i = 0; i < cells.length; i++) {
    if (cells[i] !== watch.cells[i]) { same = false; break; }
  }
  watch.cells.set(cells);
  watch.age = 0;
  return same;
}
