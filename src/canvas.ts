import * as THREE from "three";
import type { Paint } from "./paint";
import { CANVAS, FACE, STRETCHER, STAND } from "./pendulum";

// The canvas and the paint on it, drawn straight from the simulation (after Adam Chernick's 18-pendulum/canvas.tsx, MIT):
// one vertex over each column, raised by the paint's thickness, a little more than life so the relief catches the light.
// Here the slope, colour and wetness are read again per pixel with smooth (bilinear) sampling, so a saved background
// stays smooth at 4K even though the paint is simulated on a few hundred columns. Wet paint is glossy and dries to satin;
// bare canvas shows its weave. `snapshot` lights it evenly from the upper left for a saved picture, as the original does.

const RELIEF = 1.6;

export const canvasColours: Record<string, string> = {
  black: "#101011",
  white: "#e9e5dc",
  linen: "#b59f7c"
};

const vertexShader = /* glsl */ `
precision highp sampler2D;
uniform sampler2D cells;
uniform int N;
uniform float lift;
out vec2 vTexel;
out vec3 vWorld;
void main() {
  vec2 t = vec2(uv.x, 1.0 - uv.y) * float(N - 1);
  vTexel = t;
  ivec2 ij = ivec2(floor(t + 0.5));
  float h = texelFetch(cells, ij, 0).x * ${RELIEF.toFixed(2)};
  vec4 world = modelMatrix * vec4(position.x, h + lift, position.z, 1.0);
  vWorld = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const fragmentShader = /* glsl */ `
precision highp sampler2D;
uniform sampler2D cells;
uniform sampler2D wet;
uniform int N;
uniform float CELL;
uniform mat4 modelMatrix;
uniform vec3 tone;
layout(location = 0) out highp vec4 fragColour;
uniform float snapshot;
uniform vec3 keyDir;
uniform vec3 keyColour;
uniform vec3 skyColour;
uniform vec3 groundColour;
in vec2 vTexel;
in vec3 vWorld;

vec4 fetchC(ivec2 p) { return texelFetch(cells, clamp(p, ivec2(0), ivec2(N - 1)), 0); }
vec4 fetchW(ivec2 p) { return texelFetch(wet, clamp(p, ivec2(0), ivec2(N - 1)), 0); }
vec4 bilinC(vec2 t) {
  vec2 f = fract(t); ivec2 i = ivec2(floor(t));
  return mix(mix(fetchC(i), fetchC(i + ivec2(1, 0)), f.x), mix(fetchC(i + ivec2(0, 1)), fetchC(i + ivec2(1, 1)), f.x), f.y);
}
vec4 bilinW(vec2 t) {
  vec2 f = fract(t); ivec2 i = ivec2(floor(t));
  return mix(mix(fetchW(i), fetchW(i + ivec2(1, 0)), f.x), mix(fetchW(i + ivec2(0, 1)), fetchW(i + ivec2(1, 1)), f.x), f.y);
}
vec3 paintAt(vec2 t) {
  vec2 f = fract(t); ivec2 i = ivec2(floor(t));
  vec4 a = fetchC(i), b = fetchC(i + ivec2(1, 0)), c = fetchC(i + ivec2(0, 1)), d = fetchC(i + ivec2(1, 1));
  float wa = (1.0 - f.x) * (1.0 - f.y) * (a.x + 1e-9), wb = f.x * (1.0 - f.y) * (b.x + 1e-9);
  float wc = (1.0 - f.x) * f.y * (c.x + 1e-9), wd = f.x * f.y * (d.x + 1e-9);
  return (a.yzw * wa + b.yzw * wb + c.yzw * wc + d.yzw * wd) / (wa + wb + wc + wd);
}
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p); vec2 s = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), s.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), s.x), s.y);
}

void main() {
  vec2 t = vTexel;
  vec4 own = bilinC(t);
  vec4 w4 = bilinW(t);
  // Thickness is weighted towards colour only where there is paint: bilinear colour across an empty column would grey it.
  float hx1 = bilinC(t + vec2(0.75, 0.0)).x, hx0 = bilinC(t - vec2(0.75, 0.0)).x;
  float hz1 = bilinC(t + vec2(0.0, 0.75)).x, hz0 = bilinC(t - vec2(0.0, 0.75)).x;
  float dx = (hx1 - hx0) * ${RELIEF.toFixed(2)} / (CELL * 1.5);
  float dz = (hz1 - hz0) * ${RELIEF.toFixed(2)} / (CELL * 1.5);
  vec3 n = normalize(vec3(-dx, 1.0, -dz));
  n = normalize(mat3(modelMatrix) * n);
  float thick = own.x;
  float wetness = clamp(w4.x, 0.0, 1.0);
  float fresh = clamp(w4.y, 0.0, 1.0);
  // Colour weighted by how much paint each column holds, so bare canvas next to paint does not grey its edge.
  vec3 paintColour = paintAt(t);

  vec2 p = vWorld.xz;
  float weave = sin(p.x * 1400.0) * sin(p.y * 1400.0) * 0.5 + 0.5;
  float away = length(vWorld - cameraPosition);
  float weaveFade = smoothstep(2.6, 0.9, away) * (1.0 - snapshot);
  float slub = noise(vec2(p.x * 60.0, p.y * 90.0)) * 0.06;
  vec3 canvasTone = tone * (1.0 + weave * 0.12 * weaveFade + slub);
  float cover = smoothstep(0.00001, 0.00012, thick);
  float pooled = smoothstep(0.0008, 0.004, thick);
  float ripple = (noise(p * 220.0 + wetness * 3.0) - 0.5) * (1.0 - wetness) * 0.08;
  vec3 paintTone = paintColour * (1.0 - pooled * 0.12) * (1.0 + ripple);
  vec3 albedo = mix(canvasTone, paintTone, cover);

  vec3 colour;
  if (snapshot > 0.5) {
    // Evenly lit from the upper left, keeping the paint's true colours and its relief.
    float even = max(dot(n, normalize(vec3(-0.45, 1.0, -0.55))), 0.0);
    float sheen = pow(even, 40.0) * cover * (wetness * 0.35 + 0.1);
    colour = albedo * (even * 0.55 + 0.5) + sheen;
  } else {
    vec3 v = normalize(cameraPosition - vWorld);
    vec3 l = normalize(keyDir);
    float diff = max(dot(n, l), 0.0);
    vec3 ambient = mix(groundColour, skyColour, n.y * 0.5 + 0.5);
    float rough = mix(0.86, mix(0.42, 0.06, wetness), cover);
    float shininess = 2.0 / max(rough * rough * rough * rough, 1e-4) - 2.0;
    vec3 hv = normalize(l + v);
    float spec = pow(max(dot(n, hv), 0.0), shininess) * (shininess + 8.0) / 25.0;
    float fres = 0.04 + 0.96 * pow(1.0 - max(dot(n, v), 0.0), 5.0);
    float coat = cover * wetness * 0.9;
    colour = albedo * (ambient + keyColour * diff) + keyColour * spec * fres * (0.25 + coat) * diff;
    colour += skyColour * fres * coat * 0.35;
    colour += paintColour * fresh * cover * 0.25;
  }
  fragColour = linearToOutputTexel(vec4(colour, 1.0));
}
`;

export function createCanvas(paint: Paint, linearFilter = false) {
  const { N, SIZE, CELL } = paint;
  void linearFilter;
  const uniforms = {
    cells: { value: paint.cells as THREE.Texture },
    wet: { value: paint.wet as THREE.Texture },
    N: { value: N },
    CELL: { value: CELL },
    lift: { value: FACE },
    tone: { value: new THREE.Color(canvasColours.black).convertSRGBToLinear() },
    snapshot: { value: 0 },
    keyDir: { value: new THREE.Vector3(-0.5, 1.4, 0.7).normalize() },
    keyColour: { value: new THREE.Color(1.05, 1.0, 0.94) },
    skyColour: { value: new THREE.Color(0.42, 0.44, 0.48) },
    groundColour: { value: new THREE.Color(0.12, 0.11, 0.1) }
  };
  const geometry = new THREE.PlaneGeometry(SIZE - CELL, SIZE - CELL, N - 1, N - 1);
  geometry.rotateX(-Math.PI / 2);
  const material = new THREE.ShaderMaterial({ glslVersion: THREE.GLSL3, uniforms, vertexShader, fragmentShader });
  material.toneMapped = false;
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;

  const group = new THREE.Group();
  group.add(mesh);
  // The stretcher under it: a shallow box with the canvas wrapped round its sides.
  const frameMaterial = new THREE.MeshStandardMaterial({ roughness: 0.85, color: new THREE.Color(canvasColours.black).multiplyScalar(0.9) });
  const frame = new THREE.Mesh(new THREE.BoxGeometry(CANVAS + 0.02, STRETCHER - 0.001, CANVAS + 0.02).translate(0, STAND + (STRETCHER - 0.001) / 2, 0), frameMaterial);
  frame.receiveShadow = true;
  group.add(frame);
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.018, 48).translate(0, STAND - 0.009, 0), new THREE.MeshStandardMaterial({ roughness: 0.8, color: "#6a5239" }));
  group.add(disc);
  const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.34, STAND - 0.022, 40).translate(0, (STAND - 0.022) / 2, 0), new THREE.MeshStandardMaterial({ roughness: 0.45, metalness: 0.8, color: "#3a3a3b" }));
  group.add(drum);

  const setGround = (name: string) => {
    const c = new THREE.Color(canvasColours[name] ?? canvasColours.black);
    frameMaterial.color.copy(c).multiplyScalar(0.9);
    uniforms.tone.value.copy(c).convertSRGBToLinear();
  };
  const sync = () => {
    uniforms.cells.value = paint.cells;
    uniforms.wet.value = paint.wet;
  };
  return { group, mesh, uniforms, setGround, sync };
}
