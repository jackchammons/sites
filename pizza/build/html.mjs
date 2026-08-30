/* Shared HTML helpers for the build modules. */
import { esc } from '../src/render.js';
export { esc };

export const fmtDate = d => d.toLocaleDateString('en-US', {
  timeZone: 'America/Los_Angeles', year: 'numeric', month: 'long', day: 'numeric'
});
export const shortDate = iso => new Date(iso).toLocaleDateString('en-US', {
  timeZone: 'America/Los_Angeles', month: 'short', day: 'numeric', year: 'numeric'
});

/* A pizzeria name, linked when a website is on file. Used everywhere a name
 * appears outside the ranked cards, so the rule holds across the page. */
export const nameLink = (r, cls = '') =>
  r.url
    ? `<a${cls ? ` class="${cls}"` : ''} href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.name)}</a>`
    : (cls ? `<span class="${cls}">${esc(r.name)}</span>` : esc(r.name));
