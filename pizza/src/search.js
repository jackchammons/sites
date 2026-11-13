/*
 * The directory's search, as text rules with no DOM in them. app.js reads
 * each row's text once, folds it with these, and matches every keystroke
 * against the folded text; the unit tests run the same functions.
 *
 * A query matches a row when every word of it is found somewhere in the
 * row's text. Case, accents and punctuation are not part of a word:
 * "pizzeria credo" finds "Pizzería Credo", "dinos" finds "Dino's" and "ak"
 * finds "A.K. Pizza".
 */

/* Text reduced to what a match compares: lower case, accents off their
 * letters, apostrophes and full stops dropped (they sit inside a word), and
 * anything else that is not a letter or a digit read as a space. Only the
 * accents of Latin, Greek and Cyrillic letters are taken off; a mark that is
 * part of how another script spells a word stays with its letter. */
export const fold = text => String(text ?? '')
  .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/['’‘`.]/g, '')
  .replace(/[^\p{L}\p{N}\p{M}]+/gu, ' ')
  .trim();

/* The words of a query, folded. An empty or all-punctuation query has none. */
export const terms = query => fold(query).split(' ').filter(Boolean);

/* Does folded text contain every word? A word matches anywhere, so a query
 * can be typed a letter at a time. No words is no query, which matches
 * nothing: the caller shows everything instead of asking. */
export const matches = (folded, words) => words.length > 0 && words.every(w => folded.includes(w));

/* The rows a query keeps. `index` is a list of [key, folded text]. */
export function search(index, query) {
  const words = terms(query);
  if (!words.length) return null;
  return new Set(index.filter(([, text]) => matches(text, words)).map(([key]) => key));
}
