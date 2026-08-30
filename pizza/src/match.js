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
