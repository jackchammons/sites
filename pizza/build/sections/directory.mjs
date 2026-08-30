import { esc, nameLink, shortDate } from '../html.mjs';
import { locationLabel } from '../../src/locations.js';
import { coverageStats } from '../../src/census.js';

export function directorySection(ctx) {
  const { dataset, allScored, candidates } = ctx;
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

const srcLink = (url, text = 'source') =>
  `<a href="${esc(url)}" target="_blank" rel="noopener nofollow">${esc(text)}</a>`;

/* One block of the expanded record: a label and its rows. Blocks with nothing
 * to say are omitted, so a sparse discovery renders a short honest card. */
const dBlock = (label, rows) => rows.length
  ? `<div class="dd-block"><div class="dd-label">${label}</div>${rows.join('')}</div>` : '';
const dRow = html => `<div class="dd-row">${html}</div>`;

const FACTOR_NAME = { craft: 'Craft', distinctiveness: 'Distinctiveness', critical: 'Critical base' };

/* Everything the dataset stores about one entry, rendered at build time into
 * a hidden row the reader can expand — the directory's version of the ranked
 * cards' "show the math". */
const detailHtml = r => {
  const scored = scoreById.get(r.id);

  const links = [];
  if (r.url) links.push(dRow(`Website: ${srcLink(r.url, r.url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, ''))}`));
  if (r.instagram) links.push(dRow(`Instagram: ${srcLink(r.instagram, '@' + (r.instagram.match(/instagram\.com\/([^/?]+)/)?.[1] ?? 'profile'))}`));

  const status = [];
  status.push(dRow(`${esc(STATUS_LABEL[r.status] ?? 'Open')}${r.statusDate ? ` since ${esc(shortDate(r.statusDate))}` : ''}${
    r.statusChecked ? ` · last checked ${esc(shortDate(r.statusChecked))}` : ''}${
    r.statusSource ? ` · ${srcLink(r.statusSource)}` : ''}`));
  if (r.statusNote) status.push(dRow(esc(r.statusNote)));

  const locs = (r.locations ?? []).map(l =>
    dRow(`${esc(l.address ?? l.neighborhood ?? '')}${l.neighborhood && l.address ? ` <span class="dd-dim">(${esc(l.neighborhood)})</span>` : ''}`));
  if (locs.length && (r.locationsVerified || r.locationsSource)) {
    locs.push(dRow(`<span class="dd-dim">verified ${esc(r.locationsVerified ?? '?')}${
      r.locationsSource ? ` against ${srcLink(r.locationsSource, 'its own site')}` : ''}</span>`));
  }

  const facts = [];
  if (r.style) facts.push(dRow(`Style: ${esc(r.style)}${r.styleGroup ? ` <span class="dd-dim">(${esc(r.styleGroup)})</span>` : ''}`));
  if (r.opened) facts.push(dRow(`Opened: ${esc(String(r.opened))}`));
  if (r.priceIndex) facts.push(dRow(`Price: ${'$'.repeat(r.priceIndex)}`));
  if (r.lastVerified) facts.push(dRow(`Data last verified: ${esc(shortDate(r.lastVerified))}`));
  if (r.crowd) facts.push(dRow(`<span class="dd-dim">Crowd context (never scored): ${r.crowd.rating.toFixed(1)}★ across ~${r.crowd.reviews.toLocaleString('en-US')} reviews</span>`));

  const graded = ['craft', 'distinctiveness', 'critical']
    .filter(k => r.factors?.[k])
    .map(k => {
      const f = r.factors[k];
      return dRow(`${FACTOR_NAME[k]}: <b>${f.value.toFixed(1)}</b> <span class="dd-dim">set ${
        f.setBy === 'agent' ? 'by the research agent' : 'editorially'}${f.date ? ` ${esc(shortDate(f.date))}` : ''}${
        f.source ? ` from ${srcLink(f.source, 'coverage')}` : ''}</span>${
        f.note ? `<div class="dd-note">${esc(f.note)}</div>` : ''}`);
    });

  const computed = scored ? [dRow(
    `SLICE <b>${scored.score.toFixed(1)}</b> — ` +
    Object.entries(scored.factorScores).map(([k, v]) => `${k} ${v.toFixed(1)}`).join(' · ') +
    ` · friction −${scored.penaltyApplied.toFixed(1)} · decay −${(scored.stalenessDecay * 100).toFixed(1)}%`
  )] : [dRow('<span class="dd-dim">Not yet rated — no score until the rating rotation grounds one in published coverage.</span>')];

  const attrs = Object.keys(r.attributes ?? {}).filter(k => r.attributes[k]).map(k => {
    const reg = dataset.attributeRegistry[k];
    return `<span class="chip">${esc(reg?.label ?? k)}${reg?.frictionCost ? ` <span class="dd-dim">−${reg.frictionCost.toFixed(1)}</span>` : ''}</span>`;
  });

  const mentions = [...(r.mentions ?? [])]
    .sort((a, b) => Date.parse(b.date) - Date.parse(a.date))
    .slice(0, 6)
    .map(m => dRow(`${srcLink(m.url, m.title)} <span class="dd-dim">${esc(m.source)} · ${esc(shortDate(m.date))}</span>`));

  return `<div class="dd">
    ${dBlock('Links', links)}
    ${dBlock('Status', status)}
    ${dBlock('Locations', locs)}
    ${dBlock('On file', facts)}
    ${dBlock('Graded factors', graded)}
    ${dBlock('Score', r.status === 'open' ? computed : [])}
    ${attrs.length ? `<div class="dd-block"><div class="dd-label">Attributes</div><div class="dd-chips">${attrs.join('')}</div></div>` : ''}
    ${dBlock('Press on file', mentions)}
  </div>`;
};

const dirRow = r => {
  const scored = scoreById.get(r.id);
  const addr = (r.locations ?? []).map(l => l.address);
  const attrs = Object.keys(r.attributes ?? {}).filter(k => r.attributes[k])
    .map(k => dataset.attributeRegistry[k]?.label ?? k);
  return `
        <tr class="dir-row st-${esc(r.status ?? 'open')}" data-id="${esc(r.id)}">
          <td class="dir-name">
            <button class="dir-toggle" aria-expanded="false" aria-controls="dd-${esc(r.id)}"
              title="Show everything on file">▸</button>
            ${nameLink(r)}
            ${scored && scored.rank <= 10 ? `<span class="dir-rank">#${scored.rank}</span>` : ''}</td>
          <td class="dir-where">${esc(locationLabel(r))}${addr.length ? `
            <div class="dir-addr">${addr.slice(0, 3).map(esc).join('<br>')}${addr.length > 3 ? `
            <details class="dir-more"><summary>+ ${addr.length - 3} more</summary>${addr.slice(3).map(esc).join('<br>')}</details>` : ''}</div>` : ''}</td>
          <td class="dir-style">${esc(r.style ?? '')}</td>
          <td class="dir-attrs">${attrs.map(a => `<span class="chip">${esc(a)}</span>`).join('')}</td>
          <td class="num dir-score">${scored ? scored.score.toFixed(1) : '—'}</td>
          <td class="dir-status">${esc(STATUS_LABEL[r.status] ?? 'Open')}${
            r.status === 'closed' && r.statusDate ? ` ${new Date(r.statusDate).getUTCFullYear()}` : ''}</td>
        </tr>
        <tr class="dir-detail" id="dd-${esc(r.id)}" hidden><td colspan="6">${detailHtml(r)}</td></tr>`;
};

const directorySection = `
<section class="section" id="directory">
  <div class="wrap">
    <div class="eyebrow">The directory</div>
    <h2 class="sec-h">Every pizzeria on file</h2>
    <p class="lede" style="margin-top:14px">
      The full inventory behind the ranking: ${dataset.restaurants.length} entries, maintained by the
      daily research pass. Rated entries carry their SLICE score, so this is also where ranks 11
      and up live. Click a row for everything on file about that pizzeria — and to find it on
      the map. Entries without a score have not been rated yet.
    </p>
    ${(() => {
      /* Coverage, stated honestly: what is verified, what is known-of and
       * pending, and what is excluded on purpose. The pending queue is seeded
       * from public registries (King County food-business permits, and
       * OpenStreetMap), so "complete" is checkable rather than asserted. */
      if (!candidates) return '';
      const cov = coverageStats(candidates);
      return `
    <div class="stamp" style="margin-top:18px">
      <span>${dataset.restaurants.length} <b>verified entries</b></span>
      ${cov.pending ? `<span>${cov.pending} <b>candidates pending verification</b></span>` : ''}
      ${cov.chains ? `<span>${cov.chains} <b>national-chain spots excluded</b></span>` : ''}
    </div>
    <p class="note" style="margin-top:10px; max-width:78ch">
      Inclusion rule: a pizza-forward place with a location inside Seattle city limits.
      National chains (Domino's, Pizza Hut, MOD, and the like) are excluded by policy — this is
      an index of Seattle's own pizzerias. The pending queue is seeded from King County
      food-business permit data; a candidate is listed only after the research pass verifies
      it is real, open, and actually about pizza.
    </p>`;
    })()}
    <div class="dir-layout">
      <div class="dir-list">
        <div class="dir-scroll">
          <table class="dir-table">
            <thead><tr>
              <th>Pizzeria</th><th>Where</th><th>Style</th><th>Notes</th>
              <th class="num">SLICE</th><th>Status</th>
            </tr></thead>
            <tbody id="dir-body">${directoryEntries.map(dirRow).join('')}</tbody>
          </table>
        </div>
      </div>
      <div class="dir-rail">
        <div id="map" class="dir-map" aria-label="Map of Seattle pizzerias"></div>
        <p class="note dir-map-note">Seattle locations only — red for the top ten, brown for the
        rest of the field, green for places opening soon. Chains' branches outside the city are
        listed in the table, not mapped. Tiles &copy; OpenStreetMap contributors.</p>
      </div>
    </div>
  </div>
</section>
`;

  return directorySection;
}
