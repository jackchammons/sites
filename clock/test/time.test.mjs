import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  pad, plural, isoWeek, startOfWeek, daysInMonth, daysInYear, dayOfYear, daysLeftInMonth,
  daysLeftInYear, span, progress, offsetLabel, isoOffset, relativeOffset, seasonNote,
  wall, offsetMinutes, canonicalZone, sameZone, dayBand,
} from '../src/time.js';

/* A process keeps one time zone for its whole life, so anything that depends
   on the local calendar is evaluated in a child started with TZ set. `expr`
   is an expression over `t`, the module, and comes back through JSON. */
const TIME_JS = new URL('../src/time.js', import.meta.url).href;
const inZone = (tz, expr) => JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e',
  `import * as t from ${JSON.stringify(TIME_JS)}; console.log(JSON.stringify(${expr}));`],
  { env: { ...process.env, TZ: tz }, encoding: 'utf8', cwd: fileURLToPath(new URL('.', import.meta.url)) }));

const ZONES = ['Europe/Berlin', 'America/Los_Angeles', 'Australia/Sydney', 'Australia/Lord_Howe', 'UTC'];

test('pad and plural', () => {
  assert.equal(pad(7), '07');
  assert.equal(pad(12), '12');
  assert.equal(plural(1, 'day'), '1 day');
  assert.equal(plural(31, 'day'), '31 days');
});

test('isoWeek: the Thursday decides the year', () => {
  assert.deepEqual(isoWeek(new Date(2027, 0, 1)), { year: 2026, week: 53 });
  assert.deepEqual(isoWeek(new Date(2027, 0, 3, 23, 59)), { year: 2026, week: 53 });
  assert.deepEqual(isoWeek(new Date(2027, 0, 4, 0, 0, 30)), { year: 2027, week: 1 });
  assert.deepEqual(isoWeek(new Date(2025, 11, 29, 9)), { year: 2026, week: 1 });
  assert.deepEqual(isoWeek(new Date(2026, 10, 10)), { year: 2026, week: 46 });
});

test('isoWeek agrees with UTC arithmetic on every day of 2020 to 2035, in zones with summer time', () => {
  const sweep = `(() => {
    const ref = (y, m, d) => {
      const u = new Date(Date.UTC(y, m, d));
      u.setUTCDate(u.getUTCDate() - ((u.getUTCDay() + 6) % 7) + 3);
      const first = new Date(Date.UTC(u.getUTCFullYear(), 0, 4));
      first.setUTCDate(first.getUTCDate() - ((first.getUTCDay() + 6) % 7) + 3);
      return u.getUTCFullYear() + '-' + (1 + Math.round((u - first) / 604800000));
    };
    let checked = 0; const bad = [];
    for (let y = 2020; y <= 2035; y++) for (let m = 0; m < 12; m++) {
      for (let d = 1; d <= new Date(y, m + 1, 0).getDate(); d++) for (const h of [0, 1, 2, 3, 12, 23]) {
        const got = t.isoWeek(new Date(y, m, d, h, 30)); checked++;
        if (got.year + '-' + got.week !== ref(y, m, d)) bad.push([y, m + 1, d, h]);
      }
    }
    return { checked, bad: bad.slice(0, 5) };
  })()`;
  for (const tz of ZONES) {
    const r = inZone(tz, sweep);
    assert.ok(r.checked > 35000, `${tz}: sweep ran`);
    assert.deepEqual(r.bad, [], `${tz}: ISO week mismatches`);
  }
});

test('startOfWeek is the Monday at local midnight', () => {
  const m = startOfWeek(new Date(2026, 10, 10, 15, 30));       // a Tuesday
  assert.deepEqual([m.getFullYear(), m.getMonth(), m.getDate(), m.getHours(), m.getDay()], [2026, 10, 9, 0, 1]);
  const s = startOfWeek(new Date(2026, 10, 8, 23, 59));        // a Sunday belongs to the week before
  assert.deepEqual([s.getMonth(), s.getDate()], [10, 2]);
});

test('calendar counts', () => {
  assert.equal(daysInMonth(new Date(2026, 1, 10)), 28);
  assert.equal(daysInMonth(new Date(2028, 1, 10)), 29);
  assert.equal(daysInMonth(new Date(2026, 11, 31)), 31);
  assert.equal(daysInYear(2026), 365);
  assert.equal(daysInYear(2028), 366);
  assert.equal(daysInYear(2100), 365);
  assert.equal(dayOfYear(new Date(2026, 0, 1)), 1);
  assert.equal(dayOfYear(new Date(2026, 11, 31, 23, 59, 59)), 365);
  assert.equal(dayOfYear(new Date(2028, 1, 29)), 60);
  assert.equal(dayOfYear(new Date(2028, 11, 31)), 366);
  assert.equal(daysLeftInMonth(new Date(2026, 11, 31, 12)), 1);
  assert.equal(daysLeftInYear(new Date(2026, 11, 31, 12)), 1);
  assert.equal(daysLeftInYear(new Date(2026, 0, 1)), 365);
});

/* Each of these was a day out when the count was rounded up from elapsed
   milliseconds: the span to the end of the month or year crosses a change of
   offset, so it is an hour longer or shorter than a whole number of days. */
test('days left do not move with the hour of the day when summer time changes in between', () => {
  const left = (y, m, d, h, min) =>
    `[t.daysLeftInMonth(new Date(${y}, ${m - 1}, ${d}, ${h}, ${min})), t.daysLeftInYear(new Date(${y}, ${m - 1}, ${d}, ${h}, ${min})), t.dayOfYear(new Date(${y}, ${m - 1}, ${d}, ${h}, ${min}))]`;
  // Summer time ends on 25 October: 1 October 00:30 is 31 days and an hour from November.
  assert.deepEqual(inZone('Europe/Berlin', left(2026, 10, 1, 0, 30)), [31, 92, 274]);
  // The 25-hour day itself, 1 November in Los Angeles.
  assert.deepEqual(inZone('America/Los_Angeles', left(2026, 11, 1, 0, 30)), [30, 61, 305]);
  // Mid-summer: the year ends on standard time, an hour further away than the calendar says.
  assert.deepEqual(inZone('America/Los_Angeles', left(2026, 7, 1, 0, 30)), [31, 184, 182]);
  assert.deepEqual(inZone('America/Los_Angeles', left(2026, 7, 1, 1, 30)), [31, 184, 182]);
  // Before the spring change the month is an hour short instead.
  assert.deepEqual(inZone('America/Los_Angeles', left(2026, 3, 3, 22, 30)), [29, 304, 62]);
  assert.deepEqual(inZone('America/Los_Angeles', left(2026, 3, 3, 23, 30)), [29, 304, 62]);
  // South of the equator the year ends on summer time, an hour nearer.
  assert.deepEqual(inZone('Australia/Sydney', left(2026, 6, 30, 23, 30)), [1, 185, 181]);
});

test('days left agree with counting the dates one by one, every day of 2026 to 2028', () => {
  const sweep = `(() => {
    let checked = 0; const bad = [];
    for (let y = 2026; y <= 2028; y++) for (let m = 0; m < 12; m++) {
      const last = new Date(y, m + 1, 0).getDate();
      for (let d = 1; d <= last; d++) for (const h of [0, 1, 2, 3, 12, 22, 23]) {
        const now = new Date(y, m, d, h, 30); checked++;
        let inYear = 0;
        for (let x = new Date(y, m, d); x.getFullYear() === y; x = new Date(y, x.getMonth(), x.getDate() + 1)) inYear++;
        if (t.daysLeftInMonth(now) !== last - d + 1 || t.daysLeftInYear(now) !== inYear
            || t.daysLeftInYear(now) !== t.daysInYear(y) - t.dayOfYear(now) + 1) bad.push([y, m + 1, d, h]);
      }
    }
    return { checked, bad: bad.slice(0, 5) };
  })()`;
  for (const tz of ZONES) {
    const r = inZone(tz, sweep);
    assert.ok(r.checked > 7000, `${tz}: sweep ran`);
    assert.deepEqual(r.bad, [], `${tz}: days-left mismatches`);
  }
});

test('span clamps and reports what is left', () => {
  assert.deepEqual(span(0, 100, 25), { pct: 0.25, left: 75 });
  assert.equal(span(0, 100, -5).pct, 0);
  assert.equal(span(0, 100, 500).pct, 1);
});

test('progress measures between local midnights, so a 23- or 25-hour day still runs 0 to 100%', () => {
  const at = (y, m, d, h) => `(p => [p.day.pct, p.day.left / 3600000])(t.progress(new Date(${y}, ${m - 1}, ${d}, ${h})))`;
  // Spring forward: noon is 11 hours into a 23-hour day.
  let [pct, hoursLeft] = inZone('America/Los_Angeles', at(2026, 3, 8, 12));
  assert.ok(Math.abs(pct - 11 / 23) < 1e-9);
  assert.equal(hoursLeft, 12);
  // Fall back: noon is 13 hours into a 25-hour day.
  [pct, hoursLeft] = inZone('America/Los_Angeles', at(2026, 11, 1, 12));
  assert.ok(Math.abs(pct - 13 / 25) < 1e-9);
  assert.equal(hoursLeft, 12);
  [pct] = inZone('Europe/Berlin', at(2026, 3, 29, 12));
  assert.ok(Math.abs(pct - 11 / 23) < 1e-9);

  const p = progress(new Date(2026, 0, 1, 0, 0, 0));
  assert.equal(p.day.pct, 0);
  assert.equal(p.month.pct, 0);
  assert.equal(p.year.pct, 0);
  const w = progress(new Date(2026, 10, 9, 0, 0, 0));          // a Monday, at midnight
  assert.equal(w.week.pct, 0);
});

test('isoLocal carries the offset of the moment, not of the season', () => {
  const iso = (y, m, d, h) => `t.isoLocal(new Date(${y}, ${m - 1}, ${d}, ${h}, 5, 9))`;
  assert.equal(inZone('America/Los_Angeles', iso(2026, 7, 1, 9)), '2026-07-01T09:05:09-07:00');
  assert.equal(inZone('America/Los_Angeles', iso(2026, 12, 1, 9)), '2026-12-01T09:05:09-08:00');
  assert.equal(inZone('Asia/Kathmandu', iso(2026, 11, 10, 0)), '2026-11-10T00:05:09+05:45');
  assert.equal(inZone('America/St_Johns', iso(2026, 11, 10, 23)), '2026-11-10T23:05:09-03:30');
  assert.equal(inZone('UTC', iso(2026, 11, 10, 12)), '2026-11-10T12:05:09+00:00');
});

test('offset labels', () => {
  assert.equal(offsetLabel(0), 'UTC+00:00');
  assert.equal(offsetLabel(-480), 'UTC−08:00');
  assert.equal(offsetLabel(345), 'UTC+05:45');
  assert.equal(offsetLabel(-210), 'UTC−03:30');
  assert.equal(offsetLabel(840), 'UTC+14:00');
  assert.equal(isoOffset(-210), '-03:30');
  assert.equal(isoOffset(330), '+05:30');
});

test('relativeOffset: whole hours stay short, part hours are hours and minutes', () => {
  assert.equal(relativeOffset(0), 'same time');
  assert.equal(relativeOffset(60), '+1h');
  assert.equal(relativeOffset(-480), '−8h');
  assert.equal(relativeOffset(810), '+13h 30m');
  // Seen from Kathmandu (UTC+05:45): Mumbai, Shanghai and UTC.
  assert.equal(relativeOffset(330 - 345), '−15m');
  assert.equal(relativeOffset(480 - 345), '+2h 15m');
  assert.equal(relativeOffset(0 - 345), '−5h 45m');
  // Seen from Chatham in its summer (UTC+13:45): Auckland and Honolulu.
  assert.equal(relativeOffset(780 - 825), '−45m');
  assert.equal(relativeOffset(-600 - 825), '−23h 45m');
  for (let m = -1560; m <= 1560; m += 15) assert.doesNotMatch(relativeOffset(m), /\./);
});

test('seasonNote reads the offset against January and July', () => {
  assert.equal(seasonNote(330, 330, 330), 'no seasonal change here');
  assert.equal(seasonNote(-420, -480, -420), 'summer time in effect');
  assert.equal(seasonNote(-480, -480, -420), 'standard time');
  assert.equal(seasonNote(660, 660, 600), 'summer time in effect');   // Sydney in January
  assert.equal(seasonNote(600, 660, 600), 'standard time');
});

test('wall and offsetMinutes read another zone through Intl', () => {
  const nov = new Date(Date.UTC(2026, 10, 10, 0, 0, 0));
  assert.deepEqual(wall(nov, 'UTC'), { year: 2026, month: 11, day: 10, hour: 0, minute: 0, second: 0 });
  assert.deepEqual(wall(nov, 'Asia/Kathmandu'), { year: 2026, month: 11, day: 10, hour: 5, minute: 45, second: 0 });
  assert.deepEqual(wall(nov, 'Pacific/Honolulu'), { year: 2026, month: 11, day: 9, hour: 14, minute: 0, second: 0 });
  assert.equal(offsetMinutes(nov, 'UTC'), 0);
  assert.equal(offsetMinutes(nov, 'Asia/Kolkata'), 330);
  assert.equal(offsetMinutes(nov, 'Asia/Kathmandu'), 345);
  assert.equal(offsetMinutes(nov, 'Pacific/Chatham'), 825);
  assert.equal(offsetMinutes(nov, 'America/St_Johns'), -210);
  assert.equal(offsetMinutes(nov, 'America/Los_Angeles'), -480);
  assert.equal(offsetMinutes(new Date(Date.UTC(2026, 6, 1)), 'America/Los_Angeles'), -420);
  assert.equal(offsetMinutes(new Date(Date.UTC(2026, 6, 1)), 'Australia/Lord_Howe'), 630);
  assert.equal(offsetMinutes(new Date(Date.UTC(2026, 0, 1)), 'Australia/Lord_Howe'), 660);
  // A fraction of a second must not leak into the offset.
  assert.equal(offsetMinutes(new Date(Date.UTC(2026, 10, 10, 0, 0, 0, 999)), 'Asia/Kathmandu'), 345);
  assert.throws(() => wall(nov, 'Mars/Olympus_Mons'), RangeError);
});

test('sameZone compares the names the engine files zones under', () => {
  assert.ok(sameZone('UTC', 'UTC'));
  assert.ok(sameZone('America/Los_Angeles', 'America/Los_Angeles'));
  assert.ok(!sameZone('Europe/Berlin', 'Europe/London'));
  assert.ok(!sameZone('Asia/Kolkata', 'Asia/Kathmandu'));
  // The renamed zones a browser may still report under the old name.
  assert.ok(sameZone('Asia/Calcutta', 'Asia/Kolkata'));
  assert.ok(sameZone('Asia/Katmandu', 'Asia/Kathmandu'));
  assert.ok(sameZone('US/Pacific', 'America/Los_Angeles'));
  // An unknown name is only ever equal to itself, and does not throw.
  assert.equal(canonicalZone('Mars/Olympus_Mons'), 'Mars/Olympus_Mons');
  assert.ok(!sameZone('Mars/Olympus_Mons', 'UTC'));
});

test('dayBand', () => {
  assert.deepEqual([0, 4, 5, 6, 7, 12, 17, 18, 20, 21, 23].map(dayBand),
    ['night', 'night', 'dusk', 'dusk', 'day', 'day', 'day', 'dusk', 'dusk', 'night', 'night']);
});
