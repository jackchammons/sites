import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseFeed, splitSource, relevant, classify, mergeBuzz, FEEDS, KEEP_DAYS, MAX_ITEMS }
  from '../scripts/fetch-buzz.mjs';

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
