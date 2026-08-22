# Now

A clock, at `/clock/`. Live in the browser: **[sites.jackhammons.com/clock/](https://sites.jackhammons.com/clock/)**

The time and date rendered large, next to an analog dial, with the same instant written
out eight other ways (ISO 8601, UTC, Unix seconds, zone, offset, ISO week, day of year,
quarter), how far through the day, week, month and year we are, and 16 world clocks.

## How it is put together

Nothing time-dependent is rendered at build time. A figure baked into the HTML would be
wrong by however long ago the site was deployed, so `scripts/build.mjs` emits only the
shell — the dial, the labels, and an empty ID'd slot for every value — and `src/app.js`
fills all of them from the viewer's own device clock, once a second.

```
data/clocks.json     the cities in the world-clock grid
scripts/build.mjs    renders the shell into OUT_DIR, copies src/
scripts/verify.mjs   deploy gate
src/app.js           the live half: reads the clock, writes the slots
src/styles.css
```

Offsets, zone names and summer-time rules all come from the browser's own copy of the
IANA database through `Intl`, so there is no zone table to maintain here and no network
request at all. The daylight dot beside each city is banded from the local hour — a
hint, not a sunrise table.

Preferences (12- or 24-hour, seconds on or off) live in `localStorage`, guarded so that
a browser which refuses it still works.

## Working on it

```bash
node clock/scripts/build.mjs      # writes dist/
node clock/scripts/verify.mjs
```

The live values start hidden (`.pending`) and are revealed on the first paint, which
means a script that dies leaves a page of nothing rather than a plausible-looking wrong
time — `#boot-error` says so when that happens. `verify.mjs` guards the seam between the
two halves: every `$('id')` the script looks up has to exist in the rendered markup, and
every configured city has to be a zone `Intl` recognises. A mismatch there breaks only
the browser, which the build itself would never notice.
