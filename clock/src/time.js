/* Now — the calendar and zone arithmetic.
 *
 * One implementation, imported by the browser (app.js), the unit tests and
 * the deploy gate (verify.mjs, which runs it from the built copy). Nothing
 * here touches the DOM or reads the clock: every function is handed its Date
 * and answers from the calendar of the zone the process runs in, or from the
 * zone it is given by name. That is what lets a test pin a 23-hour day by
 * setting TZ.
 */

export const DAY = 86400000;

export const pad = n => (n < 10 ? '0' + n : String(n));
export const plural = (n, word) => n + ' ' + word + (n === 1 ? '' : 's');

/* ---- calendar -------------------------------------------------------- */
export const startOfDay = d => new Date(d.getFullYear(), d.getMonth(), d.getDate());

export function isoWeek(d) {
  // Thursday of the current ISO week decides which year the week belongs to.
  const t = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dow = (t.getDay() + 6) % 7;                  // Monday = 0
  t.setDate(t.getDate() - dow + 3);
  const firstThursday = new Date(t.getFullYear(), 0, 4);
  const fdow = (firstThursday.getDay() + 6) % 7;
  firstThursday.setDate(firstThursday.getDate() - fdow + 3);
  const week = 1 + Math.round((t - firstThursday) / (7 * DAY));
  return { year: t.getFullYear(), week };
}

export function startOfWeek(d) {
  const t = startOfDay(d);
  t.setDate(t.getDate() - ((t.getDay() + 6) % 7));
  return t;
}

/* Day counts come from the calendar date, never from elapsed milliseconds.
   The days from the 1st to the end of October are 31 on the calendar and
   31 days and one hour on the clock wherever summer time ends in between,
   so a count rounded from milliseconds is a day out for part of every day. */
export function daysInMonth(d) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
}

export function daysInYear(year) {
  return (Date.UTC(year + 1, 0, 1) - Date.UTC(year, 0, 1)) / DAY;
}

export function dayOfYear(d) {
  return (Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())
    - Date.UTC(d.getFullYear(), 0, 1)) / DAY + 1;
}

// Both of these count today, so the last day of a month has 1 day left.
export function daysLeftInMonth(d) {
  return daysInMonth(d) - d.getDate() + 1;
}

export function daysLeftInYear(d) {
  return daysInYear(d.getFullYear()) - dayOfYear(d) + 1;
}

/* Spans are measured between local midnights rather than in fixed 24-hour
   blocks, so a 23- or 25-hour DST day still reads 0% at midnight and 100%
   at the next one. */
export function span(from, to, now) {
  const total = to - from;
  return { pct: Math.min(1, Math.max(0, (now - from) / total)), left: to - now };
}

// How far through the day, week, month and year `now` is.
export function progress(now) {
  const y = now.getFullYear(), m = now.getMonth();
  const weekStart = startOfWeek(now);
  return {
    day: span(startOfDay(now), new Date(y, m, now.getDate() + 1), now),
    week: span(weekStart,
      new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + 7), now),
    month: span(new Date(y, m, 1), new Date(y, m + 1, 1), now),
    year: span(new Date(y, 0, 1), new Date(y + 1, 0, 1), now)
  };
}

/* ---- offsets --------------------------------------------------------- */
function hoursAndMinutes(mins) {
  const a = Math.abs(mins);
  return pad(Math.floor(a / 60)) + ':' + pad(a % 60);
}

export function offsetLabel(mins) {
  return 'UTC' + (mins < 0 ? '−' : '+') + hoursAndMinutes(mins);   // real minus sign, not a hyphen
}

// The offset as ISO 8601 writes it, which is with a plain hyphen.
export function isoOffset(mins) {
  return (mins < 0 ? '-' : '+') + hoursAndMinutes(mins);
}

// Local date and time with the offset, e.g. 2026-11-10T09:30:00-08:00.
export function isoLocal(d) {
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
    + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds())
    + isoOffset(-d.getTimezoneOffset());
}

/* How far another zone is from the viewer's, in minutes. Zones sit at
   quarter and half hours too (Kathmandu, Chatham, Newfoundland, India), and a
   decimal rounds those to something that is not a time: 15 minutes is not
   0.3 hours. */
export function relativeOffset(mins) {
  if (mins === 0) return 'same time';
  const a = Math.abs(mins);
  const h = Math.floor(a / 60), m = a % 60;
  return (mins > 0 ? '+' : '−') + (h ? h + 'h' : '') + (h && m ? ' ' : '') + (m ? m + 'm' : '');
}

/* A zone is on summer time if its offset differs from its January one (or
   its July one, south of the equator). */
export function seasonNote(offset, january, july) {
  if (january === july) return 'no seasonal change here';
  return offset === Math.max(january, july) ? 'summer time in effect' : 'standard time';
}

/* ---- zones, through Intl --------------------------------------------- */
const partsCache = {};
function partsFmt(tz) {
  if (!partsCache[tz]) {
    partsCache[tz] = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
  }
  return partsCache[tz];
}

/* Wall-clock fields for an instant in some zone. Reading them back through
   Date.UTC is also how the offset is derived below, which avoids depending
   on `timeZoneName: 'shortOffset'` being available. Throws a RangeError for
   a zone this engine does not know. */
export function wall(date, tz) {
  const p = {};
  for (const part of partsFmt(tz).formatToParts(date)) p[part.type] = part.value;
  let hour = +p.hour;
  if (hour === 24) hour = 0;           // some engines emit 24 for midnight
  return {
    year: +p.year, month: +p.month, day: +p.day,
    hour, minute: +p.minute, second: +p.second
  };
}

export function offsetMinutes(date, tz) {
  const w = wall(date, tz);
  const asUTC = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
  return Math.round((asUTC - Math.floor(date.getTime() / 1000) * 1000) / 60000);
}

/* The name the engine itself files a zone under. Zones get renamed and the
   old name stays valid: Chromium reports a viewer in India as Asia/Calcutta
   while Firefox says Asia/Kolkata, and both accept either. Two names are the
   same zone when they resolve to the same one here. */
export function canonicalZone(tz) {
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: tz }).resolvedOptions().timeZone;
  } catch (e) { return tz; }
}

export function sameZone(a, b) {
  return canonicalZone(a) === canonicalZone(b);
}

// Rough daylight banding, from the local hour alone — a hint, not a sunrise table.
export function dayBand(hour) {
  if (hour >= 7 && hour < 18) return 'day';
  return (hour >= 18 && hour < 21) || (hour >= 5 && hour < 7) ? 'dusk' : 'night';
}
