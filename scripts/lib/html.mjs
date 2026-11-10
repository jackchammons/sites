/*
 * Just enough HTML reading for the build's own checks: which tags a page has
 * and what their attributes say. Built pages are machine-written and escaped,
 * so this is a tokenizer over well-formed markup, not a parser for the web.
 */

export const esc = s => String(s).replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const unesc = s => s.replace(/&(amp|lt|gt|quot|#39);/g, (m, n) =>
  ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" }[n]));

// A tag's attributes run to the first > outside quotes. The quoting matters:
// every page here carries an inline SVG icon, whose href holds tags of its own.
const ATTRS = `(?:[^>"']|"[^"]*"|'[^']*')*`;
const TAG = new RegExp(
  `<!--[\\s\\S]*?-->`
  + `|<(script|style)\\b(${ATTRS})>[\\s\\S]*?<\\/\\1\\s*>`
  + `|<([a-zA-Z][\\w:-]*)(${ATTRS})>`, 'gi');
const ATTR = /([^\s"'<>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'<>=`]+)))?/g;

/* Every opening tag as { name, attrs }, names lowercased. The bodies of
   script and style elements and of comments are skipped, so markup that only
   exists as a string in an inline script is not mistaken for the page's own. */
export function tags(html) {
  const out = [];
  for (const m of html.matchAll(TAG)) {
    const name = (m[1] || m[3] || '').toLowerCase();
    if (!name) continue;
    const attrs = {};
    for (const a of (m[2] ?? m[4]).matchAll(ATTR)) {
      attrs[a[1].toLowerCase()] = unesc(a[2] ?? a[3] ?? a[4] ?? '');
    }
    out.push({ name, attrs });
  }
  return out;
}

// /x resolves against the domain, not the site's directory. //host/x is another host.
export const isRootRelative = ref => ref.startsWith('/') && !ref.startsWith('//');

// A reference to a file the site itself ships: no scheme, no host, not a bare fragment or query.
export const isLocal = ref =>
  ref !== '' && !/^(?:[a-z][a-z0-9+.-]*:|\/|#|\?)/i.test(ref);

// The file part of a local reference, without its query and fragment.
export const filePart = ref => {
  const p = ref.replace(/[?#].*$/, '');
  try { return decodeURIComponent(p); } catch { return p; }
};
