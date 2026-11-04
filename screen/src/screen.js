/* Screen & Seat — the maths.
 *
 * One implementation, imported by the browser (app.js), the unit tests and
 * the deploy gate (verify.mjs, which runs it from the built copy). Every
 * length is in inches and every angle in degrees unless a name says otherwise.
 * Nothing here touches the DOM.
 */

const DEG = Math.PI / 180;
export const ARCMIN = 1 / 60;            // one minute of arc, in degrees

/* Picture shapes. `ratio` is width over height. */
export const ASPECTS = [
  { id: '16:9', label: '16:9 — TV, HD/UHD', ratio: 16 / 9 },
  { id: '16:10', label: '16:10 — monitor', ratio: 16 / 10 },
  { id: '21:9', label: '21:9 ultrawide (2.37:1)', ratio: 2560 / 1080 },
  { id: '1.85', label: '1.85:1 — flat cinema', ratio: 1.85 },
  { id: '2.35', label: '2.35:1 — scope', ratio: 2.35 },
  { id: '2.39', label: '2.39:1 — scope', ratio: 2.39 },
  { id: '4:3', label: '4:3 — classic', ratio: 4 / 3 },
  { id: '1.43', label: '1.43:1 — IMAX', ratio: 1.43 },
];

/* Panel resolutions, pixels across and down. */
export const RESOLUTIONS = [
  { id: '720', label: '720p (1280 × 720)', w: 1280, h: 720 },
  { id: '1080', label: '1080p (1920 × 1080)', w: 1920, h: 1080 },
  { id: '1440', label: '1440p (2560 × 1440)', w: 2560, h: 1440 },
  { id: '2160', label: '4K UHD (3840 × 2160)', w: 3840, h: 2160 },
  { id: 'dci4k', label: 'DCI 4K (4096 × 2160)', w: 4096, h: 2160 },
  { id: '4320', label: '8K UHD (7680 × 4320)', w: 7680, h: 4320 },
];

/* Seating standards expressed as a horizontal viewing angle: the angle the
   picture's width subtends at the eye. These are the figures each body
   publishes; the distance each implies depends on the screen's width, so it
   is computed, never stored. */
export const ANGLE_STANDARDS = [
  { id: 'thx-best', label: 'THX best seat', short: 'THX 40°', angle: 40,
    note: 'THX’s optimum for the main seat: diagonal × 1.2 on a 16:9 screen.' },
  { id: 'thx', label: 'THX recommended', short: 'THX 36°', angle: 36,
    note: 'The angle THX recommends for a home cinema seat.' },
  { id: 'smpte', label: 'SMPTE minimum', short: 'SMPTE 30°', angle: 30,
    note: 'SMPTE EG-18’s floor for a cinematic picture; the common “immersive” threshold.' },
  { id: 'thx-far', label: 'THX farthest seat', short: 'THX 26°', angle: 26,
    note: 'The least THX accepts for the back row of a certified theatre.' },
];

/* ITU-R BT.2022 / BT.2020 design viewing distances, in picture heights. Each
   is the distance at which one pixel of that format subtends about one
   minute of arc, rounded as the recommendation publishes it. */
export const ITU_STANDARDS = [
  { id: 'itu-hd', label: 'ITU-R BT.2022 — HDTV', short: 'ITU 1080p', heights: 3.2, res: '1080' },
  { id: 'itu-uhd', label: 'ITU-R BT.2020 — UHD 4K', short: 'ITU 4K', heights: 1.5, res: '2160' },
  { id: 'itu-8k', label: 'ITU-R BT.2020 — UHD 8K', short: 'ITU 8K', heights: 0.75, res: '4320' },
];

/* The pre-HD rule of thumb, as a multiple of the diagonal. */
export const RULE_OF_THUMB = { near: 1.5, far: 2.5 };

/* Picture brightness targets, in foot-lamberts, for a projected image. */
export const BRIGHTNESS = {
  cinema: 14,       // SMPTE ST 431-1: 14 fL (48 cd/m²) at screen centre
  sdrHome: 16,      // the floor most calibrators aim above at home
  bright: 30,       // bright-room / HDR-leaning target
};
export const FL_PER_NIT = 1 / 3.426;   // 1 fL = 3.426 cd/m²

/* Comfort limits for where the picture sits vertically. */
export const PLACEMENT = {
  maxUp: 15,        // centre of the screen no more than 15° above the eye
  maxDown: 10,
};

export const aspect = id => ASPECTS.find(a => a.id === id) || ASPECTS[0];
export const resolution = id => RESOLUTIONS.find(r => r.id === id) || RESOLUTIONS[1];

/* ---- geometry ------------------------------------------------------ */

/* Width, height and area of a picture from its diagonal and shape. */
export function dims(diagonal, ratio) {
  const k = Math.sqrt(1 + ratio * ratio);
  const height = diagonal / k;
  const width = height * ratio;
  return { diagonal, ratio, width, height, area: width * height };
}

/* Diagonal of a picture of the given width. */
export const diagonalForWidth = (width, ratio) => width * Math.sqrt(1 + 1 / (ratio * ratio));

/* Angle a span subtends at the eye, viewed square-on from its centre. */
export const subtended = (span, distance) =>
  distance > 0 ? 2 * Math.atan(span / (2 * distance)) / DEG : 180;

export const hfov = (d, distance) => subtended(d.width, distance);
export const vfov = (d, distance) => subtended(d.height, distance);

/* Distance from which a span subtends the angle. */
export const distanceForAngle = (span, angle) => span / (2 * Math.tan(angle / 2 * DEG));

/* The diagonal that fills `angle` from `distance`. */
export const diagonalForAngle = (distance, angle, ratio) =>
  diagonalForWidth(2 * distance * Math.tan(angle / 2 * DEG), ratio);

/* Distance for each seating standard, for one screen. */
export function seatingDistances(d) {
  return ANGLE_STANDARDS.map(s => ({ ...s, distance: distanceForAngle(d.width, s.angle) }));
}

/* The ITU distances for a screen, in inches, with the angle each implies. */
export function ituDistances(d) {
  return ITU_STANDARDS.map(s => {
    const distance = s.heights * d.height;
    return { ...s, distance, angle: hfov(d, distance) };
  });
}

/* ---- resolution ---------------------------------------------------- */

/* Pixel pitch when a panel is scaled to fit inside the picture area: the
   larger of the two scale factors is the one that would spill over. */
export function pixelPitch(d, res) {
  return Math.min(d.width / res.w, d.height / res.h);
}

/* Angle one pixel subtends at the centre of the picture, in degrees. */
export const pixelAngle = (pitch, distance) => subtended(pitch, distance);

/* Pixels per degree at the centre — 60 is the 20/20 (one arc-minute) line. */
export const pixelsPerDegree = (pitch, distance) => 1 / pixelAngle(pitch, distance);

/* Distance beyond which an eye of the given acuity (in arc-minutes per
   resolvable cycle — 1.0 is 20/20) can no longer see individual pixels. */
export const acuityDistance = (pitch, arcmin = 1) => pitch / Math.tan(arcmin * ARCMIN * DEG);

/* For every resolution: how far the pixels stay visible from on this screen. */
export function acuityTable(d, arcmin = 1) {
  return RESOLUTIONS.map(r => {
    const pitch = pixelPitch(d, r);
    return { ...r, pitch, distance: acuityDistance(pitch, arcmin) };
  });
}

/* ---- projector ----------------------------------------------------- */

/* Throw distance for an image width: ratio = distance / width. */
export const throwDistance = (width, ratio) => width * ratio;
export const widthAtThrow = (distance, ratio) => distance / ratio;

/* Where the lens centre sits relative to the picture centre, given the
   offset the maker quotes: a percentage of picture height from the lens
   axis to the picture centre. Positive means the picture sits above the lens
   (the usual table-top case); 50% puts the bottom edge level with the lens. */
export const lensOffsetInches = (d, offsetPct) => d.height * offsetPct / 100;

/* Foot-lamberts off a screen: lumens × gain over the area in square feet. */
export const footLamberts = (lumens, gain, d) => lumens * gain / (d.area / 144);
export const nits = fl => fl / FL_PER_NIT;

/* ---- placement ----------------------------------------------------- */

/* Angle of the eye line to a point `rise` above eye level at `distance`. */
export const elevation = (rise, distance) => Math.atan2(rise, distance) / DEG;

export function placement(d, distance, eyeHeight, centreHeight) {
  const centre = elevation(centreHeight - eyeHeight, distance);
  const top = elevation(centreHeight + d.height / 2 - eyeHeight, distance);
  const bottom = elevation(centreHeight - d.height / 2 - eyeHeight, distance);
  const ok = centre <= PLACEMENT.maxUp && centre >= -PLACEMENT.maxDown;
  // The highest centre that still keeps the eye line inside the comfort band.
  const maxCentre = eyeHeight + distance * Math.tan(PLACEMENT.maxUp * DEG);
  return { centre, top, bottom, ok, maxCentre, bottomEdge: centreHeight - d.height / 2 };
}

/* ---- verdicts ------------------------------------------------------ */

/* Where an angle lands among the seating standards, as prose. */
export function describeAngle(angle) {
  const s = ANGLE_STANDARDS;
  if (angle >= s[0].angle + 10) return `wider than any standard asks — a front-row seat`;
  if (angle >= s[0].angle) return `at or inside THX’s best-seat ${s[0].angle}°`;
  for (let i = 1; i < s.length; i++) {
    if (angle >= s[i].angle) return `between ${s[i].short} and ${s[i - 1].short}`;
  }
  if (angle >= 20) return `narrower than THX’s back-row ${s.at(-1).angle}°: a television, not a cinema`;
  return `a small picture: well under every cinema standard`;
}

/* Is the resolution doing anything from here? */
export function describeResolution(d, res, distance, arcmin = 1) {
  const pitch = pixelPitch(d, res);
  const limit = acuityDistance(pitch, arcmin);
  const ppd = pixelsPerDegree(pitch, distance);
  const lower = RESOLUTIONS.filter(r => r.w < res.w)
    .map(r => ({ ...r, limit: acuityDistance(pixelPitch(d, r), arcmin) }))
    .filter(r => distance >= r.limit)
    .sort((a, b) => a.w - b.w)[0];
  return { pitch, limit, ppd, wasted: distance > limit, lower };
}
