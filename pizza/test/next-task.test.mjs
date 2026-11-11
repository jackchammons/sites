import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { pickTask, buildTask, lastSuccessFromLog, TYPES, DISPATCH_ONLY } from '../scripts/next-task.mjs';
import { CAPS } from '../src/validate-research.js';

const script = fileURLToPath(new URL('../scripts/next-task.mjs', import.meta.url));
const NOW = Date.parse('2026-11-10T12:00:00Z');
const day = n => Date.parse(`2026-11-${String(n).padStart(2, '0')}T12:00:00Z`);

const RATED = { craft: { value: 8 }, distinctiveness: { value: 7 }, critical: { value: 8 } };
const entry = (id, over = {}) => ({ id, name: id.replace(/-/g, ' '), status: 'open', neighborhood: 'Ballard',
  url: `https://${id}.example`, locations: [], mentions: [], ...over });

/* ---- the picker ---- */
test('rotation: the type whose last successful pass is oldest goes next', () => {
  const ages = { discovery: day(8), locations: day(9), liveness: day(5), news: day(6), rating: day(7), census: day(10) };
  assert.equal(pickTask('auto', ages), 'liveness');
  assert.equal(pickTask('auto', { ...ages, liveness: day(10) }), 'news');
});

test('rotation: a type with no pass on record goes first, ties in listed order', () => {
  const ages = { discovery: day(8), locations: day(9), liveness: 0, news: day(6), rating: 0, census: day(7) };
  assert.equal(pickTask('auto', ages), 'liveness');
  assert.equal(pickTask('auto', Object.fromEntries(TYPES.map(t => [t, 0]))), TYPES[0]);
});

test('rotation: the oldest type is passed over when its worklist is empty', () => {
  const ages = { discovery: day(2), locations: day(3), liveness: day(4), news: day(5), rating: day(1), census: day(6) };
  assert.equal(pickTask('auto', ages), 'rating');
  assert.equal(pickTask('auto', ages, t => t !== 'rating'), 'discovery');
  assert.equal(pickTask('auto', ages, t => !['rating', 'discovery', 'locations'].includes(t)), 'liveness');
});

test('rotation: census rotates with the daily types, and the backfills stay dispatch-only', () => {
  assert.deepEqual(TYPES, ['discovery', 'locations', 'liveness', 'news', 'rating', 'census']);
  assert.deepEqual(DISPATCH_ONLY, ['social', 'facts', 'coverage', 'sources']);
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
    census: Date.parse('2026-09-12T12:50:00Z') };
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
  const censusDay = [0, 1, 2, 3, 4, 5].find(n => TYPES[n % TYPES.length] === 'census');
  assert.equal(pickTask('auto', null, hasWork(refreshed), censusDay), 'census');
  assert.equal(pickTask('auto', null, hasWork(dry), censusDay), TYPES[(censusDay + 1) % TYPES.length]);
});

test('rotation: a forced type is returned even with an empty worklist', () => {
  const ages = Object.fromEntries(TYPES.map(t => [t, 0]));
  for (const t of [...TYPES, ...DISPATCH_ONLY]) assert.equal(pickTask(t, ages, () => false), t);
});

test('rotation: an unrecognised argument means auto', () => {
  const ages = { discovery: day(2), locations: day(3), liveness: day(4), news: day(5), rating: day(1), census: day(6) };
  assert.equal(pickTask('nonsense', ages), 'rating');
});

test('rotation: with no usable history the order starts from the UTC day', () => {
  for (let d = 0; d < TYPES.length; d++) assert.equal(pickTask('auto', null, () => true, 20000 + d), TYPES[(20000 + d) % TYPES.length]);
  // On rating's day, with nothing to rate, the day goes to the type after it.
  const d = [20000, 20001, 20002, 20003, 20004].find(n => TYPES[n % TYPES.length] === 'rating');
  assert.equal(pickTask('auto', null, t => t !== 'rating', d), TYPES[(d + 1) % TYPES.length]);
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
    rating: Date.parse('2026-11-07T12:50:00Z'), census: 0
  });
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

  const ages = { discovery: day(2), locations: day(3), liveness: day(4), news: day(5), rating: day(1), census: day(6) };
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

test('locations: nothing left to look at is an empty worklist', () => {
  const rs = [entry('tried-yesterday', { locationsAttempted: '2026-11-09' }), entry('not-open-yet', { status: 'opening' })];
  assert.equal(buildTask('locations', rs, { now: NOW }).worklistSize, 0);
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
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
