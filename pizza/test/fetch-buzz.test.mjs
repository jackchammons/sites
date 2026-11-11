import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseFeed, splitSource, relevant, classify, mergeBuzz, staleOpening, FEEDS, KEEP_DAYS, MAX_ITEMS,
  OPENING_STALE_YEARS } from '../scripts/fetch-buzz.mjs';

const script = fileURLToPath(new URL('../scripts/fetch-buzz.mjs', import.meta.url));
const NOW = Date.parse('2026-11-10T12:00:00Z');
const restaurants = [{ id: 'delancey', name: 'Delancey' }, { id: 'moto', name: 'Moto Pizza' }];

const rss = items => `<?xml version="1.0"?><rss><channel>${items.map(i =>
  `<item><title>${i.title}</title><link>${i.link}</link>${i.date == null ? '' : `<pubDate>${i.date}</pubDate>`}` +
  `<source url="https://x.example">${i.source}</source></item>`).join('')}</channel></rss>`;

const fetched = (title, date, over = {}) => ({ title, link: `https://news.example/${encodeURIComponent(title)}`,
  date, source: 'The Seattle Times', ...over });
const stored = (title, published, over = {}) => ({ title, url: `https://news.example/${encodeURIComponent(title)}`,
  source: 'The Seattle Times', published, kind: 'mention', mentions: [], ...over });

/* ---- parsing ---- */
test('parseFeed reads RSS items and Atom entries', () => {
  const items = parseFeed(rss([{ title: 'Seattle pizzeria opens in Ballard - The Seattle Times',
    link: 'https://news.example/a', date: 'Mon, 09 Nov 2026 08:00:00 GMT', source: 'The Seattle Times' }]));
  assert.deepEqual(items, [{ title: 'Seattle pizzeria opens in Ballard - The Seattle Times',
    link: 'https://news.example/a', date: 'Mon, 09 Nov 2026 08:00:00 GMT', source: 'The Seattle Times' }]);
  assert.deepEqual(splitSource(items[0]).title, 'Seattle pizzeria opens in Ballard');

  const atom = '<feed><entry><title>A &amp; B pizza</title><link href="https://x.example/e"/>'
    + '<published>2026-11-01T00:00:00Z</published></entry></feed>';
  assert.deepEqual(parseFeed(atom), [{ title: 'A & B pizza', link: 'https://x.example/e',
    date: '2026-11-01T00:00:00Z', source: '' }]);
});

test('parseFeed finds nothing in a page that is not a feed', () => {
  assert.deepEqual(parseFeed('<!doctype html><html><head><title>Before you continue</title></head><body>Consent</body></html>'), []);
  assert.deepEqual(parseFeed(''), []);
});

test('only the Google News searches are swept', () => {
  assert.equal(FEEDS.length, 3);
  for (const url of FEEDS) assert.match(url, /^https:\/\/news\.google\.com\/rss\/search\?/);
});

/* ---- merging ---- */
test('a pubDate that does not parse drops that item and nothing else', () => {
  const merged = mergeBuzz([
    fetched('Seattle pizzeria opens in Ballard', 'Mon, 09 Nov 2026 08:00:00 GMT'),
    fetched('Another Seattle pizza story', 'yesterday-ish'),
    fetched('A Seattle pizza story with no date', ''),
    fetched('A Seattle pizza story with a null date', undefined)
  ], [], restaurants, NOW);
  assert.deepEqual(merged.map(i => i.title), ['Seattle pizzeria opens in Ballard']);
  assert.equal(merged[0].published, '2026-11-09T08:00:00.000Z');
});

test('merge: newest first, one item per headline, inside the window, capped', () => {
  const old = new Date(NOW - (KEEP_DAYS + 1) * 864e5).toISOString();
  const merged = mergeBuzz(
    [fetched('Seattle pizza story B', '2026-11-08T00:00:00Z'), fetched('Seattle pizza story A', '2026-11-09T00:00:00Z')],
    [stored('Seattle Pizza Story B!', '2026-11-01T00:00:00.000Z'), stored('Seattle pizza story C', '2026-10-01T00:00:00.000Z'),
     stored('Seattle pizza story from the spring', old)],
    restaurants, NOW);
  assert.deepEqual(merged.map(i => [i.title, i.published.slice(0, 10)]),
    [['Seattle pizza story A', '2026-11-09'], ['Seattle pizza story B', '2026-11-08'], ['Seattle pizza story C', '2026-10-01']]);

  const many = Array.from({ length: MAX_ITEMS + 15 }, (_, n) =>
    fetched(`Seattle pizza story number ${n}`, new Date(NOW - n * 3600e3).toISOString()));
  assert.equal(mergeBuzz(many, [], restaurants, NOW).length, MAX_ITEMS);
});

test('merge: fetched stories are labelled and tagged', () => {
  const [item] = mergeBuzz([fetched('Moto Pizza opens a Belltown shop in Seattle', '2026-11-09T00:00:00Z')], [], restaurants, NOW);
  assert.equal(item.kind, 'opening');
  assert.deepEqual(item.mentions, ['moto']);
  assert.deepEqual(Object.keys(item), ['title', 'url', 'source', 'published', 'kind', 'mentions']);
});

test('merge: stored feed items are read again under the current rules', () => {
  const merged = mergeBuzz([], [
    stored('Seattle-based MOD Pizza debuts a limited-time pie', '2026-10-07T00:00:00.000Z', { kind: 'opening' }),
    stored('Seattle pizza chain announces restaurant closures', '2026-09-22T00:00:00.000Z'),
    stored('Delancey serves excellent Seattle pizza', '2026-09-09T00:00:00.000Z')
  ], restaurants, NOW);
  assert.deepEqual(merged.map(i => [i.title, i.kind, i.mentions]), [
    ['Seattle pizza chain announces restaurant closures', 'closing', []],
    ['Delancey serves excellent Seattle pizza', 'mention', ['delancey']]
  ]);
});

test('merge: stories the research pass filed are kept exactly as they are', () => {
  const filed = stored('MOD Pizza founder opens a one-off shop', '2026-11-01T00:00:00.000Z',
    { kind: 'ranking', mentions: ['delancey'], via: 'research' });
  assert.deepEqual(mergeBuzz([], [filed], restaurants, NOW), [filed]);
});

test('merge: a sweep that finds nothing new returns the list it was given', () => {
  const first = mergeBuzz([
    fetched('Moto Pizza opens a Belltown shop in Seattle', '2026-11-09T00:00:00Z'),
    fetched('Seattle pizzeria closes after 16 years', '2026-11-08T00:00:00Z')
  ], [stored('A researched Seattle pizza story', '2026-11-05T00:00:00.000Z', { via: 'research' })], restaurants, NOW);
  const again = mergeBuzz([
    fetched('Seattle pizzeria closes after 16 years', '2026-11-08T00:00:00Z'),
    fetched('Moto Pizza opens a Belltown shop in Seattle', '2026-11-09T00:00:00Z')
  ], first, restaurants, NOW + 864e5);
  assert.equal(JSON.stringify(again), JSON.stringify(first));
});

/* ---- an opening story that cannot be one ---- */
const field = [
  { id: 'independent-pizzeria', name: 'Independent Pizzeria', status: 'closed', opened: 2010 },
  { id: 'gone-pie', name: 'Gone Pie', status: 'closed' },
  { id: 'old-guard', name: 'Old Guard Pizza', status: 'open', opened: 2024 },
  { id: 'last-year', name: 'Last Year Pizza', status: 'open', opened: 2025 },
  { id: 'brand-new', name: 'Brand New Pizza', status: 'open', opened: 2026 },
  { id: 'no-year', name: 'No Year Pizza', status: 'open' },
  { id: 'on-the-radar', name: 'Radar Pizza', status: 'opening' }
];

test('merge: an opening story for a pizzeria on file as closed, or as open for years, is dropped', () => {
  const titles = items => items.map(i => i.title);
  // The story as it arrived: an old article, re-dated to last week by the feed.
  const redated = 'Independent Pizzeria Opens in Madison Park';
  assert.deepEqual(mergeBuzz([fetched(redated, '2026-11-05T10:09:59Z', { source: 'Seattle Met' })], [], field, NOW), []);
  assert.deepEqual(mergeBuzz([], [stored(redated, '2026-11-05T10:09:59.000Z',
    { source: 'Seattle Met', kind: 'opening', mentions: ['independent-pizzeria'] })], field, NOW), []);

  const opening = name => `${name} opens a second Seattle shop`;
  const merged = mergeBuzz(
    [fetched(opening('Gone Pie'), '2026-11-09T00:00:00Z'), fetched(opening('Old Guard Pizza'), '2026-11-08T00:00:00Z'),
     fetched(opening('Last Year Pizza'), '2026-11-07T00:00:00Z'), fetched(opening('Brand New Pizza'), '2026-11-06T00:00:00Z')],
    [stored(opening('No Year Pizza'), '2026-11-05T00:00:00.000Z'), stored(opening('Radar Pizza'), '2026-11-04T00:00:00.000Z'),
     stored('A new pizzeria opens in Seattle this weekend', '2026-11-03T00:00:00.000Z')],
    field, NOW);
  assert.deepEqual(titles(merged), [opening('Last Year Pizza'), opening('Brand New Pizza'), opening('No Year Pizza'),
    opening('Radar Pizza'), 'A new pizzeria opens in Seattle this weekend']);
  assert.ok(merged.every(i => i.kind === 'opening'));
});

test('merge: only the opening label is doubted, and never a story the research pass filed', () => {
  const merged = mergeBuzz(
    [fetched('Independent Pizzeria closes in Madison Park after 16 years', '2026-11-09T00:00:00Z'),
     fetched('Independent Pizzeria is the best pizza in Seattle, ranked', '2026-11-08T00:00:00Z'),
     fetched('Seattle remembers Independent Pizzeria', '2026-11-07T00:00:00Z')],
    [stored('Independent Pizzeria Opens in Madison Park', '2026-11-05T00:00:00.000Z',
      { kind: 'opening', mentions: ['independent-pizzeria'], via: 'research' })],
    field, NOW);
  assert.deepEqual(merged.map(i => [i.kind, i.mentions, i.via]), [
    ['closing', ['independent-pizzeria'], undefined], ['ranking', ['independent-pizzeria'], undefined],
    ['mention', ['independent-pizzeria'], undefined], ['opening', ['independent-pizzeria'], 'research']]);
});

test('staleOpening: every entry the story names must be unable to be opening', () => {
  const byId = new Map(field.map(r => [r.id, r]));
  const story = (mentions, over = {}) => ({ title: 'x', kind: 'opening', published: '2026-11-05T00:00:00.000Z', mentions, ...over });
  assert.equal(OPENING_STALE_YEARS, 2);
  assert.equal(staleOpening(story(['independent-pizzeria']), byId), true);
  assert.equal(staleOpening(story(['gone-pie']), byId), true);
  assert.equal(staleOpening(story(['old-guard']), byId), true);
  assert.equal(staleOpening(story(['gone-pie', 'old-guard']), byId), true);
  // the year is the story's, not today's: a 2025 story about a 2024 opening is one year on
  assert.equal(staleOpening(story(['old-guard'], { published: '2025-12-31T23:00:00.000Z' }), byId), false);
  assert.equal(staleOpening(story(['last-year']), byId), false);
  assert.equal(staleOpening(story(['last-year'], { published: '2027-01-01T00:00:00.000Z' }), byId), true);
  // a new place opening in a closed one's space, or beside an old one, is still an opening
  assert.equal(staleOpening(story(['independent-pizzeria', 'brand-new']), byId), false);
  assert.equal(staleOpening(story(['old-guard', 'no-year']), byId), false);
  // nothing on file to contradict the label
  assert.equal(staleOpening(story([]), byId), false);
  assert.equal(staleOpening(story(undefined), byId), false);
  assert.equal(staleOpening(story(['not-on-file']), byId), false);
  assert.equal(staleOpening(story(['on-the-radar']), byId), false);
  assert.equal(staleOpening(story(['independent-pizzeria'], { kind: 'closing' }), byId), false);
});

/* ---- labels ---- */
test('classify: closures and shuttered shops are closings', () => {
  for (const t of ['Tutta Bella announces restaurant closures', 'Ballard pizzeria confirms closure',
    'Pizza Chain Shutters Its Original Seattle Location', 'Longtime slice shop shuttered this week',
    'Beloved Seattle pizzeria to close after 16 years', 'RIP to First Hill’s Italian Family Pizza']) {
    assert.equal(classify(t), 'closing', t);
  }
});

test('classify: a launch or a debut alone is not an opening', () => {
  assert.equal(classify('Seattle pizza chains launch limited-time collabs with Taco Time'), 'mention');
  assert.equal(classify('2 unlikely Seattle pizza collabs debut'), 'mention');
  assert.equal(classify('Pizzeria launches a new fall menu'), 'mention');
  assert.equal(classify('BIZNOTE: Mo’s Dough about to launch, with take-out vegetarian pizza'), 'opening');
  assert.equal(classify('Stevie\'s Famous Opens Phinney Ridge Pizzeria in Seattle'), 'opening');
  assert.equal(classify('A buzzy new pizzeria will give Seattle an early peek'), 'opening');
});

test('classify: lists are rankings, the rest are mentions', () => {
  assert.equal(classify('The Best Detroit-Style Pizza In Seattle, Ranked'), 'ranking');
  assert.equal(classify('The Great Seattle Pizza Smackdown'), 'mention');
});

/* ---- relevance ---- */
test('relevant: local pizza stories are kept', () => {
  assert.ok(relevant({ title: 'Beloved Seattle pizzeria to close after more than 16 years', source: 'KIRO 7 News Seattle' }));
  assert.ok(relevant({ title: 'Best pizza by neighborhood', source: 'Seattle Met' }));
});

test('relevant: chain, frozen-pizza and trade stories are not', () => {
  for (const title of [
    'Seattle-based MOD Pizza debuts limited-time \'Abbott Elementary\' Philly pizza',
    'WA pizza chain takes over former MOD Pizza space at Tacoma Mall',
    'Decades-old frozen pizza brand ends production, leaving fans nostalgic',
    'Pizza chain to close up to 50 locations as sales slump',
    'Domino\'s tests drone delivery in Seattle'
  ]) assert.equal(relevant({ title, source: 'FOX 13 Seattle' }), false, title);
  assert.equal(relevant({ title: 'Seattle council debates zoning', source: 'The Seattle Times' }), false);
  assert.equal(relevant({ title: 'The best pizza in Chicago', source: 'Eater' }), false);
});

/* ---- the CLI ---- */
test('importing the module sweeps nothing', () => {
  const out = execFileSync(process.execPath, ['--input-type=module', '-e',
    `globalThis.fetch = () => { throw new Error('fetched'); }; await import(${JSON.stringify(script)});`],
    { encoding: 'utf8' });
  assert.equal(out, '');
});
