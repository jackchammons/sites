/*
 * What a touch or a click meant.
 *
 * The canvas takes three gestures: a tap (the next shot), a swipe left (the
 * next shot) or right (the one before), and a double tap (the next scene).
 * This module only names them, from where and when a pointer went down and
 * came up, so the rules can be tested without a browser. app.js decides what
 * each one does.
 */
export const TAP_SLOP = 14;        // px a finger may wander and still have tapped
export const TAP_MS = 500;         // held longer than this, it was not a tap
export const SWIPE_MIN = 44;       // px a swipe must travel
export const SWIPE_MS = 900;
export const DOUBLE_MS = 320;      // two taps this close together are a double tap
export const DOUBLE_SLOP = 48;     // ...if they are also this close on the screen

/* down and up are { x, y, t } in CSS pixels and milliseconds.
   Returns 'tap', 'left', 'right' or null. */
export function classify(down, up) {
  const dx = up.x - down.x, dy = up.y - down.y, dt = up.t - down.t;
  const far = Math.hypot(dx, dy);
  if (far <= TAP_SLOP) return dt <= TAP_MS ? 'tap' : null;
  // a swipe is mostly sideways: a drag up or down is someone scrolling out of habit
  if (Math.abs(dx) >= SWIPE_MIN && Math.abs(dx) > Math.abs(dy) * 1.5 && dt <= SWIPE_MS) return dx < 0 ? 'left' : 'right';
  return null;
}

// Is this tap the second of a pair? `before` is the last tap, or null.
export function isDouble(before, tap) {
  return !!before && tap.t - before.t <= DOUBLE_MS && Math.hypot(tap.x - before.x, tap.y - before.y) <= DOUBLE_SLOP;
}
