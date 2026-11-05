import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  analyze, words, countSentences, countParagraphs, countLines, topWords, formatDuration,
} from '../src/count.js';

test('words: letters, digits, apostrophes and hyphens', () => {
  assert.deepEqual(words("It's a well-known 2nd test — right?"), ["It's", 'a', 'well-known', '2nd', 'test', 'right']);
  assert.deepEqual(words('   '), []);
  assert.deepEqual(words('café naïve 東京'), ['café', 'naïve', '東京']);
  assert.deepEqual(words('rock ’n’ roll'), ['rock', 'n', 'roll']);
});

test('sentences: terminators and a trailing fragment', () => {
  assert.equal(countSentences(''), 0);
  assert.equal(countSentences('One. Two! Three?'), 3);
  assert.equal(countSentences('One. Two'), 2);
  assert.equal(countSentences('Wait... what?!'), 2);
  assert.equal(countSentences('3.14 is pi.'), 1);
  assert.equal(countSentences('No terminator at all'), 1);
  assert.equal(countSentences('Ends with space. '), 1);
});

test('paragraphs and lines', () => {
  assert.equal(countParagraphs(''), 0);
  assert.equal(countParagraphs('a\nb'), 1);
  assert.equal(countParagraphs('a\n\nb\n\n\n\nc'), 3);
  assert.equal(countParagraphs('a\n  \nb'), 2);
  assert.equal(countLines(''), 0);
  assert.equal(countLines('a'), 1);
  assert.equal(countLines('a\nb\n'), 3);
  assert.equal(countLines('a\r\nb'), 2);
});

test('characters count code points, not UTF-16 units', () => {
  const s = analyze('héllo 👋');
  assert.equal(s.chars, 7);
  assert.equal(s.charsNoSpace, 6);
  assert.equal(s.letters, 5);
});

test('averages and longest word', () => {
  const s = analyze('aa bbb. cccc d');
  assert.equal(s.words, 4);
  assert.equal(s.sentences, 2);
  assert.equal(s.avgWordLength, 2.5);
  assert.equal(s.avgSentenceLength, 2);
  assert.equal(s.longest, 'cccc');
  assert.equal(analyze('').avgWordLength, 0);
  assert.equal(analyze('').avgSentenceLength, 0);
  assert.equal(analyze('').longest, '');
});

test('top words skip stop words, fold case, break ties alphabetically', () => {
  const top = topWords(words('The cat and the Cat sat on a mat. Cat! mat'));
  assert.deepEqual(top, [{ word: 'cat', count: 3 }, { word: 'mat', count: 2 }, { word: 'sat', count: 1 }]);
  assert.equal(topWords(words('a b c the and')).length, 0);
  assert.equal(topWords(words(Array.from({ length: 20 }, (_, i) => `w${i}`).join(' '))).length, 6);
});

test('reading and speaking time use the configured rates', () => {
  const text = Array(476).fill('word').join(' ');
  const s = analyze(text);
  assert.equal(s.readingMinutes, 2);
  assert.equal(analyze(text, { readingWpm: 238, speakingWpm: 119 }).speakingMinutes, 4);
});

test('formatDuration', () => {
  assert.equal(formatDuration(0), '0s');
  assert.equal(formatDuration(0.5), '30s');
  assert.equal(formatDuration(1), '1m 00s');
  assert.equal(formatDuration(1.5), '1m 30s');
  assert.equal(formatDuration(59.99), '59m 59s');
  assert.equal(formatDuration(125), '2h 05m');
});
