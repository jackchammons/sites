/* The radar: places on the way in, and the ones Seattle just lost.
 *
 * Both lists are the registry's (src/registry.js): "opening soon" is its
 * not-open-yet category, and "recently closed" is its closed category cut to
 * the last six months. So every place named here is in the directory under
 * the matching category, and each row links to it there. The closed category
 * holds pizzerias on file and places known only from a food permit that a
 * census pass found closed, and so does this list. */
import { esc, nameLink, shortDate, hostOf } from '../html.mjs';
import { tidyPossessive } from '../../src/census.js';
import { recentlyClosed } from '../../src/registry.js';

export function radarSection(ctx) {
  const { registry, now } = ctx;
  const opening = registry.byCategory.opening;
  /* Recent by the closure date the source reported; when none was stated, by
   * the day the pass found it, and the row says so. A closure found late is
   * not news, and must not be listed as one. */
  const closedRecently = recentlyClosed(registry, now);

  const source = url => url ? `<a href="${esc(url)}" target="_blank" rel="noopener nofollow">${esc(hostOf(url))}</a>` : '';
  const inDirectory = p => ` · <a class="cand-dir" href="#${esc(p.anchor)}">in the directory</a>`;

  const radarRow = p => {
    const r = p.entry;
    return `
      <li data-place="${esc(p.anchor)}">
        <strong>${nameLink(r)}</strong>
        <span class="cand-meta">${esc(r.neighborhood ?? '')}${r.style ? ` · ${esc(r.style)}` : ''}${inDirectory(p)}</span>
        ${r.blurb ? `<span class="cand-note">${esc(r.blurb)}</span>` : ''}
        ${source(r.statusSource)}
      </li>`;
  };

  /* A closure is dated only by what the source stated. For a pizzeria on file
   * with no stated date, and for every place known only from a permit, what
   * is on file is the day a pass found it closed: that is "reported", never
   * "closed on". */
  const closedRow = p => {
    if (p.kind === 'entry') {
      const r = p.entry;
      return `
      <li data-place="${esc(p.anchor)}">
        <strong>${esc(r.name)}</strong>
        <span class="cand-meta">${esc(r.neighborhood ?? '')}${r.style ? ` · ${esc(r.style)}` : ''}${
          p.dates.closed ? ` · closed ${esc(shortDate(p.dates.closed))}` :
          p.dates.reported ? ` · closure reported ${esc(shortDate(p.dates.reported))}` : ''}${inDirectory(p)}</span>
        ${r.statusNote ? `<span class="cand-note">${esc(r.statusNote)}</span>` : ''}
        ${source(r.statusSource)}
      </li>`;
    }
    const c = p.candidate;
    const where = [c.neighborhood, c.address].filter(Boolean).map(esc).join(' · ');
    return `
      <li data-place="${esc(p.anchor)}">
        <strong>${esc(tidyPossessive(c.name))}</strong>
        <span class="cand-meta">${where ? `${where} · ` : ''}not on file, known only from ${
          (p.at.origin ?? 'permit') === 'research' ? 'a research pass' : 'a food permit'}${
          p.dates.reported ? ` · closure reported ${esc(shortDate(p.dates.reported))}` : ''}${inDirectory(p)}</span>
        ${c.note ? `<span class="cand-note">${esc(c.note)}</span>` : ''}
        ${source(c.resolutionSource)}
      </li>`;
  };

  return (opening.length || closedRecently.length) ? `
<section class="section" id="radar">
  <div class="wrap">
    <div class="eyebrow">The radar</div>
    <h2 class="sec-h">Opening soon${closedRecently.length ? ' &amp; recently closed' : ''}</h2>
    <p class="lede" style="margin-top:14px">
      Pizzerias on the way in${closedRecently.length ? ', and the ones Seattle just lost' : ''}.
      The daily research pass finds these in local coverage before they have review pages;
      each links to where it was reported. Every one is in the directory below already, and
      joins the ranking once it has opened and been rated.${closedRecently.length ? `
      Closures are listed here for six months; older ones stay in the directory, marked
      with the year they closed.` : ''}
    </p>
    ${opening.length ? `
    <h3 class="buzz-head">Opening soon</h3>
    <ul class="cand-list" data-radar="opening">${opening.map(radarRow).join('')}</ul>` : ''}
    ${closedRecently.length ? `
    <h3 class="buzz-head">Recently closed</h3>
    <ul class="cand-list" data-radar="closed">${closedRecently.map(closedRow).join('')}</ul>` : ''}
  </div>
</section>
` : '';
}
