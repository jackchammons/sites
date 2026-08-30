import { esc, nameLink, shortDate } from '../html.mjs';
import { locationLabel } from '../../src/locations.js';

export function buzzSection(ctx) {
  const { dataset, buzz, entriesById } = ctx;
/* ---- The Buzz: one timeline, tagged with the pizzerias each story mentions ---- */
const KIND_LABEL = { opening: 'Opening', closing: 'Closing', ranking: 'List', mention: 'Mention' };

/* Conservative name matching: an entry tags a story only when its full name
 * appears in the title. The agent's explicit mentions[] ids are merged in. */
function storyTags(item) {
  const title = String(item.title).toLowerCase();
  const ids = new Set(item.mentions ?? []);
  for (const r of dataset.restaurants) {
    if (title.includes(r.name.toLowerCase())) ids.add(r.id);
  }
  return [...ids].map(id => entriesById.get(id)).filter(Boolean);
}

const buzzItem = b => {
  const tags = storyTags(b);
  return `
        <li class="buzz-item">
          <span class="buzz-kind k-${esc(b.kind || 'mention')}">${esc(KIND_LABEL[b.kind] || 'Mention')}</span>
          <div class="buzz-body">
            <a href="${esc(b.url)}" target="_blank" rel="noopener nofollow">${esc(b.title)}</a>
            <div class="buzz-meta">
              <span>${esc(b.source)}</span><span>${esc(shortDate(b.published))}</span>
              ${tags.map(r => nameLink(r, 'buzz-tag')).join('')}
            </div>
          </div>
        </li>`;
};

const buzzSources = [...new Set(buzz.items.map(b => b.source))].length;

const buzzSection = buzz.items.length ? `
<section class="section">
  <div class="wrap">
    <div class="eyebrow">The buzz</div>
    <h2 class="sec-h">What Seattle is writing about</h2>
    <p class="lede" style="margin-top:14px">
      Every day the build sweeps Google News and Eater Seattle for local pizza coverage and files
      it here, newest first. Stories that mention a pizzeria in the index are tagged with it.
      None of this feeds the score directly; press coverage reaches the ranking only through the
      bounded channels described in the methodology.
    </p>
    <div class="stamp" style="margin-top:18px">
      <span>${buzz.items.length} <b>stories</b></span>
      <span>${buzzSources} <b>outlets</b></span>
      ${buzz.updated ? `<span>Swept <b>${esc(shortDate(buzz.updated))}</b></span>` : ''}
    </div>
    <ul class="buzz-list">${buzz.items.map(buzzItem).join('')}</ul>
    <p class="note" style="max-width:70ch">
      Assembled automatically. A story is kept when it reads as local and about pizza;
      national-chain, crime and business-wire items are filtered out. Every item links to its
      original source.
    </p>
  </div>
</section>
` : '';

  return buzzSection;
}
