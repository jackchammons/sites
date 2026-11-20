/* Blu-ray Shelf — the live half. The build has already rendered every spine
   and every row, so the page is complete without this file. What it adds is
   the two controls and the movement: a chip narrows the list and dims the
   spines it leaves out, the order menu re-sorts the rows, and the cases on
   the shelf change places to match, each one lifted, carried along and set
   down. The same movement opens the page: the shelf starts jumbled and sorts
   itself out. Which entries show, and in what order, is decided by arrange()
   in shelf.js. */
import { arrange, scramble } from './shelf.js';

const $ = id => document.getElementById(id);
const discs = JSON.parse($('discs').textContent);

const controls = $('controls');
const list = $('list');
const tally = $('tally');
const shelf = $('shelf');
const strip = $('spines');
const rows = new Map([...list.children].map(li => [li.dataset.id, li]));
// A spine is the link. What changes place on the shelf is the list item around it.
const spines = new Map([...strip.querySelectorAll('a')].map(a => [a.dataset.id, a]));

/* Nothing moves for a viewer who has asked for less motion, or in a browser
   without the Web Animations API: the cases are simply in their new places. */
const still = matchMedia('(prefers-reduced-motion: reduce)').matches || typeof strip.animate !== 'function';

const LIFT = 16;      // px a case is raised off the shelf while it travels
const TRAVEL = 900;   // ms from leaving a place to standing in the next
const STAGGER = 30;   // ms between one case setting off and the next, left to right

/* Stand the cases in the given order. Each one that changes place is animated
   from where it stood to where it now belongs: its old position is measured,
   the DOM is reordered, and the difference is played back as a transform
   that runs out to nothing. Measuring first means a change of mind halfway
   through a move starts from wherever the cases have got to. `arriving` is
   the opening of the page, when every case fades in as it sets off. */
function shelve(ids, { arriving = false } = {}) {
  const before = [...strip.children];
  const cases = ids.map(id => spines.get(id).parentNode);
  if (!arriving && cases.every((li, i) => li === before[i])) return;

  const from = new Map(before.map(li => [li, li.getBoundingClientRect().left]));
  for (const li of before) for (const a of li.getAnimations()) a.cancel();
  strip.append(...cases);
  if (still) return;

  const gap = Math.min(STAGGER, 450 / cases.length);
  cases.forEach((li, i) => {
    const dx = from.get(li) - li.getBoundingClientRect().left;
    if (!dx && !arriving) return;
    li.animate([
      { transform: `translate(${dx}px, 0)`, opacity: arriving ? 0 : 1 },
      { transform: `translate(${dx}px, ${-LIFT}px)`, opacity: 1, offset: 0.22 },
      { transform: `translate(0, ${-LIFT}px)`, opacity: 1, offset: 0.8 },
      { transform: 'translate(0, 0)', opacity: 1 },
      // backwards: a case waiting its turn waits where it stood, not where it is going.
    ], { duration: TRAVEL, delay: i * gap, easing: 'cubic-bezier(.4, 0, .2, 1)', fill: 'backwards' });
  });
}

function apply(how) {
  const state = { show: controls.elements.show.value, sort: controls.elements.sort.value };
  const shown = arrange(discs, state);
  const ids = new Set(shown.map(d => d.id));
  for (const [id, li] of rows) li.hidden = !ids.has(id);
  for (const d of shown) list.appendChild(rows.get(d.id));
  for (const [id, a] of spines) a.classList.toggle('off', !ids.has(id));
  // The shelf keeps every case, in the order chosen; a chip only dims some.
  shelve(arrange(discs, { sort: state.sort }).map(d => d.id), how);
  tally.textContent = shown.length === discs.length
    ? `All ${discs.length} shown`
    : `${shown.length} of ${discs.length} shown`;
}

controls.addEventListener('change', () => apply());
// A form that reloads the page would throw the choice away.
controls.addEventListener('submit', e => e.preventDefault());

/* A spine links to its row. If a chip has that row hidden the link would go
   nowhere, so the chips go back to Everything before the browser follows it. */
strip.addEventListener('click', e => {
  const a = e.target.closest('a');
  if (!a || !rows.get(a.dataset.id)?.hidden) return;
  controls.elements.show.value = 'all';
  apply();
});

/* A browser may put the controls back as the viewer left them, after a reload
   or a trip through history, without firing a change event. pageshow comes
   after that, and on the first load too, so the page always matches them. */
window.addEventListener('pageshow', () => apply());

/* The opening. The stylesheet has kept the cases out of sight until now (see
   "hold" there), so nobody sees them standing in order and then jump apart.
   They are jumbled unseen, .ready lets go of the hold, and the first apply()
   brings each one in from its jumbled place. All of it happens before the
   browser next paints. */
controls.hidden = false;
if (!still) strip.append(...scramble([...strip.children]));
shelf.classList.add('ready');
apply({ arriving: !still });
