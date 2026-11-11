/*
 * Content-stamped asset URLs.
 *
 * Pages serves every file with a ten-minute cache, and the page and its
 * scripts expire separately. For that window after a deploy a returning
 * visitor can hold the new HTML with the old app.js, or the reverse, and a
 * script that looks up an element the other half does not have throws on load.
 * Giving each script and stylesheet URL a hash of its content makes a changed
 * file a changed URL, which no cache holds. It is done here, once, on every
 * site's output, so a site references ./app.js plainly and cannot forget.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { walk } from './checks.mjs';
import { tags, isLocal } from './html.mjs';

const STAMPABLE = /\.(?:js|mjs|css)$/;
const SCRIPT = /\.m?js$/;
const PAGE = /\.html?$/;

const sha = bytes => createHash('sha1').update(bytes).digest('hex').slice(0, 8);

// './x.js' as a whole string literal: an import specifier, or a URL a script
// builds a tag or a worker from. An existing ?v= is matched so it is replaced.
const LITERAL = /(['"`])(\.{1,2}\/[^'"`?#\s\\]+)(?:\?v=[^'"`#\s\\]*)?\1/g;
// src="./x.js" or href="styles.css" in markup.
const REFERENCE = /(?<![\w-])(src|href)=(["'])([^"'?#\s]+)(?:\?v=[^"'#\s]*)?\2/g;

const resolve = (from, ref) => path.posix.normalize(path.posix.join(path.posix.dirname(from), ref));

/*
 * files: Map of path (posix, relative to the site's directory) -> Buffer, for
 * the site's scripts, stylesheets and pages.
 *
 * Returns { changed, stamps }: the files whose bytes were rewritten, and the
 * 8-hex stamp of every script and stylesheet. Nothing is read or written.
 *
 * A script is stamped after the files it imports, so its own hash covers the
 * stamped specifiers inside it: a change three imports deep still changes the
 * URL the page asks for. Two modules that import each other cannot both go
 * first; the one met again while it is still being processed keeps the hash
 * of its bytes as emitted, everywhere it is referenced, so it still has one
 * URL and is still evaluated once.
 */
export function stamp(files) {
  const assets = [...files.keys()].filter(f => STAMPABLE.test(f)).sort();
  const emitted = new Set(assets);
  const changed = new Map();
  const stamps = new Map();
  const open = new Set();
  const cyclic = new Set();

  const visit = file => {
    if (stamps.has(file)) return stamps.get(file);
    if (open.has(file)) { cyclic.add(file); return sha(files.get(file)); }
    open.add(file);
    let bytes = files.get(file);
    if (SCRIPT.test(file)) {
      const before = bytes.toString('utf8');
      const after = before.replace(LITERAL, (whole, quote, ref) => {
        const target = resolve(file, ref);
        if (target === file || !emitted.has(target)) return whole;
        return `${quote}${ref}?v=${visit(target)}${quote}`;
      });
      if (after !== before) { bytes = Buffer.from(after); changed.set(file, bytes); }
    }
    open.delete(file);
    stamps.set(file, sha(cyclic.has(file) ? files.get(file) : bytes));
    return stamps.get(file);
  };
  assets.forEach(visit);

  for (const page of [...files.keys()].filter(f => PAGE.test(f)).sort()) {
    const before = files.get(page).toString('utf8');
    const after = before.replace(REFERENCE, (whole, attr, quote, ref) => {
      if (!isLocal(ref)) return whole;
      const target = resolve(page, ref);
      if (!emitted.has(target)) return whole;
      return `${attr}=${quote}${ref}?v=${stamps.get(target)}${quote}`;
    });
    if (after !== before) changed.set(page, Buffer.from(after));
  }
  return { changed, stamps };
}

/* The script and stylesheet references a page loads without a stamp. A page
   that still has one after stamping would bring the stale-pair crash back for
   that file, so the build treats any as a failure. */
export function unstamped(html) {
  const missing = [];
  for (const { name, attrs } of tags(html)) {
    const ref = name === 'script' ? attrs.src
      : name === 'link' && /\bstylesheet\b/i.test(attrs.rel || '') ? attrs.href
      : undefined;
    if (ref === undefined || !isLocal(ref)) continue;
    if (!/\?v=[0-9a-f]{8}$/.test(ref)) missing.push(ref);
  }
  return missing;
}

/* Stamps a built site in place. Returns the stamps and, per page, any script
   or stylesheet reference that came out without one. */
export function stampDir(out) {
  const files = new Map();
  for (const file of walk(out)) {
    if (STAMPABLE.test(file) || PAGE.test(file)) files.set(file, fs.readFileSync(path.join(out, file)));
  }
  const { changed, stamps } = stamp(files);
  for (const [file, bytes] of changed) fs.writeFileSync(path.join(out, file), bytes);

  const missing = [];
  for (const page of [...files.keys()].filter(f => PAGE.test(f))) {
    const html = (changed.get(page) || files.get(page)).toString('utf8');
    for (const ref of unstamped(html)) missing.push({ page, ref });
  }
  return { stamps, missing };
}
