/* Blu-ray Shelf — the live half. The build has already rendered every spine
   and every row, in shelf order, so the page is complete without this file.
   What it adds is the two controls: a chip narrows the list and dims the
   spines it leaves out, and the order menu re-sorts the rows. Which entries
   show, and in what order, is decided by arrange() in shelf.js. */
import { arrange } from './shelf.js';

const $ = id => document.getElementById(id);
const discs = JSON.parse($('discs').textContent);

const controls = $('controls');
const list = $('list');
const tally = $('tally');
const rows = new Map([...list.children].map(li => [li.dataset.id, li]));
const spines = new Map([...$('spines').querySelectorAll('a')].map(a => [a.dataset.id, a]));

function apply() {
  const state = { show: controls.elements.show.value, sort: controls.elements.sort.value };
  const shown = arrange(discs, state);
  const ids = new Set(shown.map(d => d.id));
  for (const [id, li] of rows) li.hidden = !ids.has(id);
  for (const d of shown) list.appendChild(rows.get(d.id));
  for (const [id, a] of spines) a.classList.toggle('off', !ids.has(id));
  tally.textContent = shown.length === discs.length
    ? `All ${discs.length} shown`
    : `${shown.length} of ${discs.length} shown`;
}

controls.addEventListener('change', apply);
// A form that reloads the page would throw the choice away.
controls.addEventListener('submit', e => e.preventDefault());

/* A spine links to its row. If a chip has that row hidden the link would go
   nowhere, so the chips go back to Everything before the browser follows it. */
$('spines').addEventListener('click', e => {
  const a = e.target.closest('a');
  if (!a || !rows.get(a.dataset.id)?.hidden) return;
  controls.elements.show.value = 'all';
  apply();
});

/* A browser may put the controls back as the viewer left them, after a reload
   or a trip through history, without firing a change event. pageshow comes
   after that, and on the first load too, so the list always matches them. */
window.addEventListener('pageshow', apply);

controls.hidden = false;
apply();
