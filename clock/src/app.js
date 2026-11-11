/* Now — the live half of the page.
 *
 * Everything here reads the device clock and the browser's own time zone
 * database through Intl. The build renders the page shell and the city rows;
 * this fills in every number on it and keeps them moving. The arithmetic
 * behind the numbers is in time.js, where the tests can reach it.
 */
import {
  pad, plural, isoWeek, dayOfYear, daysInYear, daysLeftInMonth, daysLeftInYear, progress,
  offsetLabel, isoLocal, relativeOffset, seasonNote, wall, offsetMinutes, sameZone, dayBand
} from './time.js';

(function () {
  'use strict';

  /* A slot the markup does not have is a broken page, not something to paint
     around. Every miss is noted here and the boot at the bottom refuses to
     start on any, so the visitor is told instead of shown a dash that never
     fills in. */
  var missing = [];
  var $ = function (id) {
    var el = document.getElementById(id);
    if (!el) missing.push(id);
    return el;
  };
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
  // Asked each time rather than once, so a change to the setting takes effect.
  var motion = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  function reducedMotion() { return !!(motion && motion.matches); }

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

  /* Built once: constructing a formatter costs far more than using it, and
     paint() runs every second. */
  var fmtZoneName = (function () {
    try {
      return new Intl.DateTimeFormat(locale, { timeZone: localZone, timeZoneName: 'long' });
    } catch (e) { return null; }
  })();

  function longZoneName(date) {
    if (!fmtZoneName) return '';
    try {
      var list = fmtZoneName.formatToParts(date);
      for (var i = 0; i < list.length; i++) {
        if (list[i].type === 'timeZoneName') return list[i].value;
      }
    } catch (e) {}
    return '';
  }

  /* ---- DOM ------------------------------------------------------------ */
  var elTime = $('time-hm'), elSec = $('time-sec'), elSuffix = $('time-suffix');
  var elDate = $('date'), elZone = $('zone');
  var hands = { hour: $('hand-hour'), minute: $('hand-minute'), second: $('hand-second') };
  /* One slot per key, looked up by prefix. build.mjs renders the slots from
     its own lists; verify.mjs reads these two and the prefixes used with each,
     and checks every prefix-key id against the markup in both directions. Keep
     them as plain literals so it can. */
  var FACT_KEYS = ['iso', 'utc', 'unix', 'tz', 'offset', 'week', 'doy', 'quarter'];
  var BAR_KEYS = ['day', 'week', 'month', 'year'];
  var facts = {};
  FACT_KEYS.forEach(function (k) {
    facts[k] = { value: $('fact-' + k), note: $('note-' + k) };
  });
  var bars = BAR_KEYS.map(function (k) {
    return { key: k, pct: $('pct-' + k), fill: $('fill-' + k), rest: $('rest-' + k),
             track: $('track-' + k) };
  });
  var zoneRows = [].slice.call(document.querySelectorAll('.zones li'));
  /* The viewer's own row, decided once. The names are compared as the browser
     files them, not as strings: Chromium calls India Asia/Calcutta and the
     row is configured as Asia/Kolkata. */
  var zoneHere = zoneRows.map(function (row) { return sameZone(row.dataset.tz, localZone); });

  var fmtDate = new Intl.DateTimeFormat(locale,
    { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  // The sentence around it is English, so the month name is too — a locale
  // month dropped mid-sentence reads as a glitch.
  var fmtMonth = new Intl.DateTimeFormat('en-US', { month: 'long' });

  /* No allowance for a missing element: a null here throws, and the loop
     turns that into the boot-error note rather than a slot left blank. */
  function setText(el, text) { if (el.textContent !== text) el.textContent = text; }

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
    var long = longZoneName(now);
    setText(elZone, localZone + (long ? ' · ' + long : '') + ' · ' + offsetLabel(offMins));

    /* facts */
    setText(facts.iso.value, isoLocal(now));
    setText(facts.iso.note, 'sortable, and unambiguous anywhere');
    setText(facts.utc.value, now.toISOString().slice(11, 19) + 'Z');
    setText(facts.utc.note, now.toISOString().slice(0, 10));
    setText(facts.unix.value, String(Math.floor(now.getTime() / 1000)));
    setText(facts.unix.note, 'seconds since 1 Jan 1970');
    setText(facts.tz.value, localZone);
    setText(facts.tz.note, long || 'as reported by your browser');
    setText(facts.offset.value, offsetLabel(offMins));

    var jan = offsetMinutes(new Date(now.getFullYear(), 0, 1), localZone);
    var jul = offsetMinutes(new Date(now.getFullYear(), 6, 1), localZone);
    setText(facts.offset.note, seasonNote(offMins, jan, jul));

    var wk = isoWeek(now);
    setText(facts.week.value, wk.year + '-W' + pad(wk.week));
    setText(facts.week.note, 'day ' + (((now.getDay() + 6) % 7) + 1) + ' of 7');

    var doy = dayOfYear(now);
    var inYear = daysInYear(now.getFullYear());
    setText(facts.doy.value, doy + ' of ' + inYear);
    // Whole days after today. The year bar below counts today as well, so it
    // reads exactly one more than this at every moment of the day.
    setText(facts.doy.note, plural(inYear - doy, 'day') + ' after today');

    var q = Math.floor(now.getMonth() / 3) + 1;
    setText(facts.quarter.value, 'Q' + q + ' ' + now.getFullYear());
    setText(facts.quarter.note, ['Jan–Mar', 'Apr–Jun', 'Jul–Sep', 'Oct–Dec'][q - 1]);

    /* progress */
    var ranges = progress(now);
    bars.forEach(function (bar) {
      var r = ranges[bar.key];
      var pct = r.pct * 100;
      setText(bar.pct, pct.toFixed(1) + '%');
      bar.fill.style.width = pct.toFixed(2) + '%';
      bar.track.setAttribute('aria-valuenow', pct.toFixed(0));
      var mins = Math.floor(r.left / 60000);
      var rest;
      if (bar.key === 'day') {
        rest = Math.floor(mins / 60) + 'h ' + pad(mins % 60) + 'm left today';
      } else if (bar.key === 'week') {
        rest = Math.floor(mins / 1440) + 'd ' + (Math.floor(mins / 60) % 24) + 'h left this week';
      } else if (bar.key === 'month') {
        rest = plural(daysLeftInMonth(now), 'day') + ' left in ' + fmtMonth.format(now);
      } else {
        rest = plural(daysLeftInYear(now), 'day') + ' left in ' + now.getFullYear();
      }
      setText(bar.rest, rest);
    });

    /* world clocks */
    var localDay = now.getFullYear() * 10000 + (now.getMonth() + 1) * 100 + now.getDate();
    zoneRows.forEach(function (row, i) {
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

      setText(row.querySelector('.off'), relativeOffset(off - offMins));

      var thereDay = w.year * 10000 + w.month * 100 + w.day;
      setText(row.querySelector('.dayrel'),
        thereDay === localDay ? '' : (thereDay > localDay ? 'tomorrow' : 'yesterday'));

      var dot = row.querySelector('.dot');
      var band = dayBand(w.hour);
      if (dot.className !== 'dot ' + band) dot.className = 'dot ' + band;
      row.classList.toggle('here', zoneHere[i]);
    });

    document.title = (prefs.h12 ? String(display) : pad(display)) + ':' + pad(m)
      + (prefs.h12 ? (h < 12 ? 'am' : 'pm') : '') + ' · Now';

    var pending = document.querySelectorAll('.pending');
    for (var i = 0; i < pending.length; i++) pending[i].classList.remove('pending');
  }

  /* The hands sweep between seconds only while the frame loop below is
     running; stepped from the timer they land exactly on the second. */
  function turnHands(now) {
    var ms = sweeping ? now.getMilliseconds() : 0;
    var s = now.getSeconds() + ms / 1000;
    var m = now.getMinutes() + s / 60;
    var h = (now.getHours() % 12) + m / 60;
    hands.hour.style.transform = 'rotate(' + (h * 30) + 'deg)';
    hands.minute.style.transform = 'rotate(' + (m * 6) + 'deg)';
    hands.second.style.transform = 'rotate(' + (s * 6) + 'deg)';
  }

  /* ---- controls -------------------------------------------------------- */
  /* Each button keeps its label and says whether it is on through
     aria-pressed, so "12-hour, pressed" means the same thing to a screen
     reader as the highlighted pill does on screen. */
  function syncControls() {
    $('toggle-format').setAttribute('aria-pressed', prefs.h12 ? 'true' : 'false');
    $('toggle-seconds').setAttribute('aria-pressed', prefs.seconds ? 'true' : 'false');
  }

  function bindControls() {
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
  }

  /* ---- loop ------------------------------------------------------------ */
  var running = true;
  var timer = 0;
  var sweeping = false;

  /* Every live figure starts hidden, so a script that dies leaves a page of
     nothing rather than an obviously broken clock. Say so instead. */
  function fail(err) {
    running = false;
    clearTimeout(timer);
    var note = $('boot-error');
    if (note) note.hidden = false;
    if (window.console && console.error) console.error('clock stopped:', err);
  }

  /* The figures change once a second, so they are painted from a timer aimed
     at the next second boundary. A timer keeps firing in a background tab,
     throttled but never stopped, and that is what keeps the time in the tab
     title right while the page itself is out of sight. Animation frames stop
     there altogether. */
  function tick() {
    if (!running) return;
    try {
      var now = new Date();
      paint(now);
      if (!sweeping) turnHands(now);
    } catch (e) { fail(e); return; }
    timer = setTimeout(tick, 1000 - (Date.now() % 1000));
  }

  /* Animation frames are for the sweep of the hands and nothing else, and
     only for a viewer who has not asked for less motion. */
  function sweep() {
    if (!running || reducedMotion()) { sweeping = false; return; }
    try { turnHands(new Date()); } catch (e) { fail(e); return; }
    requestAnimationFrame(sweep);
  }

  function startSweep() {
    if (sweeping || !running || reducedMotion()) return;
    sweeping = true;
    requestAnimationFrame(sweep);
  }

  // A throttled background tab can be most of a minute behind when it returns.
  document.addEventListener('visibilitychange', function () {
    if (document.hidden || !running) return;
    clearTimeout(timer);
    tick();
  });

  // Turning the setting off restarts the sweep; turning it on stops it above.
  if (motion) {
    if (motion.addEventListener) motion.addEventListener('change', startSweep);
    else if (motion.addListener) motion.addListener(startSweep);
  }

  try {
    if (missing.length) throw new Error('the page has no #' + missing.join(', #'));
    $('controls').hidden = false;
    bindControls();
    syncControls();
    tick();
    startSweep();
  } catch (e) { fail(e); }
})();
