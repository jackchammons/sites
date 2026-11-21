/*
 * The scenes.
 *
 * Each is data: a sun, a sky, haze, the ground it flies over, the flight, the
 * lights aboard and a list of camera shots. The renderer reads these and
 * nothing else, so a scene is tuned here without touching a shader.
 *
 * Colours are sRGB hex. Distances are metres, angles degrees. A shot's camera
 * is in the airship's frame: x forward, y to port, z up, origin at the middle
 * of the hull; the gondola hangs under x = 5..30 at about z = -23.
 *
 * land.range is the lowest and the highest the scene's ground can be. The
 * renderer leaves out the ground the camera cannot see, and judges that from
 * these: too wide costs a little speed, too narrow cuts holes in mountains.
 *
 * cloud.steps is the most steps a ray through cloud may take, and
 * cloud.through the least a layer is crossed in. A thin layer wants many: with
 * too few it is only seen where it happens to cross a step, in terraces.
 */

// The grids the ground is drawn on: [reach, spacing] bands, finest first.
const GRID = {
  x: [[1536, 32], [4608, 64], [10752, 128], [23040, 256], [47616, 512]],
  y: [[1536, 32], [4608, 64], [10752, 128], [21504, 256]],
};

const shot = (name, dur, from, to, tall) => ({ name, dur, from, to, tall });
const cam = (pos, look, fov) => ({ pos, look, fov });

// On an upright phone the gondola is too long to take side-on from close by:
// the close shot comes round toward the bow and looks back along it.
const TALL_GONDOLA = { from: cam([78, -34, -34], [16, 0, -19], 40), to: cam([70, -40, -30], [16, 0, -19], 40) };

/* ---- the valley ---------------------------------------------------------- */

const valley = {
  id: 'valley',
  title: 'THE VALLEY',
  terrain: 0,
  grid: GRID,
  look: { glow: 0.5, outline: 0.22, vignette: 0.0 },
  sun: { dir: [0.42, -0.78, 0.46], colour: '#fff1d8', strength: 0.96, disc: '#fffbe8', glow: '#fff3c8', shape: [0.99996, 900, 0.6, 0.1] },
  ambient: { sky: '#86aee0', skyStrength: 0.34, ground: '#8c9a80', groundStrength: 0.2 },
  sky: { top: '#2d6cc4', mid: '#5fa4e4', low: '#bfe2f2', shape: [0.25, 0.9], stars: [0, 0, 0, 0],
    bands: { cover: 0.34, scale: 0.00016, stretch: 2.6, height: 9000, lit: '#ffffff', dark: '#c9dcef' } },
  fog: { colour: '#b6d6ee', sun: '#e6eedd', density: 6.0e-5, falloff: 1 / 2200, max: 0.94, sunPower: 5 },
  cloud: { kind: 1, floor: 1650, ceiling: 2700, cover: 0.47, density: 1.0, size: 5200, detail: 1100, drift: [9, 2.5],
    lit: '#ffffff', dark: '#a9bcdc', deep: '#7f92bc', steps: 56, through: 22, grow: 0.11, reach: 34000, lightStep: 170, shade: 1.3, opacity: 0.02, shadow: 0.55 },
  land: {
    seaLevel: 0, range: [0, 8300],
    colours: ['#b4d564', '#86bd52', '#a9b46c', '#4f9a4a', '#2c7040', '#6f6f7c', '#b9ae9e', '#ffffff',
      '#dccfb6', '#4fa0c8', '#17567f', '#d2dc7c'],
  },
  path: { amp1: 420, freq1: 0.00037, amp2: 190, freq2: 0.00093 },
  flight: { speed: 14, altitude: 430, heave: 4, pitch: 0.7, roll: 0.5 },
  ship: { glass: 1.0, roomTint: '#ffd9a0', lights: 0.12, always: {}, bounce: '#a9b890', bounceStrength: 0.1, lamps: 0.3 },
  birds: {
    colour: '#ffffff',
    flocks: [
      { count: 8, centre: [60, -160, -150], drift: [4, 0, 0], range: 700, spread: 20, formation: 'loose', span: 2.0, flap: 6 },
      { count: 6, centre: [-100, 220, -40], drift: [-5, 0, 0], range: 800, spread: 16, formation: 'v', span: 2.4, flap: 4.6 },
    ],
  },
  shots: [
    shot('wide', 52, cam([70, -350, 4], [0, 0, -4], 46), cam([-10, -330, 12], [0, 0, -4], 46),
      { from: cam([150, -400, -40], [0, 0, 20], 32), to: cam([90, -420, -20], [0, 0, 20], 32) }),
    shot('gondola', 44, cam([52, -34, -30], [17, 0, -22.5], 30), cam([44, -38, -27], [17, 0, -22.5], 30), TALL_GONDOLA),
    shot('chase', 48, cam([-230, -60, 50], [60, 0, -30], 34), cam([-200, -40, 40], [60, 0, -30], 34)),
    shot('below', 44, cam([150, -70, -110], [0, 0, 0], 32), cam([130, -50, -100], [0, 0, 0], 32)),
    shot('high', 48, cam([-140, -260, 250], [10, 0, -60], 30), cam([-110, -280, 230], [10, 0, -60], 30)),
    shot('prow', 40, cam([41, -13, -21.2], [28, 0, -21.9], 34), cam([39, -15, -21.0], [28, 0, -21.9], 34)),
  ],
};

/* ---- sunset over a drowned coast ------------------------------------------ */

const sunset = {
  id: 'sunset',
  title: 'LAST LIGHT',
  terrain: 1,
  grid: GRID,
  look: { glow: 0.9, outline: 0.0, vignette: 0.25 },
  sun: { dir: [0.45, 0.89, 0.075], colour: '#ffb060', strength: 1.05, disc: '#fff6d0', discStrength: 1.4, glow: '#ff9a48', shape: [0.99952, 60, 0.55, 0.42] },
  ambient: { sky: '#6a5a9c', skyStrength: 0.34, ground: '#5a3a56', groundStrength: 0.2 },
  sky: { top: '#231c4c', mid: '#a04f86', low: '#ffac5a', shape: [0.2, 0.75], stars: [0, 0, 0, 0],
    bands: { cover: 0.5, scale: 0.00012, stretch: 3.4, height: 9000, lit: '#ffb466', dark: '#6b3a70' } },
  fog: { colour: '#b0647e', sun: '#ffb866', density: 6.5e-5, falloff: 1 / 1500, max: 0.97, sunPower: 3 },
  cloud: { kind: 1, floor: 2100, ceiling: 3100, cover: 0.4, density: 1.0, size: 6400, detail: 1300, drift: [7, 3],
    lit: '#ffb478', dark: '#8a4f80', deep: '#4f3468', steps: 56, through: 22, grow: 0.12, reach: 36000, lightStep: 200, shade: 1.4, opacity: 0.02, shadow: 0.0, burn: 1 },
  land: {
    seaLevel: 0, range: [0, 5000],
    colours: ['#6f6a40', '#4c5636', '#5a5a40', '#3b4a3c', '#262f3a', '#4a3d50', '#8a6858', '#ffffff',
      '#c79a6c', '#3d6788', '#1d3558', '#000000'],
  },
  path: { amp1: 260, freq1: 0.00031, amp2: 120, freq2: 0.00083 },
  flight: { speed: 7, altitude: 540, heave: 3, pitch: 0.6, roll: 0.4 },
  ship: { glass: 0.5, roomTint: '#ffc884', lights: 0.55, always: { 6: 1, 14: 0.6, 19: 0.7, 21: 0.9, 22: 0.6, 23: 1, 20: 1 },
    bounce: '#c0685a', bounceStrength: 0.2, lamps: 1.0 },
  birds: {
    colour: '#241a36',
    flocks: [
      { count: 9, centre: [200, 900, 40], drift: [-11, 0, 0], range: 1400, spread: 26, formation: 'v', span: 2.6, flap: 4.2 },
      { count: 14, centre: [-300, 1500, -120], drift: [9, 0, 0], range: 1800, spread: 60, formation: 'loose', span: 2.2, flap: 5.5 },
      { count: 5, centre: [0, 260, 30], drift: [-6, 0, 0], range: 700, spread: 18, formation: 'v', span: 2.4, flap: 4.6 },
    ],
  },
  shots: [
    shot('vista', 56, cam([-150, -270, 34], [70, 150, 14], 40), cam([-100, -290, 26], [70, 150, 14], 40),
      { from: cam([-200, -260, 40], [20, 100, 30], 36), to: cam([-150, -280, 30], [20, 100, 30], 36) }),
    shot('gondola', 44, cam([58, -42, -27], [15, 4, -22], 30), cam([50, -46, -25], [15, 4, -22], 30), TALL_GONDOLA),
    shot('silhouette', 52, cam([40, -430, -40], [0, 0, 0], 34), cam([-20, -410, -30], [0, 0, 0], 34)),
    shot('prow', 40, cam([40, -15, -21.4], [28, 0, -21.9], 34), cam([38, -17, -21.1], [28, 0, -21.9], 34)),
    shot('high', 48, cam([-270, -60, 130], [60, 50, -70], 38), cam([-240, -90, 110], [60, 50, -70], 38)),
    shot('bay', 44, cam([-52, -26, -40], [2, 0, -23], 34), cam([-46, -18, -37], [2, 0, -23], 34)),
  ],
};

/* ---- among the clouds ------------------------------------------------------ */

const clouds = {
  id: 'clouds',
  title: 'ABOVE THE CLOUDS',
  terrain: 2,
  grid: GRID,
  look: { glow: 0.7, outline: 0.2, vignette: 0.1 },
  sun: { dir: [0.5, -0.8, 0.25], colour: '#ffe6c2', strength: 0.98, disc: '#fffbe8', glow: '#ffe8c0', shape: [0.99994, 400, 0.6, 0.18] },
  ambient: { sky: '#8a9ae0', skyStrength: 0.4, ground: '#d0bce0', groundStrength: 0.34 },
  sky: { top: '#2a56b4', mid: '#6a9fe2', low: '#f9d2c2', shape: [0.22, 0.85], stars: [0, 0, 0, 0],
    bands: { cover: 0.3, scale: 0.00013, stretch: 3.0, height: 9000, lit: '#ffffff', dark: '#d8c8e8' } },
  fog: { colour: '#e9c4d2', sun: '#ffeed2', density: 3.0e-5, falloff: 1 / 3000, max: 0.92, sunPower: 4 },
  cloud: { kind: 2, floor: -420, ceiling: 3300, cover: 0.62, density: 1.0, size: 4600, detail: 900, drift: [0, 0],
    lit: '#fffaf0', dark: '#e2a8bc', deep: '#8a80c6', steps: 56, through: 9, grow: 0.13, reach: 46000, lightStep: 230, shade: 2.3, opacity: 0.03, shadow: 0.5 },
  land: {
    seaLevel: -640, range: [-900, -150],
    colours: ['#fff6e6', '#f6ccc8', '#a898d0', '#6c72b8', '#000000', '#000000', '#000000', '#000000',
      '#000000', '#000000', '#000000', '#000000'],
  },
  path: { amp1: 380, freq1: 0.00033, amp2: 150, freq2: 0.00088 },
  flight: { speed: 16, altitude: 640, heave: 5, pitch: 0.8, roll: 0.5 },
  ship: { glass: 0.8, roomTint: '#ffd9a0', lights: 0.3, always: { 6: 1, 21: 0.8 }, bounce: '#e8c8e8', bounceStrength: 0.4, lamps: 0.6 },
  birds: {
    colour: '#4a5298',
    flocks: [{ count: 7, centre: [120, -260, -60], drift: [5, 0, 0], range: 900, spread: 22, formation: 'v', span: 2.6, flap: 4.4 }],
  },
  shots: [
    shot('wide', 52, cam([70, -360, 20], [0, 0, 4], 38), cam([0, -340, 30], [0, 0, 4], 38),
      { from: cam([150, -400, 30], [0, 0, 20], 32), to: cam([90, -420, 40], [0, 0, 20], 32) }),
    shot('gondola', 44, cam([54, -36, -29], [17, 0, -22.5], 30), cam([46, -40, -26], [17, 0, -22.5], 30), TALL_GONDOLA),
    shot('chase', 48, cam([-240, -70, 60], [60, 0, -30], 34), cam([-205, -45, 45], [60, 0, -30], 34)),
    shot('below', 44, cam([150, -80, -100], [0, 0, 0], 32), cam([130, -60, -90], [0, 0, 0], 32)),
    shot('high', 48, cam([-150, -270, 240], [10, 0, -60], 32), cam([-120, -290, 220], [10, 0, -60], 32)),
    shot('prow', 40, cam([41, -13, -21.2], [28, 0, -21.9], 34), cam([39, -15, -21.0], [28, 0, -21.9], 34)),
  ],
};

/* ---- over the city at night ------------------------------------------------ */

const city = {
  id: 'city',
  title: 'CITY LIGHTS',
  terrain: 3,
  grid: GRID,
  city: { block: 120, street: 20, radius: 21 },
  look: { glow: 0.9, outline: 0.0, vignette: 0.3 },
  sun: { dir: [-0.35, 0.7, 0.62], colour: '#aab8ff', strength: 0.42, disc: '#f6f2e2', glow: '#7f8fd8', shape: [0.99961, 220, 0.3, 0.06] },
  ambient: { sky: '#3a4682', skyStrength: 0.66, ground: '#86708c', groundStrength: 0.16 },
  sky: { top: '#05071a', mid: '#0f1338', low: '#3a2450', shape: [0.3, 0.9], stars: [1, 0.9, 1, 1],
    bands: { cover: 0.36, scale: 0.00013, stretch: 3.0, height: 8000, lit: '#3d3f72', dark: '#191734' } },
  fog: { colour: '#4a2a48', sun: '#34386c', density: 9.0e-5, falloff: 1 / 900, max: 0.9, sunPower: 3 },
  cloud: { kind: 1, floor: 170, ceiling: 430, cover: 0.36, density: 0.3, size: 3600, detail: 700, drift: [6, 2],
    lit: '#474e80', dark: '#33283f', deep: '#1b1528', steps: 48, through: 18, grow: 0.12, reach: 22000, lightStep: 90, shade: 1.6, opacity: 0.012, shadow: 0.0 },
  land: { seaLevel: 0, range: [-1, 1], colours: Array(12).fill('#000000') },
  path: { amp1: 300, freq1: 0.00035, amp2: 140, freq2: 0.0009 },
  flight: { speed: 8, altitude: 620, heave: 4, pitch: 0.6, roll: 0.4 },
  ship: { glass: 0.0, roomTint: '#ffcf8a', lights: 0.72, always: { 6: 1, 14: 0.45, 19: 0.85, 20: 1, 21: 0.9, 22: 0.8, 23: 1 },
    bounce: '#c48c74', bounceStrength: 0.1, lamps: 1.0, windowGlow: 1.25 },
  birds: null,
  shots: [
    shot('wide', 56, cam([90, -360, 110], [0, 0, -70], 40), cam([10, -340, 90], [0, 0, -70], 40),
      { from: cam([170, -400, 120], [0, 0, -90], 34), to: cam([110, -420, 100], [0, 0, -90], 34) }),
    shot('gondola', 44, cam([54, -36, -29], [17, 0, -22.5], 30), cam([46, -40, -26], [17, 0, -22.5], 30), TALL_GONDOLA),
    shot('chase', 52, cam([-240, -70, 70], [80, 0, -90], 36), cam([-205, -45, 55], [80, 0, -90], 36)),
    shot('below', 44, cam([150, -80, -100], [0, 0, 0], 32), cam([130, -60, -90], [0, 0, 0], 32)),
    shot('down', 48, cam([-70, -150, 330], [10, 0, -220], 34), cam([-40, -170, 310], [10, 0, -220], 34)),
    shot('moon', 52, cam([240, -420, -300], [0, 0, 10], 34), cam([180, -440, -290], [0, 0, 10], 34)),
    shot('prow', 40, cam([41, -13, -21.2], [28, 0, -21.9], 34), cam([39, -15, -21.0], [28, 0, -21.9], 34)),
  ],
};

export const SCENES = [valley, city, sunset, clouds];

export const sceneById = id => SCENES.find(s => s.id === id) || null;
