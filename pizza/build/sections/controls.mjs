import { PILLAR_META, CARE_STEPS } from '../../src/render.js';
import { esc } from '../html.mjs';
import { DEFAULT_WEIGHTS } from '../../src/slice.js';

const FACTOR_COPY = {
  reputation:      'Standing earned over time: years in business, how many people have reviewed it, and whether the press keeps coming back. Computed from data.',
  critical:        'A critic base rating, lifted a bounded amount by recent coverage. New reviews and list appearances feed it daily.',
  craft:           'The pizza itself: dough, fermentation, bake, and what goes on top. An editorial rating, applied by one rubric.',
  distinctiveness: 'Does it own a lane in this city, or is it a competent copy of someone else? Editorial.',
  value:           'Quality delivered per dollar: the craft and reception scores, scaled by the price tier. Computed.'
};

export function controlsParts(ctx) {
  const { dataset } = ctx;
/* ---- controls ---- */
const careHeader = `
          <div class="care-corner" aria-hidden="true"></div>
          ${CARE_STEPS.map(st => `<div class="care-col"><b>${st.pct}</b><span>${st.word}</span></div>`).join('')}`;

const careRows = Object.keys(DEFAULT_WEIGHTS).map(k => `
          <div class="care-factor">
            <span class="factor-icon" aria-hidden="true">${PILLAR_META[k].icon}</span>
            <span class="factor-name">
              <b><span class="swatch" style="background:${PILLAR_META[k].color}"></span>${PILLAR_META[k].label}</b>
              <span class="factor-desc">${PILLAR_META[k].short}</span>
            </span>
            <span class="factor-val" id="v-${k}">${DEFAULT_WEIGHTS[k]}%</span>
          </div>
          ${CARE_STEPS.map(st => `
          <div class="care-cell">
            <input type="radio" name="care-${k}" id="care-${k}-${st.mult}" value="${st.mult}"
                   class="sr-only"${st.mult === 1 ? ' checked' : ''}
                   aria-label="${PILLAR_META[k].label}: ${st.pct}">
            <label for="care-${k}-${st.mult}"></label>
          </div>`).join('')}`).join('');

const factorCards = Object.keys(DEFAULT_WEIGHTS).map(k => `
        <div class="pillar">
          <div class="w">${DEFAULT_WEIGHTS[k]}<span style="font-size:15px;color:var(--ink-3)">%</span></div>
          <h3><span class="swatch" style="background:${PILLAR_META[k].color}"></span>${PILLAR_META[k].label}</h3>
          <p>${FACTOR_COPY[k]}</p>
        </div>`).join('');

const frictionRows = Object.entries(dataset.attributeRegistry)
  .filter(([, a]) => a.frictionCost > 0)
  .sort((a, b) => b[1].frictionCost - a[1].frictionCost)
  .map(([, a]) => `<tr><td>${esc(a.label)}</td><td class="num">−${a.frictionCost.toFixed(1)}</td></tr>`)
  .join('');
  return { careHeader, careRows, factorCards, frictionRows };
}
