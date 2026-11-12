import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateResearch, isNonCriticism, isOwnAccount, isOwnPage, registrableName, CAPS, SKIPPED, MAX_LEN } from '../src/validate-research.js';
import { PER_PASS } from '../src/rules.js';

const NOW = Date.parse('2026-08-30T00:00:00Z');

const dataset = { restaurants: [
  { id: 'delancey', name: 'Delancey', status: 'open',
    locations: [{ neighborhood: 'Ballard', address: '1415 NW 70th St, Seattle, WA 98117' }],
    factors: { craft: { value: 9.6, setBy: 'agent' }, distinctiveness: { value: 8.6, setBy: 'agent' },
               critical: { value: 9.6, setBy: 'agent' } } },
  // Rated by hand at launch: the one kind of rating a proposal may replace.
  { id: 'launch-pie', name: 'Launch Pie', status: 'open', url: 'https://launchpie.example/',
    factors: { craft: { value: 9.3, setBy: 'editorial' }, distinctiveness: { value: 8.7, setBy: 'editorial' },
               critical: { value: 9.1, setBy: 'editorial' } } },
  { id: 'zeeks-pizza', name: 'Zeeks Pizza', status: 'open' },
  { id: 'roma-roma', name: 'Roma Roma', status: 'open' },
  { id: 'old-slice', name: 'Old Slice', status: 'closed',
    locations: [{ neighborhood: 'Fremont', address: '3601 Fremont Ave N, Seattle, WA 98103' }] },
  // The three ways a social account gets on file: beside a website, as the
  // only link an entry with no website has, and a Facebook page as that link.
  { id: 'gram-slice', name: 'Gram Slice', status: 'open', url: 'https://gramslice.example/',
    instagram: 'https://www.instagram.com/Gram.Slice_sea/' },
  { id: 'handle-only', name: 'Handle Only', status: 'open', url: 'https://www.instagram.com/handle_only/' },
  { id: 'booked-pie', name: 'Booked Pie', status: 'open', url: 'https://www.facebook.com/bookedpie/' }
] };

const run = doc => validateResearch(doc, dataset, NOW);
const passes = doc => { const { fails } = run(doc); assert.deepEqual(fails, []); };
const failsWith = (doc, snippet) => {
  const { fails } = run(doc);
  assert.ok(fails.some(f => f.includes(snippet)),
    `expected a failure containing "${snippet}", got: ${JSON.stringify(fails)}`);
};

const NOTE = 'a note comfortably long enough to pass every length check';

/* ---- per-record rejection ---- */
test('a bad record is dropped from accepted; the rest of the section survives', () => {
  const good = { id: 'delancey', status: 'open', note: 'confirmed on its site today', source: 'https://x.com/a' };
  const badRec = { id: 'delancey', status: 'open', note: 'confirmed on its site today', source: 'http://x.com/a' };
  const { fails, fatal, accepted } = run({ status: [good, badRec] });
  assert.equal(fatal, false);
  assert.equal(fails.length, 1);
  assert.deepEqual(accepted.status, [good]);
});

test('structural problems are fatal and accept nothing', () => {
  const over = run({ mentions: Array.from({ length: 41 }, () => ({})) });
  assert.equal(over.fatal, true);
  assert.deepEqual(over.accepted, {});
  assert.equal(run('nope').fatal, true);
});

/* ---- text hygiene ---- */
test('look-alike scripts and oversized text are refused', () => {
  failsWith({ directory: [{ name: 'Zeeks Pizz\u0430', status: 'open', neighborhood: 'X',
    note: NOTE, source: 'https://x.com/a' }] }, 'outside the Latin script');
  failsWith({ directory: [{ name: 'Fine Pizza', status: 'open', neighborhood: 'X',
    note: 'x'.repeat(601), source: 'https://x.com/a' }] }, 'longer than 600');
  // an accented Latin name is fine, and dedups against its plain spelling
  failsWith({ directory: [{ name: 'Z\u00e9eks Pizza', status: 'open', neighborhood: 'X',
    note: NOTE, source: 'https://x.com/a' }] }, 'already on file');
});

/* ---- status: closures need evidence ---- */
test('status: a closure citing a review site or listing is refused; news passes', () => {
  failsWith({ status: [{ id: 'delancey', status: 'closed', note: 'Yelp marks it closed.',
    source: 'https://www.yelp.com/biz/delancey-seattle' }] }, 'a closure needs');
  passes({ status: [{ id: 'delancey', status: 'closed', note: 'Eater reports the closure.',
    source: 'https://seattle.eater.com/closed', date: '2024-03-01' }] });
  passes({ status: [{ id: 'delancey', status: 'open', note: 'Yelp says open, site confirms',
    source: 'https://www.yelp.com/biz/delancey-seattle' }] });
});

const closure = (id, source) => ({ status: [{ id, status: 'closed', source,
  note: 'Its own account says the last day of service was Sunday.' }] });

test('status: a closure announced on the entry\'s own Instagram account passes', () => {
  // the profile itself, and anything under it
  passes(closure('gram-slice', 'https://www.instagram.com/gram.slice_sea/'));
  passes(closure('gram-slice', 'https://www.instagram.com/gram.slice_sea/p/DAbc123xyz/'));
  passes(closure('gram-slice', 'https://instagram.com/Gram.Slice_sea/reel/DAbc123xyz/?igsh=abc'));
  passes(closure('gram-slice', 'https://m.instagram.com/gram.slice_sea/p/DAbc123xyz/'));
  // an entry whose only link on file is its profile
  passes(closure('handle-only', 'https://www.instagram.com/handle_only/p/DAbc123xyz/'));
});

test('status: a closure on Instagram that names no account, or another one, is refused', () => {
  failsWith(closure('gram-slice', 'https://www.instagram.com/p/DAbc123xyz/'), 'a closure needs');
  failsWith(closure('gram-slice', 'https://www.instagram.com/reel/DAbc123xyz/'), 'a closure needs');
  failsWith(closure('gram-slice', 'https://www.instagram.com/stories/gram.slice_sea/3141592653/'), 'a closure needs');
  failsWith(closure('gram-slice', 'https://www.instagram.com/explore/tags/gramslice/'), 'a closure needs');
  // somebody else's account, a longer handle that only starts the same way,
  // and another entry's account
  failsWith(closure('gram-slice', 'https://www.instagram.com/seattlefoodfan/p/DAbc123xyz/'), 'a closure needs');
  failsWith(closure('gram-slice', 'https://www.instagram.com/gram.slice_sea_fans/'), 'a closure needs');
  failsWith(closure('gram-slice', 'https://www.instagram.com/handle_only/p/DAbc123xyz/'), 'a closure needs');
  // no account on file at all
  failsWith(closure('delancey', 'https://www.instagram.com/delanceyseattle/p/DAbc123xyz/'), 'a closure needs');
  // a look-alike host is not the platform, so it is never the entry's account
  const entry = dataset.restaurants.find(r => r.id === 'gram-slice');
  assert.equal(isOwnAccount('https://www.instagram.com/gram.slice_sea/', entry), true);
  assert.equal(isOwnAccount('https://www.instagram.co/gram.slice_sea/', entry), false);
  assert.equal(isOwnAccount('https://instagram.com.example/gram.slice_sea/', entry), false);
  failsWith(closure('gram-slice', 'https://www.instagram.co/gram.slice_sea/'), 'a closure needs');
  // the message says which URL shape would have counted
  failsWith(closure('gram-slice', 'https://www.instagram.com/p/DAbc123xyz/'), 'instagram.com/<handle>/p/<id>/');
});

test('status: a Facebook page on file counts the same way', () => {
  passes(closure('booked-pie', 'https://www.facebook.com/bookedpie'));
  passes(closure('booked-pie', 'https://www.facebook.com/bookedpie/posts/pfbid02abc'));
  passes(closure('booked-pie', 'https://m.facebook.com/BookedPie/posts/pfbid02abc'));
  failsWith(closure('booked-pie', 'https://www.facebook.com/permalink.php?story_fbid=1&id=2'), 'a closure needs');
  failsWith(closure('booked-pie', 'https://www.facebook.com/story.php?story_fbid=1&id=2'), 'a closure needs');
  failsWith(closure('booked-pie', 'https://www.facebook.com/groups/seattlepizza/posts/1/'), 'a closure needs');
  failsWith(closure('booked-pie', 'https://www.facebook.com/share/p/1AbCdEf/'), 'a closure needs');
  failsWith(closure('booked-pie', 'https://www.facebook.com/someoneelse/posts/pfbid02abc'), 'a closure needs');
  // the Instagram account of that name is not on file for this entry
  failsWith(closure('booked-pie', 'https://www.instagram.com/bookedpie/'), 'a closure needs');
  // a page addressed by number names no account, on file or cited
  assert.equal(isOwnAccount('https://www.facebook.com/profile.php?id=7',
    { url: 'https://www.facebook.com/profile.php?id=7' }), false);
});

test('status: the pizzeria\'s own website and any news page pass as before', () => {
  passes(closure('gram-slice', 'https://gramslice.example/goodbye'));
  passes(closure('gram-slice', 'https://www.capitolhillseattle.com/2026/08/gram-slice-closes/'));
});

test('status: review sites and aggregators are refused on any of their domains', () => {
  for (const source of ['https://www.yelp.com/biz/gram-slice-seattle', 'https://m.yelp.com/biz/gram-slice-seattle',
    'https://www.yelp.ca/biz/gram-slice-seattle', 'https://www.yelp.co.uk/biz/gram-slice-seattle',
    'https://www.tripadvisor.co.uk/Restaurant_Review-gram-slice', 'https://www.tripadvisor.com.au/Restaurant_Review-x',
    'https://maps.google.com/?cid=1', 'https://www.google.ca/maps/place/x', 'https://www.doordash.com/store/gram-slice',
    'https://order.toasttab.com/online/gram-slice', 'https://en.wikipedia.org/wiki/Gram_Slice']) {
    failsWith(closure('gram-slice', source), 'a closure needs');
  }
  // an own-account URL does not unlock an aggregator for the same entry
  failsWith(closure('handle-only', 'https://www.yelp.com/biz/handle-only-seattle'), 'a closure needs');
});

test('the non-criticism family is matched by registered name, not exact host', () => {
  assert.equal(registrableName('m.yelp.com'), 'yelp');
  assert.equal(registrableName('yelp.ca'), 'yelp');
  assert.equal(registrableName('www.yelp.co.uk'), 'yelp');
  assert.equal(registrableName('tripadvisor.com.au'), 'tripadvisor');
  assert.equal(registrableName('seattle.eater.com'), 'eater');
  assert.equal(registrableName('localhost'), '');
  // a name that merely contains one is a different site
  for (const u of ['https://www.yelpington.com/a', 'https://notyelp.com/a', 'https://yelp.example.com/a',
    'https://www.thestranger.com/a', 'https://seattle.eater.com/a', 'https://co.example/a']) {
    assert.equal(isNonCriticism(u), false, u);
  }
  // so a rating cannot rest on a country domain of a review site either
  failsWith(rating({ sources: ['https://www.yelp.ca/biz/roma-roma'] }), 'no source is published criticism');
});

/* ---- mentions: the 24-month window ---- */
test('mentions: accepted up to 24 months back, news only 180 days', () => {
  passes({ mentions: [{ id: 'roma-roma', title: 'An older but real review', url: 'https://x.com/r',
    source: 'Seattle Met', date: '2025-01-15', kind: 'mention' }] });
  failsWith({ mentions: [{ id: 'roma-roma', title: 'An ancient review', url: 'https://x.com/r',
    source: 'Seattle Met', date: '2023-01-15', kind: 'mention' }] }, 'older than 730');
});

/* ---- facts and ratingSkipped ---- */
test('facts: fill-gap records for opened and priceIndex', () => {
  passes({ facts: [{ id: 'delancey', opened: 2009, source: 'https://delancey.example/about' }] });
  passes({ facts: [{ id: 'delancey', priceIndex: 3, source: 'https://delancey.example/menu' }] });
  failsWith({ facts: [{ id: 'delancey', source: 'https://x.com' }] }, 'must carry at least one of opened, priceIndex, style, styleGroup, signature');
  failsWith({ facts: [{ id: 'delancey', opened: 1850, source: 'https://x.com' }] }, 'opened must be');
  failsWith({ facts: [{ id: 'delancey', priceIndex: 5, source: 'https://x.com' }] }, 'priceIndex must be 1-4');
  failsWith({ facts: [{ id: 'nope', opened: 2000, source: 'https://x.com' }] }, 'unknown restaurant id');
  failsWith({ facts: [{ id: 'delancey', opened: 2009 }] }, 'source is not a valid URL');
  failsWith({ facts: [{ id: 'delancey', opened: 2009, source: 'http://delancey.example/about' }] }, 'source must be https');
});

const described = over => ({ facts: [{ id: 'zeeks-pizza', style: 'Hand-tossed Northwest pies', styleGroup: 'Neighborhood',
  signature: 'The Tree Hugger, piled with vegetables', source: 'https://zeekspizza.example/menu', ...over }] });

test('facts: style, styleGroup and signature are accepted from the pizzeria\'s own pages or published coverage', () => {
  passes(described({}));
  passes(described({ opened: 1993, priceIndex: 2 }));
  passes(described({ source: 'https://www.seattlemet.com/eat-and-drink/zeeks-review' }));
  // one fact is a record
  for (const k of ['style', 'styleGroup', 'signature']) {
    passes({ facts: [{ id: 'zeeks-pizza', [k]: described({}).facts[0][k], source: 'https://zeekspizza.example/menu' }] });
  }
});

test('facts: each description is held to its own rule', () => {
  // style: the rule a discovery's style is held to
  failsWith(described({ style: 'x'.repeat(MAX_LEN.style + 1) }), `style is longer than ${MAX_LEN.style}`);
  failsWith(described({ style: 7 }), 'style missing');
  failsWith(described({ style: ' ' }), 'style missing or too short');
  // styleGroup: the rule a rating's styleGroup is held to
  failsWith(described({ styleGroup: 'NY' }), 'styleGroup must be a short label');
  failsWith(described({ styleGroup: 'A style group far too long to be a label' }), 'styleGroup must be a short label');
  failsWith(described({ styleGroup: 7 }), 'styleGroup must be a short label');
  assert.deepEqual(run(described({ styleGroup: 'NY' })).fails, run(rating({ styleGroup: 'NY' })).fails.map(f => f.replace('factorRatings', 'facts')));
  // signature: a short phrase, capped
  assert.equal(MAX_LEN.signature, 100);
  passes(described({ signature: 'x'.repeat(MAX_LEN.signature) }));
  failsWith(described({ signature: 'x'.repeat(MAX_LEN.signature + 1) }), `signature is longer than ${MAX_LEN.signature}`);
  failsWith(described({ signature: 'xy' }), 'signature missing or too short');
  failsWith(described({ signature: ['The Tree Hugger'] }), 'signature missing');
  failsWith(described({ signature: 'Пицца Маргарита' }), 'outside the Latin script');
  // a record that fails one rule is dropped whole, and only that record
  const { fails, accepted } = run({ facts: [described({ signature: 'xy' }).facts[0], { id: 'roma-roma', opened: 2024, source: 'https://romaroma.example/about' }] });
  assert.equal(fails.length, 1);
  assert.deepEqual(accepted.facts.map(f => f.id), ['roma-roma']);
});

test('facts: an aggregator, a delivery app or a social post is never the source of a description', () => {
  for (const source of ['https://www.yelp.com/biz/zeeks-pizza-seattle', 'https://www.doordash.com/store/zeeks-pizza-1',
    'https://www.tripadvisor.com/Restaurant_Review-zeeks', 'https://www.google.com/maps/place/Zeeks', 'https://www.yelp.ca/biz/zeeks',
    'https://www.instagram.com/seattlefoodfan/p/DAbc123xyz/', 'https://order.toasttab.com/online/some-other-pizzeria']) {
    for (const k of ['style', 'styleGroup', 'signature']) {
      const { fails, accepted } = run({ facts: [{ id: 'zeeks-pizza', [k]: described({}).facts[0][k], source }] });
      assert.equal(fails.length, 1, `${k} from ${source}`);
      assert.match(fails[0], new RegExp(`^facts\\[0\\]: ${k} must come from the pizzeria's own site or menu, or from published coverage, not `));
      assert.deepEqual(accepted.facts, []);
    }
  }
  failsWith(described({ source: 'https://www.yelp.com/biz/zeeks-pizza-seattle' }),
    "style, styleGroup, signature must come from the pizzeria's own site or menu, or from published coverage, not yelp.com");
  // the year and the tier are plain facts, and any https page may state them
  passes({ facts: [{ id: 'zeeks-pizza', opened: 1993, priceIndex: 2, source: 'https://www.yelp.com/biz/zeeks-pizza-seattle' }] });
  // but a description in the same record takes the record with it
  failsWith({ facts: [{ id: 'zeeks-pizza', opened: 1993, signature: 'The Tree Hugger', source: 'https://www.yelp.com/biz/zeeks-pizza-seattle' }] },
    'signature must come from');
});

test('facts: the web presence on file for an entry is its own page, whatever host it lives on', () => {
  // an entry filed under its Instagram profile, and one whose profile is on file beside its site
  passes({ facts: [{ id: 'handle-only', signature: 'The square pepperoni', source: 'https://www.instagram.com/handle_only/' }] });
  passes({ facts: [{ id: 'gram-slice', style: 'New York slices', source: 'https://www.instagram.com/gram.slice_sea/p/DAbc123xyz/' }] });
  passes({ facts: [{ id: 'booked-pie', signature: 'The white pie', source: 'https://www.facebook.com/bookedpie/posts/pfbid02abc' }] });
  failsWith({ facts: [{ id: 'gram-slice', style: 'New York slices', source: 'https://www.instagram.com/handle_only/' }] }, 'style must come from');
  // an entry filed under the ordering page it links as its own
  const toast = { id: 'toast-pie', name: 'Toast Pie', status: 'open', url: 'https://order.toasttab.com/online/toast-pie' };
  assert.equal(isOwnPage('https://order.toasttab.com/online/toast-pie', toast), true);
  assert.equal(isOwnPage('https://order.toasttab.com/online/toast-pie/menu', toast), true);
  assert.equal(isOwnPage('https://order.toasttab.com/online/toast-pie-two', toast), false);
  assert.equal(isOwnPage('https://order.toasttab.com/online/another-shop', toast), false);
  assert.equal(isOwnPage('https://www.toasttab.com/online/toast-pie', toast), false);
  // a host alone names every business on it, so it is nobody's own page
  assert.equal(isOwnPage('https://order.toasttab.com/online/another-shop', { ...toast, url: 'https://order.toasttab.com/' }), false);
  assert.equal(isOwnPage('https://order.toasttab.com/online/toast-pie', { id: 'no-url' }), false);
  const ds = { restaurants: [toast] };
  const from = source => validateResearch({ facts: [{ id: 'toast-pie', signature: 'The square pepperoni', source }] }, ds, NOW).fails;
  assert.deepEqual(from('https://order.toasttab.com/online/toast-pie/menu'), []);
  assert.match(from('https://order.toasttab.com/online/another-shop')[0], /signature must come from .* not order\.toasttab\.com/);
});

test('facts: an entry may have a record for each page, and no fact twice', () => {
  const about = { id: 'zeeks-pizza', opened: 1993, source: 'https://zeekspizza.example/about' };
  const menu = { id: 'zeeks-pizza', priceIndex: 2, signature: 'The Tree Hugger', source: 'https://zeekspizza.example/menu' };
  passes({ facts: [about, menu] });
  const { fails, accepted } = run({ facts: [about, menu, { id: 'zeeks-pizza', opened: 1994, style: 'Hand-tossed pies', source: 'https://www.seattlemet.com/zeeks' }] });
  assert.deepEqual(fails, ['facts[2]: opened already reported for "zeeks-pizza" by an earlier facts record']);
  assert.deepEqual(accepted.facts, [about, menu]);
  // a record that was refused does not hold its facts against a later good one
  const retry = run({ facts: [{ ...about, opened: 1850 }, about] });
  assert.equal(retry.fails.length, 1);
  assert.deepEqual(retry.accepted.facts, [about]);
  // the section holds three pages for every entry of a facts worklist, and past that the file is refused
  assert.equal(CAPS.facts, 3 * PER_PASS.facts);
  failsWith({ facts: Array.from({ length: CAPS.facts + 1 }, () => about) }, `exceeds the ${CAPS.facts} cap`);
});

test('ratingSkipped: records an attempt on an unrated entry or a launch rating, never on an agent rating', () => {
  passes({ ratingSkipped: [{ id: 'roma-roma', note: 'no published review found' }] });
  passes({ ratingSkipped: [{ id: 'launch-pie', note: 'no published review found' }] });
  failsWith({ ratingSkipped: [{ id: 'delancey', note: 'no published review found' }] }, 'already rated');
  // proposed and skipped in one file is a contradiction, for a launch rating as for an unrated entry
  for (const id of ['roma-roma', 'launch-pie']) {
    const { fails, accepted } = run({ ...rating({ id }), ratingSkipped: [{ id, note: 'no published review found' }] });
    assert.equal(fails.length, 1);
    assert.match(fails[0], /ratingSkipped\[0\]: .* is also proposed in factorRatings/);
    assert.deepEqual([accepted.factorRatings.length, accepted.ratingSkipped.length], [1, 0]);
  }
});

/* ---- locationsSkipped: the locations task's memory ---- */
test('locationsSkipped: an id on file and a note that says what was tried', () => {
  passes({ locationsSkipped: [{ id: 'zeeks-pizza', note: 'no official site found; only aggregator listings' }] });
  failsWith({ locationsSkipped: [{ id: 'nope', note: 'no official site found' }] }, 'unknown restaurant id');
  failsWith({ locationsSkipped: [{ id: 'zeeks-pizza', note: 'none' }] }, 'note missing or too short');
  failsWith({ locationsSkipped: [{ id: 'zeeks-pizza', note: 'x'.repeat(601) }] }, 'longer than 600');
});

/* ---- coverageSkipped, socialSkipped: the two backfills' memory ---- */
test('coverageSkipped and socialSkipped: an id on file and a note that says what was tried', () => {
  for (const sec of ['coverageSkipped', 'socialSkipped']) {
    passes({ [sec]: [{ id: 'zeeks-pizza', note: 'searched four outlets by name; nothing in two years' }] });
    // rated or not, open or closed: the record only rests a worklist entry
    passes({ [sec]: [{ id: 'delancey', note: 'searched four outlets by name; nothing new' }] });
    failsWith({ [sec]: [{ id: 'nope', note: 'searched four outlets by name' }] }, 'unknown restaurant id');
    failsWith({ [sec]: [{ id: 'zeeks-pizza', note: 'none' }] }, 'note missing or too short');
    failsWith({ [sec]: [{ id: 'zeeks-pizza', note: 'x'.repeat(601) }] }, 'longer than 600');
    failsWith({ [sec]: [{ id: 'zeeks-pizza' }] }, 'note missing or too short');
  }
});

/* ---- the `…Skipped` sections are attempt memory, and never cost the file ---- */
const SKIPPED_SECTIONS = ['ratingSkipped', 'locationsSkipped', 'factsSkipped', 'coverageSkipped', 'socialSkipped'];
/* Forty unrated entries, so every skipped section accepts a record for any of them. */
const field = { restaurants: Array.from({ length: 40 }, (_, i) => ({ id: `pie-${String(i).padStart(2, '0')}`, name: `Pie ${i}`, status: 'open' })) };
const skip = n => ({ id: `pie-${String(n).padStart(2, '0')}`, note: `searched four outlets by name for pie ${n}; nothing found` });
const mention = id => ({ id, title: 'A perfectly plausible headline', url: `https://x.com/${id}`, source: 'Seattle Met', date: '2026-08-15', kind: 'mention' });

test('skipped sections: each cap is read from rules.js, with room above the worklist it serves', () => {
  assert.deepEqual(Object.keys(SKIPPED).sort(), [...SKIPPED_SECTIONS].sort());
  for (const [sec, tasks] of Object.entries(SKIPPED)) {
    for (const t of tasks) {
      assert.ok(Number.isInteger(PER_PASS[t]), `${t} has a worklist size in rules.js`);
      assert.ok(CAPS[sec] > PER_PASS[t], `${sec} (${CAPS[sec]}) has room above the ${t} worklist (${PER_PASS[t]})`);
    }
    assert.equal(CAPS[sec], 2 * Math.max(...tasks.map(t => PER_PASS[t])), sec);
  }
  assert.deepEqual(SKIPPED, { ratingSkipped: ['rating', 'rerate'], locationsSkipped: ['locations'], factsSkipped: ['facts'],
    coverageSkipped: ['coverage'], socialSkipped: ['social'] });
});

test('skipped sections: 16 records for a worklist of 10 are accepted once each, and the file is applied', () => {
  // The pass that was lost: every worklist entry reported, six of them twice, beside the two mentions it found.
  const ten = Array.from({ length: 10 }, (_, i) => skip(i));
  const doc = { mentions: [mention('pie-00'), mention('pie-01')], coverageSkipped: [...ten, ...ten.slice(0, 6)] };
  assert.equal(doc.coverageSkipped.length, 16);
  const { fails, fatal, accepted } = validateResearch(doc, field, NOW);
  assert.equal(fatal, false);
  assert.deepEqual(accepted.coverageSkipped, ten);
  assert.deepEqual(accepted.mentions, doc.mentions);
  assert.deepEqual(fails, [10, 11, 12, 13, 14, 15].map(i =>
    `coverageSkipped[${i}]: "pie-0${i - 10}" is already reported in this section; the first record is kept`));
});

test('skipped sections: a repeated id collapses to its first record, in every one of them', () => {
  for (const sec of SKIPPED_SECTIONS) {
    const first = skip(3), second = { ...skip(3), note: 'a second note for the same entry, written later' };
    const { fails, fatal, accepted } = validateResearch({ [sec]: [first, skip(4), second, skip(3)] }, field, NOW);
    assert.equal(fatal, false, sec);
    assert.deepEqual(accepted[sec], [first, skip(4)], sec);
    assert.deepEqual(fails, [2, 3].map(i => `${sec}[${i}]: "pie-03" is already reported in this section; the first record is kept`), sec);
  }
});

test('skipped sections: records past the cap are dropped one by one, and nothing else in the file is lost', () => {
  for (const sec of SKIPPED_SECTIONS) {
    const cap = CAPS[sec];
    const doc = { mentions: [mention('pie-00')], [sec]: Array.from({ length: cap + 3 }, (_, i) => skip(i)) };
    const { fails, fatal, accepted } = validateResearch(doc, field, NOW);
    assert.equal(fatal, false, sec);
    assert.deepEqual(accepted[sec], doc[sec].slice(0, cap), sec);
    assert.deepEqual(accepted.mentions, doc.mentions, sec);
    assert.deepEqual(fails, [0, 1, 2].map(n => `${sec}[${cap + n}]: past the ${cap} records this section holds; `
      + `"${skip(cap + n).id}" is not recorded as attempted`), sec);
    // exactly at the cap nothing is dropped
    assert.deepEqual(validateResearch({ [sec]: doc[sec].slice(0, cap) }, field, NOW).fails, [], sec);
  }
});

test('skipped sections: a record that fails its own checks neither takes an id nor counts towards the cap', () => {
  const cap = CAPS.coverageSkipped;
  const good = Array.from({ length: cap }, (_, i) => skip(i));
  const { fails, accepted } = validateResearch({ coverageSkipped: [{ id: 'pie-00', note: 'none' }, { id: 'nope', note: 'searched four outlets by name' },
    ...good] }, field, NOW);
  assert.deepEqual(accepted.coverageSkipped, good);
  assert.equal(fails.length, 2);
  assert.match(fails[0], /coverageSkipped\[0\]: note missing or too short/);
  assert.match(fails[1], /coverageSkipped\[1\]: unknown restaurant id "nope"/);
});

test('skipped sections: a hundred repeats of one record are one record, not a refused file', () => {
  for (const sec of SKIPPED_SECTIONS) {
    const { fatal, accepted, fails } = validateResearch({ [sec]: Array.from({ length: 100 }, () => skip(7)) }, field, NOW);
    assert.equal(fatal, false, sec);
    assert.deepEqual(accepted[sec], [skip(7)], sec);
    assert.equal(fails.length, 99, sec);
  }
});

test('every other section\'s cap is still structural: one record over and the file is refused', () => {
  for (const sec of Object.keys(CAPS).filter(k => !SKIPPED_SECTIONS.includes(k))) {
    const over = validateResearch({ coverageSkipped: [skip(1)], [sec]: Array.from({ length: CAPS[sec] + 1 }, () => ({})) }, field, NOW);
    assert.equal(over.fatal, true, sec);
    assert.deepEqual(over.accepted, {}, sec);
    assert.deepEqual(over.fails, [`${sec}: ${CAPS[sec] + 1} entries exceeds the ${CAPS[sec]} cap`], sec);
  }
  // and a skipped section that is not a list is still a file nothing can be read from
  assert.equal(validateResearch({ coverageSkipped: { id: 'pie-01' } }, field, NOW).fatal, true);
});

test('socialSkipped may sit beside a links record for the part that was found', () => {
  const { fails, accepted } = run({
    links: [{ id: 'zeeks-pizza', website: 'https://zeekspizza.com', source: 'https://zeekspizza.com' }],
    socialSkipped: [{ id: 'zeeks-pizza', note: 'site found; it links no Instagram and no outlet names a handle' }] });
  assert.deepEqual(fails, []);
  assert.equal(accepted.links.length + accepted.socialSkipped.length, 2);
});

/* ---- locations: the address gate ---- */
const site = (addr, hood = 'Somewhere') => ({ neighborhood: hood, address: addr });
const loc = (...sites) => ({ locations: [{ id: 'zeeks-pizza', source: 'https://z.com/l', sites }] });

test('locations: real Puget Sound addresses pass, Mill Creek included', () => {
  passes(loc(site('15021 Main Street, Mill Creek, WA 98012')));
  passes(loc(site('764 Broadway, Tacoma, WA 98402')));
  passes(loc(site('111 Market St NE, Olympia, WA 98501')));
});

test('locations: out-of-region and malformed addresses fail', () => {
  failsWith(loc(site('801 W Riverside Ave, Spokane, WA 99201')), 'Puget Sound ZIP (980xx-985xx)');
  failsWith(loc(site('123 SE Main St, Portland, OR 97214')), 'not in Washington');
  failsWith(loc(site('Capitol Hill, Seattle, WA 98122')), 'street number');
  failsWith(loc(site('1415 NW 70th St, Seattle, WA')), 'Puget Sound ZIP');
});

test('locations: duplicate branches collide across punctuation', () => {
  failsWith(loc(site('1415 NW 70th St, Seattle, WA 98117'),
                site('1415 NW 70th St., Seattle WA 98117')), 'duplicate address');
});

test('locations: unknown id, http source, empty sites all fail', () => {
  failsWith({ locations: [{ id: 'nope', source: 'https://z.com', sites: [site('1 A St, Seattle, WA 98101')] }] }, 'unknown restaurant id');
  failsWith({ locations: [{ id: 'zeeks-pizza', source: 'http://z.com', sites: [site('1 A St, Seattle, WA 98101')] }] }, 'must be https');
  failsWith({ locations: [{ id: 'zeeks-pizza', source: 'https://z.com', sites: [] }] }, 'non-empty');
});

/* ---- directory: dedup against variant names ---- */
test('directory: a variant name cannot fork an existing entry', () => {
  failsWith({ directory: [{ name: 'Zeeks Pizza Co', status: 'open', neighborhood: 'X',
    note: NOTE, source: 'https://x.com/a' }] }, 'already on file');
  passes({ directory: [{ name: 'Totally New Pie', status: 'open', neighborhood: 'X',
    note: NOTE, source: 'https://x.com/a' }] });
});

const found = over => ({ name: 'Totally New Pie', status: 'open', neighborhood: 'Ballard',
  note: NOTE, source: 'https://x.com/a', ...over });

test('directory: the shared normName catches a leading article and an accent', () => {
  failsWith({ directory: [found({ name: 'The Delancey' })] }, 'already on file');
  failsWith({ directory: [found({ name: 'Delancey Pizzeria & Cafe' })] }, 'already on file');
  failsWith({ directory: [found({ name: 'ZEEKS PIZZA LLC' })] }, 'already on file');
});

test('directory: two spellings of one find in the same file collide', () => {
  const { fails, accepted } = run({ directory: [
    found({ name: 'Nonna Rosa Pizza' }), found({ name: 'Nonna Rosa Pizzeria' }), found({ name: 'Other Pie' })] });
  assert.equal(fails.length, 1);
  assert.match(fails[0], /directory\[1\]: "Nonna Rosa Pizzeria" repeats "Nonna Rosa Pizza" from earlier in this file/);
  assert.deepEqual(accepted.directory.map(d => d.name), ['Nonna Rosa Pizza', 'Other Pie']);
});

test('directory: a rejected record does not block a later good one of the same name', () => {
  const { accepted } = run({ directory: [
    found({ name: 'Nonna Rosa Pizza', source: 'http://x.com/a' }), found({ name: 'Nonna Rosa Pizzeria' })] });
  assert.deepEqual(accepted.directory.map(d => d.name), ['Nonna Rosa Pizzeria']);
});

test('directory: a street address already on file is refused, however it is written', () => {
  failsWith({ directory: [found({ name: 'Delancey Seattle Annex', address: '1415 N.W. 70th Street, Seattle, WA 98117' })] },
    'is already on file as Delancey');
  // same address twice in one file, under names the name rule cannot tie together
  failsWith({ directory: [
    found({ name: 'Corner Pie', address: '500 Pine St, Seattle, WA 98101' }),
    found({ name: 'Pine Street Slices', address: '500 Pine Street, Seattle, WA 98101' })] }, 'is already on file as Corner Pie');
  // the next pizzeria into a closed one's space is a new entry
  passes({ directory: [found({ address: '3601 Fremont Ave N, Seattle, WA 98103' })] });
  passes({ directory: [found({ address: '1417 NW 70th St, Seattle, WA 98117' })] });
});

test('directory: style is checked like the other free text', () => {
  passes({ directory: [found({ style: 'New York-style slices' })] });
  failsWith({ directory: [found({ style: 'x'.repeat(121) })] }, 'style is longer than 120');
  failsWith({ directory: [found({ style: 7 })] }, 'style missing');
});

/* ---- angle brackets: no free text or address carries markup ---- */
test('angle brackets are refused in every free-text field and in addresses', () => {
  const TAG = '<img src=x onerror=alert(1)>';
  const story = { title: 'A perfectly plausible headline', source: 'The Stranger',
    url: 'https://x.com/a', published: '2026-08-20', kind: 'mention' };
  const mention = { id: 'roma-roma', title: 'A perfectly plausible headline', url: 'https://x.com/r',
    source: 'Seattle Met', date: '2026-08-15', kind: 'mention' };
  const cases = {
    'news title': { news: [{ ...story, title: `Headline ${TAG}` }] },
    'news source': { news: [{ ...story, source: `Outlet ${TAG}` }] },
    'mention title': { mentions: [{ ...mention, title: `Headline ${TAG}` }] },
    'mention source': { mentions: [{ ...mention, source: `Outlet ${TAG}` }] },
    'location address': loc(site(`5918 Phinney Ave N ${TAG}, Seattle, WA 98103`)),
    'location neighborhood': loc(site('5918 Phinney Ave N, Seattle, WA 98103', `Phinney ${TAG}`)),
    'directory name': { directory: [found({ name: `Nonna ${TAG}` })] },
    'directory neighborhood': { directory: [found({ neighborhood: `Ballard ${TAG}` })] },
    'directory style': { directory: [found({ style: `Roman ${TAG}` })] },
    'directory note': { directory: [found({ note: `${NOTE} ${TAG}` })] },
    'directory address': { directory: [found({ address: `500 Pine St ${TAG}, Seattle, WA 98101` })] },
    'status note': { status: [{ id: 'delancey', status: 'open', note: `open ${TAG} today`, source: 'https://x.com/a' }] },
    'rating note': rating({ note: `${NOTE} ${TAG}` }),
    'rating styleGroup': rating({ styleGroup: '<b>Roman</b>' }),
    'facts style': { facts: [{ id: 'roma-roma', style: `Roman ${TAG}`, source: 'https://romaroma.example/menu' }] },
    'facts styleGroup': { facts: [{ id: 'roma-roma', styleGroup: '<b>Roman</b>', source: 'https://romaroma.example/menu' }] },
    'facts signature': { facts: [{ id: 'roma-roma', signature: `The potato slice ${TAG}`, source: 'https://romaroma.example/menu' }] },
    'ratingSkipped note': { ratingSkipped: [{ id: 'roma-roma', note: `nothing found ${TAG}` }] },
    'factsSkipped note': { factsSkipped: [{ id: 'roma-roma', note: `nothing found ${TAG}` }] },
    'locationsSkipped note': { locationsSkipped: [{ id: 'roma-roma', note: `nothing found ${TAG}` }] },
    'coverageSkipped note': { coverageSkipped: [{ id: 'roma-roma', note: `nothing found ${TAG}` }] },
    'socialSkipped note': { socialSkipped: [{ id: 'roma-roma', note: `nothing found ${TAG}` }] },
    'factorSources note': { factorSources: [{ id: 'delancey', sources: ['https://www.thestranger.com/a'], note: `${NOTE} ${TAG}` }] },
    'candidateReview note': { candidateReview: [{ name: 'Anything Pizza', verdict: 'closed', note: `gone ${TAG} for good` }] }
  };
  for (const [what, doc] of Object.entries(cases)) {
    const { fails, accepted } = run(doc);
    assert.ok(fails.some(f => f.includes('contains < or >')), `${what}: ${JSON.stringify(fails)}`);
    assert.deepEqual(Object.values(accepted).flat(), [], `${what}: the record was still accepted`);
  }
});

test('a URL is stored as written, so it must be a plain one', () => {
  const st = source => ({ status: [{ id: 'delancey', status: 'open', note: 'confirmed on its site', source }] });
  failsWith(st('https://x.com/a"><script>alert(1)</script>'), 'not a plain URL');
  failsWith(st('https://x.com/a b'), 'not a plain URL');
  failsWith(st(['https://x.com/a']), 'not a plain URL');
  failsWith(st('https://x.com/' + 'a'.repeat(2000)), 'not a plain URL');
  passes(st('https://news.google.com/rss/articles/' + 'C'.repeat(600) + '?oc=5'));
});

/* ---- length caps ---- */
test('every string the apply step stores is bounded', () => {
  const long = n => 'x'.repeat(n);
  const story = { title: 'A perfectly plausible headline', source: 'The Stranger',
    url: 'https://x.com/a', published: '2026-08-20', kind: 'mention' };
  failsWith({ news: [{ ...story, source: long(81) }] }, 'source is longer than 80');
  failsWith({ mentions: [{ id: 'roma-roma', title: 'A perfectly plausible headline', url: 'https://x.com/r',
    source: long(81), date: '2026-08-15', kind: 'mention' }] }, 'source name is longer than 80');
  failsWith(loc(site(`1 ${long(200)} St, Seattle, WA 98101`)), 'address is longer than 200');
  failsWith(loc(site('1 A St, Seattle, WA 98101', long(81))), 'neighborhood is longer than 80');
  failsWith({ candidateReview: [{ name: 'Anything Pizza', verdict: 'closed', note: long(601) }] }, 'note is longer than 600');
  // a refused value is quoted in the message, and the message is bounded too
  const { fails } = run({ status: [{ id: long(250000), status: 'open', note: 'confirmed on its site', source: 'https://x.com/a' }] });
  assert.ok(fails.every(f => f.length <= 301), `longest message: ${Math.max(...fails.map(f => f.length))}`);
});

/* ---- unknown top-level keys ---- */
test('a misspelt section is reported, never applied, and never fatal', () => {
  const good = { id: 'delancey', status: 'open', note: 'confirmed on its site today', source: 'https://x.com/a' };
  const { fails, fatal, accepted, unknown } = run({ updated: '2026-08-30T00:00:00Z',
    statuses: [good], factorRating: [{}], closure: 'x', status: [good] });
  assert.equal(fatal, false);
  assert.deepEqual(fails, []);
  assert.deepEqual(unknown, ['statuses', 'factorRating', 'closure']);
  assert.deepEqual(accepted.status, [good]);
  assert.ok(!('statuses' in accepted) && !('factorRating' in accepted));
});

test('the keys the gate itself writes, and the legacy ones, are not unknown', () => {
  assert.deepEqual(run({ updated: 'x', rejected: [], ignored: [], items: [], ratings: [],
    candidates: [], closures: [], factors: [] }).unknown, []);
});

/* ---- news ---- */
test('news: dates must be real, recent and not future', () => {
  const item = over => ({ news: [{ title: 'A perfectly plausible headline', source: 'The Stranger',
    url: 'https://x.com/a', published: '2026-08-20', kind: 'mention', ...over }] });
  passes(item({}));
  failsWith(item({ published: '2027-01-01' }), 'future');
  failsWith(item({ published: '2025-01-01' }), 'older than');
  failsWith(item({ kind: 'scandal' }), 'kind must be one of');
});

test('news: a malformed mentions field costs that record, not the run', () => {
  const item = over => ({ title: 'A perfectly plausible headline', source: 'The Stranger',
    url: 'https://x.com/a', published: '2026-08-20', kind: 'mention', ...over });
  for (const mentions of [5, 'delancey', { id: 'delancey' }, true]) {
    const { fails, fatal, accepted } = run({ news: [item({ mentions }), item({ url: 'https://x.com/b', mentions: ['delancey'] })] });
    assert.equal(fatal, false);
    assert.match(fails[0], /news\[0\]: mentions must be an array/);
    assert.equal(accepted.news.length, 1);
  }
  failsWith({ news: [item({ mentions: ['nope'] })] }, 'mentions unknown id');
  failsWith({ news: [item({ mentions: Array.from({ length: 41 }, () => 'delancey') })] }, 'at most 40');
  passes({ news: [item({ mentions: null })] });
});

/* ---- factorRatings: the gate into the ladder ---- */
const rating = over => ({ factorRatings: [{ id: 'roma-roma', craft: 7.5, distinctiveness: 7,
  criticScore: 7.5, sources: ['https://x.com/review'], note: NOTE, ...over }] });

test('factorRatings: a grounded proposal for an unrated entry passes', () => {
  passes(rating({ opened: 2024, priceIndex: 2, styleGroup: 'Roman' }));
});

test('factorRatings: sources must include published criticism', () => {
  failsWith(rating({ sources: ['https://www.yelp.com/biz/roma-roma'] }), 'no source is published criticism');
  failsWith(rating({ sources: ['https://en.wikipedia.org/wiki/Roma_Roma', 'https://www.instagram.com/romaroma/'] }), 'no source is published criticism');
  passes(rating({ sources: ['https://www.yelp.com/biz/roma-roma', 'https://seattlemet.com/review'] }));
});

test('factorRatings: a launch rating may be replaced, under every rule a first rating is held to', () => {
  const launch = over => rating({ id: 'launch-pie', ...over });
  passes(launch({}));
  assert.equal(run(launch({})).accepted.factorRatings[0].id, 'launch-pie');
  passes(launch({ opened: 2012, priceIndex: 3, styleGroup: 'Neapolitan' }));
  failsWith(launch({ craft: 7.3 }), '0.5 steps');
  failsWith(launch({ criticScore: 11 }), 'criticScore');
  failsWith(launch({ sources: [] }), 'sources');
  failsWith(launch({ sources: ['https://www.yelp.com/biz/launch-pie'] }), 'no source is published criticism');
  // its own site is not criticism of it
  failsWith(launch({ sources: ['https://launchpie.example/press'] }), 'no source is published criticism');
  failsWith(launch({ note: 'too short' }), 'note missing or too short');
  failsWith({ factorRatings: [launch({}).factorRatings[0], launch({}).factorRatings[0]] }, 'duplicate proposal');
});

test('factorRatings: a rating the agent set is refused, whatever the proposal says', () => {
  const { fails, accepted } = run(rating({ id: 'delancey' }));
  assert.deepEqual(fails, ['factorRatings[0]: Delancey is already rated; ratings are never overwritten']);
  assert.deepEqual(accepted.factorRatings, []);
  // one hand-set factor left beside the agent's makes it a launch rating again
  const mixed = { restaurants: [{ id: 'mixed-pie', name: 'Mixed Pie', status: 'open', factors: {
    craft: { value: 8, setBy: 'agent' }, distinctiveness: { value: 7, setBy: 'editorial' }, critical: { value: 8, setBy: 'agent' } } }] };
  assert.deepEqual(validateResearch(rating({ id: 'mixed-pie' }), mixed, NOW).fails, []);
});

test('factorRatings: never overwrites, never off-grid, always sourced', () => {
  failsWith(rating({ id: 'delancey' }), 'already rated');
  failsWith(rating({ craft: 7.3 }), '0.5 steps');
  failsWith(rating({ criticScore: 11 }), 'criticScore');
  failsWith(rating({ sources: [] }), 'sources');
  failsWith(rating({ sources: ['http://x.com/a'] }), 'must be https');
  failsWith(rating({ opened: 2031 }), 'opened');
  failsWith(rating({ priceIndex: 5 }), 'priceIndex');
});

test('factorRatings: duplicate proposals for one entry are refused', () => {
  const doc = { factorRatings: [rating({}).factorRatings[0], rating({}).factorRatings[0]] };
  failsWith(doc, 'duplicate proposal');
});

/* ---- caps and structure ---- */
test('caps: an oversized section rejects the file', () => {
  const doc = { mentions: Array.from({ length: 41 }, () => ({})) };
  failsWith(doc, 'exceeds the 40 cap');
});

test('legacy crowd-rating payloads are refused outright', () => {
  failsWith({ ratings: [{ id: 'delancey', rating: 4.8 }] }, 'no longer accepted');
});

test('newAttributes is no longer a section: a file that carries it has it ignored, not applied', () => {
  const good = { id: 'delancey', status: 'open', note: 'confirmed on its site today', source: 'https://x.com/a' };
  const { fails, fatal, accepted, unknown, sections } = run({ status: [good],
    newAttributes: [{ key: 'hard-parking', label: 'Hard parking', frictionCost: 2.5, entries: ['delancey'] }] });
  assert.equal(fatal, false);
  assert.deepEqual(fails, []);
  assert.deepEqual(unknown, ['newAttributes']);
  assert.ok(!('newAttributes' in accepted) && !('newAttributes' in sections) && !('newAttributes' in CAPS));
  assert.deepEqual(accepted.status, [good]);
  // however many records it holds, an ignored key cannot fail the file
  assert.equal(run({ newAttributes: Array.from({ length: 50 }, () => ({})) }).fatal, false);
});

test('status: enum and citation enforced', () => {
  passes({ status: [{ id: 'delancey', status: 'open', note: 'confirmed on its site', source: 'https://x.com' }] });
  failsWith({ status: [{ id: 'delancey', status: 'gone', note: 'confirmed on its site', source: 'https://x.com' }] }, 'status must be');
});

test('factsSkipped: an attempt that could not complete the record, alone or beside what it did find', () => {
  passes({ factsSkipped: [{ id: 'zeeks-pizza', note: 'no page states a founding year or shows prices' }] });
  failsWith({ factsSkipped: [{ id: 'nope', note: 'searched the site and local coverage' }] }, 'unknown restaurant id');
  failsWith({ factsSkipped: [{ id: 'zeeks-pizza', note: 'none' }] }, 'note missing or too short');
  // a pass that finds the year and not the signature reports both
  const { fails, accepted } = run({ facts: [{ id: 'delancey', opened: 2009, source: 'https://delancey.example/about' }],
    factsSkipped: [{ id: 'delancey', note: 'the menu names no pie above the others, and no review does' }] });
  assert.deepEqual(fails, []);
  assert.deepEqual([accepted.facts.length, accepted.factsSkipped.length], [1, 1]);
});

/* ---- factorSources: citations for a rating already on file ---- */
test('factorSources: attaches criticism to a rated entry, never to an unrated one', () => {
  passes({ factorSources: [{ id: 'delancey', sources: ['https://www.thestranger.com/food/delancey-review'], note: NOTE }] });
  failsWith({ factorSources: [{ id: 'zeeks-pizza', sources: ['https://www.thestranger.com/x'], note: NOTE }] }, 'is not rated');
  failsWith({ factorSources: [{ id: 'nope', sources: ['https://www.thestranger.com/x'], note: NOTE }] }, 'unknown restaurant id');
  failsWith({ factorSources: [{ id: 'delancey', sources: [], note: NOTE }] }, 'sources must be 1-4');
  failsWith({ factorSources: [{ id: 'delancey', sources: ['https://www.yelp.com/biz/delancey'], note: NOTE }] }, 'no source is published criticism');
  failsWith({ factorSources: [
    { id: 'delancey', sources: ['https://www.thestranger.com/a'], note: NOTE },
    { id: 'delancey', sources: ['https://www.thestranger.com/b'], note: NOTE }
  ] }, 'duplicate factorSources record');
});

test('factorSources: still attach to a launch rating, but not beside a proposal that replaces it', () => {
  const cite = { id: 'launch-pie', sources: ['https://www.thestranger.com/food/launch-pie-review'], note: NOTE };
  passes({ factorSources: [cite] });
  const { fails, accepted } = run({ ...rating({ id: 'launch-pie' }), factorSources: [cite] });
  assert.deepEqual(fails, ['factorSources[0]: Launch Pie is also proposed in factorRatings']);
  assert.deepEqual([accepted.factorRatings.length, accepted.factorSources.length], [1, 0]);
});

/* ---- links: web presence records ---- */
test('links: a sourced website + instagram record passes', () => {
  passes({ links: [{ id: 'zeeks-pizza', website: 'https://zeekspizza.com',
    instagram: 'https://www.instagram.com/zeekspizza', source: 'https://zeekspizza.com' }] });
  passes({ links: [{ id: 'roma-roma', instagram: 'https://instagram.com/roma.roma_sea/',
    source: 'https://romaroma.example/about' }] });
});

test('links: guessed handles, wrong hosts and bare records fail', () => {
  failsWith({ links: [{ id: 'zeeks-pizza', instagram: 'https://facebook.com/zeeks',
    source: 'https://z.com' }] }, 'instagram must be a profile URL');
  failsWith({ links: [{ id: 'zeeks-pizza', instagram: 'https://www.instagram.com/p/abc123/extra',
    source: 'https://z.com' }] }, 'instagram must be a profile URL');
  failsWith({ links: [{ id: 'zeeks-pizza', source: 'https://z.com' }] }, 'website or instagram');
  failsWith({ links: [{ id: 'zeeks-pizza', website: 'http://zeeks.com', source: 'https://z.com' }] }, 'must be https');
});

test('links: unknown ids and duplicate records fail', () => {
  failsWith({ links: [{ id: 'nope', instagram: 'https://www.instagram.com/x_y',
    source: 'https://z.com' }] }, 'unknown restaurant id');
  failsWith({ links: [
    { id: 'zeeks-pizza', instagram: 'https://www.instagram.com/zeeks', source: 'https://z.com' },
    { id: 'zeeks-pizza', website: 'https://zeeks.com', source: 'https://z.com' }
  ] }, 'duplicate links record');
});

/* ---- candidateReview: census verdicts ---- */
const CANDS = { candidates: [
  { name: 'Belltown Pizza', status: 'pending' },
  { name: 'Ghost Pizza', status: 'rejected' }
] };
const review = it => validateResearch({ candidateReview: [it] }, dataset, NOW, CANDS);
const reviewFails = (it, snippet) => {
  const { fails } = review(it);
  assert.ok(fails.some(f => f.includes(snippet)),
    `expected "${snippet}", got: ${JSON.stringify(fails)}`);
};

test('candidateReview: a verdict on a pending candidate passes', () => {
  assert.deepEqual(review({ name: 'Belltown Pizza', verdict: 'not-pizza',
    note: 'a bar where pizza is incidental', source: 'https://x.com/a' }).fails, []);
});

test('candidateReview: bad verdicts, unknown/resolved names, thin notes fail', () => {
  reviewFails({ name: 'Belltown Pizza', verdict: 'meh', note: 'long enough note here' }, 'verdict must be');
  reviewFails({ name: 'Ghost Pizza', verdict: 'closed', note: 'long enough note here' }, 'not a pending candidate');
  reviewFails({ name: 'Nowhere Pizza', verdict: 'closed', note: 'long enough note here' }, 'not a pending candidate');
  reviewFails({ name: 'Belltown Pizza', verdict: 'closed', note: 'short' }, 'note missing or too short');
  reviewFails({ name: 'Belltown Pizza', verdict: 'closed', note: 'long enough note here',
    source: 'not a url' }, 'not a valid URL');
});

test('candidateReview: a duplicate names the entry on file it duplicates', () => {
  const dup = { name: 'Belltown Pizza', verdict: 'duplicate', note: 'a second branch of the entry on file' };
  assert.deepEqual(review({ ...dup, duplicateOf: 'zeeks-pizza' }).fails, []);
  // A closed entry is still an entry on file.
  assert.deepEqual(review({ ...dup, duplicateOf: 'old-slice' }).fails, []);
  reviewFails(dup, 'a duplicate verdict needs duplicateOf');
  reviewFails({ ...dup, duplicateOf: 'Zeeks Pizza' }, 'duplicateOf is not the id of an entry on file: "Zeeks Pizza"');
  reviewFails({ ...dup, duplicateOf: 'nowhere-pizza' }, 'duplicateOf is not the id of an entry on file');
  reviewFails({ ...dup, duplicateOf: ['zeeks-pizza'] }, 'duplicateOf is not the id of an entry on file');
  // The record is dropped, not the file.
  const { accepted, fatal } = review(dup);
  assert.deepEqual([fatal, accepted.candidateReview], [false, []]);
});

test('candidateReview: duplicateOf on any other verdict is refused', () => {
  for (const verdict of ['closed', 'chain', 'not-pizza', 'unverifiable']) {
    reviewFails({ name: 'Belltown Pizza', verdict, note: 'long enough note here', duplicateOf: 'zeeks-pizza' },
      `duplicateOf belongs to a duplicate verdict only, not "${verdict}"`);
  }
  // The rule holds with no candidates queue to match names against.
  const { fails } = validateResearch({ candidateReview: [
    { name: 'Anything Pizza', verdict: 'duplicate', note: 'long enough note here' }] }, dataset, NOW);
  assert.match(fails.join('\n'), /a duplicate verdict needs duplicateOf/);
});

test('candidateReview: an http source is tolerated (dropped at apply), never fatal', () => {
  assert.deepEqual(review({ name: 'Belltown Pizza', verdict: 'closed',
    note: 'long enough note here', source: 'http://x.com/directions' }).fails, []);
});

test('candidateReview: without a candidates queue, name matching is skipped', () => {
  const { fails } = validateResearch({ candidateReview: [
    { name: 'Anything Pizza', verdict: 'closed', note: 'long enough note here' }
  ] }, dataset, NOW);
  assert.deepEqual(fails, []);
});
