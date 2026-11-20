# Blu-ray Shelf

At `/bluray/`: **[sites.jackhammons.com/bluray/](https://sites.jackhammons.com/bluray/)**

The Blu-rays and 4K discs on the shelf, in the order they stand. The top of the page is
the shelf itself, drawn: one spine per entry, in its own colours and at its own width,
left to right. Under it is the list: title, year, director, format, and the edition as
its spine reads. A spine links to its row. Four chips narrow the list (everything, 4K
UHD, Blu-ray, Criterion) and dim the spines they leave out, and a menu re-orders it.

## Adding or removing a disc

The collection is `discs` in `data/data.json`, **in shelf order, left to right**. Add an
entry where the case stands, or delete the one that left, set `updated` to the day you
checked the shelf, and rebuild. Every count, the opening sentence and the chips follow
from the list; nothing else needs editing.

```json
{
  "id": "deer-hunter",
  "title": "The Deer Hunter",
  "year": 1978,
  "director": "Michael Cimino",
  "format": "4K UHD",
  "label": "Shout Select",
  "number": 105,
  "catalog": "SF 20276",
  "notes": ["4K UHD + Blu-ray", "2-disc set"],
  "look": { "bg": "#b5232c", "ink": "#ffffff", "cap": "#111113", "width": 1, "height": 0.9, "face": "serif" }
}
```

| Field | | |
|---|---|---|
| `id` | required | Lowercase letters, digits and hyphens, unique. It is the row's anchor (`#d-<id>`), so changing it breaks links to that row. |
| `title` | required | As listed. Sorted without a leading *The*, *A* or *An*. |
| `spine` | optional | Shorter wording for the drawn spine, when the title is too long for it. |
| `year`, `yearEnd` | `year` required | The film's year. `yearEnd` makes a span for a box set (`2001–2003`). |
| `director` | required | |
| `format` | required | `"4K UHD"` or `"Blu-ray"`. A combo pack is `"4K UHD"`, with `"4K UHD + Blu-ray"` in `notes`. |
| `label` | required | The publisher. `"Criterion Collection"`, spelled so, is what the Criterion chip counts. |
| `number` | optional | The label's spine number, shown as `Label #950`. |
| `catalog` | optional | The catalogue number printed on the spine. |
| `notes` | optional | Short strings shown after the label: the edition, the disc count, the region. |
| `look` | required | How the spine is drawn. `bg` and `ink` are its colour and its lettering, as `#rrggbb`. `cap` is the strip of plastic case showing above the sleeve (blue for a Blu-ray case, black for a 4K one, grey for a clear one); leave it out for a slipcase or a box. `width` is in standard cases: 1 is an ordinary case, 2.2 a box set. `height` is a fraction of the tallest spine, 0.9 when left out. `face` is `serif`, `sans` or `script`. |

A bad entry stops the build and names itself (`discs[4] (deer-hunter): format must be one
of …`). The same rules run in the unit tests, so CI fails on it too.

This first list was read off a photo of the shelf, so `format` follows the logo on each
spine. Criterion spines carry no format logo; those five are listed as Blu-ray.

## How it is put together

```
data/data.json          the collection, in shelf order, and the page copy
src/shelf.js            the rules: validation, filtering, ordering, the summary. No DOM
src/app.js              the live half: the chips and the order menu
src/styles.css
scripts/build.mjs       renders the shelf and the list into OUT_DIR, copies src/
scripts/verify.mjs      deploy gate: data, markup and script agree; rules run from the built copy
test/shelf.test.mjs     the rules, and data.json held to them (node --test)
test/browser-check.mjs  the page in Chromium (dev box, Playwright)
```

The build renders everything: every spine and every row, in shelf order, with the counts
worked out from the data. The page is complete with JavaScript off. `app.js` only adds
the chips and the order menu, which are rendered `hidden` and shown by the script, so a
viewer without it never sees controls that do nothing.

`src/shelf.js` is the one implementation of the rules. `build.mjs` renders with it,
`app.js` calls the same `arrange()` when a control changes, and the unit tests and
`verify.mjs` import it, the verifier from the *built* copy. Don't fork it. The chips and
the orders are lists in that file (`SHOWS`, `SORTS`); the build draws the controls from
them, so adding one there is the whole change.

The only date on the page is `updated`, the day the shelf was catalogued. There is no
build time in it, and `verify.mjs` fails a build that bakes one in: the page is the same
bytes on every deploy until the data changes.

## How the page behaves

- **The shelf fits when it can and scrolls when it cannot.** A case is as wide as lets
  the whole row fit the shelf, between 36 and 46px (the build passes the number of spines
  and their total width as `--n` and `--units`). Below 36px the row scrolls sideways
  *inside* the shelf; the page itself never scrolls sideways. That is a phone today, and
  will be a desktop once the collection outgrows one row.
- **Lettering is sized to its spine.** The font size comes from the spine's height and
  the length of its title, so a long title shrinks instead of being cut off. A long title
  on a box 1.6 cases wide or more is set in two lines. If one is still clipped, give the
  entry a shorter `spine`.
- **A spine always leads to its row.** If a chip has the row hidden, following the spine
  puts the chips back on Everything first.
- **The spines never move.** Ordering applies to the list; the shelf stays as it stands.
- **The list always matches the controls.** A browser may restore the chips and the menu
  after a reload or a trip through history without firing a `change` event, so `app.js`
  applies them again on `pageshow`.
- **The shelf is the same dark wood in both colour schemes.** Everything else follows
  the viewer's light or dark setting.

## Working on it

```bash
node --test bluray/test/*.test.mjs                                  # the rules and the data, no browser
node bluray/scripts/build.mjs && node bluray/scripts/verify.mjs    # -> dist/bluray/
node bluray/test/browser-check.mjs                                  # the page itself, in Chromium
node scripts/build-all.mjs --only bluray                            # the way the deploy builds it
```

A standalone build writes `dist/bluray/`, where the multi-site build puts it; `OUT_DIR`
overrides that for all three scripts. The build refuses to clear a directory that holds
anything but a previous build. Run `verify.mjs` on a standalone build, not on a
`dist/bluray/` that `build-all` has already stamped.

`verify.mjs` cannot see layout or behaviour. `browser-check.mjs` drives the built page
for them at 320, 390, 768 and 1280px in both colour schemes: no sideways page scroll, no
clipped lettering, every chip and order against `arrange()`, a dimmed spine still
reaching its row, the controls after going back, and the page with JavaScript off. It
needs Playwright, so it runs on the dev box and not in CI. Run it after touching
`app.js`, `styles.css`, or the `look` of an entry.

Assets are referenced as plain relative paths (`./app.js`, `./styles.css`, `from
'./shelf.js'`). The multi-site build stamps them with a content hash after `verify.mjs`
has run, so nothing here adds a version of its own.
