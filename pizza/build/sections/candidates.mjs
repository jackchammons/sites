/* The Candidates section: the places the index knows of that are not in the
 * ranking, each with the reason and with what the pipeline does with it next.
 *
 * Two lists. Entries on file with no rating come from the dataset; the
 * candidates queue (data/candidates.json) holds permit-register leads that
 * have not joined the directory. Every count the section prints is the length
 * of a list it renders, and every "what happens next" is a number imported
 * from the module the worklists are drawn with, so the page states the rule
 * the automation follows. */
import { esc, nameLink, shortDate, srcLink } from '../html.mjs';
import { locationLabel } from '../../src/locations.js';
import { isRated } from '../../src/slice.js';
import { PER_PASS, RETRY_DAYS } from '../../src/rules.js';
import { INSPECTION_CUTOFF_MONTHS } from '../../src/census.js';

const DAY = 864e5;
const isDate = v => typeof v === 'string' && Number.isFinite(Date.parse(v));
const dayOf = v => isDate(v) ? v.slice(0, 10) : null;
const byName = (a, b) => String(a.name).localeCompare(String(b.name), 'en');

/* ---------- on file, not yet ranked ---------- */

/* Open and opening entries with no rating, split by why. The rating task
 * never draws an entry that has not opened, so that reason comes first
 * whatever else is on file for it. An attempt that found nothing rests the
 * entry RETRY_DAYS.rating days; `eligible` is the first day a pass may draw it
 * again. */
export function unratedLists(restaurants) {
  const opening = [], waiting = [], looked = [];
  for (const r of restaurants) {
    if (r.status === 'closed' || isRated(r)) continue;
    if (r.status === 'opening') opening.push(r);
    else if (isDate(r.ratingAttempted)) {
      const eligible = new Date(Date.parse(r.ratingAttempted.slice(0, 10)) + RETRY_DAYS.rating * DAY)
        .toISOString().slice(0, 10);
      looked.push({ ...r, eligible });
    } else waiting.push(r);
  }
  const press = r => r.mentions?.length ?? 0;
  waiting.sort((a, b) => press(b) - press(a) || byName(a, b));
  looked.sort((a, b) => (a.eligible > b.eligible) - (a.eligible < b.eligible) || byName(a, b));
  opening.sort(byName);
  return { waiting, looked, opening, total: waiting.length + looked.length + opening.length };
}

/* ---------- not on file ---------- */

/* The verdicts that set a candidate aside, in the order the page lists them.
 * `returns` marks the ones that are not final. */
export const VERDICTS = [
  { key: 'chain', returns: false },
  { key: 'not-pizza', returns: true },
  { key: 'unverifiable', returns: true },
  { key: 'closed', returns: true }
];
const RETURNS = new Set(VERDICTS.filter(v => v.returns).map(v => v.key));

/* Where one candidate stands, and the dates that decide it.
 *
 * A candidate set aside as not pizza-forward, unverifiable or closed goes
 * back to pending once the permit register records an inspection dated after
 * the day it was set aside: someone is running a kitchen there again, so the
 * verdict is worth a second look. A national chain is excluded by policy and
 * a duplicate is an entry already on file, so neither returns. A candidate
 * the queue marks rejected with no verdict this page knows is `other`, so the
 * groups always add up to the queue. */
export function candidateState(c) {
  const inspected = dayOf(c.lastInspection);
  const resolved = dayOf(c.resolvedDate);
  if (c.status === 'promoted' || c.verdict === 'duplicate') return { state: 'duplicate', inspected, resolved };
  if (c.status === 'pending') return { state: 'pending', inspected, resolved: null, returnedFrom: null };
  if (c.status === 'chain' || c.verdict === 'chain') return { state: 'chain', inspected, resolved };
  if (RETURNS.has(c.verdict)) {
    return inspected && resolved && inspected > resolved
      ? { state: 'pending', inspected, resolved, returnedFrom: c.verdict }
      : { state: c.verdict, inspected, resolved };
  }
  return { state: 'other', inspected, resolved };
}

/* The queue by state. Duplicates are counted and not listed: each is a branch
 * or a second registration of an entry the directory already shows. */
export function candidateLists(candidates) {
  const lists = { pending: [], chain: [], 'not-pizza': [], unverifiable: [], closed: [], other: [], duplicates: 0 };
  for (const c of candidates ?? []) {
    const at = candidateState(c);
    if (at.state === 'duplicate') lists.duplicates++;
    else lists[at.state].push({ ...c, at });
  }
  for (const k of Object.keys(lists)) if (Array.isArray(lists[k])) lists[k].sort(byName);
  const excluded = lists.chain.length + lists['not-pizza'].length + lists.unverifiable.length
    + lists.closed.length + lists.other.length;
  return { ...lists, excluded, total: lists.pending.length + excluded + lists.duplicates };
}

/* True when the section has anything to list, which is when it renders; the
 * directory links to it only then. */
export function hasCandidates(ctx) {
  return unratedLists(ctx.dataset.restaurants).total + candidateLists(ctx.candidates).total > 0;
}

/* ---------- rendering ---------- */

const NONE = '<span class="cq-dim">not on file</span>';
const day = iso => iso ? esc(shortDate(iso)) : NONE;
const count = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;
/* A long group is rendered collapsed: its summary carries the count and the
 * rule, and the rows are one tap away with or without JavaScript. */
const OPEN_UP_TO = 6;

/* One collapsible group: a summary (name, count, the rule in a sentence) and
 * a table. `rows` are [mainCells, noteHtml] pairs; a note is its own
 * full-width row under the entry, the way the directory puts a record under
 * its row. */
const group = ({ key, title, rule, label, head, rows }) => {
  if (!rows.length) return '';
  const body = rows.map(([cells, note]) => `
          <tr class="cq-row${note ? ' has-note' : ''}">${cells}</tr>${note ? `
          <tr class="cq-note"><td colspan="${head.length}">${note}</td></tr>` : ''}`).join('');
  return `
    <details class="cq-group" data-group="${key}"${rows.length <= OPEN_UP_TO ? ' open' : ''}>
      <summary><span class="cq-title">${title}</span> <span class="cq-n">${rows.length}</span>
        <span class="cq-rule">${rule}</span></summary>
      <div class="cq-scroll">
        <table class="cq-table" aria-label="${label}">
          <thead><tr>${head.map(h => `<th scope="col">${h}</th>`).join('')}</tr></thead>
          <tbody>${body}
          </tbody>
        </table>
      </div>
    </details>`;
};

const entryCell = r => `<th scope="row">${nameLink(r)}<span class="cq-sub">${esc(locationLabel(r) ?? '')}</span></th>`;
/* A permit name is the register's spelling, not a pizzeria's own, and nothing
 * on file says where it lives on the web, so it is text and never a link. */
const permitCell = c => `<th scope="row">${esc(c.name)}<span class="cq-sub">${
  c.address ? esc(c.address) : 'address not on file'}</span></th>`;

const VERDICT_COPY = {
  chain: {
    title: 'National chain',
    rule: "A brand with shops across the country. Excluded by policy: this is an index of Seattle's own pizzerias. It does not come back.",
    label: 'Candidates excluded as national chains',
    was: 'a national chain'
  },
  'not-pizza': {
    title: 'Not pizza-forward',
    rule: 'Pizza is on the menu but incidental: a grocery counter, a bar, a restaurant that also serves it.',
    label: 'Candidates set aside as not pizza-forward',
    was: 'not pizza-forward'
  },
  unverifiable: {
    title: 'Could not be verified',
    rule: 'The census pass found no trace of a pizzeria beyond the permit.',
    label: 'Candidates that could not be verified',
    was: 'unverifiable'
  },
  closed: {
    title: 'Closed',
    rule: 'The census pass found that it had shut.',
    label: 'Candidates found to have closed',
    was: 'closed'
  },
  other: {
    title: 'Set aside',
    rule: 'Set aside by an earlier pass with no reason on file.',
    label: 'Candidates set aside with no reason on file',
    was: 'set aside'
  }
};

export function candidatesSection(ctx) {
  const { dataset, candidates, candidatesChecked } = ctx;
  const unrated = unratedLists(dataset.restaurants);
  const queue = candidateLists(candidates);
  if (!unrated.total && !queue.total) return '';

  /* ---- on file, not yet ranked ---- */
  const press = r => r.mentions?.length ?? 0;
  const onFile = unrated.total ? `
    <h3 class="buzz-head" id="unranked">On file, not yet ranked</h3>
    <p class="method-p">
      ${count(unrated.total, 'pizzeria is', 'pizzerias are')} in the directory with no score. A place competes once a rating
      pass has read published criticism of it: a review, a roundup or a news story. The rating task
      takes up to ${PER_PASS.rating} entries per pass, the ones with press on file first and, among equals, the
      ones no pass has looked at yet. An entry it cannot ground stays unrated and rests
      ${RETRY_DAYS.rating} days before it is drawn again.
    </p>
    ${group({
      key: 'rating-waiting', title: 'Waiting for a rating pass',
      rule: 'No rating pass has looked at these yet.',
      label: 'Pizzerias waiting for a rating pass',
      head: ['Pizzeria', 'Press on file'],
      rows: unrated.waiting.map(r => [`${entryCell(r)}<td>${press(r) ? count(press(r), 'story', 'stories') : 'none'}</td>`, ''])
    })}
    ${group({
      key: 'rating-looked', title: 'Looked for criticism, found none',
      rule: `A rating pass searched and found nothing published to rate from. Each rests ${RETRY_DAYS.rating} days from the day it was looked at.`,
      label: 'Pizzerias a rating pass found no published criticism for',
      head: ['Pizzeria', 'Looked', 'Eligible again'],
      rows: unrated.looked.map(r => [
        `${entryCell(r)}<td>${day(dayOf(r.ratingAttempted))}</td><td>${day(r.eligible)}</td>`,
        r.ratingNote ? esc(r.ratingNote) : ''])
    })}
    ${group({
      key: 'rating-opening', title: 'Not open yet',
      rule: 'Rated once it has opened and criticism of it has been published.',
      label: 'Pizzerias that have not opened yet',
      head: ['Pizzeria', 'Reported by'],
      rows: unrated.opening.map(r => [`${entryCell(r)}<td>${r.statusSource ? srcLink(r.statusSource) : NONE}</td>`, ''])
    })}` : '';

  /* ---- not on file ---- */
  const pendingRow = c => [
    `${permitCell(c)}<td>${day(c.at.inspected)}</td>`,
    c.at.returnedFrom
      ? `Back in the queue: the register recorded an inspection on ${day(c.at.inspected)}, after this candidate was set aside on ${day(c.at.resolved)} as ${VERDICT_COPY[c.at.returnedFrom].was}.`
      : ''];
  /* A candidate with no verdict date was settled on its name alone, when the
   * register was read, and no pass has written a note for it. */
  const excludedRow = c => [
    `${permitCell(c)}<td>${day(c.at.inspected)}</td><td>${c.at.resolved ? day(c.at.resolved) : '<span class="cq-dim">by name</span>'}</td>`,
    c.note ? `${esc(c.note)}${c.resolutionSource ? ` <span class="cq-src">${srcLink(c.resolutionSource)}</span>` : ''}` : ''];
  const excludedGroup = key => group({
    key, ...VERDICT_COPY[key],
    head: ['Permit name', 'Last inspected', 'Set aside'],
    rows: queue[key].map(excludedRow)
  });
  const notOnFile = queue.total ? `
    <h3 class="buzz-head" id="queue">Not on file</h3>
    <p class="method-p">
      King County's food-permit register lists every kitchen that holds a health permit. A Seattle
      permit whose name mentions pizza or slices, inspected within the last ${INSPECTION_CUTOFF_MONTHS} months, becomes
      a candidate: a lead, not an entry. The census task checks each one on the open web, up to
      ${PER_PASS.census} per pass. A candidate that is real, open and pizza-forward joins the directory; the
      rest are set aside here with the reason.${candidatesChecked ? `
      The register was last read on ${esc(shortDate(candidatesChecked))}.` : ''}
    </p>
    ${group({
      key: 'pending', title: 'Waiting for a census pass',
      rule: `Found in the permit register and not yet checked. The census task takes up to ${PER_PASS.census} per pass.`,
      label: 'Candidates waiting for a census pass',
      head: ['Permit name', 'Last inspected'],
      rows: queue.pending.map(pendingRow)
    })}
    ${queue.excluded ? `
    <p class="method-p cq-between">
      ${count(queue.excluded, 'candidate has', 'candidates have')} been set aside. A national chain stays out for good. The
      other verdicts are not final: a candidate returns to the queue when the permit register
      records an inspection dated after the day it was set aside.
    </p>` : ''}
    ${['chain', 'not-pizza', 'unverifiable', 'closed', 'other'].map(excludedGroup).join('')}
    ${queue.duplicates ? `
    <p class="note cq-dupes" data-group="duplicate">
      <b>${queue.duplicates}</b> more ${queue.duplicates === 1 ? 'permit is a further branch or a second registration of a pizzeria' : 'permits are further branches or second registrations of pizzerias'}
      already on file. ${queue.duplicates === 1 ? 'It is tied to that entry and is' : 'They are tied to those entries and are'} not listed here.
    </p>` : ''}` : '';

  const stamp = [
    [unrated.total, 'unrated', 'on file, not yet ranked'],
    [queue.pending.length, 'pending', 'waiting for a census pass'],
    [queue.excluded, 'excluded', 'set aside'],
    [queue.duplicates, 'duplicate', queue.duplicates === 1 ? 'branch of an entry on file' : 'branches of entries on file']
  ].filter(([n]) => n).map(([n, key, text]) => `<span data-count="${key}">${n} <b>${text}</b></span>`).join('\n      ');

  return `
<section class="section" id="candidates">
  <div class="wrap">
    <div class="eyebrow">The candidates</div>
    <h2 class="sec-h">Known, but not ranked</h2>
    <p class="lede" style="margin-top:14px">
      Two kinds of place are known to the index and missing from the ranking: pizzerias on file
      that have no rating yet, and kitchens in the county's permit register that have not joined
      the directory. Each is listed here with the reason, and with what happens to it next. The
      whole path, from a food permit to the top ten, is drawn under
      <a href="#lifecycle">how it works</a>.
    </p>
    <div class="stamp" style="margin-top:18px">
      ${stamp}
    </div>
    ${onFile}
    ${notOnFile}
  </div>
</section>
`;
}
