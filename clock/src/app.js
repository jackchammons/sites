/* Now — the live half of the page.
 *
 * A classic script, no modules and no imports: everything here reads the
 * device clock and the browser's own time zone database through Intl. The
 * build renders the page shell and the city rows; this fills in every number
 * on it and keeps them moving.
 */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var pad = function (n) { return n < 10 ? '0' + n : String(n); };
  /* Not every tag a browser reports is one Intl accepts: a machine with
     LANG=en_US@posix hands over "en-US@posix", which throws a RangeError and
     would otherwise take the whole clock down. Use the first tag that
     actually constructs. */
  var locale = (function () {
    var tags = [].concat(navigator.languages || [], navigator.language || [], 'en-US');
    for (var i = 0; i < tags.length; i++) {
      try { new Intl.DateTimeFormat(tags[i]); return tags[i]; } catch (e) {}
    }
    return 'en-US';
  })();
  var reduceMotion = window.matchMedia
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---- preferences -------------------------------------------------- */
  /* localStorage can throw outright in a locked-down browser, so every
     access is guarded and the page works fine with none of it. */
  var store = {
    get: function (k, fallback) {
      try {
        var v = window.localStorage.getItem('now.' + k);
        return v === null ? fallback : v === '1';
      } catch (e) { return fallback; }
    },
    set: function (k, v) {
      try { window.localStorage.setItem('now.' + k, v ? '1' : '0'); } catch (e) {}
    }
  };

  // Whether the viewer's own locale is a 12-hour one, used as the default.
  var localeIs12 = (function () {
    try {
      var o = new Intl.DateTimeFormat(locale, { hour: 'numeric' }).resolvedOptions();
      return o.hour12 === true || o.hourCycle === 'h12' || o.hourCycle === 'h11';
    } catch (e) { return false; }
  })();

  var prefs = {
    h12: store.get('h12', localeIs12),
    seconds: store.get('seconds', true)
  };

  /* ---- time zone helpers -------------------------------------------- */
  var localZone = (function () {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; }
    catch (e) { return 'UTC'; }
  })();

  var partsCache = {};
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
     on `timeZoneName: 'shortOffset'` being available. */
  function wall(date, tz) {
    var p = {};
    var list = partsFmt(tz).formatToParts(date);
    for (var i = 0; i < list.length; i++) p[list[i].type] = list[i].value;
    var hour = +p.hour;
    if (hour === 24) hour = 0;           // some engines emit 24 for midnight
    return {
      year: +p.year, month: +p.month, day: +p.day,
      hour: hour, minute: +p.minute, second: +p.second
    };
  }

  function offsetMinutes(date, tz) {
    var w = wall(date, tz);
    var asUTC = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
    return Math.round((asUTC - Math.floor(date.getTime() / 1000) * 1000) / 60000);
  }

  function offsetLabel(mins) {
    var sign = mins < 0 ? '−' : '+';       // real minus sign, not a hyphen
    var a = Math.abs(mins);
    return 'UTC' + sign + pad(Math.floor(a / 60)) + ':' + pad(a % 60);
  }

  function longZoneName(date, tz) {
    try {
      var list = new Intl.DateTimeFormat(locale, { timeZone: tz, timeZoneName: 'long' })
        .formatToParts(date);
      for (var i = 0; i < list.length; i++) {
        if (list[i].type === 'timeZoneName') return list[i].value;
      }
    } catch (e) {}
    return '';
  }

  /* ---- calendar helpers ---------------------------------------------- */
  var DAY = 86400000;
  var startOfDay = function (d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); };

  function isoWeek(d) {
    // Thursday of the current ISO week decides which year the week belongs to.
    var t = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    var dow = (t.getDay() + 6) % 7;                  // Monday = 0
    t.setDate(t.getDate() - dow + 3);
    var firstThursday = new Date(t.getFullYear(), 0, 4);
    var fdow = (firstThursday.getDay() + 6) % 7;
    firstThursday.setDate(firstThursday.getDate() - fdow + 3);
    var week = 1 + Math.round((t - firstThursday) / (7 * DAY));
    return { year: t.getFullYear(), week: week };
  }

  function startOfWeek(d) {
    var t = startOfDay(d);
    t.setDate(t.getDate() - ((t.getDay() + 6) % 7));
    return t;
  }

  /* Spans are measured between local midnights rather than in fixed 24-hour
     blocks, so a 23- or 25-hour DST day still reads 0% at midnight and 100%
     at the next one. */
  function span(from, to, now) {
    var total = to - from;
    return { pct: Math.min(1, Math.max(0, (now - from) / total)), left: to - now };
  }

  function plural(n, word) { return n + ' ' + word + (n === 1 ? '' : 's'); }

  /* ---- DOM ------------------------------------------------------------ */
  var elTime = $('time-hm'), elSec = $('time-sec'), elSuffix = $('time-suffix');
  var elDate = $('date'), elZone = $('zone');
  var hands = { hour: $('hand-hour'), minute: $('hand-minute'), second: $('hand-second') };
  var facts = {};
  ['iso', 'utc', 'unix', 'tz', 'offset', 'week', 'doy', 'quarter'].forEach(function (k) {
    facts[k] = { value: $('fact-' + k), note: $('note-' + k) };
  });
  var bars = ['day', 'week', 'month', 'year'].map(function (k) {
    return { key: k, pct: $('pct-' + k), fill: $('fill-' + k), rest: $('rest-' + k),
             track: $('track-' + k) };
  });
  var zoneRows = [].slice.call(document.querySelectorAll('.zones li'));

  var fmtDate = new Intl.DateTimeFormat(locale,
    { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  function setText(el, text) { if (el && el.textContent !== text) el.textContent = text; }

  /* ---- painting ------------------------------------------------------- */
  function paint(now) {
    var h = now.getHours(), m = now.getMinutes(), s = now.getSeconds();
    var display = prefs.h12 ? (h % 12 === 0 ? 12 : h % 12) : h;

    setText(elTime, (prefs.h12 ? String(display) : pad(display)) + ':' + pad(m));
    setText(elSec, prefs.seconds ? ':' + pad(s) : '');
    elSec.hidden = !prefs.seconds;
    setText(elSuffix, prefs.h12 ? (h < 12 ? 'am' : 'pm') : '');
    elSuffix.hidden = !prefs.h12;

    setText(elDate, fmtDate.format(now));

    var offMins = -now.getTimezoneOffset();
    var long = longZoneName(now, localZone);
    setText(elZone, localZone + (long ? ' · ' + long : '') + ' · ' + offsetLabel(offMins));

    /* facts */
    var offForIso = (offMins < 0 ? '-' : '+')
      + pad(Math.floor(Math.abs(offMins) / 60)) + ':' + pad(Math.abs(offMins) % 60);
    setText(facts.iso.value,
      now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate())
      + 'T' + pad(h) + ':' + pad(m) + ':' + pad(s) + offForIso);
    setText(facts.iso.note, 'sortable, and unambiguous anywhere');
    setText(facts.utc.value, now.toISOString().slice(11, 19) + 'Z');
    setText(facts.utc.note, now.toISOString().slice(0, 10));
    setText(facts.unix.value, String(Math.floor(now.getTime() / 1000)));
    setText(facts.unix.note, 'seconds since 1 Jan 1970');
    setText(facts.tz.value, localZone);
    setText(facts.tz.note, long || 'as reported by your browser');
    setText(facts.offset.value, offsetLabel(offMins));

    // A zone is on summer time now if its offset differs from its January one
    // (or its July one, south of the equator).
    var jan = offsetMinutes(new Date(now.getFullYear(), 0, 1), localZone);
    var jul = offsetMinutes(new Date(now.getFullYear(), 6, 1), localZone);
    setText(facts.offset.note, jan === jul
      ? 'no seasonal change here'
      : (offMins === Math.max(jan, jul) ? 'summer time in effect' : 'standard time'));

    var wk = isoWeek(now);
    setText(facts.week.value, wk.year + '-W' + pad(wk.week));
    setText(facts.week.note, 'day ' + (((now.getDay() + 6) % 7) + 1) + ' of 7');

    var yearStart = new Date(now.getFullYear(), 0, 1);
    var doy = Math.round((startOfDay(now) - yearStart) / DAY) + 1;
    var yearEnd = new Date(now.getFullYear() + 1, 0, 1);
    var daysInYear = Math.round((yearEnd - yearStart) / DAY);
    setText(facts.doy.value, doy + ' of ' + daysInYear);
    // Whole days after today, so this cannot contradict the year bar below,
    // which counts the remainder of today too.
    setText(facts.doy.note, plural(daysInYear - doy, 'day') + ' after today');

    var q = Math.floor(now.getMonth() / 3) + 1;
    setText(facts.quarter.value, 'Q' + q + ' ' + now.getFullYear());
    setText(facts.quarter.note, ['Jan–Mar', 'Apr–Jun', 'Jul–Sep', 'Oct–Dec'][q - 1]);

    /* progress */
    var monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    var weekStart = startOfWeek(now);
    var ranges = {
      day: span(startOfDay(now), new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1), now),
      week: span(weekStart, new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + 7), now),
      month: span(monthStart, new Date(now.getFullYear(), now.getMonth() + 1, 1), now),
      year: span(yearStart, yearEnd, now)
    };
    // The sentence around it is English, so the month name is too — a locale
    // month dropped mid-sentence reads as a glitch.
    var monthName = new Intl.DateTimeFormat('en-US', { month: 'long' }).format(now);
    bars.forEach(function (bar) {
      var r = ranges[bar.key];
      var pct = r.pct * 100;
      setText(bar.pct, pct.toFixed(1) + '%');
      bar.fill.style.width = pct.toFixed(2) + '%';
      if (bar.track) bar.track.setAttribute('aria-valuenow', pct.toFixed(0));
      var mins = Math.floor(r.left / 60000);
      var rest;
      if (bar.key === 'day') {
        rest = Math.floor(mins / 60) + 'h ' + pad(mins % 60) + 'm left today';
      } else if (bar.key === 'week') {
        rest = Math.floor(mins / 1440) + 'd ' + (Math.floor(mins / 60) % 24) + 'h left this week';
      } else {
        rest = plural(Math.ceil(r.left / DAY), 'day') + ' left in '
          + (bar.key === 'month' ? monthName : String(now.getFullYear()));
      }
      setText(bar.rest, rest);
    });

    /* world clocks */
    var localDay = now.getFullYear() * 10000 + (now.getMonth() + 1) * 100 + now.getDate();
    zoneRows.forEach(function (row) {
      var tz = row.dataset.tz;
      var w, off;
      try { w = wall(now, tz); off = offsetMinutes(now, tz); }
      catch (e) { row.hidden = true; return; }

      var zh = prefs.h12 ? (w.hour % 12 === 0 ? 12 : w.hour % 12) : w.hour;
      setText(row.querySelector('.zt-time'),
        (prefs.h12 ? String(zh) : pad(zh)) + ':' + pad(w.minute));
      var suffix = row.querySelector('.zsuffix');
      setText(suffix, prefs.h12 ? (w.hour < 12 ? 'am' : 'pm') : '');
      suffix.hidden = !prefs.h12;

      var delta = (off - offMins) / 60;
      var rel = delta === 0 ? 'same time'
        : (delta > 0 ? '+' : '−') + (Math.abs(delta) % 1 ? Math.abs(delta).toFixed(1) : Math.abs(delta)) + 'h';
      setText(row.querySelector('.off'), rel);

      var thereDay = w.year * 10000 + w.month * 100 + w.day;
      setText(row.querySelector('.dayrel'),
        thereDay === localDay ? '' : (thereDay > localDay ? 'tomorrow' : 'yesterday'));

      // Rough daylight banding, from the local hour alone — a hint, not a
      // sunrise table.
      var dot = row.querySelector('.dot');
      var band = w.hour >= 7 && w.hour < 18 ? 'day'
        : (w.hour >= 18 && w.hour < 21) || (w.hour >= 5 && w.hour < 7) ? 'dusk' : 'night';
      if (dot.className !== 'dot ' + band) dot.className = 'dot ' + band;
      row.classList.toggle('here', tz === localZone);
    });

    document.title = (prefs.h12 ? String(display) : pad(display)) + ':' + pad(m)
      + (prefs.h12 ? (h < 12 ? 'am' : 'pm') : '') + ' · Now';

    var pending = document.querySelectorAll('.pending');
    for (var i = 0; i < pending.length; i++) pending[i].classList.remove('pending');
  }

  function turnHands(now) {
    var ms = reduceMotion ? 0 : now.getMilliseconds();
    var s = now.getSeconds() + ms / 1000;
    var m = now.getMinutes() + s / 60;
    var h = (now.getHours() % 12) + m / 60;
    hands.hour.style.transform = 'rotate(' + (h * 30) + 'deg)';
    hands.minute.style.transform = 'rotate(' + (m * 6) + 'deg)';
    hands.second.style.transform = 'rotate(' + (s * 6) + 'deg)';
  }

  /* ---- controls -------------------------------------------------------- */
  function syncControls() {
    var f = $('toggle-format'), c = $('toggle-seconds');
    f.setAttribute('aria-pressed', prefs.h12 ? 'true' : 'false');
    f.textContent = prefs.h12 ? '12-hour' : '24-hour';
    c.setAttribute('aria-pressed', prefs.seconds ? 'true' : 'false');
  }

  $('toggle-format').addEventListener('click', function () {
    prefs.h12 = !prefs.h12;
    store.set('h12', prefs.h12);
    syncControls();
    paint(new Date());
  });
  $('toggle-seconds').addEventListener('click', function () {
    prefs.seconds = !prefs.seconds;
    store.set('seconds', prefs.seconds);
    syncControls();
    paint(new Date());
  });

  /* ---- loop ------------------------------------------------------------ */
  /* Every live figure starts hidden, so a script that dies leaves a page of
     nothing rather than an obviously broken clock. Say so instead. */
  function fail(err) {
    running = false;
    var note = $('boot-error');
    if (note) note.hidden = false;
    if (window.console && console.error) console.error('clock stopped:', err);
  }

  var running = true;
  var lastSecond = -1;
  function frame() {
    if (!running) return;
    try {
      var now = new Date();
      turnHands(now);
      var s = Math.floor(now.getTime() / 1000);
      if (s !== lastSecond) { lastSecond = s; paint(now); }
    } catch (e) { fail(e); return; }
    requestAnimationFrame(frame);
  }

  try {
    $('controls').hidden = false;
    syncControls();
    paint(new Date());
    requestAnimationFrame(frame);
  } catch (e) { fail(e); }
})();
