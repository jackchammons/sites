import test from 'node:test';
import assert from 'node:assert/strict';
import { candidatesSection, unratedLists, candidateLists, hasCandidates } from '../build/sections/candidates.mjs';
import { directorySection } from '../build/sections/directory.mjs';
import { deriveContext } from '../build/derive.mjs';
import { PER_PASS, RETRY_DAYS } from '../src/rules.js';
import { INSPECTION_CUTOFF_MONTHS } from '../src/census.js';

/* The Candidates section, rendered from a small made-up dataset and queue:
 * one entry and one candidate for each reason a place can be known of and not
 * ranked, plus the ones that must stay out of the lists. */
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
  entry('shut', 'Shut Pies', { status: 'closed' })
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
  permit('Gone Slices', { status: 'rejected', verdict: 'closed', resolvedDate: '2026-09-12', lastInspection: '2025-12-01', note: 'Closed in the spring.' }),
  permit('Back Again', { lastInspection: '2026-11-01', address: undefined,
    previousVerdict: { verdict: 'closed', note: 'Was dark in August.', resolvedDate: '2026-08-31' } })
];

const context = (over = {}) => deriveContext({
  dataset: { city: 'Seattle', dataVersion: 'test', restaurants: restaurants(), attributeRegistry: {} },
  history: { snapshots: [] }, buzz: { updated: null, items: [] },
  candidates: queue(), candidatesChecked: '2026-11-09T20:00:00Z', now: NOW, ...over
});
const groupsOf = html => new Map([...html.matchAll(/<details class="cq-group" data-group="([^"]+)"([^>]*)>([\s\S]*?)<\/details>/g)]
  .map(m => [m[1], { open: / open/.test(m[2]), body: m[3] }]));
const rowsOf = body => [...body.matchAll(/<tr class="cq-row[^"]*">([\s\S]*?)<\/tr>(?:\s*<tr class="cq-note">([\s\S]*?)<\/tr>)?/g)]
  .map(m => ({ cells: m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
               note: (m[2] ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(), html: m[0] }));
const printed = body => Number(body.match(/<span class="cq-n">(\d+)<\/span>/)[1]);

test('unrated entries are split by why they have no rating, and a rested one gets the day it is due', () => {
  const lists = unratedLists(restaurants());
  // Rated and closed entries are not candidates for anything.
  assert.deepEqual(lists.waiting.map(r => r.id), ['covered', 'fresh']);
  assert.deepEqual(lists.looked.map(r => r.id), ['earlier', 'looked']);
  // Not open yet comes before anything else on file for the entry.
  assert.deepEqual(lists.opening.map(r => r.id), ['soon']);
  assert.equal(lists.total, 5);

  const due = iso => new Date(Date.parse(iso) + RETRY_DAYS.rating * 864e5).toISOString().slice(0, 10);
  assert.equal(lists.looked.find(r => r.id === 'looked').eligible, due('2026-10-01'));
  assert.equal(lists.looked.find(r => r.id === 'earlier').eligible, due('2026-06-01'));
});

test('the queue is grouped by where each candidate stands, and duplicates are only counted', () => {
  const q = candidateLists(queue());
  assert.deepEqual(q.pending.map(c => c.name), ['First Pending', 'Back Again']);
  assert.deepEqual(q.chain.map(c => c.name), ['Chain By Name #12', 'Chain By Verdict']);
  assert.deepEqual(q['not-pizza'].map(c => c.name), ['Pasta House']);
  assert.deepEqual(q.unverifiable.map(c => c.name), ['Ghost Kitchen']);
  assert.deepEqual(q.closed.map(c => c.name), ['Gone Slices']);
  assert.equal(q.duplicates, 2);
  assert.equal(q.excluded, 5);
  assert.equal(q.total, queue().length);
  // A missing queue is an empty one.
  assert.equal(candidateLists(null).total, 0);
  assert.equal(candidateLists(undefined).pending.length, 0);
});

test('the section lists every unrated entry with its reason and what happens next', () => {
  const html = candidatesSection(context());
  assert.match(html, /^\s*<section class="section" id="candidates">/);
  const groups = groupsOf(html);

  const waiting = rowsOf(groups.get('rating-waiting').body);
  assert.equal(printed(groups.get('rating-waiting').body), 2);
  // Press on file first: that is the order the rating task draws in.
  assert.deepEqual(waiting.map(r => r.cells), ['Covered Pies Ballard 2 stories', 'Fresh Pies Ballard none']);
  // Linked as the directory links it: the site, or the Instagram when there is no site.
  assert.match(waiting[0].html, /<a href="https:\/\/www\.instagram\.com\/coveredpies"[^>]*>Covered Pies<\/a>/);
  assert.match(waiting[1].html, /<a href="https:\/\/fresh\.example\/"[^>]*>Fresh Pies<\/a>/);

  const looked = rowsOf(groups.get('rating-looked').body);
  assert.equal(printed(groups.get('rating-looked').body), 2);
  // Soonest due first; each row carries the day it was looked at and the day it
  // is due, and a rest that has run out reads as "since" that day.
  assert.equal(looked[0].cells, 'Earlier Pies Ballard Jun 1, 2026 since Aug 30, 2026');
  assert.equal(looked[1].cells, 'Looked &lt;b&gt;Pies&lt;/b&gt; Ballard Oct 1, 2026 Dec 30, 2026');
  // The agent's note is third-party text: printed, and escaped.
  assert.equal(looked[1].note, 'Searched three outlets &amp; found &lt;script&gt;nothing&lt;/script&gt;; the listing says &quot;undefined&quot;.');
  assert.doesNotMatch(html, /<script>|<b>Pies<\/b>/);
  assert.equal(looked[0].note, '');

  const opening = rowsOf(groups.get('rating-opening').body);
  assert.deepEqual(opening.map(r => r.cells), ['Soon Pies Ballard paper.example']);

  const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  assert.ok(text.includes('5 pizzerias are in the directory with no score.'));
  assert.ok(text.includes(`takes up to ${PER_PASS.rating} entries per pass`));
  assert.ok(text.includes(`rests ${RETRY_DAYS.rating} days before it is drawn again`));
  assert.match(text, /at least one piece of published criticism of it: a review, a roundup or a news story/);
  assert.ok(!text.includes('Ranked Pies') && !text.includes('Shut Pies'));
});

test('the section lists the queue by state, with the permit address, the inspection and the note', () => {
  const html = candidatesSection(context());
  const groups = groupsOf(html);
  assert.deepEqual([...groups.keys()],
    ['rating-waiting', 'rating-looked', 'rating-opening', 'pending', 'chain', 'not-pizza', 'unverifiable', 'closed']);

  const pending = rowsOf(groups.get('pending').body);
  assert.equal(printed(groups.get('pending').body), 2);
  assert.equal(pending[0].cells, 'First Pending 100 Pine St, Seattle, WA 98101 Sep 1, 2026 next');
  assert.equal(pending[0].note, '');
  // One that came back says so, with what the earlier pass found.
  assert.equal(pending[1].cells, 'Back Again address not on file Nov 1, 2026 next');
  assert.equal(pending[1].note, 'Back in the queue. A census pass set it aside on Aug 31, 2026 as closed, and the register has recorded an inspection since. What that pass found: Was dark in August.');

  const chain = rowsOf(groups.get('chain').body);
  // Settled on the name alone: no verdict date and no note to print.
  assert.equal(chain[0].cells, 'Chain By Name #12 100 Pine St, Seattle, WA 98101 Sep 1, 2026 by name');
  assert.equal(chain[0].note, '');
  assert.equal(chain[1].cells, 'Chain By Verdict 100 Pine St, Seattle, WA 98101 Sep 1, 2026 Aug 31, 2026');
  assert.equal(chain[1].note, 'A national brand.');
  assert.match(groups.get('chain').body, /Excluded by policy[^<]*It does not come back\./);

  const [pasta] = rowsOf(groups.get('not-pizza').body);
  assert.equal(pasta.cells, 'Pasta House 100 Pine St, Seattle, WA 98101 Nov 5, 2026 Aug 31, 2026');
  // Inspected after its verdict: still under the verdict, and marked as due back.
  assert.equal(pasta.note, 'Due back Inspected since it was set aside: it returns to the queue the next time the register is read. Pasta first; pizza is &lt;i&gt;one&lt;/i&gt; menu item. pasta.example');
  assert.match(pasta.html, /<a href="https:\/\/www\.pasta\.example\/menu"[^>]*rel="noopener nofollow">pasta\.example<\/a>/);
  assert.doesNotMatch(html, /<i>one<\/i>/);

  const [ghost] = rowsOf(groups.get('unverifiable').body);
  assert.equal(ghost.note, 'No trace beyond the permit.');
  const [gone] = rowsOf(groups.get('closed').body);
  assert.equal(gone.cells, 'Gone Slices 100 Pine St, Seattle, WA 98101 Dec 1, 2025 Sep 12, 2026');
  // The three verdicts a later inspection undoes say so; a chain does not.
  for (const key of ['not-pizza', 'unverifiable', 'closed']) {
    assert.match(groups.get(key).body, /Not final: it returns to the queue when the register records an inspection dated after the day it was set aside\./, key);
  }

  // Duplicates are one line with the count, and none of them is named.
  assert.match(html, /<p class="note cq-dupes" data-group="duplicate">\s*<b>2<\/b> more permits are further branches/);
  assert.doesNotMatch(html, /Branch Of Ranked|Second Registration/);

  const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  assert.ok(text.includes(`inspected within the last ${INSPECTION_CUTOFF_MONTHS} months`));
  assert.ok(text.includes(`up to ${PER_PASS.census} per pass`));
  assert.ok(text.includes('The register was last read on Nov 9, 2026.'));
  // The summary's numbers are the lists' lengths.
  const stamp = Object.fromEntries([...html.matchAll(/<span data-count="([a-z]+)">(\d+) /g)].map(m => [m[1], Number(m[2])]));
  assert.deepEqual(stamp, { unrated: 5, pending: 2, excluded: 5, duplicate: 2 });
});

test('a pending candidate is told which census pass reaches it', () => {
  const many = Array.from({ length: PER_PASS.census + 1 }, (_, i) => permit(`Pending ${String(i).padStart(2, '0')}`));
  const groups = groupsOf(candidatesSection(context({ candidates: many })));
  const rows = rowsOf(groups.get('pending').body);
  assert.equal(rows.length, PER_PASS.census + 1);
  // File order is the order the census task takes them in.
  assert.deepEqual(rows.map(r => r.cells.split(' ').slice(0, 2).join(' ')), many.map(c => c.name));
  assert.ok(rows.slice(0, PER_PASS.census).every(r => r.cells.endsWith(' next')));
  assert.ok(rows.at(-1).cells.endsWith(' 2nd'));
});

test('a long group is collapsed and a short one is open, without any script', () => {
  const many = Array.from({ length: 12 }, (_, i) => permit(`Chain ${i}`, { status: 'chain' }));
  const groups = groupsOf(candidatesSection(context({ candidates: [...many, permit('One Pending')] })));
  assert.equal(groups.get('chain').open, false);
  assert.equal(groups.get('pending').open, true);
  // The summary carries the count and the rule, so a closed group still says what it holds.
  assert.match(groups.get('chain').body, /<summary><span class="cq-title">National chain<\/span> <span class="cq-n">12<\/span>\s*<span class="cq-rule">/);
  // Each table names itself and its columns, and each row its subject.
  assert.match(groups.get('chain').body, /<table class="cq-table" aria-label="Candidates excluded as national chains">\s*<thead><tr><th scope="col">Permit name<\/th>/);
  assert.match(groups.get('chain').body, /<tr class="cq-row"><th scope="row">Chain 0/);
});

test('the section renders only what there is, and nothing when there is nothing', () => {
  const allRated = restaurants().filter(r => r.factors || r.status === 'closed');
  const dataset = { city: 'Seattle', dataVersion: 'test', restaurants: allRated, attributeRegistry: {} };

  // No queue file and nobody unrated: no section, and the directory does not link one.
  const empty = context({ dataset, candidates: null });
  assert.equal(candidatesSection(empty), '');
  assert.equal(hasCandidates(empty), false);
  assert.doesNotMatch(directorySection(empty), /href="#candidates"/);

  // Unrated entries and no queue: the first half only.
  const noQueue = candidatesSection(context({ candidates: null }));
  assert.match(noQueue, /id="unranked"/);
  assert.doesNotMatch(noQueue, /id="queue"|cq-dupes|data-count="pending"/);
  assert.match(directorySection(context({ candidates: null })), /are under <a href="#candidates">Candidates<\/a>/);

  // A queue and nobody unrated: the second half only.
  const queueOnly = candidatesSection(context({ dataset }));
  assert.match(queueOnly, /id="queue"/);
  assert.doesNotMatch(queueOnly, /id="unranked"|data-count="unrated"/);

  // A queue of duplicates alone is still worth its one line.
  const dupes = candidatesSection(context({ dataset, candidates: [permit('Branch', { status: 'promoted', matchedId: 'ranked' })] }));
  assert.match(dupes, /<b>1<\/b> more permit is a further branch or a second registration of a pizzeria\s+already on file\. It is tied to that entry and is not listed here\./);
  assert.equal(groupsOf(dupes).size, 0);
});

test('nothing the section prints is a raw missing value', () => {
  // A candidate with nothing but a name, and an entry with nothing but an id and a name.
  const html = candidatesSection(context({
    dataset: { city: 'Seattle', dataVersion: 'test', attributeRegistry: {},
      restaurants: [{ id: 'bare', name: 'Bare Pies', status: 'open' }, { id: 'bare2', name: 'Bare Two', status: 'opening' }] },
    candidates: [{ name: 'Nameless Permit', status: 'pending' }, { name: 'Odd One', status: 'rejected' }],
    candidatesChecked: null
  }));
  const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  assert.doesNotMatch(text, /undefined|NaN|null|Invalid Date|\[object/);
  assert.doesNotMatch(html, /="(undefined|null)"/);
  assert.match(text, /Nameless Permit address not on file not on file next/);
  // Set aside with no verdict on record: listed as that, so the groups add up.
  assert.match(text, /Set aside 1 Set aside by an earlier pass, with no reason on file\./);
  assert.match(text, /Bare Two not on file/);
  assert.doesNotMatch(text, /The register was last read/);
});
