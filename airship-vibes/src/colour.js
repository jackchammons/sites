/*
 * Colours, as the scenes write them and as the shaders want them.
 *
 * A scene's colours are sRGB hex, the way anyone would pick them. The shaders
 * light in linear light, so each is taken through the curve on its way in.
 */

export function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255];
}

// The shaders use a plain 2.2 curve in both directions; scene colours handed to them go through this.
export const toLinear = hex => hexToRgb(hex).map(c => c ** 2.2);
