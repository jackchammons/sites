/*
 * Checks every site's output must pass, whatever the site is.
 *
 * A site's own verifier knows its content; these are the things that are true
 * of any page published under /<slug>/, so they are checked once here instead
 * of being copied into each verifier (and forgotten in the next one).
 */
import fs from 'node:fs';
import path from 'node:path';
import { tags, isLocal, isRootRelative, filePart } from './html.mjs';

// Every file under dir, as posix paths relative to it.
export function walk(dir, prefix = '') {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix + entry.name;
    if (entry.isDirectory()) out.push(...walk(path.join(dir, entry.name), rel + '/'));
    else out.push(rel);
  }
  return out.sort();
}

/* The problems with one page, given a way to ask whether a referenced file
   was emitted. `page` is the page's path inside the site, for the messages. */
export function checkPage(html, page, exists) {
  const problems = [];
  for (const { name, attrs } of tags(html)) {
    for (const attr of ['src', 'href']) {
      const ref = attrs[attr];
      if (ref === undefined) continue;
      if (isRootRelative(ref)) {
        problems.push(`${page}: <${name} ${attr}="${ref}"> is root-relative and misses the site's own directory; use a relative path`);
      } else if (isLocal(ref) && (attr === 'src' || name === 'link')) {
        // Scripts, images and stylesheets are fetched with the page, so a
        // missing one is a broken page rather than a dead link.
        if (!exists(filePart(ref))) {
          problems.push(`${page}: <${name} ${attr}="${ref}"> names a file the build did not emit`);
        }
      }
    }
  }
  return problems;
}

/* The problems with a built site directory; empty when it is publishable. */
export function checkOutput(out) {
  const indexPath = path.join(out, 'index.html');
  if (!fs.existsSync(indexPath)) return ['the build produced no index.html'];

  const problems = [];
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(fs.readFileSync(indexPath, 'utf8'));
  if (!title || !title[1].trim()) problems.push('index.html has no <title>');

  for (const page of walk(out).filter(f => /\.html?$/.test(f))) {
    const from = path.dirname(path.join(out, page));
    problems.push(...checkPage(fs.readFileSync(path.join(out, page), 'utf8'), page, file => {
      const target = path.resolve(from, file);
      // A path that leaves the site points at a sibling or the landing page,
      // which may not be built yet; only this site's own files are checked.
      if (path.relative(out, target).startsWith('..')) return true;
      return fs.existsSync(target);
    }));
  }
  return problems;
}
