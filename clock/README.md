# Now

A clock, at `/clock/`. Live in the browser: **[sites.jackhammons.com/clock/](https://sites.jackhammons.com/clock/)**

The time and date rendered large, next to an analog dial, with the same instant written
out eight other ways (ISO 8601, UTC, Unix seconds, zone, offset, ISO week, day of year,
quarter), how far through the day, week, month and year we are, and 16 world clocks.

## How it is put together

Nothing time-dependent is rendered at build time. A figure baked into the HTML would be
wrong by however long ago the site was deployed, so `scripts/build.mjs` emits only the
shell — the dial, the labels, and an empty ID'd slot for every value — and `src/app.js`
fills all of them from the viewer's own device clock, once a second. That rule covers the
time of the build as well: there is no "page built" stamp, two builds of the same source
are the same bytes, and `verify.mjs` fails a page with a timestamp in it.

```
data/clocks.json     the cities in the world-clock grid, and the footer note
scripts/build.mjs    renders the shell into OUT_DIR, copies src/
scripts/verify.mjs   deploy gate
src/time.js          the arithmetic: ISO week, day counts, progress, offsets, zone comparison
src/app.js           the live half: reads the clock, writes the slots
src/styles.css
test/time.test.mjs   unit tests for time.js
```

`src/time.js` is the one implementation of the calendar and offset arithmetic. It is an ES
module with no DOM in it, imported by `app.js`, by the tests, and by `verify.mjs`, which
runs it from the *built* copy. Don't fork it, and put new arithmetic there rather than in
`app.js`, where nothing can test it. Two rules it holds:

- **Days left are counted on the calendar, not in milliseconds.** The month and year bars
  say "N days left" from the date alone, counting today, so the year bar always reads one
  more than the "days after today" note beside the day of year. A count rounded up from
  elapsed milliseconds is a day out for part of the day whenever summer time changes
  before the end of the month or year ("32 days left in October"). The percentages and
  the hours left today are measured between local midnights, which is right on a 23- or
  25-hour day.
- **Zones are compared by the name the browser files them under.** Chromium reports a
  viewer in India as `Asia/Calcutta`; the Mumbai row is configured as `Asia/Kolkata`.
  `sameZone()` resolves both through `Intl` before comparing, which is what gives that
  viewer the "here" highlight. Differences between zones print as hours and minutes
  ("+5h 30m", "−15m"), never as a decimal.

Offsets, zone names and summer-time rules all come from the browser's own copy of the
IANA database through `Intl`, so there is no zone table to maintain here and no network
request at all. The daylight dot beside each city is banded from the local hour — a
hint, not a sunrise table.

Preferences (12- or 24-hour, seconds on or off) live in `localStorage`, guarded so that
a browser which refuses it still works. The footer says so: the note in
`data/clocks.json` states that those two choices are remembered in this browser and that
nothing is fetched or sent. Each of the two buttons keeps a fixed label ("12-hour",
"Seconds") and reports its state through `aria-pressed` alone.

### How it keeps time

The figures are painted from a `setTimeout` aimed at the next second boundary, not from
animation frames. A timer still fires in a background tab (throttled, never stopped), so
the time in the tab title stays right while the page is out of sight; animation frames
stop there altogether. A `visibilitychange` back to visible repaints at once.
`requestAnimationFrame` is used only to sweep the hands between seconds, and not at all
under `prefers-reduced-motion`, where the hands step once a second with the figures. A
change to that setting is followed while the page is open. The `Intl` formatters are
built once at load, not on every tick.

### Colour

`--ink-3` carries nearly all the small text and has to clear 4.5:1 on `--bg`, `--panel`
and `--panel-2` in both palettes. `--accent` is for strokes and fills (hands, bars, dots,
borders); small text in the accent hue takes `--accent-ink`, which is darker on the light
palette. The viewer's own row in the world clocks is tinted, so its small text uses
`--ink-2`.

## Working on it

```bash
node clock/scripts/build.mjs      # writes dist/clock/, the same place build-all puts it
node clock/scripts/verify.mjs
node --test clock/test/time.test.mjs
```

The build refuses to clear an output directory that is neither empty nor a previous
build (one with an `index.html`), so a mistyped `OUT_DIR` cannot delete source.

The tests that depend on summer time start a child `node` with `TZ` set (Europe/Berlin,
America/Los_Angeles, Australia/Sydney and others), because a process keeps one zone for
its whole life. Add a case there for any date that looks wrong on the page.

The live values start hidden (`.pending`) and are revealed on the first paint, which
means a script that dies leaves a page of nothing rather than a plausible-looking wrong
time — `#boot-error` says so when that happens. Three things lead there:

- an exception in a paint, caught by the loop;
- an element the script looks up and the page does not have: `$()` notes every miss and
  the boot refuses to start on any, naming the ids in the console. Nothing writes around
  a missing element, so a typo is never a dash that stays a dash;
- `app.js` or `time.js` failing to load or to link. A module in that state runs no code
  at all, so a small inline script in the page reveals the note when the load event
  arrives and `.pending` marks are still standing.

`verify.mjs` guards the seam between the two halves, which a build would never notice
because a mismatch there breaks only the browser:

- every `$('id')` the script looks up exists in the rendered markup;
- the prefixed slots (`fact-`, `note-`, `pct-`, `fill-`, `rest-`, `track-`) pair up in
  both directions with the key lists in `app.js`. `FACT_KEYS` and `BAR_KEYS` are read by
  regex, as are the loops that use them, so keep them as plain literals; a lookup written
  in any other shape fails the check rather than escaping it;
- every `facts.<key>` the script writes is a key, and every key is written;
- each part `app.js` writes in a city row (`.zt-time`, `.off` and so on) is in every row,
  and every configured city is a zone `Intl` recognises;
- every name `app.js` imports is one the built `time.js` exports;
- the built `time.js` gives known answers for a handful of dates and offsets.

Adding a fact means a row in `FACTS` in `build.mjs`, the key in `FACT_KEYS` in `app.js`,
and the two `setText(facts.<key>…)` lines in `paint()`; the verifier names whichever of
the three is missing.

The page is finished by the browser, so look at it after a change: serve the build and
open it in more than one locale and zone. The cases that have gone wrong before are an
`en-US@posix` locale tag, `Asia/Kolkata`, and zones at a quarter hour such as
`Asia/Kathmandu` and `Pacific/Chatham`.
