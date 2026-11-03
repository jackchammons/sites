/*
 * The one mention-matcher: which tracked pizzerias does a headline name?
 *
 * Both the feed sweep (fetch-buzz.mjs) and the page build (the buzz section's
 * tags) use this, so a story can never be tagged by one and untagged by the
 * other. The rule set, deliberately conservative:
 *   - case-insensitive full-name substring match
 *   - a leading "The " on the pizzeria's name is optional in the headline
 *   - needles shorter than 5 characters never match (too many false hits)
 */
export function mentionMatch(title, restaurants) {
  const t = String(title).toLowerCase();
  const ids = [];
  for (const r of restaurants) {
    const name = r.name.toLowerCase();
    const needles = [name, name.replace(/^the\s+/, '')].filter(n => n.length > 4);
    if (needles.some(n => t.includes(n))) ids.push(r.id);
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
