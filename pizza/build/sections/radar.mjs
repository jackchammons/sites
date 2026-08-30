import { esc, nameLink, shortDate } from '../html.mjs';
import { locationLabel } from '../../src/locations.js';

export function radarSection(ctx) {
  const { dataset, now } = ctx;
/* ---- Opening radar / recently closed ---- */
const opening = dataset.restaurants.filter(r => r.status === 'opening');
const RECENT_CLOSE_DAYS = 183;
const closedRecently = dataset.restaurants.filter(r =>
  r.status === 'closed' && r.statusDate &&
  (now - new Date(r.statusDate)) < RECENT_CLOSE_DAYS * 864e5);

const radarRow = r => `
      <li>
        <strong>${nameLink(r)}</strong>
        <span class="cand-meta">${esc(r.neighborhood ?? '')}${r.style ? ` · ${esc(r.style)}` : ''}</span>
        ${r.blurb ? `<span class="cand-note">${esc(r.blurb)}</span>` : ''}
        ${r.statusSource ? `<a href="${esc(r.statusSource)}" target="_blank" rel="noopener nofollow">source</a>` : ''}
      </li>`;

const closedRow = r => `
      <li>
        <strong>${esc(r.name)}</strong>
        <span class="cand-meta">${esc(r.neighborhood ?? '')}${r.style ? ` · ${esc(r.style)}` : ''}</span>
        ${r.statusNote ? `<span class="cand-note">${esc(r.statusNote)}</span>` : ''}
        ${r.statusSource ? `<a href="${esc(r.statusSource)}" target="_blank" rel="noopener nofollow">source</a>` : ''}
      </li>`;

const radarSection = (opening.length || closedRecently.length) ? `
<section class="section">
  <div class="wrap">
    <div class="eyebrow">The radar</div>
    <h2 class="sec-h">Opening soon${closedRecently.length ? ' &amp; recently closed' : ''}</h2>
    <p class="lede" style="margin-top:14px">
      Pizzerias on the way in${closedRecently.length ? ', and the ones Seattle just lost' : ''}.
      The daily research pass finds these in local coverage before they have review pages;
      each links to where it was reported. When one opens its doors it moves into the
      directory below, and into the ranking once it has been rated.${closedRecently.length ? `
      Closures are listed here for six months; older ones stay in the directory, marked
      with the year they closed.` : ''}
    </p>
    ${opening.length ? `
    <h3 class="buzz-head">Opening soon</h3>
    <ul class="cand-list">${opening.map(radarRow).join('')}</ul>` : ''}
    ${closedRecently.length ? `
    <h3 class="buzz-head">Recently closed</h3>
    <ul class="cand-list">${closedRecently.map(closedRow).join('')}</ul>` : ''}
  </div>
</section>
` : '';

  return radarSection;
}
