import test from 'node:test';
import assert from 'node:assert/strict';
import { directorySection, mapData, CATEGORY } from '../build/sections/directory.mjs';
import { deriveContext } from '../build/derive.mjs';
import { PER_PASS, RETRY_DAYS } from '../src/rules.js';
import { INSPECTION_CUTOFF_MONTHS } from '../src/census.js';
import { CATEGORIES } from '../src/registry.js';

/* The directory's categories for everything known and not ranked, rendered
 * from a small made-up dataset and queue: one entry and one candidate for
 * each reason a place can be known of and not ranked, plus the ones that
 * must stay out of the lists. (These lists were a section of their own,
 * Candidates, before they became categories of the directory.) */
const NOW = new Date('2026-11-10T12:00:00Z');
const rated = { craft: { value: 8 }, distinctiveness: { value: 8 }, critical: { value: 8 } };
const entry = (id, name, over = {}) => ({
  id, name, status: 'open', neighborhood: 'Ballard', style: 'Slice', mentions: [], attributes: {}, ...over
});
const story = n => ({ url: `https://news.example/${n}`, title: `Story ${n}`, source: 'News', date: '2026-10-01', kind: 'mention' });

const restaurants = () => [
  entry('ranked', 'Ranked Pies', { factors: rated, statusChecked: '2026-11-10' }),
  entry('fresh', 'Fresh Pies', { url: 'https://fresh.example/' }),
  entry('covered', 'Covered Pies', { mentions: [story(1), story(2)], instagram: 'https://www.instagram.com/coveredpies' }),
  entry('looked', 'Looked <b>Pies</b>', { ratingAttempted: '2026-10-01',
    ratingNote: 'Searched three outlets & found <script>nothing</script>; the listing says "undefined".' }),
  entry('earlier', 'Earlier Pies', { ratingAttempted: '2026-06-01' }),
  entry('soon', 'Soon Pies', { status: 'opening', statusSource: 'https://www.paper.example/opening', ratingAttempted: '2026-10-01' }),
  entry('shut', 'Shut Pies', { status: 'closed', statusDate: '2026-10-01' })
];

const permit = (name, over = {}) => ({
  key: `${name.toLowerCase()}|1`, name, address: '100 Pine St, Seattle, WA 98101',
  sources: ['kc-health'], lastInspection: '2026-09-01', status: 'pending', ...over
});
const queue = () => [
  permit('Chain By Name #12', { status: 'chain' }),
  permit('Chain By Verdict', { status: 'chain', verdict: 'chain', note: 'A national brand.', resolvedDate: '2026-08-31' }),
  permit('First Pending'),
  permit('Branch Of Ranked', { status: 'promoted', matchedId: 'ranked', resolvedDate: '2026-08-01' }),
  permit('Second Registration', { status: 'rejected', verdict: 'duplicate', matchedId: 'ranked', resolvedDate: '2026-08-31', note: 'The same shop.' }),
  permit('Pasta House', { status: 'rejected', verdict: 'not-pizza', resolvedDate: '2026-08-31', lastInspection: '2026-11-05',
    note: 'Pasta first; pizza is <i>one</i> menu item.', resolutionSource: 'https://www.pasta.example/menu' }),
  permit('Ghost Kitchen', { status: 'rejected', verdict: 'unverifiable', resolvedDate: '2026-09-12', lastInspection: '2026-03-01', note: 'No trace beyond the permit.' }),
  permit("Gone Slice'S", { status: 'rejected', verdict: 'closed', resolvedDate: '2026-09-12', lastInspection: '2025-12-01', note: 'Closed in the spring.',
    resolutionSource: 'https://www.news.example/gone' }),
  permit('Back Again', { lastInspection: '2026-11-01', address: undefined,
    previousVerdict: { verdict: 'closed', note: 'Was dark in August.', resolvedDate: '2026-08-31' } })
];
/* A place a research pass filed: it serves pizza and is not a pizzeria. It has
 * no permit on file, so no inspection, and a neighbourhood instead. */
const filed = (name, over = {}) => ({
  key: `${name.toLowerCase()}|1546`, name, address: '1546 15th Ave, Seattle, WA 98122', neighborhood: 'Capitol Hill',
  sources: ['research'], status: 'rejected', verdict: 'not-pizza', resolvedDate: '2026-11-08',
  note: 'A salumeria; three pizzas at the foot of the menu.', resolutionSource: 'https://www.cotto.example/menu', ...over
});

const context = (over = {}) => deriveContext({
  dataset: { city: 'Seattle', dataVersion: 'test', restaurants: restaurants(), attributeRegistry: {} },
  history: { snapshots: [] }, buzz: { updated: null, items: [] },
  candidates: queue(), candidatesChecked: '2026-11-09T20:00:00Z', now: NOW, ...over
});
const textOf = markup => markup.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
/* The categories of a rendered section, in page order: each from its
 * <details> to the next one (rows hold <details> of their own). */
const groupsOf = html => {
  const starts = [...html.matchAll(/<details class="dg" id="cat-([a-z-]+)" data-cat="\1"( open)?>/g)];
  const end = html.indexOf('<div class="dir-rail"');
  return new Map(starts.map((m, i) => {
    const body = html.slice(m.index, starts[i + 1]?.index ?? end);
    return [m[1], { open: Boolean(m[2]), body, summary: textOf(body.match(/<summary>[\s\S]*?<\/summary>/)[0]),
      about: textOf(body.match(/<p class="dg-about">[\s\S]*?<\/p>/)[0]) }];
  }));
};
const printed = body => Number(body.match(/<span class="dg-n" data-count="[^"]+">(\d+)<\/span>/)[1]);
/* An entry's row with the reason under it, and a candidate's with its note. */
const entryRows = body => [...body.matchAll(/<tr class="dir-row[^"]*" id="([^"]+)" data-id="([^"]+)">([\s\S]*?)<\/tr>(?:\s*<tr class="dir-why"><td colspan="6">([\s\S]*?)<\/td><\/tr>)?/g)]
  .map(m => ({ anchor: m[1], id: m[2], html: m[0], why: m[4] == null ? null : textOf(m[4]) }));
const candidateRows = body => [...body.matchAll(/<tr class="cq-row[^"]*" id="([^"]+)">([\s\S]*?)<\/tr>(?:\s*<tr class="cq-note">([\s\S]*?)<\/tr>)?/g)]
  .map(m => ({ anchor: m[1], cells: textOf(m[2]), note: textOf(m[3] ?? ''), html: m[0] }));

test('every category on the page is a group that opens without script, and only the ranking is open', () => {
  const html = directorySection(context());
  const groups = groupsOf(html);
  // Page order, with the empty category (set aside with no reason) left out.
  assert.deepEqual([...groups.keys()], ['ranked', 'unrated', 'opening', 'closed', 'pending', 'chain', 'not-pizza', 'unverifiable']);
  assert.deepEqual([...groups].filter(([, g]) => g.open).map(([k]) => k), ['ranked']);
  // The header carries the name, the count and the rule in a line, so a
  // closed category still says what it holds.
  assert.equal(groups.get('chain').summary, 'National chain 2 Left out by policy.');
  assert.equal(groups.get('unrated').summary, 'Unrated 4 Open and on file, with no rating yet.');
  assert.match(groups.get('chain').body, /^<details class="dg" id="cat-chain" data-cat="chain">\s*<summary><span class="dg-dot"><\/span><span class="dg-title">National chain<\/span>/);
  for (const [key, g] of groups) assert.ok(g.summary.startsWith(CATEGORY[key].title), key);
  for (const key of CATEGORIES) assert.ok(CATEGORY[key]?.title && CATEGORY[key].rule, `no copy for the "${key}" category`);

  // The old section is gone; its id is the head of what is not on file.
  assert.doesNotMatch(html, /<section class="section" id="candidates"/);
  assert.ok(html.indexOf('id="cat-closed"') < html.indexOf('id="candidates"'));
  assert.ok(html.indexOf('id="candidates"') < html.indexOf('id="cat-pending"'));
});

test('an unrated entry is listed once, in the directory, with the reason under its row', () => {
  const html = directorySection(context());
  const groups = groupsOf(html);

  const unrated = entryRows(groups.get('unrated').body);
  assert.equal(printed(groups.get('unrated').body), 4);
  // No pass has looked yet, press on file first: the order the rating task
  // draws in. Then the ones a pass found nothing for, soonest due first.
  assert.deepEqual(unrated.map(r => r.id), ['covered', 'fresh', 'earlier', 'looked']);
  assert.equal(unrated[0].why, 'Waiting for a rating pass. 2 stories on file.');
  assert.equal(unrated[1].why, 'Waiting for a rating pass. No press on file.');
  // Each carries the day it was looked at and the day it is due, and a rest
  // that has run out reads as "since" that day.
  assert.equal(unrated[2].why, 'A rating pass looked on Jun 1, 2026 and found no published criticism. Eligible again since Aug 30, 2026.');
  // The agent's note is third-party text: printed, and escaped.
  assert.equal(unrated[3].why, 'A rating pass looked on Oct 1, 2026 and found no published criticism. Eligible again Dec 30, 2026. '
    + 'Searched three outlets &amp; found &lt;script&gt;nothing&lt;/script&gt;; the listing says &quot;undefined&quot;.');
  assert.doesNotMatch(html, /<script>|<b>Pies<\/b>/);
  // Linked as the directory links every name: the site, or the Instagram when there is no site.
  assert.match(unrated[0].html, /<a href="https:\/\/www\.instagram\.com\/coveredpies"[^>]*>Covered Pies<\/a>/);
  assert.match(unrated[1].html, /<a href="https:\/\/fresh\.example\/"[^>]*>Fresh Pies<\/a>/);
  // It is an entry like any other: its row opens the full record.
  assert.match(html, /<tr class="dir-detail" id="dd-looked" hidden>/);

  const opening = entryRows(groups.get('opening').body);
  assert.deepEqual(opening.map(r => [r.id, r.why]), [['soon', 'Not open yet. Reported by paper.example .']]);
  // A ranked or a closed entry needs no reason under it.
  assert.deepEqual(entryRows(groups.get('ranked').body).map(r => [r.id, r.why]), [['ranked', null]]);
  assert.deepEqual(entryRows(groups.get('closed').body).map(r => [r.id, r.why]), [['shut', null]]);

  // What happens next, in the category's own explanation, with the numbers the worklist runs on.
  const about = groups.get('unrated').about;
  assert.ok(about.includes(`takes up to ${PER_PASS.rating} entries per pass`));
  assert.ok(about.includes(`rests ${RETRY_DAYS.rating} days before it is drawn again`));
  assert.match(about, /at least one piece of published criticism of it: a review, a roundup or a news story/);
  assert.match(about, /with press on file first/);
  assert.match(groups.get('opening').about, /^Rated once it has opened and criticism of it has been published\./);
});

test('the queue is listed by where each candidate stands, with where it is known from and the note', () => {
  const html = directorySection(context());
  const groups = groupsOf(html);

  const pending = candidateRows(groups.get('pending').body);
  assert.equal(printed(groups.get('pending').body), 2);
  assert.equal(pending[0].cells, 'First Pending 100 Pine St, Seattle, WA 98101 Food permit inspected Sep&nbsp;1,&nbsp;2026 next');
  assert.equal(pending[0].note, '');
  // One that came back says so, with what the earlier pass found.
  assert.equal(pending[1].cells, 'Back Again address not on file Food permit inspected Nov&nbsp;1,&nbsp;2026 next');
  assert.equal(pending[1].note, 'Back in the queue. A census pass set it aside on Aug 31, 2026 as closed, and the register has recorded an inspection since. What that pass found: Was dark in August.');
  assert.ok(groups.get('pending').about.startsWith(`Found in the permit register and not yet checked. The census task takes up to ${PER_PASS.census} per pass, in this order.`));

  const chain = candidateRows(groups.get('chain').body);
  // Settled on the name alone: no verdict date and no note to print.
  assert.equal(chain[0].cells, 'Chain By Name #12 100 Pine St, Seattle, WA 98101 Food permit inspected Sep&nbsp;1,&nbsp;2026 by name');
  assert.equal(chain[0].note, '');
  assert.equal(chain[1].cells, 'Chain By Verdict 100 Pine St, Seattle, WA 98101 Food permit inspected Sep&nbsp;1,&nbsp;2026 Aug 31, 2026');
  assert.equal(chain[1].note, 'A national brand.');
  assert.equal(groups.get('chain').about, "A brand with shops across the country. Excluded by policy: this is an index of Seattle's own pizzerias. It does not come back.");

  const [pasta] = candidateRows(groups.get('not-pizza').body);
  assert.equal(pasta.cells, 'Pasta House 100 Pine St, Seattle, WA 98101 Food permit inspected Nov&nbsp;5,&nbsp;2026 Aug 31, 2026');
  // Inspected after its verdict: still under the verdict, and marked as due back.
  assert.equal(pasta.note, 'Due back Inspected since it was set aside: it returns to the queue the next time the register is read. Pasta first; pizza is &lt;i&gt;one&lt;/i&gt; menu item. pasta.example');
  assert.match(pasta.html, /<a href="https:\/\/www\.pasta\.example\/menu"[^>]*rel="noopener nofollow">pasta\.example<\/a>/);
  assert.doesNotMatch(html, /<i>one<\/i>/);

  const [ghost] = candidateRows(groups.get('unverifiable').body);
  assert.equal(ghost.note, 'No trace beyond the permit.');
  // The three verdicts a later inspection undoes say so; a chain does not.
  for (const key of ['not-pizza', 'unverifiable', 'closed']) {
    assert.match(groups.get(key).about, /Not final: it returns to the queue when the register records an inspection dated after the day it was set aside\./, key);
  }
  // Each table names itself and its columns, and each row its subject.
  assert.match(groups.get('chain').body, /<table class="cq-table" aria-label="Places excluded as national chains">\s*<thead><tr><th scope="col">Place<\/th><th scope="col">Known from<\/th><th scope="col">Set aside<\/th>/);
  assert.match(groups.get('chain').body, /<tr class="cq-row" id="c-chain-by-name-12-1"><th scope="row">Chain By Name #12/);

  // Further permits of pizzerias on file are one line with the count, and none is named.
  assert.match(html, /<p class="note cq-dupes" data-group="duplicate">\s*<b data-count="tied-permits">2<\/b> more permits are further branches/);
  assert.doesNotMatch(html, /Branch Of Ranked|Second Registration/);

  const head = textOf(html.match(/<div class="dg-head" id="candidates">[\s\S]*?<\/div>/)[0]);
  assert.match(head, /^Not on file King County's food-permit register lists every kitchen/);
  assert.ok(head.includes(`inspected within the last ${INSPECTION_CUTOFF_MONTHS} months`));
  assert.ok(head.includes(`up to ${PER_PASS.census} per pass`));
  assert.ok(head.includes('The register was last read on Nov 9, 2026.'));
  assert.match(html, /<div class="dg-head" id="candidates">[\s\S]*?<a href="#lifecycle">how it works<\/a>/);
});

test('closed holds the pizzerias on file and then the places a census pass found closed', () => {
  const groups = groupsOf(directorySection(context()));
  const closed = groups.get('closed');
  assert.equal(printed(closed.body), 2);
  // The entry first, as the directory has always shown it, with its record.
  assert.deepEqual(entryRows(closed.body).map(r => r.id), ['shut']);
  assert.match(closed.body, /<tr class="dir-row st-closed" id="r-shut" data-id="shut">/);
  assert.ok(closed.body.indexOf('id="r-shut"') < closed.body.indexOf('class="cq-table"'));
  // Then the one known only from a permit. Its row says so, and carries the
  // note and the source. The register's "Slice'S" is put right.
  const [gone] = candidateRows(closed.body);
  assert.equal(gone.cells, 'Gone Slice&#39;s 100 Pine St, Seattle, WA 98101 Food permit inspected Dec&nbsp;1,&nbsp;2025 Sep 12, 2026');
  assert.equal(gone.note, 'Not on file: known only from a food permit. Closed in the spring. news.example');
  assert.match(closed.body, /<th scope="col">Place<\/th><th scope="col">Known from<\/th><th scope="col">Found closed<\/th>/);
  assert.match(closed.about, /Listed after the pizzerias on file is a place known only from the candidates queue that a census pass found closed\. The census pass found that it had shut\. Not final:/);

  // With no such place the category is the entries alone, and says nothing of permits.
  const alone = groupsOf(directorySection(context({ candidates: null }))).get('closed');
  assert.equal(printed(alone.body), 1);
  assert.doesNotMatch(alone.body, /cq-table|candidates queue/);
});

test('a place a research pass filed is listed with the permits, and told apart from them', () => {
  const candidates = [...queue(), filed('Bar Cotto'),
    filed('Listed Later', { status: 'promoted', matchedId: 'fresh', verdict: undefined })];
  const html = directorySection(context({ candidates }));
  const group = groupsOf(html).get('not-pizza');
  assert.equal(printed(group.body), 2);
  const [cotto, pasta] = candidateRows(group.body);
  // A neighbourhood and an address, no inspection to print, the day it was filed.
  assert.equal(cotto.cells, 'Bar Cotto Capitol Hill · 1546 15th Ave, Seattle, WA 98122 Research pass Nov 8, 2026');
  assert.equal(cotto.note, 'A salumeria; three pizzas at the foot of the menu. cotto.example');
  assert.ok(pasta.cells.startsWith('Pasta House'));
  // What brings each kind back is not the same, and the category says both.
  assert.equal(group.about, 'Pizza is on the menu but incidental: a grocery counter, a bar, a restaurant that also serves it. '
    + 'For a place found through a food permit this is not final: it returns to the queue when the register records an inspection dated after the day it was set aside. '
    + 'A place a research pass filed has no permit on file, so no inspection brings it back: it joins the directory only if a later pass files it as a pizzeria.');
  // A category of research-filed places alone promises no return through the register.
  const only = groupsOf(directorySection(context({ candidates: [filed('Bar Cotto')] }))).get('not-pizza');
  assert.doesNotMatch(only.about, /returns to the queue/);
  assert.match(only.about, /it joins the directory only if a later pass files it as a pizzeria\.$/);

  assert.match(textOf(html), /a restaurant, bar or bakery that serves pizza under another name is filed by a research pass instead/);
  // A research-filed place that was later listed is that entry: it is not a
  // row, and it is not one of the "more permits".
  assert.doesNotMatch(html, /Listed Later/);
  assert.match(html, /<b data-count="tied-permits">2<\/b> more permits/);
});

test('a pending candidate is told which census pass reaches it', () => {
  const many = Array.from({ length: PER_PASS.census + 1 }, (_, i) => permit(`Pending ${String(i).padStart(2, '0')}`));
  const rows = candidateRows(groupsOf(directorySection(context({ candidates: many }))).get('pending').body);
  assert.equal(rows.length, PER_PASS.census + 1);
  // File order is the order the census task takes them in.
  assert.deepEqual(rows.map(r => r.cells.split(' ').slice(0, 2).join(' ')), many.map(c => c.name));
  assert.ok(rows.slice(0, PER_PASS.census).every(r => r.cells.endsWith(' next')));
  assert.ok(rows.at(-1).cells.endsWith(' 2nd'));
});

test('the directory renders only the categories there are, and no heading for a queue that is not there', () => {
  const allRated = restaurants().filter(r => r.factors || r.status === 'closed');
  const dataset = { city: 'Seattle', dataVersion: 'test', restaurants: allRated, attributeRegistry: {} };

  // No queue file and nobody unrated: the ranking and the closures, nothing to link.
  const empty = directorySection(context({ dataset, candidates: null }));
  assert.deepEqual([...groupsOf(empty).keys()], ['ranked', 'closed']);
  assert.doesNotMatch(empty, /id="candidates"|href="#candidates"|cq-dupes/);

  // Unrated entries and no queue: their categories, and still no heading.
  const noQueue = directorySection(context({ candidates: null }));
  assert.deepEqual([...groupsOf(noQueue).keys()], ['ranked', 'unrated', 'opening', 'closed']);
  assert.doesNotMatch(noQueue, /id="candidates"|href="#candidates"/);

  // A queue and nobody unrated.
  const queueOnly = directorySection(context({ dataset }));
  assert.deepEqual([...groupsOf(queueOnly).keys()], ['ranked', 'closed', 'pending', 'chain', 'not-pizza', 'unverifiable']);
  assert.match(queueOnly, /are under\s+<a href="#candidates">Not on file<\/a>/);

  // A queue of further permits alone is still worth its heading and its one line.
  const dupes = directorySection(context({ dataset, candidates: [permit('Branch', { status: 'promoted', matchedId: 'ranked' })] }));
  assert.match(dupes, /<b data-count="tied-permits">1<\/b> more permit is a further branch or a second registration of a pizzeria\s+already on file\. It is tied to that entry and is not listed here\./);
  assert.match(dupes, /id="candidates"/);
  assert.deepEqual([...groupsOf(dupes).keys()], ['ranked', 'closed']);
});

test('nothing the directory prints for a sparse entry or candidate is a raw missing value', () => {
  // A candidate with nothing but a name, and an entry with nothing but an id and a name.
  const ctx = context({
    dataset: { city: 'Seattle', dataVersion: 'test', attributeRegistry: {},
      restaurants: [{ id: 'bare', name: 'Bare Pies', status: 'open' }, { id: 'bare2', name: 'Bare Two', status: 'opening' }] },
    candidates: [{ name: 'Nameless Permit', status: 'pending' }, { name: 'Odd One', status: 'rejected' },
      { name: 'Map Lead', status: 'chain', sources: ['osm'] }],
    candidatesChecked: null
  });
  const html = directorySection(ctx);
  const text = textOf(html);
  assert.doesNotMatch(text, /undefined|NaN|null|Invalid Date|\[object/);
  assert.doesNotMatch(html, /="(undefined|null|NaN)"/);
  assert.match(text, /Nameless Permit address not on file not on file next/);
  // An OpenStreetMap lead has no permit and so no inspection to report missing.
  assert.match(text, /Map Lead address not on file OpenStreetMap by name/);
  // Set aside with no verdict on record: listed as that, so the categories add up.
  assert.match(text, /Set aside 1 No reason on file\. Set aside by an earlier pass, with no reason on file\./);
  assert.match(text, /Not open yet\. Reported by not on file \./);
  assert.match(text, /Waiting for a rating pass\. No press on file\./);
  assert.doesNotMatch(text, /The register was last read/);
  // Nothing here has coordinates, so the map is given nothing to plot.
  assert.deepEqual(mapData(ctx), []);
});
