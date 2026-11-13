/* The Directory: every place the index knows of, in one list, by category.
 *
 * The list is the registry's (src/registry.js): the pizzerias on file and the
 * places known only from the candidates queue, each in exactly one category.
 * A category is a <details> element, so it opens and closes without any
 * script; the ranked one is open and the rest are closed. app.js adds the
 * search field, the category toggles and the map, and keeps the three in
 * step.
 *
 * Every count the section prints is the length of a list it renders, and
 * every "what happens next" is a number imported from the module the
 * worklists are drawn with, so the page states the rule the automation
 * follows. Everything from the two data files is third-party text and is
 * escaped. */
import { esc, nameLink, shortDate, srcLink, srcLinks } from '../html.mjs';
import { locationLabel } from '../../src/locations.js';
import { isLaunchRating } from '../../src/slice.js';
import { FACT_SOURCE_KEY } from '../../src/schema.js';
import { PER_PASS, RETRY_DAYS } from '../../src/rules.js';
import { INSPECTION_CUTOFF_MONTHS, REOPENING_VERDICTS, tidyPossessive } from '../../src/census.js';
import { isSeattleAddress } from '../../src/bounds.js';
import { CATEGORIES, DEFAULT_OPEN, mapPoints } from '../../src/registry.js';

/* What each category is called, and its explanation in a line: the line is
 * in the category's header, so a closed category still says what it holds. */
export const CATEGORY = {
  ranked:       { title: 'Ranked', rule: 'Open and rated, in rank order.' },
  unrated:      { title: 'Unrated', rule: 'Open and on file, with no rating yet.' },
  opening:      { title: 'Not open yet', rule: 'On file ahead of its opening.' },
  closed:       { title: 'Closed', rule: 'Shut, and held out of the ranking.' },
  pending:      { title: 'Waiting for a census pass', rule: 'In the queue, not yet checked.' },
  chain:        { title: 'National chain', rule: 'Left out by policy.' },
  'not-pizza':  { title: 'Not pizza-forward', rule: 'Serves pizza, and is not a pizzeria.' },
  unverifiable: { title: 'Could not be verified', rule: 'A permit with no pizzeria found behind it.' },
  'set-aside':  { title: 'Set aside', rule: 'No reason on file.' }
};
/* The categories whose places are not on file: they come from the candidates
 * queue alone, and are listed under their own heading. */
const NOT_ON_FILE = ['pending', 'chain', 'not-pizza', 'unverifiable', 'set-aside'];

const STATUS_LABEL = { open: 'Open', opening: 'Opening soon', closed: 'Closed' };
const FACTOR_NAME = { craft: 'Craft', distinctiveness: 'Distinctiveness', critical: 'Critical base' };
const count = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;

/* ---------- an entry's expanded record ---------- */

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
/* Text the search reads that is not in the row itself: app.js collects every
 * .q inside a record or a note. The row's own cells are read as they stand,
 * so nothing is written twice to be found. */
const q = html => html ? `<span class="q">${html}</span>` : '';

/* Everything the dataset stores about one entry, rendered at build time into
 * a hidden row the reader can expand — the directory's version of the ranked
 * cards' "show the math". */
const detailHtml = (r, { scoreById, dataset }) => {
  const scored = scoreById.get(r.id);

  /* The descriptive record: each fact, and beside it the page that states it
   * when the facts task filed one (FACT_SOURCE_KEY names where that is kept). */
  const fact = (label, key, shown) => {
    const source = r[FACT_SOURCE_KEY[key]];
    return dField(label, shown ? `${shown}${source ? ` · ${srcLink(source)}` : ''}` : '');
  };
  const facts = [
    fact('Style', 'style', text(r.style)),
    fact('Style group', 'styleGroup', q(text(r.styleGroup))),
    fact('Known for', 'signature', q(text(r.signature))),
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
    dRow(`${esc(l.address ?? l.neighborhood ?? '')}${l.neighborhood && l.address ? ` <span class="dd-dim q">(${esc(l.neighborhood)})</span>` : ''}`));
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
   * with it; its category's header explains what happens next. */
  const graded = !present.length
    ? [dRow(`${NONE}<div class="dd-note">${
        r.status === 'closed' ? 'Closed before a rating pass reached it.'
        : r.status === 'opening' ? 'Rated once it has opened and criticism of it has been published.'
        : r.ratingAttempted ? `A rating pass looked on ${esc(shortDate(r.ratingAttempted))} and found no published criticism to rate from.${r.ratingNote ? ` ${esc(r.ratingNote)}` : ''}`
        : 'No rating pass has looked at it yet.'}${
        r.status !== 'closed' ? ` <a href="#cat-${r.status === 'opening' ? 'opening' : 'unrated'}">What happens next</a>` : ''}</div>`)]
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

/* ---------- rows ---------- */

/* Why an entry with no rating has none, in a line under its row. An attempt
 * that found nothing rests the entry RETRY_DAYS.rating days; a rest that has
 * already run out is printed as "since" its last day, because the entry is
 * back in the draw and has been from then. */
const whyHtml = (p, today) => {
  const r = p.entry;
  if (p.category === 'opening') {
    return `Not open yet. Reported by ${r.statusSource ? srcLink(r.statusSource) : NONE}.`;
  }
  if (p.category !== 'unrated') return '';
  if (!p.dates.looked) {
    const press = r.mentions?.length ?? 0;
    return `Waiting for a rating pass. ${press ? `${count(press, 'story', 'stories')} on file` : 'No press on file'}.`;
  }
  return `A rating pass looked on ${esc(shortDate(p.dates.looked))} and found no published criticism. Eligible again ${
    p.dates.eligible <= today ? 'since ' : ''}${esc(shortDate(p.dates.eligible))}.${
    r.ratingNote ? ` <span class="dir-why-note">${esc(r.ratingNote)}</span>` : ''}`;
};

const entryRow = (p, env) => {
  const r = p.entry;
  const scored = env.scoreById.get(r.id);
  const addr = (r.locations ?? []).map(l => l.address);
  const attrs = Object.keys(r.attributes ?? {}).filter(k => r.attributes[k])
    .map(k => env.dataset.attributeRegistry[k]?.label ?? k);
  const why = whyHtml(p, env.today);
  return `
        <tr class="dir-row st-${esc(r.status ?? 'open')}${why ? ' has-why' : ''}" id="${esc(p.anchor)}" data-id="${esc(r.id)}">
          <th scope="row" class="dir-name">
            <button class="dir-toggle" aria-expanded="false" aria-controls="dd-${esc(r.id)}"
              aria-label="Show everything on file for ${esc(r.name)}" title="Show everything on file">▸</button>
            ${nameLink(r)}
            ${scored && (r.status ?? 'open') === 'open' ? `<span class="dir-rank${scored.rank <= 10 ? ' top' : ''}">#${scored.rank}</span>` : ''}${
              r.status && r.status !== 'open' ? `<span class="dir-st">${esc(STATUS_LABEL[r.status])}</span>` : ''}</th>
          <td class="dir-where">${esc(locationLabel(r) ?? '')}${addr.length ? `
            <div class="dir-addr">${addr.slice(0, 3).map(esc).join('<br>')}${addr.length > 3 ? `
            <details class="dir-more"><summary>+ ${addr.length - 3} more</summary>${addr.slice(3).map(esc).join('<br>')}</details>` : ''}</div>` : ''}</td>
          <td class="dir-style">${esc(r.style ?? '')}</td>
          <td class="dir-attrs">${attrs.map(a => `<span class="chip">${esc(a)}</span>`).join('')}</td>
          <td class="num dir-score">${scored ? scored.score.toFixed(1) : '—'}</td>
          <td class="dir-status">${esc(STATUS_LABEL[r.status] ?? 'Open')}${
            r.status === 'closed' && r.statusDate ? ` ${r.statusDate.slice(0, 4)}` : ''}</td>
        </tr>${why ? `
        <tr class="dir-why"><td colspan="6">${why}</td></tr>` : ''}
        <tr class="dir-detail" id="dd-${esc(r.id)}" hidden><td colspan="6">${detailHtml(r, env)}</td></tr>`;
};

const entryTable = (label, places, env) => `
      <div class="dir-scroll">
        <table class="dir-table" aria-label="${label}">
          <thead><tr>
            <th scope="col">Pizzeria</th><th scope="col">Where</th><th scope="col">Style</th><th scope="col">Notes</th>
            <th scope="col" class="num">SLICE</th><th scope="col">Status</th>
          </tr></thead>
          <tbody>${places.map(p => entryRow(p, env)).join('')}
          </tbody>
        </table>
      </div>`;

/* ---------- candidates ---------- */

const CQ_NONE = '<span class="cq-dim">not on file</span>';
const day = iso => iso ? esc(shortDate(iso)) : CQ_NONE;
const dayOf = v => typeof v === 'string' && Number.isFinite(Date.parse(v)) ? v.slice(0, 10) : null;
/* 'permit' when a register seeded the candidate, 'research' when a research
 * pass filed it as a place that serves pizza and is not a pizzeria
 * (candidateOrigin in census.js, carried on its standing). */
const origin = p => p.at.origin ?? 'permit';
/* A candidate's name is the register's spelling, or the one a research pass
 * filed it under, and nothing on file says where it lives on the web, so it
 * is text and never a link. Names stored before the seed script stopped
 * writing "Soprano'S" are tidied here; the stored name is the key a census
 * verdict answers to and stays. */
const candidateCell = p => {
  const c = p.candidate;
  const where = [c.neighborhood, c.address].filter(Boolean).map(esc).join(' · ');
  return `<th scope="row">${esc(tidyPossessive(c.name))}<span class="cq-sub">${where || 'address not on file'}</span></th>`;
};
/* Where the index knows the place from. A permit comes with the register's
 * last inspection of it; a place a research pass filed has no permit on file
 * and an OpenStreetMap lead has none either, so neither has a date to print. */
const SOURCE_LABEL = { 'kc-health': 'Food permit', osm: 'OpenStreetMap', research: 'Research pass' };
const fromCell = p => {
  const sources = p.candidate.sources ?? [];
  const labels = [...new Set(sources.map(s => SOURCE_LABEL[s]).filter(Boolean))];
  const permit = sources.includes('kc-health');
  return `<td class="cq-from">${labels.length ? labels.join(', ') : CQ_NONE}${
    p.dates.inspected ? ` <span class="cq-when">inspected ${esc(shortDate(p.dates.inspected)).replace(/ /g, '&nbsp;')}</span>`
    : permit ? ' <span class="cq-when">no inspection on file</span>' : ''}</td>`;
};
const knownOnlyFrom = p => origin(p) === 'research' ? 'a research pass'
  : (p.candidate.sources ?? []).includes('kc-health') ? 'a food permit'
  : (p.candidate.sources ?? []).includes('osm') ? 'OpenStreetMap' : 'the candidates queue';

/* What each verdict means in a sentence, and how to say "set aside as …" of
 * a candidate that has come back. */
const VERDICT = {
  chain: {
    rule: "A brand with shops across the country. Excluded by policy: this is an index of Seattle's own pizzerias.",
    label: 'Places excluded as national chains', was: 'a national chain'
  },
  'not-pizza': {
    rule: 'Pizza is on the menu but incidental: a grocery counter, a bar, a restaurant that also serves it.',
    label: 'Places set aside as not pizza-forward', was: 'not pizza-forward'
  },
  unverifiable: {
    rule: 'The census pass could not confirm a Seattle pizzeria behind the permit.',
    label: 'Places that could not be verified', was: 'one it could not verify'
  },
  closed: {
    rule: 'The census pass found that it had shut.',
    label: 'Places not on file that a census pass found closed', was: 'closed'
  },
  'set-aside': {
    rule: 'Set aside by an earlier pass, with no reason on file.',
    label: 'Places set aside with no reason on file', was: 'not belonging'
  }
};
/* Whether a verdict is final, said of the places actually listed. The
 * reopening verdicts are the ones a later inspection undoes
 * (REOPENING_VERDICTS in census.js); a chain stays. A place a research pass
 * filed has no permit for the register to inspect, so nothing the register
 * does brings it back: it leaves only by being listed as a pizzeria. */
const finality = (key, places) => {
  if (key === 'set-aside') return '';
  if (!REOPENING_VERDICTS.includes(key)) return ' It does not come back.';
  const research = places.some(p => origin(p) === 'research');
  const permit = places.some(p => origin(p) !== 'research');
  return (permit || !research ? ` ${research ? 'For a place found through a food permit this is not final' : 'Not final'}: it returns to the queue when the register records an inspection dated after the day it was set aside.` : '')
    + (research ? ' A place a research pass filed has no permit on file, so no inspection brings it back: it joins the directory only if a later pass files it as a pizzeria.' : '');
};
const ORDINAL = ['', 'next', '2nd', '3rd'];
const passName = n => n == null ? CQ_NONE : ORDINAL[n] ?? `${n}th`;

/* A candidate that came back carries what the earlier pass found, and the
 * row says why it is here again. */
const pendingRow = p => {
  const was = p.at.previousVerdict;
  return [
    `${candidateCell(p)}${fromCell(p)}<td>${passName(p.at.censusPass)}</td>`,
    was ? `Back in the queue. A census pass set it aside${dayOf(was.resolvedDate) ? ` on ${day(dayOf(was.resolvedDate))}` : ''} as ${
      VERDICT[was.verdict]?.was ?? VERDICT['set-aside'].was}, and the register has recorded an inspection since.${
      was.note ? ` What that pass found: ${q(esc(was.note))}` : ''}` : ''];
};
/* A candidate with no verdict date was settled on its name alone, when the
 * register was read, and no pass has written a note for it. One the register
 * has already inspected again is still listed under its verdict, because the
 * queue takes it back only when the register is next read. A closed place
 * that is not on file says so, since it shares its category with pizzerias
 * that are. */
const setAsideRow = p => {
  const c = p.candidate;
  return [
    `${candidateCell(p)}${fromCell(p)}<td>${
      p.dates.resolved ? day(p.dates.resolved) : '<span class="cq-dim">by name</span>'}</td>`,
    [p.category === 'closed' ? `Not on file: known only from ${knownOnlyFrom(p)}.` : '',
     p.at.inspectedSince ? '<b class="cq-flag">Due back</b> Inspected since it was set aside: it returns to the queue the next time the register is read.' : '',
     c.note ? `${q(esc(c.note))}${c.resolutionSource ? ` <span class="cq-src">${srcLink(c.resolutionSource)}</span>` : ''}` : '']
      .filter(Boolean).join('<br>')];
};

/* A table of candidates. `row` gives [mainCells, noteHtml]; a note is its own
 * full-width row under the candidate, the way an entry's reason sits under
 * its row. The columns serve both kinds of candidate: the place, where the
 * index knows it from, and where it stands. */
const candidateTable = (label, last, places, row) => `
      <div class="cq-scroll">
        <table class="cq-table" aria-label="${label}">
          <thead><tr><th scope="col">Place</th><th scope="col">Known from</th><th scope="col">${last}</th></tr></thead>
          <tbody>${places.map(p => { const [cells, note] = row(p); return `
          <tr class="cq-row${note ? ' has-note' : ''}" id="${esc(p.anchor)}">${cells}</tr>${note ? `
          <tr class="cq-note"><td colspan="3"><div class="cq-note-in">${note}</div></td></tr>` : ''}`; }).join('')}
          </tbody>
        </table>
      </div>`;

/* ---------- the section ---------- */

/* What the map needs, built from the registry like the rows are: one record
 * for each place with a Seattle address that has coordinates. `id` is the
 * place's row, `cat` its category, `rank` a ranked place's rank (its pin's
 * colour is read from it) and `lead` marks a place that is not on file.
 * Popup text is prepared here so the browser formats no date. */
export function mapData(ctx) {
  const rankOf = new Map(ctx.allScored.map(r => [r.id, r.rank]));
  return ctx.registry.places.map(p => {
    const pts = mapPoints(p);
    if (!pts.length) return null;
    const entry = p.entry;
    const outside = entry ? (entry.locations ?? []).filter(l => !isSeattleAddress(l.address)).length : 0;
    const more = entry
      ? (p.category === 'opening' ? 'Opening soon' : p.category === 'closed' ? 'Closed' : '')
      : `${CATEGORY[p.category].title}${p.dates.inspected ? ` · last inspected ${shortDate(p.dates.inspected)}` : ''}`;
    return {
      id: p.anchor, cat: p.category,
      ...(p.category === 'ranked' ? { rank: rankOf.get(p.key) } : {}),
      ...(entry ? {} : { lead: 1 }),
      name: entry ? entry.name : tidyPossessive(p.name),
      ...(entry?.url ? { url: entry.url } : {}),
      pts: pts.map(l => [l.lat, l.lon, l.address ?? '']),
      ...(more ? { more } : {}),
      ...(outside ? { outside } : {})
    };
  }).filter(Boolean);
}

export function directorySection(ctx) {
  const { dataset, allScored, registry, candidatesChecked } = ctx;
  const scoreById = new Map(allScored.map(r => [r.id, r]));
  const today = (ctx.now ?? new Date()).toISOString().slice(0, 10);
  const env = { scoreById, dataset, today };
  const { byCategory, counts } = registry;

  /* Scored entries follow their published rank, so the list repeats the
   * ranking's own order, tie-break included, instead of deriving a second
   * one. An entry with no score follows, by name. */
  const byRank = (a, b) => {
    const ra = scoreById.get(a.key)?.rank ?? Infinity, rb = scoreById.get(b.key)?.rank ?? Infinity;
    return ra !== rb ? ra - rb : a.name.localeCompare(b.name, 'en');
  };
  const ranked = [...byCategory.ranked].sort(byRank);
  const closedEntries = byCategory.closed.filter(p => p.kind === 'entry').sort(byRank);
  const closedOther = byCategory.closed.filter(p => p.kind === 'candidate');
  const candidatePlaces = registry.places.filter(p => p.kind === 'candidate');
  const hasQueue = registry.queued > 0;
  /* Places a research pass filed, and the permits that are only further
   * registrations of pizzerias on file. A research-filed place that was later
   * listed is that entry and nothing more, so it is in neither number. */
  const filed = candidatePlaces.some(p => origin(p) === 'research');
  const dupes = registry.tiedPermits;

  /* Each category's own explanation (why a place is here and what brings it
   * back, with the numbers the worklists run on) and its rows. */
  const body = {
    ranked: () => [`
        The rated, open pizzerias in the order the ranking puts them, each with its SLICE score.
        The first ten are the cards at the top of the page; ranks 11 and up are listed only here.`,
      entryTable('Ranked pizzerias', ranked, env)],
    unrated: () => [`
        A place is rated, and so competes, once a rating pass has read at least one piece of published
        criticism of it: a review, a roundup or a news story. The rating task takes up to ${PER_PASS.rating} entries per
        pass, the ones with press on file first and, among equals, the ones no pass has looked at yet.
        An entry it cannot ground stays unrated and rests ${RETRY_DAYS.rating} days before it is drawn again.
        The ones no rating pass has looked at are listed first; among those with no press on file the
        order a pass draws them in is shuffled. After them come the ones a pass searched for and found
        nothing published to rate from, each with the day it was looked at and the day it is eligible again.`,
      entryTable('Pizzerias on file with no rating yet', byCategory.unrated, env)],
    opening: () => [`
        Rated once it has opened and criticism of it has been published. The rating task never draws
        a place that has not opened.`,
      entryTable('Pizzerias that have not opened yet', byCategory.opening, env)],
    closed: () => [`
        A closed pizzeria leaves the ranking whatever it scored. It keeps its record here, and its
        score if it had one.${closedOther.length ? `
        Listed after ${closedEntries.length ? 'the pizzerias on file' : 'that'} ${closedOther.length === 1 ? 'is a place' : 'are places'} known only from the candidates queue that a census pass found closed.${finality('closed', closedOther)}` : ''}`,
      (closedEntries.length ? entryTable('Closed pizzerias on file', closedEntries, env) : '')
      + (closedOther.length ? candidateTable(VERDICT.closed.label, 'Found closed', closedOther, setAsideRow) : '')],
    pending: () => [`
        Found in the permit register and not yet checked. The census task takes up to ${PER_PASS.census} per pass, in
        this order. A candidate that is real, open and pizza-forward joins the directory; the rest are
        set aside under one of the other categories, with the reason.`,
      candidateTable('Places waiting for a census pass', 'Census pass', byCategory.pending, pendingRow)],
    ...Object.fromEntries(['chain', 'not-pizza', 'unverifiable', 'set-aside'].map(key => [key, () => [`
        ${VERDICT[key].rule}${finality(key, byCategory[key])}`,
      candidateTable(VERDICT[key].label, 'Set aside', byCategory[key], setAsideRow)]]))
  };

  /* Places a category lists that the map cannot plot. The note is for a
   * reader who has the map, so the stylesheet shows it only then. */
  const unmapped = key => {
    const n = byCategory[key].filter(p => !mapPoints(p).length).length;
    if (!n) return '';
    const all = n === counts[key];
    return `
      <p class="dg-unmapped">${all
        ? (n === 1 ? 'It is not on the map yet' : `None of these ${n} is on the map yet`)
        : `${n} of these ${counts[key]} ${n === 1 ? 'is' : 'are'} not on the map yet`}: no Seattle address with coordinates is on file for ${n === 1 ? 'it' : 'them'}.</p>`;
  };

  /* A category's swatch: a dot in its colour, which the stylesheet takes from
   * the palette (src/palette.js) by the category's name. The ranked category
   * has no one colour, since its pins run from blue at the lowest rank
   * through green, yellow and orange to red at #1: its swatch is that ramp,
   * between the two ranks it runs from and to. */
  const swatch = (key, cls) => key === 'ranked'
    ? `<span class="cat-ramp" aria-hidden="true"><i>#${counts.ranked}</i><span></span><i>#1</i></span>`
    : `<i class="${cls}"></i>`;

  /* One category: its header (swatch, name, count, the rule in a line) and
   * its rows. A category with nothing in it is not rendered. */
  const group = key => {
    if (!counts[key]) return '';
    const [about, rows] = body[key]();
    return `
    <details class="dg" id="cat-${key}" data-cat="${key}"${DEFAULT_OPEN.includes(key) ? ' open' : ''}>
      <summary>${swatch(key, 'dg-dot')}<span class="dg-title">${CATEGORY[key].title}</span>
        <span class="dg-n" data-count="${key}">${counts[key]}</span>
        <span class="dg-rule">${CATEGORY[key].rule}</span></summary>
      <div class="dg-body">
      <p class="dg-about">${about}</p>${unmapped(key)}${rows}
      </div>
    </details>`;
  };

  /* The head of the categories that are not on file. It keeps the id the
   * Candidates section had, so a link to it still lands where the candidates
   * are listed. */
  const notOnFile = hasQueue ? `
    <div class="dg-head" id="candidates">
      <h3 class="buzz-head">Not on file</h3>
      <p class="method-p">
        King County's food-permit register lists every kitchen that holds a health permit. A Seattle
        permit whose name mentions pizza or slices, inspected within the last ${INSPECTION_CUTOFF_MONTHS} months, becomes
        a candidate: a lead, not an entry. Places tagged as pizza on OpenStreetMap are added when
        that source answers. The census task checks each one on the open web, up to
        ${PER_PASS.census} per pass. A candidate that is real, open and pizza-forward joins the directory; the
        rest are set aside here with the reason.${candidatesChecked ? `
        The register was last read on ${esc(shortDate(candidatesChecked))}.` : ''}${filed ? `
        The register can only show a permit whose name says pizza, so a restaurant, bar or bakery that
        serves pizza under another name is filed by a research pass instead, as not pizza-forward.` : ''}
        The whole path, from a food permit to the top ten, is drawn under
        <a href="#lifecycle">how it works</a>.
      </p>
    </div>
    ${NOT_ON_FILE.map(group).join('')}
    ${dupes ? `
    <p class="note cq-dupes" data-group="duplicate">
      <b data-count="tied-permits">${dupes}</b> more ${dupes === 1 ? 'permit is a further branch or a second registration of a pizzeria' : 'permits are further branches or second registrations of pizzerias'}
      already on file. ${dupes === 1 ? 'It is tied to that entry and is' : 'They are tied to those entries and are'} not listed here.
    </p>` : ''}` : '';

  const shown = CATEGORIES.filter(k => counts[k]);
  const defaults = shown.filter(k => DEFAULT_OPEN.includes(k));
  /* The search field and the category toggles. Rendered hidden: they do
   * nothing without app.js, which reveals them, and a reader without
   * JavaScript opens the categories by their own headers. The toggles carry
   * each category's colour and count, so they are the map's legend as well.
   * The map rail is hidden for the same reason, and app.js reveals it once it
   * has points to plot; the map has a wrapper of its own because under 1100px
   * the wrapper is pinned while the list scrolls. */
  const tools = `
      <div class="dir-tools" id="dir-tools" hidden>
        <div class="dir-search">
          <input type="search" id="dir-q" class="dir-q" placeholder="Search the directory" autocomplete="off"
            spellcheck="false" enterkeyhint="search" aria-controls="dir-list"
            aria-label="Search the directory by name, neighbourhood, address or style">
        </div>
        <p class="dir-found"><span id="dir-status" role="status" aria-live="polite"></span>
          <button type="button" class="dir-act" id="dir-clear" hidden>Clear search</button></p>
        <div class="dir-cats" id="dir-cats" role="group" aria-label="Categories shown in the list and on the map">
          ${shown.map(k => `<button type="button" class="cat-chip" data-cat="${k}" aria-pressed="${DEFAULT_OPEN.includes(k)}">${swatch(k, 'cat-dot')}${CATEGORY[k].title} <b data-count="${k}">${counts[k]}</b></button>`).join('\n          ')}
          <span class="dir-acts">
            <button type="button" class="dir-act" id="dir-all">Show all</button>
            <button type="button" class="dir-act" id="dir-reset">${defaults.length === 1 ? `${CATEGORY[defaults[0]].title} only` : 'Reset'}</button>
            <button type="button" class="dir-act" id="dir-none">Collapse all</button>
          </span>
        </div>
      </div>`;

  return `
<section class="section" id="directory">
  <div class="wrap">
    <div class="eyebrow">The directory</div>
    <h2 class="sec-h">Every place the index knows of</h2>
    <p class="lede" style="margin-top:14px">
      One list, sorted into categories: <span data-count="on-file">${registry.entries.length}</span> ${registry.entries.length === 1 ? 'pizzeria' : 'pizzerias'} on file, maintained by the
      daily research pass${candidatePlaces.length ? `, and <span data-count="not-on-file">${candidatePlaces.length}</span> more ${candidatePlaces.length === 1 ? 'place' : 'places'} known only as ${candidatePlaces.length === 1 ? 'a lead' : 'leads'}, each with the reason
      it is not listed` : ''}. The ranked pizzerias are shown first, in rank order with their SLICE
      score, so this is also where ranks 11 and up live. Open any other category by its heading.
      Click a pizzeria's row for everything on file about it.
    </p>
    <p class="note" style="margin-top:10px; max-width:110ch">
      Inclusion rule: a pizza-forward place with a location inside Seattle city limits.
      National chains (Domino's, Pizza Hut, MOD, and the like) are excluded by policy — this is
      an index of Seattle's own pizzerias.${hasQueue ? `
      The places the index knows of and does not list are under
      <a href="#candidates">Not on file</a>, each with the reason.` : ''}
    </p>
    <div class="dir-layout">${tools}
      <div class="dir-list" id="dir-list">
        ${['ranked', 'unrated', 'opening', 'closed'].map(group).join('')}
        ${notOnFile}
      </div>
      <div class="dir-rail" id="map-rail" hidden>
        <div class="dir-pin">
          <div id="map" class="dir-map" role="region" aria-label="Map of Seattle pizzerias"></div>
        </div>
        <p class="note dir-map-note">Ranked pins run from blue at the lowest rank, through
        green, yellow and orange, to red at #1, and the top ten have a heavier outline. Every
        other category has its own colour; a hollow pin is a place that is not on file. Seattle
        locations only. Tiles &copy; OpenStreetMap contributors.</p>
      </div>
    </div>
  </div>
</section>
`;
}
