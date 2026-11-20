/*
 * Palettes, and the table that maps any colour onto one.
 *
 * A scene is rendered in continuous colour and then every pixel is replaced
 * by a colour from the scene's palette. To keep gradients, a pixel that falls
 * between two palette colours is given one or the other in an ordered pattern,
 * in proportion to how far along the line between them it lies. Finding the
 * pair for a colour means searching the palette twice, which is too slow per
 * pixel on a phone, so it is done once per scene for a lattice of colours and
 * stored in a small 3D texture: buildLut().
 *
 * Distances are measured in Oklab, where equal steps look equal.
 */

export function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255];
}
export const srgbToLinear = c => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
// The shaders use a plain 2.2 curve; scene colours handed to them go through this.
export const toLinear = hex => hexToRgb(hex).map(c => c ** 2.2);

export function oklab([r, g, b]) {
  const lr = srgbToLinear(r), lg = srgbToLinear(g), lb = srgbToLinear(b);
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return [
    0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s,
  ];
}

/* For one colour: the nearest palette entry, the entry that best continues
   through the colour from there, and how far toward it the colour lies
   (0 = on the first, 0.5 = halfway). labs is the palette in Oklab. */
export function nearestPair(lab, labs) {
  let i1 = 0, d1 = Infinity;
  for (let i = 0; i < labs.length; i++) {
    const dl = labs[i][0] - lab[0], da = labs[i][1] - lab[1], db = labs[i][2] - lab[2];
    const d = dl * dl + da * da + db * db;
    if (d < d1) { d1 = d; i1 = i; }
  }
  const c1 = labs[i1];
  const vx = lab[0] - c1[0], vy = lab[1] - c1[1], vz = lab[2] - c1[2];
  let i2 = i1, best = Infinity, t = 0;
  for (let i = 0; i < labs.length; i++) {
    if (i === i1) continue;
    const ex = labs[i][0] - c1[0], ey = labs[i][1] - c1[1], ez = labs[i][2] - c1[2];
    const ee = ex * ex + ey * ey + ez * ez;
    if (ee < 1e-9) continue;
    const pr = (vx * ex + vy * ey + vz * ez) / ee;
    if (pr <= 0) continue;
    // How far the colour sits from the line to this candidate, with a small
    // charge for long lines so that neighbours on a ramp are preferred.
    const rx = vx - ex * pr, ry = vy - ey * pr, rz = vz - ez * pr;
    const cost = rx * rx + ry * ry + rz * rz + 0.08 * ee;
    if (cost < best) { best = cost; i2 = i; t = pr; }
  }
  return { i1, i2, t: Math.min(Math.max(t, 0), 0.5) };
}

/* A size^3 table over sRGB: red along x, green along y, blue along z, four
   bytes per entry: first index, second index, 255 * t, 255. */
export function buildLut(palette, size = 32) {
  const labs = palette.map(h => oklab(hexToRgb(h)));
  const out = new Uint8Array(size * size * size * 4);
  let o = 0;
  for (let b = 0; b < size; b++) {
    for (let g = 0; g < size; g++) {
      for (let r = 0; r < size; r++) {
        const { i1, i2, t } = nearestPair(oklab([r / (size - 1), g / (size - 1), b / (size - 1)]), labs);
        out[o++] = i1; out[o++] = i2; out[o++] = Math.round(t * 255); out[o++] = 255;
      }
    }
  }
  return out;
}

// The palette as RGBA bytes, one texel per colour.
export function paletteBytes(palette) {
  const out = new Uint8Array(palette.length * 4);
  palette.forEach((h, i) => {
    const [r, g, b] = hexToRgb(h);
    out.set([Math.round(r * 255), Math.round(g * 255), Math.round(b * 255), 255], i * 4);
  });
  return out;
}

// Index of the lightest and of the darkest colour: the caption's ink and shadow.
export function extremes(palette) {
  const ls = palette.map(h => oklab(hexToRgb(h))[0]);
  return { light: ls.indexOf(Math.max(...ls)), dark: ls.indexOf(Math.min(...ls)) };
}
