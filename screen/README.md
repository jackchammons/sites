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
node --test screen/test/*.test.mjs
node screen/scripts/build.mjs && node screen/scripts/verify.mjs
```
