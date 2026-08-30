/* Shared HTML helpers for the build modules. */
import { esc } from '../src/render.js';
export { esc };

export const fmtDate = d => d.toLocaleDateString('en-US', {
  timeZone: 'America/Los_Angeles', year: 'numeric', month: 'long', day: 'numeric'
});
export const shortDate = iso => new Date(iso).toLocaleDateString('en-US', {
  timeZone: 'America/Los_Angeles', month: 'short', day: 'numeric', year: 'numeric'
});

/* A pizzeria name, linked to its best web presence: the official site when one
 * is on file, its Instagram otherwise. Used everywhere a name appears outside
 * the ranked cards, so the rule holds across the page. */
export const nameLink = (r, cls = '') => {
  const href = r.url ?? r.instagram;
  return href
    ? `<a${cls ? ` class="${cls}"` : ''} href="${esc(href)}" target="_blank" rel="noopener">${esc(r.name)}</a>`
    : (cls ? `<span class="${cls}">${esc(r.name)}</span>` : esc(r.name));
};
