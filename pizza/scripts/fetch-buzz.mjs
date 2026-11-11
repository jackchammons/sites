#!/usr/bin/env node
/*
 * Refreshes data/buzz.json from public feeds.
 *
 * Runs as its own step, not as part of the build: the site must build offline
 * and deterministically, so this writes data and the build only reads it.
 * Whatever goes wrong here -- the network, a feed that answers with something
 * that is not a feed, a date that will not parse -- leaves the existing
 * buzz.json in place and exits 0: stale buzz is much better than a failed
 * publish.
 *
 * The file is rewritten only when the list of stories changes, so `updated`
 * is the last sweep that changed it, not the last sweep that ran.
 *
 * Sources are keyless on purpose. Google News RSS needs no credentials; Yelp
 * and Google Places would need an API key, and Reddit now refuses anonymous
 * reads (403). Eater Seattle's own feed is not swept: it carries city guides
 * whose titles never mention pizza, and Google News already surfaces Eater's
 * pizza stories.
 *
 * The parsing, filtering and merging are pure and exported for the tests; the
 * fetches and the file write happen in the CLI block at the end.
 */
import fs from 'node:fs';
import { mentionMatch } from '../src/match.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const buzzPath = path.join(root, 'data/buzz.json');

const UA = 'Mozilla/5.0 (compatible; SeattlePizzaIndex/1.0; +https://sites.jackhammons.com/pizza/)';
export const KEEP_DAYS = 120;
export const MAX_ITEMS = 60;

const gnews = q =>
  `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`;

export const FEEDS = [
  gnews('"seattle" pizza restaurant'),
  gnews('seattle pizzeria'),
  gnews('seattle pizza opening OR "new pizzeria"')
];

/* Neighbourhood and city terms that make a story plausibly local. */
const LOCAL = ['seattle','ballard','fremont','capitol hill','west seattle','phinney',
  'wallingford','georgetown','beacon hill','u district','university district','pioneer square',
  'belltown','queen anne','columbia city','greenwood','ravenna','madison park','central district',
  'white center','sodo','puget sound','pnw','pacific northwest','tacoma','bellevue','burien'];

/* Outlets whose Seattle-ness we can take on trust. */
const LOCAL_SOURCES = ['seattle times','eater','infatuation','seattle met','seattle magazine',
  'the stranger','king5','kiro','komo','capitol hill seattle','puget sound business journal',
  'axios seattle','seattle refined','thrillist','seattlepi','the urbanist','geekwire'];

const PIZZA = ['pizza','pizzeria','pizzas','slice','neapolitan','deep dish','detroit-style'];

/* National chains and non-food stories that match "pizza" incidentally. */
const BLOCK = [
  // national chains, and the trade stories written about them
  'domino','papa john','pizza hut','little caesar','chuck e','marco\'s pizza','jet\'s pizza',
  'mod pizza','sales slump',
  // supermarket pizza is not a pizzeria
  'frozen pizza',
  // crime and public-safety stories that merely mention a pizzeria
  'shooting','stabbing','shot dead','homicide','robbery','arrested','burglary','assault',
  // business/tech/real-estate stories that are not about eating pizza
  'robot','mansion','yacht','layoffs','ipo','stock','liquidat','startup','acquisition',
  'lawsuit','e. coli','salmonella','listeria','recall',
  // sport and unrelated
  'notts county','chesterfield','premier league','nfl','nba draft'];

/* A story about another city's pizza scene, published by a local outlet, is
 * still not Seattle news. */
const OTHER_CITY = ['new york','new jersey','chicago','portland','los angeles','san francisco',
  'detroit','boston','miami','austin','denver','phoenix'];

const has = (text, list) => list.some(t => text.includes(t));

function stripTags(s) {
  return s.replace(/<!\[CDATA\[|\]\]>/g, '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d))
          .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
          .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
          .replace(/\s+/g, ' ').trim();
}

export function parseFeed(xml) {
  const blocks = [...xml.matchAll(/<(item|entry)\b[\s\S]*?<\/\1>/g)].map(m => m[0]);
  return blocks.map(b => {
    const pick = re => { const m = b.match(re); return m ? stripTags(m[1]) : ''; };
    const title = pick(/<title[^>]*>([\s\S]*?)<\/title>/);
    let link = pick(/<link[^>]*>([\s\S]*?)<\/link>/);
    if (!link) { const m = b.match(/<link[^>]*href="([^"]+)"/); link = m ? m[1] : ''; }
    const date = pick(/<pubDate[^>]*>([\s\S]*?)<\/pubDate>/)
              || pick(/<published[^>]*>([\s\S]*?)<\/published>/)
              || pick(/<updated[^>]*>([\s\S]*?)<\/updated>/);
    const source = pick(/<source[^>]*>([\s\S]*?)<\/source>/);
    return { title, link, date, source };
  }).filter(i => i.title && i.link);
}

/* Google News appends " - Publisher" to every title. Strip it whether or not
 * the feed also gave us a <source> element. */
export function splitSource(item) {
  const m = item.title.match(/^(.*\S)\s+-\s+([^-]{2,40})$/);
  if (!m) return item;
  return { ...item, title: m[1].trim(), source: item.source || m[2].trim() };
}

export function relevant(item) {
  const title = item.title.toLowerCase();
  const hay = `${item.title} ${item.source}`.toLowerCase();
  if (has(hay, BLOCK)) return false;
  if (!has(hay, PIZZA)) return false;
  // A local outlet writing about another city's pizza is not local news.
  if (has(title, OTHER_CITY) && !has(title, LOCAL)) return false;
  return has(hay, LOCAL) || has(item.source.toLowerCase(), LOCAL_SOURCES);
}

/* Rough intent of the headline, used to lead with places rather than trend pieces.
 * "launch" and "debut" on their own are what a menu item or a promotion does;
 * they mark an opening only when the place itself is about to. */
export function classify(title) {
  const t = title.toLowerCase();
  if (/\b(clos(e|es|ing|ed|ure|ures)|shutter(s|ed|ing)?|rip to|final day|last call|says goodbye)\b/.test(t)) return 'closing';
  if (/\b(open(s|ing|ed)?|(about|set|ready|slated) to (launch|debut)|coming to|new pizzeria|first location|arrives)\b/.test(t)) return 'opening';
  if (/\b(best|ranked|ranking|top \d+|guide to|where to)\b/.test(t)) return 'ranking';
  return 'mention';
}

/* The stored list after a sweep: what the feeds just returned plus what was
 * already on file, newest first, one item per headline, inside the window.
 *
 * A fetched item whose date will not parse is dropped: there is no honest
 * date to file it under, and stamping it "now" would make it look new on
 * every sweep. Stored feed items are read again under today's rules, so a
 * widened block list or a corrected label reaches the stories already on the
 * page; items the research pass filed (`via: 'research'`) went through its
 * own gate and are kept as they are. */
export function mergeBuzz(fetched, prior, restaurants, nowMs = Date.now()) {
  const norm = s => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const cutoff = nowMs - KEEP_DAYS * 864e5;
  const fromFeed = i => ({ kind: classify(i.title), mentions: mentionMatch(i.title, restaurants) });

  const fresh = fetched
    .filter(i => Number.isFinite(Date.parse(i.date)))
    .map(i => ({
      title: i.title, url: i.link, source: i.source || 'Unknown',
      published: new Date(Date.parse(i.date)).toISOString(),
      ...fromFeed(i)
    }));
  const kept = prior
    .filter(i => i.via === 'research' || relevant(i))
    .map(i => i.via === 'research' ? i : { ...i, ...fromFeed(i) });

  const seen = new Set();
  return [...fresh, ...kept]
    .filter(i => {
      const t = Date.parse(i.published);
      return Number.isFinite(t) && t > cutoff;
    })
    .sort((a, b) => Date.parse(b.published) - Date.parse(a.published))
    .filter(i => { const k = norm(i.title); if (seen.has(k)) return false; seen.add(k); return true; })
    .slice(0, MAX_ITEMS);
}

async function get(url) {
  const res = await fetch(url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(25000) });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.text();
}

async function sweep() {
  const dataset = JSON.parse(fs.readFileSync(path.join(root, 'data/restaurants.json'), 'utf8'));
  const prior = fs.existsSync(buzzPath)
    ? JSON.parse(fs.readFileSync(buzzPath, 'utf8'))
    : { updated: null, items: [] };

  const fetched = [];
  let failures = 0;
  for (const url of FEEDS) {
    try {
      const parsed = parseFeed(await get(url));
      // A 200 that carries no items is an error page or a changed format, not
      // a quiet day: the search feeds always return stories.
      if (!parsed.length) throw new Error('answered, but with no items');
      const items = parsed.map(splitSource).filter(relevant);
      fetched.push(...items);
      console.log(`  ${items.length.toString().padStart(3)} kept  ${url.slice(0, 72)}`);
    } catch (e) {
      failures++;
      console.warn(`  FAILED  ${url.slice(0, 72)} — ${e.message}`);
    }
  }

  if (failures === FEEDS.length) {
    console.warn('All feeds failed; keeping the existing buzz.json unchanged.');
    return;
  }

  const merged = mergeBuzz(fetched, prior.items, dataset.restaurants);
  const norm = s => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const added = merged.filter(m => !prior.items.some(b => norm(b.title) === norm(m.title))).length;
  const tracked = merged.filter(m => m.mentions.length).length;

  if (JSON.stringify(merged) === JSON.stringify(prior.items)) {
    console.log(`\nbuzz.json: ${merged.length} items, nothing changed; file left as it was.`);
    return;
  }
  const out = { updated: new Date().toISOString(), sources: FEEDS.length, items: merged };
  fs.writeFileSync(buzzPath, JSON.stringify(out, null, 2) + '\n');
  console.log(`\nbuzz.json: ${merged.length} items (${added} new), ${tracked} naming a ranked pizzeria.`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1])) {
  // Nothing in a sweep is worth a failed publish, so an error anywhere in it
  // is reported and the run carries on with the buzz.json already on file.
  await sweep().catch(e => {
    console.warn(`Buzz sweep abandoned; keeping the existing buzz.json unchanged.\n${e.stack ?? e}`);
    console.log(`::warning title=buzz sweep abandoned::${String(e.message ?? e).split('\n')[0]}`);
  });
}
