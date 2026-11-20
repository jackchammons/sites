/* The rules in src/shelf.js, and the collection in data/data.json held to
   them. Run with: node --test bluray/test/*.test.mjs */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { FORMATS, SHOWS, SORTS, CRITERION, sortKey, arrange, summarize, years, edition, problems }
  from '../src/shelf.js';

const data = JSON.parse(fs.readFileSync(new URL('../data/data.json', import.meta.url), 'utf8'));

const look = { bg: '#000000', ink: '#ffffff', width: 1 };
const disc = (id, title, year, extra = {}) =>
  ({ id, title, year, director: 'Someone', format: 'Blu-ray', label: 'A Label', look, ...extra });
const ids = list => list.map(d => d.id);

const shelf = [
  disc('thing', 'The Thing', 1982, { format: '4K UHD' }),
  disc('amelie', 'Amélie', 2001),
  disc('trilogy', 'A Trilogy', 1994, { yearEnd: 2003, format: '4K UHD' }),
  disc('ran', 'Ran', 1985, { label: CRITERION, number: 316 }),
  disc('heat', 'Heat', 1995),
  disc('an-education', 'An Education', 2009),
];

test('sortKey files a title without its leading article, case or accents', () => {
  assert.equal(sortKey('The Deer Hunter'), 'deer hunter');
  assert.equal(sortKey('A Trilogy'), 'trilogy');
  assert.equal(sortKey('An Education'), 'education');
  assert.equal(sortKey('Amélie'), 'amelie');
  assert.equal(sortKey("It's a Wonderful Life"), 'its a wonderful life');
  assert.equal(sortKey('The Lord of the Rings: The Two Towers'), 'lord of the rings the two towers');
});

test('sortKey keeps an article that is the whole title, or part of a word', () => {
  assert.equal(sortKey('The'), 'the');
  assert.equal(sortKey('A'), 'a');
  assert.equal(sortKey('Them!'), 'them');
  assert.equal(sortKey('Anatomy of a Fall'), 'anatomy of a fall');
});

test('arrange defaults to everything in shelf order and does not reorder its input', () => {
  const before = ids(shelf);
  assert.deepEqual(ids(arrange(shelf)), before);
  arrange(shelf, { sort: 'title' });
  assert.deepEqual(ids(shelf), before);
});

test('arrange orders by title, ignoring the article', () => {
  assert.deepEqual(ids(arrange(shelf, { sort: 'title' })),
    ['amelie', 'an-education', 'heat', 'ran', 'thing', 'trilogy']);
});

test('arrange orders by year both ways, a box set by its first and last year', () => {
  assert.deepEqual(ids(arrange(shelf, { sort: 'oldest' })),
    ['thing', 'ran', 'trilogy', 'heat', 'amelie', 'an-education']);
  assert.deepEqual(ids(arrange(shelf, { sort: 'newest' })),
    ['an-education', 'trilogy', 'amelie', 'heat', 'ran', 'thing']);
});

test('entries the order cannot separate stay in shelf order', () => {
  const twins = [disc('b', 'Twin', 1990), disc('a', 'Twin', 1990), disc('c', 'The Twin', 1990)];
  for (const sort of ['title', 'oldest', 'newest']) {
    assert.deepEqual(ids(arrange(twins, { sort })), ['b', 'a', 'c'], sort);
  }
});

test('arrange filters by chip and keeps the order asked for', () => {
  assert.deepEqual(ids(arrange(shelf, { show: '4k' })), ['thing', 'trilogy']);
  assert.deepEqual(ids(arrange(shelf, { show: 'bluray', sort: 'title' })), ['amelie', 'an-education', 'heat', 'ran']);
  assert.deepEqual(ids(arrange(shelf, { show: 'criterion' })), ['ran']);
});

test('an unknown chip or order falls back to everything, as shelved', () => {
  assert.deepEqual(ids(arrange(shelf, { show: 'laserdisc', sort: 'weight' })), ids(shelf));
  assert.deepEqual(ids(arrange(shelf, { show: undefined, sort: undefined })), ids(shelf));
  assert.deepEqual(arrange([], { show: '4k', sort: 'title' }), []);
});

test('every format has exactly one chip, so the format chips add up to the whole', () => {
  for (const f of FORMATS) {
    const probe = disc('x', 'X', 2000, { format: f.id });
    const hits = SHOWS.filter(s => s.id !== 'all' && s.id !== 'criterion' && s.test(probe));
    assert.equal(hits.length, 1, f.id);
  }
  const s = summarize(shelf);
  assert.equal(s.shows['4k'] + s.shows.bluray, s.total);
});

test('summarize counts each chip and finds the oldest and newest', () => {
  const s = summarize(shelf);
  assert.equal(s.total, 6);
  assert.deepEqual(s.shows, { all: 6, '4k': 2, bluray: 4, criterion: 1 });
  assert.equal(s.oldest.id, 'thing');
  assert.equal(s.newest.id, 'an-education');
});

test('summarize takes the first on the shelf when years tie, and a box set by its last year', () => {
  const s = summarize([disc('a', 'A', 1990), disc('b', 'B', 1990), disc('set', 'Set', 1980, { yearEnd: 1990 })]);
  assert.equal(s.oldest.id, 'set');
  assert.equal(s.newest.id, 'a');
  assert.deepEqual(summarize([]), { total: 0, shows: { all: 0, '4k': 0, bluray: 0, criterion: 0 }, oldest: null, newest: null });
});

test('years gives one year, or a span for a box set', () => {
  assert.equal(years(disc('a', 'A', 1979)), '1979');
  assert.equal(years(disc('a', 'A', 2001, { yearEnd: 2003 })), '2001–2003');
  assert.equal(years(disc('a', 'A', 2001, { yearEnd: 2001 })), '2001');
});

test('edition lists the label with its number, then notes, then the catalogue number', () => {
  assert.deepEqual(edition(disc('a', 'A', 1979)), ['A Label']);
  assert.deepEqual(edition(disc('a', 'A', 1979, { label: CRITERION, number: 950 })), ['Criterion Collection #950']);
  assert.deepEqual(edition(disc('a', 'A', 1979, { notes: ['2-disc set', 'UK release'], catalog: 'ABC 1' })),
    ['A Label', '2-disc set', 'UK release', 'ABC 1']);
});

test('problems accepts a well-formed list and names each fault in a bad one', () => {
  assert.deepEqual(problems(shelf), []);
  assert.deepEqual(problems([]), []);
  assert.deepEqual(problems({}), ['discs must be an array']);

  const faulty = (extra, expected) => {
    const found = problems([{ ...disc('ok', 'OK', 2000), ...extra }]);
    assert.equal(found.length, 1, JSON.stringify(extra) + ' -> ' + JSON.stringify(found));
    assert.match(found[0], expected);
  };
  faulty({ id: 'Not A Slug' }, /id must be/);
  faulty({ title: ' ' }, /title/);
  faulty({ spine: '' }, /spine/);
  faulty({ year: '1999' }, /year must be/);
  faulty({ year: 1999.5 }, /year must be/);
  faulty({ yearEnd: 1990 }, /yearEnd/);
  faulty({ director: undefined }, /director/);
  faulty({ format: 'DVD' }, /format must be one of/);
  faulty({ label: '' }, /label/);
  faulty({ number: 0 }, /number/);
  faulty({ catalog: 7 }, /catalog/);
  faulty({ notes: 'Extended Edition' }, /notes/);
  faulty({ look: undefined }, /look is missing/);
  faulty({ look: { ...look, bg: 'red' } }, /look\.bg/);
  faulty({ look: { ...look, ink: '#fff' } }, /look\.ink/);
  faulty({ look: { ...look, cap: 'url(x)' } }, /look\.cap/);
  faulty({ look: { ...look, width: 9 } }, /look\.width/);
  faulty({ look: { ...look, width: '1' } }, /look\.width/);
  faulty({ look: { ...look, height: 2 } }, /look\.height/);
  faulty({ look: { ...look, face: 'comic' } }, /look\.face/);
});

test('problems reports a repeated id and an entry that is not an object', () => {
  const found = problems([disc('same', 'One', 2000), disc('same', 'Two', 2001), null]);
  assert.equal(found.length, 2);
  assert.match(found[0], /discs\[1\] \(same\): id is used by an earlier entry/);
  assert.match(found[1], /discs\[2\]: must be an object/);
});

test('nothing a style attribute is built from can carry anything but a colour or a number', () => {
  for (const bg of ['#12345', '#1234567', 'red;background:url(x)', '#00000g', 123456]) {
    assert.equal(problems([disc('a', 'A', 2000, { look: { ...look, bg } })]).length, 1, String(bg));
  }
  for (const width of [NaN, Infinity, '1;color:red', null]) {
    assert.equal(problems([disc('a', 'A', 2000, { look: { ...look, width } })]).length, 1, String(width));
  }
});

test('the collection in data.json has no problems', () => {
  assert.deepEqual(problems(data.discs), []);
  assert.ok(data.discs.length > 0);
  assert.match(data.updated, /^\d{4}-\d\d-\d\d$/);
});

test('every order keeps the whole collection, and the format chips add up to it', () => {
  for (const s of SORTS) assert.equal(arrange(data.discs, { sort: s.id }).length, data.discs.length, s.id);
  const s = summarize(data.discs);
  assert.equal(s.shows.all, data.discs.length);
  assert.equal(s.shows['4k'] + s.shows.bluray, s.total);
});
