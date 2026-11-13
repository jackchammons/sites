import test from 'node:test';
import assert from 'node:assert/strict';
import { fold, terms, matches, search } from '../src/search.js';

/* The directory's search rules. app.js folds each row's text once with fold()
 * and tests every keystroke with terms() and matches(); these are the same
 * functions. */

test('folding drops case, accents and the punctuation inside a word', () => {
  assert.equal(fold('Pizzería Credo'), 'pizzeria credo');
  assert.equal(fold('CAFÉ Lago'), 'cafe lago');
  // An accent written as a letter and a combining mark folds the same way.
  assert.equal(fold('Cafe\u0301'), 'cafe');
  assert.equal(fold("Dino's Tomato Pie"), 'dinos tomato pie');
  assert.equal(fold('Dino’s'), 'dinos');
  assert.equal(fold('A.K. Pizza'), 'ak pizza');
  // Everything else that is not a letter or a digit separates words.
  assert.equal(fold('Wood-fired, New York / Neapolitan hybrid'), 'wood fired new york neapolitan hybrid');
  assert.equal(fold('Pizza & Pasta #12'), 'pizza pasta 12');
  assert.equal(fold('  1415 NW 70th Street,\n Seattle, WA 98117 '), '1415 nw 70th street seattle wa 98117');
  // Letters outside Latin are kept whole, marks and all, not thrown away as punctuation.
  assert.equal(fold('ピザ Bar').normalize('NFC'), 'ピザ bar');
  assert.ok(matches(fold('ピザ Bar'), terms('ピザ')));
  assert.equal(fold(null), '');
  assert.equal(fold(undefined), '');
  assert.equal(fold(42), '42');
});

test('a query is its words, folded the way the text is', () => {
  assert.deepEqual(terms('Ballard  NEAPOLITAN'), ['ballard', 'neapolitan']);
  assert.deepEqual(terms("dino's"), ['dinos']);
  assert.deepEqual(terms('wood-fired'), ['wood', 'fired']);
  assert.deepEqual(terms('pizzería'), ['pizzeria']);
  // Nothing to search for.
  for (const q of ['', '   ', '.', '&', "'", null, undefined]) assert.deepEqual(terms(q), [], JSON.stringify(q));
});

test('every word has to be found, anywhere, in any order', () => {
  const row = fold("Dino's Tomato Pie Capitol Hill 1524 E Olive Way, Seattle, WA 98122 Jersey-style tavern square Peaks late night Open");
  const hit = q => matches(row, terms(q));
  assert.ok(hit('dino'));
  assert.ok(hit('DINOS'));
  assert.ok(hit('capitol hill'));
  assert.ok(hit('hill capitol'));
  assert.ok(hit('tavern dino 98122'));
  // A word may be part of one: the field is searched as it is typed.
  assert.ok(hit('tav'));
  assert.ok(hit('jersey style'));
  assert.ok(hit('olive way'));
  // One word that is not there is enough to miss.
  assert.ok(!hit('dino ballard'));
  assert.ok(!hit('neapolitan'));
  // No words is no query, and matches nothing.
  assert.ok(!hit(''));
  assert.ok(!matches(row, []));
  // An accent in the text is found without one in the query, and the other way round.
  assert.ok(matches(fold('Pizzería Credo'), terms('pizzeria')));
  assert.ok(matches(fold('Pizzeria Credo'), terms('pizzería')));
});

test('a search keeps the rows that match, and an empty query is no search', () => {
  const index = [
    ['a', fold('Delancey Ballard Wood-fired')],
    ['b', fold('Pizzería Credo West Seattle Neapolitan')],
    ['c', fold("Domino's Pizza #7063 714 Taylor Ave N")]
  ];
  assert.deepEqual([...search(index, 'ballard')], ['a']);
  assert.deepEqual([...search(index, 'pizzeria')], ['b']);
  assert.deepEqual([...search(index, 'dominos taylor')], ['c']);
  assert.deepEqual([...search(index, 'e')].sort(), ['a', 'b', 'c']);
  assert.deepEqual([...search(index, 'calzone')], []);
  assert.equal(search(index, ''), null);
  assert.equal(search(index, '  ,  '), null);
});
