/* Conway's Game of Life on a torus.
 *
 * One implementation, imported by both the browser (app.js) and the deploy
 * gate (verify.mjs, which runs it from the built copy). Cells are a flat
 * Uint8Array, row-major, 1 = alive. Edges wrap, so a glider that leaves the
 * right side re-enters on the left and the board never empties out at the
 * borders the way a walled grid does.
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
