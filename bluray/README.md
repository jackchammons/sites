# Blu-ray Shelf

At `/bluray/`: **[sites.jackhammons.com/bluray/](https://sites.jackhammons.com/bluray/)**

The Blu-rays and 4K discs on the shelf. The top of the page is the shelf itself, drawn:
one spine per entry, in its own colours and at its own width. Under it is the list:
title, year, director, format and edition. A spine links to its row. Four chips narrow
the list (everything, 4K UHD, Blu-ray, Criterion) and dim the spines they leave out. A
menu re-orders the list, and the cases on the shelf change places to match, each one
lifted, carried along and set down. The page opens with the same movement: the shelf
starts jumbled and sorts itself out. A line under the heading says when the collection
was last updated.

## Adding or removing a disc

The collection is `discs` in `data/data.json`, **in shelf order, left to right**. Add an
entry where the case stands, or delete the one that left, set `updated` to today, and
rebuild. Every count, the opening sentence and the chips follow from the list; nothing
else needs editing.

`updated` is the "Last updated" date under the heading, and nothing sets it for you. It
is the day the collection last changed, not the day the site was built: the deploy
rebuilds every site daily, so a build date would move every day and mean nothing.

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

A spine does not always say what format it is: Criterion spines carry no format logo, so
a photo of the shelf cannot settle it. The owner has confirmed that everything on the
first list is 4K UHD except the extended-edition *Lord of the Rings* set, which is
Blu-ray. Ask before guessing the format of a new Criterion.

## How it is put together

```
data/data.json          the collection, in shelf order, and the page copy
src/shelf.js            the rules: validation, filtering, ordering, the summary. No DOM
src/app.js              the live half: the chips, the order menu, the cases changing places
src/styles.css
scripts/build.mjs       renders the shelf and the list into OUT_DIR, copies src/
scripts/verify.mjs      deploy gate: data, markup and script agree; rules run from the built copy
test/shelf.test.mjs     the rules, and data.json held to them (node --test)
test/browser-check.mjs  the page in Chromium (dev box, Playwright)
```

The build renders everything: every spine and every row, in shelf order, with the counts
worked out from the data. The page is complete with JavaScript off. `app.js` adds the
movement and the two controls, which are rendered `hidden` and shown by the script, so a
viewer without it never sees controls that do nothing.

`src/shelf.js` is the one implementation of the rules. `build.mjs` renders with it,
`app.js` calls the same `arrange()` when a control changes, and the unit tests and
`verify.mjs` import it, the verifier from the *built* copy. Don't fork it. The chips and
the orders are lists in that file (`SHOWS`, `SORTS`); the build draws the controls from
them, so adding one there is the whole change.

The only date on the page is `updated`. There is no build time in it, and `verify.mjs`
fails a build that bakes one in: the page is the same bytes on every deploy until the
data changes.

The one inline script in the `<head>` adds a `js` class to `<html>` before the page is
first painted. The stylesheet needs it to know a script is coming (see the opening,
below); nothing else may hang off it.

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
- **The page opens in shelf order and does not say so.** The first entry of the order
  menu is the order of the data, which is the order the cases really stand in. By the
  owner's choice the page never mentions that: the menu calls it "Default", and no copy
  says "as shelved", "left to right" or the like. Keep it that way.
- **The shelf follows the order menu.** Choosing an order re-sorts the list and the cases
  on the shelf with it. Every case stays on the shelf whatever chip is chosen; a chip only
  dims some. `shelve()` in `app.js` measures where each case stands, reorders the DOM, and
  plays the difference back as a transform that runs out to nothing, so a case is lifted,
  carried to its new place and set down. A second choice made mid-move starts from
  wherever the cases have got to.
- **The page opens with that movement.** `app.js` jumbles the cases (`scramble()` in
  `shelf.js`) and lets the first `apply()` bring each one in from its jumbled place. So
  that nobody sees them standing in order and then jump apart, the stylesheet holds them
  out of sight until `app.js` marks the shelf `.ready`. The hold lets go by itself after
  three seconds, so the shelf still appears if `app.js` never loads, and it applies only
  when the inline script has run, so the page is whole with JavaScript off.
- **Nothing moves for a viewer who asked for less motion.** With
  `prefers-reduced-motion: reduce` there is no hold, no jumble and no animation; the
  cases are simply in their places.
- **The page always matches the controls.** A browser may restore the chips and the menu
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

`verify.mjs` cannot see layout, behaviour or movement. `browser-check.mjs` drives the
built page for them: at 320, 390, 768 and 1280px in both colour schemes, no sideways
page scroll and no clipped lettering; the opening, from jumbled and out of sight to
standing in order; every chip and order against `arrange()`, in the list and on the
shelf, with the cases moving to get there; a change of order mid-move; a dimmed spine
still reaching its row; the controls after going back; and the page with reduced
motion, with `app.js` blocked, and with JavaScript off. It needs Playwright, so it runs
on the dev box and not in CI. Run it after touching `app.js`, `styles.css`, or the
`look` of an entry.

Assets are referenced as plain relative paths (`./app.js`, `./styles.css`, `from
'./shelf.js'`). The multi-site build stamps them with a content hash after `verify.mjs`
has run, so nothing here adds a version of its own.
