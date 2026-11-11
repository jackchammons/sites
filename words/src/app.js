/* Word Counter — fills the proof-mark slots from the text box as the viewer
   types. All the counting lives in count.js; this file only wires the DOM. */
import { analyze, formatDuration } from './count.js';

const $ = id => document.getElementById(id);
const config = JSON.parse($('config').textContent);

const ta = $('text');
const status = $('status');
const freq = $('freq');

const SLOTS = {
  words: 's-words', chars: 's-chars', charsNoSpace: 's-chars-ns', letters: 's-letters',
  digits: 's-digits', punctuation: 's-punct', lines: 's-lines', nonEmptyLines: 's-lines-ne',
  sentences: 's-sentences', paragraphs: 's-paragraphs', unique: 's-unique',
};

const fmt = n => n.toLocaleString();

function render(s) {
  for (const [key, id] of Object.entries(SLOTS)) $(id).textContent = fmt(s[key]);
  $('s-avg-word').textContent = s.avgWordLength.toFixed(1);
  $('s-avg-sent').textContent = s.avgSentenceLength.toFixed(1);
  $('s-longest').textContent = s.longest || '—';
  $('s-read').textContent = formatDuration(s.readingMinutes);
  $('s-speak').textContent = formatDuration(s.speakingMinutes);

  freq.textContent = '';
  if (!s.top.length) {
    const e = document.createElement('div');
    e.className = 'freq-empty';
    e.textContent = s.words ? 'Only common words so far.' : 'Nothing to count yet.';
    freq.appendChild(e);
    return;
  }
  const max = s.top[0].count;
  for (const { word, count } of s.top) {
    const row = document.createElement('div'); row.className = 'freq-row';
    const w = document.createElement('span'); w.className = 'w'; w.textContent = word; w.title = word;
    const c = document.createElement('span'); c.className = 'c'; c.textContent = `×${count}`;
    const bar = document.createElement('span'); bar.className = 'bar';
    const fill = document.createElement('i'); fill.style.width = `${count / max * 100}%`;
    bar.appendChild(fill);
    row.append(w, c, bar);
    freq.appendChild(row);
  }
}

const update = () => render(analyze(ta.value, config));

/* The status line describes the sample or the last button press, so it goes as
   soon as the viewer edits the text it was describing. */
ta.addEventListener('input', () => { status.textContent = ''; update(); });

/* Replaces the text between two offsets through the browser's own editing
   command, which puts the change on the textarea's undo stack: Ctrl/Cmd+Z
   brings back whatever a button removed. Assigning .value wipes that stack, so
   it is only the fallback for a browser that refuses the command or applies it
   differently. The command fires an input event, which recounts. Returns
   whether the change can be undone. */
function replaceRange(text, start, end) {
  const before = ta.value;
  const want = before.slice(0, start) + text + before.slice(end);
  if (want === before) return false;
  ta.focus();
  ta.setSelectionRange(start, end);
  let done = false;
  try {
    done = document.execCommand(text ? 'insertText' : 'delete', false, text);
  } catch { done = false; }
  if (done && ta.value === want) return true;
  ta.value = want;
  ta.setSelectionRange(start + text.length, start + text.length);
  update();
  return false;
}
const undoHint = undoable => (undoable ? ' Ctrl+Z or Cmd+Z in the box undoes this.' : '');

$('clear-btn').addEventListener('click', () => {
  const undoable = replaceRange('', 0, ta.value.length);
  ta.focus();
  status.textContent = 'Cleared.' + undoHint(undoable);
});
/* Load sample and Paste hand the focus back to the button: leaving it in the
   box would raise a phone's keyboard over the figures the viewer asked for. */
$('sample-btn').addEventListener('click', e => {
  const undoable = replaceRange(config.sample.text, 0, ta.value.length);
  e.currentTarget.focus();
  status.textContent = `Sample loaded: ${config.sample.label}.` + undoHint(undoable);
});
$('paste-btn').addEventListener('click', e => {
  const btn = e.currentTarget;
  const manual = () => {
    status.textContent = 'Click in the box and paste with Ctrl+V or Cmd+V.'; ta.focus();
  };
  if (!(navigator.clipboard && navigator.clipboard.readText)) { manual(); return; }
  navigator.clipboard.readText().then(clip => {
    // A textarea stores line breaks as \n, so the comparison in replaceRange needs them that way.
    const text = clip.replace(/\r\n?/g, '\n');
    if (!text) { status.textContent = 'The clipboard holds no text to paste.'; return; }
    /* The untouched sample is a placeholder, so a paste replaces it. Anything
       else is the viewer's own text: the paste goes in at the caret, over the
       selection if there is one, as Ctrl+V would. */
    const isSample = ta.value === config.sample.text;
    const undoable = replaceRange(text,
      isSample ? 0 : ta.selectionStart, isSample ? ta.value.length : ta.selectionEnd);
    btn.focus();
    status.textContent = 'Pasted from clipboard.' + undoHint(undoable);
  }, manual);
});

/* Open with the sample so the page shows what it does, unless the box already
   holds the viewer's own text. */
if (!ta.value) {
  ta.value = config.sample.text;
  status.textContent = 'Showing a sample passage. Clear it or start typing to count your own text.';
}
update();

/* A browser that restores the viewer's text after a reload or a trip through
   history may do it once this script has run, and fires no input event when it
   does: the box changes under figures that still describe the sample. pageshow
   comes after the restore, so count again there and drop the sample notice if
   the text is no longer the sample. */
window.addEventListener('pageshow', () => {
  if (ta.value !== config.sample.text) status.textContent = '';
  update();
});
