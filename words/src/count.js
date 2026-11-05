/*
 * The counting rules for Word Counter. Pure functions, no DOM: imported by
 * app.js in the browser, by test/count.test.mjs, and by scripts/verify.mjs,
 * which runs it from the *built* copy. One implementation — don't fork it.
 *
 * Definitions, which the page footer repeats in plain words:
 *  - A word is a run of letters or digits, optionally joined by apostrophes
 *    or hyphens ("well-known", "it's" are one word each). Unicode letters count.
 *  - A sentence ends at . ! ? or … followed by whitespace or the end of the
 *    text; a trailing fragment with no terminator still counts as one.
 *  - A paragraph is a non-blank block separated by blank lines.
 *  - Lines are newline-separated; an empty text has zero lines.
 *  - Characters are code points, not UTF-16 units, so "é" and emoji count once.
 */

export const READING_WPM = 238;   // adult silent-reading average
export const SPEAKING_WPM = 150;  // conversational speech

const WORD_RE = /[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*/gu;
const TERMINATOR_RE = /[.!?…]+(?=\s|$)/g;

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
  const terminated = (text.match(TERMINATOR_RE) || []).length;
  const tail = text.split(TERMINATOR_RE).pop();
  return terminated + (tail && words(tail).length ? 1 : 0);
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
    const k = w.toLowerCase();
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
    unique.add(w.toLowerCase());
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
