/*
 * How big the picture is.
 *
 * The art is drawn at about the same number of pixels on every screen, so a
 * phone and a 4K monitor show the same chunky picture and cost about the same
 * to draw. Each art pixel covers a whole number of device pixels, which is
 * what keeps the edges hard.
 */
export const TARGET_PIXELS = 84000;

export function artSize(deviceWidth, deviceHeight, target = TARGET_PIXELS, forced = 0) {
  const w = Math.max(1, Math.floor(deviceWidth)), h = Math.max(1, Math.floor(deviceHeight));
  const scale = forced > 0 ? Math.floor(forced) : Math.max(1, Math.ceil(Math.sqrt(w * h / target)));
  return { scale, width: Math.max(1, Math.ceil(w / scale)), height: Math.max(1, Math.ceil(h / scale)) };
}
