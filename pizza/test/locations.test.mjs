import { test } from 'node:test';
import assert from 'node:assert/strict';
import { locationLabel, locationAreas, locationCount, locationWorklist, streetKey } from '../src/locations.js';

test('label: one area, two areas, many areas, placeholder, fallback', () => {
  const mk = hoods => ({ locations: hoods.map(h => ({ neighborhood: h, address: 'x' })), neighborhood: 'Fallback' });
  assert.equal(locationLabel(mk(['Ballard'])), 'Ballard');
  assert.equal(locationLabel(mk(['Ballard', 'Fremont'])), 'Ballard and Fremont');
  assert.equal(locationLabel(mk(['Ballard', 'Fremont', 'SoDo', 'Alki'])), 'Ballard, Fremont + 2 more');
  assert.equal(locationLabel({ locations: [], neighborhoodIsPlaceholder: true, neighborhood: 'Citywide' }), 'Several locations');
  assert.equal(locationLabel({ locations: [], neighborhood: 'Georgetown' }), 'Georgetown');
});

test('areas dedupe branches in the same neighborhood', () => {
  const r = { locations: [
    { neighborhood: 'Ballard', address: 'a' }, { neighborhood: 'Ballard', address: 'b' },
    { neighborhood: 'Bellevue', address: 'c' }] };
  assert.deepEqual(locationAreas(r), ['Ballard', 'Bellevue']);
  assert.equal(locationCount(r), '2 neighborhoods · 3 locations');
});

/* ---- the locations worklist ---- */
const NOW = Date.parse('2026-11-10T12:00:00Z');
const at = (id, over = {}) => ({ id, status: 'open', neighborhood: 'A',
  locations: [{ neighborhood: 'A', address: '1 A St, Seattle, WA 98101' }], ...over });
const order = rs => locationWorklist(rs, NOW).map(r => r.id);

test('worklist: placeholders first, then never looked at, then the oldest look', () => {
  const rs = [
    at('recent', { locationsVerified: '2026-08-01' }),
    at('stale', { locationsVerified: '2026-01-01' }),
    at('never', { locations: [] }),
    at('placeholder', { neighborhood: 'Multiple locations', neighborhoodIsPlaceholder: true, locations: [] })
  ];
  assert.deepEqual(order(rs), ['placeholder', 'never', 'stale', 'recent']);
});

test('worklist: an entry with a branch lead goes ahead of everything else', () => {
  const rs = [
    at('stale', { locationsVerified: '2026-01-01' }),
    at('never', { locations: [] }),
    at('placeholder', { neighborhood: 'Multiple locations', neighborhoodIsPlaceholder: true, locations: [] }),
    at('lead-verified', { locationsVerified: '2026-08-01' }),
    at('lead-never')
  ];
  const leads = new Map([['lead-verified', ['2 B St, Seattle, WA 98101']], ['lead-never', ['3 C St, Seattle, WA 98101']],
    ['stale', []]]);
  assert.deepEqual(locationWorklist(rs, NOW, leads).map(r => r.id),
    ['lead-never', 'lead-verified', 'placeholder', 'never', 'stale']);
  // With no leads the same entries fall back to the usual order.
  assert.deepEqual(order(rs), ['placeholder', 'lead-never', 'never', 'stale', 'lead-verified']);
});

test('worklist: a lead does not shorten the rest after a look', () => {
  const rs = [
    at('looked-yesterday', { locationsVerified: '2026-11-09' }),
    at('skipped-last-week', { locationsVerified: '2026-01-01', locationsAttempted: '2026-11-03' }),
    at('no-lead')
  ];
  const leads = new Map(rs.slice(0, 2).map(r => [r.id, ['2 B St, Seattle, WA 98101']]));
  assert.deepEqual(locationWorklist(rs, NOW, leads).map(r => r.id), ['no-lead']);
  // A month on, both are due again and lead the list, oldest look first.
  assert.deepEqual(locationWorklist(rs, NOW + 31 * 864e5, leads).map(r => r.id),
    ['skipped-last-week', 'looked-yesterday', 'no-lead']);
});

test('worklist: an entry attempted yesterday is not drawn, and one never attempted is', () => {
  const rs = [
    at('tried-yesterday', { locations: [], locationsAttempted: '2026-11-09' }),
    at('never-tried', { locations: [] })
  ];
  assert.deepEqual(order(rs), ['never-tried']);
  // Once the rest is over it comes back, behind everything never looked at.
  const later = locationWorklist(rs, NOW + 40 * 864e5).map(r => r.id);
  assert.deepEqual(later, ['never-tried', 'tried-yesterday']);
});

test('worklist: a verified entry rests for the same 30 days, to the day', () => {
  const rs = [at('a', { locationsVerified: '2026-10-11T12:00:00Z' }), at('b', { locationsVerified: '2026-10-12' })];
  assert.deepEqual(order(rs), ['a']);
});

test('worklist: the last look is the newer of verified and attempted', () => {
  // Verified in January, looked at again in September without success: the
  // September look is what orders it, behind an entry last seen in March.
  const rs = [
    at('retried', { locationsVerified: '2026-01-01', locationsAttempted: '2026-09-01' }),
    at('march', { locationsVerified: '2026-03-01' })
  ];
  assert.deepEqual(order(rs), ['march', 'retried']);
});

test('worklist: an opening entry with no address is left out; one with an address stays', () => {
  const rs = [
    at('not-open-yet', { status: 'opening', locations: [] }),
    at('opening-with-address', { status: 'opening' }),
    at('open-no-address', { locations: [] })
  ];
  assert.deepEqual(order(rs).sort(), ['open-no-address', 'opening-with-address']);
});

test('worklist: never-looked-at entries go by oldest status check, then id, not file order', () => {
  const rs = [
    at('zeta', { statusChecked: '2026-10-01' }),
    at('beta', { statusChecked: '2026-11-01' }),
    at('alpha', { statusChecked: '2026-11-01' }),
    at('unchecked')
  ];
  assert.deepEqual(order(rs), ['unchecked', 'zeta', 'alpha', 'beta']);
  assert.deepEqual(order([...rs].reverse()), ['unchecked', 'zeta', 'alpha', 'beta']);
});

test('streetKey: one door written two ways is one key; another door or town is not', () => {
  const key = streetKey('1415 NW 70th St, Seattle, WA 98117');
  assert.equal(streetKey('1415 N.W. 70th Street, Seattle WA 98117'), key);
  assert.equal(streetKey('1415 Northwest 70th St., Suite B, Seattle, WA 98117'), key);
  assert.notEqual(streetKey('1417 NW 70th St, Seattle, WA 98117'), key);
  assert.notEqual(streetKey('1415 NW 70th St, Tacoma, WA 98402'), key);
});
