# Screen & Seat

At `/screen/`: **[sites.jackhammons.com/screen/](https://sites.jackhammons.com/screen/)**

Enter a diagonal, a picture shape, a resolution and how far you sit, and it shows the
horizontal and vertical viewing angle, where each seating standard (THX 40°/36°/26°,
SMPTE 30°, the ITU-R BT.500 design viewing distances in picture heights, the old 1.5–2.5×
rule of thumb)
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
scripts/build.mjs      renders the form and output slots into OUT_DIR
scripts/verify.mjs     deploy gate: imports, ID seam and maths checked on the built copy
test/screen.test.mjs   the maths: pinned answers (node --test)
test/sweep.test.mjs    the maths: relationships across the whole input range (node --test)
test/page.test.mjs     the page script: the built app.js run in Node on a stand-in DOM (node --test)
test/page-checks.mjs   the rooms and what each must show, shared by the two page runners
test/browser-sweep.mjs the page in Chromium: the same checks, plus layout (dev box, Playwright)
```

Everything runs in the browser and no network request is made. The inputs live in the
URL hash (`#d=65&a=16:9&r=2160&v=108…`, lengths in inches), so a link reproduces a room.
Length fields accept `8′6″`, `8 ft 6 in`, `8.5`, `2.6 m` or `260 cm` whatever the unit
toggle says; field values are never locale-formatted, so what the page writes into a
field always reads back as the same number.

What is typed is read as it was meant or refused, never guessed. One comma is a decimal
point (`1,2` is a 1.2 throw, `2,6 m` is 2.6 m). Lumens and pixel counts are whole numbers:
plain digits or properly grouped thousands (`2,000`, `2.000`, `2 000`), and anything else
with a separator is invalid. A length where a comma could be either (`1,000 cm`) is
invalid too. A number still being typed (`8.`) is the number so far. While any field is
invalid the headline shows a dash with no grade colour, the message names the field, and
every other figure is dimmed (`.stale`) because it still describes the last valid room.

The standards are constants in `src/screen.js`. There is no method section on the page
(removed on request); the standards, the grading rules and the eye-limit model are
documented in `src/screen.js`, `src/app.js` and the tests. The footer credits the paper.

A grade is never colour alone. The headline and every graded fact (vertical angle, the
two pixels-per-degree figures, the 20/20 limit, who would see sharper, the eye line,
screen brightness, and the bottom edge when it is below the floor) carry a word beside
the figure in the same colour: `meets` for green, `marginal` for amber, `fails` for red.
One vocabulary for every fact: it meets the limit that fact is graded on, it is inside a
weaker limit only, or it is outside all of them. `showGrade` in `app.js` is the only
place a grade class is set and it writes the word in the same call, so the two cannot
disagree; `set(k, main, sub, cls)` goes through it. A fact with no grade has an empty
word slot that takes no room. `verify.mjs` fails a build where a fact has no word slot or
where `app.js` adds a class anywhere else.

Projector figures describe the image the panel lights, which is the picture only when
the two are the same shape. `litImage` in `src/screen.js` works it out from the pixel
pitch (the panel fitted inside the picture, as the pixel facts already assume): a 16:9
projector on a 2.39:1 screen fills the height and lights three quarters of the width.
Throw distance uses the lit width, brightness the lit area, lens offset the lit height,
and the image-width fact quotes the diagonal of the picture that image would light the
same way. The line under a fact that this changes says which dimension the panel fills
and the lit size. When the shapes match the lit image is the picture's own figures,
bit for bit, and nothing mentions it.

## Working on it

```bash
node --test screen/test/*.test.mjs                       # the maths and the page script, no browser
node screen/scripts/build.mjs && node screen/scripts/verify.mjs    # -> dist/screen/
node screen/test/browser-sweep.mjs [--quick]             # the page itself, in Chromium
```

A standalone build writes `dist/screen/`, where the multi-site build puts it; `OUT_DIR`
overrides that for all three scripts. The build refuses to clear a directory that holds
anything but a previous build.

Four layers of checks, because the one bug that shipped lived in none of the first two.
`screen.test.mjs` pins known answers; `sweep.test.mjs` checks the relationships that must
hold across the whole input range (inverses round-trip, orders are monotonic, independent
formulas agree, 55 of the 56 published cells of the Cambridge matrix, the last pinned to
the model). Neither sees `app.js`, where the grading rules, formatting, parsing and hash
handling live — which is where the vertical angle was graded against a resolution
distance for a week.

`page.test.mjs` does, on every push: it builds into a temporary directory, stands a small
DOM in for the browser, imports the built `app.js` and drives it through ~350 rooms by
the hash, then types into the fields and presses the buttons. `page-checks.mjs` holds the
rooms and the expectations: every displayed figure is parsed back against an independent
computation, and the cross-fact rules are checked (the headline and vertical grades agree
on 16:9, the pixel, eye and 20/20 facts agree, the tables' "you" rows carry the headline
angle and the diagonal as entered, targets read "met" exactly when the seat is past them,
every grade class has its word and an ungraded fact has neither, a projector's figures
are those of the lit image worked out from the two shapes, and so on), along with what
each typed entry must be read as. `SHOWN` in the same file is a few rooms with their
answers written out as the page prints them, the lit-image rooms among them.

`browser-sweep.mjs` runs the same rooms and expectations in Chromium and adds what only a
layout engine can answer: labels stay inside their charts at every width, nothing
overflows a phone, each grade word is drawn inside its fact in its figure's colour and
clear of the text around it, both colour schemes and awkward locales render, a tapped
tooltip stays, and the page shows its "script did not start" note when a file fails to
load or link. It needs Playwright, so it runs on the dev box, not in CI; run it before and after
touching a rule in `app.js` or anything that draws.

A field the page fills itself (a hash load, a unit switch) is displayed rounded but keeps
its exact value until edited, so a 36-inch seat does not come back as 35.83 after a trip
through centimetres. That is the `exact` map in `app.js`; keep it when adding a length
field.

