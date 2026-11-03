import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mentionMatch, normUrl, normTitle } from '../src/match.js';

const rs = [
  { id: 'independent', name: 'The Independent Pizzeria' },
  { id: 'lupo', name: 'Lupo' },
  { id: 'moto', name: 'Moto Pizza' }
];

test('full-name match, case-insensitive', () => {
  assert.deepEqual(mentionMatch('MOTO PIZZA expands again', rs), ['moto']);
});

test('a leading The is optional in the headline', () => {
  assert.deepEqual(mentionMatch('Independent Pizzeria turns ten', rs), ['independent']);
});

test('short names never match by fragment', () => {
  // "Lupo" is 4 chars — below the needle floor, so "lupo" inside another word
  // or as a stray token cannot tag the entry.
  assert.deepEqual(mentionMatch('Guadalupo street fair returns', rs), []);
  assert.deepEqual(mentionMatch('Lupo announces new hours', rs), []);
});

test('multiple entries in one headline all tag', () => {
  assert.deepEqual(mentionMatch('Moto Pizza and The Independent Pizzeria share a block party', rs),
    ['independent', 'moto']);
});

test('normUrl folds scheme, www, trailing slash and tracking params', () => {
  assert.equal(normUrl('https://www.seattlemag.com/a-story/'), normUrl('http://seattlemag.com/a-story?utm_source=x'));
  assert.notEqual(normUrl('https://seattlemag.com/a-story'), normUrl('https://seattlemag.com/b-story'));
  assert.equal(normTitle('Opening Night: Stevie\u2019s Famous!'), 'opening night stevie s famous');
});
