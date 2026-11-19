import * as THREE from "three";

// The paint on the canvas, simulated on the graphics card as a thin film over a grid of columns.
//
// Ported from Adam Chernick's Codevember 2026 Day 18 "Pendulum" (MIT), 18-pendulum/paint.ts:
// https://github.com/acher249/codevember-2026/tree/main/18-pendulum
// The original runs as WebGPU compute (three/tsl). This is the same model as WebGL2 fragment passes ping-ponging between
// float render targets, so it runs in any browser with WebGL2, the Quest's included. One change to the model: every
// landing carries its own colour (the original pours one colour at a time), so several cans and a stacked, colour-shifting
// pour can land in the same frame.
//
// Each column holds how thick the paint stands on it and the paint's colour there, and how wet it still is. Paint lands
// where the stream's parcels come down, spread a little along the way they were moving. Then, a few times a frame, it
// flows: wet paint runs from a column to a lower neighbour, but only by however much the step between them exceeds what
// the paint can hold up by itself (its yield stress), so a fresh line slumps into a rounded ridge and then stands; and it
// runs more freely the thicker it is, so a pool spreads and a thin skin barely moves. Colour goes with the paint that
// carries it, mixed by volume where wet meets wet; over dry paint it lies as its own layer. Paint dries in seconds, thin
// paint first, and dry paint no longer flows.

export const LANDINGS = 128;
const STEP = 1 / 240;
const REF = 0.0015;

const vertex = /* glsl */ `
in vec3 position;
void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const common = /* glsl */ `
precision highp float;
precision highp int;
precision highp sampler2D;
uniform int N;
uniform float CELL;
uniform float SIZE;
ivec2 clampI(ivec2 p) { return clamp(p, ivec2(0), ivec2(N - 1)); }
vec2 centre(ivec2 p) { return (vec2(p) + 0.5) * CELL - SIZE / 2.0; }
`;

// Paint coming down: each landing's volume spread over a small round patch, drawn out the way it was moving.
const landShader = /* glsl */ `
${common}
uniform sampler2D cells;
uniform sampler2D wet;
uniform sampler2D drops; // row 0: x, z, volume, radius; row 1: moving x, z, sheet half-width x, z; row 2: colour
uniform int count;
layout(location = 0) out vec4 outCells;
layout(location = 1) out vec4 outWet;
void main() {
  ivec2 ij = ivec2(gl_FragCoord.xy);
  vec4 c = texelFetch(cells, ij, 0);
  vec4 w = texelFetch(wet, ij, 0);
  vec2 p = centre(ij);
  float added = 0.0;
  vec3 addedColour = vec3(0.0);
  for (int k = 0; k < ${LANDINGS}; k++) {
    if (k >= count) break;
    vec4 l = texelFetch(drops, ivec2(k, 0), 0);
    vec4 m = texelFetch(drops, ivec2(k, 1), 0);
    vec3 col = texelFetch(drops, ivec2(k, 2), 0).rgb;
    vec2 off = p - l.xy;
    vec2 seg = m.zw;
    float t = clamp(dot(off, seg) / max(dot(seg, seg), 1e-12), -1.0, 1.0);
    vec2 d = off - seg * t;
    float speed = length(m.xy);
    vec2 way = m.xy / max(speed, 1e-4);
    float a = d.x * way.x + d.y * way.y;
    float b = d.x * way.y - d.y * way.x;
    float reach = max(l.w * 1.5, CELL * 1.1);
    float along = reach + speed * ${(STEP * 1.1).toFixed(8)};
    float fall = exp(-(a * a / (along * along) + b * b / (reach * reach)));
    float area = reach * along * 3.14159265 + length(seg) * ${(2 * Math.sqrt(Math.PI)).toFixed(6)} * reach;
    float v = l.z * fall / area;
    added += v;
    addedColour += col * v;
  }
  outCells = c;
  outWet = w;
  if (added > 0.0) {
    float total = c.x + added;
    // New paint mixes with what is still wet under it, but lies over dry paint as a layer of its own colour.
    float under = c.x * max(w.x * w.x, 0.02);
    vec3 colour = (c.yzw * under + addedColour) / max(under + added, 1e-12);
    outCells = vec4(total, colour);
    outWet = vec4(min((w.x * c.x + added) / max(total, 1e-9), 1.0), min(w.y + added * 4000.0, 1.0), w.z, w.w);
  }
}
`;

// How much each column gives each lower neighbour this step.
const fluxShader = /* glsl */ `
${common}
uniform sampler2D cells;
uniform sampler2D wet;
uniform float yieldStep;
uniform float mobility;
layout(location = 0) out vec4 outFlux;
float hAt(ivec2 p) { return texelFetch(cells, clampI(p), 0).x; }
void main() {
  ivec2 ij = ivec2(gl_FragCoord.xy);
  float h = texelFetch(cells, ij, 0).x;
  float w = texelFetch(wet, ij, 0).x;
  float r = h / ${REF};
  float run = mobility * min(r * r, 4.0) * w * w;
  vec4 out4 = vec4(
    max(h - hAt(ij + ivec2(-1, 0)) - yieldStep, 0.0),
    max(h - hAt(ij + ivec2(1, 0)) - yieldStep, 0.0),
    max(h - hAt(ij + ivec2(0, -1)) - yieldStep, 0.0),
    max(h - hAt(ij + ivec2(0, 1)) - yieldStep, 0.0)) * run * 0.5;
  float total = out4.x + out4.y + out4.z + out4.w;
  outFlux = out4 * min(1.0, h * 0.2 / max(total, 1e-12));
}
`;

// Each column after the step: what came in from its neighbours, carrying their colour and wetness, less what left;
// then a little drier, thin paint fastest.
const settleShader = /* glsl */ `
${common}
uniform sampler2D cells;
uniform sampler2D wet;
uniform sampler2D flux;
uniform float drying;
uniform float wipe;
layout(location = 0) out vec4 outCells;
layout(location = 1) out vec4 outWet;
void main() {
  ivec2 ij = ivec2(gl_FragCoord.xy);
  vec4 c = texelFetch(cells, ij, 0);
  vec4 w = texelFetch(wet, ij, 0);
  vec4 f = texelFetch(flux, ij, 0);
  float kept = c.x - (f.x + f.y + f.z + f.w);
  float showing = kept * max(w.x * w.x, 0.02);
  vec3 colour = c.yzw * showing;
  float weight = showing;
  float wetness = w.x * kept;
  float total = kept;
  ivec2 n; float part;
  n = clampI(ij + ivec2(-1, 0)); part = (n == ij) ? 0.0 : texelFetch(flux, n, 0).y;
  total += part; weight += part; colour += texelFetch(cells, n, 0).yzw * part; wetness += texelFetch(wet, n, 0).x * part;
  n = clampI(ij + ivec2(1, 0)); part = (n == ij) ? 0.0 : texelFetch(flux, n, 0).x;
  total += part; weight += part; colour += texelFetch(cells, n, 0).yzw * part; wetness += texelFetch(wet, n, 0).x * part;
  n = clampI(ij + ivec2(0, -1)); part = (n == ij) ? 0.0 : texelFetch(flux, n, 0).w;
  total += part; weight += part; colour += texelFetch(cells, n, 0).yzw * part; wetness += texelFetch(wet, n, 0).x * part;
  n = clampI(ij + ivec2(0, 1)); part = (n == ij) ? 0.0 : texelFetch(flux, n, 0).z;
  total += part; weight += part; colour += texelFetch(cells, n, 0).yzw * part; wetness += texelFetch(wet, n, 0).x * part;
  float inv = 1.0 / max(total, 1e-12);
  float thin = 1.0 + ${REF} / max(total, ${REF * 0.05});
  float keep = 1.0 - wipe;
  // Off the edge of the canvas the paint is gone (it runs onto the floor).
  bool edge = ij.x < 1 || ij.y < 1 || ij.x > N - 2 || ij.y > N - 2;
  float h = edge ? 0.0 : total * keep;
  outCells = vec4(h, weight > 1e-12 ? colour / weight : c.yzw);
  outWet = vec4(max(wetness * inv - drying * thin, 0.0) * keep, w.y * 0.97, w.z, w.w);
}
`;

export type Drop = { x: number; z: number; volume: number; r: number; vx: number; vz: number; ax: number; az: number; cr: number; cg: number; cb: number };

export function createPaint(renderer: THREE.WebGLRenderer, N: number, SIZE: number) {
  const CELL = SIZE / N;
  const gl = renderer.getContext() as WebGL2RenderingContext;
  const full = !!gl.getExtension("EXT_color_buffer_float");
  const type = full ? THREE.FloatType : THREE.HalfFloatType;
  const make = (count: number) => {
    const t = new THREE.WebGLRenderTarget(N, N, { count, type, format: THREE.RGBAFormat, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false, stencilBuffer: false, generateMipmaps: false });
    for (const tex of t.textures) {
      tex.colorSpace = THREE.NoColorSpace;
      tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    }
    return t;
  };
  let state = make(2);
  let spare = make(2);
  const flux = make(1);

  const dropData = new Float32Array(LANDINGS * 3 * 4);
  const drops = new THREE.DataTexture(dropData, LANDINGS, 3, THREE.RGBAFormat, THREE.FloatType);
  drops.minFilter = drops.magFilter = THREE.NearestFilter;
  drops.needsUpdate = true;

  const u = {
    N: { value: N },
    CELL: { value: CELL },
    SIZE: { value: SIZE },
    count: { value: 0 },
    yieldStep: { value: 0.00038 },
    mobility: { value: 0.155 },
    drying: { value: 0.0004 },
    wipe: { value: 0 },
    cells: { value: null as THREE.Texture | null },
    wet: { value: null as THREE.Texture | null },
    flux: { value: flux.texture as THREE.Texture },
    drops: { value: drops as THREE.Texture }
  };
  const material = (fragmentShader: string) => new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: vertex, fragmentShader, uniforms: u, depthTest: false, depthWrite: false });
  const land = material(landShader);
  const flowM = material(fluxShader);
  const settle = material(settleShader);
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), land);
  quad.frustumCulled = false;
  const scene = new THREE.Scene();
  scene.add(quad);
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  const pass = (m: THREE.RawShaderMaterial, target: THREE.WebGLRenderTarget) => {
    quad.material = m;
    renderer.setRenderTarget(target);
    renderer.render(scene, camera);
  };
  const swap = () => {
    const t = state;
    state = spare;
    spare = t;
  };
  const bind = () => {
    u.cells.value = state.textures[0];
    u.wet.value = state.textures[1];
  };

  // Paint the frame's landings, then let it flow.
  const step = (landed: Drop[], flows: number) => {
    const before = renderer.getRenderTarget();
    const auto = renderer.autoClear;
    renderer.autoClear = false;
    // In batches of LANDINGS, so a slow frame with many holes pouring loses no paint.
    for (let start = 0; start < landed.length; start += LANDINGS) {
      const n = Math.min(landed.length - start, LANDINGS);
      for (let k = 0; k < n; k++) {
        const l = landed[start + k];
        dropData.set([l.x, l.z, l.volume, l.r], k * 4);
        dropData.set([l.vx, l.vz, l.ax, l.az], (LANDINGS + k) * 4);
        dropData.set([l.cr, l.cg, l.cb, 1], (2 * LANDINGS + k) * 4);
      }
      drops.needsUpdate = true;
      u.count.value = n;
      bind();
      pass(land, spare);
      swap();
    }
    for (let k = 0; k < flows; k++) {
      bind();
      pass(flowM, flux);
      pass(settle, spare);
      swap();
    }
    u.wipe.value = 0;
    bind();
    renderer.setRenderTarget(before);
    renderer.autoClear = auto;
  };

  const clear = () => {
    const before = renderer.getRenderTarget();
    for (const t of [state, spare, flux]) {
      renderer.setRenderTarget(t);
      renderer.setClearColor(0x000000, 0);
      renderer.clear(true, false, false);
    }
    renderer.setRenderTarget(before);
    bind();
  };
  clear();

  return {
    N,
    SIZE,
    CELL,
    u,
    full,
    step,
    clear,
    get cells() {
      return state.textures[0];
    },
    get wet() {
      return state.textures[1];
    }
  };
}

export type Paint = ReturnType<typeof createPaint>;
