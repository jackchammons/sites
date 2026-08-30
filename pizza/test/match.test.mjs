import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mentionMatch } from '../src/match.js';

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
