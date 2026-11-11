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

/* Escapes keep the decomposed and pointed forms from being silently recomposed
   by an editor; each string is the text a visitor would paste. */
test('words: combining marks stay with the letter they follow', () => {
  // Decomposed Latin: e + U+0301, and Vietnamese with two marks on one vowel.
  assert.deepEqual(words('cafe\u0301 re\u0301sume\u0301'), ['cafe\u0301', 're\u0301sume\u0301']);
  assert.deepEqual(words('Vie\u0323\u0302t Nam'), ['Vie\u0323\u0302t', 'Nam']);
  // Devanagari vowel signs and virama.
  assert.deepEqual(words('नमस्ते दुनिया'), ['नमस्ते', 'दुनिया']);
  assert.equal(words('मैं हिंदी में लिख रहा').length, 5);
  // Arabic with harakat counts the same as without.
  assert.equal(words('مَرْحَبًا بِالْعَالَمِ').length, 2);
  assert.equal(words('مرحبا بالعالم').length, 2);
  // Hebrew with niqqud.
  assert.equal(words('שָׁלוֹם עוֹלָם').length, 2);
  // A mark with no letter before it starts nothing.
  assert.deepEqual(words('\u0301 a'), ['a']);
});

test('words: every hyphen joins, an en or em dash does not', () => {
  assert.deepEqual(words('well\u2011known state\u2010of\u2010the\u2010art'),
    ['well\u2011known', 'state\u2010of\u2010the\u2010art']);
  assert.deepEqual(words('word—word and word–word'), ['word', 'word', 'and', 'word', 'word']);
  assert.deepEqual(words('trailing- -leading'), ['trailing', 'leading']);
});

test('words: a point or comma between digits keeps a number whole', () => {
  assert.deepEqual(words('It cost 1,234.56 dollars.'), ['It', 'cost', '1,234.56', 'dollars']);
  assert.deepEqual(words('3.14 is pi.'), ['3.14', 'is', 'pi']);
  assert.deepEqual(words('v1.2.3 and 10.000,50'), ['v1.2.3', 'and', '10.000,50']);
  // Only between digits: a list, a sentence end and a decimal with no leading digit all split.
  assert.deepEqual(words('1, 2,3. 4 .5 a.b No.5 1..2'), ['1', '2,3', '4', '5', 'a', 'b', 'No', '5', '1', '2']);
  assert.equal(analyze('It cost 1,234.56 dollars.').words, 4);
  assert.equal(analyze('1,234.56 ab').longest, '1,234.56');
});

test('sentences: terminators and a trailing fragment', () => {
  assert.equal(countSentences(''), 0);
  assert.equal(countSentences('One. Two! Three?'), 3);
  assert.equal(countSentences('One. Two'), 2);
  assert.equal(countSentences('Wait... what?!'), 2);
  assert.equal(countSentences('3.14 is pi.'), 1);
  assert.equal(countSentences('No terminator at all'), 1);
  assert.equal(countSentences('Ends with space. '), 1);
  assert.equal(countSentences('Really…'), 1);
  assert.equal(countSentences('A sentence.Another without space.'), 1);
});

test('sentences: closing quotes and brackets may follow the terminator', () => {
  assert.equal(countSentences('She said, "Go." He went.'), 2);
  assert.equal(countSentences('She said, “Go.” He went.'), 2);
  assert.equal(countSentences("He said, 'Go.' She went."), 2);
  assert.equal(countSentences('(See below.) Next sentence.'), 2);
  assert.equal(countSentences('[One.] {Two.} «Trois.» Four.'), 4);
  assert.equal(countSentences('Er sagte: „Geh.“ Er ging.'), 2);
  assert.equal(countSentences('He asked, "Why?"'), 1);
  assert.equal(countSentences('“Stop!” he cried. “Why?” she asked.'), 4);
  // A closer only counts when a space or the end follows it.
  assert.equal(countSentences('(see below.), then on.'), 1);
});

test('sentences: CJK, Devanagari and Arabic terminators', () => {
  assert.equal(countSentences('吾輩は猫である。名前はまだ無い。'), 2);
  assert.equal(countSentences('你好！你是谁？我是猫。'), 3);
  assert.equal(countSentences('「行け。」彼は行った。'), 2);
  assert.equal(countSentences('क्या हाल है। सब ठीक।'), 2);
  assert.equal(countSentences('هل أنت بخير؟ نعم.'), 2);
  assert.equal(countSentences('¿Qué tal? ¡Bien!'), 2);
});

test('sentences: punctuation with no word before it is not a sentence', () => {
  assert.equal(countSentences('. . .'), 0);
  assert.equal(countSentences('!!!'), 0);
  assert.equal(countSentences('。。。'), 0);
  assert.equal(countSentences('Hello. ... World.'), 2);
  assert.equal(countSentences('No way!!! Yes.'), 2);
  assert.equal(countSentences('... and then it ended.'), 1);
  assert.equal(analyze('?!').avgSentenceLength, 0);
});

/* There is no abbreviation list; the footer says so. These pin what that means. */
test('sentences: every terminator counts, abbreviations included', () => {
  assert.equal(countSentences('Dr. Smith arrived.'), 2);
  assert.equal(countSentences('The U.S.A. is big. So is the U.K.'), 3);
  assert.equal(countSentences('1. First item'), 2);
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

test('a curly apostrophe and a straight one spell the same word', () => {
  assert.deepEqual(topWords(words("It's fine. It’s fine, isn’t it? Isn't it."), 2),
    [{ word: 'fine', count: 2 }, { word: "isn't", count: 2 }]);
  assert.deepEqual(topWords(words('it’s it’s IT’S')), [{ word: "it's", count: 3 }]);
  assert.equal(analyze("don't DON’T don’t").unique, 1);
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
