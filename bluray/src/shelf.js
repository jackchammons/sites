/* Blu-ray Shelf — the rules for the collection: what an entry in
   data/data.json must look like, how the list is filtered and ordered, and
   the figures in the summary. No DOM in here. build.mjs renders the page from
   these functions, app.js runs them again when a control changes, and the
   unit tests and verify.mjs import them, the verifier from the built copy. */

/* The formats an entry may name. `short` is what fits on a drawn spine. */
export const FORMATS = [
  { id: '4K UHD', short: '4K', long: '4K Ultra HD' },
  { id: 'Blu-ray', short: 'BD', long: 'Blu-ray' },
];

export const CRITERION = 'Criterion Collection';

/* The filter chips, in the order they are drawn. */
export const SHOWS = [
  { id: 'all', label: 'Everything', test: () => true },
  { id: '4k', label: '4K UHD', test: d => d.format === '4K UHD' },
  { id: 'bluray', label: 'Blu-ray', test: d => d.format === 'Blu-ray' },
  { id: 'criterion', label: 'Criterion', test: d => d.label === CRITERION },
];

/* The orders on offer. `shelf` is the order of the data, which is the order
   the cases really stand in. The page opens in it and, by the owner's choice,
   does not say what it is: the menu just calls it the default. */
export const SORTS = [
  { id: 'shelf', label: 'Default' },
  { id: 'title', label: 'Title, A to Z' },
  { id: 'oldest', label: 'Year, oldest first' },
  { id: 'newest', label: 'Year, newest first' },
];

/* What a title is filed under: case and accents folded, a leading article
   dropped, punctuation read as a space. Compared as plain strings, so the
   order is the same in every browser and locale. */
export function sortKey(title) {
  const folded = String(title).normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase()
    .replace(/['’]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  return folded.replace(/^(?:the|an|a) (?=\S)/, '');
}

/* The last year an entry covers: a box set spans several. */
const lastYear = d => d.yearEnd ?? d.year;

const byKey = (a, b) => {
  const ka = sortKey(a.title), kb = sortKey(b.title);
  return ka < kb ? -1 : ka > kb ? 1 : 0;
};
const ORDER = {
  title: (a, b) => byKey(a, b) || a.year - b.year,
  oldest: (a, b) => a.year - b.year || byKey(a, b),
  newest: (a, b) => lastYear(b) - lastYear(a) || byKey(a, b),
};

/* The entries one choice of chip and order shows, in the order it shows them.
   An unknown chip shows everything and an unknown order is shelf order, so a
   stale value restored into a control cannot empty the page. Ties keep shelf
   order (the sort is stable). */
export function arrange(discs, { show = 'all', sort = 'shelf' } = {}) {
  const chip = SHOWS.find(s => s.id === show) ?? SHOWS[0];
  const kept = discs.filter(chip.test);
  return ORDER[sort] ? kept.sort(ORDER[sort]) : kept;
}

/* The same things in a jumbled order: where the drawn shelf starts from when
   the page opens, before it sorts itself out. Never the order it was given
   when there are two or more to jumble, so there is always something to see.
   `random` is Math.random unless a test supplies its own. */
export function scramble(list, random = Math.random) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  if (out.length > 1 && out.every((v, i) => v === list[i])) [out[0], out[1]] = [out[1], out[0]];
  return out;
}

/* The figures the page quotes: how many entries each chip shows, and the
   oldest and newest entry (the first on the shelf when years tie). */
export function summarize(discs) {
  const shows = {};
  for (const s of SHOWS) shows[s.id] = discs.filter(s.test).length;
  let oldest = null, newest = null;
  for (const d of discs) {
    if (!oldest || d.year < oldest.year) oldest = d;
    if (!newest || lastYear(d) > lastYear(newest)) newest = d;
  }
  return { total: discs.length, shows, oldest, newest };
}

/* "1979", or "2001–2003" for an entry that spans several years. */
export function years(d) {
  return d.yearEnd && d.yearEnd !== d.year ? `${d.year}–${d.yearEnd}` : String(d.year);
}

/* The edition line under a title, as its parts: the label with its spine
   number, then any notes, then the catalogue number. */
export function edition(d) {
  return [
    d.number ? `${d.label} #${d.number}` : d.label,
    ...(d.notes ?? []),
    ...(d.catalog ? [d.catalog] : []),
  ];
}

const HEX = /^#[0-9a-f]{6}$/i;
const FACES = ['serif', 'sans', 'script'];
const isText = v => typeof v === 'string' && v.trim() !== '';
const isYear = v => Number.isInteger(v) && v >= 1888 && v <= 2100;
const between = (v, lo, hi) => typeof v === 'number' && v >= lo && v <= hi;

/* Everything wrong with the list of entries, one message each; empty when it
   can be built. The colours and sizes end up inside a style attribute, so
   they are held to a strict shape here and nowhere else. */
export function problems(discs) {
  if (!Array.isArray(discs)) return ['discs must be an array'];
  const out = [];
  const seen = new Set();
  discs.forEach((d, i) => {
    const at = `discs[${i}]${d && isText(d.id) ? ` (${d.id})` : ''}`;
    const bad = msg => out.push(`${at}: ${msg}`);
    if (!d || typeof d !== 'object' || Array.isArray(d)) { bad('must be an object'); return; }
    if (!isText(d.id) || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(d.id)) bad('id must be lowercase letters, digits and hyphens');
    else if (seen.has(d.id)) bad('id is used by an earlier entry');
    else seen.add(d.id);
    if (!isText(d.title)) bad('title must be a non-empty string');
    if (d.spine !== undefined && !isText(d.spine)) bad('spine must be a non-empty string when set');
    if (!isYear(d.year)) bad('year must be a whole year');
    if (d.yearEnd !== undefined && !(isYear(d.yearEnd) && d.yearEnd >= d.year)) bad('yearEnd must be a whole year, not before year');
    if (!isText(d.director)) bad('director must be a non-empty string');
    if (!FORMATS.some(f => f.id === d.format)) bad(`format must be one of ${FORMATS.map(f => `"${f.id}"`).join(', ')}`);
    if (!isText(d.label)) bad('label must be a non-empty string');
    if (d.number !== undefined && !(Number.isInteger(d.number) && d.number > 0)) bad('number must be a positive whole number when set');
    if (d.catalog !== undefined && !isText(d.catalog)) bad('catalog must be a non-empty string when set');
    if (d.notes !== undefined && !(Array.isArray(d.notes) && d.notes.every(isText))) bad('notes must be an array of non-empty strings when set');
    const look = d.look;
    if (!look || typeof look !== 'object') { bad('look is missing'); return; }
    if (!HEX.test(look.bg)) bad('look.bg must be a #rrggbb colour');
    if (!HEX.test(look.ink)) bad('look.ink must be a #rrggbb colour');
    if (look.cap !== undefined && !HEX.test(look.cap)) bad('look.cap must be a #rrggbb colour when set');
    if (!between(look.width, 0.8, 3)) bad('look.width must be a number from 0.8 to 3');
    if (look.height !== undefined && !between(look.height, 0.7, 1)) bad('look.height must be a number from 0.7 to 1 when set');
    if (look.face !== undefined && !FACES.includes(look.face)) bad(`look.face must be one of ${FACES.join(', ')} when set`);
  });
  return out;
}
