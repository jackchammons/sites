/*
 * Every shader, as GLSL ES 3.00 source.
 *
 * A frame is drawn in four steps. The scene goes into a framebuffer in
 * ordinary continuous colour, the airship first and the sky last so that
 * nothing is shaded and then covered. Cloud is marched at half that size,
 * between the eye and whatever the scene put there. What glows is gathered
 * small and blurred. COMPOSITE then lays the three together.
 *
 * Sizes on screen are given in dots (CSS pixels), never in drawn pixels:
 * uRes says how many pixels a dot is being given, and that number changes
 * with what the device can afford. It must only ever change how sharp the
 * picture is, not what is in it.
 *
 * The chunks below are joined by program(); nothing here runs outside a
 * browser, but the sources are plain strings so verify.mjs can read them.
 */

export const HEADER = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
precision highp sampler3D;
`;

/* Uniforms and helpers every pass shares: the camera, the sun, the sky's
   colours, haze, and noise. Smooth noise is read from a lattice of random
   values laid out in a texture (noise.js): one fetch brings the four corners
   of a cell, where hashing them would be sixty integer operations. */
export const COMMON = `
uniform mat4 uViewProj;
uniform mat4 uInvViewProj;
uniform vec3 uCam;
uniform vec2 uOrigin;
uniform float uTime;
uniform vec3 uSunDir;
uniform vec3 uSunCol;
uniform vec3 uAmbSky;
uniform vec3 uAmbGround;
uniform vec3 uFogCol;
uniform vec3 uFogSun;
uniform vec4 uFog;
uniform vec3 uSkyTop;
uniform vec3 uSkyMid;
uniform vec3 uSkyLow;
uniform vec4 uSkyShape;
uniform vec4 uPath;        // the flight path's meander: amplitude, frequency, amplitude, frequency
uniform vec4 uRes;         // this picture: width and height in drawn pixels, drawn pixels per dot, radians per dot
uniform sampler2D uValue;  // the lattice smooth noise is interpolated from: a cell's four corners in one texel
uniform sampler2D uRand;   // four unrelated random numbers per cell

const float PI = 3.14159265;
const mat2 ROT = mat2(0.8, -0.6, 0.6, 0.8);

vec3 toLinear(vec3 c) { return pow(max(c, vec3(0.0)), vec3(2.2)); }
vec3 toSrgb(vec3 c) { return pow(clamp(c, 0.0, 1.0), vec3(0.4545)); }
float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

uint mixU(uint h) {
  h ^= h >> 16; h *= 0x7feb352du; h ^= h >> 15; h *= 0x846ca68bu; h ^= h >> 16;
  return h;
}
uint hashU(ivec2 p) {
  uvec2 q = uvec2(p);
  return mixU(q.x * 0x9e3779b1u + mixU(q.y + 0x85ebca77u));
}
float hash2(ivec2 p) { return float(hashU(p) >> 8) * (1.0 / 16777216.0); }
float hash3(ivec3 p) {
  uvec3 q = uvec3(p);
  return float(mixU(q.x * 0x9e3779b1u + mixU(q.y * 0x85ebca77u + mixU(q.z + 0xc2b2ae3du))) >> 8) * (1.0 / 16777216.0);
}
// four random numbers for a cell of a grid that repeats every 256 cells
vec4 rand4(ivec2 p) { return texelFetch(uRand, p & 255, 0); }

// Value noise in [0,1] with its analytic derivative in yz.
vec3 noised(vec2 x) {
  vec2 fl = floor(x);
  vec2 f = x - fl;
  vec4 c = texelFetch(uValue, ivec2(fl) & 255, 0);     // this corner, right, up, across
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  vec2 du = 30.0 * f * f * (f * (f - 2.0) + 1.0);
  float k1 = c.g - c.r, k2 = c.b - c.r, k4 = c.r - c.g - c.b + c.a;
  return vec3(c.r + k1 * u.x + k2 * u.y + k4 * u.x * u.y, du * vec2(k1 + k4 * u.y, k2 + k4 * u.x));
}
float noise(vec2 x) { return noised(x).x; }

/* Octaves of noise, each half the size and half the strength of the last.
   oct need not be whole: the last octave comes in by degrees, so a surface
   gains detail smoothly as the camera nears it. */
float fbm(vec2 p, float oct) {
  float a = 0.0, b = 0.5;
  int n = int(ceil(oct));
  for (int i = 0; i < n; i++) {
    a += b * min(oct - float(i), 1.0) * noise(p);
    b *= 0.5;
    p = ROT * p * 2.0;
  }
  return a;
}

/* The same for the colour of a surface, where what matters is that it does
   not sparkle: oct octaves, the first with cells "cell" metres across, each
   fading to its own average as its cells shrink toward "fine" metres. The
   total keeps its level and loses only its detail with distance. */
float fbmSoft(vec2 p, int oct, float cell, float fine) {
  float a = 0.0, b = 0.5;
  for (int i = 0; i < oct; i++) {
    float k = clamp(cell / fine - 1.0, 0.0, 1.0);
    a += b * (k > 0.0 ? 0.5 + k * (noise(p) - 0.5) : 0.5);
    b *= 0.5; cell *= 0.5;
    p = ROT * p * 2.0;
  }
  return a;
}

// fbm whose octaves are damped where the slope is already steep: ridges stay
// sharp and valley floors stay smooth, which reads as eroded rock.
float fbmE(vec2 p, float oct) {
  float a = 0.0, b = 1.0;
  vec2 d = vec2(0.0);
  int n = int(ceil(oct));
  for (int i = 0; i < n; i++) {
    vec3 v = noised(p);
    float k = min(oct - float(i), 1.0);
    d += v.yz * k;
    a += b * k * v.x / (1.0 + dot(d, d));
    b *= 0.5;
    p = ROT * p * 2.0;
  }
  return a;
}

// Distance to the nearest feature point of a jittered grid, and the way to it.
vec3 worley(vec2 x) {
  vec2 fl = floor(x);
  ivec2 i = ivec2(fl);
  vec2 f = x - fl;
  float best = 9.0;
  vec2 id = vec2(0.0);
  for (int dy = -1; dy <= 1; dy++) {
    for (int dx = -1; dx <= 1; dx++) {
      vec2 r = vec2(float(dx), float(dy)) + rand4(i + ivec2(dx, dy)).xy - f;
      float dd = dot(r, r);
      if (dd < best) { best = dd; id = r; }
    }
  }
  return vec3(sqrt(best), id);
}

// Nearest and second-nearest feature distance, and a number for the nearest cell.
vec3 cells(vec2 x) {
  vec2 fl = floor(x);
  ivec2 i = ivec2(fl);
  vec2 f = x - fl;
  float f1 = 9.0, f2 = 9.0, id = 0.0;
  for (int dy = -1; dy <= 1; dy++) {
    for (int dx = -1; dx <= 1; dx++) {
      vec4 k = rand4(i + ivec2(dx, dy));
      vec2 r = vec2(float(dx), float(dy)) + k.xy - f;
      float dd = dot(r, r);
      if (dd < f1) { f2 = f1; f1 = dd; id = k.z; } else if (dd < f2) { f2 = dd; }
    }
  }
  return vec3(sqrt(f1), sqrt(f2), id);
}

/* A size rounded up to a power of two. Grids of random points (sparkle on
   water, far-off lights, windows too small to see singly) are sized from how
   much ground a dot covers, and that changes smoothly as the camera moves;
   sizing the grid from it directly would reshuffle every point every frame.
   Rounded, a grid holds still until the distance has doubled. */
float grain(float size) { return exp2(ceil(log2(max(size, 1.0)))); }

/* The sky's body colour along a ray: three stops by elevation. */
vec3 skyBase(vec3 rd) {
  float h = clamp(rd.z, 0.0, 1.0);
  vec3 c = mix(uSkyLow, uSkyMid, smoothstep(0.0, uSkyShape.x, h));
  return mix(c, uSkyTop, smoothstep(uSkyShape.x * 0.5, uSkyShape.y, h));
}

/* Haze: exponential in distance and thinning with height, integrated exactly
   along the ray. Returns how much of the haze colour replaces the surface. */
float fogAmount(vec3 rd, float dist) {
  float k = rd.z * uFog.y * dist;
  float f = abs(k) > 1e-3 ? (1.0 - exp(-k)) / k : 1.0 - 0.5 * k;
  float od = uFog.x * exp(-uFog.y * uCam.z) * dist * f;
  // raised to a power: the middle distance stays clear and saturated, and the
  // far distance still goes all the way to haze
  return min(pow(1.0 - exp(-od), 1.45), uFog.z);
}
vec3 fogColour(vec3 rd) {
  float s = pow(max(dot(normalize(vec3(rd.xy, max(rd.z, 0.0) * 0.4)), normalize(vec3(uSunDir.xy, uSunDir.z * 0.4))), 0.0), uFog.w);
  return mix(uFogCol, uFogSun, s);
}
vec3 applyFog(vec3 col, vec3 rd, float dist) {
  return mix(col, fogColour(rd), fogAmount(rd, dist));
}

float pathY(float x) { return uPath.x * sin(x * uPath.y) + uPath.z * sin(x * uPath.w + 1.3); }

/* Time that moves in steps, hz a second, for things that should twinkle and
   not glide: glitter on the sea, a window going dark. */
float tick(float hz) { return floor(uTime * hz) / hz; }
`;

/* What only a fragment shader can use. Every surface ends in shade(): its
   colour for the screen and, in alpha, how strongly it glows. A grain of half
   an 8-bit step goes in with the colour, different for every pixel, so that a
   slow gradient (a night sky, haze) is stored as a fine mix of two levels and
   not as bands. */
export const FRAGMENT = `
float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
vec4 shade(vec3 c, float glow) {
  return vec4(toSrgb(c) + (ign(gl_FragCoord.xy) - 0.5) / 255.0, glow);
}
// the dot a pixel is in, for patterns that are pinned to the screen
ivec2 dotAt() { return ivec2(floor(gl_FragCoord.xy / uRes.z)); }
`;

/* Cloud as a density field, read from a tiling 3D texture. CLOUDS picks the
   kind: 0 none, 1 a layer of scattered cumulus overhead, 2 a whole cloudscape
   (a floor of cloud below and towers standing off the route). The composite
   pass marches it; the ground and the ship ask it for shade. */
export const CLOUD_LIB = `
uniform sampler3D uNoise;
uniform vec4 uCloudSlab;    // floor, ceiling, cover, density
uniform vec4 uCloudShape;   // feature size in metres, detail size, drift x, drift y

/* The volume, read at p (one tile is one unit). The texture is small, and
   read plainly its values run straight from one texel to the next and bend
   sharply at each, which shows on a cloud's outline as flat facets. Easing
   the position between texel centres rounds them off for no more fetches. */
vec4 cloudTex(vec3 p) {
  p = p * CLOUD_SIZE + 0.5;
  vec3 i = floor(p), f = p - i;
  f = f * f * (3.0 - 2.0 * f);
  return texture(uNoise, (i + f - 0.5) / CLOUD_SIZE);
}

/* The small lumps on a cloud's surface, 0..1. A ray is marched in steps of
   "pace" metres, and a lump thinner than a step is hit by some rays and
   stepped over by their neighbours, which shows as streaks. So the lumps are
   read at a size the steps can catch: the volume is tiled larger the longer
   the stride, in whole doublings, each blended into the next. */
float cloudLumps(vec3 w, float pace) {
  float level = log2(max(pace / (uCloudShape.y * 0.045), 1.0));
  float whole = floor(level);
  float size = uCloudShape.y * exp2(whole);
  return mix(cloudTex(w / size).g, cloudTex(w / (size * 2.0) + 0.37).g, level - whole);
}

/* How thick the cloud is at p, 0 where there is none. pace is the stride of
   the ray asking, for the lumps; 0 asks for the smooth shape alone, which is
   what light and shadow are worked out from. */
#if CLOUDS == 1
float cloudDensity(vec3 p, float pace) {
  float hf = (p.z - uCloudSlab.x) / (uCloudSlab.y - uCloudSlab.x);
  if (hf <= 0.0 || hf >= 1.0) return 0.0;
  vec3 w = p + vec3(uOrigin + uCloudShape.zw * uTime, 0.0);
  float base = cloudTex(w / uCloudShape.x).r;
  // a wide, slow field decides where there is cloud at all
  float where = cloudTex(vec3(w.xy / (uCloudShape.x * 5.3), 0.37)).b;
  float profile = smoothstep(0.0, 0.18, hf) * smoothstep(1.0, 0.35, hf);
  float d = base * profile + (where - 0.5) * 0.7 - (1.0 - uCloudSlab.z);
  if (d <= 0.0) return 0.0;
  if (pace > 0.0) d -= cloudLumps(w, pace) * 0.2 * (1.0 - hf * 0.5);
  return clamp(d * 5.0, 0.0, 1.0) * uCloudSlab.w;
}
#endif

#if CLOUDS == 2
float cloudDensity(vec3 p, float pace) {
  if (p.z >= uCloudSlab.y) return 0.0;
  vec3 w = p + vec3(uOrigin + uCloudShape.zw * uTime, 0.0);
  float lobe = cloudTex(w / uCloudShape.x).r;
  vec4 wide = cloudTex(vec3(w.xy / (uCloudShape.x * 6.1), 0.37));
  // the floor: solid cloud below a top that rolls gently
  float top = uCloudSlab.x + 380.0 * wide.g;
  float d = (top + (lobe - 0.45) * 560.0 - p.z) / 170.0;
  // towers: lobes piled up where the wide field is high, kept off the route
  float off = abs(w.y - pathY(w.x));
  float stand = smoothstep(0.42, 0.74, wide.b) * smoothstep(240.0, 1500.0, off);
  float hf = clamp((p.z - top) / (uCloudSlab.y - top), 0.0, 1.0);
  d = max(d, (lobe - 1.0 + stand * (0.5 + 0.62 * uCloudSlab.z) - hf * hf * 0.5) / 0.1);
  if (d <= 0.0) return 0.0;
  if (pace > 0.0) d -= cloudLumps(w, pace) * 0.55;
  return clamp(d, 0.0, 1.0) * uCloudSlab.w;
}
#endif

#if CLOUDS == 0
float cloudDensity(vec3 p, float pace) { return 0.0; }
float cloudShade(vec3 p) { return 0.0; }
#else
// How much cloud stands between a point and the sun, 0..1.
float cloudShade(vec3 p) {
#if CLOUDS == 1
  if (uSunDir.z < 0.06 || p.z > uCloudSlab.x) return 0.0;
  vec3 q = p + uSunDir * ((mix(uCloudSlab.x, uCloudSlab.y, 0.4) - p.z) / uSunDir.z);
  return 1.0 - exp(-cloudDensity(q, 0.0) * 3.0);
#else
  float a = cloudDensity(p + uSunDir * 260.0, 0.0) + cloudDensity(p + uSunDir * 700.0, 0.0);
  return 1.0 - exp(-a * 1.6);
#endif
}
#endif
`;

/* A triangle that covers the screen; vNdc runs -1..1. It lies on the far
   plane, so that the sky, drawn after everything else with the depth test
   on, is shaded only where nothing stands in front of it. */
export const FULLSCREEN_VS = `
out vec2 vNdc;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2)) * 2.0 - 1.0;
  vNdc = p;
  gl_Position = vec4(p, 1.0, 1.0);
}
`;

const RAY = `
vec3 rayDir(vec2 ndc) {
  vec4 a = uInvViewProj * vec4(ndc, -1.0, 1.0);
  vec4 b = uInvViewProj * vec4(ndc, 1.0, 1.0);
  return normalize(b.xyz / b.w - a.xyz / a.w);
}
`;

/* ---- sky ---------------------------------------------------------------- */

export const SKY_FS = `
in vec2 vNdc;
out vec4 frag;
uniform vec4 uSun;          // disc cosine, glow power, glow strength, wide glow strength
uniform vec3 uSunDisc;      // disc colour
uniform vec3 uSunGlow;      // glow colour
uniform vec4 uStars;        // star cells per radian, brightness, twinkle, moon craters on/off
uniform vec4 uBands;        // high cloud: cover, scale, stretch, height
uniform vec3 uBandLit;
uniform vec3 uBandDark;
${RAY}
void main() {
  vec3 rd = rayDir(vNdc);
  vec3 col = skyBase(rd);
  float glow = 0.0;

  // stars: the direction is cut into small cubes a dot or two across, and a
  // few of them hold a star at their centre, round and soft-edged. One whose
  // cube the sky only clips is small and faint, which is most of them.
  if (uStars.x > 0.0 && rd.z > 0.0) {
    vec3 g = rd * uStars.x;
    vec3 fl = floor(g);
    float h = hash3(ivec3(fl));
    if (h > 0.978) {
      float r = length(g - fl - 0.5);
      float mag = fract(h * 71.3);
      float tw = 0.7 + 0.3 * sin(uTime * (1.0 + mag * 3.0) + h * 400.0);
      vec3 tint = mix(vec3(0.75, 0.85, 1.0), vec3(1.0, 0.9, 0.75), fract(h * 13.7));
      col += tint * uStars.y * (0.25 + mag * mag) * mix(1.0, tw, uStars.z) * smoothstep(0.02, 0.3, rd.z) * smoothstep(0.5, 0.16, r);
    }
  }

  // high cloud: streaks on a plane far overhead, lit from the sun's side
  if (uBands.x > 0.0 && rd.z > 0.015) {
    vec2 q = rd.xy / (rd.z + 0.08) * uBands.w + uOrigin * 0.02 + vec2(uTime * 6.0, uTime * 1.5);
    q *= uBands.y;
    q.y *= uBands.z;
    float n = fbm(q, 5.0);
    float n2 = fbm(q * 2.7 + 9.0, 3.0);
    float c = smoothstep(1.0 - uBands.x, 1.0 - uBands.x + 0.22, n + (n2 - 0.5) * 0.3);
    c *= smoothstep(0.015, 0.12, rd.z);
    float sunSide = pow(max(dot(rd, uSunDir), 0.0), 3.0);
    vec3 cc = mix(uBandDark, uBandLit, clamp(n2 * 0.7 + sunSide * 0.9, 0.0, 1.0));
    col = mix(col, cc, c * 0.92);
  }

  // sun or moon
  float d = dot(rd, uSunDir);
  col += uSunGlow * (pow(max(d, 0.0), uSun.y) * uSun.z + pow(max(d, 0.0), 6.0) * uSun.w);
  float disc = smoothstep(uSun.x - 0.00012, uSun.x + 0.00012, d);
  if (disc > 0.0) {
    vec3 dc = uSunDisc;
    if (uStars.w > 0.5) {
      // the moon's maria: a few soft patches in its own coordinates
      vec3 ux = normalize(cross(uSunDir, vec3(0.0, 0.0, 1.0)));
      vec3 uy = cross(ux, uSunDir);
      vec2 m = vec2(dot(rd, ux), dot(rd, uy)) / sqrt(1.0 - uSun.x * uSun.x);
      float mare = smoothstep(0.42, 0.6, noise(m * 2.3 + 3.1)) * 0.28 + smoothstep(0.5, 0.75, noise(m * 5.0 + 9.0)) * 0.12;
      dc *= 1.0 - mare;
      dc *= 0.82 + 0.18 * smoothstep(1.0, 0.3, length(m));
    }
    col = mix(col, dc, disc);
    // the sun blazes; the moon has a face, which a blaze would wash out
    glow = disc * (uStars.w > 0.5 ? 0.22 : 0.75);
  }

  // haze toward the horizon, the same haze the land fades into
  float od = uFog.x * exp(-uFog.y * uCam.z) / (max(rd.z, 0.0) * uFog.y + 1e-5);
  float fa = min(pow(1.0 - exp(-od), 1.45), uFog.z);
  if (rd.z <= 0.0) fa = uFog.z;
  col = mix(col, fogColour(rd), fa * (1.0 - disc * 0.85));
  frag = shade(col, glow);
}
`;

/* ---- the airship -------------------------------------------------------- */

export const SHIP_VS = `
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aNrm;
layout(location = 2) in vec4 aCol;
layout(location = 3) in vec4 aTag;
uniform mat4 uModel;
uniform mat4 uPart;
out vec3 vObj;
out vec3 vObjN;
out vec3 vPos;
out vec3 vNrm;
out vec4 vCol;
flat out int vMat;
flat out int vAux;
void main() {
  vec4 o = uPart * vec4(aPos, 1.0);
  vec4 p = uModel * o;
  vObj = o.xyz;
  vObjN = mat3(uPart) * aNrm;
  vPos = p.xyz;
  vNrm = mat3(uModel) * vObjN;
  vCol = aCol;
  vMat = int(aTag.x + 0.5);
  vAux = int(aTag.y + 0.5);
  gl_Position = uViewProj * p;
}
`;

export const SHIP_FS = `
in vec3 vObj;
in vec3 vObjN;
in vec3 vPos;
in vec3 vNrm;
in vec4 vCol;
flat in int vMat;
flat in int vAux;
out vec4 frag;
uniform vec4 uHull;        // a, b, ring spacing
uniform vec4 uBay;         // aft x, forward x, half width
uniform vec4 uDeck2;       // aft x, end of the straight walls, prow tip, half width
uniform vec4 uSolar;       // x0, x1, cos(angle from the ridge)
uniform vec4 uGutter;      // x0, x1, sin(angle above the widest line)
uniform vec4 uObs;         // wall station, floor z, ceiling z
uniform float uRoom[24];
uniform vec3 uSunObj;      // sun direction in the ship's own axes
uniform vec3 uRoomTint;
uniform vec4 uGlass;       // mirror amount, pass (0 solid, 1 glass), bounce strength, lamp gain
uniform vec3 uBounce;      // light thrown up at the belly by what is below
uniform vec4 uCloudSh;     // cloud shadow: strength

float roomLight(int id) { return uRoom[clamp(id, 0, 23)]; }

// How much the envelope hides the sun from p, 0..1. Both are in the ship's axes.
float hullShadow(vec3 p) {
  vec3 s = vec3(1.0 / uHull.x, 1.0 / uHull.y, 1.0 / uHull.y);
  vec3 q = p * s, d = uSunObj * s;
  float A = dot(d, d), B = dot(q, d), C = dot(q, q) - 1.0;
  if (C <= 0.0) return 1.0;                  // inside the envelope's volume
  if (B >= 0.0) return 0.0;                  // the envelope is behind this ray
  return 1.0 - smoothstep(-0.02, 0.02, C - B * B / A);
}

// Coverage of a line of half-width w by a dot px metres across, d from its centre.
float line(float d, float w, float px) { return clamp((w + 0.5 * px - d) / max(px, 1e-4), 0.0, 1.0) * min(1.0, 2.0 * w / max(px, 1e-4) + 0.35); }

void main() {
  vec3 view = normalize(uCam - vPos);
  float dist = length(uCam - vPos);
  vec3 n = normalize(vNrm);
  vec3 alb = toLinear(vCol.rgb);
  float gloss = 0.08;
  float glowOut = 0.0;
  vec3 emit = vec3(0.0);
  float px = dist * uRes.w;             // metres per dot here
  float shadow = 1.0;
  float occ = 1.0;

  if (vMat == 1) {
    // ---- the envelope ----
    vec3 o = vObj;
    // openings: the moon pool and bay, and the footprint of the upper deck
    if (o.z < 0.0) {
      if (o.x > uBay.x && o.x < uBay.y && abs(o.y) < uBay.z) discard;
      if (o.x >= uBay.y && o.x < uDeck2.z) {
        float u = clamp((o.x - uDeck2.y) / (uDeck2.z - uDeck2.y), 0.0, 1.0);
        float hw = uDeck2.w * sqrt(max(0.0, 1.0 - u * u)) - 0.03;
        if (abs(o.y) < hw) discard;
      }
    }
    float rr = max(length(o.yz), 0.001);
    float up = o.z / rr;                               // 1 at the ridge, -1 at the keel
    float ang = atan(o.y, -o.z);
    // seams: a ring every ten metres, a longitudinal every thirty degrees
    float dRing = abs(fract(o.x / uHull.z) - 0.5) * uHull.z;
    float dLong = abs(fract(ang / (PI / 6.0) + 0.5) - 0.5) * (PI / 6.0) * rr;
    float seam = max(line(dRing, 0.16, px) * 0.16, line(dLong, 0.12, px) * 0.1);
    float dMid = abs(fract(o.x / uHull.z + 0.5) - 0.5) * uHull.z;
    seam = max(seam, line(dMid, 0.07, px) * 0.06);
    // solar skin on the crown
    float sx = min(o.x - uSolar.x, uSolar.y - o.x);
    float arcEdge = (up - uSolar.z) * rr;              // metres inside the field, measured down the flank
    if (sx > 0.0 && arcEdge > 0.0) {
      vec2 cell = vec2(o.x / 2.5, ang * rr / 2.2);
      float tone = hash2(ivec2(floor(cell)));
      vec3 solar = mix(vec3(0.012, 0.03, 0.075), vec3(0.03, 0.065, 0.14), tone);
      vec2 cf = abs(fract(cell) - 0.5);
      float grid = max(line((0.5 - cf.x) * 2.5, 0.05, px), line((0.5 - cf.y) * 2.2, 0.05, px));
      solar = mix(solar, vec3(0.16, 0.2, 0.28), grid * 0.5);
      float border = max(line(sx, 0.25, px), line(arcEdge, 0.25, px));
      alb = mix(solar, vec3(0.3, 0.32, 0.36), border * 0.8);
      gloss = 0.75;
      seam *= 0.4;
    }
    alb *= 1.0 - seam;
    // slot gutter on each flank
    float gx = min(o.x - uGutter.x, uGutter.y - o.x);
    if (gx > 0.0) {
      float dg = abs(asin(clamp(up, -1.0, 1.0)) - asin(uGutter.z)) * rr;
      alb *= 1.0 - line(dg, 0.14, px) * 0.42;
    }
    // observation rooms at the bow and stern: a glazed band in the skin itself
    if (abs(o.x) > uObs.x && o.z > uObs.y && o.z < uObs.z) {
      float lit = roomLight(o.x > 0.0 ? 21 : 22);
      float bars = line(abs(fract(ang * rr / 1.6) - 0.5) * 1.6, 0.11, px);
      float edge = max(line(min(o.z - uObs.y, uObs.z - o.z), 0.12, px), line(abs(o.x) - uObs.x, 0.12, px));
      float frame = max(bars, edge);
      alb = mix(vec3(0.012, 0.045, 0.06), vec3(0.02, 0.03, 0.04), frame);
      emit = (skyBase(reflect(-view, n)) * (0.1 + 0.16 * uGlass.x) + uRoomTint * lit * 0.4) * (1.0 - frame);
      glowOut = lit * 0.3;
      gloss = 0.3;
    }
    // a faint keel line where the corridor runs
    alb *= 1.0 - line(abs(o.y), 0.35, px) * 0.07 * step(o.z, 0.0);
  } else if (vMat == 2 || vMat == 5) {
    // ---- inside the gondola: lit by its own lamps ----
    float lit = roomLight(vAux);
    if (dot(n, view) < 0.0) n = -n;
    vec3 day = alb * (uAmbSky * 0.22 + uAmbGround * 0.1);
    vec3 lamp = alb * uRoomTint * 1.25 * lit;
    if (vMat == 5) { lamp = alb * (0.35 + 0.65 * lit); day = alb * 0.25; }
    vec3 c = day + lamp;
    float g = clamp(luma(lamp) * 0.9, 0.0, 1.0) * uGlass.w;
    c = applyFog(c, -view, dist);
    frag = shade(c, g);
    return;
  } else {
    // ---- painted parts: gondola shell, fins, pods ----
    if (dot(n, view) < 0.0) n = -n;
    shadow = 1.0 - hullShadow(vObj);
    // tucked up against the envelope it is darker
    vec3 q = vObj / vec3(uHull.x, uHull.y, uHull.y);
    occ = mix(0.62, 1.0, smoothstep(0.0, 0.16, length(q) - 1.0));
  }

  if (vMat == 3) {
    // ---- window panes, blended over what is behind them ----
    float fres = 0.05 + 0.95 * pow(1.0 - max(dot(n, view), 0.0), 4.0);
    vec3 refl = skyBase(reflect(-view, n));
    vec3 tint = alb * (uAmbSky + uSunCol * 0.4);
    vec3 c = mix(tint, refl, clamp(fres + 0.25, 0.0, 1.0));
    float lit = roomLight(vAux);
    float mirror = uGlass.x * (1.0 - 0.75 * lit);
    float a = clamp(mix(0.06, 0.86, mirror) + fres * 0.45, 0.0, 0.96);
    vec3 h = normalize(uSunDir + view);
    float spec = pow(max(dot(n, h), 0.0), 220.0) * (1.0 - hullShadow(vObj));
    c += uSunCol * spec * 3.0;
    a = max(a, clamp(spec * 2.0, 0.0, 1.0));
    c = applyFog(c, -view, dist);
    frag = vec4(toSrgb(c), a);
    return;
  }

  shadow *= 1.0 - cloudShade(vPos) * uCloudSh.x * 0.45;
  float ndl = dot(n, uSunDir);
  // The envelope is one big round form, so its light wraps right round it and
  // falls off slowly: that is what gives it bands of tone and not two flat halves.
  float wrap = ndl * 0.5 + 0.5;
  float dif = (vMat == 1 ? mix(wrap * wrap, smoothstep(-0.1, 0.6, ndl), 0.35) : smoothstep(-0.1, 0.4, ndl)) * shadow;
  float upness = n.z * 0.5 + 0.5;
  vec3 amb = mix(uAmbGround, uAmbSky, smoothstep(0.1, 0.9, upness)) * occ;
  // what is below throws its own colour back up at the belly
  amb += uBounce * uGlass.z * pow(1.0 - upness, 2.0) * occ;
  vec3 c = alb * (uSunCol * dif + amb);
  vec3 h = normalize(uSunDir + view);
  c += uSunCol * pow(max(dot(n, h), 0.0), mix(7.0, 70.0, gloss)) * (0.05 + gloss * 0.8) * shadow * step(0.0, ndl);
  float rim = pow(1.0 - max(dot(n, view), 0.0), 3.0);
  c += (alb * 0.7 + 0.03) * uAmbSky * rim * 0.9 * occ;
  // seen against the sun, the edges that face it catch fire
  float back = max(dot(-view, uSunDir), 0.0);
  c += alb * uSunCol * rim * back * back * smoothstep(-0.25, 0.3, ndl) * 1.6 * shadow;
  c += emit;
  c = applyFog(c, -view, dist);
  frag = shade(c, glowOut);
}
`;

/* ---- lamps: discs that never shrink below a dot and a half -------------- */

export const POINT_VS = `
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec4 aCol;      // rgb, size in metres
layout(location = 2) in vec2 aBlink;    // pattern, phase
uniform mat4 uModel;
uniform vec4 uPoint;                    // least size and greatest size in dots, gain
out vec4 vCol;
float pattern(float kind, float t) {
  if (kind < 0.5) return 1.0;
  if (kind < 1.5) { float f = fract(t / 1.6); return (f < 0.045 || (f > 0.11 && f < 0.155)) ? 1.0 : 0.0; }
  if (kind < 2.5) return smoothstep(0.55, 1.0, sin(t * 2.4) * 0.5 + 0.5);
  return fract(t / 2.1 + 0.37) < 0.05 ? 1.0 : 0.0;
}
void main() {
  vec4 p = uModel * vec4(aPos, 1.0);
  gl_Position = uViewProj * p;
  float dist = length(p.xyz - uCam);
  float on = pattern(aBlink.x, uTime + aBlink.y);
  gl_PointSize = clamp(aCol.a / (dist * uRes.w), uPoint.x, uPoint.y) * uRes.z;
  // a lamp that is off is thrown away by moving it behind the camera
  if (on < 0.01 || uPoint.z <= 0.0) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
  vCol = vec4(aCol.rgb * mix(0.4, 1.0, on) * uPoint.z, on);
}
`;

export const POINT_FS = `
in vec4 vCol;
out vec4 frag;
void main() {
  vec2 q = gl_PointCoord * 2.0 - 1.0;
  if (dot(q, q) > 1.0) discard;
  frag = vec4(toSrgb(vCol.rgb), vCol.a);
}
`;

/* ---- land, sea and cloud tops: one displaced grid ------------------------ */

/* The ground is a tensor grid: columns spaced finely near the camera and
   coarsely far off, rows fixed in the world. The vertex shader lifts each
   vertex to the scene's height function. The fragment shader works the same
   function out once more, with as many more octaves as a pixel there can
   show, and takes the slope from how that height differs between the pixel
   and its neighbours. TERRAIN selects the scene: 0 valley, 1 coast at
   sunset, 2 cloud tops, 3 the city's flat ground. BASE_CELL is the size in
   metres of the largest octave, which is what the count of octaves a pixel
   can show is worked out from. */
export const TERRAIN_LIB = `
uniform vec4 uLand;        // sea level, unused, seed

#if TERRAIN == 0
#define BASE_CELL 3100.0
float riverY(float x) { return pathY(x) + 230.0 * sin(x * 0.0019 + 0.7) + 95.0 * sin(x * 0.0043 + 2.1); }
// x: metres from the water's edge (negative in the water), y: lake amount
vec2 river(vec2 w) {
  float rd = abs(w.y - riverY(w.x));
  float lake = smoothstep(0.6, 0.95, sin(w.x * 0.00029 + 4.2 + uLand.z) * 0.5 + 0.5);
  float halfW = 24.0 + 10.0 * sin(w.x * 0.0031) + lake * 340.0;
  return vec2(rd - halfW, lake);
}
float terrainH(vec2 w, float oct) {
  float d = abs(w.y - pathY(w.x));
  float rise = smoothstep(480.0, 7600.0, d);
  // the valley floor is flat: there the mountains' noise is multiplied by nothing, and is not worked out
  float e = rise > 0.0 ? fbmE(w / BASE_CELL + uLand.z, oct) : 0.0;
  float h = pow(rise, 1.22) * (520.0 + 2700.0 * e) + 1000.0 * smoothstep(7000.0, 17000.0, d) * e;
  h += (fbm(w / 620.0 + 40.0, 5.0) - 0.5) * 110.0 * (0.22 + 2.2 * rise);
  h += 14.0;
  vec2 rv = river(w);
  float bank = smoothstep(0.0, 75.0 + rv.y * 60.0, rv.x);
  return mix(-5.0, h, bank);
}
#endif

#if TERRAIN == 1
#define BASE_CELL 4200.0
// A drowned coast: open sea to port and under the route, scattered with
// islands; the mainland rises a mile off to starboard.
float terrainH(vec2 w, float oct) {
  vec2 p = w - vec2(0.0, pathY(w.x));
  float e = fbmE(w / BASE_CELL + uLand.z, oct);
  float ridge = fbm(w / 9000.0 + 3.0 + uLand.z, 3.0);
  float bias = clamp((-p.y - 1500.0) / 4200.0, -0.62, 1.0);
  float h = (e - 0.55 + (ridge - 0.5) * 0.9) * 1700.0 + bias * 1500.0;
  // the small relief only matters above the waterline
  if (h > -40.0) h += (fbm(w / 480.0 + 11.0, 5.0) - 0.5) * 110.0 * smoothstep(-40.0, 200.0, h);
  // nothing tall near the route
  return min(h, mix(150.0, 5000.0, smoothstep(500.0, 3400.0, abs(p.y))));
}
#endif

#if TERRAIN == 3
#define BASE_CELL 3100.0
float terrainH(vec2 w, float oct) { return 0.0; }
#endif

#if TERRAIN == 2
#define BASE_CELL 19200.0
// The far cloud floor: a calm sheet that the marched cloud stands on, there so
// the horizon is never empty. |2n - 1| is rounded on top and creased between.
float billow(vec2 p, float oct) {
  float a = 0.0, b = 0.5;
  int n = int(ceil(oct));
  for (int i = 0; i < n; i++) { a += b * min(oct - float(i), 1.0) * abs(2.0 * noise(p) - 1.0); b *= 0.5; p = ROT * p * 2.03; }
  return a;
}
float gPuff;
float terrainH(vec2 w, float oct) {
  float swell = fbm(w / 9000.0 + uLand.z, 3.0);
  float puff = billow(w / 2400.0 + 5.0, clamp(oct - 3.0, 1.0, 5.0));
  gPuff = puff;
  return uLand.x + (swell - 0.5) * 420.0 + puff * 260.0;
}
#endif
`;

/* The city: an endless grid of blocks, each decided by hashing its cell, so
   the ground shader and the building shader agree on what stands where
   without any data passing between them. */
export const CITY_LIB = `
// BLOCK, STREET and LOT (metres) are #defines written from the scene, so the
// renderer, which places the buildings' grid, cannot disagree with them.

// metres from the river's edge, negative on the water
float riverEdge(vec2 w) {
  float c = pathY(w.x) + 820.0 + 240.0 * sin(w.x * 0.0006 + 1.0);
  return abs(w.y - c) - (165.0 + 45.0 * sin(w.x * 0.0011));
}
// 0 at the quiet edge of town, 1 in the middle of downtown
float district(ivec2 cell) {
  vec2 c = vec2(cell);
  float near = exp(-pow((c.y * BLOCK - pathY(c.x * BLOCK) - 250.0) / 1500.0, 2.0));
  return clamp(fbm(c / 9.0 + uLand.z, 3.0) * 0.95 + near * 0.3 + (fbm(c / 2.5 + 7.0, 2.0) - 0.45) * 0.25, 0.0, 1.0);
}
bool isPark(ivec2 cell, float dz) { return hash2(cell + ivec2(91, 17)) < 0.09 && dz < 0.62; }
// height of the building on one of a block's four lots; 0 where there is none
float lotHeight(ivec2 cell, int lot, float dz) {
  if (isPark(cell, dz)) return 0.0;
  float r = hash2(cell * 4 + ivec2(lot, lot * 3 + 5));
  if (r < 0.08 + 0.12 * (1.0 - dz)) return 0.0;
  float top = mix(12.0, 62.0, smoothstep(0.22, 0.55, dz)) + 235.0 * smoothstep(0.6, 0.86, dz);
  float h = top * (0.28 + 0.72 * r * r);
  vec2 centre = (vec2(cell) + vec2(0.0)) * BLOCK + STREET + (vec2(float(lot & 1), float(lot >> 1)) + 0.5) * LOT;
  if (riverEdge(centre) < 34.0) return 0.0;
  return h;
}
`;

export const TERRAIN_VS = `
layout(location = 0) in vec2 aGrid;
uniform vec4 uGrid;        // local x of the snapped origin, its world x, local y of the rows' origin, their world y
out vec3 vPos;
out vec3 vLie;             // the broad lie of the land here: its normal with the small relief left out
void main() {
  vec2 w = vec2(uGrid.y + aGrid.x, uGrid.w + aGrid.y);
  float h = terrainH(w, float(VS_OCT));
#if TERRAIN == 2
  vec3 p = vec3(uGrid.x + aGrid.x, uGrid.z + aGrid.y, h);
#else
  vec3 p = vec3(uGrid.x + aGrid.x, uGrid.z + aGrid.y, max(h, uLand.x));
#endif
  vPos = p;
  vLie = vec3(0.0, 0.0, 1.0);
#if TERRAIN == 0 || TERRAIN == 1
  // Where forest stops and rock begins is decided by slope. Taken from the
  // full relief, the slope changes at every pixel and the boundary is speckle;
  // taken here, over a span that widens with distance, it is a clean line.
  float span = clamp(length(p - uCam) * 0.02, 24.0, 400.0);
  float broad = clamp(log2(BASE_CELL / span) - 1.0, 2.0, float(VS_OCT));
  float h0 = terrainH(w, broad);
  vLie = vec3(h0 - terrainH(w + vec2(span, 0.0), broad), h0 - terrainH(w + vec2(0.0, span), broad), span);
#endif
  gl_Position = uViewProj * vec4(p, 1.0);
}
`;

export const TERRAIN_FS = `
in vec3 vPos;
in vec3 vLie;
out vec4 frag;
uniform vec3 uTc[12];      // the land's colours, linear
uniform vec4 uShipPos;     // the envelope's centre (local) and its heading
uniform vec4 uShipDims;    // a, b
uniform vec4 uCloudSh;     // cloud shadow: strength

// The envelope's shadow on the ground: a ray to the sun against an ellipsoid.
float shipShadow(vec3 p) {
  vec3 q = p - uShipPos.xyz;
  float c = cos(uShipPos.w), s = sin(uShipPos.w);
  vec3 L = uSunDir;
  q = vec3(c * q.x + s * q.y, -s * q.x + c * q.y, q.z);
  L = vec3(c * L.x + s * L.y, -s * L.x + c * L.y, L.z);
  vec3 k = vec3(1.0 / uShipDims.x, 1.0 / uShipDims.y, 1.0 / uShipDims.y);
  q *= k; L *= k;
  float A = dot(L, L), B = dot(q, L), C = dot(q, q) - 1.0;
  if (B >= 0.0) return 0.0;
  return 1.0 - smoothstep(-0.25, 0.1, C - B * B / A);
}

void main() {
  vec3 toCam = uCam - vPos;
  float dist = length(toCam);
  vec3 view = toCam / dist;
  // The world position is put together here, from the small local one, and not
  // interpolated: a number as large as a world coordinate loses its fine
  // digits on the way across a triangle half a kilometre wide.
  vec2 w = vPos.xy + uOrigin;
  float foot = dist * uRes.w;                          // metres per dot here
  float footPx = foot / uRes.z;                        // and per drawn pixel
#if TERRAIN == 3
  {
    ivec2 cell = ivec2(floor(w / BLOCK));
    vec2 f = w - vec2(cell) * BLOCK;                   // metres into this block; streets run along its low edges
    float dz = district(cell);
    float rv = riverEdge(w);
    bool alongX = f.y < STREET, alongY = f.x < STREET;
    bool bridge = alongY && (cell.x & 3) == 0;
    vec3 base = vec3(0.012, 0.014, 0.03);
    vec3 emit = vec3(0.0);
    float glow = 0.0;
    vec3 lampCol = mix(vec3(1.0, 0.52, 0.16), vec3(1.0, 0.78, 0.5), smoothstep(0.55, 0.8, dz));
    float far = smoothstep(4.0, 9.0, foot);            // 1 where streets can no longer be told apart

    if (rv < 0.0 && !bridge) {
      // ---- the river: black water, the banks' light lying on it near the edges ----
      // Everything here is fixed to the water, not to the view, so it holds
      // still as the camera moves: a wash of lamp colour by each bank, a few
      // points that come and go, and the moon's road.
      float nearBank = exp(rv / 55.0);
      float seen = smoothstep(4.0, 2.0, foot / max(view.z, 0.12));    // points this small can only be told apart close to
      float on = 0.0;
      vec3 pts = vec3(1.0, 1.0, 0.0);
      if (seen > 0.0) {
        pts = cells(w / vec2(9.0, 26.0) + 5.0);
        on = smoothstep(0.2, 0.1, pts.x) * step(0.72, fract(pts.z * 7.0 + tick(2.0) * (0.3 + pts.z))) * seen;
      }
      base = vec3(0.004, 0.008, 0.026);
      emit = lampCol * (nearBank * 0.1 + on * (0.25 + nearBank) * 0.5);
      emit += mix(lampCol, vec3(0.5, 0.85, 1.0), 0.5) * on * step(0.9, pts.z) * 0.3;
      // the moon's road: glints where the ripples tip the right way
      vec3 rip = noised(w / vec2(7.0, 19.0) + vec2(uTime * 0.35, 0.0));
      vec3 hv = normalize(uSunDir + view);
      float sp = pow(max(dot(normalize(vec3((rip.yz - 0.0) * 0.16, 1.0)), hv), 0.0), 260.0);
      emit += uSunCol * sp * 2.2 * (1.0 - 0.6 * far);
      // a lit promenade along each bank
      float prom = smoothstep(-9.0, -3.0, rv) * step(0.5, fract(w.x / 22.0));
      emit += lampCol * prom * 0.5 * (1.0 - far);
      glow = clamp(luma(emit) * 0.6, 0.0, 1.0);
    } else if (alongX || alongY) {
      // ---- streets: lamps down both kerbs, traffic in four lanes ----
      float s = alongX ? w.x : w.y;                    // along the street
      float c = alongX ? f.y : f.x;                    // across it
      base = vec3(0.022, 0.024, 0.04);
      float ls = abs(fract(s / 30.0) - 0.5) * 30.0;
      float lc = min(abs(c - 1.5), abs(c - (STREET - 1.5)));
      float pool = exp(-(ls * ls + lc * lc) / 22.0);
      float poolFar = exp(-(ls * ls) / 40.0) * step(lc, max(2.5, foot));
      emit = lampCol * mix(mix(pool * 0.6, poolFar * 0.7, smoothstep(1.2, 3.0, foot)) + 0.01, 0.06, smoothstep(3.5, 7.0, foot));
      if (foot < 3.4 && !(alongX && alongY)) {
        int lane = int(clamp(floor((c - 1.5) / 4.25), 0.0, 3.0));
        float dirn = lane < 2 ? 1.0 : -1.0;
        float speed = 11.0 + 3.0 * float(lane & 1);
        float q = (s - dirn * speed * uTime) / 28.0;
        ivec2 id = ivec2(int(floor(q)), (alongX ? cell.y : cell.x) * 8 + lane + (alongX ? 0 : 4));
        float busy = 0.25 + 0.45 * dz;
        float fq = fract(q);
        float laneC = 1.5 + 4.25 * (float(lane) + 0.5);
        if (hash2(id) < busy && fq > 0.4 && fq < 0.4 + max(4.6, foot * 1.2) / 28.0 && abs(c - laneC) < max(1.1, foot * 0.6)) {
          vec2 travel = alongX ? vec2(dirn, 0.0) : vec2(0.0, dirn);
          bool coming = dot(travel, view.xy) > 0.0;
          emit = coming ? vec3(1.0, 0.95, 0.8) * 1.3 : vec3(1.0, 0.1, 0.06) * 1.1;
        }
      }
      glow = clamp(luma(emit) * 0.7, 0.0, 1.0);
    } else if (isPark(cell, dz)) {
      // ---- a park: dark, with a few path lamps ----
      base = vec3(0.006, 0.02, 0.014);
      vec3 tr = worley(w / 9.0);
      base *= 0.7 + 0.5 * smoothstep(0.6, 0.1, tr.x);
      vec3 pl = worley(w / 27.0 + 3.0);
      emit = vec3(0.8, 1.0, 0.75) * step(pl.x, 0.07 + foot * 0.012) * 0.8 * (1.0 - far);
      glow = luma(emit) * 0.6;
    } else {
      // ---- inside a block: pavement, yards, the odd lit forecourt ----
      vec2 g = f - STREET;
      float walk = step(min(min(g.x, g.y), min(BLOCK - STREET - g.x, BLOCK - STREET - g.y)), 3.0);
      base = mix(vec3(0.014, 0.016, 0.03), vec3(0.03, 0.03, 0.045), walk);
      vec3 yd = worley(w / 16.0 + 11.0);
      emit = lampCol * step(yd.x, 0.05 + foot * 0.008) * step(0.55, hash2(cell + ivec2(3, 9))) * 0.6 * (1.0 - far);
      glow = luma(emit) * 0.5;
    }

    // far off, the grid dissolves into a carpet of points
    if (far > 0.0 && (rv >= 0.0 || bridge)) {
      float cs = 26.0 * grain(foot * 1.5 / 26.0);
      vec2 pg = w / cs;
      ivec2 pc = ivec2(floor(pg));
      float r = hash2(pc);
      float tw = 0.7 + 0.3 * sin(uTime * (0.6 + r * 2.0) + r * 60.0);
      // each light is a soft disc in the middle of its cell, not the whole cell
      float on = step(1.0 - (0.012 + 0.2 * dz * dz), r) * smoothstep(0.5, 0.2, length(pg - vec2(pc) - 0.5));
      vec3 pcCol = mix(lampCol, mix(vec3(1.0, 0.95, 0.85), vec3(0.6, 0.85, 1.0), step(0.992, r)), step(0.97, r));
      vec3 carpet = pcCol * on * tw * (0.6 + 0.8 * dz) + lampCol * 0.02 * (0.3 + dz);
      emit = mix(emit, carpet, far);
      glow = mix(glow, on * 0.5, far);
    }

    vec3 c = base * (uAmbSky * 4.0 + uSunCol * 1.5) + emit;
    c = mix(c, fogColour(-view), fogAmount(-view, dist));
    // Street light is many small points that shift a little every frame; given
    // a full halo each, the halos flicker far more than the points do.
    frag = shade(c, glow * 0.3);
  }
#else
  // Octaves down to cells three pixels across: finer than that is not detail, only noise.
  float oct = clamp(log2(BASE_CELL / (footPx * 3.0)), 5.0, 12.0);
#if TERRAIN == 1
  // most of this scene is open sea: a few octaves say so, and the rest are for land
  float h0 = terrainH(w, min(oct, 6.0));
  if (h0 > -130.0 && oct > 6.0) h0 = terrainH(w, oct);
#else
  float h0 = terrainH(w, oct);
#endif
  // the slope, from this pixel's height and its neighbours'
  vec3 across = dFdx(vec3(vPos.xy, h0)), up = dFdy(vec3(vPos.xy, h0));
  vec3 n = cross(across, up);
  float nl = dot(n, n);
  n = nl > 0.0 ? n * inversesqrt(nl) : vec3(0.0, 0.0, 1.0);
  if (n.z < 0.0) n = -n;
  vec3 lie = normalize(vLie);
  float slope = 1.0 - lie.z;                           // of the land broadly: what grows where goes by this
  float steep = 1.0 - n.z;                             // of this very spot
  // a dot covers more ground than its width where the ground is seen edge-on
  float footLong = foot / max(dot(lie, view), 0.12);
  float glow = 0.0;
  vec3 alb;
  float gloss = 0.0;
  float sunShadow = (1.0 - shipShadow(vPos)) * (1.0 - cloudShade(vPos) * uCloudSh.x);
  float fine = footPx * 2.0;                           // texture finer than this is left out
  float climb = fwidth(h0);                            // metres of height from one pixel to the next

#if TERRAIN == 0
  float n1 = fbmSoft(w / 170.0, 3, 170.0, fine);
  float n2 = fbmSoft(w / 37.0 + 5.0, 2, 37.0, fine);
  // the river first: where it is water, nothing below matters
  vec2 rv = river(w);
  if (h0 < uLand.x + 0.4) {
    float depth = clamp((uLand.x - h0) / 5.0, 0.0, 1.0);
    vec2 flow = vec2(uTime * 2.4, 0.0);
    n = vec3(0.0, 0.0, 1.0);
    vec3 refl = skyBase(reflect(-view, n));
    float fres = 0.06 + 0.94 * pow(1.0 - max(dot(n, view), 0.0), 4.0);
    alb = mix(mix(uTc[9], uTc[10], smoothstep(0.1, 0.9, depth)), refl, clamp(fres * 1.2 + 0.08, 0.0, 0.85));
    vec3 c = alb * (uSunCol * 0.5 * sunShadow + uAmbSky * 1.3);
    // dashes of light drifting downstream, a line of foam at the edge
    float dash = smoothstep(0.87, 0.93, noise((w - flow) * vec2(0.03, 0.2)) * 0.78 + noise((w - flow * 1.6) * vec2(0.07, 0.45)) * 0.3);
    c = mix(c, uTc[9] * (uSunCol + uAmbSky) * 1.5, dash * 0.55 * smoothstep(0.1, 0.5, depth) * smoothstep(5.0, 2.0, foot / max(view.z, 0.12)));
    float foam = 1.0 - smoothstep(0.0, 0.06, depth - 0.16 - 0.1 * noise(w / 6.0 + flow.x * 0.2));
    c = mix(c, vec3(1.0) * (uSunCol * (0.4 + 0.6 * sunShadow) + uAmbSky), foam * 0.85);
    vec3 hv = normalize(uSunDir + view);
    float sp = pow(max(dot(normalize(n + vec3(noise((w - flow) / 5.0) - 0.5, noise((w + flow) / 4.0) - 0.5, 0.0) * 0.08), hv), 0.0), 500.0) * sunShadow;
    c += uSunCol * sp * 4.0;
    glow = clamp(sp * 2.0, 0.0, 1.0);
    c = mix(c, fogColour(-view), fogAmount(-view, dist));
    frag = shade(c, glow);
    return;
  }
  // meadow, alpine turf above the trees
  alb = mix(uTc[0], uTc[1], smoothstep(0.46, 0.54, n1 + (n2 - 0.5) * 0.4));
  // on the valley floor the meadows are parcelled out, with hedges between
  float floorness = 1.0 - smoothstep(600.0, 1500.0, abs(w.y - pathY(w.x)) + (n1 - 0.5) * 500.0);
  float hedge = 0.0;
  if (floorness > 0.0) {
    vec2 fw = w + (vec2(noise(w / 170.0 + 3.0), noise(w / 170.0 + 31.0)) - 0.5) * 150.0;
    vec3 fld = cells(fw / 115.0 + 7.0);
    vec3 crop = fld.z < 0.2 ? uTc[11] : fld.z < 0.55 ? uTc[0] : uTc[1];
    alb = mix(alb, crop, floorness * smoothstep(0.28, 0.32, fld.z + n1 * 0.3));
    hedge = floorness * (1.0 - smoothstep(0.02, 0.04 + footLong * 0.006, fld.y - fld.x))
      * smoothstep(0.45, 0.49, noise(w / 75.0 + 13.0)) * smoothstep(10.0, 6.0, footLong);
  }
  float alpine = smoothstep(1350.0, 1750.0, h0 + (n1 - 0.5) * 420.0);
  alb = mix(alb, uTc[2], alpine);
  // forest: on the slopes below the tree line, and in stands on the floor
  float stand = smoothstep(0.5, 0.6, fbm(w / 520.0 + 23.0, 3.0) + slope * 1.8 - floorness * 0.06);
  float forest = max(stand, hedge) * (1.0 - alpine) * smoothstep(0.62, 0.45, slope);
  if (forest > 0.01) {
    /* A canopy is lumps with a sunny side. Far off the lumps are whole
       stands, nearer they are clumps of trees: the size doubles as often as
       it must to stay a few dots across, each size blended into the next,
       so the wood never turns to speckle and never goes flat. */
    float level = log2(max(footLong * 5.0 / 13.0, 1.0));
    float whole = floor(level);
    float size = 13.0 * exp2(whole);
    vec3 a = noised(w / size), b = noised(w / (size * 2.0) + 3.7);
    vec3 lump = mix(a, b, level - whole);
    float tone = clamp(0.5 - dot(lump.yz, normalize(uSunDir.xy)) * 0.45 + (lump.x - 0.5) * 0.7, 0.0, 1.0);
    float near = smoothstep(2.6, 1.3, footLong);
    if (near > 0.0) {
      // close to: each crown is its own round lump
      vec3 tr = worley(w / 13.0);
      float crown = 1.0 - smoothstep(0.0, 0.62, tr.x);
      float sunny = clamp(0.5 + dot(normalize(tr.yz + 1e-4), -normalize(uSunDir.xy)) * 0.5 * crown, 0.0, 1.0);
      tone = mix(tone, smoothstep(0.5, 0.62, sunny * (0.35 + crown * 0.65)), near);
    }
    alb = mix(alb, mix(uTc[4], uTc[3], smoothstep(0.3, 0.7, tone)), smoothstep(0.4, 0.6, forest));
  }
  // rock where it is steep, strata picked out while they are wide enough to see
  float rock = smoothstep(0.34, 0.5, mix(slope, steep, 0.4) + (n2 - 0.5) * 0.18);
  float strata = smoothstep(0.35, 0.65, noise(vec2(h0 / 26.0 + n1 * 3.0, (w.x + w.y) / 900.0)));
  strata = mix(0.5, strata, clamp(1.6 - climb / 26.0 * 1.6, 0.0, 1.0));
  alb = mix(alb, mix(uTc[5], uTc[6], strata), rock);
  // snow, holding on the gentler faces
  float snow = smoothstep(2050.0, 2450.0, h0 + (n1 - 0.5) * 600.0) * smoothstep(0.66, 0.4, slope);
  alb = mix(alb, uTc[7], snow);
  gloss = snow * 0.25;
  // gravel bars beside the river
  float bar = smoothstep(46.0, 6.0, rv.x) * smoothstep(0.35, 0.6, n1 + rv.y * 0.3);
  alb = mix(alb, uTc[8], bar * step(0.0, rv.x) * (1.0 - snow));
#endif

#if TERRAIN == 1
  if (h0 < uLand.x) {
    // the sea: long swells, the sun's road across it
    float depth = clamp((uLand.x - h0) / 60.0, 0.0, 1.0);
    vec2 t = vec2(3.0, 1.3) * uTime;
    // Each size of wave is dropped once it is finer than a few dots: drawn
    // smaller than that it is not a wave, only a different random number for
    // every pixel on every frame.
    float w1 = smoothstep(2.5, 5.0, 55.0 / foot), w2 = 0.6 * smoothstep(2.5, 5.0, 21.0 / foot), w3 = 0.3 * smoothstep(2.5, 5.0, 8.0 / foot);
    vec3 a1 = w1 > 0.0 ? noised((w + t) / 55.0) : vec3(0.5, 0.0, 0.0);
    vec3 a2 = w2 > 0.0 ? noised((ROT * w - t * 1.6) / 21.0) : vec3(0.5, 0.0, 0.0);
    vec3 a3 = w3 > 0.0 ? noised((w + t.yx * 2.0) / 8.0) : vec3(0.5, 0.0, 0.0);
    float sw = w1 * a1.x + w2 * a2.x + w3 * a3.x + (1.9 - w1 - w2 - w3) * 0.5;
    // the water's slope, from the noise's own derivative
    vec2 tilt = w1 * a1.yz / 55.0 + w2 * (a2.yz * ROT) / 21.0 + w3 * a3.yz / 8.0;
    float damp = 1.0 / (1.0 + foot * 0.06);
    n = normalize(vec3(-tilt * 3.3 * damp, 1.0));
    vec3 rdir = reflect(-view, n);
    rdir.z = abs(rdir.z);
    vec3 refl = skyBase(rdir);
    float fres = 0.04 + 0.96 * pow(1.0 - max(dot(n, view), 0.0), 5.0);
    vec3 c = mix(mix(uTc[9], uTc[10], depth) * (uAmbSky + uSunCol * 0.3), refl, clamp(fres + 0.12, 0.0, 1.0));
    /* The sun's road: patches of light where the swell tips toward the sun,
       thinning to either side. Their edges are broken up by a ripple that
       rides on the water, read at a size that doubles with distance so that
       it is always a few dots across; a ripple finer than that would be
       speckle, and the edges would boil. Over it, one dot in ten twinkles,
       four times a second: those are pinned to the screen, since pinned to
       the water they would reshuffle on every frame as the ship moves. */
    float along = foot / max(view.z, 0.1);               // what a dot covers of the water, lengthways
    float level = log2(max(along * 4.0 / 6.0, 1.0));
    float whole = floor(level);
    float size = 6.0 * exp2(whole);
    float ripple = mix(noise((w + t * 1.3) / size), noise((w + t * 1.3) / (size * 2.0) + 5.1), level - whole);
    float twinkle = smoothstep(0.9, 1.0, hash2(dotAt() + ivec2(0, int(floor(uTime * 4.0)) * 131)));
    vec3 hv = normalize(uSunDir + view);
    float nh = max(dot(n, hv), 0.0);
    float road = pow(max(dot(normalize(-view.xy), normalize(uSunDir.xy)), 0.0), 34.0);
    float flash = pow(nh, 60.0 + 500.0 * damp);
    float spark = flash * (1.4 + 3.0 * twinkle) * (0.25 + road * 2.2);
    spark += road * smoothstep(0.8, 0.98, sw * 0.62 + ripple * 0.36) * 0.9;
    c += uSunCol * spark * 1.5;
    float foam = smoothstep(0.25, 0.0, depth) * smoothstep(0.76, 0.84, sw * 0.5 + ripple * 0.5);
    c = mix(c, vec3(1.0, 0.8, 0.7) * (uAmbSky * 1.4 + uSunCol * 0.4), foam * 0.7);
    glow = clamp(spark * 0.7, 0.0, 1.0);
    c = applyFog(c, -view, dist);
    frag = shade(c, glow);
    return;
  }
  float n1 = fbmSoft(w / 210.0, 3, 210.0, fine);
  float n2 = fbmSoft(w / 41.0 + 5.0, 2, 41.0, fine);
  alb = mix(uTc[0], uTc[1], smoothstep(0.3, 0.7, n1));
  float wood = smoothstep(0.46, 0.6, fbm(w / 640.0 + 23.0, 3.0) + slope) * smoothstep(900.0, 500.0, h0);
  alb = mix(alb, mix(uTc[4], uTc[3], n2), wood);
  float rock = smoothstep(0.3, 0.48, mix(slope, steep, 0.4) + (n2 - 0.5) * 0.2);
  alb = mix(alb, mix(uTc[5], uTc[6], smoothstep(0.35, 0.65, noise(vec2(h0 / 30.0, w.x / 800.0)))), rock);
  alb = mix(alb, uTc[8], smoothstep(14.0, 2.0, h0 - uLand.x) * (1.0 - rock * 0.5));
#endif

#if TERRAIN == 2
  // cloud: light wraps well round each lump, shade pools in the creases
  float puff = gPuff;
  float ndl = dot(n, uSunDir);
  float lit = smoothstep(-0.45, 0.7, ndl);
  float open = smoothstep(0.08, 0.42, puff);
  float tone = clamp(lit * 0.72 + open * 0.42 - 0.12, 0.0, 1.0);
  vec3 c = tone < 0.34 ? mix(uTc[3], uTc[2], tone / 0.34)
    : tone < 0.67 ? mix(uTc[2], uTc[1], (tone - 0.34) / 0.33)
    : mix(uTc[1], uTc[0], (tone - 0.67) / 0.33);
  float rimL = pow(1.0 - max(dot(n, view), 0.0), 3.0) * max(dot(-view, uSunDir), 0.0);
  c += uSunCol * rimL * 0.35;
  c *= 1.0 - shipShadow(vPos) * 0.3;
  c = mix(c, fogColour(-view), fogAmount(-view, dist));
  frag = shade(c, 0.0);
#else
  float ndl = dot(n, uSunDir);
  float dif = smoothstep(-0.04, 0.55, ndl) * (1.0 - 0.85 * (1.0 - sunShadow));
  vec3 amb = mix(uAmbGround, uAmbSky, n.z * 0.5 + 0.5);
  vec3 c = alb * (uSunCol * dif + amb);
  vec3 hv = normalize(uSunDir + view);
  c += uSunCol * pow(max(dot(n, hv), 0.0), 30.0) * gloss * sunShadow;
  c = mix(c, fogColour(-view), fogAmount(-view, dist));
  frag = shade(c, glow);
#endif
#endif
}
`;

/* ---- buildings ----------------------------------------------------------- */

export const CITY_VS = `
layout(location = 0) in vec3 aCorner;   // unit box: xy -0.5..0.5, z 0..1
layout(location = 1) in vec3 aNormal;
layout(location = 2) in vec3 aInst;     // cell offset from the camera's cell, and which of eight slots
uniform vec4 uCity;                     // the camera's cell; the local position of that cell's corner
uniform vec4 uCityDraw;                 // radius in cells
out vec3 vPos;
out vec3 vN;
out vec2 vUV;
flat out vec4 vB;                       // seed, height, district, tier
void main() {
  ivec2 cell = ivec2(uCity.xy) + ivec2(aInst.xy);
  int slot = int(aInst.z + 0.5);
  int lot = slot >> 1, tier = slot & 1;
  float dz = district(cell);
  float h = lotHeight(cell, lot, dz);
  float seed = hash2(cell * 4 + ivec2(lot + 11, lot * 7 + 2));
  vec2 lotC = vec2(float(lot & 1), float(lot >> 1));
  vec2 size = vec2(LOT) - 2.0 * mix(3.0, 11.0, fract(seed * 5.3)) * vec2(1.0, 0.7 + 0.6 * fract(seed * 9.1));
  size = max(size, vec2(14.0));
  float z0 = 0.0, z1 = h;
  // tall buildings step in two-thirds of the way up
  bool stepped = h > 85.0 && fract(seed * 3.7) > 0.25;
  if (tier == 1) {
    if (stepped) { z0 = h * 0.64; size *= 0.62; } else { z1 = 0.0; }
  } else if (stepped) {
    z1 = h * 0.64;
  }
  // buildings rise out of the ground at the edge of what is drawn, so none pops in
  float edge = smoothstep(uCityDraw.x, uCityDraw.x - 3.5, length(aInst.xy));
  z0 *= edge; z1 *= edge;
  vec2 centre = STREET + (lotC + 0.5) * LOT;
  vec3 p = vec3(uCity.zw + aInst.xy * BLOCK + centre + aCorner.xy * size, mix(z0, z1, aCorner.z));
  if (z1 <= 0.0) p = vec3(uCity.zw, -10.0);
  vPos = p;
  vN = aNormal;
  vUV = abs(aNormal.z) > 0.5 ? aCorner.xy * size : vec2((abs(aNormal.x) > 0.5 ? aCorner.y * size.y : aCorner.x * size.x) + 500.0, p.z);
  vB = vec4(seed, h * edge, dz, float(tier));
  gl_Position = uViewProj * vec4(p, 1.0);
}
`;

export const CITY_FS = `
in vec3 vPos;
in vec3 vN;
in vec2 vUV;
flat in vec4 vB;
out vec4 frag;
void main() {
  vec3 toCam = uCam - vPos;
  float dist = length(toCam);
  vec3 view = toCam / dist;
  float px = dist * uRes.w;                            // metres per dot here
  float seed = vB.x, dz = vB.z;
  int key = int(seed * 8192.0);
  vec3 wall = mix(vec3(0.014, 0.018, 0.04), vec3(0.04, 0.03, 0.05), fract(seed * 7.3));
  vec3 emit = vec3(0.0);
  float glow = 0.0;
  vec3 lampCol = mix(vec3(1.0, 0.52, 0.16), vec3(1.0, 0.78, 0.5), smoothstep(0.55, 0.8, dz));
  vec3 n = vN;

  if (n.z > 0.5) {
    // roof: a little lighter than the walls, a beacon on the tall ones
    wall *= 1.5;
    if (vB.y > 120.0 && length(vUV) < max(1.6, px * 0.7)) {
      float blink = smoothstep(0.3, 0.9, sin(uTime * 2.0 + seed * 40.0) * 0.5 + 0.5);
      emit = vec3(1.0, 0.08, 0.05) * (0.5 + 1.2 * blink);
      glow = 0.9 * blink;
    }
  } else {
    // windows: a grid that coarsens with distance so a lit window is never less than a dot
    float coarse = grain(px * 1.8 / 3.2);
    float cw = 3.2 * coarse, ch = 3.6 * coarse;
    vec2 g = vec2(vUV.x / cw, vUV.y / ch);
    ivec2 wi = ivec2(floor(g));
    vec2 f = g - floor(g);
    float pane = step(0.2, f.x) * step(f.x, 0.8) * step(0.22, f.y) * step(f.y, 0.78);
    if (px > 2.4) pane = 0.42;                      // too far to see the wall between windows: its share of the light instead
    float r = hash3(ivec3(wi, key));
    float storey = hash2(ivec2(wi.y, key));
    // offices keep whole floors lit; flats light one window at a time
    bool office = fract(seed * 11.7) < 0.3 + 0.5 * dz;
    float frac = office ? (storey > 0.86 ? 0.55 : 0.05) : 0.24;
    frac *= 0.4 + 0.8 * dz * dz;
    // now and then a light goes on or off
    float flip = step(0.985, fract(r * 13.0 + floor(uTime / 7.0 + r * 9.0) * 0.137));
    float on = abs(step(r, frac) - flip * step(0.5, fract(r * 91.0)));
    vec3 warm = mix(vec3(1.0, 0.72, 0.36), vec3(1.0, 0.86, 0.6), fract(r * 5.0));
    vec3 cool = mix(vec3(0.75, 0.9, 1.0), vec3(0.55, 0.8, 1.0), fract(r * 3.0));
    vec3 wc = office ? mix(cool, warm, step(0.45, fract(seed * 23.0))) : mix(warm, cool, step(0.9, fract(r * 17.0)));
    float bright = (0.4 + 0.45 * fract(r * 29.0)) * min(1.0, 3.4 / cw + 0.3);
    emit = wc * on * pane * bright;
    glow = on * pane * 0.2 * bright;
    // a lit crown on some towers, and now and then a sign
    float fromTop = vB.y - vUV.y;
    if (vB.y > 95.0 && fract(seed * 31.0) > 0.45 && fromTop < max(3.0, px * 1.2) && (vB.w > 0.5 || vB.y * 0.64 < vUV.y)) {
      vec3 neon = fract(seed * 47.0) < 0.34 ? vec3(0.2, 0.95, 1.0) : fract(seed * 47.0) < 0.67 ? vec3(1.0, 0.25, 0.65) : vec3(1.0, 0.7, 0.2);
      emit = neon * 1.1;
      glow = 0.8;
    }
    // light from the street washes up the first storeys
    wall += lampCol * 0.05 * exp(-vUV.y / 14.0);
  }

  float ndl = max(dot(n, uSunDir), 0.0);
  vec3 c = wall * (uAmbSky * 1.9 + uSunCol * ndl * 3.5) + emit;
  c = mix(c, fogColour(-view), fogAmount(-view, dist));
  frag = shade(c, glow);
}
`;

/* ---- birds --------------------------------------------------------------- */

export const BIRD_VS = `
layout(location = 0) in vec3 aCorner;   // x along the body, y out along a wing (signed), z unused
layout(location = 1) in vec4 aBird;     // position (local), heading
layout(location = 2) in vec4 aFlap;     // phase, rate, wingspan, bank
uniform vec4 uBird;                     // least wingspan in dots
out float vShade;
void main() {
  float span = aFlap.z;
  vec3 c = aBird.xyz;
  float dist = length(c - uCam);
  // never smaller than a few dots: far birds are drawn larger than life
  float k = max(1.0, uBird.x * dist * uRes.w / span);
  float flap = sin(uTime * aFlap.y + aFlap.x);
  float glide = smoothstep(-0.2, 0.6, sin(uTime * 0.31 + aFlap.x * 3.0));
  float lift = mix(flap, 0.25, glide) * 0.75;
  float side = aCorner.y;
  vec3 p = vec3(aCorner.x * span * 0.36, side * span * 0.5 * cos(lift * abs(side)), abs(side) * span * 0.5 * sin(lift));
  // bank into the turn, then turn to the heading
  float cb = cos(aFlap.w), sb = sin(aFlap.w);
  p = vec3(p.x, p.y * cb - p.z * sb, p.y * sb + p.z * cb);
  float ch = cos(aBird.w), sh = sin(aBird.w);
  p = vec3(p.x * ch - p.y * sh, p.x * sh + p.y * ch, p.z);
  vec3 world = c + p * k;
  vShade = 0.5 + 0.5 * abs(side);
  gl_Position = uViewProj * vec4(world, 1.0);
}
`;

export const BIRD_FS = `
in float vShade;
out vec4 frag;
uniform vec3 uBirdCol;
void main() {
  frag = shade(uBirdCol * mix(0.8, 1.0, vShade), 0.0);
}
`;

/* ---- cloud: marched at half size ----------------------------------------- */

/* Cloud is the dearest thing in the picture: dozens of samples of a 3D
   texture along every ray. It is soft, so it is marched for one pixel in four
   and enlarged afterwards. What that needs care over is edges: a pixel of
   airship in front of a bank of cloud must not be given its neighbour's
   cloud. So each cloud pixel also records the depth it was marched to, taken
   from the nearest or the farthest of the four scene pixels it covers (a
   chequerboard of the two, so that both sides of an edge are always
   represented nearby), and COMPOSITE takes cloud for a scene pixel from the
   neighbours marched to a depth like its own. */
const DEPTH = `
uniform vec4 uProj;         // near, far
float linearDepth(float z) {
  float n = uProj.x, f = uProj.y;
  return 2.0 * n * f / (f + n - (z * 2.0 - 1.0) * (f - n));
}
// a depth in 24 bits of an 8-bit colour, and back
vec3 packDepth(float z) {
  vec3 v = fract(min(z, 0.99999994) * vec3(1.0, 255.0, 65025.0));
  v.xy -= v.yz / 255.0;
  return v;
}
float unpackDepth(vec3 v) { return dot(v, vec3(1.0, 1.0 / 255.0, 1.0 / 65025.0)); }
`;

export const CLOUD_FS = `
in vec2 vNdc;
layout(location = 0) out vec4 frag;         // the cloud's colour, already weighted by how solid it is; alpha is how much shows through
layout(location = 1) out vec4 fragRef;      // the depth it was marched to
uniform sampler2D uDepth;
uniform vec3 uCloudLit;
uniform vec3 uCloudDark;
uniform vec3 uCloudDeep;
uniform vec4 uCloudMarch;   // step growth per step, reach in metres, light step in metres, least steps through the layer
uniform vec4 uCloudLight;   // how fast cloud shades itself, how fast it turns opaque (per metre), how far the sun burns through
${DEPTH}${RAY}
// How long a stride is at distance t along the ray: it grows with distance, within limits.
#define STRIDE(t) max(min((t) * uCloudMarch.x, most), 14.0)
void main() {
  // this pixel stands for a square of four in the scene
  ivec2 hp = ivec2(gl_FragCoord.xy), last = ivec2(uRes.xy) - 1;
  float za = texelFetch(uDepth, min(hp * 2, last), 0).r;
  float zb = texelFetch(uDepth, min(hp * 2 + ivec2(1, 0), last), 0).r;
  float zc = texelFetch(uDepth, min(hp * 2 + ivec2(0, 1), last), 0).r;
  float zd = texelFetch(uDepth, min(hp * 2 + ivec2(1, 1), last), 0).r;
  float z = ((hp.x + hp.y) & 1) == 0 ? min(min(za, zb), min(zc, zd)) : max(max(za, zb), max(zc, zd));
  vec2 ndc = (vec2(hp) * 2.0 + 1.0) / uRes.xy * 2.0 - 1.0;
  vec3 rd = rayDir(ndc);
  fragRef = vec4(packDepth(z), 1.0);

  float limit = uCloudMarch.y;
  if (z < 1.0) {
    vec4 wp = uInvViewProj * vec4(ndc, z * 2.0 - 1.0, 1.0);
    limit = min(limit, length(wp.xyz / wp.w - uCam));
  }
  // the stretch of the ray that can hold cloud
  float t0 = 0.0, t1 = limit;
#if CLOUDS == 1
  float lo = uCloudSlab.x;
#else
  float lo = -1.0e6;
#endif
  if (abs(rd.z) > 1e-4) {
    float ta = (lo - uCam.z) / rd.z, tb = (uCloudSlab.y - uCam.z) / rd.z;
    t0 = max(t0, min(ta, tb));
    t1 = min(t1, max(ta, tb));
  } else if (uCam.z < lo || uCam.z > uCloudSlab.y) {
    t1 = -1.0;
  }
  float T = 1.0;
  vec3 acc = vec3(0.0);
  if (t1 > t0) {
    // Steps grow with distance, so cloud is sampled about as finely on
    // screen near as far. Where a step first lands inside cloud, the edge
    // is found by halving back toward the last clear sample: that pins the
    // surface down, so cloud has a firm outline and not a ragged fringe.
    // It is halved seven times. Four left the surface a sixteenth of a step
    // out, by an amount that ran in a sawtooth across the picture, and the
    // cloud tops came out ruled with fine contour lines.
    float t = max(t0, 12.0);
    bool inside = false;
    float burn = 1.0 - uCloudLight.z * smoothstep(0.9965, 0.9993, dot(rd, uSunDir));
    float most = (t1 - t0) / uCloudMarch.w;              // the longest a stride may be: a layer is crossed in at least that many
    for (int i = 0; i < CLOUD_STEPS; i++) {
      if (t >= t1) break;
      float seg = min(STRIDE(t), t1 - t);
      float ts = t + seg;
      vec3 p = uCam + rd * ts;
      /* What the cloud is asked for is the stride at the place being asked
         about, not the length of the step that happened to arrive there. The
         two are nearly the same, but the step's length jumps from one step
         to the next, and anything worked out from it shows on the cloud as
         a shell at every step's distance. */
      float pace = STRIDE(ts);
      float d = cloudDensity(p, pace);
      if (d > 0.0) {
        float len = seg;
        if (!inside) {
          float a0 = t, a1 = ts;
          for (int k = 0; k < 7; k++) {
            float mid = 0.5 * (a0 + a1);
            if (cloudDensity(uCam + rd * mid, STRIDE(mid)) > 0.0) a1 = mid; else a0 = mid;
          }
          ts = a1;
          p = uCam + rd * ts;
          pace = STRIDE(ts);
          // how solid it is just under the surface: a quarter of a stride in, or a little way in where it is thinner than that
          d = max(cloudDensity(p + rd * pace * 0.25, pace), cloudDensity(p + rd * pace * 0.08, pace));
          len = pace;
          inside = true;
        }
        float toSun = cloudDensity(p + uSunDir * uCloudMarch.z, 0.0) + 0.6 * cloudDensity(p + uSunDir * uCloudMarch.z * 2.8, 0.0);
        float light = exp(-toSun * uCloudLight.x);
        float hf = clamp((p.z - uCloudSlab.x) / (uCloudSlab.y - uCloudSlab.x), 0.0, 1.0);
        vec3 c = mix(uCloudDark, uCloudLit, clamp(light * 0.92 + hf * 0.16 - 0.04, 0.0, 1.0));
        c = mix(uCloudDeep, c, clamp(light * 1.6 + hf * 0.9 + 0.25, 0.0, 1.0));
        float silver = pow(max(dot(rd, uSunDir), 0.0), 5.0) * light;
        c += uSunCol * silver * 0.3;
        c = toSrgb(mix(c, fogColour(rd), fogAmount(rd, ts)));
        float a = (1.0 - exp(-d * len * uCloudLight.y)) * burn;
        acc += T * a * c;
        T *= 1.0 - a;
        if (T < 0.04) { T = 0.0; break; }
      } else {
        inside = false;
      }
      t = ts;
    }
  }
  frag = vec4(acc, T);
}
`;

/* ---- glow: what is bright, gathered small and spread ---------------------- */

/* Four taps around the pixel, each between four texels of the source, so
   the source is averaged and not picked from. Run once from the scene, with
   each texel weighted by how strongly it glows (its alpha), into a picture
   one texel to two dots; then once more over that, to spread it. Because the
   small picture is sized in dots, a lamp's halo is as wide on a sharp screen
   as on a soft one. */
export const GLOW_FS = `
in vec2 vNdc;
out vec4 frag;
uniform sampler2D uSrc;
uniform vec4 uSrcRect;      // the corner of the source that holds the picture: its size, and its last texel centre, in uv
uniform vec4 uTap;          // the taps' offset in uv; whether to weight by alpha
void main() {
  vec2 uv = (vNdc * 0.5 + 0.5) * uSrcRect.xy;
  vec3 sum = vec3(0.0);
  for (int i = 0; i < 4; i++) {
    vec2 o = vec2(float(i & 1), float(i >> 1)) * 2.0 - 1.0;
    vec4 t = texture(uSrc, min(uv + o * uTap.xy, uSrcRect.zw));
    sum += t.rgb * mix(1.0, t.a, uTap.z);
  }
  frag = vec4(sum * 0.25, 1.0);
}
`;

/* ---- composite: the scene, its glow, the cloud in front of it ------------- */

export const COMPOSITE_FS = `
in vec2 vNdc;
out vec4 frag;
uniform sampler2D uScene;
uniform sampler2D uDepth;
uniform sampler2D uCloud;
uniform sampler2D uCloudRef;
uniform sampler2D uGlow;
uniform vec4 uGlowRect;     // the corner of the glow picture in use: its size, and its last texel centre, in uv
uniform vec4 uCloudMarch;   // step growth per step, reach in metres, light step in metres, least steps through the layer
uniform vec4 uLook;         // glow strength, outline strength, unused, vignette
${DEPTH}
void main() {
  ivec2 pix = ivec2(gl_FragCoord.xy);
  vec4 scene = texelFetch(uScene, pix, 0);
  vec3 col = scene.rgb;
  float d0 = linearDepth(texelFetch(uDepth, pix, 0).r);

  // ---- outline: a darker edge, a dot wide, where something stands in front of something far ----
  if (uLook.y > 0.0) {
    int k = max(1, int(uRes.z + 0.5));
    ivec2 last = ivec2(uRes.xy) - 1;
    float dMax = d0;
    dMax = max(dMax, linearDepth(texelFetch(uDepth, min(pix + ivec2(k, 0), last), 0).r));
    dMax = max(dMax, linearDepth(texelFetch(uDepth, max(pix - ivec2(k, 0), ivec2(0)), 0).r));
    dMax = max(dMax, linearDepth(texelFetch(uDepth, min(pix + ivec2(0, k), last), 0).r));
    dMax = max(dMax, linearDepth(texelFetch(uDepth, max(pix - ivec2(0, k), ivec2(0)), 0).r));
    float edge = smoothstep(0.35, 0.9, (dMax - d0) / max(d0, 1.0)) * step(d0, 1500.0);
    col *= 1.0 - edge * uLook.y * (1.0 - scene.a);
  }

  // ---- glow: lamps and lit windows bleed into what is around them ----
  col += texture(uGlow, min(gl_FragCoord.xy / uRes.xy * uGlowRect.xy, uGlowRect.zw)).rgb * uLook.x * 2.3;

  // ---- cloud between the eye and whatever was drawn ----
#if CLOUDS != 0
  {
    // the four cloud pixels around this one, each counted by how near it is
    // and by how like this pixel's depth the depth it was marched to is
    vec2 at = gl_FragCoord.xy * 0.5 - 0.5;
    ivec2 base = ivec2(floor(at)), lastC = (ivec2(uRes.xy) + 1) / 2 - 1;
    vec2 f = at - floor(at);
    float here = min(d0, uCloudMarch.y);
    vec4 sum = vec4(0.0);
    float total = 0.0;
    for (int i = 0; i < 4; i++) {
      ivec2 o = ivec2(i & 1, i >> 1);
      ivec2 q = clamp(base + o, ivec2(0), lastC);
      float there = min(linearDepth(unpackDepth(texelFetch(uCloudRef, q, 0).rgb)), uCloudMarch.y);
      float unlike = abs(there - here) / max(there, here);
      float wgt = (o.x == 0 ? 1.0 - f.x : f.x) * (o.y == 0 ? 1.0 - f.y : f.y) / (1.0 + 400.0 * unlike * unlike) + 1e-5;
      sum += texelFetch(uCloud, q, 0) * wgt;
      total += wgt;
    }
    vec4 cloud = sum / total;
    col = col * cloud.a + cloud.rgb;
  }
#endif

  // ---- vignette ----
  col *= 1.0 - uLook.w * dot(vNdc, vNdc) * 0.35;
  frag = vec4(clamp(col, 0.0, 1.0) + (ign(gl_FragCoord.xy + 17.0) - 0.5) / 255.0, 1.0);
}
`;

/* ---- mix: one picture dissolving into another ------------------------------ */

/* Through a dissolve two finished pictures are laid over one another. Each
   was drawn into a corner of its texture at its own size (the one that is
   mostly gone is drawn smaller, since little of it shows), and is enlarged
   here to fill the screen. */
export const MIX_FS = `
in vec2 vNdc;
out vec4 frag;
uniform sampler2D uFrom;
uniform sampler2D uTo;
uniform vec4 uFromRect;     // the corner of each texture that holds its picture: its size, and its last texel centre, in uv
uniform vec4 uToRect;
uniform float uMix;         // 0: all the old picture, 1: all the new
void main() {
  vec2 uv = vNdc * 0.5 + 0.5;
  vec3 a = texture(uFrom, min(uv * uFromRect.xy, uFromRect.zw)).rgb;
  vec3 b = texture(uTo, min(uv * uToRect.xy, uToRect.zw)).rgb;
  frag = vec4(mix(a, b, uMix), 1.0);
}
`;

/* Join chunks into the two sources of a program. defs is an object of
   #define values, written before everything else. */
export function program(vs, fs, defs = {}, lib = '') {
  const d = Object.entries(defs).map(([k, v]) => `#define ${k} ${v}\n`).join('');
  return {
    vs: HEADER + d + COMMON + lib + vs,
    fs: HEADER + d + COMMON + FRAGMENT + lib + fs,
  };
}
