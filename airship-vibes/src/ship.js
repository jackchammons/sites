/*
 * The airship, built from the drawing set's parameter file.
 *
 * derive() is a port of the geometry in the drawing set's airship_model.py:
 * given the same inputs it gives the same hull radius, deck levels and
 * stations, and the tests hold it to the `derived` block the drawings were
 * exported with. buildShip() turns that into triangles. Axes are the
 * drawings': origin on the hull axis at mid-length, x forward, y to port, z up,
 * in metres.
 *
 * What the parameter file does not carry is written here once: the window
 * runs (from GA-02's deck plans), the rooms behind them, the colours, and the
 * lamps. Nothing in this file touches the DOM or WebGL.
 */
import { MeshBuilder, MAT, shade } from './mesh.js';
import { rotationX, translation, multiply, rotationZ } from './vec.js';

/* ---- geometry: the Python model, ported ------------------------------- */

export function derive(inp) {
  const a = inp.L / 2, b = inp.D / 2;
  const r = x => b * Math.sqrt(Math.max(0, 1 - (x / a) ** 2));
  const ring = inp.L / inp.n_cells;
  const rings = Array.from({ length: inp.n_cells - 1 }, (_, i) => -a + (i + 1) * ring);
  const [bx, dx, gx] = inp.bay_x;
  const ring_b = gx + ring, ring_c = gx + 2 * ring;
  const protrude = inp.d1_h + inp.ring_c_clear - (b - r(ring_c));
  const z1 = -b - protrude;
  const z2 = z1 + inp.d1_h;
  const z3 = z2 + inp.d2_h;
  const zs = z3 + inp.svc_h;
  const ex = gx + inp.garage_len;
  const xo = ex + inp.entry_len;
  const xr1 = xo + inp.cabin_len;
  const f1 = xr1 + inp.bridge_len;
  const nose = f1 + inp.d1_nose;
  const rad = Math.PI / 180;

  return {
    a, b, r, ring, rings, bx, dx, gx, ring_b, ring_c, protrude, z1, z2, z3, zs,
    ex, xo, xr1, f1, nose, shaft_x: ring_b,
    fin_tip_r: b + inp.fin_out,
    volume: 4 / 3 * Math.PI * a * b * b,
    // Lower skin at lateral offset y: where a wall at that y meets the hull.
    skinZ: (x, y = 0) => -Math.sqrt(Math.max(r(x) ** 2 - y * y, 0)),
    // Half width of deck 1 at floor level, or at its ceiling, where the
    // windscreen has leaned forward by the rake.
    d1_half(x, top = false) {
      const hw = inp.d1_w / 2, x0 = f1 + (top ? inp.d1_rake : 0);
      if (x <= x0) return hw;
      const u = (x - x0) / inp.d1_nose;
      return hw * Math.sqrt(Math.max(0, 1 - u * u));
    },
    // Half width of deck 2: straight side walls, then an elliptical prow.
    d2_half(x) {
      const hw = inp.d2_w / 2;
      if (x <= inp.d2_straight) return hw;
      const u = (x - inp.d2_straight) / (inp.d2_tip - inp.d2_straight);
      return hw * Math.sqrt(Math.max(0, 1 - u * u));
    },
    gutter_z: x => r(x) * Math.sin(inp.gutter_deg * rad),
    gutter_y: x => r(x) * Math.cos(inp.gutter_deg * rad),
    // Where a propulsor pod sits: on a ring plane, prop_out clear of the skin.
    prop_y: x => Math.sqrt(Math.max(r(x) ** 2 - inp.prop_z ** 2, 0)) + inp.prop_out,
  };
}

/* ---- what the parameter file leaves out ------------------------------- */

export const LIVERY = {
  hull: '#fbf4e2',
  fin: '#f6eedb',
  accent: '#c2410c',      // the drawings' TENDER layer colour, used as the trim
  shell: '#eef0ea',
  belt: '#0f6e56',        // the drawings' GONDOLA layer colour
  frame: '#26333a',
  crush: '#7d858b',
  structure: '#8f969b',
  deck: '#868d92',
  dark: '#2a3036',
  glass: '#1b4a55',
  pod: '#d8d5cc',
  blade: '#30363c',
};

/* Rooms that can be lit, by number. The renderer keeps one brightness per
   room, so a scene can switch lights on and off without rebuilding anything. */
export const ROOMS = [
  'none', 'bedroom 4', 'bath 4', 'stair', 'kitchen', 'breakfast nook', 'dining room',
  'bedroom 5', 'bath 5', 'powder room', 'den', 'laundry', 'captain\'s bath', 'captain\'s cabin',
  'bridge', 'bunk room B', 'shared bath', 'bunk room A', 'lounge', 'landing bay', 'entry',
  'forward observation room', 'aft observation room', 'top lookout',
];
const ROOM = Object.fromEntries(ROOMS.map((name, i) => [name, i]));

/* Window runs, from GA-02: [start, end, room, style], stations measured
   forward from the entry/cabins bulkhead (xo), as the deck plans are. */
const WINDOWS = {
  deck1: {
    port: [[0.3, 1.6, 'laundry', 'utility'], [2.3, 3.5, 'captain\'s bath', 'bath'],
      [4.4, 7.8, 'captain\'s cabin', 'bed'], [10.3, 11.1, 'bridge', null]],
    starboard: [[0.5, 2.5, 'bunk room B', 'bunk'], [3.4, 4.6, 'shared bath', 'bath'],
      [5.5, 7.6, 'bunk room A', 'bunk'], [8.3, 9.8, 'lounge', 'sofa'], [10.3, 11.1, 'bridge', null]],
  },
  deck2: {
    port: [[-7.0, -4.6, 'bedroom 4', 'bed'], [-3.9, -3.0, 'bath 4', 'bath'], [-2.2, -0.3, 'stair', 'stair'],
      [3.4, 7.4, 'kitchen', 'kitchen'], [8.2, 10.6, 'breakfast nook', 'nook'], [11.4, 12.6, 'dining room', null]],
    starboard: [[-7.0, -4.6, 'bedroom 5', 'bed'], [-3.9, -3.0, 'bath 5', 'bath'], [-2.3, -1.6, 'powder room', 'bath'],
      [1.6, 4.8, 'den', 'books'], [5.4, 10.6, 'den', 'sofa'], [11.4, 12.6, 'dining room', null]],
  },
};

/* Lamp patterns, read by the shader: 0 steady, 1 a double flash, 2 a slow
   beacon, 3 a single flash out of step with the double. */
const LAMP = { STEADY: 0, STROBE: 1, BEACON: 2, FLASH: 3 };

const WALLS = {
  bed: ['#c9a57a', '#7a5a40', '#f0e2c4'], bath: ['#cfd8d6', '#8fa3a6', '#eef4f2'],
  kitchen: ['#d3b88c', '#6e5a48', '#f2e6cc'], books: ['#8a5a3c', '#5e4636', '#e8d4b0'],
  sofa: ['#c49a6c', '#6a503c', '#efdfbe'], nook: ['#d8bd8e', '#7a6048', '#f4e8cc'],
  stair: ['#b9a58a', '#6b5a4a', '#e6dcc6'], bunk: ['#b8a07c', '#5f4e40', '#e8dcc0'],
  utility: ['#c4c9c6', '#7a8486', '#e6ebe8'],
};

/* ---- the model -------------------------------------------------------- */

export function buildShip(inp) {
  const g = derive(inp);
  const { a, b, r, bx, dx, gx, z1, z2, z3, xo, xr1, f1, skinZ } = g;
  const hw1 = inp.d1_w / 2, hw2 = inp.d2_w / 2, bw = inp.bay_w / 2;
  const tip = inp.d2_tip, xs2 = inp.d2_straight;
  const zc = z1 - 0.3;          // underside of the crush floor
  const zTop = z3 + 0.8;        // gondola walls run up into the hull
  const C = LIVERY;

  const m = new MeshBuilder();      // everything opaque
  const glass = new MeshBuilder();  // window panes, drawn blended
  const lamps = [];                 // { pos, colour, pattern, size }

  const paint = {}, hullM = { mat: MAT.HULL };
  const roomM = id => ({ mat: MAT.ROOM, aux: id, glow: 1 });

  /* ---- envelope ---- */
  {
    const NT = 84, NA = 60;
    const at = (it, ia) => {
      const t = it / NT * Math.PI, th = ia / NA * Math.PI * 2;
      const x = a * Math.cos(t), rr = b * Math.sin(t);
      const p = [x, rr * Math.sin(th), -rr * Math.cos(th)];
      const n = [p[0] / (a * a), p[1] / (b * b), p[2] / (b * b)];
      return { p, n: it === 0 ? [1, 0, 0] : it === NT ? [-1, 0, 0] : n };
    };
    for (let it = 0; it < NT; it++) {
      for (let ia = 0; ia < NA; ia++) {
        const p00 = at(it, ia), p10 = at(it + 1, ia), p11 = at(it + 1, ia + 1), p01 = at(it, ia + 1);
        if (it > 0) m.smoothTri(p00.p, p10.p, p01.p, p00.n, p10.n, p01.n, C.hull, hullM);
        if (it < NT - 1) m.smoothTri(p10.p, p11.p, p01.p, p10.n, p11.n, p01.n, C.hull, hullM);
      }
    }
  }

  /* ---- X-tail: four fins at 45 degrees ---- */
  {
    const [rootLE, rootTE] = inp.fin_root, [tipLE, tipTE] = inp.fin_tip;
    const tipR = g.fin_tip_r;
    const hinge = tipTE + 4.6;                  // the control surface is the aft 4 m of chord
    const top = x => x >= tipLE ? r(rootLE) + (tipR - r(rootLE)) * (rootLE - x) / (rootLE - tipLE) : tipR;
    const bot = x => x >= rootTE ? r(x) * 0.9
      : r(rootTE) * 0.9 + (tipR - r(rootTE) * 0.9) * (rootTE - x) / (rootTE - tipTE);
    const thick = (x, rho) => {
      const lo = bot(x), hi = Math.max(top(x), lo + 0.01);
      return 0.6 - 0.4 * Math.min(1, Math.max(0, (rho - lo) / (hi - lo)));   // half thickness: 1.2 m root, 0.4 m tip
    };
    const stations = [rootLE, -52.5, -55, -57.5, -60, tipLE, -64, hinge + 0.2, hinge, -69.2, rootTE, tipTE];
    const fin = new MeshBuilder();
    for (let i = 0; i < stations.length - 1; i++) {
      const x0 = stations[i], x1 = stations[i + 1];
      if (x0 === hinge + 0.2) continue;         // the hinge gap
      const control = x0 <= hinge;
      for (const side of [1, -1]) {
        const bands = [[0, 0.66, control ? shade(C.fin, 0.9) : C.fin], [0.66, 1, C.accent]];
        for (const [f0, f1_, col] of bands) {
          const pt = (x, f) => {
            const rho = bot(x) + (top(x) - bot(x)) * f;
            return [x, side * thick(x, rho), rho];
          };
          fin.quad(pt(x0, f0), pt(x1, f0), pt(x1, f1_), pt(x0, f1_), col, { normal: [0, side, 0.12] });
        }
      }
      // tip edge
      fin.quad([x0, -thick(x0, top(x0)), top(x0)], [x1, -thick(x1, top(x1)), top(x1)],
        [x1, thick(x1, top(x1)), top(x1)], [x0, thick(x0, top(x0)), top(x0)], C.accent, { normal: [0, 0, 1] });
    }
    // leading edge, a thin dark strip (it is heated)
    fin.quad([rootLE, -0.6, bot(rootLE)], [rootLE, 0.6, bot(rootLE)],
      [tipLE, 0.2, tipR], [tipLE, -0.2, tipR], shade(C.fin, 0.82), { normal: [0.6, 0, 0.8] });
    // trailing edge
    fin.quad([rootTE, -0.5, bot(rootTE)], [tipTE, -0.2, tipR], [tipTE, 0.2, tipR], [rootTE, 0.5, bot(rootTE)],
      shade(C.fin, 0.8), { normal: [-1, 0, 0] });
    for (const deg of [45, 135, 225, 315]) {
      m.with(rotationX(deg * Math.PI / 180), () => m.merge(fin));
      // a white strobe on each upper tip, a steady one on the lower
      const ang = deg * Math.PI / 180, rho = tipR + 0.25;
      const pos = [(tipLE + tipTE) / 2, -Math.sin(ang) * rho, Math.cos(ang) * rho];
      lamps.push({ pos, colour: [1.0, 0.96, 0.86], pattern: pos[2] > 0 ? LAMP.STROBE : LAMP.STEADY, size: pos[2] > 0 ? 1.0 : 0.6 });
    }
  }

  /* ---- the open bay: moon pool, landing deck, strong box, covers ---- */
  {
    const bay = roomM(ROOM['landing bay']);
    const orange = C.accent;
    // ceiling, with four work lights let into it
    m.quad([bx, -bw, z3], [gx + inp.balcony_len, -bw, z3], [gx + inp.balcony_len, bw, z3], [bx, bw, z3], '#b9b0a0', { ...bay, normal: [0, 0, -1] });
    for (const lx of [-12, -7, -2, 3]) {
      for (const ly of [-3.2, 3.2]) m.box([lx - 0.7, ly - 0.18, z3 - 0.07], [lx + 0.7, ly + 0.18, z3 - 0.01], '#fff0c8', { ...bay, faces: 'xXyYz' });
    }
    // strong box: side girders and the end ring, inside the hull
    const SEG = 10;
    for (let i = 0; i < SEG; i++) {
      const x0 = bx + (gx - bx) * i / SEG, x1 = bx + (gx - bx) * (i + 1) / SEG;
      for (const s of [1, -1]) {
        const col = i % 2 ? orange : shade(orange, 0.8);
        m.quad([x0, s * bw, skinZ(x0, bw) - 0.02], [x1, s * bw, skinZ(x1, bw) - 0.02], [x1, s * bw, z3], [x0, s * bw, z3], col, { ...bay, normal: [0, -s, 0] });
      }
    }
    for (let i = 0; i < 8; i++) {
      const y0 = -bw + 2 * bw * i / 8, y1 = -bw + 2 * bw * (i + 1) / 8;
      m.quad([bx, y0, skinZ(bx, y0) - 0.02], [bx, y1, skinZ(bx, y1) - 0.02], [bx, y1, z3], [bx, y0, z3], i % 2 ? orange : shade(orange, 0.8), { ...bay, normal: [1, 0, 0] });
    }
    // aero covers: full depth beside the deck, tapering to nothing at the aft end of the pool
    for (const s of [1, -1]) {
      const y = s * (bw + 0.12);
      const N = 8;
      for (let i = 0; i < N; i++) {      // beside the pool
        const x0 = bx + (dx - bx) * i / N, x1 = bx + (dx - bx) * (i + 1) / N;
        const lowAt = x => skinZ(bx, bw) + (zc - skinZ(bx, bw)) * (x - bx) / (dx - bx);
        m.quad([x0, y, lowAt(x0)], [x1, y, lowAt(x1)], [x1, y, skinZ(x1, bw) + 0.35], [x0, y, skinZ(x0, bw) + 0.35], C.hull, { normal: [0, s, 0] });
      }
      for (let i = 0; i < N; i++) {      // beside the deck
        const x0 = dx + (gx - dx) * i / N, x1 = dx + (gx - dx) * (i + 1) / N;
        m.quad([x0, y, zc], [x1, y, zc], [x1, y, skinZ(x1, bw) + 0.35], [x0, y, skinZ(x0, bw) + 0.35], C.hull, { normal: [0, s, 0] });
      }
      // a thin trim line along the cover's lower edge
      m.quad([dx, y + s * 0.03, zc], [gx, y + s * 0.03, zc], [gx, y + s * 0.03, zc + 0.22], [dx, y + s * 0.03, zc + 0.22], C.accent, { normal: [0, s, 0] });
    }
    // landing deck: fixed, hung on six hangers
    m.box([dx, -bw, zc], [gx, bw, z1], C.deck, { tint: { Z: 1.0, z: 0.7, x: 0.85 } });
    m.box([dx, -bw, z1], [dx + 0.25, bw, z1 + 0.03], orange);
    {
      const R0 = inp.tender_span / 2 - 0.25, R1 = inp.tender_span / 2, N = 28;
      for (let i = 0; i < N; i += 2) {     // dashed landing circle
        const t0 = i / N * Math.PI * 2, t1 = (i + 1) / N * Math.PI * 2;
        const p = (t, R) => [(dx + gx) / 2 + R * Math.cos(t), R * Math.sin(t), z1 + 0.03];
        m.quad(p(t0, R0), p(t0, R1), p(t1, R1), p(t1, R0), orange, { normal: [0, 0, 1] });
      }
    }
    for (const hx of [dx + 0.15, (dx + gx) / 2, gx - 0.15]) {
      for (const s of [1, -1]) m.box([hx - 0.12, s * (bw - 0.2) - 0.12, z1], [hx + 0.12, s * (bw - 0.2) + 0.12, z3], orange, { ...bay, faces: 'xXyY' });
    }
    // hoist rail and trolley
    m.box([bx + 0.8, -0.1, z3 - 0.45], [gx - 0.8, 0.1, z3 - 0.3], C.dark);
    m.box([dx - 2.9, -0.3, z3 - 0.85], [dx - 2.1, 0.3, z3 - 0.45], '#e8e4da');
    // garage door: roll-up slats
    for (let i = 0; i < 6; i++) {
      const za = z1 + (z2 - z1) * i / 6, zb = z1 + (z2 - z1) * (i + 1) / 6;
      m.quad([gx, -bw, za], [gx, bw, za], [gx, bw, zb], [gx, -bw, zb], i % 2 ? '#c9ccc8' : '#b4b8b6', { ...bay, normal: [-1, 0, 0] });
    }
    // balcony: a recess above the garage door, its rail the ring's lower chord
    const xb = gx + inp.balcony_len;
    for (const s of [1, -1]) {
      m.quad([gx, s * hw2, z2], [gx, s * bw, z2], [gx, s * bw, z3], [gx, s * hw2, z3], C.shell, { ...bay, normal: [-1, 0, 0] });
      m.quad([gx, s * (hw2 - 0.03), z2], [xb, s * (hw2 - 0.03), z2], [xb, s * (hw2 - 0.03), z3], [gx, s * (hw2 - 0.03), z3], shade(C.shell, 0.9), { ...bay, normal: [0, -s, 0] });
      // the same wall from outside is shell like the rest, not lit by the bay's lamps
      m.quad([gx, s * hw2, z2], [xb, s * hw2, z2], [xb, s * hw2, zTop], [gx, s * hw2, zTop], C.shell, { normal: [0, s, 0] });
    }
    m.quad([gx, -hw2, z2 + 0.02], [xb, -hw2, z2 + 0.02], [xb, hw2, z2 + 0.02], [gx, hw2, z2 + 0.02], '#9a8468', { ...bay, normal: [0, 0, 1] });
    {
      // back wall with a glazed door to each aft bedroom
      const doors = [[1.1, 3.1, 'bedroom 4'], [-3.1, -1.1, 'bedroom 5']];
      const zh = z2 + 2.1;
      let y = -hw2;
      for (const [y0, y1] of doors.slice().sort((p, q) => p[0] - q[0])) {
        m.quad([xb, y, z2], [xb, y0, z2], [xb, y0, z3], [xb, y, z3], C.shell, { ...bay, normal: [-1, 0, 0] });
        m.quad([xb, y0, zh], [xb, y1, zh], [xb, y1, z3], [xb, y0, z3], C.shell, { ...bay, normal: [-1, 0, 0] });
        y = y1;
      }
      m.quad([xb, y, z2], [xb, hw2, z2], [xb, hw2, z3], [xb, y, z3], C.shell, { ...bay, normal: [-1, 0, 0] });
      for (const [y0, y1, name] of doors) {
        const id = ROOM[name], w = WALLS.bed;
        m.box([xb + 0.05, y0, z2 + 0.03], [xb + 2.4, y1, zh], w[0], { ...roomM(id), faces: 'XyYzZ', tint: { z: 0.6, Z: 1.25, X: 0.85, y: 0.75, Y: 0.75 } });
        glass.quad([xb + 0.02, y0, z2 + 0.03], [xb + 0.02, y1, z2 + 0.03], [xb + 0.02, y1, zh], [xb + 0.02, y0, zh], C.glass, { mat: MAT.GLASS, aux: id, normal: [-1, 0, 0] });
        m.box([xb - 0.02, (y0 + y1) / 2 - 0.04, z2], [xb + 0.03, (y0 + y1) / 2 + 0.04, zh], C.frame);
      }
      // rail: top bar, posts and a zig-zag web
      const zr = z2 + 1.0;
      m.box([gx - 0.06, -hw2, zr - 0.07], [gx + 0.06, hw2, zr], C.structure);
      const NB = 12;
      for (let i = 0; i < NB; i++) {
        const y0 = -hw2 + 2 * hw2 * i / NB, y1 = -hw2 + 2 * hw2 * (i + 1) / NB;
        m.tube([gx, y0, i % 2 ? zr - 0.05 : z2 + 0.05], [gx, y1, i % 2 ? z2 + 0.05 : zr - 0.05], 0.035, C.structure, { segs: 4 });
      }
    }
    // the tender: a two-seat multirotor parked on the deck
    {
      const tx = (dx + gx) / 2 + 1.2, span = inp.tender_span;
      m.ellipsoid([tx, 0, z1 + 1.05], [1.45, 0.85, 0.72], '#f4f1e8', { rings: 6, segs: 10 });
      m.ellipsoid([tx + 0.45, 0, z1 + 1.3], [0.8, 0.7, 0.5], C.glass, { rings: 5, segs: 8, u1: 0.55 });
      m.box([tx - 1.5, -0.12, z1 + 0.95], [tx + 1.2, 0.12, z1 + 1.12], orange, { faces: 'yYzZxX' });
      for (const sx of [-0.9, 0.9]) {
        for (const sy of [-0.75, 0.75]) m.tube([tx + sx, sy * 0.8, z1 + 0.7], [tx + sx, sy, z1 + 0.05], 0.04, C.dark, { segs: 4 });
      }
      for (const sy of [-0.75, 0.75]) m.tube([tx - 1.1, sy, z1 + 0.05], [tx + 1.1, sy, z1 + 0.05], 0.045, C.dark, { segs: 4 });
      const arm = span / 2 - 1.2;
      for (const [ax, ay] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        const hub = [tx + ax * arm * 0.62, ay * arm, z1 + 2.05];
        m.tube([tx + ax * 0.5, ay * 0.5, z1 + 1.55], hub, 0.07, '#d9d6cd', { segs: 5 });
        m.tube([hub[0], hub[1], hub[2] - 0.2], [hub[0], hub[1], hub[2] + 0.12], 0.14, C.dark, { segs: 6, caps: true });
        const N = 10;                       // a still rotor, drawn as its disc
        const ringPts = Array.from({ length: N }, (_, i) => [hub[0] + 1.15 * Math.cos(i / N * 6.2832), hub[1] + 1.15 * Math.sin(i / N * 6.2832), hub[2] + 0.1]);
        for (let i = 0; i < N; i += 1) {
          if (i % 5 > 0) continue;          // two blades
          const j = (i + 1) % N;
          m.tri([hub[0], hub[1], hub[2] + 0.1], ringPts[i], ringPts[j], C.blade, { normal: [0, 0, 1] });
        }
      }
    }
  }

  /* ---- gondola shell ---- */
  const wallRun = ({ xa, xb, y, s, zb, zt, wins, col, deck }) => {
    // A straight side wall at lateral position y, facing s (+1 port), with
    // window openings; the panes go to the glass mesh and each opening gets
    // the room behind it.
    const n = [0, s, 0];
    let x = xa;
    const sorted = wins.slice().sort((p, q) => p.x0 - q.x0);
    for (const w of sorted) {
      if (w.x0 > x) m.quad([x, y, zb], [w.x0, y, zb], [w.x0, y, zt], [x, y, zt], col, { normal: n });
      m.quad([w.x0, y, zb], [w.x1, y, zb], [w.x1, y, w.z0], [w.x0, y, w.z0], col, { normal: n });
      m.quad([w.x0, y, w.z1], [w.x1, y, w.z1], [w.x1, y, zt], [w.x0, y, zt], col, { normal: n });
      x = w.x1;
      // reveal: the depth of the shell, in the frame colour
      const yi = y - s * 0.14;
      m.quad([w.x0, y, w.z0], [w.x1, y, w.z0], [w.x1, yi, w.z0], [w.x0, yi, w.z0], C.frame, { normal: [0, 0, 1] });
      m.quad([w.x0, y, w.z1], [w.x1, y, w.z1], [w.x1, yi, w.z1], [w.x0, yi, w.z1], C.frame, { normal: [0, 0, -1] });
      m.quad([w.x0, y, w.z0], [w.x0, yi, w.z0], [w.x0, yi, w.z1], [w.x0, y, w.z1], C.frame, { normal: [1, 0, 0] });
      m.quad([w.x1, y, w.z0], [w.x1, yi, w.z0], [w.x1, yi, w.z1], [w.x1, y, w.z1], C.frame, { normal: [-1, 0, 0] });
      // mullions
      const bars = Math.max(0, Math.round((w.x1 - w.x0) / 1.25) - 1);
      for (let i = 1; i <= bars; i++) {
        const xm = w.x0 + (w.x1 - w.x0) * i / (bars + 1);
        m.box([xm - 0.035, Math.min(y - s * 0.1, y - s * 0.02), w.z0], [xm + 0.035, Math.max(y - s * 0.1, y - s * 0.02), w.z1], C.frame, { faces: s > 0 ? 'xXY' : 'xXy' });
      }
      glass.quad([w.x0, y - s * 0.06, w.z0], [w.x1, y - s * 0.06, w.z0], [w.x1, y - s * 0.06, w.z1], [w.x0, y - s * 0.06, w.z1], C.glass,
        { mat: MAT.GLASS, aux: w.room, normal: n });
      if (w.style) roomBehind({ x0: w.x0 - 0.35, x1: w.x1 + 0.35, y: y - s * 0.15, s, zf: deck.zf, zc: deck.zc, depth: deck.depth, id: w.room, style: w.style });
    }
    if (xb > x) m.quad([x, y, zb], [xb, y, zb], [xb, y, zt], [x, y, zt], col, { normal: n });
  };

  const roomBehind = ({ x0, x1, y, s, zf, zc: ceil, depth, id, style }) => {
    // The inside of a room as seen through its window: five faces that carry
    // their own shading, and a few blocks of furniture.
    const [wall, floor, ceilCol] = WALLS[style];
    const M = roomM(id);
    const yb = y - s * depth;                      // back wall
    const lo = [x0, Math.min(y, yb), zf], hi = [x1, Math.max(y, yb), ceil];
    m.box(lo, hi, wall, { ...M, faces: (s > 0 ? 'y' : 'Y') + 'xX', tint: { x: 0.78, X: 0.78, y: 0.92, Y: 0.92 } });
    m.quad([x0, lo[1], zf], [x1, lo[1], zf], [x1, hi[1], zf], [x0, hi[1], zf], floor, { ...M, normal: [0, 0, 1] });
    m.quad([x0, lo[1], ceil], [x1, lo[1], ceil], [x1, hi[1], ceil], [x0, hi[1], ceil], ceilCol, { ...M, normal: [0, 0, -1] });
    const along = (u0, u1) => [x0 + (x1 - x0) * u0, x0 + (x1 - x0) * u1];
    const deep = (d0, d1) => s > 0 ? [y - d1, y - d0] : [y + d0, y + d1];
    const block = (u0, u1, d0, d1, h0, h1, col, tint) => {
      const [xa, xb] = along(u0, u1), [ya, yb_] = deep(d0, d1);
      m.box([xa, ya, zf + h0], [xb, yb_, zf + h1], col, { ...M, tint: tint || { x: 0.8, X: 0.8, z: 0.6, Z: 1.1, y: 0.9, Y: 0.9 } });
    };
    const lamp = (u, d, h) => block(u - 0.04, u + 0.04, d - 0.12, d + 0.12, h, h + 0.22, '#fff2c0', { x: 1, X: 1, y: 1, Y: 1, z: 1, Z: 1 });
    if (style === 'bed') {
      block(0.12, 0.72, depth - 2.0, depth - 0.05, 0, 0.55, '#e8dcc8');
      block(0.12, 0.72, depth - 0.55, depth - 0.05, 0.55, 0.72, '#f6efe0');
      block(0.14, 0.7, depth - 2.0, depth - 1.0, 0.5, 0.6, '#8a4f3a');
      lamp(0.84, depth - 0.3, 0.75);
      block(0.78, 0.9, depth - 0.5, depth - 0.1, 0, 0.75, '#6b4c38');
    } else if (style === 'bath') {
      block(0.1, 0.9, depth - 0.5, depth - 0.05, 0, 0.85, '#f4f6f4');
      block(0.3, 0.7, depth - 0.12, depth - 0.05, 1.1, 1.7, '#a9d0d6');
    } else if (style === 'kitchen') {
      block(0.02, 0.98, depth - 0.65, depth - 0.05, 0, 0.9, '#5c4838');
      block(0.02, 0.98, depth - 0.67, depth - 0.05, 0.9, 0.95, '#e9e4d8');
      block(0.02, 0.98, depth - 0.4, depth - 0.05, 1.5, 2.2, '#6e5644');
      block(0.3, 0.7, depth - 1.9, depth - 1.2, 0, 0.9, '#7a6250');
      block(0.3, 0.7, depth - 1.95, depth - 1.15, 0.9, 0.95, '#efe9dc');
      lamp(0.4, depth - 1.55, 1.85); lamp(0.6, depth - 1.55, 1.85);
    } else if (style === 'books') {
      const shelves = ['#a34a32', '#3f6e63', '#c9a23c', '#5a4a7a', '#8a3b3b', '#2f5a7a', '#b8743a'];
      for (let row = 0; row < 4; row++) {
        for (let k = 0; k < 9; k++) {
          const u0 = 0.04 + 0.92 * k / 9, u1 = 0.04 + 0.92 * (k + 0.86) / 9;
          block(u0, u1, depth - 0.3, depth - 0.06, 0.25 + row * 0.5, 0.25 + row * 0.5 + 0.34 + 0.08 * ((k * 7 + row * 3) % 3) / 2,
            shelves[(k * 3 + row * 5) % shelves.length]);
        }
      }
      block(0.3, 0.7, 0.9, 1.7, 0, 0.42, '#7a4a3a');
      lamp(0.82, 1.3, 1.25);
      block(0.815, 0.825, 1.28, 1.32, 0, 1.25, '#3a3a3a');
    } else if (style === 'sofa') {
      block(0.08, 0.62, depth - 0.95, depth - 0.1, 0, 0.42, '#6f7f5a');
      block(0.08, 0.62, depth - 0.3, depth - 0.1, 0.42, 0.85, '#7d8d66');
      block(0.72, 0.92, depth - 1.0, depth - 0.4, 0, 0.45, '#8a6a4a');
      lamp(0.82, depth - 0.7, 0.45);
      block(0.2, 0.5, 0.7, 1.3, 0, 0.36, '#5a4636');
    } else if (style === 'nook') {
      block(0.3, 0.7, 0.7, 1.7, 0.66, 0.74, '#b08a5c');
      block(0.47, 0.53, 1.1, 1.3, 0, 0.66, '#6b5340');
      block(0.14, 0.26, 0.9, 1.5, 0, 0.45, '#8c5a44'); block(0.74, 0.86, 0.9, 1.5, 0, 0.45, '#8c5a44');
      lamp(0.5, 1.2, 1.75);
    } else if (style === 'stair') {
      for (let k = 0; k < 6; k++) block(0.05 + k * 0.15, 0.2 + k * 0.15, depth - 1.3, depth - 0.1, 0, 0.3 + k * 0.33, '#9a8468');
    } else if (style === 'bunk') {
      block(0.08, 0.92, depth - 0.95, depth - 0.05, 0.3, 0.5, '#d9cdb6');
      block(0.08, 0.92, depth - 0.95, depth - 0.05, 1.25, 1.42, '#d9cdb6');
      block(0.08, 0.14, depth - 0.95, depth - 0.05, 0, 1.6, '#6b5340'); block(0.86, 0.92, depth - 0.95, depth - 0.05, 0, 1.6, '#6b5340');
      block(0.6, 0.9, depth - 0.9, depth - 0.1, 0.5, 0.58, '#4a6a8a');
      lamp(0.5, depth - 0.12, 1.0);
    } else if (style === 'utility') {
      block(0.1, 0.5, depth - 0.7, depth - 0.05, 0, 0.9, '#eef0ee');
      block(0.52, 0.92, depth - 0.7, depth - 0.05, 0, 0.9, '#e2e6e4');
      block(0.2, 0.4, depth - 0.72, depth - 0.7, 0.3, 0.7, '#5a6a72');
    }
  };

  {
    const d1 = { zf: z1 + 0.04, zc: z2 - 0.06, depth: 2.6 };
    const d2 = { zf: z2 + 0.04, zc: z3 - 0.04, depth: 3.1 };
    const winsOf = (deck, side, zLo, zHi) => WINDOWS[deck][side].map(([u0, u1, name, style]) => {
      const x0 = xo + u0, x1 = xo + u1;
      // On deck 2 the hull line comes down over the aft windows and trims them.
      const head = deck === 'deck2' ? Math.min(zHi, Math.min(skinZ(x0, hw2), skinZ(x1, hw2)) - 0.15) : zHi;
      return { x0, x1, z0: zLo, z1: head, room: ROOM[name], style };
    });

    // deck 1: garage and entry, full bay width
    for (const s of [1, -1]) {
      const y = s * bw;
      if (s > 0) {
        m.quad([gx, y, zc], [xo, y, zc], [xo, y, z2], [gx, y, z2], C.shell, { normal: [0, s, 0] });
      } else {
        // the boarding door, and beside it a small window
        const xd0 = xo - 2.2, xd1 = xo - 0.8, zd = z1 + 2.05;
        m.quad([gx, y, zc], [xd0, y, zc], [xd0, y, z2], [gx, y, z2], C.shell, { normal: [0, s, 0] });
        m.quad([xd1, y, zc], [xo, y, zc], [xo, y, z2], [xd1, y, z2], C.shell, { normal: [0, s, 0] });
        m.quad([xd0, y, zd], [xd1, y, zd], [xd1, y, z2], [xd0, y, z2], C.shell, { normal: [0, s, 0] });
        m.quad([xd0, y, zc], [xd1, y, zc], [xd1, y, z1], [xd0, y, z1], C.shell, { normal: [0, s, 0] });
        m.box([xd0, y, z1], [xd1, y + 0.1, zd], '#d5d9d4', { faces: 'yxXzZ', tint: { x: 0.5, X: 0.5, z: 0.5, Z: 0.5 } });
        m.box([xd0 + 0.35, y - 0.02, z1 + 1.15], [xd1 - 0.35, y + 0.09, z1 + 1.75], '#ffe2a0', { ...roomM(ROOM.entry), faces: 'y' });
        m.box([xd0 - 0.06, y - 0.03, z1], [xd0, y + 0.02, zd], C.frame, { faces: 'yxX' });
        m.box([xd1, y - 0.03, z1], [xd1 + 0.06, y + 0.02, zd], C.frame, { faces: 'yxX' });
      }
      m.quad([xo, s * hw1, zc], [xo, s * bw, zc], [xo, s * bw, z2], [xo, s * hw1, z2], C.shell, { normal: [1, 0, 0] });
      // accent line under the garage block
      m.quad([gx, y + s * 0.03, zc], [xo, y + s * 0.03, zc], [xo, y + s * 0.03, zc + 0.22], [gx, y + s * 0.03, zc + 0.22], C.accent, { normal: [0, s, 0] });
    }
    m.quad([gx, -bw, z2], [xo, -bw, z2], [xo, bw, z2], [gx, bw, z2], shade(C.shell, 0.95), { normal: [0, 0, 1] });
    m.quad([gx, -bw, zc], [xo, -bw, zc], [xo, bw, zc], [gx, bw, zc], C.crush, { normal: [0, 0, -1] });
    {
      // the walk-on floor window in the entry, seen from below
      const cx = xo - 1.5, cy = -3.95, N = 14;
      const pts = Array.from({ length: N }, (_, i) => [cx + 0.75 * Math.cos(i / N * 6.2832), cy + 0.75 * Math.sin(i / N * 6.2832), zc - 0.02]);
      m.fan(pts, '#ffe6a8', { ...roomM(ROOM.entry), normal: [0, 0, -1] });
    }

    // deck 1: cabins, 7 m wide
    for (const [s, side] of [[1, 'port'], [-1, 'starboard']]) {
      wallRun({ xa: xo, xb: f1, y: s * hw1, s, zb: zc, zt: z2, wins: winsOf('deck1', side, z1 + 0.9, z1 + 1.9), col: C.shell, deck: d1 });
      // the raked corner where the straight wall meets the leaning windscreen
      m.tri([f1, s * hw1, z1], [f1 + inp.d1_rake, s * hw1, z2], [f1, s * hw1, z2], C.shell, { normal: [0, s, 0] });
    }

    // bridge: the windscreen runs all round and leans forward to meet the prow above
    {
      const N = 18, sill = z1 + 0.4, head = z2 - 0.25;
      const at = (i, z) => {
        const t = -Math.PI / 2 + Math.PI * i / N, f = (z - z1) / (z2 - z1);
        const fz = Math.max(0, f);               // the crush floor does not lean
        return [f1 + inp.d1_rake * fz + inp.d1_nose * Math.cos(t), hw1 * Math.sin(t), z];
      };
      const nrm = i => { const t = -Math.PI / 2 + Math.PI * (i + 0.5) / N; return [Math.cos(t) * hw1, Math.sin(t) * inp.d1_nose, -0.25]; };
      for (let i = 0; i < N; i++) {
        const n = nrm(i);
        m.quad(at(i, zc), at(i + 1, zc), at(i + 1, sill), at(i, sill), C.shell, { normal: n });
        m.quad(at(i, head), at(i + 1, head), at(i + 1, z2), at(i, z2), C.shell, { normal: n });
        glass.quad(at(i, sill), at(i + 1, sill), at(i + 1, head), at(i, head), C.glass, { mat: MAT.GLASS, aux: ROOM.bridge, normal: n });
        if (i > 0 && i % 2 === 0) {
          const p0 = at(i, sill), p1 = at(i, head);
          m.tube(p0, p1, 0.05, C.frame, { segs: 4 });
        }
      }
      // inside: floor, ceiling, bulkhead, helm, two seats, a chart table
      const B = roomM(ROOM.bridge);
      const floorPts = [[xr1 + 0.1, -hw1 + 0.05, z1 + 0.04]];
      for (let i = 0; i <= N; i++) floorPts.push(at(i, z1 + 0.04));
      floorPts.push([xr1 + 0.1, hw1 - 0.05, z1 + 0.04]);
      m.fan(floorPts, '#3d4a52', { ...B, normal: [0, 0, 1] });
      const ceilPts = [[xr1 + 0.1, -hw1 + 0.05, z2 - 0.06]];
      for (let i = 0; i <= N; i++) ceilPts.push(at(i, z2 - 0.06));
      ceilPts.push([xr1 + 0.1, hw1 - 0.05, z2 - 0.06]);
      m.fan(ceilPts, '#5a6468', { ...B, normal: [0, 0, -1] });
      m.quad([xr1 + 0.1, -hw1, z1], [xr1 + 0.1, hw1, z1], [xr1 + 0.1, hw1, z2], [xr1 + 0.1, -hw1, z2], '#6a6258', { ...B, normal: [1, 0, 0] });
      m.box([f1 + 1.9, -1.7, z1 + 0.04], [f1 + 2.5, 1.7, z1 + 0.95], '#2c343a', { ...B, tint: { x: 0.9, Z: 1.2 } });
      m.quad([f1 + 1.88, -1.5, z1 + 0.6], [f1 + 1.88, 1.5, z1 + 0.6], [f1 + 1.7, 1.5, z1 + 0.98], [f1 + 1.7, -1.5, z1 + 0.98], '#54e0d0', { mat: MAT.SCREEN, aux: ROOM.bridge, glow: 1, normal: [-0.8, 0, 0.6] });
      for (const sy of [-0.85, 0.85]) {
        m.box([f1 + 0.7, sy - 0.3, z1 + 0.04], [f1 + 1.3, sy + 0.3, z1 + 0.5], '#4a3f3a', B);
        m.box([f1 + 0.7, sy - 0.3, z1 + 0.5], [f1 + 0.85, sy + 0.3, z1 + 1.15], '#5a4b44', B);
      }
      m.box([xr1 + 0.5, 1.5, z1 + 0.04], [xr1 + 1.3, 2.9, z1 + 0.82], '#7a6248', B);
      figure(m, [f1 + 1.05, 0.85, z1 + 0.5], 0, { ...B }, { seated: true, coat: '#3a5a7a' });
    }

    // deck 2: side walls with windows, running up into the hull
    for (const [s, side] of [[1, 'port'], [-1, 'starboard']]) {
      wallRun({ xa: gx + inp.balcony_len, xb: xs2, y: s * hw2, s, zb: z2, zt: zTop, wins: winsOf('deck2', side, z2 + 0.5, z2 + 1.9), col: C.shell, deck: d2 });
      // belt line along the shoulder, in the drawings' gondola green
      m.quad([gx + inp.balcony_len, s * (hw2 + 0.03), z2], [xs2, s * (hw2 + 0.03), z2], [xs2, s * (hw2 + 0.03), z2 + 0.24], [gx + inp.balcony_len, s * (hw2 + 0.03), z2 + 0.24], C.belt, { normal: [0, s, 0] });
    }

    // deck 2 prow: the dining room, glazed all round
    {
      const N = 22, sill = z2 + 0.3, head = z3 - 0.25;
      const at = (i, z, inset = 0) => {
        const t = -Math.PI / 2 + Math.PI * i / N;
        return [xs2 + (tip - xs2 - inset) * Math.cos(t), (hw2 - inset) * Math.sin(t), z];
      };
      const nrm = i => { const t = -Math.PI / 2 + Math.PI * (i + 0.5) / N; return [Math.cos(t) * hw2, Math.sin(t) * (tip - xs2), 0]; };
      for (let i = 0; i < N; i++) {
        const n = nrm(i);
        m.quad(at(i, z2), at(i + 1, z2), at(i + 1, sill), at(i, sill), C.shell, { normal: n });
        m.quad(at(i, head), at(i + 1, head), at(i + 1, zTop), at(i, zTop), C.shell, { normal: n });
        m.quad(at(i, z2, -0.03), at(i + 1, z2, -0.03), at(i + 1, z2 + 0.24, -0.03), at(i, z2 + 0.24, -0.03), C.belt, { normal: n });
        glass.quad(at(i, sill), at(i + 1, sill), at(i + 1, head), at(i, head), C.glass, { mat: MAT.GLASS, aux: ROOM['dining room'], normal: n });
        if (i > 0 && i % 2 === 0) m.tube(at(i, sill), at(i, head), 0.05, C.frame, { segs: 4 });
      }
      const D = roomM(ROOM['dining room']);
      const xw = xo + 10.9;                                  // back of the room, at ring C
      const outline = z => {
        const pts = [[xw, -hw2 + 0.1, z]];
        for (let i = 0; i <= N; i++) pts.push(at(i, z, 0.1));
        pts.push([xw, hw2 - 0.1, z]);
        return pts;
      };
      m.fan(outline(z2 + 0.04), '#8a6a48', { ...D, normal: [0, 0, 1] });
      m.fan(outline(z3 - 0.04), '#f1e4c6', { ...D, normal: [0, 0, -1] });
      m.quad([xw, -hw2, z2], [xw, hw2, z2], [xw, hw2, z3], [xw, -hw2, z3], '#c7a070', { ...D, normal: [1, 0, 0] });
      m.box([xw, -0.9, z2 + 0.04], [xw + 0.03, 0.9, z2 + 2.15], '#6a4a34', { ...D, faces: 'X' });   // the way through to the den
      // the long oval table, eight chairs, the chandelier
      const tc = [xs2 + 0.9, 0, z2 + 0.78], NTB = 14;
      const tpts = z => Array.from({ length: NTB }, (_, i) => [tc[0] + 1.75 * Math.cos(i / NTB * 6.2832), tc[1] + 0.72 * Math.sin(i / NTB * 6.2832), z]);
      m.fan(tpts(tc[2]), '#b98a58', { ...D, normal: [0, 0, 1] });
      { const lo = tpts(tc[2] - 0.08), hi = tpts(tc[2]);
        for (let i = 0; i < NTB; i++) { const j = (i + 1) % NTB; m.quad(lo[i], lo[j], hi[j], hi[i], '#8a6240', D); } }
      m.box([tc[0] - 0.9, -0.12, z2 + 0.04], [tc[0] + 0.9, 0.12, tc[2] - 0.08], '#6f4e36', D);
      for (const cxo of [-1.15, -0.4, 0.4, 1.15]) {
        for (const sy of [-1, 1]) {
          m.box([tc[0] + cxo - 0.22, sy * 1.0 - 0.2, z2 + 0.04], [tc[0] + cxo + 0.22, sy * 1.0 + 0.2, z2 + 0.48], '#7c3f34', D);
          m.box([tc[0] + cxo - 0.22, sy * 1.18 - 0.04, z2 + 0.48], [tc[0] + cxo + 0.22, sy * 1.18 + 0.04, z2 + 0.98], '#8a4a3c', D);
        }
      }
      const lampM = { ...D };
      m.tube([tc[0], 0, z3 - 0.04], [tc[0], 0, z3 - 0.55], 0.02, '#4a4038', { ...D, segs: 4 });
      for (const [ox, oy] of [[0, 0], [0.35, 0.12], [-0.35, -0.12], [0.1, -0.3], [-0.1, 0.3]]) {
        m.ellipsoid([tc[0] + ox, oy, z3 - 0.66 - Math.abs(ox) * 0.2], [0.13, 0.13, 0.13], '#fff4c8', { ...lampM, rings: 4, segs: 6 });
      }
      figure(m, [tip - 1.15, 1.25, z2 + 0.04], 0.15, D, { coat: '#b2553a' });
      figure(m, [tc[0] - 0.4, -1.0, z2 + 0.48], Math.PI / 2, D, { seated: true, coat: '#4d6b58' });
    }

    // underside of deck 2 (the shoulder over deck 1) and the crush floor
    {
      const N = 22;
      const d2pts = z => {
        const pts = [[gx + inp.balcony_len, -hw2, z]];
        for (let i = 0; i <= N; i++) { const t = -Math.PI / 2 + Math.PI * i / N; pts.push([xs2 + (tip - xs2) * Math.cos(t), hw2 * Math.sin(t), z]); }
        pts.push([gx + inp.balcony_len, hw2, z]);
        return pts;
      };
      m.fan(d2pts(z2), shade(C.shell, 0.82), { normal: [0, 0, -1] });
      const d1pts = [[xo, -hw1, zc]];
      for (let i = 0; i <= 18; i++) { const t = -Math.PI / 2 + Math.PI * i / 18; d1pts.push([f1 + inp.d1_nose * Math.cos(t), hw1 * Math.sin(t), zc]); }
      d1pts.push([xo, hw1, zc]);
      m.fan(d1pts, C.crush, { normal: [0, 0, -1] });
    }

    // landing skids: an aft pair and one forward on the centreline, hanging 0.3 m low in flight
    for (const [sx, sy] of [[gx + 0.6, 2.5], [gx + 0.6, -2.5], [g.nose - 4.2, 0]]) {
      const zs0 = z1 - 0.8;
      m.box([sx, sy - 0.25, zs0 - 0.14], [sx + 2.2, sy + 0.25, zs0], C.dark);
      m.tube([sx + 0.45, sy, zs0], [sx + 0.8, sy, zc], 0.06, C.dark, { segs: 4 });
      m.tube([sx + 1.75, sy, zs0], [sx + 1.4, sy, zc], 0.06, C.dark, { segs: 4 });
      m.tube([sx + 0.8, sy, zs0 + 0.05], [sx + 1.45, sy, zc], 0.07, '#2f8fb8', { segs: 4 });
    }
  }

  /* ---- propulsor pods and outriggers (the propellers are a separate mesh) ---- */
  const propMounts = [];
  for (const px of inp.prop_x) {
    for (const s of [1, -1]) {
      const py = s * g.prop_y(px), pz = inp.prop_z;
      const hub = [px + 1.15, py, pz];
      propMounts.push({ pos: hub, phase: propMounts.length * 0.37 });
      m.ellipsoid([px, py, pz], [1.3, 0.42, 0.42], C.pod, { rings: 6, segs: 8 });
      m.box([px - 0.6, py - 0.05, pz - 0.44], [px + 0.4, py + 0.05, pz + 0.44], C.accent, { faces: 'yY' });
      const skin = z => [px, s * Math.sqrt(Math.max(r(px) ** 2 - z * z, 0)), z];
      m.tube([px, py, pz], skin(pz + 2.2), 0.09, C.structure, { segs: 5 });
      m.tube([px, py, pz], skin(pz - 2.6), 0.09, C.structure, { segs: 5 });
      m.tube([px - 0.3, py, pz], [px - 5.5, s * r(px - 5.5), 0], 0.07, C.structure, { segs: 5 });
    }
  }

  /* ---- small things ---- */
  // landing lidars, looking down from the keel: sensors, so they carry no light
  for (const lx of [-46, -19, 33, 46]) {
    m.ellipsoid([lx, 0, -r(lx) + 0.1], [0.45, 0.45, 0.7], C.structure, { rings: 4, segs: 8, u0: 0.5, u1: 1 });
  }
  // top lookout: a dome at the head of the spiral stair
  {
    const sx = g.shaft_x, zt = r(sx);
    m.ellipsoid([sx, 0, zt - 0.1], [1.6, 1.6, 1.4], '#9fd0d6', { rings: 5, segs: 12, u0: 0, u1: 0.5 });
    m.tube([sx, 0, zt - 0.1], [sx, 0, zt + 0.05], 1.66, C.frame, { segs: 12 });
    lamps.push({ pos: [sx, 0, zt + 1.45], colour: [1.0, 0.82, 0.5], pattern: LAMP.STEADY, size: 0.7, room: ROOM['top lookout'] });
  }
  // navigation lights
  lamps.push({ pos: [0, b + 0.2, 0], colour: [1.0, 0.16, 0.12], pattern: LAMP.STEADY, size: 1.0 });
  lamps.push({ pos: [0, -b - 0.2, 0], colour: [0.2, 1.0, 0.45], pattern: LAMP.STEADY, size: 1.0 });
  lamps.push({ pos: [-a - 0.25, 0, 0], colour: [1.0, 0.97, 0.9], pattern: LAMP.STEADY, size: 0.9 });
  lamps.push({ pos: [a + 0.25, 0, 0], colour: [1.0, 0.97, 0.9], pattern: LAMP.FLASH, size: 0.8 });
  lamps.push({ pos: [-12, 0, b * Math.sqrt(1 - (12 / a) ** 2) + 0.3], colour: [1.0, 0.2, 0.15], pattern: LAMP.BEACON, size: 1.0 });
  // the lower anti-collision beacon, under the upper one and well clear of the lidars
  lamps.push({ pos: [-12, 0, -r(-12) - 0.3], colour: [1.0, 0.2, 0.15], pattern: LAMP.BEACON, size: 1.0 });

  /* ---- one propeller, about the origin, turning on the x axis ---- */
  const prop = new MeshBuilder();
  prop.ellipsoid([0.22, 0, 0], [0.5, 0.26, 0.26], C.pod, { rings: 5, segs: 8 });
  for (let k = 0; k < 3; k++) {
    prop.with(rotationX(k * Math.PI * 2 / 3), () => {
      const R = inp.prop_r;
      // a tapered blade with a little pitch, tipped in the trim colour
      const sect = (rr, chord) => [[0.08, rr, -chord / 2], [-0.08, rr, chord / 2]];
      const s0 = sect(0.2, 0.3), s1 = sect(R * 0.72, 0.36), s2 = sect(R * 0.9, 0.26), s3 = sect(R, 0.14);
      for (const [p, q, col] of [[s0, s1, C.blade], [s1, s2, C.blade], [s2, s3, C.accent]]) {
        prop.quad(p[0], p[1], q[1], q[0], col, { normal: [1, 0, 0] });
      }
    });
  }

  const body = m.finish(), panes = glass.finish(), propeller = prop.finish();
  return {
    body, glass: panes, prop: propeller, propMounts, lamps, geometry: g,
    // What the hull shader needs to draw the envelope's detail and cut its openings.
    hull: {
      a, b, ring: g.ring, bay: [bx, gx, bw], deck2: [gx, xs2, tip, hw2],
      solar: [inp.solar_x[0], inp.solar_x[1], inp.solar_deg], gutter: [inp.gutter_x[0], inp.gutter_x[1], inp.gutter_deg],
      obs: [a - inp.obs_u, inp.obs_zf, inp.obs_zt], moor: [a - inp.moor_u, inp.moor_zf, inp.moor_zt],
    },
  };
}

/* A person, about 1.75 m, out of a few blocks: enough to read as someone at a
   window from sixty metres. pos is where they stand (or the seat they sit
   on); heading turns them about z, 0 facing forward. */
function figure(m, pos, heading, mat, o = {}) {
  const coat = o.coat || '#5a6a7a', skin = '#e2b38c', legs = o.legs || '#3a3f4a';
  m.with(multiply(translation(pos[0], pos[1], pos[2]), rotationZ(heading)), () => {
    if (o.seated) {
      m.box([-0.05, -0.2, 0], [0.45, 0.2, 0.16], legs, mat);
      m.box([0.33, -0.2, -0.42], [0.47, 0.2, 0.02], legs, mat);
      m.box([-0.14, -0.22, 0.14], [0.1, 0.22, 0.72], coat, mat);
      m.ellipsoid([0, 0, 0.9], [0.12, 0.11, 0.14], skin, { ...mat, rings: 4, segs: 6 });
    } else {
      m.box([-0.1, -0.2, 0], [0.1, -0.03, 0.85], legs, mat);
      m.box([-0.1, 0.03, 0], [0.1, 0.2, 0.85], legs, mat);
      m.box([-0.13, -0.24, 0.85], [0.13, 0.24, 1.48], coat, mat);
      m.box([-0.08, -0.33, 0.9], [0.08, -0.24, 1.45], coat, mat);
      m.box([-0.08, 0.24, 0.9], [0.08, 0.33, 1.45], coat, mat);
      m.ellipsoid([0, 0, 1.62], [0.12, 0.11, 0.14], skin, { ...mat, rings: 4, segs: 6 });
    }
  });
}
