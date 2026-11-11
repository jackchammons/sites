#!/usr/bin/env node
/* Post-build checks. Exiting non-zero here blocks the deploy.
 *
 * The page is a shell of empty slots until app.js runs, so a build can be
 * complete and still show dashes forever. The checks here cover the seams a
 * build never exercises: the scripts parse, every element app.js looks up is
 * in the markup, the assets are linked relatively (the site lives under
 * /words/), the inline config is valid JSON, and the counting rules in the
 * *built* copy of count.js give the right answers on known text. */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = process.env.OUT_DIR
  ? path.resolve(process.env.OUT_DIR)
  : path.join(root, '..', 'dist', path.basename(root));

const fails = [];
const check = (ok, msg) => { if (!ok) fails.push(msg); };
const report = () => {
  if (!fails.length) return;
  console.error('Build verification FAILED:');
  for (const f of fails) console.error('  ✗ ' + f);
  process.exit(1);
};

for (const f of ['index.html', 'app.js', 'count.js', 'styles.css', '.nojekyll']) {
  check(fs.existsSync(path.join(dist, f)), `missing dist/${f}`);
}
report();

const html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(dist, 'app.js'), 'utf8');

check(html.length > 3000, `index.html suspiciously small (${html.length} bytes)`);
check(/<title>[^<]+<\/title>/.test(html), 'missing <title>');
/* Visible text only: the inline config and the sample passage are free to
   contain any word, and JSON cannot carry undefined or NaN anyway. */
const text = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ');
const leak = /\bundefined\b|\bNaN\b|\[object Object\]/.exec(text);
check(!leak, leak && `page shows "${leak[0]}" near: ${text.slice(Math.max(0, leak.index - 40), leak.index + 40).replace(/\s+/g, ' ')}`);
check(!/=\s*(["'])(?:undefined|null|NaN)\1/.test(html), 'an attribute is literally undefined/null/NaN');
/* Everything on the page is live, so a deploy with no change of content should
   leave index.html byte for byte the same. */
check(!/\d{4}-\d\d-\d\dT\d\d:\d\d/.test(html), 'a build timestamp is baked into the page');
check(/href="\.\/styles\.css"/.test(html), 'stylesheet not linked relatively');
check(/<script type="module" src="\.\/app\.js">/.test(html), 'app.js not linked relatively as a module');
for (const m of html.matchAll(/(?:href|src)="(\/[^/][^"]*)"/g)) {
  fails.push(`root-relative asset "${m[1]}" will 404 under /words/`);
}

for (const f of ['app.js', 'count.js']) {
  try {
    execFileSync(process.execPath, ['--check', path.join(dist, f)], { stdio: 'pipe' });
  } catch (e) {
    fails.push(`${f} does not parse: ${String(e.stderr || e.message).trim().split('\n')[0]}`);
  }
}
check(/from '\.\/count\.js'/.test(app), 'app.js does not import ./count.js relatively');

/* Every getElementById the script makes with a literal must find something,
   including the slot ids in its SLOTS map. */
const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]));
const wanted = new Set([
  ...[...app.matchAll(/\$\('([^']+)'\)/g)].map(m => m[1]),
  ...[...app.matchAll(/:\s*'(s-[a-z-]+)'/g)].map(m => m[1]),
]);
check(wanted.size >= 15, `only ${wanted.size} element lookups found in app.js — did it change shape?`);
for (const id of wanted) check(ids.has(id), `app.js looks up #${id}, which the page never renders`);
for (const id of ids) {
  if (id.startsWith('s-')) check(wanted.has(id), `slot #${id} is rendered but app.js never fills it`);
}

/* The inline config must parse and carry what app.js reads. */
const cfgMatch = html.match(/<script id="config" type="application\/json">([\s\S]*?)<\/script>/);
check(!!cfgMatch, 'inline config script missing');
let cfg = null;
if (cfgMatch) {
  try { cfg = JSON.parse(cfgMatch[1]); } catch { fails.push('inline config is not valid JSON'); }
}
if (cfg) {
  check(typeof cfg.readingWpm === 'number' && cfg.readingWpm > 0, 'config.readingWpm missing');
  check(typeof cfg.speakingWpm === 'number' && cfg.speakingWpm > 0, 'config.speakingWpm missing');
  check(cfg.sample && typeof cfg.sample.text === 'string' && cfg.sample.text.length > 100, 'config.sample.text missing or short');
  check(html.includes(`(${cfg.readingWpm} wpm)`), 'reading-rate label does not match the config');
}

/* The rules, run from the built copy. */
const count = await import(pathToFileURL(path.join(dist, 'count.js')).href);
const s = count.analyze("Hello world! It's a well-known test.\n\nSecond para here, with 12 digits.\nThird line");
const expect = {
  words: 14, chars: 82, charsNoSpace: 68, letters: 60, digits: 2, punctuation: 6,
  lines: 4, nonEmptyLines: 3, sentences: 4, paragraphs: 2, unique: 14, longest: 'well-known',
};
for (const [k, v] of Object.entries(expect)) {
  check(s[k] === v, `analyze().${k}: expected ${JSON.stringify(v)}, got ${JSON.stringify(s[k])}`);
}
/* The rules a Latin-only text never reaches: marks that belong to their letter,
   a number with separators, curly apostrophes, a quoted sentence end, a danda. */
const hard = count.analyze('नमस्ते दुनिया। It’s 1,234.56 “today.” It\'s cafe\u0301 time');
const expectHard = { words: 8, sentences: 3, unique: 7, digits: 6, longest: '1,234.56' };
for (const [k, v] of Object.entries(expectHard)) {
  check(hard[k] === v, `analyze() on mixed scripts, ${k}: expected ${JSON.stringify(v)}, got ${JSON.stringify(hard[k])}`);
}
check(count.countSentences('. . . !!!') === 0, 'bare punctuation counts as a sentence');
const empty = count.analyze('');
check(empty.words === 0 && empty.lines === 0 && empty.sentences === 0 && empty.top.length === 0,
  'analyze("") is not all zeros');
check(count.formatDuration(0) === '0s' && count.formatDuration(1.5) === '1m 30s' && count.formatDuration(125) === '2h 05m',
  'formatDuration gives unexpected output');
if (cfg) {
  const sample = count.analyze(cfg.sample.text, cfg);
  check(sample.words > 100 && sample.paragraphs === 3, `sample passage counts look wrong: ${sample.words} words, ${sample.paragraphs} paragraphs`);
}

report();
console.log(`Build verified (${wanted.size} live slots, rules pass on known text).`);
