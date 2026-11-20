/*
 * A triangle-soup builder.
 *
 * Every model in the scenes is generated: there are no model files. A builder
 * collects triangles with a normal, a colour, a material number and one spare
 * byte per vertex, and finish() packs them into the 32-byte vertex the
 * renderer draws:
 *
 *   offset 0   position  3 x float32
 *   offset 12  normal    3 x float32
 *   offset 24  colour    4 x uint8   r, g, b (sRGB) and glow, the share of the
 *                                    colour that is self-lit
 *   offset 28  material  uint8       one of MAT
 *   offset 29  aux       uint8       meaning depends on the material
 *   offset 30  padding   2 bytes
 *
 * Nothing here touches the DOM or WebGL, so the tests build the same meshes
 * the page draws.
 */
import { cross, sub, normalize, transformPoint, transformDir, multiply, identity } from './vec.js';

export const STRIDE = 32;

export const MAT = {
  PAINT: 0,     // lit by the scene
  HULL: 1,      // the envelope: seams, solar skin and gutters are drawn by the shader
  ROOM: 2,      // inside the gondola: lit by its own lamps; aux is the room number
  GLASS: 3,     // window panes, drawn blended after everything else
  LAMP: 4,      // a light source; aux is its blink pattern
  SCREEN: 5,    // instrument glow on the bridge
};

// '#rrggbb' or [r, g, b] in 0..1, both sRGB.
export function rgb(c) {
  if (Array.isArray(c)) return c;
  const n = parseInt(c.slice(1), 16);
  return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255];
}
export const shade = (c, k) => { const [r, g, b] = rgb(c); return [Math.min(1, r * k), Math.min(1, g * k), Math.min(1, b * k)]; };

export class MeshBuilder {
  constructor() {
    this.pos = [];
    this.nrm = [];
    this.col = [];
    this.tag = [];
    this.stack = [identity()];
  }

  get count() { return this.pos.length / 3; }
  get matrix() { return this.stack[this.stack.length - 1]; }

  // Run fn with m applied on top of the current transform.
  with(m, fn) {
    this.stack.push(multiply(this.matrix, m));
    try { fn(); } finally { this.stack.pop(); }
    return this;
  }

  vertex(p, n, c, glow = 0, mat = MAT.PAINT, aux = 0) {
    const m = this.matrix;
    const q = transformPoint(m, p);
    const k = normalize(transformDir(m, n));
    const [r, g, b] = rgb(c);
    this.pos.push(q[0], q[1], q[2]);
    this.nrm.push(k[0], k[1], k[2]);
    this.col.push(r, g, b, glow);
    this.tag.push(mat, aux);
  }

  // A flat triangle; counter-clockwise seen from the side its normal points to.
  tri(a, b, c, col, o = {}) {
    const n = o.normal || normalize(cross(sub(b, a), sub(c, a)));
    for (const p of [a, b, c]) this.vertex(p, n, col, o.glow, o.mat, o.aux);
    return this;
  }

  quad(a, b, c, d, col, o = {}) {
    const n = o.normal || normalize(cross(sub(b, a), sub(d, a)));
    const oo = { ...o, normal: n };
    this.tri(a, b, c, col, oo);
    this.tri(a, c, d, col, oo);
    return this;
  }

  // A triangle with a normal per corner, for curved surfaces.
  smoothTri(a, b, c, na, nb, nc, col, o = {}) {
    this.vertex(a, na, col, o.glow, o.mat, o.aux);
    this.vertex(b, nb, col, o.glow, o.mat, o.aux);
    this.vertex(c, nc, col, o.glow, o.mat, o.aux);
    return this;
  }

  /* An axis-aligned box from lo to hi. faces picks which of the six sides are
     built ('x' is the low-x side, 'X' the high-x side, and so on); tint gives a
     per-side multiplier so a box can carry its own crude shading where the
     scene's lights do not reach, inside the gondola. */
  box(lo, hi, col, o = {}) {
    const [x0, y0, z0] = lo, [x1, y1, z1] = hi;
    const faces = o.faces || 'xXyYzZ';
    const tint = o.tint || {};
    const side = (f, a, b, c, d) => {
      if (!faces.includes(f)) return;
      this.quad(a, b, c, d, tint[f] ? shade(col, tint[f]) : col, o);
    };
    side('x', [x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]);
    side('X', [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]);
    side('y', [x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]);
    side('Y', [x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0]);
    side('z', [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [x1, y0, z0]);
    side('Z', [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]);
    return this;
  }

  /* A straight member of round section between two points. */
  tube(p0, p1, radius, col, o = {}) {
    const segs = o.segs || 6;
    const axis = normalize(sub(p1, p0));
    const ref = Math.abs(axis[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
    const u = normalize(cross(axis, ref));
    const v = cross(axis, u);
    const r1 = o.radius1 ?? radius;
    const ring = (p, rad) => Array.from({ length: segs }, (_, i) => {
      const t = i / segs * Math.PI * 2;
      const d = [u[0] * Math.cos(t) + v[0] * Math.sin(t), u[1] * Math.cos(t) + v[1] * Math.sin(t), u[2] * Math.cos(t) + v[2] * Math.sin(t)];
      return { p: [p[0] + d[0] * rad, p[1] + d[1] * rad, p[2] + d[2] * rad], n: d };
    });
    const a = ring(p0, radius), b = ring(p1, r1);
    for (let i = 0; i < segs; i++) {
      const j = (i + 1) % segs;
      this.smoothTri(a[i].p, a[j].p, b[j].p, a[i].n, a[j].n, b[j].n, col, o);
      this.smoothTri(a[i].p, b[j].p, b[i].p, a[i].n, b[j].n, b[i].n, col, o);
    }
    if (o.caps) {
      for (let i = 1; i < segs - 1; i++) {
        this.tri(a[0].p, a[i + 1].p, a[i].p, col, o);
        this.tri(b[0].p, b[i].p, b[i + 1].p, col, o);
      }
    }
    return this;
  }

  /* An ellipsoid about centre with the given radii. u0..u1 limits the latitude
     (0 at the +z pole, 1 at the -z pole), so 0..0.5 is a dome. */
  ellipsoid(centre, radii, col, o = {}) {
    const nu = o.rings || 8, nv = o.segs || 12;
    const u0 = o.u0 ?? 0, u1 = o.u1 ?? 1;
    const at = (iu, iv) => {
      const th = (u0 + (u1 - u0) * iu / nu) * Math.PI, ph = iv / nv * Math.PI * 2;
      const d = [Math.sin(th) * Math.cos(ph), Math.sin(th) * Math.sin(ph), Math.cos(th)];
      return {
        p: [centre[0] + d[0] * radii[0], centre[1] + d[1] * radii[1], centre[2] + d[2] * radii[2]],
        n: normalize([d[0] / radii[0], d[1] / radii[1], d[2] / radii[2]]),
      };
    };
    for (let iu = 0; iu < nu; iu++) {
      for (let iv = 0; iv < nv; iv++) {
        const a = at(iu, iv), b = at(iu + 1, iv), c = at(iu + 1, iv + 1), d = at(iu, iv + 1);
        this.smoothTri(a.p, b.p, c.p, a.n, b.n, c.n, col, o);
        this.smoothTri(a.p, c.p, d.p, a.n, c.n, d.n, col, o);
      }
    }
    return this;
  }

  /* A flat polygon as a fan about its first point. The points are taken to be
     counter-clockwise seen from the side the normal should point to. */
  fan(points, col, o = {}) {
    for (let i = 1; i < points.length - 1; i++) this.tri(points[0], points[i], points[i + 1], col, o);
    return this;
  }

  // Append another builder's triangles, through this builder's transform.
  merge(other) {
    const m = this.matrix;
    for (let i = 0; i < other.count; i++) {
      const p = transformPoint(m, other.pos.slice(i * 3, i * 3 + 3));
      const n = normalize(transformDir(m, other.nrm.slice(i * 3, i * 3 + 3)));
      this.pos.push(...p);
      this.nrm.push(...n);
      this.col.push(...other.col.slice(i * 4, i * 4 + 4));
      this.tag.push(...other.tag.slice(i * 2, i * 2 + 2));
    }
    return this;
  }

  bounds() {
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < this.pos.length; i += 3) {
      for (let k = 0; k < 3; k++) {
        lo[k] = Math.min(lo[k], this.pos[i + k]);
        hi[k] = Math.max(hi[k], this.pos[i + k]);
      }
    }
    return { lo, hi };
  }

  finish() {
    const count = this.count;
    const buffer = new ArrayBuffer(count * STRIDE);
    const f = new Float32Array(buffer);
    const b = new Uint8Array(buffer);
    const byte = v => Math.max(0, Math.min(255, Math.round(v * 255)));
    for (let i = 0; i < count; i++) {
      const fo = i * (STRIDE / 4), bo = i * STRIDE;
      f[fo] = this.pos[i * 3]; f[fo + 1] = this.pos[i * 3 + 1]; f[fo + 2] = this.pos[i * 3 + 2];
      f[fo + 3] = this.nrm[i * 3]; f[fo + 4] = this.nrm[i * 3 + 1]; f[fo + 5] = this.nrm[i * 3 + 2];
      b[bo + 24] = byte(this.col[i * 4]); b[bo + 25] = byte(this.col[i * 4 + 1]);
      b[bo + 26] = byte(this.col[i * 4 + 2]); b[bo + 27] = byte(this.col[i * 4 + 3]);
      b[bo + 28] = this.tag[i * 2]; b[bo + 29] = this.tag[i * 2 + 1];
    }
    return { buffer, count, stride: STRIDE, bounds: this.bounds() };
  }
}
