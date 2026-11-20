/* What the viewer does, and what they hear: the gesture rules and the music. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify, isDouble, TAP_SLOP, SWIPE_MIN, DOUBLE_MS } from '../src/gesture.js';
import { SONGS, barEvents, eventsBetween, barSeconds, stepSeconds, frequency, STEPS } from '../src/music.js';
import { SCENES } from '../src/scenes.js';

const at = (x, y, t) => ({ x, y, t });

test('a tap is a short touch that stays put', () => {
  assert.equal(classify(at(100, 100, 0), at(103, 98, 120)), 'tap');
  assert.equal(classify(at(100, 100, 0), at(100 + TAP_SLOP, 100, 120)), 'tap');
  assert.equal(classify(at(100, 100, 0), at(100, 100, 900)), null, 'a press and hold is not a tap');
  assert.equal(classify(at(100, 100, 0), at(100 + TAP_SLOP + 6, 100, 120)), null, 'a short drag is neither tap nor swipe');
});

test('a swipe left is forward, a swipe right is back, and a drag up or down is neither', () => {
  assert.equal(classify(at(300, 400, 0), at(300 - SWIPE_MIN, 410, 200)), 'left');
  assert.equal(classify(at(100, 400, 0), at(260, 380, 300)), 'right');
  assert.equal(classify(at(100, 400, 0), at(130, 700, 300)), null, 'someone scrolling');
  assert.equal(classify(at(100, 400, 0), at(200, 500, 300)), null, 'a diagonal is not a swipe');
  assert.equal(classify(at(100, 400, 0), at(300, 400, 2000)), null, 'too slow to be a swipe');
});

test('two taps close in time and place are a double tap', () => {
  const first = at(200, 300, 1000);
  assert.equal(isDouble(null, first), false);
  assert.equal(isDouble(first, at(210, 305, 1000 + DOUBLE_MS)), true);
  assert.equal(isDouble(first, at(210, 305, 1001 + DOUBLE_MS)), false, 'too late');
  assert.equal(isDouble(first, at(320, 300, 1100)), false, 'too far away');
});

test('every scene has a song', () => {
  assert.deepEqual(Object.keys(SONGS).sort(), SCENES.map(s => s.id).sort());
  for (const [id, song] of Object.entries(SONGS)) {
    assert.ok(song.bpm >= 60 && song.bpm <= 90, `${id}: ${song.bpm} bpm is not a slow beat`);
    assert.ok(song.swing > 0.1 && song.swing < 0.3);
    assert.equal(song.chords.length, 4);
    assert.ok(Math.abs(barSeconds(song) - STEPS * stepSeconds(song)) < 1e-12);
  }
});

test('a bar is the same bar every time it is asked for', () => {
  const song = SONGS.sunset;
  assert.deepEqual(barEvents(song, 7, 21), barEvents(song, 7, 21));
  assert.notDeepEqual(barEvents(song, 7, 21), barEvents(song, 8, 21), 'another visit plays it differently');
  for (const bar of [0, 5, 300]) {
    const t0 = bar * barSeconds(song);
    const events = barEvents(song, 7, bar);
    for (let i = 0; i < events.length; i++) {
      const e = events[i];
      assert.ok(e.time >= t0 && e.time < t0 + barSeconds(song), 'every note is inside its bar');
      assert.ok(i === 0 || e.time >= events[i - 1].time, 'in order');
      assert.ok(e.vel > 0 && e.vel <= 1 && e.dur > 0);
    }
  }
});

test('the beat: kick on the one, snare on two and four, swung hats, and a piano-only opening', () => {
  for (const [id, song] of Object.entries(SONGS)) {
    const step = stepSeconds(song);
    const opening = [...barEvents(song, 3, 0), ...barEvents(song, 3, 1)];
    assert.ok(opening.every(e => e.kind === 'chord'), `${id}: the first two bars are the piano alone`);
    const bar = 6, t0 = bar * barSeconds(song), events = barEvents(song, 3, bar);
    const of = kind => events.filter(e => e.kind === kind);
    assert.equal(of('kick')[0].time, t0, `${id}: the kick is on the one, exactly`);
    const snares = of('snare').filter(e => e.vel > 0.5).map(e => (e.time - t0) / step);
    assert.equal(snares.length, 2);
    assert.ok(snares[0] > 4 && snares[0] < 4.4 && snares[1] > 12 && snares[1] < 12.4, `${id}: snares on two and four, a touch late`);
    assert.ok(of('hat').length >= 5);
    // an off-sixteenth is late by the swing
    const ghost = Array.from({ length: 40 }, (_, b) => barEvents(song, 3, b + 4)).flat().find(e => e.kind === 'hat' && e.vel < 0.2);
    const pos = ((ghost.time / step) % STEPS) % 2;
    assert.ok(pos >= 1 + song.swing - 1e-6 && pos < 1 + song.swing + 0.12, `${id}: the off-beats are not swung`);
  }
});

test('the notes sit where their instruments live', () => {
  for (const [id, song] of Object.entries(SONGS)) {
    const events = eventsBetween(song, 5, 0, barSeconds(song) * 48);
    const range = kind => { const m = events.filter(e => e.kind === kind).map(e => e.midi); return [Math.min(...m), Math.max(...m)]; };
    const [c0, c1] = range('chord'), [b0, b1] = range('bass'), [l0, l1] = range('lead');
    assert.ok(c0 >= 55 && c1 <= 72, `${id}: chords ${c0}..${c1}`);
    assert.ok(b0 >= 33 && b1 <= 57, `${id}: bass ${b0}..${b1}`);
    assert.ok(l0 >= 67 && l1 <= 88, `${id}: melody ${l0}..${l1}`);
    assert.ok(events.some(e => e.kind === 'lead'), `${id}: there is a melody somewhere in 48 bars`);
    // every sixteenth bar the drums and bass sit out for two bars
    const rest = events.filter(e => e.time >= 30 * barSeconds(song) && e.time < 32 * barSeconds(song));
    assert.ok(!rest.some(e => e.kind === 'kick' || e.kind === 'snare' || e.kind === 'bass'), `${id}: no breath at bar 30`);
    assert.ok(rest.some(e => e.kind === 'chord'));
  }
  assert.ok(Math.abs(frequency(69) - 440) < 1e-9);
  assert.ok(Math.abs(frequency(57) - 220) < 1e-9);
});

test('a stretch of time asked for in pieces is the same as asked for whole', () => {
  // the player schedules a fraction of a second at a time; nothing may fall between two requests, or in both
  const song = SONGS.city;
  const whole = eventsBetween(song, 9, 0, 60);
  const pieces = [];
  for (let t = 0; t < 60; t += 0.4) pieces.push(...eventsBetween(song, 9, t, Math.min(60, t + 0.4)));
  assert.deepEqual(pieces, whole);
  assert.ok(whole.length > 300);
  assert.deepEqual(eventsBetween(song, 9, 10, 10), []);
});
