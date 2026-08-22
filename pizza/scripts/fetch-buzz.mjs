#!/usr/bin/env node
/*
 * Refreshes data/buzz.json from public feeds.
 *
 * Runs as its own step, not as part of the build: the site must build offline
 * and deterministically, so this writes data and the build only reads it. A
 * network failure here leaves the existing buzz.json in place and exits 0 --
 * stale buzz is much better than a failed publish.
 *
 * Sources are keyless on purpose. Google News RSS and Eater's feed need no
 * credentials; Yelp and Google Places would need an API key, and Reddit now
 * refuses anonymous reads (403).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataset = JSON.parse(fs.readFileSync(path.join(root, 'data/restaurants.json'), 'utf8'));
const buzzPath = path.join(root, 'data/buzz.json');

const UA = 'Mozilla/5.0 (compatible; SeattlePizzaIndex/1.0; +https://jackchammons.github.io/sites/pizza/)';
const KEEP_DAYS = 120;
const MAX_ITEMS = 60;

const gnews = q =>
  `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`;

const FEEDS = [
  { url: gnews('"seattle" pizza restaurant'), tag: 'news' },
  { url: gnews('seattle pizzeria'), tag: 'news' },
  { url: gnews('seattle pizza opening OR "new pizzeria"'), tag: 'news' },
  { url: 'https://seattle.eater.com/rss/index.xml', tag: 'eater' }
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
  // national chains
  'domino','papa john','pizza hut','little caesar','chuck e','marco\'s pizza','jet\'s pizza',
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

function parseFeed(xml, tag) {
  const blocks = [...xml.matchAll(/<(item|entry)\b[\s\S]*?<\/\1>/g)].map(m => m[0]);
  return blocks.map(b => {
    const pick = re => { const m = b.match(re); return m ? stripTags(m[1]) : ''; };
    const title = pick(/<title[^>]*>([\s\S]*?)<\/title>/);
    let link = pick(/<link[^>]*>([\s\S]*?)<\/link>/);
    if (!link) { const m = b.match(/<link[^>]*href="([^"]+)"/); link = m ? m[1] : ''; }
    const date = pick(/<pubDate[^>]*>([\s\S]*?)<\/pubDate>/)
              || pick(/<published[^>]*>([\s\S]*?)<\/published>/)
              || pick(/<updated[^>]*>([\s\S]*?)<\/updated>/);
    const source = pick(/<source[^>]*>([\s\S]*?)<\/source>/)
                || (tag === 'eater' ? 'Eater Seattle' : '');
    return { title, link, date, source, tag };
  }).filter(i => i.title && i.link);
}

/* Google News appends " - Publisher" to every title. Strip it whether or not
 * the feed also gave us a <source> element. */
function splitSource(item) {
  const m = item.title.match(/^(.*\S)\s+-\s+([^-]{2,40})$/);
  if (!m) return item;
  return { ...item, title: m[1].trim(), source: item.source || m[2].trim() };
}

function relevant(item) {
  const title = item.title.toLowerCase();
  const hay = `${item.title} ${item.source}`.toLowerCase();
  if (has(hay, BLOCK)) return false;
  if (!has(hay, PIZZA)) return false;
  // A local outlet writing about another city's pizza is not local news.
  if (has(title, OTHER_CITY) && !has(title, LOCAL)) return false;
  return has(hay, LOCAL) || has(item.source.toLowerCase(), LOCAL_SOURCES);
}

/* Rough intent of the headline, used to lead with places rather than trend pieces. */
function classify(title) {
  const t = title.toLowerCase();
  if (/\b(clos(e|es|ing|ed)|shutter|rip to|final day|last call|says goodbye)\b/.test(t)) return 'closing';
  if (/\b(open(s|ing|ed)?|debut|launch(es|ing)?|coming to|new pizzeria|first location|arrives)\b/.test(t)) return 'opening';
  if (/\b(best|ranked|ranking|top \d+|guide to|where to)\b/.test(t)) return 'ranking';
  return 'mention';
}

/* Which tracked pizzerias does this headline name? */
const NAMES = dataset.restaurants.map(r => ({
  id: r.id, name: r.name,
  needles: [r.name.toLowerCase(), r.name.toLowerCase().replace(/^the\s+/, '')]
    .filter(n => n.length > 4)
}));
const mentions = title => {
  const t = title.toLowerCase();
  return NAMES.filter(n => n.needles.some(x => t.includes(x))).map(n => n.id);
};

async function get(url) {
  const res = await fetch(url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(25000) });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.text();
}

const prior = fs.existsSync(buzzPath)
  ? JSON.parse(fs.readFileSync(buzzPath, 'utf8'))
  : { updated: null, items: [] };

const fetched = [];
let failures = 0;
for (const f of FEEDS) {
  try {
    const xml = await get(f.url);
    const items = parseFeed(xml, f.tag).map(splitSource).filter(relevant);
    fetched.push(...items);
    console.log(`  ${items.length.toString().padStart(3)} kept  ${f.url.slice(0, 72)}`);
  } catch (e) {
    failures++;
    console.warn(`  FAILED  ${f.url.slice(0, 72)} — ${e.message}`);
  }
}

if (failures === FEEDS.length) {
  console.warn('All feeds failed; keeping the existing buzz.json unchanged.');
  process.exit(0);
}

/* Merge with what we already had, newest first, deduped on title. */
const seen = new Set();
const norm = s => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const cutoff = Date.now() - KEEP_DAYS * 864e5;

const merged = [...fetched.map(i => ({
    title: i.title, url: i.link, source: i.source || 'Unknown',
    published: i.date ? new Date(i.date).toISOString() : new Date().toISOString(),
    kind: classify(i.title),
    mentions: mentions(i.title)
  })), ...prior.items]
  .filter(i => {
    const t = Date.parse(i.published);
    return Number.isFinite(t) && t > cutoff;
  })
  .sort((a, b) => Date.parse(b.published) - Date.parse(a.published))
  .filter(i => { const k = norm(i.title); if (seen.has(k)) return false; seen.add(k); return true; })
  .slice(0, MAX_ITEMS);

const out = { updated: new Date().toISOString(), sources: FEEDS.length, items: merged };
const serialised = JSON.stringify(out, null, 2) + '\n';
const before = fs.existsSync(buzzPath) ? JSON.parse(fs.readFileSync(buzzPath, 'utf8')).items : [];
fs.writeFileSync(buzzPath, serialised);

const added = merged.filter(m => !before.some(b => norm(b.title) === norm(m.title))).length;
const tracked = merged.filter(m => m.mentions.length).length;
console.log(`\nbuzz.json: ${merged.length} items (${added} new), ${tracked} naming a ranked pizzeria.`);
