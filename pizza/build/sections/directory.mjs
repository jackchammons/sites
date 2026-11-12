import { esc, nameLink, shortDate, srcLink, srcLinks } from '../html.mjs';
import { locationLabel } from '../../src/locations.js';
import { isLaunchRating } from '../../src/slice.js';
import { FACT_SOURCE_KEY } from '../../src/schema.js';
import { hasCandidates } from './candidates.mjs';

export function directorySection(ctx) {
  const { dataset, allScored } = ctx;
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

/* One block of the expanded record: a label and its rows. Every record has
 * the same blocks and the same rows in the same order, so two pizzerias can be
 * read against each other; a field with nothing on file says so in its place.
 * A missing key and a null are the same thing here. */
const NONE = '<span class="dd-dim">not on file</span>';
const dBlock = (label, rows) =>
  `<div class="dd-block"><div class="dd-label">${label}</div>${rows.length ? rows.join('') : dRow(NONE)}</div>`;
const dRow = html => `<div class="dd-row">${html}</div>`;
/* A labelled field. `html` is already escaped; null, undefined and '' all
 * print the placeholder. */
const dField = (label, html) => `<div class="dd-row dd-kv"><span class="dd-k">${label}</span><span>${html || NONE}</span></div>`;
const text = v => v == null || v === '' ? '' : esc(String(v));

const FACTOR_NAME = { craft: 'Craft', distinctiveness: 'Distinctiveness', critical: 'Critical base' };

/* Everything the dataset stores about one entry, rendered at build time into
 * a hidden row the reader can expand — the directory's version of the ranked
 * cards' "show the math". */
const detailHtml = r => {
  const scored = scoreById.get(r.id);

  /* The descriptive record: each fact, and beside it the page that states it
   * when the facts task filed one (FACT_SOURCE_KEY names where that is kept). */
  const fact = (label, key, shown) => {
    const source = r[FACT_SOURCE_KEY[key]];
    return dField(label, shown ? `${shown}${source ? ` · ${srcLink(source)}` : ''}` : '');
  };
  const facts = [
    fact('Style', 'style', text(r.style)),
    fact('Style group', 'styleGroup', text(r.styleGroup)),
    fact('Known for', 'signature', text(r.signature)),
    fact('Opened', 'opened', r.opened ? esc(String(r.opened)) : ''),
    fact('Price', 'priceIndex', r.priceIndex ? '$'.repeat(r.priceIndex) : '')
  ];

  const links = [
    dField('Website', r.url ? srcLink(r.url, r.url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')) : ''),
    dField('Instagram', r.instagram ? srcLink(r.instagram, '@' + (r.instagram.match(/instagram\.com\/([^/?]+)/)?.[1] ?? 'profile')) : '')
  ];

  const status = [];
  // statusDate is the event date as the source reports it; statusDetected is
  // when the pass recorded it. Only the former is ever printed as "since".
  status.push(dRow(`${esc(STATUS_LABEL[r.status] ?? 'Open')}${
    r.statusDate ? ` since ${esc(shortDate(r.statusDate))}` :
    r.status !== 'open' && r.statusDetected ? ` <span class="dd-dim">(reported ${esc(shortDate(r.statusDetected))}; date not stated by the source)</span>` : ''}${
    r.statusChecked ? ` · last checked ${esc(shortDate(r.statusChecked))}` : ''}`));
  status.push(dField('Source', r.statusSource ? srcLink(r.statusSource) : ''));
  if (r.statusNote) status.push(dRow(esc(r.statusNote)));

  const locs = (r.locations ?? []).map(l =>
    dRow(`${esc(l.address ?? l.neighborhood ?? '')}${l.neighborhood && l.address ? ` <span class="dd-dim">(${esc(l.neighborhood)})</span>` : ''}`));
  if (locs.length) {
    locs.push(dRow(`<span class="dd-dim">${r.locationsVerified
      ? `verified ${esc(shortDate(r.locationsVerified))}${r.locationsSource ? ` against ${srcLink(r.locationsSource)}` : ''}`
      : "not yet verified against the pizzeria's own site"}</span>`));
  }

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
      ? `set by the research agent${f.date ? ` ${esc(shortDate(f.date))}` : ''}${from ? ` from ${from}` : '; sources not on file'}`
      : '';
    return {
      line: set || (from ? `sources on file: ${from}` : 'sources not on file'),
      all: set ? `All three ${set}` : from ? `Sources on file for all three: ${from}` : 'Sources for all three: not on file',
      note: f.note ?? ''
    };
  };
  const present = ['craft', 'distinctiveness', 'critical'].filter(k => r.factors?.[k]);
  const provs = present.map(k => provenanceOf(r.factors[k]));
  const shared = present.length > 1 && provs.every(p => p.line === provs[0].line && p.note === provs[0].note);
  const noteHtml = p => p.note ? `<div class="dd-note">${esc(p.note)}</div>` : '';
  /* An entry with no rating says so, and says where the rating task stands
   * with it: the Candidates section lists it with the day it is due again. */
  const graded = !present.length
    ? [dRow(`${NONE}<div class="dd-note">${
        r.status === 'closed' ? 'Closed before a rating pass reached it.'
        : r.status === 'opening' ? 'Rated once it has opened and criticism of it has been published.'
        : r.ratingAttempted ? `A rating pass looked on ${esc(shortDate(r.ratingAttempted))} and found no published criticism to rate from.${r.ratingNote ? ` ${esc(r.ratingNote)}` : ''}`
        : 'No rating pass has looked at it yet.'}${
        r.status !== 'closed' ? ' <a href="#unranked">What happens next</a>' : ''}</div>`)]
    : shared
    ? [dRow(`${present.map(k => `${FACTOR_NAME[k]}: <b>${r.factors[k].value.toFixed(1)}</b>`).join(' <span class="dd-dim">·</span> ')}`),
       dRow(`<span class="dd-dim">${provs[0].all}</span>${noteHtml(provs[0])}`)]
    : present.map((k, i) => dRow(`${FACTOR_NAME[k]}: <b>${r.factors[k].value.toFixed(1)}</b> <span class="dd-dim">${provs[i].line}</span>${noteHtml(provs[i])}`));

  /* The score is computed for every rated entry, open or not; only open ones
   * compete, and the record says which this is. */
  const computed = scored ? [dRow(
    `SLICE <b>${scored.score.toFixed(1)}</b> — ` +
    Object.entries(scored.factorScores).map(([k, v]) => {
      const use = k === 'reputation' ? scored.reputationDetail.use : 'counted';
      return `${k} ${use === 'unmeasured' ? 'unmeasured' : v.toFixed(1)}${use === 'lowers' ? ' (not counted: below the other four)' : ''}`;
    }).join(' · ') +
    ` · friction −${scored.penaltyApplied.toFixed(1)} · decay −${(scored.stalenessDecay * 100).toFixed(1)}%${
      scored.verified ? ` (last ${scored.verified.source} ${esc(shortDate(scored.verified.date))})` : ''}${
      (r.status ?? 'open') === 'open' ? '' : '<div class="dd-note">Held out of the ranking: only open pizzerias compete.</div>'}`
  )] : [dRow(`${NONE}<div class="dd-note">No score until the entry has a rating.</div>`)];

  const attrs = Object.keys(r.attributes ?? {}).filter(k => r.attributes[k]).map(k => {
    const reg = dataset.attributeRegistry[k];
    return `<span class="chip">${esc(reg?.label ?? k)}${reg?.frictionCost ? ` <span class="dd-dim">−${reg.frictionCost.toFixed(1)}</span>` : ''}</span>`;
  });

  const mentions = [...(r.mentions ?? [])]
    .sort((a, b) => Date.parse(b.date) - Date.parse(a.date))
    .slice(0, 6)
    .map(m => dRow(`${srcLink(m.url, m.title)} <span class="dd-dim">${esc(m.source)} · ${esc(shortDate(m.date))}</span>`));

  return `<div class="dd">
    ${dBlock('On file', facts)}
    ${dBlock('Links', links)}
    ${dBlock('Status', status)}
    ${dBlock('Locations', locs)}
    ${dBlock('Rating', graded)}
    ${dBlock('Score', computed)}
    ${dBlock('Attributes', attrs.length ? [`<div class="dd-chips">${attrs.join('')}</div>`] : [])}
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
    <p class="note" style="margin-top:10px; max-width:110ch">
      Inclusion rule: a pizza-forward place with a location inside Seattle city limits.
      National chains (Domino's, Pizza Hut, MOD, and the like) are excluded by policy — this is
      an index of Seattle's own pizzerias.${hasCandidates(ctx) ? `
      The entries here that have no score yet, and the places the index knows of that are not
      listed, are under <a href="#candidates">Candidates</a>, each with the reason.` : ''}
    </p>
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
