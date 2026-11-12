import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normName, candidateKey, isNationalChain, isSeattleCity, matchEntry, mergeCandidates, coverageStats,
  branchLeads, INSPECTION_CUTOFF_MONTHS, REOPENING_VERDICTS, inspectedSinceVerdict, candidateStanding } from '../src/census.js';
import { PER_PASS } from '../src/rules.js';

const restaurants = [
  { id: 'tutta-bella', name: 'Tutta Bella' },
  { id: 'zeeks-pizza', name: 'Zeeks Pizza' }
];

test('permit-register noise normalises away', () => {
  assert.equal(normName("PAGLIACCI PIZZA INC"), normName("Pagliacci"));
  assert.equal(normName("Zeeks Pizza #12"), normName('Zeeks'));
  assert.equal(normName("The Independent Pizzeria LLC"), normName('Independent'));
});

test('accents fold to their plain letters, so one name is one key', () => {
  assert.equal(normName('Z\u00e9eks Pizza'), normName('Zeeks Pizza'));
  assert.equal(normName('Caf\u00e9 Lago'), normName('Cafe Lago'));
});

test('candidateKey separates branches of one name by street number', () => {
  assert.notEqual(candidateKey('A Pizza Mart', '800 Seneca St'),
                  candidateKey('A Pizza Mart', '1433 11th Ave'));
  assert.equal(candidateKey('Zeeks Pizza #6', '600 Broadway'),
               candidateKey('ZEEKS PIZZA', '600 Broadway E'));
});

test('national chains are recognised; locals are not', () => {
  assert.ok(isNationalChain("Domino'S Pizza #7084"));
  assert.ok(isNationalChain('MOD Pizza'));
  assert.ok(!isNationalChain('Zeeks Pizza'));
  assert.ok(!isNationalChain('Modern Pizza'));
});

test('merge: matches promote, chains file as chain, the rest pend', () => {
  const merged = mergeCandidates([], [
    { name: '#807 Tutta Bella', address: '2746 NE 45th St', sources: ['kc-health'] },
    { name: 'Dominos Pizza #7196', address: '1 Pike St', sources: ['kc-health'] },
    { name: 'Belltown Pizza', address: '2422 1st Ave', sources: ['kc-health'] }
  ], restaurants);
  const byName = Object.fromEntries(merged.map(c => [c.name, c]));
  assert.equal(byName['#807 Tutta Bella'].status, 'promoted');
  assert.equal(byName['#807 Tutta Bella'].matchedId, 'tutta-bella');
  assert.equal(byName['Dominos Pizza #7196'].status, 'chain');
  assert.equal(byName['Belltown Pizza'].status, 'pending');
});

test('merge: a stored resolution survives a refresh; a new dataset entry promotes', () => {
  const stored = mergeCandidates([], [
    { name: 'Ghost Pizza', address: '1 A St', sources: ['kc-health'] },
    { name: 'Candela Pizza', address: '1622 SW Roxbury St', sources: ['kc-health'] }
  ], restaurants);
  stored.find(c => c.name === 'Ghost Pizza').status = 'rejected';
  const refreshed = mergeCandidates(stored, [
    { name: 'Ghost Pizza', address: '1 A St', sources: ['kc-health'] }
  ], [...restaurants, { id: 'candela', name: 'Candela Pizza' }]);
  assert.equal(refreshed.find(c => c.name === 'Ghost Pizza').status, 'rejected');
  assert.equal(refreshed.find(c => c.name === 'Candela Pizza').status, 'promoted');
  assert.equal(refreshed.find(c => c.name === 'Candela Pizza').matchedId, 'candela');
});

/* ---- a verdict is not for ever ---- */
const judged = (verdict, over = {}) => ({ key: candidateKey('Ghost Pizza', '1 A St'), name: 'Ghost Pizza',
  address: '1 A St, Seattle, WA 98101', sources: ['kc-health'], lastInspection: '2026-03-01',
  status: verdict === 'chain' ? 'chain' : 'rejected', verdict, note: 'what the census found',
  resolutionSource: 'https://news.example/ghost', resolvedDate: '2026-08-31', ...over });
const inspected = (lastInspection, over = {}) => ({ name: 'Ghost Pizza', address: '1 A St, Seattle, WA 98101',
  sources: ['kc-health'], ...(lastInspection ? { lastInspection } : {}), ...over });

test('merge: closed, unverifiable and not-pizza return to pending on an inspection dated after the verdict', () => {
  assert.deepEqual(REOPENING_VERDICTS, ['closed', 'unverifiable', 'not-pizza']);
  for (const verdict of REOPENING_VERDICTS) {
    const [c] = mergeCandidates([judged(verdict)], [inspected('2026-09-01')], restaurants);
    assert.deepEqual(c, { key: 'ghost|1', name: 'Ghost Pizza', address: '1 A St, Seattle, WA 98101', sources: ['kc-health'],
      lastInspection: '2026-09-01', status: 'pending',
      previousVerdict: { verdict, note: 'what the census found', resolvedDate: '2026-08-31', source: 'https://news.example/ghost' } }, verdict);
  }
});

test('merge: an inspection on or before the day of the verdict changes nothing but the facts', () => {
  for (const date of ['2026-08-31', '2026-08-30', '2026-03-01']) {
    const [c] = mergeCandidates([judged('closed')], [inspected(date)], restaurants);
    assert.deepEqual(c, judged('closed', { lastInspection: date }), date);
  }
  // an OpenStreetMap row carries no inspection, and a verdict with no date cannot be shown to be older
  assert.equal(mergeCandidates([judged('closed')], [inspected(null, { sources: ['osm'] })], restaurants)[0].status, 'rejected');
  assert.equal(mergeCandidates([judged('closed', { resolvedDate: undefined })], [inspected('2026-10-01')], restaurants)[0].status, 'rejected');
  // the register no longer listing it is no evidence either way
  assert.deepEqual(mergeCandidates([judged('closed', { lastInspection: '2026-10-01' })], [], restaurants), [judged('closed', { lastInspection: '2026-10-01' })]);
});

test('merge: an inspection already on file that postdates the verdict brings the candidate back at the next refresh that lists it', () => {
  // The row was refreshed after its verdict and kept it; the register still shows the same inspection.
  const stored = judged('not-pizza', { lastInspection: '2026-11-10' });
  const [c] = mergeCandidates([stored], [inspected('2026-11-10')], restaurants);
  assert.deepEqual([c.status, c.lastInspection, c.previousVerdict.verdict], ['pending', '2026-11-10', 'not-pizza']);
  // a source that carries no inspection date leaves the one on file to speak
  assert.equal(mergeCandidates([stored], [inspected(null, { sources: ['osm'] })], restaurants)[0].status, 'pending');
});

test('merge: a chain and a duplicate never return, whatever the register shows', () => {
  const chain = judged('chain', { name: 'Dominos Pizza #7196', key: candidateKey('Dominos Pizza #7196', '1 A St') });
  assert.deepEqual(mergeCandidates([chain], [inspected('2026-11-01', { name: 'Dominos Pizza #7196' })], restaurants),
    [{ ...chain, lastInspection: '2026-11-01' }]);
  // a chain the seed filed by name carries no verdict at all
  const seeded = { ...chain, verdict: undefined, note: undefined, resolvedDate: undefined, resolutionSource: undefined };
  assert.equal(mergeCandidates([seeded], [inspected('2026-11-01', { name: 'Dominos Pizza #7196' })], restaurants)[0].status, 'chain');
  const dup = judged('duplicate', { matchedId: 'zeeks-pizza' });
  assert.deepEqual(mergeCandidates([dup], [inspected('2026-11-01')], restaurants), [{ ...dup, lastInspection: '2026-11-01' }]);
  // nor does a promoted candidate, which is already an entry
  const promoted = { ...inspected('2026-03-01'), key: 'ghost|1', status: 'promoted', matchedId: 'ghost', resolvedDate: '2026-08-31' };
  assert.equal(mergeCandidates([promoted], [inspected('2026-11-01')], restaurants)[0].status, 'promoted');
});

test('merge: a candidate that came back is not reopened twice by the same inspection', () => {
  const once = mergeCandidates([judged('unverifiable')], [inspected('2026-09-01')], restaurants);
  const twice = mergeCandidates(once, [inspected('2026-09-01')], restaurants);
  assert.deepEqual(twice, once);
  // judged again on a later day, it stays judged until the register inspects it again
  const again = [{ ...once[0], status: 'rejected', verdict: 'not-pizza', note: 'a bar now', resolvedDate: '2026-11-12' }];
  assert.equal(mergeCandidates(again, [inspected('2026-09-01')], restaurants)[0].status, 'rejected');
  const [back] = mergeCandidates(again, [inspected('2026-12-02')], restaurants);
  assert.equal(back.status, 'pending');
  // the row keeps the latest finding as the previous verdict, not the first
  assert.deepEqual(back.previousVerdict, { verdict: 'not-pizza', note: 'a bar now', resolvedDate: '2026-11-12' });
});

test('merge: a candidate that comes back as an entry now on file is promoted, not queued', () => {
  const [c] = mergeCandidates([judged('closed')], [inspected('2026-09-01')], [...restaurants, { id: 'ghost-pizza', name: 'Ghost Pizza' }]);
  assert.deepEqual([c.status, c.matchedId, c.previousVerdict.verdict], ['promoted', 'ghost-pizza', 'closed']);
});

test('inspectedSinceVerdict: reads the inspection already on a stored row', () => {
  assert.equal(inspectedSinceVerdict(judged('not-pizza', { lastInspection: '2026-11-10' })), true);
  assert.equal(inspectedSinceVerdict(judged('not-pizza', { lastInspection: '2026-08-31' })), false);
  assert.equal(inspectedSinceVerdict(judged('duplicate', { lastInspection: '2026-11-10' })), false);
  assert.equal(inspectedSinceVerdict(judged('chain', { lastInspection: '2026-11-10' })), false);
  assert.equal(inspectedSinceVerdict({ status: 'pending', lastInspection: '2026-11-10' }), false);
  assert.equal(inspectedSinceVerdict(undefined), false);
});

/* ---- where a candidate stands, for the page ---- */
test('candidateStanding: a state, and the dates and numbers it depends on', () => {
  const none = { matchedId: null, resolvedDate: null, lastInspection: null, reopens: false, reopensAfter: null,
    inspectedSince: false, previousVerdict: null, queuePosition: null, censusPass: null, perPass: null };

  assert.deepEqual(candidateStanding({ status: 'promoted', matchedId: 'zeeks-pizza', lastInspection: '2026-03-01', resolvedDate: '2026-08-31' }),
    { ...none, state: 'listed', matchedId: 'zeeks-pizza', lastInspection: '2026-03-01', resolvedDate: '2026-08-31' });
  assert.deepEqual(candidateStanding(judged('chain', { lastInspection: '2026-11-10' })),
    { ...none, state: 'chain', lastInspection: '2026-11-10', resolvedDate: '2026-08-31' });
  assert.deepEqual(candidateStanding(judged('duplicate', { matchedId: 'zeeks-pizza', lastInspection: '2026-11-10' })),
    { ...none, state: 'duplicate', matchedId: 'zeeks-pizza', lastInspection: '2026-11-10', resolvedDate: '2026-08-31' });

  // the three verdicts an inspection reopens: what it has to postdate, and whether one already does
  for (const verdict of REOPENING_VERDICTS) {
    assert.deepEqual(candidateStanding(judged(verdict)),
      { ...none, state: verdict, lastInspection: '2026-03-01', resolvedDate: '2026-08-31', reopens: true, reopensAfter: '2026-08-31' });
    assert.equal(candidateStanding(judged(verdict, { lastInspection: '2026-11-10' })).inspectedSince, true);
  }
  // set aside with no verdict or no date on record: nothing to measure an inspection against
  assert.deepEqual(candidateStanding({ status: 'rejected', lastInspection: '2026-03-01' }), { ...none, state: 'rejected', lastInspection: '2026-03-01' });
  assert.equal(candidateStanding(judged('closed', { resolvedDate: undefined })).reopens, false);
  assert.equal(candidateStanding(undefined).state, 'rejected');
});

test('candidateStanding: a pending candidate knows its place in the queue and what was found before', () => {
  const queue = [
    judged('chain'),
    ...Array.from({ length: 12 }, (_, i) => ({ key: `lead|${i}`, name: `Lead ${i}`, status: 'pending', lastInspection: '2026-06-11' }))
  ];
  assert.deepEqual(candidateStanding(queue[1], queue), { state: 'pending', matchedId: null, resolvedDate: null, lastInspection: '2026-06-11',
    reopens: false, reopensAfter: null, inspectedSince: false, previousVerdict: null, queuePosition: 1, censusPass: 1, perPass: PER_PASS.census });
  assert.deepEqual([candidateStanding(queue[PER_PASS.census], queue).queuePosition, candidateStanding(queue[PER_PASS.census], queue).censusPass],
    [PER_PASS.census, 1]);
  assert.deepEqual([candidateStanding(queue[PER_PASS.census + 1], queue).queuePosition, candidateStanding(queue[PER_PASS.census + 1], queue).censusPass],
    [PER_PASS.census + 1, 2]);
  // a copy of the row is found by its key; with no queue given the place is not known
  assert.equal(candidateStanding({ ...queue[3] }, queue).queuePosition, 3);
  assert.deepEqual([candidateStanding(queue[3]).queuePosition, candidateStanding(queue[3]).perPass], [null, null]);

  const [back] = mergeCandidates([judged('closed')], [inspected('2026-09-01')], restaurants);
  const standing = candidateStanding(back, [back]);
  assert.deepEqual([standing.state, standing.resolvedDate, standing.reopens, standing.queuePosition], ['pending', null, false, 1]);
  assert.deepEqual(standing.previousVerdict, { verdict: 'closed', note: 'what the census found', resolvedDate: '2026-08-31',
    source: 'https://news.example/ghost' });
});

test('coverageStats counts by status', () => {
  const stats = coverageStats([
    { status: 'pending' }, { status: 'pending' }, { status: 'chain' },
    { status: 'promoted' }, { status: 'rejected' }
  ]);
  assert.deepEqual(stats, { pending: 2, promoted: 1, chains: 1, rejected: 1 });
});

test('matchEntry never matches on an empty normalised name', () => {
  assert.equal(matchEntry({ name: 'Pizza' }, restaurants), null);
});

test('isSeattleCity: Seattle or West Seattle in any case, with trailing punctuation or spaces', () => {
  for (const yes of ['SEATTLE', 'Seattle', 'seattle', 'Seattle,', 'Seattle. ', '  seattle', 'WEST SEATTLE', 'West  Seattle,']) {
    assert.ok(isSeattleCity(yes), yes);
  }
  for (const no of ['Seattle tacoma', 'SEATAC', 'North Seattle', 'Seattle WA', 'Seattle-Tacoma', 'Bellevue', '', null, undefined]) {
    assert.ok(!isSeattleCity(no), String(no));
  }
});

/* ---- a trailing parenthetical in an entry's name ---- */
test('matchEntry: an entry filed under a branch matches the plain permit name', () => {
  const rs = [{ id: 'a-pizza-mart-first-hill', name: 'A Pizza Mart (First Hill)' }, ...restaurants];
  assert.equal(matchEntry({ name: 'A Pizza Mart' }, rs).id, 'a-pizza-mart-first-hill');
  assert.equal(matchEntry({ name: 'A-PIZZA MART' }, rs).id, 'a-pizza-mart-first-hill');
  // Only the entry's own trailing parenthetical is set aside: a longer permit
  // name is still a different name, and a parenthetical mid-name stays.
  assert.equal(matchEntry({ name: 'A Pizza Mart Bar & Grill Inc' }, rs), null);
  assert.equal(matchEntry({ name: 'Pie' }, [{ id: 'x', name: 'Pie (Old) Works' }]), null);
  assert.equal(matchEntry({ name: 'Pizza' }, [{ id: 'x', name: 'Pizza (Ballard)' }]), null);
});

test('matchEntry: an entry under the full name wins over one that shares it without its parenthetical', () => {
  const rs = [{ id: 'mart-first-hill', name: 'A Pizza Mart (First Hill)' }, { id: 'mart', name: 'A Pizza Mart' }];
  assert.equal(matchEntry({ name: 'A Pizza Mart' }, rs).id, 'mart');
  assert.equal(matchEntry({ name: 'A Pizza Mart (First Hill)' }, rs).id, 'mart-first-hill');
});

test('merge: a branch registered under the plain name is promoted to the entry filed under a branch', () => {
  const merged = mergeCandidates([], [
    { name: 'A Pizza Mart', address: '1433 11th Ave, Seattle, WA 98122', sources: ['kc-health'] }
  ], [{ id: 'a-pizza-mart-first-hill', name: 'A Pizza Mart (First Hill)' }]);
  assert.deepEqual(merged.map(c => [c.status, c.matchedId]), [['promoted', 'a-pizza-mart-first-hill']]);
});

/* ---- branch leads ---- */
const LEAD_NOW = Date.parse('2026-11-10T12:00:00Z');
const mart = (over = {}) => ({ id: 'mart', name: 'A Pizza Mart (First Hill)', status: 'open',
  locations: [{ neighborhood: 'First Hill', address: '800 Seneca St, Seattle, WA 98101' }], ...over });
const permit = (address, over = {}) => ({ name: 'A Pizza Mart', address, sources: ['kc-health'],
  lastInspection: '2026-06-11', status: 'rejected', verdict: 'duplicate', matchedId: 'mart', ...over });
const leadsOf = (candidates, entry = mart()) => branchLeads(candidates, [entry], LEAD_NOW).get(entry.id) ?? [];

test('branch leads: a permit address the entry lacks is a lead, promoted or rejected as duplicate', () => {
  const leads = branchLeads([
    permit('1823 Terry Ave, #102, Seattle, WA 98101'),
    permit('1433 11th Ave, Seattle, WA 98122', { status: 'promoted', verdict: undefined }),
    permit('99 Elsewhere St, Seattle, WA 98101', { matchedId: 'someone-else' })
  ], [mart(), { id: 'no-permits', name: 'No Permits', status: 'open', locations: [] }], LEAD_NOW);
  assert.deepEqual([...leads], [['mart', ['1823 Terry Ave, #102, Seattle, WA 98101', '1433 11th Ave, Seattle, WA 98122']]]);
});

test('branch leads: a permit at an address already on file is not a lead, however the suite is written', () => {
  assert.deepEqual(leadsOf([
    permit('800 Seneca St, 103, Seattle, WA 98101'),
    permit('800 Seneca Street, Ste 103, Seattle, WA 98101'),
    permit('800 SENECA ST. #103, Seattle, WA 98101')
  ]), []);
  // The unit the register files after the street and a site writes into the number.
  assert.deepEqual(leadsOf([permit('9622 16th Ave Sw, A, Seattle, WA 98106')],
    mart({ locations: [{ neighborhood: 'White Center', address: '9622-A 16th Ave SW, Seattle, WA 98106' }] })), []);
  // A street the register abbreviates, and one it files under the next ZIP.
  assert.deepEqual(leadsOf([permit('6711 M L King Jr Way S, Seattle, WA 98118')],
    mart({ locations: [{ neighborhood: 'Rainier Valley', address: '6711 Martin Luther King Jr Way S, Seattle, WA 98118' }] })), []);
  assert.deepEqual(leadsOf([permit('10003 Rainier Ave S, Seattle, WA 98118')],
    mart({ locations: [{ neighborhood: 'Rainier Beach', address: '10003 Rainier Ave S, Seattle, WA 98178' }] })), []);
});

test('branch leads: two permits at one door the entry lacks are one lead', () => {
  assert.deepEqual(leadsOf([
    permit('4918 Rainier Ave S, Seattle, WA 98118'),
    permit('4918 Rainier Ave S, Seattle, WA 98118', { name: 'A Pizza Mart (Kc489)' })
  ]), ['4918 Rainier Ave S, Seattle, WA 98118']);
});

test('branch leads: none for a closed entry, an unresolved candidate, a lapsed permit or an address outside Seattle', () => {
  const lead = '1823 Terry Ave, Seattle, WA 98101';
  assert.deepEqual(leadsOf([permit(lead)]), [lead]);
  assert.deepEqual(leadsOf([permit(lead)], mart({ status: 'closed' })), []);
  assert.deepEqual(leadsOf([permit(lead, { matchedId: undefined })]), []);
  assert.deepEqual(leadsOf([permit(lead, { status: 'pending' })]), []);
  assert.deepEqual(leadsOf([permit('1 Main St, Bellevue, WA 98004')]), []);
  assert.deepEqual(leadsOf([permit(undefined)]), []);
  // The cutoff is the seed's own, to the day; a candidate with no inspection
  // on record (an OpenStreetMap lead) is no permit address.
  const days = n => new Date(LEAD_NOW - n * 864e5).toISOString().slice(0, 10);
  assert.deepEqual(leadsOf([permit(lead, { lastInspection: days(INSPECTION_CUTOFF_MONTHS * 30 - 1) })]), [lead]);
  assert.deepEqual(leadsOf([permit(lead, { lastInspection: days(INSPECTION_CUTOFF_MONTHS * 30 + 1) })]), []);
  assert.deepEqual(leadsOf([permit(lead, { lastInspection: undefined })]), []);
  assert.equal(branchLeads(undefined, [mart()], LEAD_NOW).size, 0);
});
