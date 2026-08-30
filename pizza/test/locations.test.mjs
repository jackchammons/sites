import { test } from 'node:test';
import assert from 'node:assert/strict';
import { locationLabel, locationAreas, locationCount, locationWorklist } from '../src/locations.js';

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

test('worklist: placeholders first, then unverified, then stalest', () => {
  const rs = [
    { id: 'fresh', neighborhood: 'A', locations: [{ neighborhood: 'A', address: 'x' }], locationsVerified: '2026-08-01' },
    { id: 'stale', neighborhood: 'B', locations: [{ neighborhood: 'B', address: 'x' }], locationsVerified: '2026-01-01' },
    { id: 'never', neighborhood: 'C', locations: [] },
    { id: 'placeholder', neighborhood: 'Multiple locations', neighborhoodIsPlaceholder: true, locations: [] }
  ];
  assert.deepEqual(locationWorklist(rs).map(r => r.id), ['placeholder', 'never', 'stale', 'fresh']);
});
