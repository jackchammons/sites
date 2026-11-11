/*
 * The one mention-matcher: which tracked pizzerias does a headline name?
 *
 * Both the feed sweep (fetch-buzz.mjs) and the page build (the buzz section's
 * tags) use this, so a story can never be tagged by one and untagged by the
 * other. The rule set, deliberately conservative:
 *   - the full name, as whole words: "Mad Pizza" is not inside "Nomad pizza"
 *   - written as a name: every word the pizzeria capitalises is capitalised
 *     in the headline too, so "a Belltown pizza spot" and "Phinney Ridge
 *     pizza" are descriptions, not Belltown Pizza and Ridge Pizza
 *   - not the front of an event's name ("World Pizza Championship")
 *   - a leading "The " on the pizzeria's name is optional in the headline
 *   - needles shorter than 5 characters never match (too many false hits)
 * A headline set entirely in title case can still read a description as a
 * name; that is the price of matching on text alone, and it costs a tag, not
 * a score.
 */
const EVENT_WORD = /^\s+(?:Championships?|Champions?|Cup|Games|Expo|Day|Week|Month)\b/;
const reEscape = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const isUpper = c => c !== c.toLowerCase();

function names(title, needle) {
  const words = needle.split(/\s+/);
  const re = new RegExp(`(?<![\\p{L}\\p{N}])${words.map(reEscape).join('\\s+')}(?![\\p{L}\\p{N}])`, 'giu');
  for (const m of title.matchAll(re)) {
    const got = m[0].split(/\s+/);
    if (!words.every((w, i) => !isUpper(w[0]) || isUpper(got[i][0]))) continue;
    if (EVENT_WORD.test(title.slice(m.index + m[0].length))) continue;
    return true;
  }
  return false;
}

export function mentionMatch(title, restaurants) {
  const t = String(title);
  const ids = [];
  for (const r of restaurants) {
    const name = r.name.trim();
    const needles = [name, name.replace(/^the\s+/i, '')].filter(n => n.length > 4);
    if (needles.some(n => names(t, n))) ids.push(r.id);
  }
  return ids;
}

/* One normalisation for "is this the same story": scheme, www., trailing
 * slash, hash and tracking parameters stripped from the URL; punctuation and
 * case folded out of the title. A Google News redirect never normalises to
 * the publisher URL, which is why the title half exists. */
export function normUrl(u) {
  try {
    const x = new URL(String(u));
    const drop = [...x.searchParams.keys()].filter(k => /^(utm_|fbclid|gclid|oc$|ref$|source$)/.test(k));
    for (const k of drop) x.searchParams.delete(k);
    const q = x.searchParams.toString();
    return `${x.hostname.replace(/^www\./, '')}${x.pathname.replace(/\/+$/, '')}${q ? '?' + q : ''}`.toLowerCase();
  } catch { return String(u).toLowerCase().trim(); }
}
export const normTitle = t => String(t ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
