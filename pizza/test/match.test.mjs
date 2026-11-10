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

/* ---- names that are also ordinary words ---- */
const generic = [
  { id: 'belltown-pizza', name: 'Belltown Pizza' },
  { id: 'mad-pizza', name: 'Mad Pizza' },
  { id: 'world-pizza', name: 'World Pizza' },
  { id: 'ridge-pizza', name: 'Ridge Pizza' }
];

test('a name inside a longer word does not match', () => {
  assert.deepEqual(mentionMatch('Nomad pizza truck parks in Fremont', generic), []);
  assert.deepEqual(mentionMatch('Nomad Pizza Truck Parks in Fremont', generic), []);
});

test('a description that happens to spell a name does not match', () => {
  assert.deepEqual(mentionMatch('New Belltown pizza spot opens next month', generic), []);
  assert.deepEqual(mentionMatch('A Phinney Ridge pizza favorite expands', generic), []);
});

test('the front of an event name does not match', () => {
  assert.deepEqual(mentionMatch('Seattle chef wins World Pizza Championship', generic), []);
  assert.deepEqual(mentionMatch('Where to eat on World Pizza Day', generic), []);
});

test('the same names still match when the headline means the pizzeria', () => {
  assert.deepEqual(mentionMatch('World Pizza closes after 30 years in the International District', generic), ['world-pizza']);
  assert.deepEqual(mentionMatch('Belltown Pizza\u2019s owner on twenty years of slices', generic), ['belltown-pizza']);
  assert.deepEqual(mentionMatch('MAD PIZZA EXPANDS TO FREMONT', generic), ['mad-pizza']);
  assert.deepEqual(mentionMatch('Line out the door: Ridge Pizza, reviewed', generic), ['ridge-pizza']);
});

test('names with punctuation match as written', () => {
  const rs2 = [{ id: 'a-k-pizza', name: 'A.K. Pizza' }, { id: 'big-marios', name: "Big Mario's" }];
  assert.deepEqual(mentionMatch('A.K. Pizza is hard to get\u2014and even harder to beat', rs2), ['a-k-pizza']);
  assert.deepEqual(mentionMatch("Big Mario's turns fifteen", rs2), ['big-marios']);
  assert.deepEqual(mentionMatch('AxK. Pizza', rs2), []);
});

test('normUrl folds scheme, www, trailing slash and tracking params', () => {
  assert.equal(normUrl('https://www.seattlemag.com/a-story/'), normUrl('http://seattlemag.com/a-story?utm_source=x'));
  assert.notEqual(normUrl('https://seattlemag.com/a-story'), normUrl('https://seattlemag.com/b-story'));
  assert.equal(normTitle('Opening Night: Stevie\u2019s Famous!'), 'opening night stevie s famous');
});
