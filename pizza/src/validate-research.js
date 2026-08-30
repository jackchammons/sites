/*
 * The research-file gate, as a pure function: everything the agent writes is
 * checked here before anything downstream may use it. No file or clock access,
 * so the whole rule set is unit-testable -- the CLI wrapper in
 * scripts/verify-research.mjs does the I/O.
 *
 * Returns { fails, sections }: an empty fails array means the document passed.
 */

export const KINDS = new Set(['opening', 'closing', 'ranking', 'mention']);
export const CAPS = { news: 20, locations: 12, directory: 10, status: 10,
                      mentions: 30, newAttributes: 3, factorRatings: 12, links: 20 };
export const MAX_AGE_DAYS = 180;

export function validateResearch(doc, dataset, registry = {}, nowMs = Date.now()) {
  const fails = [];
  const bad = (sec, i, msg) => fails.push(`${sec}[${i}]: ${msg}`);
  const byId = new Map(dataset.restaurants.map(r => [r.id, r]));

  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
    return { fails: ['research.json must be a JSON object.'], sections: {} };
  }

  /* `items` was the original field name; keep reading it so older files still work. */
  const news = doc.news ?? doc.items ?? [];
  const sections = { news,
                     locations: doc.locations ?? [], directory: doc.directory ?? [],
                     status: doc.status ?? [], mentions: doc.mentions ?? [],
                     newAttributes: doc.newAttributes ?? [],
                     factorRatings: doc.factorRatings ?? [],
                     links: doc.links ?? [] };
  if (Array.isArray(doc.ratings) && doc.ratings.length) {
    fails.push('ratings are no longer accepted: crowd figures are frozen, see CLAUDE.md');
  }
  /* Retired sections fail loudly rather than being dropped: a claim routed
   * through an old channel must be re-expressed through the live one, not
   * silently lost. */
  const RETIRED = { candidates: 'use "directory"', closures: 'use "status"', factors: 'use "factorRatings"' };
  for (const [k, hint] of Object.entries(RETIRED)) {
    if (Array.isArray(doc[k]) && doc[k].length) fails.push(`"${k}" is retired — ${hint}`);
  }

  for (const [name, arr] of Object.entries(sections)) {
    if (!Array.isArray(arr)) { fails.push(`${name} must be an array`); continue; }
    if (arr.length > CAPS[name]) fails.push(`${name}: ${arr.length} entries exceeds the ${CAPS[name]} cap`);
  }
  if (fails.length) return { fails, sections };

  /* A claim we cannot check is not usable, so every section needs a live https source. */
  const checkUrl = (sec, i, url, field = 'url') => {
    let u;
    try { u = new URL(url); } catch { bad(sec, i, `${field} is not a valid URL: ${url}`); return; }
    if (u.protocol !== 'https:') bad(sec, i, `${field} must be https: ${url}`);
  };
  const checkDate = (sec, i, v, field) => {
    const t = Date.parse(v);
    if (!Number.isFinite(t)) { bad(sec, i, `${field} is not a parseable date: ${v}`); return; }
    if (t > nowMs + 864e5) bad(sec, i, `${field} is in the future: ${v}`);
    else if (t < nowMs - MAX_AGE_DAYS * 864e5) bad(sec, i, `${field} is older than ${MAX_AGE_DAYS} days`);
  };

  const seen = new Set();
  news.forEach((it, i) => {
    if (typeof it?.title !== 'string' || it.title.trim().length < 8) bad('news', i, 'title missing or too short');
    if (typeof it?.source !== 'string' || !it.source.trim()) bad('news', i, 'source missing');
    checkUrl('news', i, it?.url);
    checkDate('news', i, it?.published, 'published');
    if (!KINDS.has(it?.kind)) bad('news', i, `kind must be one of ${[...KINDS].join('|')}, got "${it?.kind}"`);
    for (const m of it?.mentions ?? []) if (!byId.has(m)) bad('news', i, `mentions unknown id "${m}"`);
    const key = String(it?.url || it?.title).toLowerCase();
    if (seen.has(key)) bad('news', i, 'duplicate of an earlier item');
    seen.add(key);
  });

  /* ---- locations ----
   * Addresses are the one factual field an agent may write into the dataset,
   * because the business publishes them itself on a page that serves to anyone.
   * That makes them checkable, which crowd ratings (403) and pillar scores
   * (editorial) are not. These checks exist to catch a plausible invention: a
   * street address that is not one, a branch in another metro, the same branch
   * listed twice.
   */
  /* Region check by ZIP, not by city name. The first version listed cities and
   * rejected a real Zeeks branch in Mill Creek on its first live run -- a chain
   * opens somewhere the list has never heard of and the gate calls the truth a
   * lie. ZIP prefixes are objective and need no maintenance as the field changes:
   *
   *   980xx  King and Snohomish suburbs (Bellevue, Kent, Mill Creek)
   *   981xx  Seattle proper
   *   982xx  Everett and north
   *   983xx  Kitsap and the Olympic Peninsula
   *   984xx  Pierce County (Tacoma)
   *   985xx  Thurston County (Olympia)
   *
   * That is wider than "Seattle metro" strictly means, and deliberately so: this
   * check exists to catch a fabricated address or an out-of-region outpost --
   * Spokane 992xx, Vancouver WA 986xx, Portland OR -- not to adjudicate which
   * suburbs count. A chain reporting its real Tacoma branch is telling the truth,
   * and a validator that calls that a lie is the more expensive failure. */
  const PUGET_SOUND_ZIP = /\b98[0-5]\d{2}\b/;

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
      if (typeof st?.neighborhood !== 'string' || !st.neighborhood.trim()) {
        bad('locations', i, `${where}: neighborhood missing`);
      }
      const addr = st?.address;
      if (typeof addr !== 'string' || !addr.trim()) {
        bad('locations', i, `${where}: address missing`);
        return;
      }
      // A street address starts with a number and names a street. This rejects
      // "Capitol Hill" or "Seattle, WA" dressed up as an address.
      if (!/^\s*\d/.test(addr)) bad('locations', i, `${where}: address does not start with a street number: "${addr}"`);
      if (!/\bWA\b|\bWashington\b/i.test(addr)) bad('locations', i, `${where}: address is not in Washington: "${addr}"`);
      if (!PUGET_SOUND_ZIP.test(addr)) bad('locations', i, `${where}: no Puget Sound ZIP (980xx-983xx): "${addr}"`);
      const key = addr.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
      if (seenSites.has(key)) bad('locations', i, `${where}: duplicate address "${addr}"`);
      seenSites.add(key);
    });
  });

  /* ---- directory: discovered pizzerias ----
   * The important failure to catch is a duplicate of something on file under a
   * slightly different name, which would fork one pizzeria into two entries. */
  const normName = n => String(n).toLowerCase()
    .replace(/['’]/g, '')
    .replace(/\b(pizza company|pizza co|pizzeria|pizza|restaurant)\b/g, '')
    .replace(/[^a-z0-9]+/g, ' ').trim();
  const knownNames = new Set(dataset.restaurants.map(r => normName(r.name)));

  sections.directory.forEach((it, i) => {
    if (typeof it?.name !== 'string' || it.name.trim().length < 2) { bad('directory', i, 'name missing'); return; }
    if (knownNames.has(normName(it.name))) bad('directory', i, `"${it.name}" is already on file`);
    if (!['open', 'opening'].includes(it?.status)) bad('directory', i, `status must be open|opening, got "${it?.status}"`);
    if (typeof it?.neighborhood !== 'string' || !it.neighborhood.trim()) bad('directory', i, 'neighborhood missing');
    if (typeof it?.note !== 'string' || it.note.trim().length < 15) bad('directory', i, 'note missing or too short');
    checkUrl('directory', i, it?.source, 'source');
    if (it?.url != null) checkUrl('directory', i, it.url, 'url');
    if (it?.address != null) {
      if (!/^\s*\d/.test(it.address)) bad('directory', i, `address does not start with a street number: "${it.address}"`);
      if (!/\b98[0-5]\d{2}\b/.test(it.address)) bad('directory', i, `no Puget Sound ZIP: "${it.address}"`);
    }
  });

  /* ---- status: liveness confirmations ---- */
  sections.status.forEach((it, i) => {
    if (!byId.has(it?.id)) bad('status', i, `unknown restaurant id "${it?.id}"`);
    if (!['open', 'closed', 'opening'].includes(it?.status)) bad('status', i, `status must be open|closed|opening, got "${it?.status}"`);
    if (typeof it?.note !== 'string' || it.note.trim().length < 10) bad('status', i, 'note missing or too short');
    checkUrl('status', i, it?.source, 'source');
    if (it?.date) checkDate('status', i, it.date, 'date');
  });

  /* ---- mentions: coverage tied to entries ---- */
  sections.mentions.forEach((it, i) => {
    if (!byId.has(it?.id)) bad('mentions', i, `unknown restaurant id "${it?.id}"`);
    if (typeof it?.title !== 'string' || it.title.trim().length < 8) bad('mentions', i, 'title missing');
    if (typeof it?.source !== 'string' || !it.source.trim()) bad('mentions', i, 'source name missing');
    checkUrl('mentions', i, it?.url);
    checkDate('mentions', i, it?.date, 'date');
    if (!KINDS.has(it?.kind)) bad('mentions', i, `kind must be one of ${[...KINDS].join('|')}, got "${it?.kind}"`);
  });

  /* Values bounded and stepped so a typo cannot smuggle in a 47. */
  const validFactorValue = v => typeof v === 'number' && v >= 0 && v <= 10 && Math.round(v * 2) === v * 2;
  /* factorRatings: the full proposal that makes an unrated entry rankable.
   * Stricter than `factors` because it grants entry to the ladder: values
   * bounded, an already-rated entry is refused outright, and every proposal
   * carries the sources it was read from. */
  const thisYear = new Date(nowMs).getUTCFullYear();
  const alreadyRated = r => Boolean(r.factors?.craft && r.factors?.distinctiveness
    && r.factors?.critical);

  const ratingSeen = new Set();
  sections.factorRatings.forEach((it, i) => {
    const r = byId.get(it?.id);
    if (!r) { bad('factorRatings', i, `unknown restaurant id "${it?.id}"`); return; }
    if (ratingSeen.has(it.id)) { bad('factorRatings', i, `duplicate proposal for "${it.id}"`); return; }
    ratingSeen.add(it.id);
    if (alreadyRated(r)) { bad('factorRatings', i, `${r.name} is already rated; ratings are never overwritten`); return; }
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
    if (it?.styleGroup != null && (typeof it.styleGroup !== 'string'
        || it.styleGroup.trim().length < 3 || it.styleGroup.trim().length > 24)) {
      bad('factorRatings', i, `styleGroup must be a short label, got "${it.styleGroup}"`);
    }
    const srcs = it?.sources;
    if (!Array.isArray(srcs) || srcs.length < 1 || srcs.length > 4) {
      bad('factorRatings', i, 'sources must be 1-4 https URLs actually read');
    } else {
      srcs.forEach((u, j) => checkUrl('factorRatings', i, u, `sources[${j}]`));
    }
    if (typeof it?.note !== 'string' || it.note.trim().length < 20) {
      bad('factorRatings', i, 'note missing or too short — say what the coverage describes');
    }
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

  /* ---- newAttributes: registry additions ---- */
  sections.newAttributes.forEach((it, i) => {
    if (!/^[a-z][a-z0-9-]{2,30}$/.test(it?.key ?? '')) bad('newAttributes', i, `key must be kebab-case, got "${it?.key}"`);
    else if (registry[it.key]) bad('newAttributes', i, `"${it.key}" already exists in the registry`);
    if (typeof it?.label !== 'string' || !it.label.trim()) bad('newAttributes', i, 'label missing');
    if (it?.frictionCost != null && !(typeof it.frictionCost === 'number' && it.frictionCost >= 0 && it.frictionCost <= 2.5)) {
      bad('newAttributes', i, `frictionCost must be 0-2.5, got ${it?.frictionCost}`);
    }
    if (!Array.isArray(it?.entries) || !it.entries.length) bad('newAttributes', i, 'entries[] must name at least one id the flag applies to');
    else for (const id of it.entries) if (!byId.has(id)) bad('newAttributes', i, `entries names unknown id "${id}"`);
  });


  return { fails, sections };
}
