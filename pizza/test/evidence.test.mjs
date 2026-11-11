import test from 'node:test';
import assert from 'node:assert/strict';
import { evidenceFor } from '../build/evidence.mjs';
import { applyResearch } from '../scripts/apply-research.mjs';
import { rank, isLaunchRating } from '../src/slice.js';

const NOW = new Date('2026-08-30T12:00:00Z');
const FS = { reputation: 8.0, critical: 7.0, craft: 7.0, distinctiveness: 7.0, value: 7.0 };

const entry = over => ({
  id: 'x', rank: 5, previousRank: 7, score: 80,
  factorScores: { ...FS }, penaltyApplied: 0, stalenessDecay: 0,
  factors: {}, mentions: [], verified: { date: '2026-08-01', source: 'rating' },
  ...over
});
const snap = over => ({ weekKey: '2026-W34', scores: { x: 80 }, ...over });

test('an unmoved, previously ranked entry gets no evidence line', () => {
  assert.equal(evidenceFor(entry({ rank: 5, previousRank: 5 }), snap(), NOW), '');
});

test('a critical lift with a recent list mention names the list and links it once', () => {
  const r = entry({
    factorScores: { ...FS, critical: 7.3 },
    mentions: [{ url: 'https://eater.example/list', source: 'Eater Seattle', date: '2026-08-25', kind: 'ranking' }]
  });
  const prev = snap({ factors: { x: { ...FS, penalty: 0 } } });
  const html = evidenceFor(r, prev, NOW);
  assert.match(html, /critical reception \+0\.3/);
  assert.match(html, /named in a new list by/);
  const linkCount = html.split('https://eater.example/list').length - 1;
  assert.equal(linkCount, 1, 'the causing story must not repeat in the news tail');
});

test('a value delta is not narrated separately when craft moved (derived factor)', () => {
  const r = entry({ factorScores: { ...FS, craft: 7.5, value: 7.3 } });
  const prev = snap({ factors: { x: { ...FS, penalty: 0 } } });
  const html = evidenceFor(r, prev, NOW);
  assert.match(html, /craft \+0\.5/);
  assert.doesNotMatch(html, /value \+/);
});

test('a fresh provenance date reads as a re-rating even without snapshot factors', () => {
  const r = entry({
    factors: { craft: { value: 7, setBy: 'agent', source: 'https://rev.example/a', date: '2026-08-28' } }
  });
  const html = evidenceFor(r, snap({ scores: { x: 76 } }), NOW);
  assert.match(html, /re-rated this week: craft 7\.0/);
  assert.match(html, /https:\/\/rev\.example\/a/);
});

test('a rating the agent replaced inside the snapshot gap reads as re-rated, with its sources', () => {
  const prev = snap({ factors: { x: { ...FS, craft: 9.0, distinctiveness: 9.5, critical: 9.0, penalty: 0 } } });
  const graded = (provenance, [craft, distinctiveness, critical]) => ({
    craft: { value: craft, ...provenance },
    distinctiveness: { value: distinctiveness, ...provenance },
    critical: { value: critical, ...provenance }
  });

  // Hand-set, with an old date and a citation attached this week: the values
  // are last week's, and attaching a source is not a rating.
  const attached = 'https://old.example/attached';
  const before = entry({
    factorScores: { ...FS, craft: 9.0, distinctiveness: 9.5, critical: 9.0 },
    factors: graded({ setBy: 'editorial', date: '2026-08-01', source: attached, sources: [attached], sourcedDate: '2026-08-28' },
      [9.0, 9.5, 9.0])
  });
  assert.doesNotMatch(evidenceFor(before, prev, NOW), /re-rated/);

  // The same entry after a pass replaced all three factors two days ago.
  const sources = ['https://rev.example/review', 'https://paper.example/roundup', 'https://rev.example/second'];
  const after = entry({
    verified: { date: '2026-08-28', source: 'rating' },
    factorScores: { ...FS, craft: 8.0, distinctiveness: 8.5, critical: 8.5 },
    factors: graded({ setBy: 'agent', date: '2026-08-28', source: sources[0], sources, note: 'What the coverage says.' },
      [8.0, 8.5, 8.5])
  });
  const html = evidenceFor(after, prev, NOW);
  assert.match(html, /re-rated: craft 9\.0 → 8\.0/);
  assert.match(html, /re-rated: distinctiveness 9\.5 → 8\.5/);
  assert.match(html, /re-rated: critical reception 9\.0 → 8\.5/);
  for (const url of sources) {
    assert.equal(html.split(`href="${url}"`).length - 1, 1, `${url} is linked once`);
  }
  // Two links to one outlet do not read the same.
  assert.match(html, />rev\.example<\/a>, .*>rev\.example \(2\)<\/a>/);
  assert.ok(!html.includes(attached));
  assert.doesNotMatch(html, /editorial|launch/i);
  // The pass stamped the entry verified, and the line owns that reset too.
  assert.match(html, /; the new rating also resets its freshness decay$/);
  assert.doesNotMatch(html, /re-verified/);

  // A rating the agent set before the gap is not this week's news.
  const settled = entry({
    factorScores: { ...FS },
    factors: graded({ setBy: 'agent', date: '2026-08-10', source: sources[0], sources }, [7, 7, 7])
  });
  assert.doesNotMatch(evidenceFor(settled, snap({ scores: { x: 76 } }), NOW), /re-rated/);
});

/* The same story through the pipeline's own write path: a launch rating as the
 * data holds one, last week's snapshot of it, and applyResearch replacing it. */
const launchEntry = () => {
  const provenance = { setBy: 'editorial', date: '2026-06-01', source: 'https://old.example/attached',
    sources: ['https://old.example/attached'], sourcedDate: '2026-08-20', note: 'What the attached coverage said.' };
  return { id: 'x', name: 'Ex Pies', status: 'open', statusChecked: '2026-06-20', mentions: [], attributes: {},
    factors: { craft: { value: 9, ...provenance }, distinctiveness: { value: 9, ...provenance }, critical: { value: 9, ...provenance } } };
};
const SOURCES = ['https://rev.example/review', 'https://paper.example/roundup'];
const rerate = values => {
  const dataset = { restaurants: [launchEntry()], attributeRegistry: {} };
  const [was] = rank(dataset, { now: new Date('2026-08-23T12:00:00Z') });
  const previous = snap({ scores: { x: was.score }, factors: { x: { ...was.factorScores, penalty: was.penaltyApplied } } });
  applyResearch({ factorRatings: [{ id: 'x', craft: values[0], distinctiveness: values[1], criticScore: values[2],
    sources: SOURCES, note: 'What the coverage the agent read says.' }] }, { dataset }, '2026-08-28');
  const [now] = rank(dataset, { now: NOW });
  return { was, now, previous, entry: dataset.restaurants[0] };
};

test('a launch rating the pipeline replaced reads as re-rated on the card, sources and reset included', () => {
  const { was, now, previous, entry: stored } = rerate([8, 8.5, 8.5]);
  assert.equal(isLaunchRating(stored), false);
  // The pass stamped the entry verified, so the decay runs from the rating.
  assert.deepEqual(now.verified, { date: '2026-08-28', source: 'rating' });
  assert.ok(now.stalenessDecay < was.stalenessDecay);
  const html = evidenceFor({ ...now, rank: 6, previousRank: 4 }, previous, NOW);
  assert.match(html, /^<b>Why it moved:<\/b> re-rated: /);
  assert.match(html, /re-rated: craft 9\.0 → 8\.0/);
  assert.match(html, /re-rated: distinctiveness 9\.0 → 8\.5/);
  assert.match(html, /re-rated: critical reception 9\.0 → 8\.5/);
  for (const url of SOURCES) assert.equal(html.split(`href="${url}"`).length - 1, 1, `${url} is linked once`);
  assert.match(html, /the new rating also resets its freshness decay/);
  assert.doesNotMatch(html, /re-verified|old\.example|editorial|launch/i);
});

test('a re-rating that lands on the values already on file still explains the rise it causes', () => {
  const { was, now, previous } = rerate([9, 9, 9]);
  assert.ok(now.score - was.score >= 0.1, 'the score rose on the reset alone');
  const html = evidenceFor({ ...now, rank: 4, previousRank: 6 }, previous, NOW);
  assert.match(html, /re-rated on 2026-08-28 from .*rev\.example<\/a>, .*paper\.example<\/a> with its values unchanged, which resets its freshness decay/);
  assert.doesNotMatch(html, /re-verified|entries around it/);
});

test('a launch rating with a citation attached this week is not a re-rating', () => {
  const dataset = { restaurants: [launchEntry()], attributeRegistry: {} };
  const [was] = rank(dataset, { now: new Date('2026-08-23T12:00:00Z') });
  const previous = snap({ scores: { x: was.score }, factors: { x: { ...was.factorScores, penalty: was.penaltyApplied } } });
  applyResearch({ factorSources: [{ id: 'x', sources: ['https://rev.example/review'], note: 'What the coverage the agent read says.' }] },
    { dataset }, '2026-08-28');
  const [now] = rank(dataset, { now: NOW });
  assert.equal(isLaunchRating(dataset.restaurants[0]), true);
  const html = evidenceFor({ ...now, rank: 6, previousRank: 4 }, previous, NOW);
  assert.doesNotMatch(html, /re-rated|rev\.example/);
});

test('an entry new to the ten after a re-rating cites each source once', () => {
  const src = 'https://rev.example/review';
  const provenance = { setBy: 'agent', date: '2026-08-28', source: src, sources: [src] };
  const r = entry({
    previousRank: null,
    factorScores: { ...FS, craft: 8.0 },
    factors: { craft: { value: 8, ...provenance }, distinctiveness: { value: 7, ...provenance }, critical: { value: 7, ...provenance } }
  });
  const html = evidenceFor(r, snap({ factors: { x: { ...FS, penalty: 0 } } }), NOW);
  assert.match(html, /New to the ten:<\/b> re-rated: craft 7\.0 → 8\.0/);
  assert.equal(html.split(`href="${src}"`).length - 1, 1);
});

test('a fall with active decay and no other cause is attributed to freshness', () => {
  const r = entry({ score: 79.5, stalenessDecay: 0.012, verified: { date: '2026-03-01', source: 'rating' } });
  const html = evidenceFor(r, snap({ scores: { x: 80.2 } }), NOW);
  assert.match(html, /freshness decay/);
  assert.match(html, /2026-03-01/);
  assert.doesNotMatch(html, /score (up|down)/);
});

test('the decay line names the check the score ran from, not the legacy rating stamp', () => {
  const r = entry({ score: 79.5, stalenessDecay: 0.012, lastVerified: '2026-03-01',
    verified: { date: '2026-06-20', source: 'status check' } });
  const html = evidenceFor(r, snap({ scores: { x: 80.2 } }), NOW);
  assert.match(html, /nothing re-verified since the status check on 2026-06-20/);
  assert.doesNotMatch(html, /2026-03-01/);
});

test('a rise after a status check is a freshness reset, not displacement', () => {
  const r = entry({ score: 81.4, lastVerified: '2026-03-01',
    verified: { date: '2026-08-28', source: 'status check' } });
  const html = evidenceFor(r, snap({ scores: { x: 80 } }), NOW);
  assert.match(html, /re-verified by a status check on 2026-08-28, which resets its freshness decay/);
  assert.doesNotMatch(html, /entries around it/);
});

test('a rise after a locations check is a freshness reset too', () => {
  const r = entry({ score: 81.4, verified: { date: '2026-08-27', source: 'locations check' } });
  const html = evidenceFor(r, snap({ scores: { x: 80 } }), NOW);
  assert.match(html, /re-verified by a locations check on 2026-08-27/);
});

test('an old verification does not explain a rise', () => {
  const r = entry({ score: 81.4, verified: { date: '2026-08-01', source: 'status check' } });
  const html = evidenceFor(r, snap({ scores: { x: 80 } }), NOW);
  assert.match(html, /entries around it fell/);
});

test('a reputation that carries no weight is not offered as the cause of a rise', () => {
  const r = entry({ factorScores: { ...FS, reputation: 8.6 },
    reputationDetail: { use: 'lowers' }, score: 80 });
  const prev = snap({ factors: { x: { ...FS, penalty: 0 } } });
  assert.doesNotMatch(evidenceFor(r, prev, NOW), /reputation \+/);
  const counted = entry({ factorScores: { ...FS, reputation: 8.6 }, reputationDetail: { use: 'counted' } });
  assert.match(evidenceFor(counted, prev, NOW), /reputation \+0\.6/);
});

test('a small unexplained drift reads as displacement, never a bare score delta', () => {
  const r = entry({ rank: 6, previousRank: 5, score: 80.02 });
  const html = evidenceFor(r, snap({ scores: { x: 80.05 } }), NOW);
  assert.match(html, /entries around it rose/);
  assert.doesNotMatch(html, /score (up|down)/);
});

test('a new entry cites the coverage it was rated from', () => {
  const r = entry({
    previousRank: null,
    factors: { craft: { value: 7, setBy: 'agent', source: 'https://rev.example/b', date: '2026-07-01' } }
  });
  const html = evidenceFor(r, snap(), NOW);
  assert.match(html, /New to the ten/);
  assert.match(html, /rated from/);
  assert.match(html, /https:\/\/rev\.example\/b/);
});
