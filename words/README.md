# Word Counter

At `/words/`: **[sites.jackhammons.com/words/](https://sites.jackhammons.com/words/)**

A text box beside a column of figures that update as you type: words, characters (with
and without spaces), letters, digits, punctuation, lines, sentences, paragraphs, unique
words, average word and sentence length, the longest word, reading and speaking time,
and the six words used most. The page opens on a sample passage so it is not blank.
Nothing is sent anywhere and the page saves nothing: no storage, no draft kept between
visits.

## How it is put together

```
data/data.json          page copy, the sample passage, the two rates, the footer note
src/count.js            the counting rules: pure functions, no DOM
src/app.js              the live half: reads the box, fills the slots, the three buttons
src/styles.css
scripts/build.mjs       renders the shell of slots into OUT_DIR, copies src/
scripts/verify.mjs      deploy gate: slot seam, and the rules run from the built copy
test/count.test.mjs     the rules (node --test)
test/browser-check.mjs  the page in Chromium (dev box, Playwright)
```

Nothing is counted at build time. `scripts/build.mjs` emits the text box, an empty
labelled slot for every figure, and the sample passage and rates as inline JSON;
`src/app.js` fills the slots from the box on every `input` event. The page is the same
bytes on every build, with no build date in it, and `verify.mjs` fails a build that
bakes a timestamp in.

`src/count.js` is the one implementation of the rules. `app.js`, the unit tests and
`verify.mjs` all import it, the verifier from the *built* copy. Don't fork it.

## The counting rules

These live in `src/count.js`, and the page footer restates them in plain words from
`note` in `data/data.json`. **Change a rule and the note changes with it, in the same
voice.**

- **Word.** A run of letters and digits. A combining mark belongs to the letter it
  follows, so Devanagari vowel signs, Arabic harakat, Hebrew niqqud and a decomposed
  accent (`e` + U+0301) never split a word. An apostrophe (`'` or `’`) or a hyphen (`-`,
  U+2010, U+2011) joins the runs on either side of it: `it's` and `well-known` are one
  word each. A `.` or `,` with a digit on both sides joins too: `1,234.56`, `3.14` and
  `v1.2.3` are one word each, while `a.b` and `No.5` are two. An en or em dash, a slash
  and every other mark separate words, so a URL or an email address is several.
- **Sentence.** Ends at `.` `!` `?` `…` `।` or `؟` when a space, a line break or the end
  of the text follows, with any closing quotes or brackets allowed in between (`"Go."`,
  `(See below.)`). `。` `！` `？` end one wherever they fall, since Chinese and Japanese
  put no space after them. A terminator with no letter or digit since the previous one
  is not a sentence (`!!!` and `. . .` count nothing), and a last fragment with no
  terminator still counts as one. There is deliberately no abbreviation list: `Dr.
  Smith` ends a sentence at the period and `1. First item` is two. The footer says so
  instead of guessing.
- **Paragraph.** A non-blank block, separated from the next by a blank line.
- **Line.** Newline-separated; an empty text has no lines.
- **Character.** A code point, not a UTF-16 unit, so `é` and `👋` count once. A
  decomposed accent or a joined emoji sequence is several. Letters, digits and
  punctuation are the Unicode classes `L`, `N` and `P`.
- **Unique and most-used words.** Compared with case folded and `’` read as `'`, so
  `It’s` and `it's` are one word. The most-used list leaves out `STOP_WORDS` and
  single-character words, shows six, and breaks ties alphabetically.
- **Reading and speaking time.** Words divided by `readingWpm` and `speakingWpm` from
  `data/data.json` (238 and 150), rounded to the second.

Not attempted: segmenting scripts written without spaces (a run of Chinese, Japanese or
Thai between punctuation is one word), counting characters as grapheme clusters, and
treating a URL or email address as one word.

## The slot seam

The figures column is rendered from the `MARKS` list in `scripts/build.mjs`: section,
then `[id, label]` pairs. Every `s-*` id there must be one `app.js` writes to (its
`SLOTS` map, or a literal `$('s-…')`), and every id `app.js` looks up must be in the
markup. `verify.mjs` checks both directions from the built files, because a miss either
way breaks only the browser: a slot that shows a dash for ever, or a script that throws
on its first keystroke. Adding a figure means a line in `MARKS`, a value from
`analyze()` in `count.js`, and a write in `app.js`.

## How the page behaves

- **The counts always describe the text in the box.** A browser may put the viewer's
  text back after a trip through history once the script has run, with no `input` event,
  so `app.js` recounts on `pageshow`. The status line under the box is cleared on any
  edit, and on `pageshow` when the text is not the sample.
- **The three buttons can be undone.** Clear, Load sample and Paste change the text
  through `document.execCommand`, which keeps the box's own undo history, so Ctrl/Cmd+Z
  brings back what a button removed. Assigning `.value` wipes that history and is only
  the fallback when the command is refused; the status line mentions undo only when it
  is available. Paste inserts at the caret, over the selection if there is one. The one
  exception is the untouched sample, which a paste replaces whole.
- **No text can widen the page.** The longest word wraps inside its row and the
  most-used words are cut with an ellipsis (the full word is in the `title`).
- **Under 760px** the layout is one column and the word count is a slim bar pinned to
  the top of the screen above a shorter box, so it stays in view above a phone's
  keyboard. The two-column layout above that width is separate CSS and does not move.

## Working on it

```bash
node --test words/test/*.test.mjs                                # the rules, no browser
node words/scripts/build.mjs && node words/scripts/verify.mjs    # -> dist/words/
node words/test/browser-check.mjs                                # the page itself, in Chromium
```

A standalone build writes `dist/words/`, where the multi-site build puts it; `OUT_DIR`
overrides that for all three scripts. The build refuses to clear a directory that holds
anything but a previous build.

`verify.mjs` cannot see layout or behaviour, and that is where this page's faults have
been. `browser-check.mjs` drives the built page for them: the history restore, undo
after each button, paste at the caret, long words at 320, 390, 768 and 1280 px in both
colour schemes, and the pinned count on a phone. It needs Playwright, so it runs on the
dev box and not in CI. Run it after touching `app.js` or `styles.css`.

Assets are referenced as plain relative paths (`./app.js`, `./styles.css`, `from
'./count.js'`). The multi-site build stamps them with a content hash after `verify.mjs`
has run, so nothing here adds a version of its own.
