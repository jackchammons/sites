import test from 'node:test';
import assert from 'node:assert/strict';
import { evidenceFor } from '../build/evidence.mjs';

const NOW = new Date('2026-08-30T12:00:00Z');
const FS = { reputation: 8.0, critical: 7.0, craft: 7.0, distinctiveness: 7.0, value: 7.0 };

const entry = over => ({
  id: 'x', rank: 5, previousRank: 7, score: 80,
  factorScores: { ...FS }, penaltyApplied: 0, stalenessDecay: 0,
  factors: {}, mentions: [], lastVerified: '2026-08-01',
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

test('a fall with active decay and no other cause is attributed to freshness', () => {
  const r = entry({ score: 79.5, stalenessDecay: 0.012, lastVerified: '2026-03-01' });
  const html = evidenceFor(r, snap({ scores: { x: 80.2 } }), NOW);
  assert.match(html, /freshness decay/);
  assert.match(html, /2026-03-01/);
  assert.doesNotMatch(html, /score (up|down)/);
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
