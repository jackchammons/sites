/*
 * The shape of an entry in data/restaurants.json, stated once.
 *
 * Every entry carries every key below, in this order. A key with nothing to
 * say holds its empty value (null, [] or {}), so "not known" is written the
 * same way on every entry, and nobody reading the file or a diff of it has to
 * ask whether an absent key means empty or forgotten. apply-research.mjs
 * writes entries through normalizeEntry, and check-dataset.js refuses an
 * entry that lacks one of these keys or carries one this list does not name.
 *
 * `kind` says what a key is for:
 *   identity   which pizzeria this is
 *   fact       the descriptive record: what the place is and what it makes
 *   link       its web presence
 *   status     whether it is open, and the evidence for that
 *   location   where it is, and the page that was read from
 *   rating     the graded factors
 *   coverage   press tied to the entry
 *   stamp      bookkeeping: the day a pass looked, and what it noted
 *
 * `empty` is the value a key holds when there is nothing to record. Three
 * keys have none, because an entry cannot be without them: its id, its name
 * and its status.
 *
 * `by` names what writes the key. A name in quotes is a section of the
 * research file, applied by apply-research.mjs; nothing else writes an entry
 * except the geocoder (coordinates) and a person (attribute flags, and the
 * entries the index opened with).
 *
 * Plain data and pure functions, no Node or DOM dependency.
 */
export const ENTRY_SCHEMA = [
  { key: 'id', kind: 'identity', by: '"directory", as a slug of the name' },
  { key: 'name', kind: 'identity', by: '"directory"' },

  { key: 'neighborhood', kind: 'fact', empty: null, by: '"directory"' },
  { key: 'neighborhoodIsPlaceholder', kind: 'location', empty: null,
    by: 'a person, for a neighborhood such as "Citywide"; "locations" clears it' },
  { key: 'blurb', kind: 'fact', empty: null, by: '"directory", from its note' },
  { key: 'style', kind: 'fact', empty: null, by: '"directory", else "facts"' },
  { key: 'styleSource', kind: 'fact', empty: null, by: '"facts"' },
  { key: 'styleGroup', kind: 'fact', empty: null, by: '"factorRatings", else "facts"' },
  { key: 'styleGroupSource', kind: 'fact', empty: null, by: '"facts"' },
  { key: 'signature', kind: 'fact', empty: null, by: '"facts"' },
  { key: 'signatureSource', kind: 'fact', empty: null, by: '"facts"' },
  { key: 'opened', kind: 'fact', empty: null, by: '"factorRatings", else "facts"' },
  { key: 'openedSource', kind: 'fact', empty: null, by: '"facts"' },
  { key: 'priceIndex', kind: 'fact', empty: null, by: '"factorRatings", else "facts"' },
  { key: 'priceSource', kind: 'fact', empty: null, by: '"facts"' },
  { key: 'attributes', kind: 'fact', empty: {}, by: 'a person; the flags are in data/attributes.json' },

  { key: 'url', kind: 'link', empty: null, by: '"directory", "locations" (homepage), "links" (website)' },
  { key: 'instagram', kind: 'link', empty: null, by: '"links"' },

  { key: 'status', kind: 'status', by: '"directory", "status"' },
  { key: 'statusPrev', kind: 'status', empty: null, by: '"status", on a change' },
  { key: 'statusNote', kind: 'status', empty: null, by: '"status"' },
  { key: 'statusSource', kind: 'status', empty: null, by: '"directory", "status"' },
  { key: 'statusDate', kind: 'status', empty: null, by: '"status", only when the source states the day' },
  { key: 'statusDetected', kind: 'stamp', empty: null, by: '"directory", "status" on a change' },
  { key: 'statusChecked', kind: 'stamp', empty: null, by: '"directory", "status"' },

  { key: 'locations', kind: 'location', empty: [], by: '"directory" (one unverified address), "locations"' },
  { key: 'locationsVerified', kind: 'stamp', empty: null, by: '"locations"' },
  { key: 'locationsSource', kind: 'location', empty: null, by: '"locations"' },
  { key: 'locationsAttempted', kind: 'stamp', empty: null, by: '"locationsSkipped"' },
  { key: 'locationsNote', kind: 'stamp', empty: null, by: '"locationsSkipped"' },

  { key: 'factors', kind: 'rating', empty: {}, by: '"factorRatings"; "factorSources" adds citations' },
  { key: 'lastVerified', kind: 'stamp', empty: null, by: '"factorRatings"' },
  { key: 'ratingAttempted', kind: 'stamp', empty: null, by: '"factorRatings", "ratingSkipped"' },
  { key: 'ratingNote', kind: 'stamp', empty: null, by: '"ratingSkipped"' },

  { key: 'mentions', kind: 'coverage', empty: [], by: '"mentions"' },
  { key: 'coverageAttempted', kind: 'stamp', empty: null, by: '"coverageSkipped"' },
  { key: 'coverageNote', kind: 'stamp', empty: null, by: '"coverageSkipped"' },

  { key: 'factsAttempted', kind: 'stamp', empty: null, by: '"factsSkipped"' },
  { key: 'factsSought', kind: 'stamp', empty: [], by: '"factsSkipped": the facts that attempt looked for' },
  { key: 'factsNote', kind: 'stamp', empty: null, by: '"factsSkipped"' },
  { key: 'socialAttempted', kind: 'stamp', empty: null, by: '"socialSkipped"' },
  { key: 'socialNote', kind: 'stamp', empty: null, by: '"socialSkipped"' }
];

export const ENTRY_KEYS = ENTRY_SCHEMA.map(s => s.key);

/* The three objects an entry holds, key by key and in order. `optional` marks
 * a key that is absent until something has it to write: a location has no
 * coordinates until the geocoder finds them, and absence is what the geocoder
 * looks for. */
export const LOCATION_SHAPE = [
  { key: 'neighborhood', by: '"directory", "locations"' },
  { key: 'address', by: '"directory", "locations"' },
  { key: 'lat', optional: true, by: 'the geocoder, Seattle addresses only' },
  { key: 'lon', optional: true, by: 'the geocoder, Seattle addresses only' }
];
export const FACTOR_NAMES = ['craft', 'distinctiveness', 'critical'];
export const FACTOR_SHAPE = [
  { key: 'value', by: '"factorRatings"' },
  { key: 'setBy', by: '"factorRatings", always "agent"' },
  { key: 'source', by: '"factorRatings": the first of sources' },
  { key: 'sources', optional: true, by: '"factorRatings"; "factorSources" appends' },
  { key: 'note', optional: true, by: '"factorRatings"' },
  { key: 'date', by: '"factorRatings": the day of the pass' },
  { key: 'sourcedDate', optional: true, by: '"factorSources"' }
];
export const MENTION_SHAPE = [
  { key: 'url', by: '"mentions"' },
  { key: 'title', by: '"mentions"' },
  { key: 'source', by: '"mentions": the publication' },
  { key: 'date', by: '"mentions"' },
  { key: 'kind', by: '"mentions": opening, closing, ranking or mention' }
];

/* Keys the lint refuses outright because the dataset must not hold what they
 * held. Normalising drops them; any other key the schema does not name is
 * kept, after the schema's own, so the lint can name it and nothing a person
 * typed is thrown away unseen. */
export const REFUSED_KEYS = ['crowd'];

/* The descriptive record the facts task completes: each fact, and the key the
 * page that states it is stored under. */
export const FACT_SOURCE_KEY = {
  opened: 'openedSource',
  priceIndex: 'priceSource',
  style: 'styleSource',
  styleGroup: 'styleGroupSource',
  signature: 'signatureSource'
};
export const FACT_FIELDS = Object.keys(FACT_SOURCE_KEY);

/* The facts an entry lacks, in FACT_FIELDS order. */
export const missingFacts = r => FACT_FIELDS.filter(k => r?.[k] == null || r[k] === '');

const isObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);

/* An object's keys in the order `keys` gives, then any others as they came. */
const ordered = (obj, keys) => {
  const out = {};
  for (const k of keys) if (obj[k] !== undefined) out[k] = obj[k];
  for (const k of Object.keys(obj)) if (!Object.hasOwn(out, k) && obj[k] !== undefined) out[k] = obj[k];
  return out;
};
const keysOf = shape => shape.map(s => s.key);

const shaped = (key, value) => {
  if (key === 'locations' && Array.isArray(value)) {
    return value.map(l => isObject(l) ? ordered(l, keysOf(LOCATION_SHAPE)) : l);
  }
  if (key === 'mentions' && Array.isArray(value)) {
    return value.map(m => isObject(m) ? ordered(m, keysOf(MENTION_SHAPE)) : m);
  }
  if (key === 'factors' && isObject(value)) {
    const factors = ordered(value, FACTOR_NAMES);
    for (const k of Object.keys(factors)) {
      if (isObject(factors[k])) factors[k] = ordered(factors[k], keysOf(FACTOR_SHAPE));
    }
    return factors;
  }
  return value;
};

/* The entry with every schema key present, in schema order.
 *
 * A key the entry lacks takes its empty value; a key it has keeps its value
 * exactly, with the keys of its locations, factors and mentions put in their
 * own order. Nothing is filled in: an identity key that is absent stays
 * absent, for the lint to report. Returns a new object and leaves the one it
 * was given alone. */
export function normalizeEntry(entry) {
  const out = {};
  for (const { key, empty } of ENTRY_SCHEMA) {
    if (entry[key] !== undefined) out[key] = shaped(key, entry[key]);
    else if (empty !== undefined) out[key] = Array.isArray(empty) ? [] : empty === null ? null : {};
  }
  for (const key of Object.keys(entry)) {
    if (!Object.hasOwn(out, key) && !REFUSED_KEYS.includes(key) && entry[key] !== undefined) out[key] = entry[key];
  }
  return out;
}

/* The dataset with every entry normalised; the header and the order of the
 * entries are left as they are. */
export function normalizeDataset(dataset) {
  return { ...dataset, restaurants: dataset.restaurants.map(normalizeEntry) };
}

/* The one way the dataset is written to disk, so a file that two scripts
 * wrote from the same data is the same bytes. */
export const serializeDataset = dataset => JSON.stringify(dataset, null, 2) + '\n';
