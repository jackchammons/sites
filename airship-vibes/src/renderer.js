/*
 * The WebGL2 renderer.
 *
 * A picture is made in four steps:
 *   1. the scene, antialiased, into a colour and a depth texture: the
 *      airship, its lamps, birds, buildings, the ground and last the sky, so
 *      that what is hidden is never shaded; then the window panes, blended;
 *   2. cloud, marched at half size between the eye and that depth;
 *   3. glow: what is bright in the scene, gathered small and blurred;
 *   4. composite: the three laid together, onto the canvas.
 * The canvas is the size the picture is drawn at; the browser enlarges it to
 * the screen, smoothly.
 *
 * Through a dissolve there are two pictures, both moving. Each is composited
 * into a texture of its own and a fifth step mixes them. A picture that is
 * mostly faded out is drawn smaller, in a corner of the same textures, so a
 * dissolve costs little more than a frame without one.
 *
 * The scene texture's alpha is not transparency: it is how strongly a pixel
 * glows, which step 3 gathers.
 *
 * This is the only module that talks to WebGL. What it draws is decided
 * elsewhere: the models in ship.js, the scenes in scenes.js, the poses in
 * director.js.
 */
import * as G from './glsl.js';
import { STRIDE } from './mesh.js';
import { axis, buildGrid, snapStep, visibleBlocks, packBlocks, visibleLots, lotCapacity } from './terrain.js';
import { toLinear } from './colour.js';
import { buildCloudNoise, buildValueLattice, buildRandomLattice, LATTICE, CLOUD_SIZE } from './noise.js';
import { birdsAt, BIRD_FLOATS } from './flock.js';
import * as V from './vec.js';

const NEAR = 2, FAR = 140000;
const UNIT = { scene: 0, depth: 1, cloud: 2, ref: 3, noise: 4, value: 5, rand: 6, glow: 7, from: 8, to: 9, src: 10 };
const LOT_SLOTS = 8;              // buildings a city block can hold: four lots, two tiers each
const CITY_TOP = 300;             // nothing in the city stands taller, in metres

export class ShaderError extends Error {}

function compile(gl, src, name) {
  const prog = gl.createProgram();
  for (const [type, text] of [[gl.VERTEX_SHADER, src.vs], [gl.FRAGMENT_SHADER, src.fs]]) {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, text);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(sh) || '';
      const m = /ERROR: \d+:(\d+)/.exec(log);
      const line = m ? text.split('\n')[Number(m[1]) - 1] : '';
      throw new ShaderError(`${name} ${type === gl.VERTEX_SHADER ? 'vertex' : 'fragment'} shader: ${log.trim()}${line ? `\n  > ${line.trim()}` : ''}`);
    }
    gl.attachShader(prog, sh);
    gl.deleteShader(sh);
  }
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    throw new ShaderError(`${name} did not link: ${(gl.getProgramInfoLog(prog) || '').trim()}`);
  }
  // Every active uniform, with a setter chosen by its type, so a pass can be
  // handed one bag of values and take what it declares.
  const uniforms = new Map();
  const n = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) {
    const info = gl.getActiveUniform(prog, i);
    const base = info.name.replace(/\[0\]$/, '');
    const loc = gl.getUniformLocation(prog, info.name);
    const set = {
      [gl.FLOAT]: v => (typeof v === 'number' ? gl.uniform1f(loc, v) : gl.uniform1fv(loc, v)),
      [gl.FLOAT_VEC2]: v => gl.uniform2fv(loc, v),
      [gl.FLOAT_VEC3]: v => gl.uniform3fv(loc, v),
      [gl.FLOAT_VEC4]: v => gl.uniform4fv(loc, v),
      [gl.FLOAT_MAT4]: v => gl.uniformMatrix4fv(loc, false, v),
      [gl.INT]: v => gl.uniform1i(loc, v),
      [gl.SAMPLER_2D]: v => gl.uniform1i(loc, v),
      [gl.SAMPLER_3D]: v => gl.uniform1i(loc, v),
    }[info.type];
    if (set) uniforms.set(base, set);
  }
  return { prog, uniforms, name };
}

const flat = v => (Array.isArray(v) && Array.isArray(v[0]) ? v.flat() : v);
const smooth = x => x * x * (3 - 2 * x);

export class Renderer {
  /* samples: how many samples a pixel of the scene is antialiased with; 0 for none. */
  constructor(gl, ship, { samples = 4 } = {}) {
    this.gl = gl;
    this.ship = ship;
    this.programs = new Map();
    this.width = 0; this.height = 0; this.dot = 1;
    this.samples = Math.min(samples, gl.getParameter(gl.MAX_SAMPLES) || 0);
    this.scene = null;
    this.stage = null;            // the scene on show, and what was built for it
    this.leaving = null;          // the scene before it, while it is dissolved out of
    this.stages = new Map();
    this.grids = new Map();
    this.targets = null;          // what resize() allocates

    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    this.emptyVao = gl.createVertexArray();

    // the airship's meshes
    this.body = this.meshVao(ship.body);
    this.glass = this.meshVao(ship.glass);
    this.prop = this.meshVao(ship.prop);
    this.lampBuffer = gl.createBuffer();
    this.lampVao = gl.createVertexArray();
    gl.bindVertexArray(this.lampVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.lampBuffer);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 36, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 36, 12);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 36, 28);
    gl.bindVertexArray(null);

    // birds: one small shape, drawn once per bird
    this.birdBuffer = gl.createBuffer();
    this.birdVao = gl.createVertexArray();
    gl.bindVertexArray(this.birdVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    // nose, tail and the two wing tips: x along the body, y out along the wing
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0.5, 0, 0, -0.5, 0, 0, -0.1, 1, 0, 0.5, 0, 0, -0.1, -1, 0, -0.5, 0, 0]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 12, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.birdBuffer);
    const bs = BIRD_FLOATS * 4;
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 4, gl.FLOAT, false, bs, 0); gl.vertexAttribDivisor(1, 1);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 4, gl.FLOAT, false, bs, 16); gl.vertexAttribDivisor(2, 1);
    gl.bindVertexArray(null);

    // the noise every shader reads
    this.noise = this.texture3d(buildCloudNoise(CLOUD_SIZE, 7), CLOUD_SIZE);
    const lattice = bytes => {
      const t = this.texture2d(gl.RGBA8, LATTICE, LATTICE, gl.RGBA, gl.UNSIGNED_BYTE, bytes, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
      return t;
    };
    this.value = lattice(buildValueLattice());
    this.rand = lattice(buildRandomLattice());
  }

  meshVao(mesh) {
    const gl = this.gl;
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, mesh.buffer, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, STRIDE, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, STRIDE, 12);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 4, gl.UNSIGNED_BYTE, true, STRIDE, 24);
    gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 4, gl.UNSIGNED_BYTE, false, STRIDE, 28);
    gl.bindVertexArray(null);
    return { vao, count: mesh.count };
  }

  texture3d(bytes, size) {
    const gl = this.gl;
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_3D, t);
    gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGBA8, size, size, size, 0, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    for (const axisName of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T, gl.TEXTURE_WRAP_R]) gl.texParameteri(gl.TEXTURE_3D, axisName, gl.REPEAT);
    return t;
  }

  texture2d(internal, w, h, format, type, bytes, filter) {
    const gl = this.gl;
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, format, type, bytes);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }

  // A colour texture (or several) to draw into, w by h.
  target(w, h, filter, count = 1) {
    const gl = this.gl;
    const fbo = gl.createFramebuffer(), tex = [];
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    for (let i = 0; i < count; i++) {
      tex.push(this.texture2d(gl.RGBA8, w, h, gl.RGBA, gl.UNSIGNED_BYTE, null, filter));
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, tex[i], 0);
    }
    if (count > 1) gl.drawBuffers(tex.map((_, i) => gl.COLOR_ATTACHMENT0 + i));
    return { fbo, tex, w, h };
  }

  program(key, make) {
    if (!this.programs.has(key)) this.programs.set(key, compile(this.gl, make(), key));
    return this.programs.get(key);
  }

  use(p, values) {
    const gl = this.gl;
    gl.useProgram(p.prog);
    for (const [name, set] of p.uniforms) {
      const v = values[name];
      if (v !== undefined) set(flat(v));
    }
  }

  // Change how many samples a pixel of the scene gets. Takes effect at the next resize(), which it forces.
  setSamples(samples) {
    this.samples = Math.min(samples, this.gl.getParameter(this.gl.MAX_SAMPLES) || 0);
    this.width = 0;
  }

  /* The picture is width x height drawn pixels, `dot` of them to a CSS pixel. */
  resize(width, height, dot) {
    const gl = this.gl;
    if (width === this.width && height === this.height && dot === this.dot) return;
    this.width = width; this.height = height; this.dot = dot;
    const old = this.targets;
    if (old) {
      for (const t of [old.resolve, old.cloud, old.glowA, old.glowB, old.from, old.to]) {
        if (!t) continue;
        for (const x of t.tex) gl.deleteTexture(x);
        gl.deleteFramebuffer(t.fbo);
      }
      gl.deleteTexture(old.depth);
      if (old.msaa) { gl.deleteFramebuffer(old.msaa.fbo); for (const r of old.msaa.buffers) gl.deleteRenderbuffer(r); }
    }
    const T = this.targets = {};
    // the scene as the later steps read it: colour and depth, one sample a pixel
    T.resolve = this.target(width, height, gl.LINEAR);
    T.depth = this.texture2d(gl.DEPTH_COMPONENT24, width, height, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null, gl.NEAREST);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, T.depth, 0);
    // and as it is drawn, several samples a pixel, when the device has them
    if (this.samples > 1) {
      const fbo = gl.createFramebuffer(), buffers = [];
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      for (const [format, attachment] of [[gl.RGBA8, gl.COLOR_ATTACHMENT0], [gl.DEPTH_COMPONENT24, gl.DEPTH_ATTACHMENT]]) {
        const rb = gl.createRenderbuffer();
        gl.bindRenderbuffer(gl.RENDERBUFFER, rb);
        gl.renderbufferStorageMultisample(gl.RENDERBUFFER, this.samples, format, width, height);
        gl.framebufferRenderbuffer(gl.FRAMEBUFFER, attachment, gl.RENDERBUFFER, rb);
        buffers.push(rb);
      }
      T.msaa = { fbo, buffers };
    }
    T.cloud = this.target((width + 1) >> 1, (height + 1) >> 1, gl.NEAREST, 2);
    // glow: one texel to two dots, whatever a dot is being drawn with
    const gw = Math.max(1, Math.ceil(width / dot / 2)), gh = Math.max(1, Math.ceil(height / dot / 2));
    T.glowA = this.target(gw, gh, gl.LINEAR);
    T.glowB = this.target(gw, gh, gl.LINEAR);
    // T.from and T.to, the two pictures of a dissolve, are made when the first dissolve needs them
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  /* Make a scene the one on show. What belongs to a scene (its programs, its
     ground grid and its lamps) is its "stage", built once and kept, so the
     scene being left can go on being drawn, still moving, while the new one
     dissolves in over it. lights is the per-room brightness for this visit. */
  setScene(scene, lights) {
    const gl = this.gl;
    // a copy: the stage itself is about to be given this visit's lights
    if (this.stage) this.leaving = { ...this.stage };
    let st = this.stages.get(scene.id);
    if (!st) {
      // compiled now, so a bad shader fails here and not mid-frame
      st = { scene, grid: this.gridFor(scene), programs: this.passes(scene) };
      this.stages.set(scene.id, st);
    }
    st.lights = lights;
    // lamps: brightness can depend on a room's light being on
    const lamps = this.ship.lamps;
    st.lamps = new Float32Array(lamps.length * 9);
    lamps.forEach((l, i) => {
      const on = l.room === undefined ? 1 : lights[l.room];
      st.lamps.set([...l.pos, l.colour[0] * on, l.colour[1] * on, l.colour[2] * on, l.size, l.pattern, i * 0.13], i * 9);
    });
    this.stage = st;
    this.scene = scene;

    // buildings: one box, drawn once per lot and tier for every block in sight
    if (scene.city && !this.cityVao) {
      const box = [];
      const face = (n, a, b, c, d) => { for (const q of [a, b, c, a, c, d]) box.push(...q, ...n); };
      face([1, 0, 0], [0.5, -0.5, 0], [0.5, 0.5, 0], [0.5, 0.5, 1], [0.5, -0.5, 1]);
      face([-1, 0, 0], [-0.5, 0.5, 0], [-0.5, -0.5, 0], [-0.5, -0.5, 1], [-0.5, 0.5, 1]);
      face([0, 1, 0], [0.5, 0.5, 0], [-0.5, 0.5, 0], [-0.5, 0.5, 1], [0.5, 0.5, 1]);
      face([0, -1, 0], [-0.5, -0.5, 0], [0.5, -0.5, 0], [0.5, -0.5, 1], [-0.5, -0.5, 1]);
      face([0, 0, 1], [-0.5, -0.5, 1], [0.5, -0.5, 1], [0.5, 0.5, 1], [-0.5, 0.5, 1]);
      this.cityLots = new Float32Array(lotCapacity(scene.city.radius, LOT_SLOTS) * 3);
      this.cityVao = gl.createVertexArray();
      gl.bindVertexArray(this.cityVao);
      gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(box), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 24, 0);
      gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 24, 12);
      this.cityBuffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.cityBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, this.cityLots.byteLength, gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 3, gl.FLOAT, false, 12, 0); gl.vertexAttribDivisor(2, 1);
      gl.bindVertexArray(null);
    }
  }

  // The ground grid for a scene; scenes with the same bands share one.
  gridFor(scene) {
    const gl = this.gl;
    const key = JSON.stringify(scene.grid);
    if (!this.grids.has(key)) {
      const g = buildGrid(axis(scene.grid.x), axis(scene.grid.y));
      const vao = gl.createVertexArray();
      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
      gl.bufferData(gl.ARRAY_BUFFER, g.vertices, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 8, 0);
      // the triangles in sight change with the camera: the index buffer is refilled for every picture
      const elements = gl.createBuffer();
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, elements);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, g.indices.byteLength, gl.DYNAMIC_DRAW);
      gl.bindVertexArray(null);
      this.grids.set(key, { vao, elements, data: g, seen: new Uint32Array(g.indices.length), sent: '', count: 0, snap: snapStep(scene.grid.x) });
    }
    return this.grids.get(key);
  }

  passes(scene) {
    // Programs that read cloud are built once per kind of cloud, and the ground once per kind of ground.
    const lib = G.CLOUD_LIB;
    const kind = scene.cloud ? scene.cloud.kind : 0;
    const defs = { CLOUDS: kind, CLOUD_STEPS: scene.cloud ? scene.cloud.steps : 1, CLOUD_SIZE: CLOUD_SIZE.toFixed(1) };
    const terrainDefs = { ...defs, TERRAIN: scene.terrain, VS_OCT: 7 };
    let groundLib = lib + G.TERRAIN_LIB;
    if (scene.city) {
      const m = v => v.toFixed(1);
      Object.assign(terrainDefs, { BLOCK: m(scene.city.block), STREET: m(scene.city.street), LOT: m((scene.city.block - scene.city.street) / 2) });
      groundLib += G.CITY_LIB;
    }
    return {
      city: scene.city ? this.program('city', () => G.program(G.CITY_VS, G.CITY_FS, terrainDefs, groundLib)) : null,
      sky: this.program('sky', () => G.program(G.FULLSCREEN_VS, G.SKY_FS)),
      terrain: this.program(`terrain${scene.terrain}/${kind}`, () => G.program(G.TERRAIN_VS, G.TERRAIN_FS, terrainDefs, groundLib)),
      ship: this.program(`ship/${kind}`, () => G.program(G.SHIP_VS, G.SHIP_FS, defs, lib)),
      point: this.program('point', () => G.program(G.POINT_VS, G.POINT_FS)),
      bird: this.program('bird', () => G.program(G.BIRD_VS, G.BIRD_FS)),
      cloud: kind ? this.program(`cloud/${kind}/${defs.CLOUD_STEPS}`, () => G.program(G.FULLSCREEN_VS, G.CLOUD_FS, defs, lib)) : null,
      glow: this.program('glow', () => G.program(G.FULLSCREEN_VS, G.GLOW_FS)),
      composite: this.program(`composite/${kind ? 1 : 0}`, () => G.program(G.FULLSCREEN_VS, G.COMPOSITE_FS, { CLOUDS: kind ? 1 : 0 })),
      mix: this.program('mix', () => G.program(G.FULLSCREEN_VS, G.MIX_FS)),
    };
  }

  /* Draw second frame.t. Through a dissolve, two pictures are drawn and mixed,
     and both are live: for a change of shot, the same scene from the camera
     being left; for a change of scene (o.leaving: the old scene's own frame,
     and how far the change has gone), the scene being left, on its own stage.
     Nothing is ever a held frame. */
  render(frame, o = {}) {
    const gl = this.gl;
    const live = !o.still;
    let from = null, fade = 1;
    if (live && o.leaving && this.leaving && o.leaving.fade < 1) {
      from = { st: this.leaving, frame: o.leaving.frame, cam: o.leaving.frame.camera };
      fade = o.leaving.fade;
    } else if (live && frame.outgoing && frame.fade < 1) {
      from = { st: this.stage, frame, cam: frame.outgoing.camera };
      fade = frame.fade;
    }
    if (!from) {
      this.view(this.stage, frame, frame.camera, 1, null);
      return;
    }
    const T = this.targets;
    if (!T.from) {
      T.from = this.target(this.width, this.height, gl.LINEAR);
      T.to = this.target(this.width, this.height, gl.LINEAR);
    }
    /* A picture is drawn at a size to match how much of it shows: the one
       fading out shrinks to half as it goes, the one fading in grows from
       half. The two together are never much more than one whole picture. */
    const m = smooth(Math.min(Math.max(fade, 0), 1));
    const a = this.view(from.st, from.frame, from.cam, 1 - 0.5 * m, T.from);
    const b = this.view(this.stage, frame, frame.camera, 0.5 + 0.5 * m, T.to);

    /* ---- 5: mix ---- */
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.width, this.height);
    gl.disable(gl.DEPTH_TEST);
    gl.activeTexture(gl.TEXTURE0 + UNIT.from); gl.bindTexture(gl.TEXTURE_2D, T.from.tex[0]);
    gl.activeTexture(gl.TEXTURE0 + UNIT.to); gl.bindTexture(gl.TEXTURE_2D, T.to.tex[0]);
    this.use(this.stage.programs.mix, { uFrom: UNIT.from, uTo: UNIT.to, uFromRect: a, uToRect: b, uMix: m });
    gl.bindVertexArray(this.emptyVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
  }

  /* Steps 1 to 4 for one camera on one stage, at `size` (0..1] of the full
     picture, onto the canvas or into `into`. Returns the corner of the
     target the picture occupies, as the mix step wants it. */
  view(st, frame, cam, size, into) {
    const gl = this.gl, s = st.scene, T = this.targets, P = st.programs;
    const W = into ? Math.max(2, Math.round(this.width * size)) : this.width;
    const H = into ? Math.max(2, Math.round(this.height * size)) : this.height;
    const dot = this.dot * W / this.width;                 // drawn pixels per dot in this picture
    const t = frame.t;

    const proj = V.perspective(cam.fov, W / H, NEAR, FAR);
    const viewProj = V.multiply(proj, V.lookAt(cam.eye, cam.target));
    const planes = V.frustumPlanes(viewProj);
    const dotAngle = cam.fov / (this.height / this.dot);   // radians a dot covers

    const sh = frame.ship;
    const rot = V.multiply(V.rotationZ(sh.yaw), V.multiply(V.rotationY(-sh.pitch), V.rotationX(sh.roll)));
    const model = V.multiply(V.translation(...sh.pos), rot);
    const sunDir = V.normalize(s.sun.dir);
    // the sun in the ship's own axes: the rotation is orthonormal, so its inverse is its transpose
    const sunObj = [
      rot[0] * sunDir[0] + rot[1] * sunDir[1] + rot[2] * sunDir[2],
      rot[4] * sunDir[0] + rot[5] * sunDir[1] + rot[6] * sunDir[2],
      rot[8] * sunDir[0] + rot[9] * sunDir[1] + rot[10] * sunDir[2],
    ];
    const lin = (hex, k = 1) => toLinear(hex).map(c => c * k);
    const cloud = s.cloud;
    const hull = this.ship.hull;
    const rad = Math.PI / 180;
    const snap = Math.floor(frame.origin[0] / st.grid.snap) * st.grid.snap;

    // the buildings' grid is centred a little ahead of the camera, where it is looking
    let city = [0, 0, 0, 0];
    if (s.city) {
      const fwd = V.normalize([cam.target[0] - cam.eye[0], cam.target[1] - cam.eye[1], 0]);
      const reach = s.city.radius * s.city.block * 0.55;
      const wx = frame.origin[0] + cam.eye[0] + fwd[0] * reach, wy = frame.origin[1] + cam.eye[1] + fwd[1] * reach;
      const cx = Math.floor(wx / s.city.block), cy = Math.floor(wy / s.city.block);
      city = [cx, cy, cx * s.city.block - frame.origin[0], cy * s.city.block - frame.origin[1]];
    }

    const gw = Math.max(1, Math.ceil(W / dot / 2)), gh = Math.max(1, Math.ceil(H / dot / 2));
    // the corner of a texture a picture w x h occupies: its size and its last texel centre, in uv
    const corner = (w, h, of) => [w / of.w, h / of.h, (w - 0.5) / of.w, (h - 0.5) / of.h];

    const U = {
      uCity: city, uCityDraw: [s.city ? s.city.radius : 0, 0, 0, 0],
      uViewProj: viewProj, uInvViewProj: V.invert(viewProj), uCam: cam.eye, uOrigin: frame.origin, uTime: t,
      uRes: [W, H, dot, dotAngle], uValue: UNIT.value, uRand: UNIT.rand,
      uSunDir: sunDir, uSunCol: lin(s.sun.colour, s.sun.strength),
      uAmbSky: lin(s.ambient.sky, s.ambient.skyStrength), uAmbGround: lin(s.ambient.ground, s.ambient.groundStrength),
      uFogCol: lin(s.fog.colour), uFogSun: lin(s.fog.sun), uFog: [s.fog.density, s.fog.falloff, s.fog.max, s.fog.sunPower],
      uSkyTop: lin(s.sky.top), uSkyMid: lin(s.sky.mid), uSkyLow: lin(s.sky.low), uSkyShape: [...s.sky.shape, 0, 0],
      uPath: [s.path.amp1, s.path.freq1, s.path.amp2, s.path.freq2],
      // sky: a star's cell is a dot and a half across
      uSun: s.sun.shape, uSunDisc: lin(s.sun.disc, s.sun.discStrength ?? 1), uSunGlow: lin(s.sun.glow),
      uStars: [s.sky.stars[0] > 0 ? 0.66 / dotAngle : 0, s.sky.stars[1], s.sky.stars[2], s.sky.stars[3]],
      uBands: [s.sky.bands.cover, s.sky.bands.scale, s.sky.bands.stretch, s.sky.bands.height],
      uBandLit: lin(s.sky.bands.lit), uBandDark: lin(s.sky.bands.dark),
      // cloud
      uNoise: UNIT.noise,
      uCloudSlab: cloud ? [cloud.floor, cloud.ceiling, cloud.cover, cloud.density] : [0, 1, 0, 0],
      uCloudShape: cloud ? [cloud.size, cloud.detail, ...cloud.drift] : [1, 1, 0, 0],
      uCloudLit: cloud ? lin(cloud.lit) : [1, 1, 1], uCloudDark: cloud ? lin(cloud.dark) : [0.5, 0.5, 0.5],
      uCloudDeep: cloud ? lin(cloud.deep) : [0.3, 0.3, 0.3],
      uCloudMarch: cloud ? [cloud.grow, cloud.reach, cloud.lightStep, cloud.through] : [1, 1, 1, 9],
      uCloudLight: cloud ? [cloud.shade, cloud.opacity, cloud.burn ?? 0, 0] : [1, 1, 0, 0],
      uCloudSh: [cloud ? cloud.shadow : 0, 0, 0, 0],
      // ground
      uGrid: [snap - frame.origin[0], snap, -frame.origin[1], 0],
      uLand: [s.land.seaLevel, 0, (frame.seed % 1000) * 0.37, 0],
      uTc: s.land.colours.map(c => lin(c)),
      uShipPos: [...sh.pos, sh.yaw], uShipDims: [hull.a, hull.b, 0, 0],
      // ship
      uModel: model, uPart: V.identity(), uSunObj: sunObj,
      uHull: [hull.a, hull.b, hull.ring, 0], uBay: [...hull.bay, 0], uDeck2: hull.deck2,
      uSolar: [hull.solar[0], hull.solar[1], Math.cos(hull.solar[2] * rad), 0],
      uGutter: [hull.gutter[0], hull.gutter[1], Math.sin(hull.gutter[2] * rad), 0],
      uObs: [...hull.obs, 0], uRoom: st.lights, uRoomTint: lin(s.ship.roomTint),
      uGlass: [s.ship.glass, 0, s.ship.bounceStrength, s.ship.windowGlow ?? 1], uBounce: lin(s.ship.bounce),
      // lamps are a dot and a half across at the least and five at the most; a far bird spans three dots
      uPoint: [1.5, 5, s.ship.lamps, 0],
      uBird: [3.2, 0, 0, 0], uBirdCol: s.birds ? lin(s.birds.colour) : [0, 0, 0],
      // cloud march and composite
      uScene: UNIT.scene, uDepth: UNIT.depth, uCloud: UNIT.cloud, uCloudRef: UNIT.ref, uGlow: UNIT.glow,
      uGlowRect: corner(gw, gh, T.glowB),
      uProj: [NEAR, FAR, 0, 0],
      uLook: [s.look.glow, s.look.outline, 0, s.look.vignette],
    };

    const bind = (unit, target, tex) => { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(target, tex); };
    bind(UNIT.noise, gl.TEXTURE_3D, this.noise);
    bind(UNIT.value, gl.TEXTURE_2D, this.value);
    bind(UNIT.rand, gl.TEXTURE_2D, this.rand);
    // what the scene is drawn into must not be bound for reading while it is
    for (const unit of [UNIT.scene, UNIT.depth, UNIT.cloud, UNIT.ref, UNIT.glow, UNIT.src]) bind(unit, gl.TEXTURE_2D, null);

    /* ---- 1: the scene ---- */
    gl.bindFramebuffer(gl.FRAMEBUFFER, T.msaa ? T.msaa.fbo : T.resolve.fbo);
    gl.viewport(0, 0, W, H);
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(0, 0, W, H);
    gl.disable(gl.BLEND);
    gl.disable(gl.CULL_FACE);
    gl.depthMask(true);
    gl.clearColor(0, 0, 0, 0);
    gl.clearDepth(1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);

    // Nearest things first: what they cover is then never shaded.
    this.use(P.ship, U);
    gl.bindVertexArray(this.body.vao);
    gl.drawArrays(gl.TRIANGLES, 0, this.body.count);
    gl.bindVertexArray(this.prop.vao);
    const setPart = P.ship.uniforms.get('uPart');
    for (const mount of this.ship.propMounts) {
      const part = V.multiply(V.translation(...mount.pos), V.rotationX(t * 9.0 + mount.phase * 7));
      if (setPart) setPart(part);
      gl.drawArrays(gl.TRIANGLES, 0, this.prop.count);
    }
    if (setPart) setPart(V.identity());

    this.use(P.point, U);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.lampBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, st.lamps, gl.DYNAMIC_DRAW);
    gl.bindVertexArray(this.lampVao);
    gl.drawArrays(gl.POINTS, 0, st.lamps.length / 9);

    if (s.birds) {
      // flocks are placed in the frame that follows the flight path; turn them to the local one
      const birds = birdsAt(s.birds.flocks, frame.seed, t);
      const c = Math.cos(sh.yaw), sn = Math.sin(sh.yaw);
      for (let i = 0; i < birds.length; i += BIRD_FLOATS) {
        const x = birds[i], y = birds[i + 1];
        birds[i] = c * x - sn * y; birds[i + 1] = sn * x + c * y; birds[i + 2] += frame.altitude; birds[i + 3] += sh.yaw;
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, this.birdBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, birds, gl.DYNAMIC_DRAW);
      this.use(P.bird, U);
      gl.bindVertexArray(this.birdVao);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, birds.length / BIRD_FLOATS);
    }

    // (A length of nothing, handed to bufferData, means the whole array. So nothing in sight is not sent at all.)
    if (P.city) {
      // only the blocks the camera can see, nearest first
      const lots = visibleLots(s.city.radius, s.city.block, LOT_SLOTS, planes, cam.eye, city[2], city[3], CITY_TOP, this.cityLots);
      if (lots > 0) {
        gl.bindBuffer(gl.ARRAY_BUFFER, this.cityBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, this.cityLots, gl.DYNAMIC_DRAW, 0, lots * 3);
        this.use(P.city, U);
        gl.bindVertexArray(this.cityVao);
        gl.drawArraysInstanced(gl.TRIANGLES, 0, 30, lots);
      }
    }

    /* The ground likewise: the blocks of the grid in sight, nearest first.
       Which blocks those are changes every second or so, not every frame, and
       their triangles are most of a megabyte: they are sent only when the
       list has changed. (The grid moves in whole blocks' worth of steps, and a
       block's triangles do not depend on where it is.) */
    const grid = st.grid;
    const blocks = visibleBlocks(grid.data, planes, cam.eye, snap - frame.origin[0], -frame.origin[1], s.land.range[0], s.land.range[1]);
    if (blocks.length > 0) {
      this.use(P.terrain, U);
      gl.bindVertexArray(grid.vao);
      const list = blocks.join(' ');
      if (list !== grid.sent) {
        grid.count = packBlocks(grid.data, blocks, grid.seen);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, grid.seen, gl.DYNAMIC_DRAW, 0, grid.count);
        grid.sent = list;
      }
      gl.drawElements(gl.TRIANGLES, grid.count, gl.UNSIGNED_INT, 0);
    }

    // the sky, on the far plane: only where nothing has been drawn
    gl.depthMask(false);
    this.use(P.sky, U);
    gl.bindVertexArray(this.emptyVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // window panes: blended over all of it, and they do not write depth
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    this.use(P.ship, U);
    gl.bindVertexArray(this.glass.vao);
    gl.drawArrays(gl.TRIANGLES, 0, this.glass.count);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);

    // several samples a pixel become one, for colour and for depth
    if (T.msaa) {
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, T.msaa.fbo);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, T.resolve.fbo);
      gl.blitFramebuffer(0, 0, W, H, 0, 0, W, H, gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT, gl.NEAREST);
      gl.invalidateFramebuffer(gl.READ_FRAMEBUFFER, [gl.COLOR_ATTACHMENT0, gl.DEPTH_ATTACHMENT]);
    }
    gl.bindVertexArray(this.emptyVao);

    /* ---- 2: cloud, at half size ---- */
    if (P.cloud) {
      const cw = (W + 1) >> 1, ch = (H + 1) >> 1;
      gl.bindFramebuffer(gl.FRAMEBUFFER, T.cloud.fbo);
      gl.viewport(0, 0, cw, ch);
      gl.scissor(0, 0, cw, ch);
      bind(UNIT.depth, gl.TEXTURE_2D, T.depth);
      this.use(P.cloud, U);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    /* ---- 3: glow ---- */
    gl.viewport(0, 0, gw, gh);
    gl.scissor(0, 0, gw, gh);
    gl.bindFramebuffer(gl.FRAMEBUFFER, T.glowA.fbo);
    bind(UNIT.src, gl.TEXTURE_2D, T.resolve.tex[0]);
    this.use(P.glow, {
      uSrc: UNIT.src, uSrcRect: corner(W, H, T.resolve),
      uTap: [0.25 * W / gw / T.resolve.w, 0.25 * H / gh / T.resolve.h, 1, 0],
    });
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindFramebuffer(gl.FRAMEBUFFER, T.glowB.fbo);
    bind(UNIT.src, gl.TEXTURE_2D, T.glowA.tex[0]);
    this.use(P.glow, { uSrc: UNIT.src, uSrcRect: corner(gw, gh, T.glowA), uTap: [0.5 / T.glowA.w, 0.5 / T.glowA.h, 0, 0] });
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    bind(UNIT.src, gl.TEXTURE_2D, null);

    /* ---- 4: composite ---- */
    gl.bindFramebuffer(gl.FRAMEBUFFER, into ? into.fbo : null);
    gl.viewport(0, 0, W, H);
    gl.scissor(0, 0, W, H);
    bind(UNIT.scene, gl.TEXTURE_2D, T.resolve.tex[0]);
    bind(UNIT.depth, gl.TEXTURE_2D, T.depth);
    bind(UNIT.cloud, gl.TEXTURE_2D, T.cloud.tex[0]);
    bind(UNIT.ref, gl.TEXTURE_2D, T.cloud.tex[1]);
    bind(UNIT.glow, gl.TEXTURE_2D, T.glowB.tex[0]);
    this.use(P.composite, U);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.disable(gl.SCISSOR_TEST);
    gl.bindVertexArray(null);
    return into ? corner(W, H, into) : [1, 1, 1, 1];
  }
}
