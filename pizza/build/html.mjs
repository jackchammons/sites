/* Shared HTML helpers for the build modules. */
import { esc } from '../src/render.js';
export { esc };

export const fmtDate = d => d.toLocaleDateString('en-US', {
  timeZone: 'America/Los_Angeles', year: 'numeric', month: 'long', day: 'numeric'
});
/* A date-only string ("2026-08-27") is a calendar day, not an instant: format
 * it in UTC or it renders a day early west of Greenwich. Full timestamps
 * (feed items) are instants and get the site's local zone. */
export const shortDate = iso => {
  const dayOnly = /^\d{4}-\d{2}-\d{2}$/.test(String(iso));
  return new Date(iso).toLocaleDateString('en-US', {
    timeZone: dayOnly ? 'UTC' : 'America/Los_Angeles', month: 'short', day: 'numeric', year: 'numeric'
  });
};

/* Link text for a citation: the outlet's hostname, so a list of links (or a
 * screen reader's) says who is being cited instead of "source" eighty times. */
export const hostOf = url => {
  try { return new URL(url).hostname.replace(/^www\./, ''); }
  catch { return 'source'; }
};

/* A pizzeria name, linked to its best web presence: the official site when one
 * is on file, its Instagram otherwise. Used everywhere a name appears outside
 * the ranked cards, so the rule holds across the page. */
export const nameLink = (r, cls = '') => {
  const href = r.url ?? r.instagram;
  return href
    ? `<a${cls ? ` class="${cls}"` : ''} href="${esc(href)}" target="_blank" rel="noopener">${esc(r.name)}</a>`
    : (cls ? `<span class="${cls}">${esc(r.name)}</span>` : esc(r.name));
};
