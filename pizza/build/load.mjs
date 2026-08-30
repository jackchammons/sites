/* Loads everything a build reads: the dataset (with the attribute registry
 * attached so browser and build price friction identically), weekly history,
 * and the buzz feed with validated research stories merged in. Pure I/O; no
 * derivation happens here. */
import fs from 'node:fs';
import path from 'node:path';

export function loadContext(root) {
  const read = p => fs.readFileSync(path.join(root, p), 'utf8');

  const dataset = JSON.parse(read('data/restaurants.json'));
  dataset.attributeRegistry = JSON.parse(read('data/attributes.json'));
  delete dataset.attributeRegistry._comment;

  const historyPath = path.join(root, 'data/history.json');
  const history = fs.existsSync(historyPath)
    ? JSON.parse(fs.readFileSync(historyPath, 'utf8'))
    : { snapshots: [] };

  const buzzPath = path.join(root, 'data/buzz.json');
  const buzz = fs.existsSync(buzzPath)
    ? JSON.parse(fs.readFileSync(buzzPath, 'utf8'))
    : { updated: null, items: [] };

  /* Stories the research agent found that the feeds missed. Additive, and
   * wrapped in try/catch so a malformed file can never take the site down --
   * verify-research.mjs is the real gate, this is the belt to its braces. */
  const researchPath = path.join(root, 'data/research.json');
  if (fs.existsSync(researchPath)) {
    try {
      const research = JSON.parse(fs.readFileSync(researchPath, 'utf8'));
      const found = research.news ?? research.items ?? [];
      // Dedup on title as well as URL: the feed sweep stores Google News
      // redirect URLs while the agent links publishers directly.
      const norm = t => String(t).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
      const knownUrls   = new Set(buzz.items.map(b => String(b.url).toLowerCase()));
      const knownTitles = new Set(buzz.items.map(b => norm(b.title)));
      const extra = found
        .filter(r => r && r.url && r.title
                  && !knownUrls.has(String(r.url).toLowerCase())
                  && !knownTitles.has(norm(r.title)))
        .map(r => ({ ...r, via: 'research' }));
      buzz.items = [...buzz.items, ...extra]
        .sort((a, b) => Date.parse(b.published) - Date.parse(a.published));
      if (extra.length) console.log(`  + ${extra.length} researched item(s)`);
    } catch (e) {
      console.warn(`  ! ignoring data/research.json: ${e.message}`);
    }
  }

  return { root, dataset, history, buzz };
}
