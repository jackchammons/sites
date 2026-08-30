import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normName, candidateKey, isNationalChain, matchEntry, mergeCandidates, coverageStats }
  from '../src/census.js';

const restaurants = [
  { id: 'tutta-bella', name: 'Tutta Bella' },
  { id: 'zeeks-pizza', name: 'Zeeks Pizza' }
];

test('permit-register noise normalises away', () => {
  assert.equal(normName("PAGLIACCI PIZZA INC"), normName("Pagliacci"));
  assert.equal(normName("Zeeks Pizza #12"), normName('Zeeks'));
  assert.equal(normName("The Independent Pizzeria LLC"), normName('Independent'));
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
