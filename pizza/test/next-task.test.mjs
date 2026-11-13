import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { pickTask, buildTask, lastSuccessFromLog, TYPES, DISPATCH_ONLY } from '../scripts/next-task.mjs';
import { PER_PASS, RETRY_DAYS, ROTATION, LIVENESS_REVISIT_DAYS, CLOSURE_RECONFIRM_DAYS, FACTS_SOUGHT_UNLISTED,
  NEIGHBORHOODS, SERVES_HOODS_PER_PASS, SERVES_SEARCHES_PER_HOOD, SERVES_IN_PASSING,
  factsSought, factsOutstanding, servesSweep } from '../src/rules.js';
import { LOCATION_REVISIT_DAYS } from '../src/locations.js';
import { CAPS, MAX_LEN, validateResearch } from '../src/validate-research.js';
import { applyResearch } from '../scripts/apply-research.mjs';
import { candidateKey, mergeCandidates } from '../src/census.js';

const script = fileURLToPath(new URL('../scripts/next-task.mjs', import.meta.url));
const NOW = Date.parse('2026-11-10T12:00:00Z');
const day = n => Date.parse(`2026-11-${String(n).padStart(2, '0')}T12:00:00Z`);

const RATED = { craft: { value: 8 }, distinctiveness: { value: 7 }, critical: { value: 8 } };
/* A launch rating, typed in by hand, and a rating the agent read from coverage.
 * The launch values are ones no brief prints for any other reason. */
const graded = (setBy, sources) => Object.fromEntries([['craft', 9.3], ['distinctiveness', 8.7], ['critical', 9.1]]
  .map(([k, value]) => [k, { value, setBy, date: '2026-08-26', note: 'A NOTE ON FILE',
    ...(sources?.length ? { source: sources[0], sources } : {}) }]));
const launch = (...sources) => graded('editorial', sources);
const AGENT = graded('agent', ['https://www.thestranger.com/a-review']);
const entry = (id, over = {}) => ({ id, name: id.replace(/-/g, ' '), status: 'open', neighborhood: 'Ballard',
  url: `https://${id}.example`, locations: [], mentions: [], ...over });
/* The whole descriptive record, for an entry the facts task has nothing to find for. */
const DESCRIBED = { opened: 2015, priceIndex: 2, style: 'Wood-fired Neapolitan', styleGroup: 'Neapolitan', signature: 'The margherita' };

/* ---- the picker ---- */
test('rotation: the type whose last successful pass is oldest goes next', () => {
  const ages = { discovery: day(8), locations: day(9), liveness: day(5), news: day(6), rating: day(7), census: day(10), facts: day(11) };
  assert.equal(pickTask('auto', ages), 'liveness');
  assert.equal(pickTask('auto', { ...ages, liveness: day(10) }), 'news');
  assert.equal(pickTask('auto', { ...ages, facts: day(4) }), 'facts');
});

test('rotation: a type with no pass on record goes first, ties in listed order', () => {
  const ages = { discovery: day(8), locations: day(9), liveness: 0, news: day(6), rating: 0, census: day(7), facts: day(5) };
  assert.equal(pickTask('auto', ages), 'liveness');
  assert.equal(pickTask('auto', Object.fromEntries(TYPES.map(t => [t, 0]))), TYPES[0]);
  // facts has never run in the rotation, so its first turn comes at once
  assert.equal(pickTask('auto', { ...ages, liveness: day(1), rating: day(2), facts: 0 }), 'facts');
});

test('rotation: the oldest type is passed over when its worklist is empty', () => {
  const ages = { discovery: day(2), locations: day(3), liveness: day(4), news: day(5), rating: day(1), census: day(6), facts: day(7) };
  assert.equal(pickTask('auto', ages), 'rating');
  assert.equal(pickTask('auto', ages, t => t !== 'rating'), 'discovery');
  assert.equal(pickTask('auto', ages, t => !['rating', 'discovery', 'locations'].includes(t)), 'liveness');
});

test('rotation: census and facts rotate with the daily types, and the backfills stay dispatch-only', () => {
  assert.deepEqual(TYPES, ['discovery', 'locations', 'liveness', 'news', 'rating', 'census', 'facts']);
  // the rotation is the one the page prints
  assert.equal(TYPES, ROTATION);
  assert.deepEqual(DISPATCH_ONLY, ['social', 'coverage', 'sources', 'rerate', 'serves']);
  // Every backfill has a worklist today, and auto mode still never draws one.
  const none = Object.fromEntries(TYPES.map(t => [t, 0]));
  for (let d = 0; d < 12; d++) {
    assert.ok(TYPES.includes(pickTask('auto', none, () => true, d)));
    assert.ok(TYPES.includes(pickTask('auto', null, () => true, d)));
    assert.ok(TYPES.includes(pickTask('auto', none, () => false, d)));
  }
});

test('census: a seed with pending candidates is worked without a dispatch, and an empty one is passed over', () => {
  // The last census pass is months old, as it is whenever the queue has been dry.
  const ages = { discovery: day(5), locations: day(6), liveness: day(7), news: day(8), rating: day(9),
    census: Date.parse('2026-09-12T12:50:00Z'), facts: day(10) };
  const rs = [entry('a-pie'), entry('b-pie')];
  const hasWork = candidates => t => buildTask(t, rs, { now: NOW, candidates }).worklistSize !== 0;

  const dry = [{ name: 'Ghost', status: 'rejected' }, { name: 'A Pie', status: 'promoted' }];
  assert.equal(buildTask('census', rs, { now: NOW, candidates: dry }).worklistSize, 0);
  assert.equal(pickTask('auto', ages, hasWork(dry)), 'discovery');
  assert.equal(pickTask('auto', ages, hasWork([])), 'discovery');

  const refreshed = [...dry, { name: 'Pizza Rasoi', status: 'pending', address: '1011 Valley St, Seattle, WA 98109' }];
  assert.equal(pickTask('auto', ages, hasWork(refreshed)), 'census');
  // Once that pass is committed census is the newest type and takes its turn.
  assert.equal(pickTask('auto', { ...ages, census: day(10) }, hasWork(refreshed)), 'discovery');
  // With no history, census has its own day and gives it up when the queue is dry.
  const censusDay = TYPES.map((_, n) => n).find(n => TYPES[n % TYPES.length] === 'census');
  assert.equal(pickTask('auto', null, hasWork(refreshed), censusDay), 'census');
  assert.equal(pickTask('auto', null, hasWork(dry), censusDay), TYPES[(censusDay + 1) % TYPES.length]);
});

test('rotation: a forced type is returned even with an empty worklist', () => {
  const ages = Object.fromEntries(TYPES.map(t => [t, 0]));
  for (const t of [...TYPES, ...DISPATCH_ONLY]) assert.equal(pickTask(t, ages, () => false), t);
});

test('rotation: an unrecognised argument means auto', () => {
  const ages = { discovery: day(2), locations: day(3), liveness: day(4), news: day(5), rating: day(1), census: day(6), facts: day(7) };
  assert.equal(pickTask('nonsense', ages), 'rating');
});

test('rotation: with no usable history the order starts from the UTC day', () => {
  for (let d = 0; d < TYPES.length; d++) assert.equal(pickTask('auto', null, () => true, 20000 + d), TYPES[(20000 + d) % TYPES.length]);
  // Seven types, so each has one day in seven, facts among them.
  const days = TYPES.map((_, i) => 20000 + i);
  assert.deepEqual(days.map(d => pickTask('auto', null, () => true, d)).sort(), [...TYPES].sort());
  // On rating's day, with nothing to rate, the day goes to the type after it.
  const d = days.find(n => TYPES[n % TYPES.length] === 'rating');
  assert.equal(pickTask('auto', null, t => t !== 'rating', d), TYPES[(d + 1) % TYPES.length]);
  // On facts' day, with every gap already tried, it wraps round to the first type.
  const f = days.find(n => TYPES[n % TYPES.length] === 'facts');
  assert.equal(pickTask('auto', null, t => t !== 'facts', f), TYPES[(f + 1) % TYPES.length]);
  assert.equal(TYPES[(f + 1) % TYPES.length], 'discovery');
});

/* ---- reading the history ---- */
test('history: only the subject the research workflow writes counts as a pass', () => {
  const log = [
    '2026-11-09T12:50:00+00:00\tchore(data): research pass (locations) 2026-11-09',
    '2026-11-08T12:50:00+00:00\tfix(pizza): stop research pass (rating) deadlocking the rotation',
    '2026-11-08T12:40:00+00:00\tRevert "chore(data): research pass (rating) 2026-11-07"',
    '2026-11-07T12:50:00+00:00\tchore(data): research pass (rating) 2026-11-07',
    '2026-11-06T12:50:00+00:00\tchore(data): research pass (social) 2026-11-06',
    '2026-11-04T12:50:00+00:00\tchore(data): research pass (locations) 2026-11-04',
    '2026-09-01T12:50:00+00:00\tchore(data): research pass 2026-09-01',
    ''
  ].join('\n');
  assert.deepEqual(lastSuccessFromLog(log), {
    discovery: 0, locations: Date.parse('2026-11-09T12:50:00Z'), liveness: 0, news: 0,
    rating: Date.parse('2026-11-07T12:50:00Z'), census: 0, facts: 0
  });
  // A facts pass dispatched while the task was a backfill is a pass on record.
  assert.equal(lastSuccessFromLog('2026-11-05T12:50:00+00:00\tchore(data): research pass (facts) 2026-11-05').facts,
    Date.parse('2026-11-05T12:50:00Z'));
  // A dispatched census pass counts like any other, so the type then waits its turn.
  assert.equal(lastSuccessFromLog('2026-09-12T12:50:00+00:00\tchore(data): research pass (census) 2026-09-12').census,
    Date.parse('2026-09-12T12:50:00Z'));
  assert.deepEqual(lastSuccessFromLog(''), Object.fromEntries(TYPES.map(t => [t, 0])));
});

/* ---- worklists ---- */
test('rating: an empty worklist is size 0, and auto mode moves on from it', () => {
  const rs = [
    entry('rated-pie', { factors: RATED }),
    entry('tried-last-week', { ratingAttempted: '2026-11-07' }),
    entry('not-open-yet', { status: 'opening' }),
    entry('gone-pie', { status: 'closed' })
  ];
  assert.equal(buildTask('rating', rs, { now: NOW }).worklistSize, 0);

  const ages = { discovery: day(2), locations: day(3), liveness: day(4), news: day(5), rating: day(1), census: day(6), facts: day(7) };
  const hasWork = t => buildTask(t, rs, { now: NOW }).worklistSize !== 0;
  assert.equal(pickTask('auto', ages, hasWork), 'discovery');
  // Forced, the same empty worklist is what the workflow's skip=true reports.
  assert.equal(pickTask('rating', ages, hasWork), 'rating');
});

test('rating: an attempt older than 90 days is drawn again', () => {
  const rs = [entry('tried-in-july', { ratingAttempted: '2026-07-01' }), entry('never-tried')];
  const { brief, worklistSize } = buildTask('rating', rs, { now: NOW });
  assert.equal(worklistSize, 2);
  assert.match(brief, /- id: tried-in-july \|/);
});

test('discovery and news have no worklist, so they always qualify', () => {
  assert.equal(buildTask('discovery', [], { now: NOW }).worklistSize, null);
  assert.equal(buildTask('news', [], { now: NOW }).worklistSize, null);
});

test('every type builds a brief from an empty dataset without throwing', () => {
  for (const t of [...TYPES, ...DISPATCH_ONLY]) {
    const { brief, worklistSize } = buildTask(t, [], { now: NOW });
    assert.equal(typeof brief, 'string');
    assert.ok(worklistSize === null || worklistSize === 0, t);
  }
});

test('census draws pending candidates only', () => {
  const candidates = [{ name: 'Lead One', status: 'pending', address: '1 A St' }, { name: 'Ghost', status: 'rejected' }];
  const { brief, worklistSize } = buildTask('census', [entry('a-pie')], { now: NOW, candidates });
  assert.equal(worklistSize, 1);
  assert.match(brief, /- "Lead One" \| 1 A St/);
  assert.doesNotMatch(brief, /Ghost/);
});

test('census brief: lists the entries on file by id and asks a duplicate to name one', () => {
  const candidates = [{ name: 'Lead One', status: 'pending', address: '1 A St' }];
  const rs = [entry('zed-pie', { name: 'Zed Pie' }), entry('a-pizza-mart-first-hill', { name: 'A Pizza Mart (First Hill)' })];
  const { brief } = buildTask('census', rs, { now: NOW, candidates });
  assert.match(brief, /\na-pizza-mart-first-hill = A Pizza Mart \(First Hill\)\nzed-pie = Zed Pie\n/);
  assert.match(brief, /"duplicateOf":"<id of the entry on file, for a duplicate only>"/);
  assert.match(brief, /"duplicateOf" is that entry's id from the list\s+above, and is required/);
  // The brief is the agent's whole instruction, and it has no shell.
  assert.doesNotMatch(brief, /\.mjs|\.js\b|matchedId|candidates\.json/);
});

/* ---- attempt memory for the coverage and social backfills ---- */
const ids = (brief) => [...brief.matchAll(/^- id: (\S+) \|/gm)].map(m => m[1]);

test('coverage: an entry attempted yesterday is not drawn; never-attempted entries lead', () => {
  const rs = [
    entry('tried-yesterday', { coverageAttempted: '2026-11-09' }),
    entry('tried-in-july', { coverageAttempted: '2026-07-01' }),
    entry('never-tried-one-mention', { mentions: [{ url: 'https://www.seattlemet.com/a', title: 'A review', date: '2026-03-01' }] }),
    entry('never-tried'),
    entry('never-tried-rated', { factors: RATED }),
    entry('not-open-yet', { status: 'opening' }),
    entry('gone-pie', { status: 'closed' })
  ];
  const { brief, worklistSize } = buildTask('coverage', rs, { now: NOW });
  assert.equal(worklistSize, 4);
  assert.deepEqual(ids(brief), ['never-tried-rated', 'never-tried', 'never-tried-one-mention', 'tried-in-july']);
  assert.match(brief, /"coverageSkipped" record/);
});

test('coverage: the rest is 90 days to the day, and a list of rested entries is empty', () => {
  const rs = [entry('a', { coverageAttempted: '2026-08-12T12:00:00Z' }), entry('b', { coverageAttempted: '2026-08-13' })];
  assert.deepEqual(ids(buildTask('coverage', rs, { now: NOW }).brief), ['a']);
  assert.equal(buildTask('coverage', [entry('b', { coverageAttempted: '2026-11-09' })], { now: NOW }).worklistSize, 0);
});

test('coverage brief: each row names the stories on file by outlet and date, newest first', () => {
  const mention = (host, date) => ({ url: `https://${host}/story`, title: 'A headline', source: 'An outlet', date, kind: 'mention' });
  const rs = [
    entry('none-on-file'),
    entry('one-on-file', { mentions: [mention('www.seattlemet.com', '2026-03-01')] }),
    entry('six-on-file', { mentions: ['2025-01-01', '2026-06-01', '2025-03-01', '2025-04-01', '2025-05-01', '2025-02-01']
      .map(d => mention('www.thestranger.com', d)) })
  ];
  const { brief } = buildTask('coverage', rs, { now: NOW });
  assert.match(brief, /- id: none-on-file \| .* \| no mentions on file\n/);
  assert.match(brief, /- id: one-on-file \| .* \| 1 mention\(s\) on file: seattlemet\.com 2026-03-01\n/);
  assert.match(brief, /- id: six-on-file \| .* \| 6 mention\(s\) on file: thestranger\.com 2026-06-01, thestranger\.com 2025-05-01, thestranger\.com 2025-04-01, thestranger\.com 2025-03-01, and 2 older\n/);
  // Headlines are third-party text and stay out of the brief.
  assert.doesNotMatch(brief, /A headline|An outlet/);
});

test('social: an entry attempted yesterday is not drawn; never-attempted entries lead, no-website first', () => {
  const rs = [
    entry('tried-yesterday', { url: null, socialAttempted: '2026-11-09' }),
    entry('tried-in-july', { url: null, socialAttempted: '2026-07-01' }),
    entry('tried-in-june-has-site', { socialAttempted: '2026-06-01' }),
    entry('never-tried-has-site'),
    entry('never-tried-no-site', { url: null, instagram: 'https://www.instagram.com/never_tried/' }),
    entry('complete', { instagram: 'https://www.instagram.com/complete/' }),
    entry('gone-pie', { status: 'closed', url: null })
  ];
  for (let run = 0; run < 20; run++) {
    const { brief, worklistSize } = buildTask('social', rs, { now: NOW });
    assert.equal(worklistSize, 4);
    assert.deepEqual(ids(brief), ['never-tried-no-site', 'never-tried-has-site', 'tried-in-june-has-site', 'tried-in-july']);
  }
  assert.match(buildTask('social', rs, { now: NOW }).brief, /"socialSkipped" record/);
  assert.equal(buildTask('social', [entry('tried-yesterday', { socialAttempted: '2026-11-09' })], { now: NOW }).worklistSize, 0);
});

test('a pass that resolves nothing can report its whole worklist: every skipped section holds one', () => {
  const many = Array.from({ length: 40 }, (_, i) => entry(`pie-${String(i).padStart(2, '0')}`, { url: null }));
  const size = t => buildTask(t, many, { now: NOW }).worklistSize;
  assert.ok(size('rating') <= CAPS.ratingSkipped);
  assert.ok(size('facts') <= CAPS.factsSkipped);
  assert.ok(size('locations') <= CAPS.locationsSkipped);
  assert.ok(size('coverage') <= CAPS.coverageSkipped);
  assert.ok(size('social') <= CAPS.socialSkipped);
  assert.equal(size('social'), 15);
});

/* ---- the numbers every worklist draws with ---- */
test('rules: every worklist takes the number of entries rules.js states, and no other', () => {
  assert.deepEqual(PER_PASS, { rating: 6, rerate: 7, locations: 5, liveness: 6, census: 10, facts: 12, coverage: 10, social: 15, sources: 5,
    serves: 16 });
  assert.deepEqual(RETRY_DAYS, { rating: 90, facts: 90, coverage: 90, social: 90 });
  assert.deepEqual([LOCATION_REVISIT_DAYS, LIVENESS_REVISIT_DAYS, CLOSURE_RECONFIRM_DAYS], [30, 14, 90]);

  const many = Array.from({ length: 40 }, (_, i) => entry(`pie-${String(i).padStart(2, '0')}`, { url: null }));
  const rated = many.map(r => ({ ...r, factors: launch() }));
  const candidates = many.map(r => ({ name: r.name, status: 'pending', address: '1 A St' }));
  const size = (t, rs = many) => buildTask(t, rs, { now: NOW, candidates }).worklistSize;
  for (const t of ['rating', 'locations', 'liveness', 'census', 'facts', 'coverage', 'social']) assert.equal(size(t), PER_PASS[t], t);
  for (const t of ['rerate', 'sources']) assert.equal(size(t, rated), PER_PASS[t], t);
});

test('rules: each rest ends on the day rules.js states', () => {
  const ago = n => new Date(NOW - n * 864e5).toISOString();
  const drawn = (t, over) => buildTask(t, [entry('a-pie', over)], { now: NOW }).worklistSize === 1;
  for (const [t, stamp] of [['rating', 'ratingAttempted'], ['coverage', 'coverageAttempted'], ['social', 'socialAttempted']]) {
    assert.equal(drawn(t, { url: null, [stamp]: ago(RETRY_DAYS[t] - 1) }), false, t);
    assert.equal(drawn(t, { url: null, [stamp]: ago(RETRY_DAYS[t]) }), true, t);
  }
  const sought = { factsSought: ['opened', 'priceIndex', 'style', 'styleGroup', 'signature'] };
  assert.equal(drawn('facts', { ...sought, factsAttempted: ago(RETRY_DAYS.facts - 1) }), false);
  assert.equal(drawn('facts', { ...sought, factsAttempted: ago(RETRY_DAYS.facts) }), true);
  assert.equal(drawn('rerate', { factors: launch(), ratingAttempted: ago(RETRY_DAYS.rating - 1) }), false);
  assert.equal(drawn('rerate', { factors: launch(), ratingAttempted: ago(RETRY_DAYS.rating) }), true);
  assert.equal(drawn('locations', { locationsAttempted: ago(LOCATION_REVISIT_DAYS - 1) }), false);
  assert.equal(drawn('locations', { locationsAttempted: ago(LOCATION_REVISIT_DAYS) }), true);
});

/* ---- facts: the descriptive record ---- */
test('facts: open entries missing any of the five; rated first, then most missing, then never tried, then id', () => {
  const three = { factors: RATED, style: 'New York slices', styleGroup: 'By the slice' };
  const rs = [
    entry('complete', { factors: RATED, ...DESCRIBED }),
    entry('unrated-complete', { ...DESCRIBED }),
    entry('not-open-yet', { status: 'opening' }),
    entry('gone-pie', { status: 'closed' }),
    entry('unrated-two', { opened: 2015, priceIndex: 2, style: 'New York slices' }),
    entry('unrated-all-five'),
    entry('rated-one', { factors: RATED, ...DESCRIBED, signature: null }),
    entry('rated-three-tried-in-july', { ...three, factsAttempted: '2026-07-01', factsSought: ['opened', 'priceIndex', 'signature'] }),
    entry('rated-three-b', three),
    entry('rated-three-a', three),
    entry('rated-four', { factors: RATED, styleGroup: 'By the slice' })
  ];
  for (const order of [rs, [...rs].reverse()]) {
    const { brief, worklistSize } = buildTask('facts', order, { now: NOW });
    assert.equal(worklistSize, 7);
    assert.deepEqual(ids(brief), ['rated-four', 'rated-three-a', 'rated-three-b', 'rated-three-tried-in-july', 'rated-one',
      'unrated-all-five', 'unrated-two']);
  }
});

test('facts brief: each row lists exactly the facts that entry lacks', () => {
  const rs = [
    entry('all-five', { url: null }),
    entry('year-and-pie', { priceIndex: 2, style: 'New York slices', styleGroup: 'By the slice' }),
    entry('group-only', { ...DESCRIBED, styleGroup: null }),
    entry('blank-style', { ...DESCRIBED, style: '' })
  ];
  const { brief } = buildTask('facts', rs, { now: NOW });
  assert.match(brief, /^- id: all-five \| all five \| site: unknown \| missing: opened, priceIndex, style, styleGroup, signature$/m);
  assert.match(brief, /^- id: year-and-pie \| year and pie \| site: https:\/\/year-and-pie\.example \| missing: opened, signature$/m);
  assert.match(brief, /^- id: group-only \| .* \| missing: styleGroup$/m);
  assert.match(brief, /^- id: blank-style \| .* \| missing: style$/m);
});

test('facts brief: says what each fact is, where it may come from, and asks for factsSkipped', () => {
  const rs = [entry('to-fill'), entry('a', { ...DESCRIBED, styleGroup: 'Roman' }), entry('b', { ...DESCRIBED, styleGroup: 'Detroit pan' })];
  const { brief } = buildTask('facts', rs, { now: NOW });
  assert.match(brief, /^Your task: complete the descriptive record of these pizzerias/);
  for (const part of ['- opened: ', '- priceIndex: ', '- style: ', '- styleGroup: ', '- signature: ',
    '"style": "<short phrase>","styleGroup": "<short label>"', '"signature": "<the pie it is known for>"',
    '"source": "<https page that states them>"']) {
    assert.ok(brief.includes(part), part);
  }
  // the style groups already in use, which is the vocabulary the rating task offers too
  assert.match(brief, /Pick from the groups\n  already in use when one fits --\n  Detroit pan; Roman --\n  or coin a short new one/);
  assert.ok(buildTask('rating', rs, { now: NOW }).brief.includes('  Detroit pan; Roman -- or coin'));
  // the caps the validator holds a record to
  assert.ok(brief.includes(`in at most ${MAX_LEN.signature}\n  characters`));
  assert.match(brief, /\(3 to 24 characters\)/);
  // one page a record, a second record for a second page
  assert.match(brief, /carrying only the facts its one source page states\./);
  assert.match(brief, /another record for the same id, with that page as\nits source; never report the same fact twice for one entry\./);
  // where a description may come from
  assert.match(brief, /The source for style, styleGroup and signature is the pizzeria's own\nsite or menu, or published coverage of it/);
  assert.match(brief, /A review aggregator, a delivery app or a directory listing\nis never one/);
  assert.match(brief, /Never infer a year from a domain registration, a\n  review date or a photo\./);
  // what the first dry run showed the brief had to say outright
  assert.match(brief, /A dated opening story that gives the day and not the year is\n  enough/);
  assert.match(brief, /a "\$\$" symbol is not a price/);
  assert.match(brief, /Write the pie itself, not a sentence about it/);
  assert.match(brief, /a fact already on file is never replaced/);
  // attempt memory, and it may sit beside a partial find
  assert.match(brief, /report a "factsSkipped" record \(\{"id","note"\}/);
  assert.match(brief, /It may sit\nbeside a "facts" record for the part you did find/);
  assert.match(brief, new RegExp(`Budget: about 2 searches per entry, ${2 * PER_PASS.facts} in total\\.$`));
  // The brief is the agent's whole instruction, and it has no shell.
  assert.doesNotMatch(brief, /\.mjs|\.js\b|factsSought|factsAttempted|restaurants\.json/);
});

test('facts: an entry searched for its year and its tier alone is still drawn for the other three', () => {
  // Stamped by the task when it asked for two facts: a day, and no list.
  const twoField = { factsAttempted: '2026-11-05', factsNote: 'no page states a founding year' };
  assert.deepEqual(FACTS_SOUGHT_UNLISTED, ['opened', 'priceIndex']);
  const rs = [
    entry('owed-three', { ...twoField, priceIndex: 2 }),
    entry('owed-signature', { ...twoField, style: 'New York slices', styleGroup: 'By the slice' }),
    entry('owed-nothing', { ...twoField, style: 'New York slices', styleGroup: 'By the slice', signature: 'The plain slice' }),
    entry('owed-nothing-listed', { ...twoField, factsSought: [] , ...DESCRIBED, opened: null })
  ];
  assert.deepEqual(factsSought(rs[0]), ['opened', 'priceIndex']);
  assert.deepEqual(factsOutstanding(rs[0], NOW), ['style', 'styleGroup', 'signature']);
  assert.deepEqual(factsOutstanding(rs[1], NOW), ['signature']);
  // only the year and the tier are missing, and those were looked for last week
  assert.deepEqual(factsOutstanding(rs[2], NOW), []);
  assert.deepEqual(factsOutstanding(rs[3], NOW), []);

  const { brief, worklistSize } = buildTask('facts', rs, { now: NOW });
  assert.equal(worklistSize, 2);
  assert.deepEqual(ids(brief), ['owed-three', 'owed-signature']);
  // the row lists everything missing, the year included: the pass is on the site anyway
  assert.match(brief, /^- id: owed-three \| .* \| missing: opened, style, styleGroup, signature$/m);
  assert.match(brief, /^- id: owed-signature \| .* \| missing: opened, priceIndex, signature$/m);

  // once the rest is over the two-field attempt counts for nothing
  const later = NOW + RETRY_DAYS.facts * 864e5;
  assert.deepEqual(factsOutstanding(rs[2], later), ['opened', 'priceIndex']);
  assert.equal(buildTask('facts', rs, { now: later }).worklistSize, 4);
});

test('facts: an attempt rests an entry for the facts it looked for, and for no others', () => {
  const tried = (factsSought, over = {}) => entry('a-pie', { factsAttempted: '2026-11-09', factsSought, ...over });
  // everything missing was looked for: rests
  assert.deepEqual(factsOutstanding(tried(['opened', 'priceIndex', 'style', 'styleGroup', 'signature']), NOW), []);
  assert.equal(buildTask('facts', [tried(['opened', 'priceIndex', 'style', 'styleGroup', 'signature'])], { now: NOW }).worklistSize, 0);
  // the list covers what is still missing, whatever else it names
  assert.deepEqual(factsOutstanding(tried(['opened', 'signature'], { priceIndex: 2, style: 'Roman al taglio', styleGroup: 'Roman' }), NOW), []);
  // a fact the attempt never looked for is still owed
  assert.deepEqual(factsOutstanding(tried(['signature'], { style: 'Roman al taglio' }), NOW), ['opened', 'priceIndex', 'styleGroup']);
  // never attempted: everything missing is owed, and a list with no stamp means nothing
  assert.deepEqual(factsOutstanding(entry('b-pie'), NOW), ['opened', 'priceIndex', 'style', 'styleGroup', 'signature']);
  assert.deepEqual(factsSought(entry('b-pie', { factsSought: ['signature'] })), []);
  assert.deepEqual(factsOutstanding(entry('b-pie', { factsAttempted: null, factsSought: ['signature'], ...DESCRIBED, signature: null }), NOW), ['signature']);
  // nothing missing: nothing owed
  assert.deepEqual(factsOutstanding(entry('c-pie', DESCRIBED), NOW), []);
});

test('facts: no entry is drawn twice inside a rest, so passes that find nothing still empty the worklist', () => {
  // 30 entries: some never attempted, some stamped by the two-field task, some
  // with part of their record on file. Every pass finds nothing and says so.
  const rs = Array.from({ length: 30 }, (_, i) => entry(`pie-${String(i).padStart(2, '0')}`, {
    ...(i % 3 === 0 ? { factsAttempted: '2026-11-05', factsNote: 'no page states a founding year' } : {}),
    ...(i % 4 === 0 ? { style: 'New York slices', priceIndex: 1 } : {}),
    ...(i % 5 === 0 ? { factors: RATED } : {})
  }));
  const dataset = { city: 'Seattle', dataVersion: '2026.11', restaurants: rs };
  const seen = [];
  let passes = 0;
  for (; passes < 10; passes++) {
    const { brief, worklistSize } = buildTask('facts', dataset.restaurants, { now: NOW });
    if (!worklistSize) break;
    seen.push(...ids(brief));
    applyResearch({ factsSkipped: ids(brief).map(id => ({ id, note: 'searched its site and local coverage; nothing stated' })) },
      { dataset }, '2026-11-10');
  }
  assert.equal(passes, Math.ceil(30 / PER_PASS.facts));
  assert.equal(new Set(seen).size, seen.length);
  assert.equal(seen.length, 30);
  // and a quarter on, every one of them is owed a look again
  assert.equal(buildTask('facts', dataset.restaurants, { now: NOW + (RETRY_DAYS.facts + 1) * 864e5 }).worklistSize, PER_PASS.facts);
});

test('facts: a partial find with a factsSkipped beside it rests the entry; without one it is drawn again for less', () => {
  const run = research => {
    const dataset = { city: 'Seattle', dataVersion: '2026.11', restaurants: [entry('a-pie')] };
    applyResearch(research, { dataset }, '2026-11-10');
    return buildTask('facts', dataset.restaurants, { now: NOW });
  };
  const found = { facts: [{ id: 'a-pie', opened: 2015, priceIndex: 2, source: 'https://a-pie.example/about' }] };
  assert.equal(run({ ...found, factsSkipped: [{ id: 'a-pie', note: 'no page describes the pizza or names a pie' }] }).worklistSize, 0);
  const again = run(found);
  assert.equal(again.worklistSize, 1);
  assert.match(again.brief, /^- id: a-pie \| .* \| missing: style, styleGroup, signature$/m);
});

test('facts rotates: it takes its turn while an entry is owed a look, and is passed over once none is', () => {
  const ages = { discovery: day(5), locations: day(6), liveness: day(7), news: day(8), rating: day(9), census: day(10),
    facts: Date.parse('2026-09-12T12:50:00Z') };
  const hasWork = rs => t => buildTask(t, rs, { now: NOW }).worklistSize !== 0;
  const owed = [entry('a-pie'), entry('b-pie', { factors: RATED, ...DESCRIBED })];
  assert.equal(pickTask('auto', ages, hasWork(owed)), 'facts');
  // once that pass is committed facts is the newest type and waits its turn
  assert.equal(pickTask('auto', { ...ages, facts: day(11) }, hasWork(owed)), 'discovery');

  const complete = [entry('b-pie', { factors: RATED, ...DESCRIBED })];
  assert.equal(buildTask('facts', complete, { now: NOW }).worklistSize, 0);
  assert.equal(pickTask('auto', ages, hasWork(complete)), 'discovery');
  // every gap tried within the rest is no work either
  const tried = [entry('a-pie', { factsAttempted: '2026-11-09', factsSought: ['opened', 'priceIndex', 'style', 'styleGroup', 'signature'] })];
  assert.equal(pickTask('auto', ages, hasWork(tried)), 'discovery');
  // forced, the empty worklist is what the workflow's skip=true reports
  assert.equal(pickTask('facts', ages, hasWork(complete)), 'facts');
  // with no history it has its own day, and gives it up the same way
  const factsDay = TYPES.map((_, n) => n).find(n => TYPES[n % TYPES.length] === 'facts');
  assert.equal(pickTask('auto', null, hasWork(owed), factsDay), 'facts');
  assert.equal(pickTask('auto', null, hasWork(complete), factsDay), TYPES[(factsDay + 1) % TYPES.length]);
});

/* ---- census: a candidate the register reopened ---- */
test('census brief: a candidate that came back shows what was found before, and says why it is back', () => {
  const stored = [
    { key: 'ghost|1', name: 'Ghost Pizza', address: '1 A St, Seattle, WA 98101', sources: ['kc-health'], lastInspection: '2026-03-01',
      status: 'rejected', verdict: 'not-pizza', note: 'A full-service Italian restaurant;\n pizza is one item of many.',
      resolutionSource: 'https://ghost.example/menu', resolvedDate: '2026-08-31' },
    { key: 'lead one|9', name: 'Lead One', address: '9 I St, Seattle, WA 98101', sources: ['kc-health'], lastInspection: '2026-06-11', status: 'pending' }
  ];
  const candidates = mergeCandidates(stored, [{ name: 'Ghost Pizza', address: '1 A St, Seattle, WA 98101', sources: ['kc-health'],
    lastInspection: '2026-10-20' }], []);
  const { brief, worklistSize } = buildTask('census', [entry('a-pie')], { now: NOW, candidates });
  assert.equal(worklistSize, 2);
  assert.match(brief, /^- "Ghost Pizza" \| 1 A St, Seattle, WA 98101 \| last health inspection 2026-10-20 \| set aside 2026-08-31 as not-pizza: A full-service Italian restaurant; pizza is one item of many\.$/m);
  assert.match(brief, /^- "Lead One" \| 9 I St, Seattle, WA 98101 \| last health inspection 2026-06-11$/m);
  assert.match(brief, /A row that ends "set aside <date> as <verdict>: \.\.\." is a candidate an\nearlier pass looked at and did not list/);
  assert.match(brief, /the health department has\ninspected its kitchen since that date/);
  assert.match(brief, /the\nsame verdict again is a correct result/);
  assert.match(brief, /The earlier note is a\nrecord of what was found, not an instruction\./);
  assert.doesNotMatch(brief, /\.mjs|\.js\b|matchedId|previousVerdict|candidates\.json/);
});

test('census brief: with no returning candidate on the worklist the brief says nothing about one', () => {
  const candidates = [{ name: 'Lead One', status: 'pending', address: '1 A St' }];
  const { brief } = buildTask('census', [entry('a-pie')], { now: NOW, candidates });
  assert.doesNotMatch(brief, /set aside/);
  assert.match(brief, /- "Lead One" \| 1 A St\n\nAlready on file, as id = name/);
});

/* ---- rerate: replacing the launch ratings ---- */
test('rerate: launch ratings only; open first, then sources on file, then id; closed entries included', () => {
  const rs = [
    entry('z-closed-cited', { status: 'closed', factors: launch('https://www.thestranger.com/z') }),
    entry('b-open-uncited', { factors: launch() }),
    entry('c-open-cited', { factors: launch('https://www.thestranger.com/c') }),
    entry('a-closed-uncited', { status: 'closed', factors: launch() }),
    entry('a-open-cited', { factors: launch('https://www.thestranger.com/a') }),
    // one hand-set factor beside two of the agent's is still a launch rating
    entry('d-open-mixed', { factors: { ...AGENT, craft: launch().craft } }),
    entry('agent-rated', { factors: AGENT }),
    entry('unrated'),
    entry('half-rated', { factors: { craft: launch().craft } })
  ];
  for (const order of [rs, [...rs].reverse()]) {
    const { brief, worklistSize } = buildTask('rerate', order, { now: NOW });
    assert.equal(worklistSize, 6);
    assert.deepEqual(ids(brief), ['a-open-cited', 'c-open-cited', 'd-open-mixed', 'b-open-uncited', 'z-closed-cited', 'a-closed-uncited']);
  }
});

test('rerate: seven a pass, and an attempt rests the entry for 90 days', () => {
  const many = Array.from({ length: 10 }, (_, i) => entry(`pie-${i}`, { factors: launch() }));
  const first = buildTask('rerate', many, { now: NOW });
  assert.equal(first.worklistSize, 7);
  assert.deepEqual(ids(first.brief), ['pie-0', 'pie-1', 'pie-2', 'pie-3', 'pie-4', 'pie-5', 'pie-6']);
  // a pass that grounds nothing, or everything, fits the sections it reports in
  assert.ok(first.worklistSize <= CAPS.ratingSkipped && first.worklistSize <= CAPS.factorRatings);

  const rs = [
    entry('tried-yesterday', { factors: launch(), ratingAttempted: '2026-11-09' }),
    entry('tried-89-days-ago', { factors: launch(), ratingAttempted: '2026-08-13' }),
    entry('tried-90-days-ago', { factors: launch(), ratingAttempted: '2026-08-12T12:00:00Z' }),
    entry('never-tried', { factors: launch() })
  ];
  assert.deepEqual(ids(buildTask('rerate', rs, { now: NOW }).brief), ['never-tried', 'tried-90-days-ago']);
  assert.equal(buildTask('rerate', rs.slice(0, 2), { now: NOW }).worklistSize, 0);
  // once the agent has rated an entry it is off the list for good
  assert.equal(buildTask('rerate', [entry('done', { factors: AGENT, ratingAttempted: '2026-01-01' })], { now: NOW }).worklistSize, 0);
});

test('rerate brief: lists the sources on file to start from and never the rating being replaced', () => {
  const rs = [
    entry('cited', { factors: launch('https://www.theinfatuation.com/seattle/reviews/cited', 'https://www.thestranger.com/cited') }),
    entry('many-cited', { factors: { ...launch('https://x.example/1', 'https://x.example/2', 'https://x.example/3'),
      critical: launch('https://x.example/3', 'https://x.example/4', 'https://x.example/5').critical } }),
    entry('single-source', { factors: Object.fromEntries(Object.entries(launch()).map(([k, f]) =>
      [k, { ...f, source: 'https://x.example/only' }])) }),
    entry('uncited', { factors: launch() }),
    entry('gone-pie', { status: 'closed', factors: launch('https://www.seattlemet.com/gone') })
  ];
  const { brief } = buildTask('rerate', rs, { now: NOW });
  assert.match(brief, /^- id: cited \| cited \| Ballard \| site: https:\/\/cited\.example \| on file: https:\/\/www\.theinfatuation\.com\/seattle\/reviews\/cited https:\/\/www\.thestranger\.com\/cited$/m);
  // one list per entry across its three factors, each URL once, four at most
  assert.match(brief, /^- id: many-cited \| .* \| on file: https:\/\/x\.example\/1 https:\/\/x\.example\/2 https:\/\/x\.example\/3 https:\/\/x\.example\/4$/m);
  assert.match(brief, /^- id: single-source \| .* \| on file: https:\/\/x\.example\/only$/m);
  assert.match(brief, /^- id: uncited \| uncited \| Ballard \| site: https:\/\/uncited\.example \| no sources on file$/m);
  // a closed entry is marked, and its site is not offered
  assert.match(brief, /^- id: gone-pie \| gone pie \| Ballard \| closed \| on file: https:\/\/www\.seattlemet\.com\/gone$/m);
  assert.doesNotMatch(brief, /gone-pie\.example/);
  // nothing of the rating on file: no value, no provenance, no note
  assert.doesNotMatch(brief, /9\.3|8\.7|9\.1|editorial|2026-08-26|A NOTE ON FILE/);
  assert.match(brief, /already in the ranking/);
  assert.match(brief, /derived afresh from what has been published/);
  assert.match(brief, /about 2 searches or fetches per entry/);
});

test('rerate brief: holds a rating to the standard the rating brief sets, word for word', () => {
  const rs = [entry('to-rate', { styleGroup: 'Roman' }), entry('to-rerate', { factors: launch(), styleGroup: 'Neapolitan' })];
  const standard = brief => /\nFor each one, read [\s\S]*two years old counts\.\n/.exec(brief)?.[0];
  const rating = buildTask('rating', rs, { now: NOW }).brief;
  const rerate = buildTask('rerate', rs, { now: NOW }).brief;
  assert.ok(standard(rating).length > 1000);
  assert.equal(standard(rerate), standard(rating));
  for (const part of ['- craft: ', '- distinctiveness: ', '- criticScore: ', '- opened: ', '- priceIndex: ',
    '- styleGroup: ', 'Neapolitan; Roman', '- sources: 1-4 https URLs', '- note: ',
    'At least one source must be published criticism', 'ALSO report it as a "mentions"']) {
    assert.ok(standard(rerate).includes(part), part);
  }
  for (const brief of [rating, rerate]) {
    assert.match(brief, /Skip any entry you cannot ground in at least one credible published\nsource/);
    assert.match(brief, /"ratingSkipped" record \(\{"id","note"\}/);
  }
});

test('rerate is dispatch-only: auto never draws it, whatever it has to do', () => {
  const rs = [entry('to-rerate', { factors: launch() })];
  const hasWork = t => buildTask(t, rs, { now: NOW }).worklistSize !== 0;
  assert.equal(hasWork('rerate'), true);
  assert.ok(!TYPES.includes('rerate'));
  const none = Object.fromEntries(TYPES.map(t => [t, 0]));
  for (let d = 0; d < 12; d++) {
    assert.notEqual(pickTask('auto', none, hasWork, d), 'rerate');
    assert.notEqual(pickTask('auto', null, hasWork, d), 'rerate');
    // nothing else to do anywhere still does not fall through to it
    assert.notEqual(pickTask('auto', none, t => t === 'rerate', d), 'rerate');
  }
  assert.equal(pickTask('rerate', none, () => false), 'rerate');
  // a rerate pass on record does not enter the rotation's history either
  assert.deepEqual(lastSuccessFromLog('2026-11-12T12:50:00+00:00\tchore(data): research pass (rerate) 2026-11-12'), none);
});

/* ---- the liveness brief ---- */
test('liveness brief: shows the account on file and says which post URLs count for a closure', () => {
  const rs = [
    entry('with-account', { instagram: 'https://www.instagram.com/with_account/' }),
    entry('no-account')
  ];
  const { brief } = buildTask('liveness', rs, { now: NOW });
  assert.match(brief, /- id: with-account \| .* \| site: https:\/\/with-account\.example \| instagram: https:\/\/www\.instagram\.com\/with_account\/ \| currently: open/);
  assert.match(brief, /- id: no-account \| .* \| site: https:\/\/no-account\.example \| currently: open/);
  assert.match(brief, /https:\/\/www\.instagram\.com\/<handle>\/p\/<id>\//);
  assert.match(brief, /a bare instagram\.com\/p\/<id>\/ link cannot be\ntied to anyone/);
});

/* ---- the locations brief ---- */
test('locations brief: rests recent attempts, says what is on file, asks for locationsSkipped', () => {
  const addr = [{ neighborhood: 'Ballard', address: '1 A St, Seattle, WA 98107' }];
  const rs = [
    entry('tried-yesterday', { locationsAttempted: '2026-11-09' }),
    entry('never-tried'),
    entry('from-discovery', { locations: addr, locationsVerified: null }),
    entry('verified-in-march', { locations: addr, locationsVerified: '2026-03-01' }),
    entry('not-open-yet', { status: 'opening' })
  ];
  const { brief, worklistSize } = buildTask('locations', rs, { now: NOW });
  assert.equal(worklistSize, 3);
  assert.doesNotMatch(brief, /tried-yesterday|not-open-yet/);
  assert.match(brief, /- id: never-tried \| .* \| UNVERIFIED, stored as "Ballard"/);
  assert.match(brief, /- id: from-discovery \| .* \| address on file, never verified/);
  assert.match(brief, /- id: verified-in-march \| .* \| 1 site\(s\) verified 2026-03-01/);
  assert.doesNotMatch(brief, /verified null/);
  assert.match(brief, /"locationsSkipped" record/);
});

test('locations: an entry with a branch lead is drawn first, and its row lists the permit addresses', () => {
  const addr = a => [{ neighborhood: 'First Hill', address: a }];
  const rs = [
    entry('placeholder', { neighborhood: 'Citywide', neighborhoodIsPlaceholder: true }),
    entry('never-tried'),
    entry('mart', { name: 'A Pizza Mart (First Hill)', locations: addr('800 Seneca St, Seattle, WA 98101') }),
    entry('rested', { locations: addr('5 E St, Seattle, WA 98101'), locationsVerified: '2026-11-01' }),
    entry('shut', { status: 'closed', locations: addr('6 F St, Seattle, WA 98101') })
  ];
  const permit = (matchedId, address, over = {}) => ({ name: 'A Pizza Mart', address, sources: ['kc-health'],
    lastInspection: '2026-06-11', status: 'rejected', verdict: 'duplicate', matchedId, ...over });
  const candidates = [
    permit('mart', '800 Seneca St, 103, Seattle, WA 98101'),
    permit('mart', '1823 Terry Ave, #102, Seattle, WA 98101'),
    permit('mart', '1433 11th Ave, Seattle, WA 98122', { status: 'promoted', verdict: undefined }),
    permit('rested', '7 G St, Seattle, WA 98101'),
    permit('shut', '8 H St, Seattle, WA 98101'),
    { name: 'Lead One', status: 'pending', address: '9 I St, Seattle, WA 98101', lastInspection: '2026-06-11' }
  ];
  const { brief, worklistSize } = buildTask('locations', rs, { now: NOW, candidates });
  assert.equal(worklistSize, 3);
  assert.deepEqual(ids(brief), ['mart', 'placeholder', 'never-tried']);
  assert.match(brief, /- id: mart \| .* \| address on file, never verified \| leads: 1823 Terry Ave, #102, Seattle, WA 98101 ; 1433 11th Ave, Seattle, WA 98122\n/);
  // The address on file is not a lead, and an entry that is resting or closed is not drawn for one.
  assert.doesNotMatch(brief, /leads:.*800 Seneca|7 G St|8 H St|9 I St/);
  assert.equal(brief.match(/leads:/g).length, 1);

  // What a lead is, and what to do with one that cannot be confirmed.
  assert.match(brief, /A row's "leads" are addresses King County's food-permit register lists\nunder that business and that are not on file for it\./);
  assert.match(brief, /confirm each one against the pizzeria's own site, or the\nbranch's own site, before including it in "sites"/);
  assert.match(brief, /A commissary or prep\nkitchen with no counter is not a location\./);
  assert.match(brief, /if a lead cannot be confirmed, also file a\n"locationsSkipped" record for that entry whose note says which lead and\nwhy/);
  assert.doesNotMatch(brief, /\.mjs|\.js\b|matchedId|candidates\.json/);
});

test('locations brief: with no lead on the worklist the brief says nothing about leads', () => {
  const rs = [entry('never-tried'), entry('rested', { locationsVerified: '2026-11-01' })];
  const candidates = [{ name: 'X', address: '7 G St, Seattle, WA 98101', lastInspection: '2026-06-11',
    status: 'promoted', matchedId: 'rested' }];
  const withQueue = buildTask('locations', rs, { now: NOW, candidates }).brief;
  assert.doesNotMatch(withQueue, /lead/i);
  assert.equal(withQueue, buildTask('locations', rs, { now: NOW }).brief);
});

test('locations: nothing left to look at is an empty worklist', () => {
  const rs = [entry('tried-yesterday', { locationsAttempted: '2026-11-09' }), entry('not-open-yet', { status: 'opening' })];
  assert.equal(buildTask('locations', rs, { now: NOW }).worklistSize, 0);
});

/* ---- serves: places that serve pizza and are not pizzerias ---- */
const hoodsOf = brief => brief.split('\n\n')[1].split('\n').map(l => l.replace(/^- /, ''));

test('rules: one pass of the serves sweep takes the next few neighbourhoods from the cursor, and wraps', () => {
  assert.deepEqual([SERVES_HOODS_PER_PASS, SERVES_SEARCHES_PER_HOOD, SERVES_IN_PASSING, PER_PASS.serves], [4, 5, 5, 16]);
  assert.equal(new Set(NEIGHBORHOODS).size, NEIGHBORHOODS.length);
  assert.deepEqual(servesSweep(0), { start: 0, hoods: NEIGHBORHOODS.slice(0, SERVES_HOODS_PER_PASS), next: SERVES_HOODS_PER_PASS });
  assert.deepEqual(servesSweep(9).hoods, NEIGHBORHOODS.slice(9, 9 + SERVES_HOODS_PER_PASS));
  // the last pass of a lap runs off the end of the list and on from its start
  const n = NEIGHBORHOODS.length;
  assert.deepEqual(servesSweep(n - 1), { start: n - 1,
    hoods: [NEIGHBORHOODS[n - 1], ...NEIGHBORHOODS.slice(0, SERVES_HOODS_PER_PASS - 1)], next: SERVES_HOODS_PER_PASS - 1 });
  // no cursor yet, or one that is not a position in the list, is the top
  for (const lost of [undefined, null, -1, n, n + 7, 1.5, '4', NaN]) assert.equal(servesSweep(lost).start, 0, String(lost));
  // following the cursor covers every neighbourhood before any comes round again
  const seen = [];
  for (let c = 0, i = 0; i < Math.ceil(n / SERVES_HOODS_PER_PASS); i++, c = servesSweep(c).next) seen.push(...servesSweep(c).hoods);
  assert.deepEqual(seen.slice(0, n), NEIGHBORHOODS);
});

test('serves: dispatch-only, with no worklist, so a forced pass always runs and auto never draws it', () => {
  assert.ok(DISPATCH_ONLY.includes('serves') && !TYPES.includes('serves'));
  assert.equal(pickTask('serves', null, () => false), 'serves');
  assert.equal(buildTask('serves', [], { now: NOW }).worklistSize, null);
  const none = Object.fromEntries(TYPES.map(t => [t, 0]));
  for (let d = 0; d < 12; d++) assert.notEqual(pickTask('auto', none, () => true, d), 'serves');
});

test('serves brief: the neighbourhoods at the cursor, and the rules a record is held to', () => {
  const { brief } = buildTask('serves', [], { now: NOW });
  assert.match(brief, /^Your task: find places in Seattle that serve pizza and are not\npizzerias/);
  assert.deepEqual(hoodsOf(brief), NEIGHBORHOODS.slice(0, SERVES_HOODS_PER_PASS));
  assert.deepEqual(hoodsOf(buildTask('serves', [], { now: NOW, servesCursor: 12 }).brief), NEIGHBORHOODS.slice(12, 12 + SERVES_HOODS_PER_PASS));
  // what belongs, in the owner's terms
  assert.match(brief, /An Italian restaurant with a pizza\s+section, a bar with a pizza oven, a bakery that sells slices, a brewery\s+with a pizza kitchen/);
  // a pizzeria is not for this section: it goes in directory like any discovery
  assert.match(brief, /A place whose main business is pizza\. That is a pizzeria: if it is not\s+named below, report it as a "directory" entry, like any discovery/);
  assert.match(brief, /- A national chain, of any kind\./);
  // the record, its address and its source
  assert.match(brief, /Report each find as a "servesPizza" record:\n\{"name": /);
  for (const field of ['"address": "<street address>, Seattle, WA <ZIP>"', '"neighborhood": ', '"note": ', '"source": "<https page that shows pizza on the menu>"']) {
    assert.ok(brief.includes(field), field);
  }
  assert.match(brief, /Every record needs the street address and a source page you opened: the\s+place's own site or menu, or published coverage/);
  assert.match(brief, /A review\s+aggregator, a delivery app, a directory listing or a social profile is\s+refused as the source/);
  // the numbers are the ones in rules.js, and an empty result is a good one
  assert.ok(brief.includes(`At most ${PER_PASS.serves} records.`));
  assert.ok(brief.includes(`about ${SERVES_SEARCHES_PER_HOOD} searches per neighborhood, ${SERVES_SEARCHES_PER_HOOD * SERVES_HOODS_PER_PASS} in total`));
  assert.match(brief, /A neighborhood with nothing to report is a\s+correct result, and so is an empty "servesPizza" list/);
  assert.ok(PER_PASS.serves <= CAPS.servesPizza);
  // The brief is the agent's whole instruction, and it has no shell.
  assert.doesNotMatch(brief, /\.mjs|\.js\b|servesCursor|candidates\.json|verdict/);
});

test('serves brief: names what is already known in its neighbourhoods, on file and in the queue', () => {
  const rs = [
    entry('ballard-pie', { name: 'Ballard Pie' }),                                             // neighbourhood on the entry
    entry('roving-slice', { name: 'Roving Slice', neighborhood: 'Citywide',
      locations: [{ neighborhood: 'Georgetown', address: '1 A St, Seattle, WA 98108' }, { neighborhood: 'Fremont', address: '2 B St, Seattle, WA 98103' }] }),
    entry('lake-pie', { name: 'Lake Pie', neighborhood: 'Greenlake' }),                         // one place, two spellings
    entry('gone-pie', { name: 'Gone Pie', neighborhood: 'Wallingford', status: 'closed' }),     // closed is still on file by name
    entry('far-pie', { name: 'Far Pie', neighborhood: 'Rainier Beach' })
  ];
  const queued = (name, over) => ({ key: candidateKey(name, '9 Z St'), name, address: '9 Z St, Seattle, WA 98107', sources: ['research'],
    status: 'rejected', verdict: 'not-pizza', neighborhood: 'Ballard', ...over });
  const candidates = [
    queued('Stoneburner'),
    queued('Rainier Tavern', { neighborhood: 'Rainier Beach' }),
    queued('Joined Since', { status: 'promoted', matchedId: 'ballard-pie' }),
    // from the permit register: an address and no neighbourhood
    { key: 'pizzutos italian|5032', name: "Pizzuto'S Italian Cafe", address: '5032 Wilson Ave S, Seattle, WA 98118', sources: ['kc-health'], status: 'rejected', verdict: 'not-pizza' },
    { key: 'lead|1', name: 'Lead One Pizza', address: '1 A St, D, Seattle, WA 98101', sources: ['kc-health'], status: 'pending' },
    { key: 'dominos|714', name: "Domino'S Pizza #7063", address: '714 Taylor Ave N, Seattle, WA 98109', sources: ['kc-health'], status: 'chain' },
    { key: 'zeeks|6', name: 'ZEEKS PIZZA #6', address: '6 C St, Seattle, WA 98109', sources: ['kc-health'], status: 'promoted', matchedId: 'zeeks' },
    { key: 'dup|7', name: 'Second Permit Pizza', address: '7 D St, Seattle, WA 98109', sources: ['kc-health'], status: 'rejected', verdict: 'duplicate', matchedId: 'zeeks' }
  ];
  const { brief } = buildTask('serves', rs, { now: NOW, candidates });
  assert.deepEqual(hoodsOf(brief), ['Ballard', 'Fremont', 'Wallingford', 'Green Lake']);
  assert.match(brief, /A place the index already knows, under any spelling\. In these\n  neighborhoods that is:\n  Ballard Pie; Gone Pie; Lake Pie; Roving Slice; Stoneburner\n/);
  assert.match(brief, /which\n  have no neighborhood on file:\n  Lead One Pizza \(1 A St\); Pizzuto's Italian Cafe \(5032 Wilson Ave S\)\n/);
  for (const elsewhere of ['Far Pie', 'Rainier Tavern', 'Joined Since', 'Domino', 'ZEEKS', 'Second Permit']) assert.ok(!brief.includes(elsewhere), elsewhere);

  // another pass, other ground: what it lists moves with the cursor
  const south = buildTask('serves', rs, { now: NOW, candidates, servesCursor: NEIGHBORHOODS.indexOf('Rainier Beach') }).brief;
  assert.match(south, /neighborhoods that is:\n  Far Pie; Rainier Tavern; Roving Slice\n/);
  // nothing known there yet, and no permit candidates: the brief says so and prints no empty list
  const bare = buildTask('serves', [], { now: NOW }).brief;
  assert.match(bare, /neighborhoods that is:\n  \(nothing yet\)\n\nReport each find/);
});

test('serves: both ends of the sweep. The apply step moves the cursor the brief was drawn from, found anything or not', () => {
  const dataset = { city: 'Seattle', dataVersion: '2026.11', restaurants: [] };
  const candFile = { updated: '2026-11-01T00:00:00.000Z', candidates: [] };
  const drawn = [];
  const pass = research => {
    const { brief } = buildTask('serves', dataset.restaurants, { now: NOW, candidates: candFile.candidates, servesCursor: candFile.servesCursor });
    drawn.push(hoodsOf(brief));
    const { accepted, fails } = validateResearch(research, dataset, NOW, candFile);
    assert.deepEqual(fails, []);
    applyResearch(accepted, { dataset, candFile }, '2026-11-10', () => {}, { task: 'serves' });
    return brief;
  };
  // the first pass finds nothing at all, and the second still starts where the first stopped
  pass({ updated: '2026-11-10T00:00:00Z', servesPizza: [] });
  assert.equal(candFile.servesCursor, SERVES_HOODS_PER_PASS);
  pass({ servesPizza: [{ name: 'Stoneburner', address: '5214 Ballard Ave NW, Seattle, WA 98107', neighborhood: 'Greenwood',
    note: 'A hotel restaurant with a wood oven; pizza is one part of a long Mediterranean menu.', source: 'https://stoneburner.example/menu' }] });
  const third = pass({});
  assert.deepEqual(drawn, [0, 1, 2].map(i => NEIGHBORHOODS.slice(i * SERVES_HOODS_PER_PASS, (i + 1) * SERVES_HOODS_PER_PASS)));
  assert.equal(candFile.servesCursor, 3 * SERVES_HOODS_PER_PASS);
  // what the second pass filed is in the queue, with its neighbourhood, for a later pass over that ground to be told about
  assert.deepEqual(candFile.candidates.map(c => [c.name, c.neighborhood, c.verdict]), [['Stoneburner', 'Greenwood', 'not-pizza']]);
  assert.ok(!third.includes('Stoneburner'));
  const lap = buildTask('serves', [], { now: NOW, candidates: candFile.candidates, servesCursor: SERVES_HOODS_PER_PASS }).brief;
  assert.match(lap, /neighborhoods that is:\n  Stoneburner\n/);

  // a discovery pass that files one in passing has swept nothing
  applyResearch({ servesPizza: [] }, { dataset, candFile }, '2026-11-11', () => {}, { task: 'discovery' });
  assert.equal(candFile.servesCursor, 3 * SERVES_HOODS_PER_PASS);
  // a full lap ends where it began
  const laps = { candidates: [] };
  for (let i = 0; i < NEIGHBORHOODS.length; i++) applyResearch({}, { dataset, candFile: laps }, '2026-11-10', () => {}, { task: 'serves' });
  assert.equal(laps.servesCursor, (NEIGHBORHOODS.length * SERVES_HOODS_PER_PASS) % NEIGHBORHOODS.length);
});

test('discovery brief: may file a few places that serve pizza in passing, and is otherwise as it was', () => {
  const { brief } = buildTask('discovery', [entry('a-pie', { name: 'A Pie' })], { now: NOW });
  assert.match(brief, /^Your task: find pizzerias inside Seattle city limits that are not yet on file\./);
  assert.match(brief, /At most 10 entries and 12 web searches\. Fewer\nreal finds beat a padded list; an empty directory array is a valid result\nif the city has nothing new\.\n\nIf a search turns up/);
  assert.ok(brief.includes(`may report up to ${SERVES_IN_PASSING} such places as "servesPizza" records instead`));
  assert.match(brief, /serves pizza and is not a pizzeria \(an Italian restaurant with a pizza\nsection, a bar with a pizza oven\), it does not belong in "directory"/);
  assert.match(brief, /Only the ones you meet; do not\nspend a search looking for them\.$/);
  assert.ok(SERVES_IN_PASSING <= CAPS.servesPizza);
  // the neighbourhoods it sweeps are drawn from the list the serves sweep walks, less the ones with an entry
  const swept = [...brief.matchAll(/^- (.+)$/gm)].map(m => m[1]);
  assert.equal(swept.length, 5);
  for (const h of swept) assert.ok(NEIGHBORHOODS.includes(h) && h !== 'Ballard', h);
});

/* ---- the CLI ---- */
test('importing the module runs nothing', () => {
  const out = execFileSync(process.execPath, ['--input-type=module', '-e',
    `await import(${JSON.stringify(script)});`], { encoding: 'utf8', env: { ...process.env, GITHUB_OUTPUT: '' } });
  assert.equal(out, '');
});

test('CLI: writes task, skip and a delimited brief to GITHUB_OUTPUT', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'next-task-'));
  const out = path.join(dir, 'out');
  try {
    execFileSync(process.execPath, [script, 'news'], { env: { ...process.env, GITHUB_OUTPUT: out }, stdio: 'ignore' });
    const text = fs.readFileSync(out, 'utf8');
    assert.match(text, /^task=news\nskip=false\nbrief<<TASK_BRIEF_EOF\nYour task: [\s\S]+\nTASK_BRIEF_EOF\n$/);
    // A dispatch-only type is taken as given. Whether it has work depends on the data.
    fs.rmSync(out);
    execFileSync(process.execPath, [script, 'rerate'], { env: { ...process.env, GITHUB_OUTPUT: out }, stdio: 'ignore' });
    assert.match(fs.readFileSync(out, 'utf8'), /^task=rerate\nskip=(true|false)\nbrief<<TASK_BRIEF_EOF\nYour task: re-rate [\s\S]+\nTASK_BRIEF_EOF\n$/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('census brief: a chain is a national brand, and a Puget Sound chain joins', () => {
  const { brief } = buildTask('census', [], {
    now: Date.parse('2026-11-12T12:00:00Z'),
    candidates: [{ key: 'jet city|7500', name: 'Jet City Pizza', address: '7500 25th Ave Ne, Seattle, WA 98115', status: 'pending' }]
  });
  assert.match(brief, /chain = a national brand/);
  assert.match(brief, /local to the Puget Sound region is\s+NOT one/);
});

test('CLI: the serves brief starts from the cursor candidates.json holds, and from the top when it holds none', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'next-task-'));
  try {
    for (const d of ['scripts', 'data']) fs.mkdirSync(path.join(dir, d));
    fs.copyFileSync(script, path.join(dir, 'scripts/next-task.mjs'));
    fs.cpSync(fileURLToPath(new URL('../src/', import.meta.url)), path.join(dir, 'src'),
      { recursive: true, filter: src => !src.includes(`${path.sep}vendor`) });
    fs.writeFileSync(path.join(dir, 'data/restaurants.json'), JSON.stringify({ restaurants: [] }));
    const run = file => {
      if (file) fs.writeFileSync(path.join(dir, 'data/candidates.json'), JSON.stringify(file));
      return execFileSync(process.execPath, [path.join(dir, 'scripts/next-task.mjs'), 'serves'],
        { encoding: 'utf8', env: { ...process.env, GITHUB_OUTPUT: '' }, stdio: ['ignore', 'pipe', 'ignore'] });
    };
    const first = run(null);   // no candidates file at all
    assert.match(first, /^task=serves\nskip=false\nbrief<<TASK_BRIEF_EOF\nYour task: find places in Seattle that serve pizza/);
    assert.ok(first.includes(`\n\n${NEIGHBORHOODS.slice(0, SERVES_HOODS_PER_PASS).map(h => `- ${h}`).join('\n')}\n\n`));
    assert.equal(run({ candidates: [] }), first);
    const later = run({ updated: '2026-11-10T00:00:00.000Z', servesCursor: 16, candidates: [] });
    assert.ok(later.includes(`\n\n${NEIGHBORHOODS.slice(16, 16 + SERVES_HOODS_PER_PASS).map(h => `- ${h}`).join('\n')}\n\n`));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
