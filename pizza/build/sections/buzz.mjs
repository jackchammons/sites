import { esc, nameLink, shortDate } from '../html.mjs';
import { mentionMatch } from '../../src/match.js';

export function buzzSection(ctx) {
  const { registry, buzz, entriesById } = ctx;
/* ---- The Buzz: one timeline, tagged with the pizzerias each story mentions ---- */
const KIND_LABEL = { opening: 'Opening', closing: 'Closing', ranking: 'List', mention: 'Mention' };

/* One matcher shared with the feed sweep (src/match.js); the agent's explicit
 * mentions[] ids are merged in on top. */
function storyTags(item) {
  const ids = new Set([...(item.mentions ?? []), ...mentionMatch(item.title, registry.entries)]);
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
<section class="section" id="buzz">
  <div class="wrap">
    <div class="eyebrow">The buzz</div>
    <h2 class="sec-h">What Seattle is writing about</h2>
    <p class="lede" style="margin-top:14px">
      Every publish sweeps Google News for local pizza coverage and files what it keeps here,
      newest first, with the stories the research pass turns up. Stories that mention a pizzeria
      in the index are tagged with it.
      None of this feeds the score directly; press coverage reaches the ranking only through the
      bounded channels described in the methodology.
    </p>
    <div class="stamp" style="margin-top:18px">
      <span>${buzz.items.length} <b>stories</b></span>
      <span>${buzzSources} <b>outlets</b></span>
      ${buzz.updated ? `<span>List last changed <b>${esc(shortDate(buzz.updated))}</b></span>` : ''}
    </div>
    <ul class="buzz-list">${buzz.items.map(buzzItem).join('')}</ul>
    <p class="note" style="max-width:110ch">
      Assembled automatically by a keyword filter on the headline and the outlet: a story is
      kept when it reads as local and about pizza, and dropped when it matches a list of
      national-chain, crime and business-wire terms. A story the list has no term for gets
      through. Every item links to its original source.
    </p>
  </div>
</section>
` : '';

  return buzzSection;
}
