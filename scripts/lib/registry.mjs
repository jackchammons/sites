/*
 * Registry validation.
 *
 * The build takes sites.config.json at its word: it runs each entry's commands
 * in `dir`, hands the site dist/<slug>/ as OUT_DIR, and each site's build
 * clears its OUT_DIR before writing. A slug is therefore a directory name and
 * a URL segment at once. Two entries sharing one publish over each other, and
 * a slug like ../docs points a build's cleanup at a source directory. Checking
 * the whole registry before anything is cleared is what makes those a refused
 * build instead of a green one.
 */
import fs from 'node:fs';
import path from 'node:path';

// The scaffolder accepts exactly this shape, so a scaffolded slug always passes.
export const SLUG = /^[a-z0-9][a-z0-9-]*$/;
export const ACCENT = /^#[0-9a-fA-F]{6}$/;

const isText = v => typeof v === 'string' && v.trim() !== '';
const isCommand = v => Array.isArray(v) && v.length > 0 && v.every(isText);

/* Returns one sentence per problem, each naming the entry and the field, and
   an empty list when the registry is safe to build. Reads the filesystem only
   to see that each `dir` exists; changes nothing. */
export function validateRegistry(config, repoRoot) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    return ['the registry must be a JSON object'];
  }
  const problems = [];

  // The landing page, the 404 page and the sitemap are rendered from these.
  for (const field of ['owner', 'title', 'tagline']) {
    if (!isText(config[field])) problems.push(`${field} must be a non-empty string`);
  }
  if (!isText(config.baseUrl) || !/^https?:\/\/[^\s/]+(\/\S*)?$/.test(config.baseUrl)) {
    problems.push('baseUrl must be an absolute http(s) URL');
  }
  if (config.customDomain !== undefined && !/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/i.test(config.customDomain)) {
    problems.push('customDomain must be a bare host name');
  }

  if (!Array.isArray(config.sites) || config.sites.length === 0) {
    problems.push('sites must be a non-empty array');
    return problems;
  }

  const root = path.resolve(repoRoot);
  const firstUse = new Map();
  config.sites.forEach((site, i) => {
    if (!site || typeof site !== 'object' || Array.isArray(site)) {
      problems.push(`sites[${i}] must be an object`);
      return;
    }
    const who = `sites[${i}]${typeof site.slug === 'string' ? ` "${site.slug}"` : ''}`;
    const bad = msg => problems.push(`${who}: ${msg}`);

    if (typeof site.slug !== 'string' || !SLUG.test(site.slug)) {
      bad('slug must be lowercase letters, digits and hyphens (it becomes dist/<slug>/ and the URL /<slug>/)');
    } else if (firstUse.has(site.slug)) {
      bad(`slug is already used by sites[${firstUse.get(site.slug)}]`);
    } else {
      firstUse.set(site.slug, i);
    }

    for (const field of ['name', 'tagline']) {
      if (!isText(site[field])) bad(`${field} must be a non-empty string`);
    }
    for (const field of ['emoji', 'cadence']) {
      if (site[field] !== undefined && !isText(site[field])) bad(`${field} must be a non-empty string when set`);
    }
    if (site.accent !== undefined && !(typeof site.accent === 'string' && ACCENT.test(site.accent))) {
      bad('accent must be a #rrggbb colour');
    }
    if (site.keywords !== undefined && !(Array.isArray(site.keywords) && site.keywords.every(isText))) {
      bad('keywords must be an array of non-empty strings when set');
    }

    if (!isCommand(site.build)) {
      bad('build must be a non-empty array of strings, like ["node", "scripts/build.mjs"]');
    }
    if (site.verify !== undefined && !isCommand(site.verify)) {
      bad('verify must be a non-empty array of strings when set');
    }

    if (!isText(site.dir)) {
      bad('dir must be a non-empty string');
    } else {
      const rel = path.relative(root, path.resolve(root, site.dir));
      const inside = top => rel === top || rel.startsWith(top + path.sep);
      if (rel === '') bad('dir must be a site directory, not the repository root');
      else if (path.isAbsolute(rel) || inside('..')) bad(`dir "${site.dir}" is outside the repository`);
      else if (inside('dist')) bad(`dir "${site.dir}" is inside dist/, which every build clears`);
      else if (!fs.statSync(path.join(root, rel), { throwIfNoEntry: false })?.isDirectory()) {
        bad(`dir "${site.dir}" is not a directory in the repository`);
      }
    }
  });
  return problems;
}
