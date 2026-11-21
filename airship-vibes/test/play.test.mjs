/* What the viewer does, and what they hear: the gesture rules and the music. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify, isDouble, TAP_SLOP, SWIPE_MIN, DOUBLE_MS } from '../src/gesture.js';
import { SONGS, Sequence, barEvents, barSeconds, stepSeconds, frequency, STEPS, TEMPO_STEP } from '../src/music.js';
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
    assert.ok(Math.abs(barSeconds(song.bpm) - STEPS * stepSeconds(song.bpm)) < 1e-12);
    assert.ok(Math.abs(barSeconds(60) - 4) < 1e-12, 'four beats to the bar');
  }
});

test('a bar is the same bar every time it is asked for', () => {
  const song = SONGS.sunset;
  assert.deepEqual(barEvents(song, 7, 21), barEvents(song, 7, 21));
  assert.notDeepEqual(barEvents(song, 7, 21), barEvents(song, 8, 21), 'another visit plays it differently');
  for (const bar of [0, 5, 300]) {
    for (const bpm of [song.bpm, 84]) {
      const events = barEvents(song, 7, bar, bpm);
      for (let i = 0; i < events.length; i++) {
        const e = events[i];
        assert.ok(e.time >= 0 && e.time < barSeconds(bpm), 'every note is inside its bar, at any tempo');
        assert.ok(i === 0 || e.time >= events[i - 1].time, 'in order');
        assert.ok(e.vel > 0 && e.vel <= 1 && e.dur > 0);
      }
    }
  }
  // a faster bar is the same bar, only shorter
  const slow = barEvents(song, 7, 9, 60), quick = barEvents(song, 7, 9, 90);
  assert.deepEqual(slow.map(e => [e.kind, e.midi]), quick.map(e => [e.kind, e.midi]));
});

test('the beat: kick on the one, snare on two and four, swung hats, and a piano-only opening', () => {
  for (const [id, song] of Object.entries(SONGS)) {
    const step = stepSeconds(song.bpm);
    const opening = [...barEvents(song, 3, 0), ...barEvents(song, 3, 1)];
    assert.ok(opening.every(e => e.kind === 'chord'), `${id}: the first two bars are the piano alone`);
    const events = barEvents(song, 3, 6);
    const of = kind => events.filter(e => e.kind === kind);
    assert.equal(of('kick')[0].time, 0, `${id}: the kick is on the one, exactly`);
    const snares = of('snare').filter(e => e.vel > 0.5).map(e => e.time / step);
    assert.equal(snares.length, 2);
    assert.ok(snares[0] > 4 && snares[0] < 4.4 && snares[1] > 12 && snares[1] < 12.4, `${id}: snares on two and four, a touch late`);
    assert.ok(of('hat').length >= 5);
    // an off-sixteenth is late by the swing
    const ghost = Array.from({ length: 40 }, (_, b) => barEvents(song, 3, b + 4)).flat().find(e => e.kind === 'hat' && e.vel < 0.2);
    const pos = (ghost.time / step) % 2;
    assert.ok(pos >= 1 + song.swing - 1e-6 && pos < 1 + song.swing + 0.12, `${id}: the off-beats are not swung`);
  }
});

test('the notes sit where their instruments live', () => {
  for (const [id, song] of Object.entries(SONGS)) {
    const bar = barSeconds(song.bpm);
    const events = new Sequence(id, 5).take(bar * 48);
    const range = kind => { const m = events.filter(e => e.kind === kind).map(e => e.midi); return [Math.min(...m), Math.max(...m)]; };
    const [c0, c1] = range('chord'), [b0, b1] = range('bass'), [l0, l1] = range('lead');
    // a phone's speaker has nothing below G3 to give the piano, and the chords crowd the melody above A4
    assert.ok(c0 >= 55 && c1 <= 70, `${id}: chords ${c0}..${c1}`);
    assert.ok(b0 >= 33 && b1 <= 60, `${id}: bass ${b0}..${b1}`);
    assert.ok(l0 >= 67 && l1 <= 88, `${id}: melody ${l0}..${l1}`);
    assert.ok(events.some(e => e.kind === 'lead'), `${id}: there is a melody somewhere in 48 bars`);
    // every sixteenth bar the drums and bass sit out for two bars
    const rest = events.filter(e => e.time >= 30 * bar && e.time < 32 * bar);
    assert.ok(!rest.some(e => e.kind === 'kick' || e.kind === 'snare' || e.kind === 'bass'), `${id}: no breath at bar 30`);
    assert.ok(rest.some(e => e.kind === 'chord'));
  }
  assert.ok(Math.abs(frequency(69) - 440) < 1e-9);
  assert.ok(Math.abs(frequency(57) - 220) < 1e-9);
});

test('a stretch of time asked for in pieces is the same as asked for whole', () => {
  // the player schedules a fraction of a second at a time; nothing may fall between two requests, or in both
  const whole = new Sequence('city', 9).take(60);
  const seq = new Sequence('city', 9), pieces = [];
  for (let t = 0; t < 60; t += 0.4) pieces.push(...seq.take(Math.min(60, t + 0.4)));
  assert.deepEqual(pieces, whole);
  assert.ok(whole.length > 300);
  assert.deepEqual(seq.take(60), [], 'and nothing is handed out twice');
  for (let i = 1; i < whole.length; i++) assert.ok(whole[i].time >= whole[i - 1].time, 'in order');
  // every bar is announced at its head: which song, at what tempo
  const bars = whole.filter(e => e.kind === 'bar');
  assert.deepEqual(bars.map(e => e.bar), bars.map((_, i) => i));
  assert.ok(bars.every(e => e.id === 'city' && e.bpm === SONGS.city.bpm));
});

test('a change of scene: the band plays on, and the new song comes in on the next bar line', () => {
  for (const [from, to] of [['valley', 'city'], ['city', 'sunset'], ['sunset', 'clouds'], ['clouds', 'valley'], ['sunset', 'valley']]) {
    const seq = new Sequence(from, 7);
    const before = seq.take(20.3);                      // a little way into a bar
    const line = seq.end;                               // the bar line the change will fall on
    assert.ok(line > 20.3 && line - 20.3 <= barSeconds(SONGS[from].bpm));
    seq.change(to, 8);
    const after = seq.take(line + 40);
    const all = [...before, ...after];
    const bars = all.filter(e => e.kind === 'bar');
    for (const b of bars) assert.equal(b.id, b.time < line - 1e-9 ? from : to, `${from} to ${to}: the bar at ${b.time.toFixed(2)}`);
    // not a note of the new song before the line, not a note of the old one after it
    const chordsOf = id => new Set(SONGS[id].chords.flatMap(c => c.notes).concat(SONGS[id].chords.map(c => c.bass)));
    const only = (id, other) => [...chordsOf(id)].filter(m => !chordsOf(other).has(m));
    for (const e of all.filter(e => e.kind === 'chord')) {
      if (e.time < line - 1e-9) assert.ok(!only(to, from).includes(e.midi), 'the new song came in early');
      else assert.ok(!only(from, to).includes(e.midi), 'the old song hung on');
    }
    // the bar count carries on: no bar is skipped or played twice, and bar lines meet end to end
    for (let i = 1; i < bars.length; i++) {
      assert.equal(bars[i].bar, bars[i - 1].bar + 1);
      assert.ok(Math.abs(bars[i].time - bars[i - 1].time - barSeconds(bars[i - 1].bpm)) < 1e-9, 'a gap or an overlap at a bar line');
    }
    // so the drums never stop: there is no silence longer than a beat anywhere near the join, and no second piano-only opening
    const beats = all.filter(e => e.kind === 'kick' || e.kind === 'snare' || e.kind === 'hat').map(e => e.time);
    for (let i = 1; i < beats.length; i++) {
      if (beats[i] > line - 6 && beats[i] < line + 6) assert.ok(beats[i] - beats[i - 1] < 60 / 60, `${from} to ${to}: the beat stops for ${(beats[i] - beats[i - 1]).toFixed(2)} s at ${beats[i].toFixed(1)}`);
    }
    // the tempo eases to the new song's, a little each bar, and arrives
    for (let i = 1; i < bars.length; i++) assert.ok(Math.abs(bars[i].bpm - bars[i - 1].bpm) <= TEMPO_STEP);
    assert.equal(bars[bars.length - 1].bpm, SONGS[to].bpm);
    // and the new song starts on its first chord
    const first = after.filter(e => e.kind === 'chord' && e.time >= line - 1e-9).slice(0, 4).map(e => e.midi);
    assert.deepEqual(first.sort(), [...SONGS[to].chords[0].notes].sort());
  }
});

test('a change asked for twice, or called off, does what was asked last', () => {
  const seq = new Sequence('valley', 7);
  seq.take(5);
  seq.change('city', 8);
  seq.change('clouds', 9);
  assert.deepEqual(seq.next, { id: 'clouds', seed: 9 });
  seq.change('valley', 7);
  assert.equal(seq.next, null, 'back to the song that is playing: nothing to do');
  assert.ok(seq.take(30).filter(e => e.kind === 'bar').every(e => e.id === 'valley'));
  seq.change('nowhere', 1);
  assert.equal(seq.next, null, 'a song that does not exist is not turned to');
});

test('neighbouring scenes are in neighbouring keys', () => {
  // the scenes come round in this order; each song's melody shares most of its notes with the next one's
  const order = SCENES.map(s => s.id);
  const classes = id => new Set(SONGS[id].scale.map(m => m % 12));
  for (let i = 0; i < order.length; i++) {
    const a = classes(order[i]), b = classes(order[(i + 1) % order.length]);
    const shared = [...a].filter(n => b.has(n)).length;
    assert.ok(shared >= 3, `${order[i]} and ${order[(i + 1) % order.length]} share only ${shared} of five notes`);
  }
  // and the chords are the melody's own scale, give or take the altered dominant in the city
  for (const [id, song] of Object.entries(SONGS)) {
    const key = { valley: 0, city: 0, sunset: 5, clouds: 7 }[id];
    const major = new Set([0, 2, 4, 5, 7, 9, 11].map(n => (n + key) % 12));
    for (const [i, c] of song.chords.entries()) {
      const out = [...c.notes, c.bass].filter(m => !major.has(m % 12));
      assert.ok(out.length === 0 || (id === 'city' && i === 3), `${id}: chord ${i + 1} leaves the key with ${out}`);
    }
    for (const m of song.scale) assert.ok(major.has(m % 12), `${id}: the melody leaves the key at ${m}`);
  }
});
