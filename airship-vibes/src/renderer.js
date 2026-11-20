/*
 * The WebGL2 renderer.
 *
 * Three passes a frame:
 *   1. the scene, small, into a colour and a depth texture: sky, ground,
 *      airship, lamps, birds, then the window panes blended on top;
 *   2. composite: cloud marched between the eye and that depth, glow, outline,
 *      the palette, the dissolve between shots and the caption;
 *   3. present: the small picture scaled up by a whole number of device pixels.
 *
 * The colour texture's alpha is not transparency: it is how strongly a pixel
 * glows, which the composite pass spreads into its neighbours.
 *
 * This is the only module that talks to WebGL. What it draws is decided
 * elsewhere: the models in ship.js, the scenes in scenes.js, the poses in
 * director.js.
 */
import * as G from './glsl.js';
import { STRIDE } from './mesh.js';
import { axis, buildGrid, snapStep } from './terrain.js';
import { buildLut, paletteBytes, extremes, toLinear } from './palette.js';
import { buildCloudNoise } from './noise.js';
import { renderText } from './font.js';
import { birdsAt, BIRD_FLOATS } from './flock.js';
import * as V from './vec.js';

const LUT_SIZE = 32;
const NEAR = 2, FAR = 140000;
const UNIT = { scene: 0, depth: 1, prev: 2, caption: 3, noise: 4, lut: 5, palette: 6, final: 7 };

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

export class Renderer {
  constructor(gl, ship) {
    this.gl = gl;
    this.ship = ship;
    this.programs = new Map();
    this.width = 0; this.height = 0; this.scale = 1;
    this.scene = null;
    this.stage = null;            // the scene on show, and what was built for it
    this.leaving = null;          // the scene before it, while it is dissolved out of
    this.stages = new Map();
    this.grids = new Map();
    this.captionAt = 0;
    this.captionScale = 1;
    this.raw = false;

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

    // textures the composite pass reads
    this.tex = {};
    this.tex.noise = this.texture3d(buildCloudNoise(32, 7), 32, gl.LINEAR, gl.REPEAT);
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

  texture3d(bytes, size, filter, wrap) {
    const gl = this.gl;
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_3D, t);
    gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGBA8, size, size, size, 0, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, filter);
    for (const axisName of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T, gl.TEXTURE_WRAP_R]) gl.texParameteri(gl.TEXTURE_3D, axisName, wrap);
    return t;
  }

  texture2d(internal, w, h, format, type, bytes) {
    const gl = this.gl;
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, format, type, bytes);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
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

  /* The art is width x height pixels; each is drawn scale device pixels square. */
  resize(width, height, scale) {
    const gl = this.gl;
    if (width === this.width && height === this.height && scale === this.scale) return;
    this.width = width; this.height = height; this.scale = scale;
    for (const t of [this.tex.scene, this.tex.depth, this.tex.final, this.tex.prev]) if (t) gl.deleteTexture(t);
    for (const f of [this.fboScene, this.fboFinal, this.fboPrev]) if (f) gl.deleteFramebuffer(f);
    this.tex.scene = this.texture2d(gl.RGBA8, width, height, gl.RGBA, gl.UNSIGNED_BYTE, null);
    this.tex.depth = this.texture2d(gl.DEPTH_COMPONENT24, width, height, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null);
    this.tex.final = this.texture2d(gl.RGBA8, width, height, gl.RGBA, gl.UNSIGNED_BYTE, null);
    this.tex.prev = this.texture2d(gl.RGBA8, width, height, gl.RGBA, gl.UNSIGNED_BYTE, null);
    const fbo = (colour, depth) => {
      const f = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, f);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, colour, 0);
      if (depth) gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, depth, 0);
      return f;
    };
    this.fboScene = fbo(this.tex.scene, this.tex.depth);
    this.fboFinal = fbo(this.tex.final, null);
    this.fboPrev = fbo(this.tex.prev, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  /* Make a scene the one on show. What belongs to a scene (its palette table,
     caption, ground grid and lamps) is its "stage", built once and kept, so
     the scene being left can go on being drawn, still moving, while the new
     one dissolves in over it. lights is the per-room brightness for this visit. */
  setScene(scene, lights, now = 0) {
    const gl = this.gl;
    // a copy: the stage itself is about to be given this visit's lights
    if (this.stage) this.leaving = { ...this.stage };
    let st = this.stages.get(scene.id);
    if (!st) {
      const cap = renderText(scene.title);
      st = {
        scene,
        lut: this.texture3d(buildLut(scene.palette, LUT_SIZE), LUT_SIZE, gl.NEAREST, gl.CLAMP_TO_EDGE),
        palette: this.texture2d(gl.RGBA8, scene.palette.length, 1, gl.RGBA, gl.UNSIGNED_BYTE, paletteBytes(scene.palette)),
        caption: this.texture2d(gl.R8, cap.width, cap.height, gl.RED, gl.UNSIGNED_BYTE, cap.data),
        captionSize: [cap.width, cap.height],
        ink: extremes(scene.palette),
        grid: this.gridFor(scene),
      };
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
    this.captionAt = now;

    // buildings: one box, drawn once per lot and tier for every block within reach
    if (scene.city && !this.cityVao) {
      const R = scene.city.radius;
      const box = [];
      const face = (n, a, b, c, d) => { for (const q of [a, b, c, a, c, d]) box.push(...q, ...n); };
      face([1, 0, 0], [0.5, -0.5, 0], [0.5, 0.5, 0], [0.5, 0.5, 1], [0.5, -0.5, 1]);
      face([-1, 0, 0], [-0.5, 0.5, 0], [-0.5, -0.5, 0], [-0.5, -0.5, 1], [-0.5, 0.5, 1]);
      face([0, 1, 0], [0.5, 0.5, 0], [-0.5, 0.5, 0], [-0.5, 0.5, 1], [0.5, 0.5, 1]);
      face([0, -1, 0], [-0.5, -0.5, 0], [0.5, -0.5, 0], [0.5, -0.5, 1], [-0.5, -0.5, 1]);
      face([0, 0, 1], [-0.5, -0.5, 1], [0.5, -0.5, 1], [0.5, 0.5, 1], [-0.5, 0.5, 1]);
      const inst = [];
      for (let dy = -R; dy <= R; dy++) {
        for (let dx = -R; dx <= R; dx++) {
          if (dx * dx + dy * dy > R * R) continue;
          for (let slot = 0; slot < 8; slot++) inst.push(dx, dy, slot);
        }
      }
      this.cityVao = gl.createVertexArray();
      gl.bindVertexArray(this.cityVao);
      gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(box), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 24, 0);
      gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 24, 12);
      gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(inst), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 3, gl.FLOAT, false, 12, 0); gl.vertexAttribDivisor(2, 1);
      gl.bindVertexArray(null);
      this.cityCount = inst.length / 3;
    }

    // compile what this scene needs now, so a bad shader fails here and not mid-frame
    this.passes(scene);
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
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer());
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, g.indices, gl.STATIC_DRAW);
      gl.bindVertexArray(null);
      this.grids.set(key, { vao, count: g.indices.length, snap: snapStep(scene.grid.x) });
    }
    return this.grids.get(key);
  }

  passes(scene) {
    // Programs that read cloud are built once per kind of cloud, and the ground once per kind of ground.
    const lib = G.CLOUD_LIB;
    const kind = scene.cloud ? scene.cloud.kind : 0;
    const defs = { CLOUDS: kind, CLOUD_STEPS: scene.cloud ? scene.cloud.steps : 1 };
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
      composite: this.program(`composite/${kind}/${defs.CLOUD_STEPS}`, () => G.program(G.FULLSCREEN_VS, G.COMPOSITE_FS, defs, lib)),
      present: this.program('present', () => G.program(G.FULLSCREEN_VS, G.PRESENT_FS)),
    };
  }

  /* Draw second frame.t. Through a dissolve, two pictures are drawn and the
     composite dithers from one to the other, and both are live: for a change
     of shot, the same scene from the camera being left; for a change of scene
     (o.leaving: the old scene's own frame, and how far the change has gone),
     the scene being left, on its own stage. Nothing is ever a held frame. */
  render(frame, o = {}) {
    const gl = this.gl;
    const live = !o.still;
    if (live && o.leaving && this.leaving && o.leaving.fade < 1) {
      this.view(this.leaving, o.leaving.frame, o.leaving.frame.camera, { ...o, into: 'prev', fade: 1, caption: false });
      this.view(this.stage, frame, frame.camera, { ...o, into: 'final', fade: o.leaving.fade });
    } else if (live && frame.outgoing) {
      this.view(this.stage, frame, frame.outgoing.camera, { ...o, into: 'prev', fade: 1, caption: false });
      this.view(this.stage, frame, frame.camera, { ...o, into: 'final', fade: frame.fade });
    } else {
      this.view(this.stage, frame, frame.camera, { ...o, into: 'final', fade: 1 });
    }

    /* ---- 3: present ---- */
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    gl.activeTexture(gl.TEXTURE0 + UNIT.final);
    gl.bindTexture(gl.TEXTURE_2D, this.tex.final);
    this.use(this.passes(this.scene).present, { uFinal: UNIT.final, uScale: [this.scale, this.width, this.height, 0] });
    gl.bindVertexArray(this.emptyVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
  }

  /* Passes 1 and 2 for one camera on one stage: the scene, then the composite
     into the picture (`final`) or into the one being dissolved from (`prev`). */
  view(st, frame, cam, o) {
    const gl = this.gl, s = st.scene, W = this.width, H = this.height;
    const t = frame.t;
    const P = this.passes(s);

    const proj = V.perspective(cam.fov, W / H, NEAR, FAR);
    const view = V.lookAt(cam.eye, cam.target);
    const viewProj = V.multiply(proj, view);
    const pixelAngle = cam.fov / H;

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
    const fade = o.fade;
    const capAge = t - this.captionAt;
    const capAlpha = o.caption === false ? 0 : Math.max(0, Math.min(1, capAge / 1.2, (9 - capAge) / 1.5));

    // the buildings' grid is centred a little ahead of the camera, where it is looking
    let city = [0, 0, 0, 0];
    if (s.city) {
      const fwd = V.normalize([cam.target[0] - cam.eye[0], cam.target[1] - cam.eye[1], 0]);
      const reach = s.city.radius * s.city.block * 0.55;
      const wx = frame.origin[0] + cam.eye[0] + fwd[0] * reach, wy = frame.origin[1] + cam.eye[1] + fwd[1] * reach;
      const cx = Math.floor(wx / s.city.block), cy = Math.floor(wy / s.city.block);
      city = [cx, cy, cx * s.city.block - frame.origin[0], cy * s.city.block - frame.origin[1]];
    }

    const U = {
      uCity: city, uCityDraw: [s.city ? s.city.radius : 0, 0, 0, 0],
      uViewProj: viewProj, uInvViewProj: V.invert(viewProj), uCam: cam.eye, uOrigin: frame.origin, uTime: t,
      uSunDir: sunDir, uSunCol: lin(s.sun.colour, s.sun.strength),
      uAmbSky: lin(s.ambient.sky, s.ambient.skyStrength), uAmbGround: lin(s.ambient.ground, s.ambient.groundStrength),
      uFogCol: lin(s.fog.colour), uFogSun: lin(s.fog.sun), uFog: [s.fog.density, s.fog.falloff, s.fog.max, s.fog.sunPower],
      uSkyTop: lin(s.sky.top), uSkyMid: lin(s.sky.mid), uSkyLow: lin(s.sky.low), uSkyShape: [...s.sky.shape, 0, 0],
      uPath: [s.path.amp1, s.path.freq1, s.path.amp2, s.path.freq2],
      // sky
      uSun: s.sun.shape, uSunDisc: lin(s.sun.disc, s.sun.discStrength ?? 1), uSunGlow: lin(s.sun.glow), uStars: [s.sky.stars[0] > 0 ? 0.62 / pixelAngle : 0, s.sky.stars[1], s.sky.stars[2], s.sky.stars[3]],
      uBands: [s.sky.bands.cover, s.sky.bands.scale, s.sky.bands.stretch, s.sky.bands.height],
      uBandLit: lin(s.sky.bands.lit), uBandDark: lin(s.sky.bands.dark),
      // cloud
      uNoise: UNIT.noise,
      uCloudSlab: cloud ? [cloud.floor, cloud.ceiling, cloud.cover, cloud.density] : [0, 1, 0, 0],
      uCloudShape: cloud ? [cloud.size, cloud.detail, ...cloud.drift] : [1, 1, 0, 0],
      uCloudLit: cloud ? lin(cloud.lit) : [1, 1, 1], uCloudDark: cloud ? lin(cloud.dark) : [0.5, 0.5, 0.5],
      uCloudDeep: cloud ? lin(cloud.deep) : [0.3, 0.3, 0.3],
      uCloudMarch: cloud ? [cloud.grow, cloud.reach, cloud.lightStep, 0] : [1, 1, 1, 0],
      uCloudLight: cloud ? [cloud.shade, cloud.opacity, cloud.burn ?? 0, 0] : [1, 1, 0, 0],
      uCloudSh: [cloud ? cloud.shadow : 0, 0, 0, 0],
      // ground
      uGrid: [snap - frame.origin[0], snap, -frame.origin[1], 0],
      uLand: [s.land.seaLevel, t, (frame.seed % 1000) * 0.37, pixelAngle],
      uTc: s.land.colours.map(c => lin(c)),
      uShipPos: [...sh.pos, sh.yaw], uShipDims: [hull.a, hull.b, 0, 0],
      // ship
      uModel: model, uPart: V.identity(), uSunObj: sunObj,
      uHull: [hull.a, hull.b, hull.ring, pixelAngle], uBay: [...hull.bay, 0], uDeck2: hull.deck2,
      uSolar: [hull.solar[0], hull.solar[1], Math.cos(hull.solar[2] * rad), 0],
      uGutter: [hull.gutter[0], hull.gutter[1], Math.sin(hull.gutter[2] * rad), 0],
      uObs: [...hull.obs, 0], uRoom: st.lights, uRoomTint: lin(s.ship.roomTint),
      uGlass: [s.ship.glass, 0, s.ship.bounceStrength, s.ship.windowGlow ?? 1], uBounce: lin(s.ship.bounce),
      uPoint: [1 / pixelAngle, 1.5, 5, s.ship.lamps],
      uBird: [1 / pixelAngle, 3.2, 0, 0], uBirdCol: s.birds ? lin(s.birds.colour) : [0, 0, 0],
      // composite
      uScene: UNIT.scene, uDepth: UNIT.depth, uPrev: UNIT.prev, uCaption: UNIT.caption, uLut: UNIT.lut, uPalette: UNIT.palette,
      uProj: [NEAR, FAR, LUT_SIZE, (o.raw ?? this.raw) ? 1 : 0],
      uLook: [s.look.glow, s.look.outline, s.look.dither, s.look.vignette],
      uFade: [fade, capAlpha, 6 * this.captionScale, 6 * this.captionScale],
      uCaptionSize: [...st.captionSize, st.ink.light, st.ink.dark], uCaptionScale: this.captionScale,
    };

    const bind = (unit, target, tex) => { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(target, tex); };
    bind(UNIT.noise, gl.TEXTURE_3D, this.tex.noise);
    bind(UNIT.lut, gl.TEXTURE_3D, st.lut);
    bind(UNIT.palette, gl.TEXTURE_2D, st.palette);
    bind(UNIT.caption, gl.TEXTURE_2D, st.caption);
    // A texture may not be read while it is being drawn into: when this view is
    // the one being dissolved from, the composite's "previous picture" sampler
    // (which it will not use, its fade being 1) is pointed somewhere harmless.
    bind(UNIT.prev, gl.TEXTURE_2D, o.into === 'prev' ? this.tex.final : this.tex.prev);
    // the scene's own targets must not be bound for reading while it is drawn
    bind(UNIT.scene, gl.TEXTURE_2D, null);
    bind(UNIT.depth, gl.TEXTURE_2D, null);
    bind(UNIT.final, gl.TEXTURE_2D, null);

    /* ---- 1: the scene ---- */
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fboScene);
    gl.viewport(0, 0, W, H);
    gl.disable(gl.BLEND);
    gl.disable(gl.CULL_FACE);
    gl.depthMask(true);
    gl.clearColor(0, 0, 0, 0);
    gl.clearDepth(1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    gl.disable(gl.DEPTH_TEST);
    this.use(P.sky, U);
    gl.bindVertexArray(this.emptyVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    this.use(P.terrain, U);
    gl.bindVertexArray(st.grid.vao);
    gl.drawElements(gl.TRIANGLES, st.grid.count, gl.UNSIGNED_INT, 0);

    if (P.city) {
      this.use(P.city, U);
      gl.bindVertexArray(this.cityVao);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 30, this.cityCount);
    }

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

    // window panes: blended, and they do not write depth
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    this.use(P.ship, U);
    gl.bindVertexArray(this.glass.vao);
    gl.drawArrays(gl.TRIANGLES, 0, this.glass.count);
    gl.depthMask(true);
    gl.disable(gl.BLEND);

    /* ---- 2: composite ---- */
    gl.bindFramebuffer(gl.FRAMEBUFFER, o.into === 'prev' ? this.fboPrev : this.fboFinal);
    gl.disable(gl.DEPTH_TEST);
    bind(UNIT.scene, gl.TEXTURE_2D, this.tex.scene);
    bind(UNIT.depth, gl.TEXTURE_2D, this.tex.depth);
    this.use(P.composite, U);
    gl.bindVertexArray(this.emptyVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    bind(UNIT.scene, gl.TEXTURE_2D, null);
    bind(UNIT.depth, gl.TEXTURE_2D, null);
  }
}
