import { esc, nameLink, shortDate } from '../html.mjs';
import { locationLabel } from '../../src/locations.js';

export function directorySection(ctx) {
  const { dataset, allScored } = ctx;
/* ---- Directory ---- */
const STATUS_LABEL = { open: 'Open', opening: 'Opening soon', closed: 'Closed' };
const scoreById = new Map(allScored.map(r => [r.id, r]));

const directoryEntries = [...dataset.restaurants].sort((a, b) => {
  const orderOf = r => r.status === 'closed' ? 2 : r.status === 'opening' ? 1 : 0;
  if (orderOf(a) !== orderOf(b)) return orderOf(a) - orderOf(b);
  const sa = scoreById.get(a.id)?.score ?? -1;
  const sb = scoreById.get(b.id)?.score ?? -1;
  return sb - sa || a.name.localeCompare(b.name);
});

const dirRow = r => {
  const scored = scoreById.get(r.id);
  const addr = (r.locations ?? []).map(l => l.address);
  const attrs = Object.keys(r.attributes ?? {}).filter(k => r.attributes[k])
    .map(k => dataset.attributeRegistry[k]?.label ?? k);
  return `
        <tr class="dir-row st-${esc(r.status ?? 'open')}" data-id="${esc(r.id)}">
          <td class="dir-name">${nameLink(r)}
            ${scored && scored.rank <= 10 ? `<span class="dir-rank">#${scored.rank}</span>` : ''}</td>
          <td class="dir-where">${esc(locationLabel(r))}${addr.length ? `
            <div class="dir-addr">${addr.slice(0, 3).map(esc).join('<br>')}${addr.length > 3 ? `
            <details class="dir-more"><summary>+ ${addr.length - 3} more</summary>${addr.slice(3).map(esc).join('<br>')}</details>` : ''}</div>` : ''}</td>
          <td class="dir-style">${esc(r.style ?? '')}</td>
          <td class="dir-attrs">${attrs.map(a => `<span class="chip">${esc(a)}</span>`).join('')}</td>
          <td class="num dir-score">${scored ? scored.score.toFixed(1) : '—'}</td>
          <td class="dir-status">${esc(STATUS_LABEL[r.status] ?? 'Open')}</td>
        </tr>`;
};

const directorySection = `
<section class="section" id="directory">
  <div class="wrap">
    <div class="eyebrow">The directory</div>
    <h2 class="sec-h">Every pizzeria on file</h2>
    <p class="lede" style="margin-top:14px">
      The full inventory behind the ranking: ${dataset.restaurants.length} entries, maintained by the
      daily research pass. Rated entries carry their SLICE score, so this is also where ranks 11
      and up live. Addresses are read from each pizzeria's own website and re-checked on a
      rotation; entries without a score have not been rated yet.
    </p>
    <div id="map" class="dir-map" aria-label="Map of Seattle pizzerias"></div>
    <p class="note dir-map-note">Seattle locations only — red for the top ten, brown for the
    rest of the field, green for places opening soon. Chains' branches outside the city are
    listed in the table, not mapped. Tiles &copy; OpenStreetMap contributors.</p>
    <div class="dir-scroll">
      <table class="dir-table">
        <thead><tr>
          <th>Pizzeria</th><th>Where</th><th>Style</th><th>Notes</th>
          <th class="num">SLICE</th><th>Status</th>
        </tr></thead>
        <tbody>${directoryEntries.map(dirRow).join('')}</tbody>
      </table>
    </div>
  </div>
</section>
`;

  return directorySection;
}
