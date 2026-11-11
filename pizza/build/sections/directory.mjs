import { esc, nameLink, shortDate, srcLink, srcLinks } from '../html.mjs';
import { locationLabel } from '../../src/locations.js';
import { coverageStats } from '../../src/census.js';
import { isLaunchRating } from '../../src/slice.js';

export function directorySection(ctx) {
  const { dataset, allScored, candidates } = ctx;
/* ---- Directory ---- */
const STATUS_LABEL = { open: 'Open', opening: 'Opening soon', closed: 'Closed' };
const scoreById = new Map(allScored.map(r => [r.id, r]));

/* Open entries first, then openings, then closures. Within each, scored
 * entries follow their published rank, so the table repeats the ranking's own
 * order, tie-break included, instead of deriving a second one. */
const directoryEntries = [...dataset.restaurants].sort((a, b) => {
  const orderOf = r => r.status === 'closed' ? 2 : r.status === 'opening' ? 1 : 0;
  if (orderOf(a) !== orderOf(b)) return orderOf(a) - orderOf(b);
  const ra = scoreById.get(a.id)?.rank ?? Infinity;
  const rb = scoreById.get(b.id)?.rank ?? Infinity;
  return ra !== rb ? ra - rb : a.name.localeCompare(b.name, 'en');
});

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
  // statusDate is the event date as the source reports it; statusDetected is
  // when the pass recorded it. Only the former is ever printed as "since".
  status.push(dRow(`${esc(STATUS_LABEL[r.status] ?? 'Open')}${
    r.statusDate ? ` since ${esc(shortDate(r.statusDate))}` :
    r.status !== 'open' && r.statusDetected ? ` <span class="dd-dim">(reported ${esc(shortDate(r.statusDetected))}; date not stated by the source)</span>` : ''}${
    r.statusChecked ? ` · last checked ${esc(shortDate(r.statusChecked))}` : ''}${
    r.statusSource ? ` · ${srcLink(r.statusSource)}` : ''}`));
  if (r.statusNote) status.push(dRow(esc(r.statusNote)));

  const locs = (r.locations ?? []).map(l =>
    dRow(`${esc(l.address ?? l.neighborhood ?? '')}${l.neighborhood && l.address ? ` <span class="dd-dim">(${esc(l.neighborhood)})</span>` : ''}`));
  if (locs.length && (r.locationsVerified || r.locationsSource)) {
    locs.push(dRow(`<span class="dd-dim">verified ${esc(r.locationsVerified ?? '?')}${
      r.locationsSource ? ` against ${srcLink(r.locationsSource)}` : ''}</span>`));
  }

  const facts = [];
  if (r.style) facts.push(dRow(`Style: ${esc(r.style)}${r.styleGroup ? ` <span class="dd-dim">(${esc(r.styleGroup)})</span>` : ''}`));
  if (r.opened) facts.push(dRow(`Opened: ${esc(String(r.opened))}${r.openedSource ? ` · ${srcLink(r.openedSource)}` : ''}`));
  if (r.priceIndex) facts.push(dRow(`Price: ${'$'.repeat(r.priceIndex)}${r.priceSource ? ` · ${srcLink(r.priceSource)}` : ''}`));

  /* The three graded factors usually share one provenance (one agent pass, one
   * note, the same sources), so it is printed once with the three values on a
   * line, instead of the same paragraph three times. Factors whose provenance
   * differs fall back to a row each.
   *
   * A date and an author are printed only for a rating the agent set: there
   * the date is the day the rating was read from the sources beside it. A
   * launch rating shows the sources on file for it, if there are any, and
   * nothing about how or when its values were arrived at. */
  const agentSet = !isLaunchRating(r);
  const provenanceOf = f => {
    const srcs = f.sources?.length ? f.sources : f.source ? [f.source] : [];
    const from = srcs.length ? srcLinks(srcs) : '';
    const set = agentSet
      ? `set by the research agent${f.date ? ` ${esc(shortDate(f.date))}` : ''}${from ? ` from ${from}` : ''}`
      : '';
    return {
      line: set || (from && `sources on file: ${from}`),
      all: set ? `All three ${set}` : from && `Sources on file for all three: ${from}`,
      note: f.note ?? ''
    };
  };
  const present = ['craft', 'distinctiveness', 'critical'].filter(k => r.factors?.[k]);
  const provs = present.map(k => provenanceOf(r.factors[k]));
  const shared = present.length > 1 && provs.every(p => p.line === provs[0].line && p.note === provs[0].note);
  const noteHtml = p => p.note ? `<div class="dd-note">${esc(p.note)}</div>` : '';
  const graded = shared
    ? [dRow(`${present.map(k => `${FACTOR_NAME[k]}: <b>${r.factors[k].value.toFixed(1)}</b>`).join(' <span class="dd-dim">·</span> ')}`),
       ...(provs[0].all || provs[0].note
         ? [dRow(`${provs[0].all ? `<span class="dd-dim">${provs[0].all}</span>` : ''}${noteHtml(provs[0])}`)] : [])]
    : present.map((k, i) => dRow(`${FACTOR_NAME[k]}: <b>${r.factors[k].value.toFixed(1)}</b>${
        provs[i].line ? ` <span class="dd-dim">${provs[i].line}</span>` : ''}${noteHtml(provs[i])}`));

  const computed = scored ? [dRow(
    `SLICE <b>${scored.score.toFixed(1)}</b> — ` +
    Object.entries(scored.factorScores).map(([k, v]) => {
      const use = k === 'reputation' ? scored.reputationDetail.use : 'counted';
      return `${k} ${use === 'unmeasured' ? 'unmeasured' : v.toFixed(1)}${use === 'lowers' ? ' (not counted: below the other four)' : ''}`;
    }).join(' · ') +
    ` · friction −${scored.penaltyApplied.toFixed(1)} · decay −${(scored.stalenessDecay * 100).toFixed(1)}%${
      scored.verified ? ` (last ${scored.verified.source} ${esc(shortDate(scored.verified.date))})` : ''}`
  )] : [dRow(`<span class="dd-dim">Not yet rated — no score until the rating rotation grounds one in published coverage.${
      r.ratingAttempted ? ` Last looked ${esc(shortDate(r.ratingAttempted))}${r.ratingNote ? `: ${esc(r.ratingNote)}` : ''}` : ''}</span>`)];

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
          <th scope="row" class="dir-name">
            <button class="dir-toggle" aria-expanded="false" aria-controls="dd-${esc(r.id)}"
              aria-label="Show everything on file for ${esc(r.name)}" title="Show everything on file">▸</button>
            ${nameLink(r)}
            ${scored && (r.status ?? 'open') === 'open' ? `<span class="dir-rank${scored.rank <= 10 ? ' top' : ''}">#${scored.rank}</span>` : ''}${
              r.status && r.status !== 'open' ? `<span class="dir-st">${esc(STATUS_LABEL[r.status])}</span>` : ''}</th>
          <td class="dir-where">${esc(locationLabel(r))}${addr.length ? `
            <div class="dir-addr">${addr.slice(0, 3).map(esc).join('<br>')}${addr.length > 3 ? `
            <details class="dir-more"><summary>+ ${addr.length - 3} more</summary>${addr.slice(3).map(esc).join('<br>')}</details>` : ''}</div>` : ''}</td>
          <td class="dir-style">${esc(r.style ?? '')}</td>
          <td class="dir-attrs">${attrs.map(a => `<span class="chip">${esc(a)}</span>`).join('')}</td>
          <td class="num dir-score">${scored ? scored.score.toFixed(1) : '—'}</td>
          <td class="dir-status">${esc(STATUS_LABEL[r.status] ?? 'Open')}${
            r.status === 'closed' && r.statusDate ? ` ${r.statusDate.slice(0, 4)}` : ''}</td>
        </tr>
        <tr class="dir-detail" id="dd-${esc(r.id)}" hidden><td colspan="6">${detailHtml(r)}</td></tr>`;
};

/* The map rail is rendered hidden: app.js reveals it once it has points to
 * plot, so a reader without JavaScript gets the table at full width rather
 * than an empty box and a legend for a map that is not there. The map has a
 * wrapper of its own because under 1100px the wrapper is pinned while the
 * list scrolls; the legend sits outside it, so it is never pinned too. */
const directorySection = `
<section class="section" id="directory">
  <div class="wrap">
    <div class="eyebrow">The directory</div>
    <h2 class="sec-h">Every pizzeria on file</h2>
    <p class="lede" style="margin-top:14px">
      The full inventory behind the ranking: ${dataset.restaurants.length} entries, maintained by the
      daily research pass. Rated, open entries are listed in rank order with their SLICE score,
      so this is also where ranks 11 and up live. Click a row for everything on file about that pizzeria — and to find it on
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
    <p class="note" style="margin-top:10px; max-width:110ch">
      Inclusion rule: a pizza-forward place with a location inside Seattle city limits.
      National chains (Domino's, Pizza Hut, MOD, and the like) are excluded by policy — this is
      an index of Seattle's own pizzerias. The pending queue is drawn from King County
      food-business permit data; a candidate is listed only after the research pass verifies
      it is real, open, and actually about pizza.
    </p>`;
    })()}
    <div class="dir-layout">
      <div class="dir-list">
        <div class="dir-scroll">
          <table class="dir-table" aria-label="Every pizzeria on file">
            <thead><tr>
              <th scope="col">Pizzeria</th><th scope="col">Where</th><th scope="col">Style</th><th scope="col">Notes</th>
              <th scope="col" class="num">SLICE</th><th scope="col">Status</th>
            </tr></thead>
            <tbody id="dir-body">${directoryEntries.map(dirRow).join('')}</tbody>
          </table>
        </div>
      </div>
      <div class="dir-rail" id="map-rail" hidden>
        <div class="dir-pin">
          <div id="map" class="dir-map" role="region" aria-label="Map of Seattle pizzerias"></div>
        </div>
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
