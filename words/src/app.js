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
    const w = document.createElement('span'); w.className = 'w'; w.textContent = word;
    const c = document.createElement('span'); c.className = 'c'; c.textContent = `×${count}`;
    const bar = document.createElement('span'); bar.className = 'bar';
    const fill = document.createElement('i'); fill.style.width = `${count / max * 100}%`;
    bar.appendChild(fill);
    row.append(w, c, bar);
    freq.appendChild(row);
  }
}

const update = () => render(analyze(ta.value, config));

ta.addEventListener('input', update);
$('clear-btn').addEventListener('click', () => {
  ta.value = ''; update(); ta.focus(); status.textContent = 'Cleared.';
});
$('sample-btn').addEventListener('click', () => {
  ta.value = config.sample.text; update();
  status.textContent = `Sample loaded: ${config.sample.label}.`;
});
$('paste-btn').addEventListener('click', () => {
  const fallback = () => {
    status.textContent = 'Click in the box and paste with Ctrl+V or Cmd+V.'; ta.focus();
  };
  if (navigator.clipboard && navigator.clipboard.readText) {
    navigator.clipboard.readText()
      .then(t => { ta.value = t; update(); status.textContent = 'Pasted from clipboard.'; })
      .catch(fallback);
  } else fallback();
});

/* Open with the sample so the page shows what it does; the browser may have
   restored the viewer's own text on reload, which takes precedence. */
if (!ta.value) {
  ta.value = config.sample.text;
  status.textContent = 'Showing a sample passage. Clear it or start typing to count your own text.';
}
update();
