import { PILLAR_META } from '../../src/render.js';
import { esc } from '../html.mjs';
import { DEFAULT_WEIGHTS } from '../../src/slice.js';

const FACTOR_COPY = {
  reputation:      'Standing earned over time: years in business, how many people have reviewed it, and whether the press keeps coming back. Computed from data; it carries weight only when it is on file and would not lower the score.',
  critical:        'A critic base rating, lifted a bounded amount by the press coverage the research pass files against the entry.',
  craft:           'The pizza itself: dough, fermentation, bake, and what goes on top. Graded by the research agent from published coverage, with the sources it read.',
  distinctiveness: 'Does it own a lane in this city, or is it a competent copy of someone else? Graded the same way as craft.',
  value:           'Quality delivered per dollar: the craft and reception scores, scaled by the price tier. Computed.'
};

/* The methodology section's factor cards and friction table. */
export function methodParts(ctx) {
  const { dataset } = ctx;
const factorCards = Object.keys(DEFAULT_WEIGHTS).map(k => `
        <div class="pillar">
          <div class="w">${DEFAULT_WEIGHTS[k]}<span style="font-size:15px;color:var(--ink-3)">%</span></div>
          <h4><span class="swatch" style="background:${PILLAR_META[k].color}"></span>${PILLAR_META[k].label}</h4>
          <p>${FACTOR_COPY[k]}</p>
        </div>`).join('');

const frictionRows = Object.entries(dataset.attributeRegistry)
  .filter(([, a]) => a.frictionCost > 0)
  .sort((a, b) => b[1].frictionCost - a[1].frictionCost)
  .map(([, a]) => `<tr><th scope="row">${esc(a.label)}</th><td class="num">−${a.frictionCost.toFixed(1)}</td></tr>`)
  .join('');
  return { factorCards, frictionRows };
}
