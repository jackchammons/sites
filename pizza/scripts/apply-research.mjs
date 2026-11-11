#!/usr/bin/env node
/*
 * Applies validated research to data/restaurants.json.
 *
 * Run only after verify-research.mjs passes. It applies status changes,
 * verified locations, discovered directory entries, mention records, links,
 * plain facts, proposed factor ratings and the attempt stamps that rest a
 * worklist entry. Crowd figures are frozen -- their sources block automated
 * reads and no API key path is in use -- so no script writes them. The graded
 * factors are written from a validated factorRatings proposal and from
 * nothing else: once for an unrated entry, and once more to replace a launch
 * rating (isLaunchRating in slice.js). A rating the agent set is never
 * overwritten. The attribute registry (data/attributes.json) is maintained by
 * hand: a flag moves a score, and nothing here writes one.
 *
 * applyResearch() is the whole of the logic and touches no file or clock, so
 * the tests drive it directly; the CLI block at the end reads the data files,
 * calls it once and writes back whichever of them changed.
 *
 * Locations are replaced on every verification where a rating is not: a
 * pizzeria publishes its own addresses on a page that serves to anyone, so they
 * are checkable in a way a crowd figure behind a 403 or a graded judgement is
 * not.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { matchEntry } from '../src/census.js';
import { normUrl, normTitle } from '../src/match.js';
import { isRated, isLaunchRating } from '../src/slice.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/* Applies every section of a validated research file. `data` holds the parsed
 * files -- dataset (restaurants.json), and where they exist buzz (buzz.json)
 * and candFile (candidates.json) -- and is changed in place. `today` is
 * YYYY-MM-DD and is the only date this stamps. Returns the counts for the
 * summary line and which of the side files changed. */
export function applyResearch(research, data, today, log = () => {}) {
  const { dataset, buzz = null, candFile = null } = data;
  const byId = new Map(dataset.restaurants.map(r => [r.id, r]));
  let changes = 0;
  let buzzChanged = false, candidatesChanged = false;
  // The one kind of rating no proposal may touch: all three graded factors on
  // file, every one of them set by the agent.
  const agentRated = r => isRated(r) && !isLaunchRating(r);

  /* status: liveness confirmations. A confirmation with no change still
   * advances statusChecked, which is what rotates the audit worklist.
   *
   * Two dates, kept apart on purpose: statusDate is when the status took
   * effect, as the source reports it, and stays null when the source does not
   * say; statusDetected is the day the pass recorded the change. Writing the
   * detection day into statusDate published a March 2024 closure as a 2026
   * one and listed it under "recently closed". */
  for (const it of research.status ?? []) {
    const r = byId.get(it.id);
    if (!r) continue;
    const changed = r.status !== it.status;
    // A confirmation can bring the date the first report lacked: a closure
    // recorded with no date is re-checked once, and the source read then often
    // states the day. It is taken only where none is on file, and only if it
    // does not postdate the day the status was first recorded.
    const dated = !changed && r.statusDate == null && it.date != null
      && (r.statusDetected == null || Date.parse(it.date) <= Date.parse(r.statusDetected) + 864e5);
    if (changed) {
      r.statusPrev = r.status;
      r.status = it.status;
      r.statusNote = it.note;
      r.statusSource = it.source;
      r.statusDate = it.date ?? null;
      r.statusDetected = today;
    } else if (dated) {
      r.statusDate = it.date;
      r.statusNote = it.note;
      r.statusSource = it.source;
    }
    r.statusChecked = today;
    changes++;
    log(`  ${changed ? '!' : '='} ${r.name}: ${it.status}${changed ? '' : dated ? ` (confirmed, dated ${it.date})` : ' (confirmed)'}`);
  }

  /* directory: discovered pizzerias join the dataset unrated. */
  const slug = s => s.toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  for (const it of research.directory ?? []) {
    const id = slug(it.name);
    // The validator dedups on a normalised name, which is looser than the id in
    // some ways and stricter in others; a record that still lands on an id in
    // use is dropped here, and says so.
    if (byId.has(id)) {
      log(`  ? ${it.name}: not added, the id "${id}" is already ${byId.get(id).name}`);
      continue;
    }
    const entry = {
      id,
      name: it.name,
      neighborhood: it.neighborhood,
      style: it.style ?? null,
      blurb: it.note,
      url: it.url ?? null,
      status: it.status,
      statusSource: it.source,
      statusDate: null,
      statusDetected: today,
      statusChecked: today,
      attributes: {},
      locations: it.address ? [{ neighborhood: it.neighborhood, address: it.address }] : [],
      locationsVerified: null,
      locationsSource: null,
      mentions: []
    };
    dataset.restaurants.push(entry);
    byId.set(id, entry);
    changes++;
    log(`  + ${it.name} (${id}): ${it.status}, ${it.neighborhood}`);
  }

  /* mentions: coverage history feeding reputation and critical reception.
   * Dedup on a normalised URL (scheme, www, trailing slash, tracking params
   * stripped) OR a normalised title: the news pass re-files the same roundup
   * under a Google News redirect and the publisher's URL. */
  for (const it of research.mentions ?? []) {
    const r = byId.get(it.id);
    if (!r) continue;
    r.mentions = r.mentions ?? [];
    if (r.mentions.some(m => normUrl(m.url) === normUrl(it.url) || normTitle(m.title) === normTitle(it.title))) continue;
    r.mentions.push({ url: it.url, title: it.title, source: it.source, date: String(it.date).slice(0, 10), kind: it.kind });
    r.mentions = r.mentions.slice(-50);
    changes++;
    log(`  ~ ${r.name}: mention from ${it.source}`);
  }

  /* factorRatings: the proposal that makes an unrated entry rankable, or
   * replaces a launch rating. A rating the agent set is never overwritten.
   * Provenance goes on every factor and lastVerified is set to today, since
   * the entry was just researched.
   *
   * A launch rating is replaced whole: each graded factor becomes a new
   * object, so no value, source or date from the hand-typed rating survives
   * beside the agent's. The plain facts that ride along (opened, priceIndex,
   * styleGroup) fill gaps only in both cases. */
  let ratedNow = 0, reratedNow = 0;
  for (const it of research.factorRatings ?? []) {
    const r = byId.get(it.id);
    if (!r) continue;
    if (agentRated(r)) continue;
    const launch = isLaunchRating(r);
    const was = launch ? ['craft', 'distinctiveness', 'critical'].map(k => r.factors[k].value) : null;
    const src = (it.sources ?? [])[0];
    const sources = (it.sources ?? []).slice(0, 4);
    r.factors = r.factors ?? {};
    for (const k of ['craft', 'distinctiveness']) {
      if (launch || !r.factors[k]) r.factors[k] = { value: it[k], setBy: 'agent', source: src, sources, note: it.note, date: today };
    }
    // The proposal schema says criticScore; it lands as factors.critical so all
    // three graded factors share one shape and one provenance rule.
    r.factors.critical = { value: it.criticScore, setBy: 'agent', source: src, sources, note: it.note, date: today };
    r.ratingAttempted = today;
    if (it.opened != null && r.opened == null) r.opened = it.opened;
    if (it.priceIndex != null && r.priceIndex == null) r.priceIndex = it.priceIndex;
    if (it.styleGroup && !r.styleGroup) r.styleGroup = it.styleGroup.trim();
    r.lastVerified = today;
    if (launch) reratedNow++; else ratedNow++;
    changes++;
    log(launch
      ? `  # ${r.name}: re-rated — craft ${was[0]} -> ${it.craft}, distinctiveness ${was[1]} -> ${it.distinctiveness}, critic ${was[2]} -> ${it.criticScore} (${src})`
      : `  # ${r.name}: rated — craft ${it.craft}, distinctiveness ${it.distinctiveness}, critic ${it.criticScore} (${src})`);
  }

  /* ratingSkipped: the rating task tried and found no coverage. Recorded so the
   * worklist moves on; the entry is retried after a quarter. For a launch
   * rating the rerate task could not replace, the rating stays as it is: the
   * stamp rests the entry, and the note is what a person reviewing it reads. */
  for (const it of research.ratingSkipped ?? []) {
    const r = byId.get(it.id);
    if (!r || agentRated(r)) continue;
    r.ratingAttempted = today;
    r.ratingNote = it.note;
    changes++;
    log(isLaunchRating(r)
      ? `  . ${r.name}: not re-rated, launch rating kept — ${it.note}`
      : `  . ${r.name}: no coverage found — ${it.note}`);
  }

  /* facts: founding year and price tier, fill-gaps-only. The two plain facts
   * reputation and value read, which an entry could otherwise never acquire
   * once rated (the rating apply was their only writer). */
  for (const it of research.facts ?? []) {
    const r = byId.get(it.id);
    if (!r) continue;
    const did = [];
    if (it.opened != null && r.opened == null) { r.opened = it.opened; r.openedSource = it.source; did.push(`opened ${it.opened}`); }
    if (it.priceIndex != null && r.priceIndex == null) { r.priceIndex = it.priceIndex; r.priceSource = it.source; did.push(`price ${'$'.repeat(it.priceIndex)}`); }
    if (did.length) {
      changes++;
      log(`  = ${r.name}: ${did.join(', ')} (${it.source})`);
    }
  }

  /* factsSkipped: the facts task looked and found no page stating the year or
   * the tier. Recorded so the worklist moves on; retried after a quarter. */
  for (const it of research.factsSkipped ?? []) {
    const r = byId.get(it.id);
    if (!r) continue;
    r.factsAttempted = today;
    r.factsNote = it.note;
    changes++;
    log(`  . ${r.name}: no stated facts found — ${it.note}`);
  }
  /* Any facts record counts as an attempt too, so a partial fill (year found,
   * tier not) does not keep the entry at the front of the worklist. */
  for (const it of research.facts ?? []) {
    const r = byId.get(it.id);
    if (r) r.factsAttempted = today;
  }

  /* factorSources: citations attached to a rating that already exists, values
   * untouched. Written for launch ratings, which were typed in with nothing
   * on file; the directory then shows the coverage beside the number until
   * the rerate task replaces the rating itself. Appends to every graded
   * factor's sources, deduplicated by URL; the freshness clock is not reset,
   * since nothing about the place was verified. */
  for (const it of research.factorSources ?? []) {
    const r = byId.get(it.id);
    if (!r || !isRated(r)) continue;
    let added = 0;
    for (const k of ['craft', 'distinctiveness', 'critical']) {
      const f = r.factors[k];
      const have = new Set((f.sources ?? (f.source ? [f.source] : [])).map(normUrl));
      const fresh = (it.sources ?? []).filter(u => !have.has(normUrl(u)));
      if (!fresh.length) continue;
      f.sources = [...(f.sources ?? (f.source ? [f.source] : [])), ...fresh].slice(0, 8);
      if (!f.source) f.source = f.sources[0];
      f.sourcedDate = today;
      if (it.note && !f.note) f.note = it.note;
      added += fresh.length;
    }
    if (added) {
      changes++;
      log(`  + ${r.name}: ${added} source(s) attached to its rating (${it.sources[0]})`);
    }
  }

  /* news: stories the agent found that the feed sweep missed. Folded into
   * buzz.json so they survive the next pass overwriting research.json; the
   * sweep's own merge keeps them for its 120-day window and dedups on title. */
  if ((research.news ?? []).length && buzz) {
    const known = new Set(buzz.items.flatMap(b => [normUrl(b.url), normTitle(b.title)]));
    let added = 0;
    for (const it of research.news) {
      if (known.has(normUrl(it.url)) || known.has(normTitle(it.title))) continue;
      buzz.items.push({ title: it.title, url: it.url, source: it.source,
        published: new Date(it.published).toISOString(), kind: it.kind,
        mentions: it.mentions ?? [], via: 'research' });
      known.add(normUrl(it.url)); known.add(normTitle(it.title));
      added++;
    }
    if (added) {
      buzz.items.sort((a, b) => Date.parse(b.published) - Date.parse(a.published));
      buzzChanged = true;
      changes += added;
      log(`  + ${added} researched stor${added === 1 ? 'y' : 'ies'} folded into buzz.json`);
    }
  }

  /* links: an entry's canonical web presence. Instagram is a pointer, not a
   * judgment, so a fresher one replaces the stored one. website fills in only
   * when the entry has no url at all -- the locations pass owns correcting an
   * existing official site, and for a place with no site of its own this is
   * where the best available link (often the Instagram itself) lands. */
  for (const it of research.links ?? []) {
    const r = byId.get(it.id);
    if (!r) continue;
    const did = [];
    if (it.instagram && r.instagram !== it.instagram) { r.instagram = it.instagram; did.push('instagram'); }
    if (it.website && !r.url) { r.url = it.website; did.push('website'); }
    if (did.length) {
      changes++;
      log(`  & ${r.name}: ${did.join(' + ')}`);
    }
  }

  /* Locations replace whatever was stored rather than merging: the agent reads the
   * pizzeria's own locations page, so what it returns is the current set, and a
   * merge would keep a branch that has since closed. neighborhood is left alone as
   * the editorial fallback, but a placeholder like "Citywide" stops being used for
   * display the moment a real set of sites lands. */
  let located = 0;
  for (const it of research.locations ?? []) {
    const r = byId.get(it.id);
    if (!r) continue;
    // Carry geocoded coordinates over for any address that has not changed;
    // re-verifying an unchanged branch must not throw away its lat/lon.
    const coordKey = a => a.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    const oldCoords = new Map((r.locations ?? [])
      .filter(l => l.lat != null)
      .map(l => [coordKey(l.address), { lat: l.lat, lon: l.lon }]));
    const sites = it.sites.map(s => ({
      neighborhood: s.neighborhood.trim(),
      address: s.address.trim(),
      ...(oldCoords.get(coordKey(s.address)) ?? {})
    }));
    const before = JSON.stringify(r.locations ?? []);
    r.locations = sites;
    // Always the day of this pass. The record cannot say when it was verified:
    // a date supplied there would set the freshness clock and the worklist
    // order to whatever the agent wrote.
    r.locationsVerified = today;
    r.locationsSource = it.source;
    delete r.neighborhoodIsPlaceholder;

    /* Every entry on the page should be a link, and verifying locations already
     * required finding the official site -- so the link comes free. A homepage
     * the agent actually read replaces whatever is stored: three ranked entries
     * linked a 404 or a dead domain while the working site sat in
     * locationsSource. With no homepage reported, the origin of the locations
     * page fills an empty url only (a hand-set deep link is a deliberate choice). */
    if (it.homepage && it.homepage !== r.url) {
      log(`    url: ${r.url ?? '(none)'} -> ${it.homepage}`);
      r.url = it.homepage;
    } else if (!r.url) {
      try { r.url = new URL(it.source).origin; }
      catch { /* validated upstream; a bad URL here just means no link */ }
    }
    located++;
    const changed = before !== JSON.stringify(sites);
    log(`  @ ${r.name}: ${sites.length} location(s)${changed ? '' : ' (unchanged)'} — ${sites.map(s => s.neighborhood).join(', ')}`);
  }

  /* locationsSkipped: the locations task looked and could not verify the entry
   * (no official page, or no address on it). Recorded so the worklist rests it
   * for a month instead of redrawing it on every pass. */
  for (const it of research.locationsSkipped ?? []) {
    const r = byId.get(it.id);
    if (!r) continue;
    r.locationsAttempted = today;
    r.locationsNote = it.note;
    changes++;
    log(`  . ${r.name}: locations not verified — ${it.note}`);
  }

  /* coverageSkipped, socialSkipped: the coverage and social backfills looked
   * and found nothing to file for the entry. Recorded so each worklist rests
   * it for a quarter instead of handing it to every later pass. */
  for (const [section, stamp, noteKey, what] of [
    ['coverageSkipped', 'coverageAttempted', 'coverageNote', 'no new coverage found'],
    ['socialSkipped', 'socialAttempted', 'socialNote', 'web presence not found']]) {
    for (const it of research[section] ?? []) {
      const r = byId.get(it.id);
      if (!r) continue;
      r[stamp] = today;
      r[noteKey] = it.note;
      changes++;
      log(`  . ${r.name}: ${what} — ${it.note}`);
    }
  }

  /* candidateReview: census verdicts drain the registry queue. Promotions need
   * no record of their own -- any candidate whose name now matches a dataset
   * entry (usually one the same run just added through `directory`) is marked
   * promoted here, and verdicts mark the rest so they stop re-entering census
   * worklists. */
  if (candFile) {
    let candChanges = 0;
    for (const it of research.candidateReview ?? []) {
      // Same-name candidates are branches of one business (permits are
      // per-location); one verdict resolves them all.
      const matches = candFile.candidates.filter(x =>
        x.status === 'pending' && x.name.toLowerCase().trim() === String(it.name).toLowerCase().trim());
      if (!matches.length) { log(`  ? candidateReview names no pending candidate: "${it.name}"`); continue; }
      for (const c of matches) {
        c.status = it.verdict === 'chain' ? 'chain' : 'rejected';
        c.verdict = it.verdict;
        c.note = it.note;
        if (it.source && /^https:/i.test(it.source)) c.resolutionSource = it.source;
        c.resolvedDate = today;
        candChanges++;
      }
      log(`  - candidate "${it.name}": ${it.verdict} (${matches.length} location(s))`);
    }
    for (const c of candFile.candidates) {
      if (c.status !== 'pending') continue;
      const matched = matchEntry(c, dataset.restaurants);
      if (matched) {
        c.status = 'promoted';
        c.matchedId = matched.id;
        c.resolvedDate = today;
        candChanges++;
        log(`  ^ candidate "${c.name}" promoted -> ${matched.id}`);
      }
    }
    if (candChanges) {
      candidatesChanged = true;
      changes += candChanges;
    }
  }

  if (changes || located) dataset.dataVersion = today.slice(0, 7).replace('-', '.');
  return { changes, located, ratedNow, reratedNow, buzzChanged, candidatesChanged };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1])) {
  const file = name => path.join(root, 'data', name);
  const read = name => fs.existsSync(file(name)) ? JSON.parse(fs.readFileSync(file(name), 'utf8')) : null;
  const write = (name, value) => fs.writeFileSync(file(name), JSON.stringify(value, null, 2) + '\n');

  const research = read('research.json');
  if (!research) {
    console.log('No research.json — nothing to apply.');
    process.exit(0);
  }

  const data = { dataset: read('restaurants.json'), buzz: read('buzz.json'),
                 candFile: read('candidates.json') };
  const today = new Date().toISOString().slice(0, 10);
  const done = applyResearch(research, data, today, console.log);

  if (done.buzzChanged) write('buzz.json', data.buzz);
  if (done.candidatesChanged) write('candidates.json', data.candFile);
  if (done.changes || done.located) {
    const out = JSON.stringify(data.dataset, null, 2) + '\n';
    if (fs.readFileSync(file('restaurants.json'), 'utf8') !== out) fs.writeFileSync(file('restaurants.json'), out);
  }

  console.log(`\napplied: ${done.changes} change(s), ${done.located} location set(s) verified. ${done.ratedNow} newly rated, ${done.reratedNow} re-rated.`);
}
