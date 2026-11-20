#!/usr/bin/env node
/* Post-build checks. Exiting non-zero here blocks the deploy.
 *
 * The build renders the whole collection, so most of what can go wrong is a
 * mismatch between the data, the markup and the script: an entry that never
 * reached the page, a spine linking to a row that is not there, a chip whose
 * count is not what choosing it shows, a control the script reads that the
 * page does not render. Those are checked here from the *built* files, with
 * the rules imported from the built copy of shelf.js. The multi-site build
 * adds the checks every site shares and stamps asset URLs afterwards. */
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

for (const f of ['index.html', 'app.js', 'shelf.js', 'styles.css']) {
  check(fs.existsSync(path.join(dist, f)), `missing dist/${f}`);
}
report();

const html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(dist, 'app.js'), 'utf8');
const data = JSON.parse(fs.readFileSync(path.join(root, 'data/data.json'), 'utf8'));
const unesc = s => s.replace(/&(amp|lt|gt|quot|#39);/g, (_, e) =>
  ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" }[e]));

check(/<title>[^<]+<\/title>/.test(html), 'missing <title>');
/* Visible text only: the inline JSON may hold any word, and a title is free
   to contain one of these too, so a leak is only reported when the data has
   no entry that says it. */
const text = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ');
const said = JSON.stringify(data);
const leak = [...text.matchAll(/\bundefined\b|\bNaN\b|\[object Object\]/g)].find(m => !said.includes(m[0]));
check(!leak, leak && `page shows "${leak[0]}" near: ${text.slice(Math.max(0, leak.index - 40), leak.index + 40).replace(/\s+/g, ' ')}`);
check(!/=\s*(["'])(?:undefined|null|NaN)\1/.test(html), 'an attribute is literally undefined/null/NaN');
check(!/--[\w-]+:\s*(?:undefined|null|NaN)\b/.test(html), 'a spine style carries undefined/null/NaN');
/* The only date on the page is the day the collection last changed, from the
   data. A build time would move every day the deploy runs and mean nothing. */
check(!/\d{4}-\d\d-\d\dT\d\d:\d\d/.test(html), 'a build timestamp is baked into the page');
check(html.includes(`Last updated <time datetime="${data.updated}">`), 'the page does not say when it was last updated, from the data');
const shownDate = /<time datetime="[^"]*">([^<]*)<\/time>/.exec(html);
check(shownDate && !Number.isNaN(Date.parse(`${shownDate[1]} UTC`))
  && new Date(`${shownDate[1]} UTC`).toISOString().slice(0, 10) === data.updated,
  `the date shown ("${shownDate?.[1]}") is not the date in the data (${data.updated})`);
check(/href="\.\/styles\.css"/.test(html), 'stylesheet not linked relatively');
check(/<script type="module" src="\.\/app\.js">/.test(html), 'app.js not linked relatively as a module');
check(/href="\.\.\/"/.test(html), 'no link back to the index of sites');

for (const f of ['app.js', 'shelf.js']) {
  try {
    execFileSync(process.execPath, ['--check', path.join(dist, f)], { stdio: 'pipe' });
  } catch (e) {
    fails.push(`${f} does not parse: ${String(e.stderr || e.message).trim().split('\n')[0]}`);
  }
}
check(/from '\.\/shelf\.js'/.test(app), 'app.js does not import ./shelf.js relatively');

/* Every element and every named control the script reaches for is rendered. */
const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]);   // \s: data-id is not an id
check(new Set(ids).size === ids.length, `an id is used twice: ${ids.filter((id, i) => ids.indexOf(id) !== i).join(', ')}`);
const wanted = [...app.matchAll(/\$\('([^']+)'\)/g)].map(m => m[1]);
check(wanted.length >= 5, `only ${wanted.length} element lookups found in app.js — did it change shape?`);
for (const id of wanted) check(ids.includes(id), `app.js looks up #${id}, which the page never renders`);
const named = [...app.matchAll(/\.elements\.(\w+)/g)].map(m => m[1]);
check(named.length >= 2, 'app.js no longer reads the controls by name — did it change shape?');
for (const n of named) check(html.includes(`name="${n}"`), `app.js reads the control "${n}", which the page never renders`);

/* The collection itself: every entry in the data is a spine and a row, once,
   and each spine links to its own row. */
const spines = [...html.matchAll(/<a class="spine[^"]*" href="#(d-[^"]+)" data-id="([^"]+)"/g)];
const rowIds = [...html.matchAll(/<li class="disc" id="(d-[^"]+)" data-id="([^"]+)"/g)];
const titles = [...html.matchAll(/<h3>([^<]*)<\/h3>/g)].map(m => unesc(m[1]));
check(data.discs.length > 0, 'the data lists no discs');
check(spines.length === data.discs.length, `${spines.length} spines drawn for ${data.discs.length} entries`);
check(rowIds.length === data.discs.length, `${rowIds.length} rows listed for ${data.discs.length} entries`);
for (const [, href, id] of spines) {
  check(href === `d-${id}`, `the spine for ${id} links to #${href}`);
  check(rowIds.some(r => r[1] === href), `the spine for ${id} links to a row that is not on the page`);
}
check(spines.map(m => m[2]).join() === data.discs.map(d => d.id).join(), 'the spines are not in the order of the data');
for (const d of data.discs) check(titles.includes(d.title), `"${d.title}" is in the data but not in the list`);

/* The inline entries, and the rules run on them from the built copy. */
let inline = null;
const inlineMatch = html.match(/<script id="discs" type="application\/json">([\s\S]*?)<\/script>/);
check(!!inlineMatch, 'inline disc list missing');
if (inlineMatch) {
  try { inline = JSON.parse(inlineMatch[1]); } catch { fails.push('inline disc list is not valid JSON'); }
}
report();

const shelf = await import(pathToFileURL(path.join(dist, 'shelf.js')).href);
check(shelf.problems(data.discs).length === 0, `the data has problems: ${shelf.problems(data.discs)[0]}`);
check(inline.length === data.discs.length, 'the inline disc list is not the whole collection');
check(shelf.arrange(inline).map(d => d.id).join() === rowIds.map(m => m[2]).join(),
  'the rows are not rendered in the order arrange() gives by default');

/* A chip's count is what choosing it shows, and every chip and order offered
   is one the rules know. */
const chips = [...html.matchAll(/<input type="radio" name="show" value="([^"]+)"( checked)?><span>[^<]*<b>(\d+)<\/b>/g)];
check(chips.length >= 2 && chips[0][1] === 'all' && !!chips[0][2], 'the chips do not start on a checked Everything');
for (const [, id, , n] of chips) {
  check(shelf.SHOWS.some(s => s.id === id), `the page offers a chip "${id}" the rules do not know`);
  const shown = shelf.arrange(inline, { show: id }).length;
  check(shown === Number(n), `the "${id}" chip says ${n} but choosing it shows ${shown}`);
}
const select = html.match(/<select name="sort"[^>]*>([\s\S]*?)<\/select>/);
const sorts = select ? [...select[1].matchAll(/<option value="([^"]+)"/g)].map(m => m[1]) : [];
check(sorts.join() === shelf.SORTS.map(s => s.id).join(), 'the order menu does not offer exactly the orders the rules know');
for (const id of sorts) {
  check(shelf.arrange(inline, { sort: id }).length === inline.length, `ordering by "${id}" loses entries`);
}
const sum = shelf.summarize(inline);
check(text.includes(`The shelf holds ${sum.total} title`), 'the opening line does not state the size of the collection');

report();
console.log(`Build verified (${data.discs.length} discs, ${chips.length} chips, ${sorts.length} orders).`);
