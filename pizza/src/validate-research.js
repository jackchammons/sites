/*
 * The research-file gate, as a pure function: everything the agent writes is
 * checked here before anything downstream may use it. No file or clock access,
 * so the whole rule set is unit-testable -- the CLI wrapper in
 * scripts/verify-research.mjs does the I/O.
 *
 * Returns { fails, sections }: an empty fails array means the document passed.
 */
import { PUGET_SOUND_ZIP, PUGET_SOUND_ZIP_LABEL } from './bounds.js';
import { normName } from './census.js';
import { streetKey } from './locations.js';
import { PER_PASS } from './rules.js';
import { FACT_FIELDS } from './schema.js';
import { isRated, isLaunchRating } from './slice.js';

export const KINDS = new Set(['opening', 'closing', 'ranking', 'mention']);
/* The `…Skipped` sections, each with the tasks whose worklist it serves. A
 * record in one says a pass looked at an entry and could not resolve it, so
 * the worklist rests the entry. That is attempt memory, not data, and it is
 * never the reason a file is refused: a section that repeats an id keeps the
 * first record for it, and one that runs past its cap keeps the records up
 * to the cap, each dropped record reported like any other rejection. Losing
 * the file instead loses every other section with it and redraws the same
 * worklist on the next pass. */
export const SKIPPED = { ratingSkipped: ['rating', 'rerate'], locationsSkipped: ['locations'],
                         factsSkipped: ['facts'], coverageSkipped: ['coverage'], socialSkipped: ['social'] };
/* Twice the largest worklist a section serves, read from rules.js: a pass
 * that resolves nothing reports every entry it was given, and the room above
 * that is for an entry the agent looked at beyond its list. */
const skippedCap = tasks => 2 * Math.max(...tasks.map(t => PER_PASS[t]));
/* The most records a section may hold. Past it, any section but a
 * `…Skipped` one fails the file. `facts` holds three records for each entry
 * of its worklist, because a record carries what one page states and an
 * entry's facts are spread over its About page, its menu and its coverage. */
export const CAPS = { news: 20, locations: 12, directory: 10, status: 10,
                      mentions: 40, factorRatings: 12, links: 20,
                      candidateReview: 15, facts: 3 * PER_PASS.facts,
                      factorSources: 12,
                      ...Object.fromEntries(Object.entries(SKIPPED).map(([sec, tasks]) => [sec, skippedCap(tasks)])) };
export const MAX_AGE_DAYS = 180;
/* Mentions feed a 24-month coverage window in slice.js; capping them at 180
 * days meant the window could never fill from the loop. */
export const MENTION_MAX_AGE_DAYS = 730;
export const MAX_LEN = { name: 80, note: 600, title: 200, address: 200,
                         style: 120, signature: 100, source: 80, url: 2000 };
/* The most entries one news story may be tied to. */
export const MAX_STORY_MENTIONS = 40;
/* Top-level keys that are not sections but belong in the file: the agent's
 * timestamp, the gate's own record of what it dropped (rejected records,
 * ignored keys), and the names that are handled or refused below. */
const OTHER_KEYS = ['updated', 'rejected', 'ignored', 'items', 'ratings'];

/* Hosts that are not published criticism: aggregators, social, ordering and
 * reference sites. A rating resting ONLY on these (or on the pizzeria's own
 * site) is refused; a closure citing only one of these is a lead, not evidence
 * (the one exception is the pizzeria's own account, isOwnAccount below). */
export const NON_CRITICISM_HOSTS = ['yelp.com', 'tripadvisor.com', 'happycow.net', 'onebite.app',
  'google.com', 'maps.google.com', 'wikipedia.org', 'facebook.com', 'instagram.com', 'doordash.com',
  'grubhub.com', 'ubereats.com', 'toasttab.com', 'squareup.com', 'restaurantji.com', 'foursquare.com',
  'zomato.com', 'opentable.com', 'resy.com'];
export const hostOf = u => { try { return new URL(u).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; } };

/* The name a host is registered under, with subdomains and the public suffix
 * taken off: "m.yelp.com", "yelp.ca" and "yelp.co.uk" are all "yelp". The
 * list above is matched on this name, because each of those sites answers on
 * a domain per country, and yelp.ca is no better evidence than yelp.com. No
 * suffix list is needed for that: the last label is the suffix, and so is a
 * "co"/"com"-style label in front of a two-letter country code. */
const COUNTRY_SECOND_LEVEL = new Set(['co', 'com', 'net', 'org', 'ne', 'or']);
export const registrableName = host => {
  const labels = String(host).toLowerCase().split('.').filter(Boolean);
  const suffix = labels.pop() ?? '';
  if (suffix.length === 2 && labels.length > 1 && COUNTRY_SECOND_LEVEL.has(labels.at(-1))) labels.pop();
  return labels.at(-1) ?? '';
};
const NON_CRITICISM_NAMES = new Set(NON_CRITICISM_HOSTS.map(registrableName));
export const isNonCriticism = (u, own = []) => {
  const h = hostOf(u);
  return !h || NON_CRITICISM_NAMES.has(registrableName(h)) || own.includes(h);
};

/* A closure announced by the pizzeria itself, on the Instagram or Facebook
 * account on file for it. That is where a small pizzeria says goodbye, and
 * for many it is the only announcement there will ever be, so the social
 * hosts cannot be refused outright for closures the way they are as criticism.
 *
 * A URL counts only when it names the account: the profile itself, or
 * anything under it (instagram.com/<handle>/, /<handle>/p/<id>/,
 * /<handle>/reel/<id>/, facebook.com/<page>/posts/<id>). A bare
 * instagram.com/p/<id>/ or facebook.com/permalink.php?… names no account,
 * so nothing ties it to the entry and it stays a lead. So does a story
 * (instagram.com/stories/<handle>/…): it is gone in a day and cannot be
 * cited. The account on file is the first path segment of the entry's
 * `instagram`, or of its `url` when that is itself a profile on one of the
 * two platforms (an entry with no website is filed that way).
 *
 * The platforms are matched by exact host here, not by registrable name:
 * refusing a look-alike domain is safe, accepting one is not. */
const ACCOUNT_NAME = /^[a-z0-9._]{2,50}$/;
const NOT_AN_ACCOUNT = new Set(['p', 'reel', 'reels', 'tv', 'stories', 'explore', 'accounts', 'share',
  'pages', 'groups', 'events', 'watch', 'people', 'photo', 'photos', 'posts', 'videos', 'story', 'login']);
const accountOf = u => {
  const host = hostOf(u).replace(/^(m|mobile)\./, '');
  if (host !== 'instagram.com' && host !== 'facebook.com') return null;
  const first = (new URL(u).pathname.split('/').filter(Boolean)[0] ?? '').toLowerCase();
  if (!ACCOUNT_NAME.test(first) || first.endsWith('.php') || NOT_AN_ACCOUNT.has(first)) return null;
  return `${host}/${first}`;
};
export const isOwnAccount = (u, entry) => {
  const account = accountOf(u);
  return account != null && [entry?.url, entry?.instagram].some(own => own && accountOf(own) === account);
};

/* A page of the web presence on file for an entry, when that presence lives
 * on a host the list above names: its own social account, or the url on file
 * and anything beneath it. A pizzeria with no site of its own is filed under
 * its profile or the ordering page it links as its own, and for that entry
 * such a page is its menu, not an aggregator's listing. The url on file has
 * to name a page, since the host alone is shared by every business on it. */
export const isOwnPage = (u, entry) => {
  if (isOwnAccount(u, entry)) return true;
  let page, own;
  try { page = new URL(u); own = new URL(entry?.url); } catch { return false; }
  const path = x => x.pathname.replace(/\/+$/, '');
  return hostOf(u) === hostOf(entry.url) && path(own) !== ''
    && (path(page) === path(own) || path(page).startsWith(path(own) + '/'));
};

/* Returns { fails, sections, fatal, accepted, unknown }. `fails` is every
 * problem found; `fatal` means the document itself is unusable (not an object,
 * a section over its cap, a retired channel); otherwise `accepted` holds each
 * section with the failing records dropped, so one bad record costs that
 * record, not the run. A `…Skipped` section over its cap is not fatal: the
 * records past the cap are dropped like any other failing record. `unknown` names the top-level keys that are no section
 * at all: a misspelt section ("statuses", "factorRating") is never applied,
 * and the caller has to say so rather than report a clean, empty pass. */
export function validateResearch(doc, dataset, nowMs = Date.now(), extra = {}) {
  const fails = [];
  const badIdx = {};
  // A message may quote the value it refuses, and that value has no bound yet.
  const clip = msg => msg.length > 300 ? msg.slice(0, 300) + '…' : msg;
  const bad = (sec, i, msg) => {
    fails.push(clip(`${sec}[${i}]: ${msg}`));
    (badIdx[sec] ??= new Set()).add(i);
  };
  const byId = new Map(dataset.restaurants.map(r => [r.id, r]));

  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
    return { fails: ['research.json must be a JSON object.'], sections: {}, fatal: true, accepted: {}, unknown: [] };
  }

  /* `items` was the original field name; keep reading it so older files still work. */
  const news = doc.news ?? doc.items ?? [];
  const sections = { news,
                     locations: doc.locations ?? [], directory: doc.directory ?? [],
                     status: doc.status ?? [], mentions: doc.mentions ?? [],
                     factorRatings: doc.factorRatings ?? [],
                     links: doc.links ?? [],
                     candidateReview: doc.candidateReview ?? [],
                     facts: doc.facts ?? [],
                     ratingSkipped: doc.ratingSkipped ?? [],
                     factorSources: doc.factorSources ?? [],
                     factsSkipped: doc.factsSkipped ?? [],
                     locationsSkipped: doc.locationsSkipped ?? [],
                     coverageSkipped: doc.coverageSkipped ?? [],
                     socialSkipped: doc.socialSkipped ?? [] };
  if (Array.isArray(doc.ratings) && doc.ratings.length) {
    fails.push('ratings are no longer accepted: the dataset holds no crowd figures, see CLAUDE.md');
  }
  /* Retired sections fail loudly rather than being dropped: a claim routed
   * through an old channel must be re-expressed through the live one, not
   * silently lost. */
  const RETIRED = { candidates: 'use "directory"', closures: 'use "status"', factors: 'use "factorRatings"' };
  for (const [k, hint] of Object.entries(RETIRED)) {
    if (Array.isArray(doc[k]) && doc[k].length) fails.push(`"${k}" is retired — ${hint}`);
  }
  const known = new Set([...Object.keys(sections), ...OTHER_KEYS, ...Object.keys(RETIRED)]);
  const unknown = Object.keys(doc).filter(k => !known.has(k));

  for (const [name, arr] of Object.entries(sections)) {
    if (!Array.isArray(arr)) { fails.push(`${name} must be an array`); continue; }
    if (arr.length > CAPS[name] && !Object.hasOwn(SKIPPED, name)) fails.push(`${name}: ${arr.length} entries exceeds the ${CAPS[name]} cap`);
  }
  if (fails.length) return { fails, sections, fatal: true, accepted: {}, unknown };

  /* A claim we cannot check is not usable, so every section needs a live https source. */
  const checkUrl = (sec, i, url, field = 'url') => {
    let u;
    try { u = new URL(url); } catch { bad(sec, i, `${field} is not a valid URL: ${url}`); return; }
    // The string is stored as written, not as parsed, so it has to be a plain
    // one: a real address carries no markup, quotes or spaces unencoded.
    if (typeof url !== 'string' || url.length > MAX_LEN.url || /[<>"\s]/.test(url)) {
      bad(sec, i, `${field} is not a plain URL of at most ${MAX_LEN.url} characters: ${url}`);
      return;
    }
    if (u.protocol !== 'https:') bad(sec, i, `${field} must be https: ${url}`);
  };
  const checkDate = (sec, i, v, field, maxAgeDays = MAX_AGE_DAYS) => {
    const t = Date.parse(v);
    if (!Number.isFinite(t)) { bad(sec, i, `${field} is not a parseable date: ${v}`); return; }
    if (t > nowMs + 864e5) bad(sec, i, `${field} is in the future: ${v}`);
    else if (t < nowMs - maxAgeDays * 864e5) bad(sec, i, `${field} is older than ${maxAgeDays} days`);
  };

  /* Free text that reaches the page: bounded, and in a Latin script. A name in
   * a look-alike script ('Zeeks Pizzа' with a Cyrillic а) normalises to a new
   * slug and forks a real entry. Angle brackets are refused outright: no
   * name, note or address needs one, and the map popup is built from these
   * strings in the browser, so the gate does not rest on every sink escaping. */
  const NON_LATIN = /[^\p{Script=Latin}\p{N}\p{P}\p{S}\s]/u;
  const checkText = (sec, i, v, field, max, min = 0) => {
    if (typeof v !== 'string' || v.trim().length < min) { bad(sec, i, `${field} missing or too short`); return false; }
    if (v.length > max) { bad(sec, i, `${field} is longer than ${max} characters`); return false; }
    if (/[<>]/.test(v)) { bad(sec, i, `${field} contains < or >: "${v.slice(0, 40)}"`); return false; }
    if (NON_LATIN.test(v)) { bad(sec, i, `${field} contains characters outside the Latin script: "${v.slice(0, 40)}"`); return false; }
    return true;
  };

  /* The note on a `…Skipped` record says what was searched. The record's job
   * is the attempt: it is what rests the entry. So a note that runs long is
   * cut to the limit and kept, where any other over-long text is refused.
   * Refusing it dropped the record, the entry was never marked as looked at,
   * and the next pass was handed it again. Every other rule still applies. */
  const checkSkipNote = (sec, i, it) => {
    if (typeof it?.note === 'string' && it.note.length > MAX_LEN.note) {
      it.note = `${it.note.slice(0, MAX_LEN.note - 1).trimEnd()}\u2026`;
    }
    return checkText(sec, i, it?.note, 'note', MAX_LEN.note, 10);
  };

  const seen = new Set();
  news.forEach((it, i) => {
    checkText('news', i, it?.title, 'title', MAX_LEN.title, 8);
    checkText('news', i, it?.source, 'source', MAX_LEN.source, 1);
    checkUrl('news', i, it?.url);
    checkDate('news', i, it?.published, 'published');
    if (!KINDS.has(it?.kind)) bad('news', i, `kind must be one of ${[...KINDS].join('|')}, got "${it?.kind}"`);
    if (it?.mentions != null && (!Array.isArray(it.mentions) || it.mentions.length > MAX_STORY_MENTIONS)) {
      bad('news', i, `mentions must be an array of at most ${MAX_STORY_MENTIONS} entry ids`);
    } else {
      for (const m of it?.mentions ?? []) if (!byId.has(m)) bad('news', i, `mentions unknown id "${m}"`);
    }
    const key = String(it?.url || it?.title).toLowerCase();
    if (seen.has(key)) bad('news', i, 'duplicate of an earlier item');
    seen.add(key);
  });

  /* ---- locations ----
   * Addresses are the one factual field an agent may write into the dataset,
   * because the business publishes them itself on a page that serves to anyone.
   * That makes them checkable, which crowd ratings (403) and graded factors
   * (a judgement) are not. These checks exist to catch a plausible invention: a
   * street address that is not one, a branch in another metro, the same branch
   * listed twice.
   */
  /* Region check by ZIP, not by city name. The first version listed cities and
   * rejected a real Zeeks branch in Mill Creek on its first live run -- a chain
   * opens somewhere the list has never heard of and the gate calls the truth a
   * lie. The prefixes are in src/bounds.js, with the box the geocoder and the
   * dataset lint hold the same addresses to.
   *
   * The range is wider than "Seattle metro" strictly means, and deliberately so:
   * this check exists to catch a fabricated address or an out-of-region outpost --
   * Spokane 992xx, Vancouver WA 986xx, Portland OR -- not to adjudicate which
   * suburbs count. A chain reporting its real Tacoma branch is telling the truth,
   * and a validator that calls that a lie is the more expensive failure. */

  sections.locations.forEach((it, i) => {
    if (!byId.has(it?.id)) bad('locations', i, `unknown restaurant id "${it?.id}"`);
    checkUrl('locations', i, it?.source, 'source');
    // Optional: omitted when a pizzeria genuinely has no site of its own.
    if (it?.homepage != null) checkUrl('locations', i, it.homepage, 'homepage');

    const sites = it?.sites;
    if (!Array.isArray(sites) || !sites.length) {
      bad('locations', i, 'sites must be a non-empty array');
      return;
    }
    if (sites.length > 40) bad('locations', i, `${sites.length} sites is implausible`);

    const seenSites = new Set();
    sites.forEach((st, j) => {
      const where = `sites[${j}]`;
      checkText('locations', i, st?.neighborhood, `${where}: neighborhood`, MAX_LEN.name, 1);
      const addr = st?.address;
      if (!checkText('locations', i, addr, `${where}: address`, MAX_LEN.address, 1)) return;
      // A street address starts with a number and names a street. This rejects
      // "Capitol Hill" or "Seattle, WA" dressed up as an address.
      if (!/^\s*\d/.test(addr)) bad('locations', i, `${where}: address does not start with a street number: "${addr}"`);
      if (!/\bWA\b|\bWashington\b/i.test(addr)) bad('locations', i, `${where}: address is not in Washington: "${addr}"`);
      if (!PUGET_SOUND_ZIP.test(addr)) bad('locations', i, `${where}: no Puget Sound ZIP (${PUGET_SOUND_ZIP_LABEL}): "${addr}"`);
      const key = addr.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
      if (seenSites.has(key)) bad('locations', i, `${where}: duplicate address "${addr}"`);
      seenSites.add(key);
    });
  });

  /* ---- directory: discovered pizzerias ----
   * The important failure to catch is a duplicate of something on file under a
   * slightly different name, which would fork one pizzeria into two entries.
   * Two keys guard it: the normalised name (src/census.js, shared with the
   * candidates queue) and the street address. Both sets grow as records are
   * accepted, so two spellings of one find in the same file collide too.
   * A closed entry does not hold its address: the next pizzeria into that
   * space is a new entry. */
  const knownNames = new Map(dataset.restaurants.map(r => [normName(r.name), r.name]));
  const knownStreets = new Map(dataset.restaurants.filter(r => r.status !== 'closed')
    .flatMap(r => (r.locations ?? []).map(l => [streetKey(l.address), r.name])));
  const foundHere = new Set();

  sections.directory.forEach((it, i) => {
    if (!checkText('directory', i, it?.name, 'name', MAX_LEN.name, 2)) return;
    const nameKey = normName(it.name);
    if (nameKey && knownNames.has(nameKey)) {
      bad('directory', i, foundHere.has(nameKey)
        ? `"${it.name}" repeats "${knownNames.get(nameKey)}" from earlier in this file`
        : `"${it.name}" is already on file`);
    }
    if (!['open', 'opening'].includes(it?.status)) bad('directory', i, `status must be open|opening, got "${it?.status}"`);
    checkText('directory', i, it?.neighborhood, 'neighborhood', MAX_LEN.name, 1);
    if (it?.style != null) checkText('directory', i, it.style, 'style', MAX_LEN.style);
    checkText('directory', i, it?.note, 'note', MAX_LEN.note, 15);
    checkUrl('directory', i, it?.source, 'source');
    if (it?.url != null) checkUrl('directory', i, it.url, 'url');
    let streetAt = null;
    if (it?.address != null && checkText('directory', i, it.address, 'address', MAX_LEN.address, 1)) {
      if (!/^\s*\d/.test(it.address)) bad('directory', i, `address does not start with a street number: "${it.address}"`);
      if (!PUGET_SOUND_ZIP.test(it.address)) bad('directory', i, `no Puget Sound ZIP: "${it.address}"`);
      streetAt = streetKey(it.address);
      if (knownStreets.has(streetAt)) {
        bad('directory', i, `"${it.address}" is already on file as ${knownStreets.get(streetAt)}`);
      }
    }
    if (badIdx.directory?.has(i)) return;
    if (nameKey) { knownNames.set(nameKey, it.name); foundHere.add(nameKey); }
    if (streetAt) knownStreets.set(streetAt, it.name);
  });

  /* ---- status: liveness confirmations ---- */
  sections.status.forEach((it, i) => {
    if (!byId.has(it?.id)) bad('status', i, `unknown restaurant id "${it?.id}"`);
    if (!['open', 'closed', 'opening'].includes(it?.status)) bad('status', i, `status must be open|closed|opening, got "${it?.status}"`);
    checkText('status', i, it?.note, 'note', MAX_LEN.note, 10);
    checkUrl('status', i, it?.source, 'source');
    // A closure removes an entry from the ranking and from every worklist; a
    // review-site label or a listing is a lead, not evidence of one. The
    // pizzeria's own site is no aggregator and passes as any news page does;
    // its own social account passes when the URL names that account.
    if (it?.status === 'closed' && isNonCriticism(it?.source) && !isOwnAccount(it?.source, byId.get(it?.id))) {
      const host = hostOf(it?.source);
      bad('status', i, `a closure needs a news report or the pizzeria's own announcement, not ${host || 'that source'}`
        + (/(^|\.)(instagram|facebook)\.com$/.test(host)
          ? ' (a post counts only when its URL carries the account on file for the entry, as in instagram.com/<handle>/p/<id>/)' : ''));
    }
    // The date a status took effect, as the source reports it. A closure found
    // late is still a closure that happened years ago, so no staleness cap.
    if (it?.date != null) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(it.date))) bad('status', i, `date must be YYYY-MM-DD, got "${it.date}"`);
      else checkDate('status', i, it.date, 'date', 365 * 40);
    }
  });

  /* ---- mentions: coverage tied to entries ---- */
  sections.mentions.forEach((it, i) => {
    if (!byId.has(it?.id)) bad('mentions', i, `unknown restaurant id "${it?.id}"`);
    checkText('mentions', i, it?.title, 'title', MAX_LEN.title, 8);
    checkText('mentions', i, it?.source, 'source name', MAX_LEN.source, 1);
    checkUrl('mentions', i, it?.url);
    checkDate('mentions', i, it?.date, 'date', MENTION_MAX_AGE_DAYS);
    if (!KINDS.has(it?.kind)) bad('mentions', i, `kind must be one of ${[...KINDS].join('|')}, got "${it?.kind}"`);
  });

  /* A style group is a label the page groups entries under, so it is held
   * short. The rating task and the facts task both write one, under this one
   * rule. */
  const checkStyleGroup = (sec, i, v) => {
    if (typeof v !== 'string' || v.trim().length < 3 || v.trim().length > 24) {
      bad(sec, i, `styleGroup must be a short label, got "${v}"`);
    } else {
      checkText(sec, i, v, 'styleGroup', MAX_LEN.name);
    }
  };

  /* Values bounded and stepped so a typo cannot smuggle in a 47. */
  const validFactorValue = v => typeof v === 'number' && v >= 0 && v <= 10 && Math.round(v * 2) === v * 2;
  /* factorRatings: the full proposal that makes an unrated entry rankable, or
   * replaces a launch rating (isLaunchRating in slice.js) with one read from
   * published coverage. Stricter than `factors` because it grants entry to
   * the ladder: values bounded, an entry the agent has already rated is
   * refused outright, and every proposal carries the sources it was read
   * from. */
  const thisYear = new Date(nowMs).getUTCFullYear();
  const agentRated = r => isRated(r) && !isLaunchRating(r);

  const ratingSeen = new Set();
  sections.factorRatings.forEach((it, i) => {
    const r = byId.get(it?.id);
    if (!r) { bad('factorRatings', i, `unknown restaurant id "${it?.id}"`); return; }
    if (ratingSeen.has(it.id)) { bad('factorRatings', i, `duplicate proposal for "${it.id}"`); return; }
    ratingSeen.add(it.id);
    if (agentRated(r)) { bad('factorRatings', i, `${r.name} is already rated; ratings are never overwritten`); return; }
    for (const k of ['craft', 'distinctiveness']) {
      if (!validFactorValue(it?.[k])) bad('factorRatings', i, `${k} must be 0-10 in 0.5 steps, got ${it?.[k]}`);
    }
    if (typeof it?.criticScore !== 'number' || it.criticScore < 0 || it.criticScore > 10) {
      bad('factorRatings', i, `criticScore must be a number 0-10, got ${it?.criticScore}`);
    }
    if (it?.opened != null && (typeof it.opened !== 'number' || it.opened < 1900 || it.opened > thisYear)) {
      bad('factorRatings', i, `opened must be a year 1900-${thisYear}, got ${it.opened}`);
    }
    if (it?.priceIndex != null && ![1, 2, 3, 4].includes(it.priceIndex)) {
      bad('factorRatings', i, `priceIndex must be 1-4, got ${it.priceIndex}`);
    }
    if (it?.styleGroup != null) checkStyleGroup('factorRatings', i, it.styleGroup);
    const srcs = it?.sources;
    if (!Array.isArray(srcs) || srcs.length < 1 || srcs.length > 4) {
      bad('factorRatings', i, 'sources must be 1-4 https URLs actually read');
    } else {
      srcs.forEach((u, j) => checkUrl('factorRatings', i, u, `sources[${j}]`));
      // "Published criticism" means at least one source that is not the
      // pizzeria's own site, a review aggregator, social or an ordering page.
      const own = [r.url, r.locationsSource, r.instagram].filter(Boolean).map(hostOf);
      if (!srcs.some(u => !isNonCriticism(u, own))) {
        bad('factorRatings', i, `no source is published criticism (${srcs.map(hostOf).join(', ')}); a rating needs a review, a roundup or a news story`);
      }
    }
    checkText('factorRatings', i, it?.note, 'note', MAX_LEN.note, 20);
  });

  /* ---- ratingSkipped: the rating and rerate tasks' memory ----
   * An entry the agent looked for coverage on and could not ground. Recorded
   * so the worklist stops redrawing the same no-coverage entries. Accepted
   * for the entries a proposal is accepted for: an unrated one, or one whose
   * launch rating the rerate task could not replace. */
  sections.ratingSkipped.forEach((it, i) => {
    const r = byId.get(it?.id);
    if (!r) { bad('ratingSkipped', i, `unknown restaurant id "${it?.id}"`); return; }
    if (agentRated(r)) bad('ratingSkipped', i, `${r.name} is already rated`);
    if (ratingSeen.has(it.id)) bad('ratingSkipped', i, `${r.name} is also proposed in factorRatings`);
    checkSkipNote('ratingSkipped', i, it);
  });

  /* ---- facts: the descriptive record, for any entry that lacks part of it ----
   * The year a place opened, its price tier, its style, its style group and
   * the pie it is known for. Fill-gaps-only at apply time. A record carries
   * what one page states, with that page as its source, so an entry may have
   * several records in a file as long as no fact is reported twice.
   *
   * The year and the tier are plain facts and any https page may state them.
   * Style, style group and signature are descriptions, and they are taken
   * from someone with a view of the pizza: the pizzeria's own site or menu,
   * or published coverage. An aggregator's category tags and "popular
   * dishes" are compiled from orders and reviews, by nobody who made the
   * pizza or reviewed it. The one exception is a page of the entry's own
   * web presence on such a host (isOwnPage). */
  const DESCRIBED = ['style', 'styleGroup', 'signature'];
  const factsReported = new Map();
  sections.facts.forEach((it, i) => {
    const r = byId.get(it?.id);
    if (!r) { bad('facts', i, `unknown restaurant id "${it?.id}"`); return; }
    const carried = FACT_FIELDS.filter(k => it?.[k] != null);
    if (!carried.length) bad('facts', i, `must carry at least one of ${FACT_FIELDS.join(', ')}`);
    const reported = factsReported.get(it.id) ?? new Set();
    const again = carried.filter(k => reported.has(k));
    if (again.length) bad('facts', i, `${again.join(', ')} already reported for "${it.id}" by an earlier facts record`);
    if (it?.opened != null && (typeof it.opened !== 'number' || it.opened < 1900 || it.opened > thisYear)) {
      bad('facts', i, `opened must be a year 1900-${thisYear}, got ${it.opened}`);
    }
    if (it?.priceIndex != null && ![1, 2, 3, 4].includes(it.priceIndex)) {
      bad('facts', i, `priceIndex must be 1-4, got ${it.priceIndex}`);
    }
    if (it?.style != null) checkText('facts', i, it.style, 'style', MAX_LEN.style, 2);
    if (it?.styleGroup != null) checkStyleGroup('facts', i, it.styleGroup);
    if (it?.signature != null) checkText('facts', i, it.signature, 'signature', MAX_LEN.signature, 3);
    checkUrl('facts', i, it?.source, 'source');
    const described = carried.filter(k => DESCRIBED.includes(k));
    if (described.length && isNonCriticism(it?.source) && !isOwnPage(it?.source, r)) {
      bad('facts', i, `${described.join(', ')} must come from the pizzeria's own site or menu, or from published coverage, not ${hostOf(it?.source) || 'that source'}`);
    }
    if (badIdx.facts?.has(i)) return;
    for (const k of carried) reported.add(k);
    factsReported.set(it.id, reported);
  });

  /* ---- factsSkipped: the facts task's memory ----
   * An entry the agent searched and could not complete. Without this the
   * worklist redrew the same twelve every run: the second dispatch filled one
   * entry of twelve. It may sit beside a facts record for the same entry: a
   * pass that finds the year and not the signature reports both, and the
   * apply step rests the entry for what is still missing. */
  sections.factsSkipped.forEach((it, i) => {
    const r = byId.get(it?.id);
    if (!r) { bad('factsSkipped', i, `unknown restaurant id "${it?.id}"`); return; }
    checkSkipNote('factsSkipped', i, it);
  });

  /* ---- locationsSkipped: the locations task's memory ----
   * A worklist entry the agent could not verify: no official page, or a page
   * with no address on it. Recorded so the worklist rests the entry instead
   * of redrawing it on every pass, which is how the task came to verify
   * nothing while the same few unverifiable entries held the head of the list. */
  sections.locationsSkipped.forEach((it, i) => {
    if (!byId.has(it?.id)) { bad('locationsSkipped', i, `unknown restaurant id "${it?.id}"`); return; }
    checkSkipNote('locationsSkipped', i, it);
  });

  /* ---- coverageSkipped, socialSkipped: the two backfills' memory ----
   * A worklist entry the coverage task found no new press for, or the social
   * task found no profile or site for. Both worklists are drawn by what is
   * missing, so without a record of the attempt the entries nothing can be
   * found for are the ones every later pass is handed again. */
  for (const sec of ['coverageSkipped', 'socialSkipped']) {
    sections[sec].forEach((it, i) => {
      if (!byId.has(it?.id)) { bad(sec, i, `unknown restaurant id "${it?.id}"`); return; }
      checkSkipNote(sec, i, it);
    });
  }

  /* ---- factorSources: citations for a rating that already exists ----
   * A launch rating was typed in with no source on file. This channel
   * attaches published criticism to a rating without touching its values:
   * the apply step appends to every graded factor's sources and writes
   * nothing else. It leaves a launch rating a launch rating; replacing one
   * is the rerate task's job, through factorRatings. Only already-rated
   * entries qualify, and the same criticism rule as factorRatings applies
   * (own site, aggregators and social may ride along but never stand
   * alone). */
  const sourcesSeen = new Set();
  sections.factorSources.forEach((it, i) => {
    const r = byId.get(it?.id);
    if (!r) { bad('factorSources', i, `unknown restaurant id "${it?.id}"`); return; }
    if (sourcesSeen.has(it.id)) { bad('factorSources', i, `duplicate factorSources record for "${it.id}"`); return; }
    sourcesSeen.add(it.id);
    if (!isRated(r)) { bad('factorSources', i, `${r.name} is not rated; sources attach to an existing rating (propose one through factorRatings)`); return; }
    if (ratingSeen.has(it.id)) { bad('factorSources', i, `${r.name} is also proposed in factorRatings`); return; }
    const srcs = it?.sources;
    if (!Array.isArray(srcs) || srcs.length < 1 || srcs.length > 4) {
      bad('factorSources', i, 'sources must be 1-4 https URLs actually read');
    } else {
      srcs.forEach((u, j) => checkUrl('factorSources', i, u, `sources[${j}]`));
      const own = [r.url, r.locationsSource, r.instagram].filter(Boolean).map(hostOf);
      if (!srcs.some(u => !isNonCriticism(u, own))) {
        bad('factorSources', i, `no source is published criticism (${srcs.map(hostOf).join(', ')}); cite a review, a roundup or a news story`);
      }
    }
    checkText('factorSources', i, it?.note, 'note', MAX_LEN.note, 20);
  });

  /* ---- links: an entry's canonical web presence ----
   * One record per entry, each field a URL the agent actually saw linked or
   * stated -- never a guessed handle or domain (a lapsed pizzeria domain now
   * serves a gambling site; the same trap exists for handles). */
  const IG_PROFILE = /^https:\/\/(www\.)?instagram\.com\/[A-Za-z0-9._]{2,30}\/?$/;
  const linkSeen = new Set();
  sections.links.forEach((it, i) => {
    if (!byId.has(it?.id)) bad('links', i, `unknown restaurant id "${it?.id}"`);
    if (linkSeen.has(it?.id)) bad('links', i, `duplicate links record for "${it?.id}"`);
    linkSeen.add(it?.id);
    if (it?.website == null && it?.instagram == null) {
      bad('links', i, 'must carry website or instagram (or both)');
    }
    if (it?.website != null) checkUrl('links', i, it.website, 'website');
    if (it?.instagram != null && !IG_PROFILE.test(String(it.instagram))) {
      bad('links', i, `instagram must be a profile URL like https://www.instagram.com/<handle>, got "${it.instagram}"`);
    }
    checkUrl('links', i, it?.source, 'source');
  });

  /* ---- candidateReview: census verdicts on registry-seeded candidates ----
   * Promotions go through `directory` like any discovery; this section only
   * records why a candidate does NOT join, so the queue drains instead of the
   * same ghosts monopolising every census worklist. When the candidates queue
   * is provided (extra.candidates), names must match a pending candidate.
   *
   * A duplicate names the entry it duplicates. The apply step stores that id
   * on the candidate, which is how a branch the register knows and the entry
   * lacks reaches the locations worklist; a verdict with no id would resolve
   * the candidate and lose its address. */
  const VERDICTS = new Set(['closed', 'chain', 'not-pizza', 'duplicate', 'unverifiable']);
  const pendingNames = extra.candidates
    ? new Set(extra.candidates.filter(c => c.status === 'pending')
        .map(c => c.name.toLowerCase().trim()))
    : null;
  const reviewSeen = new Set();
  sections.candidateReview.forEach((it, i) => {
    const name = String(it?.name ?? '').toLowerCase().trim();
    if (name.length < 2) bad('candidateReview', i, 'name missing');
    else if (pendingNames && !pendingNames.has(name)) {
      bad('candidateReview', i, `"${it.name}" is not a pending candidate (use the exact worklist name)`);
    }
    if (reviewSeen.has(name)) bad('candidateReview', i, `duplicate verdict for "${it?.name}"`);
    reviewSeen.add(name);
    if (!VERDICTS.has(it?.verdict)) {
      bad('candidateReview', i, `verdict must be one of ${[...VERDICTS].join('|')}, got "${it?.verdict}"`);
    }
    if (it?.verdict === 'duplicate') {
      if (!byId.has(it?.duplicateOf)) {
        bad('candidateReview', i, it?.duplicateOf == null
          ? 'a duplicate verdict needs duplicateOf, the id of the entry on file it duplicates'
          : `duplicateOf is not the id of an entry on file: "${it.duplicateOf}"`);
      }
    } else if (it?.duplicateOf != null) {
      bad('candidateReview', i, `duplicateOf belongs to a duplicate verdict only, not "${it?.verdict}"`);
    }
    checkText('candidateReview', i, it?.note, 'note', MAX_LEN.note, 10);
    /* source is optional here and a verdict publishes nothing to the site --
     * it only marks a candidate resolved -- so a non-https source is dropped
     * at apply time rather than costing the whole run (run #62 lost ten
     * verified candidates to one http:// directions page). */
    if (it?.source != null) {
      let plain = typeof it.source === 'string' && it.source.length <= MAX_LEN.url;
      try { new URL(it.source); } catch { plain = false; }
      if (!plain) bad('candidateReview', i, `source is not a valid URL: ${it.source}`);
    }
  });

  /* ---- the `…Skipped` sections: one record an entry, and no more than the cap ----
   * Run after each section's own checks, so a record that failed them neither
   * stands in for a good one with the same id nor counts towards the cap. */
  for (const sec of Object.keys(SKIPPED)) {
    const kept = new Set();
    sections[sec].forEach((it, i) => {
      if (badIdx[sec]?.has(i)) return;
      if (kept.has(it.id)) bad(sec, i, `"${it.id}" is already reported in this section; the first record is kept`);
      else if (kept.size >= CAPS[sec]) bad(sec, i, `past the ${CAPS[sec]} records this section holds; "${it.id}" is not recorded as attempted`);
      else kept.add(it.id);
    });
  }

  const accepted = Object.fromEntries(Object.entries(sections).map(([k, arr]) =>
    [k, arr.filter((_, i) => !badIdx[k]?.has(i))]));
  return { fails, sections, fatal: false, accepted, unknown };
}
