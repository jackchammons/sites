/*
 * The counting rules for Word Counter. Pure functions, no DOM: imported by
 * app.js in the browser, by test/count.test.mjs, and by scripts/verify.mjs,
 * which runs it from the *built* copy. One implementation — don't fork it.
 *
 * Definitions, which the page footer repeats in plain words:
 *  - A word is a run of letters or digits, each keeping the combining marks
 *    that follow it (Devanagari vowel signs, Arabic harakat, Hebrew niqqud, a
 *    decomposed accent). Apostrophes and hyphens join a word ("well-known",
 *    "it's" are one word each; U+2010 and U+2011 are hyphens too), and so does
 *    a "." or "," between two digits ("1,234.56" is one word). Unicode letters
 *    count.
 *  - A sentence ends at . ! ? … । or ؟ followed by whitespace or the end of
 *    the text, with any closing quotes or brackets in between, and at 。 ！ ？
 *    wherever they fall, since Chinese and Japanese put no space after them.
 *    A terminator with no word since the last one is not a sentence ("!!!",
 *    ". . ."); a trailing fragment with no terminator still counts as one.
 *    There is no abbreviation list, so "Dr. Smith" ends a sentence at the
 *    period, and the footer says so rather than guess.
 *  - A paragraph is a non-blank block separated by blank lines.
 *  - Lines are newline-separated; an empty text has zero lines.
 *  - Characters are code points, not UTF-16 units, so "é" and "👋" count once
 *    each. A decomposed accent or a joined emoji sequence is several.
 */

export const READING_WPM = 238;   // adult silent-reading average
export const SPEAKING_WPM = 150;  // conversational speech

/* A "." or "," belongs to a word only with a digit on both sides. The digit
   before it is matched together with it, which keeps the pattern free of
   lookbehind for the browsers that still reject one. */
const CORE = String.raw`\p{Nd}[.,](?=\p{Nd})|[\p{L}\p{N}]`;
const RUN = String.raw`(?:${CORE})(?:${CORE}|\p{M})*`;
const WORD_RE = new RegExp(String.raw`${RUN}(?:['’\-\u2010\u2011]${RUN})*`, 'gu');

/* Closing quotes and brackets that may sit between a terminator and the space
   after it. Opening quote marks are in the set because German closes with them
   („so.“), and nothing else puts one straight after a terminator. */
const CLOSERS = String.raw`["'\p{Pe}\p{Pf}\p{Pi}]*`;
/* U+0964 is the Devanagari danda, U+061F the Arabic question mark, and U+3002,
   U+FF01 and U+FF1F the ideographic full stop and its full-width companions. */
const CJK_STOPS = String.raw`\u3002\uFF01\uFF1F`;
const TERMINATOR_RE = new RegExp(
  String.raw`[.!?…\u0964\u061F${CJK_STOPS}]+${CLOSERS}(?=\s|$)|[${CJK_STOPS}]+`, 'gu');
const HAS_WORD_RE = /[\p{L}\p{N}]/u;

/* Case and the style of apostrophe do not make a different word: "It’s" and
   "it's" are counted together. */
const fold = w => w.toLowerCase().replace(/’/g, "'");

/* Function words left out of the "most used" list so the list says something
   about the text rather than about English. */
export const STOP_WORDS = new Set((
  'the a an and or but of to in on at for with by from as is are was were be been ' +
  'it its this that these those i you he she we they me him her us them my your his ' +
  'our their not no so if then than too very can will just do does did has have had'
).split(' '));

export function words(text) {
  return text.match(WORD_RE) || [];
}

export function countSentences(text) {
  let count = 0, from = 0;
  for (const m of text.matchAll(TERMINATOR_RE)) {
    if (HAS_WORD_RE.test(text.slice(from, m.index))) count++;
    from = m.index + m[0].length;
  }
  return count + (HAS_WORD_RE.test(text.slice(from)) ? 1 : 0);
}

export function countParagraphs(text) {
  return text.split(/\n\s*\n/).filter(p => p.trim() !== '').length;
}

export function countLines(text) {
  return text === '' ? 0 : text.split(/\r\n|\r|\n/).length;
}

export function topWords(list, limit = 6) {
  const counts = new Map();
  for (const w of list) {
    const k = fold(w);
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  return [...counts.entries()]
    .filter(([w]) => !STOP_WORDS.has(w) && w.length > 1)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([word, count]) => ({ word, count }));
}

export function analyze(text, opts = {}) {
  const readingWpm = opts.readingWpm || READING_WPM;
  const speakingWpm = opts.speakingWpm || SPEAKING_WPM;
  const list = words(text);
  const points = Array.from(text);
  const sentences = countSentences(text);

  let longest = '', totalLen = 0;
  const unique = new Set();
  for (const w of list) {
    const n = Array.from(w).length;
    totalLen += n;
    unique.add(fold(w));
    if (n > Array.from(longest).length) longest = w;
  }

  return {
    words: list.length,
    chars: points.length,
    charsNoSpace: points.filter(c => !/\s/u.test(c)).length,
    letters: (text.match(/\p{L}/gu) || []).length,
    digits: (text.match(/\p{N}/gu) || []).length,
    punctuation: (text.match(/\p{P}/gu) || []).length,
    lines: countLines(text),
    nonEmptyLines: text.split(/\r\n|\r|\n/).filter(l => l.trim() !== '').length,
    sentences,
    paragraphs: countParagraphs(text),
    unique: unique.size,
    avgWordLength: list.length ? totalLen / list.length : 0,
    avgSentenceLength: sentences ? list.length / sentences : 0,
    longest,
    readingMinutes: list.length / readingWpm,
    speakingMinutes: list.length / speakingWpm,
    top: topWords(list),
  };
}

/* "0s", "1m 05s", "2h 14m" — rounded to the second, never fractional. */
export function formatDuration(minutes) {
  const s = Math.round(minutes * 60);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60), r = s % 60;
  if (m < 60) return `${m}m ${String(r).padStart(2, '0')}s`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
}
