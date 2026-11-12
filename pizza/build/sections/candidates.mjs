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
import { INSPECTION_CUTOFF_MONTHS, REOPENING_VERDICTS, candidateStanding } from '../../src/census.js';

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
 * `rejected` is a candidate set aside with no verdict on record. */
export const EXCLUDED = ['chain', 'not-pizza', 'unverifiable', 'closed', 'rejected'];

/* The queue by where each candidate stands. candidateStanding (census.js) is
 * the one reading of a candidate's state, and the census worklist draws on
 * the same data: a candidate is pending here exactly when the census task
 * would take it, in the order it would. Duplicates are counted and not
 * listed: each is a branch or a second registration of an entry the directory
 * already shows. */
export function candidateLists(candidates) {
  const queue = Array.isArray(candidates) ? candidates : [];
  const lists = { pending: [], duplicates: 0, ...Object.fromEntries(EXCLUDED.map(k => [k, []])) };
  for (const c of queue) {
    const at = candidateStanding(c, queue);
    if (at.state === 'listed' || at.state === 'duplicate') lists.duplicates++;
    else (lists[at.state] ?? lists.rejected).push({ ...c, at });
  }
  lists.pending.sort((a, b) => (a.at.queuePosition ?? Infinity) - (b.at.queuePosition ?? Infinity));
  for (const k of EXCLUDED) lists[k].sort(byName);
  const excluded = EXCLUDED.reduce((n, k) => n + lists[k].length, 0);
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
          <tr class="cq-note"><td colspan="${head.length}"><div class="cq-note-in">${note}</div></td></tr>` : ''}`).join('');
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

/* What each verdict means, in a sentence. `was` completes "set aside as …"
 * for a candidate that has come back. */
const VERDICT_COPY = {
  chain: {
    title: 'National chain',
    rule: "A brand with shops across the country. Excluded by policy: this is an index of Seattle's own pizzerias.",
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
    rule: 'The census pass could not confirm a Seattle pizzeria behind the permit.',
    label: 'Candidates that could not be verified',
    was: 'one it could not verify'
  },
  closed: {
    title: 'Closed',
    rule: 'The census pass found that it had shut.',
    label: 'Candidates found to have closed',
    was: 'closed'
  },
  rejected: {
    title: 'Set aside',
    rule: 'Set aside by an earlier pass, with no reason on file.',
    label: 'Candidates set aside with no reason on file',
    was: 'not belonging'
  }
};
/* Whether a verdict is final. The reopening verdicts are the ones a later
 * inspection undoes (REOPENING_VERDICTS in census.js); the rest stay. */
const finality = key => REOPENING_VERDICTS.includes(key)
  ? ' Not final: it returns to the queue when the register records an inspection dated after the day it was set aside.'
  : ' It does not come back.';
const ORDINAL = ['', 'next', '2nd', '3rd'];
const passName = n => n == null ? NONE : ORDINAL[n] ?? `${n}th`;

export function candidatesSection(ctx) {
  const { dataset, candidates, candidatesChecked } = ctx;
  /* A rest that has already run out is printed as "since" its last day: the
   * entry is back in the draw and has been from then. */
  const today = (ctx.now ?? new Date()).toISOString().slice(0, 10);
  const unrated = unratedLists(dataset.restaurants);
  const queue = candidateLists(candidates);
  if (!unrated.total && !queue.total) return '';

  /* ---- on file, not yet ranked ---- */
  const press = r => r.mentions?.length ?? 0;
  const onFile = unrated.total ? `
    <h3 class="buzz-head" id="unranked">On file, not yet ranked</h3>
    <p class="method-p">
      ${count(unrated.total, 'pizzeria is', 'pizzerias are')} in the directory with no score. A place is rated, and so
      competes, once a rating pass has read at least one piece of published criticism of it: a
      review, a roundup or a news story. The rating task takes up to ${PER_PASS.rating} entries per pass, the
      ones with press on file first and, among equals, the ones no pass has looked at yet. An
      entry it cannot ground stays unrated and rests ${RETRY_DAYS.rating} days before it is drawn again.
    </p>
    ${group({
      key: 'rating-waiting', title: 'Waiting for a rating pass',
      rule: 'No rating pass has looked at these yet. A pass draws the ones with press on file first; among the rest the order is shuffled.',
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
        `${entryCell(r)}<td>${day(dayOf(r.ratingAttempted))}</td><td>${r.eligible <= today ? 'since ' : ''}${day(r.eligible)}</td>`,
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
  /* A candidate that came back carries what the earlier pass found, and the
   * row says why it is here again. */
  const pendingRow = c => {
    const was = c.at.previousVerdict;
    return [
      `${permitCell(c)}<td>${day(dayOf(c.at.lastInspection))}</td><td>${passName(c.at.censusPass)}</td>`,
      was ? `Back in the queue. A census pass set it aside${was.resolvedDate ? ` on ${day(dayOf(was.resolvedDate))}` : ''} as ${
        VERDICT_COPY[was.verdict]?.was ?? VERDICT_COPY.rejected.was}, and the register has recorded an inspection since.${
        was.note ? ` What that pass found: ${esc(was.note)}` : ''}` : ''];
  };
  /* A candidate with no verdict date was settled on its name alone, when the
   * register was read, and no pass has written a note for it. One the
   * register has already inspected again is still listed under its verdict,
   * because the queue takes it back only when the register is next read. */
  const excludedRow = c => [
    `${permitCell(c)}<td>${day(dayOf(c.at.lastInspection))}</td><td>${
      c.at.resolvedDate ? day(dayOf(c.at.resolvedDate)) : '<span class="cq-dim">by name</span>'}</td>`,
    [c.at.inspectedSince ? '<b class="cq-flag">Due back</b> Inspected since it was set aside: it returns to the queue the next time the register is read.' : '',
     c.note ? `${esc(c.note)}${c.resolutionSource ? ` <span class="cq-src">${srcLink(c.resolutionSource)}</span>` : ''}` : '']
      .filter(Boolean).join('<br>')];
  const excludedGroup = key => group({
    key, title: VERDICT_COPY[key].title, label: VERDICT_COPY[key].label,
    rule: VERDICT_COPY[key].rule + (key === 'rejected' ? '' : finality(key)),
    head: ['Permit name', 'Last inspected', 'Set aside'],
    rows: queue[key].map(excludedRow)
  });
  const notOnFile = queue.total ? `
    <h3 class="buzz-head" id="queue">Not on file</h3>
    <p class="method-p">
      King County's food-permit register lists every kitchen that holds a health permit. A Seattle
      permit whose name mentions pizza or slices, inspected within the last ${INSPECTION_CUTOFF_MONTHS} months, becomes
      a candidate: a lead, not an entry. Places tagged as pizza on OpenStreetMap are added when
      that source answers. The census task checks each one on the open web, up to
      ${PER_PASS.census} per pass. A candidate that is real, open and pizza-forward joins the directory; the
      rest are set aside here with the reason.${candidatesChecked ? `
      The register was last read on ${esc(shortDate(candidatesChecked))}.` : ''}
    </p>
    ${group({
      key: 'pending', title: 'Waiting for a census pass',
      rule: `Found in the permit register and not yet checked. The census task takes up to ${PER_PASS.census} per pass, in this order.`,
      label: 'Candidates waiting for a census pass',
      head: ['Permit name', 'Last inspected', 'Census pass'],
      rows: queue.pending.map(pendingRow)
    })}
    ${EXCLUDED.map(excludedGroup).join('')}
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
