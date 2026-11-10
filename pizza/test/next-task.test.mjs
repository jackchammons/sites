import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { pickTask, buildTask, lastSuccessFromLog, TYPES, DISPATCH_ONLY } from '../scripts/next-task.mjs';

const script = fileURLToPath(new URL('../scripts/next-task.mjs', import.meta.url));
const NOW = Date.parse('2026-11-10T12:00:00Z');
const day = n => Date.parse(`2026-11-${String(n).padStart(2, '0')}T12:00:00Z`);

const RATED = { craft: { value: 8 }, distinctiveness: { value: 7 }, critical: { value: 8 } };
const entry = (id, over = {}) => ({ id, name: id.replace(/-/g, ' '), status: 'open', neighborhood: 'Ballard',
  url: `https://${id}.example`, locations: [], mentions: [], ...over });

/* ---- the picker ---- */
test('rotation: the type whose last successful pass is oldest goes next', () => {
  const ages = { discovery: day(8), locations: day(9), liveness: day(5), news: day(6), rating: day(7) };
  assert.equal(pickTask('auto', ages), 'liveness');
  assert.equal(pickTask('auto', { ...ages, liveness: day(10) }), 'news');
});

test('rotation: a type with no pass on record goes first, ties in listed order', () => {
  const ages = { discovery: day(8), locations: day(9), liveness: 0, news: day(6), rating: 0 };
  assert.equal(pickTask('auto', ages), 'liveness');
  assert.equal(pickTask('auto', Object.fromEntries(TYPES.map(t => [t, 0]))), TYPES[0]);
});

test('rotation: the oldest type is passed over when its worklist is empty', () => {
  const ages = { discovery: day(2), locations: day(3), liveness: day(4), news: day(5), rating: day(1) };
  assert.equal(pickTask('auto', ages), 'rating');
  assert.equal(pickTask('auto', ages, t => t !== 'rating'), 'discovery');
  assert.equal(pickTask('auto', ages, t => !['rating', 'discovery', 'locations'].includes(t)), 'liveness');
});

test('rotation: a forced type is returned even with an empty worklist', () => {
  const ages = Object.fromEntries(TYPES.map(t => [t, 0]));
  for (const t of [...TYPES, ...DISPATCH_ONLY]) assert.equal(pickTask(t, ages, () => false), t);
});

test('rotation: an unrecognised argument means auto', () => {
  const ages = { discovery: day(2), locations: day(3), liveness: day(4), news: day(5), rating: day(1) };
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
    rating: Date.parse('2026-11-07T12:50:00Z')
  });
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

  const ages = { discovery: day(2), locations: day(3), liveness: day(4), news: day(5), rating: day(1) };
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
