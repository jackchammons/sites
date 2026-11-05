# Screen & Seat

At `/screen/`: **[sites.jackhammons.com/screen/](https://sites.jackhammons.com/screen/)**

Enter a diagonal, a picture shape, a resolution and how far you sit, and it shows the
horizontal and vertical viewing angle, where each seating standard (THX 40°/36°/26°,
SMPTE 30°, ITU-R BT.2022/BT.2020 picture-height rules, the old 1.5–2.5× rule of thumb)
would put your seat, how far away each resolution's pixels stay visible to 20/20 eyes,
what size reaches each standard from your seat, and whether the screen's height on the
wall keeps the eye line inside a comfortable band. In projector mode it adds throw
distance for the lens's zoom range, lens height from the offset, and screen brightness
in foot-lamberts against the cinema and home targets.

It also carries the calculations from Cambridge's [display resolution
calculator](https://www.cl.cam.ac.uk/research/rainbow/projects/display_calc/): pixel
density (ppi and pitch), pixels per degree at the centre and averaged across the picture,
a custom pixel count (with a button that reads the browser's own screen), the share of
people who could tell this display from a perfect one (the eye-limit fit from Ashraf,
Chapiro and Mantiuk, *Nature Communications* 2025, with the distances at which 20/20, the
median eye and 19 in 20 people stop seeing a difference), and the resolution-limit
matrix of screen size against seat distance, computed live for the chosen shape and
units rather than shown as their static image. The unit tests pin the matrix to cells
read off their published chart.

## How it is put together

```
data/defaults.json     the example room, the size table, the page copy
src/screen.js          the maths: dimensions, angles, standards, acuity, throw, placement
src/app.js             reads the form, renders figures, lanes chart, tables, side view
src/styles.css
scripts/build.mjs      renders the form + method copy into OUT_DIR
scripts/verify.mjs     deploy gate: ID seam + maths checked on the built copy
test/screen.test.mjs   unit tests (node --test)
```

Everything runs in the browser and no network request is made. The inputs live in the
URL hash (`#d=65&a=16:9&r=2160&v=108…`, lengths in inches), so a link reproduces a room.
Length fields accept `8′6″`, `8 ft 6 in`, `8.5`, `2.6 m` or `260 cm` whatever the unit
toggle says; field values are never locale-formatted, because a `3,66` written back into
a field would read as 366.

The standards are constants in `src/screen.js` and the method section prints them from
there; the verifier checks the built page mentions each one. Change a constant and the
copy follows; change a formula and the prose in `build.mjs` must change with it.

## Working on it

```bash
node --test screen/test/*.test.mjs                       # maths: pinned answers + the sweep
node screen/scripts/build.mjs && node screen/scripts/verify.mjs
node screen/test/browser-sweep.mjs [--quick]             # the page itself, in Chromium
```

Three layers of checks, because the one bug that shipped lived in none of the first two.
`screen.test.mjs` pins known answers; `sweep.test.mjs` checks the relationships that must
hold across the whole input range (inverses round-trip, orders are monotonic, independent
formulas agree, all 56 cells of the Cambridge matrix). Neither sees `app.js`, where the
grading rules, formatting, parsing and hash handling live — which is where the vertical
angle was graded against a resolution distance for a week. `browser-sweep.mjs` drives the
built page through ~330 input states and parses every displayed figure back against an
independent computation, then checks the cross-fact rules: the headline and vertical
grades agree on 16:9, the pixel, eye and 20/20 facts agree, the tables' "you" rows carry
the headline angle, targets read "met" exactly when the seat is past them, and so on. It
needs Chromium via Playwright, so it runs on the dev box, not in CI; run it before
touching a rule in `app.js`.

A field the page fills itself (a hash load, a unit switch) is displayed rounded but keeps
its exact value until edited, so a 36-inch seat does not come back as 35.83 after a trip
through centimetres. That is the `exact` map in `app.js`; keep it when adding a length
field.

