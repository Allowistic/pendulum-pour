import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { CANVAS, PIVOT_Y, ROPE, Pendulum, VESSELS, type VesselName } from "./pendulum";
import { createPaint, type Drop } from "./paint";
import { createCanvas } from "./canvas";

// Pendulum Pour: Adam Chernick's Codevember 2026 Day 18 "Pendulum" (MIT) rebuilt as one offline WebGL2 page, with a
// stacked, colour-shifting pour from up to three cans, and the canvas usable as a background: saved as a PNG at
// wallpaper sizes, or run full screen as a live background.

// ---------- settings ----------
type Settings = {
  layers: number;
  palette: string;
  layerSeconds: number;
  shift: number;
  cans: number;
  vessel: VesselName;
  ground: string;
  speed: number;
  auto: boolean;
};
const DEFAULTS: Settings = { layers: 5, palette: "graffiti", layerSeconds: 3, shift: 0.5, cans: 2, vessel: "can", ground: "black", speed: 1, auto: true };
const KEY = "pendulum-pour-settings-v1";
const settings: Settings = { ...DEFAULTS };
try {
  Object.assign(settings, JSON.parse(localStorage.getItem(KEY) || "{}"));
} catch {
  /* first visit */
}
const params = new URLSearchParams(location.search);
const save = () => {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    /* private mode */
  }
};

export const PALETTES: Record<string, { label: string; colours: string[] }> = {
  graffiti: { label: "Spray fade", colours: ["#ffe14d", "#ff9b21", "#e8341c", "#8e2bd1", "#19c7e0", "#f5f1e6"] },
  studio: { label: "Studio (original)", colours: ["#efe8da", "#b3122a", "#f2a516", "#1f4fd1", "#41c9a0", "#ff4f8a"] },
  sunset: { label: "Sunset", colours: ["#ffd23f", "#ff8c42", "#ff3c38", "#a23b72", "#3b1f5c"] },
  ocean: { label: "Ocean", colours: ["#e0fbfc", "#98c1d9", "#2ec4b6", "#3d5a80", "#1b2a41"] },
  neon: { label: "Neon", colours: ["#f72585", "#b5179e", "#7209b7", "#4361ee", "#4cc9f0", "#f9f871"] },
  earth: { label: "Earth", colours: ["#f2e8cf", "#dda15e", "#bc6c25", "#606c38", "#283618"] }
};
if (!PALETTES[settings.palette]) settings.palette = DEFAULTS.palette;
if (!VESSELS[settings.vessel]) settings.vessel = DEFAULTS.vessel;

// A seeded random, so a test run (?seed=) throws the same way every time.
let seed = Number(params.get("seed")) || Math.floor(Math.random() * 1e9);
const random = () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

// ---------- renderer and scene ----------
const light = /OculusBrowser|Quest|Android|iPhone|iPad|Mobile/i.test(navigator.userAgent) || params.get("quality") === "low";
const N = params.get("quality") === "high" ? 640 : light ? 288 : 448;
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: false, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, light ? 1.5 : 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NoToneMapping;
document.getElementById("app")!.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const BG = new THREE.Color("#17171a");
scene.background = BG;
scene.fog = new THREE.Fog(BG, 6, 14);
const camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.05, 40);
camera.position.set(0, 2.05, 2.35);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0.32, 0);
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI * 0.49;
controls.minDistance = 0.6;
controls.maxDistance = 6;
controls.update();

scene.add(new THREE.HemisphereLight(0xdfe6ff, 0x2a241e, 1.1));
const sun = new THREE.DirectionalLight(0xfff1e2, 2.0);
sun.position.set(-2, 4.5, 3);
scene.add(sun);

const floor = new THREE.Mesh(new THREE.PlaneGeometry(30, 30).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: "#55524d", roughness: 0.92 }));
scene.add(floor);
// Spatter on the floor round the canvas: a cheap texture of old drips.
{
  const c = document.createElement("canvas");
  c.width = c.height = 512;
  const g = c.getContext("2d")!;
  g.fillStyle = "#55524d";
  g.fillRect(0, 0, 512, 512);
  const old = ["#8a1a26", "#c08a2a", "#2a4594", "#3d9a7e", "#c24a74", "#d9d2c3", "#1c1c1c"];
  for (let k = 0; k < 900; k++) {
    const x = random() * 512, y = random() * 512;
    const d = Math.hypot(x - 256, y - 256);
    if (d < 70 || random() > 1.4 - d / 256) continue;
    g.fillStyle = old[Math.floor(random() * old.length)];
    g.globalAlpha = 0.25 + random() * 0.4;
    g.beginPath();
    g.arc(x, y, 0.6 + random() * 2.6, 0, Math.PI * 2);
    g.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const spatter = new THREE.Mesh(new THREE.PlaneGeometry(5, 5).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9, transparent: true }));
  spatter.position.y = 0.001;
  scene.add(spatter);
}

const paint = createPaint(renderer, N, CANVAS);
const canvas = createCanvas(paint);
scene.add(canvas.group);
canvas.setGround(settings.ground);

// The beam the ropes hang from.
const steel = new THREE.MeshStandardMaterial({ color: "#2c2c2e", roughness: 0.5, metalness: 0.7 });
const beam = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.08, 0.08), steel);
beam.position.set(0, PIVOT_Y + 0.04, 0);
scene.add(beam);
for (const x of [-1.05, 1.05]) {
  const post = new THREE.Mesh(new THREE.BoxGeometry(0.06, PIVOT_Y + 0.08, 0.06), steel);
  post.position.set(x, (PIVOT_Y + 0.08) / 2, 0);
  scene.add(post);
}

// ---------- cans ----------
const dot = (() => {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.6, "rgba(255,255,255,1)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
})();

type Rig = {
  p: Pendulum;
  index: number;
  group: THREE.Group;
  body: THREE.Mesh;
  top: THREE.Mesh;
  topMaterial: THREE.MeshStandardMaterial;
  rope: THREE.Line;
  points: THREE.Points;
  positions: Float32Array;
  colours: Float32Array;
  idle: number;
};
const rigs: Rig[] = [];
const tin = new THREE.MeshStandardMaterial({ color: "#b9b6ae", roughness: 0.35, metalness: 0.85 });
const ropeMaterial = new THREE.LineBasicMaterial({ color: "#c9c1ad" });
const pointMaterial = new THREE.PointsMaterial({ size: 0.014, vertexColors: true, map: dot, alphaTest: 0.5, sizeAttenuation: true, transparent: false });

function pivots(n: number) {
  if (n === 1) return [new THREE.Vector3(0, PIVOT_Y, 0)];
  if (n === 2) return [new THREE.Vector3(-0.32, PIVOT_Y, 0), new THREE.Vector3(0.32, PIVOT_Y, 0)];
  return [new THREE.Vector3(-0.42, PIVOT_Y, 0), new THREE.Vector3(0, PIVOT_Y, 0), new THREE.Vector3(0.42, PIVOT_Y, 0)];
}

function buildCan(group: THREE.Group, vessel: VesselName, topMaterial: THREE.MeshStandardMaterial) {
  group.clear();
  const v = VESSELS[vessel];
  const body = new THREE.Mesh(new THREE.CylinderGeometry(v.top, v.bottom, v.height, 32, 1, true), tin);
  body.position.y = -(v.bail + v.height / 2);
  (tin as THREE.MeshStandardMaterial).side = THREE.DoubleSide;
  const base = new THREE.Mesh(new THREE.CircleGeometry(v.bottom, 32).rotateX(Math.PI / 2), tin);
  base.position.y = -(v.bail + v.height);
  const top = new THREE.Mesh(new THREE.CircleGeometry(v.top * 0.97, 32).rotateX(-Math.PI / 2), topMaterial);
  top.position.y = -(v.bail + v.height * 0.12);
  // The bail: a wire arch from the rope's end down to the rim.
  const bailPts: THREE.Vector3[] = [];
  for (let k = 0; k <= 16; k++) {
    const a = (k / 16) * Math.PI;
    bailPts.push(new THREE.Vector3(Math.cos(a) * v.top, -v.bail * Math.sin(a) * 0 - v.bail * (1 - Math.sin(a)), 0));
  }
  const bail = new THREE.Line(new THREE.BufferGeometry().setFromPoints(bailPts), ropeMaterial);
  group.add(body, base, top, bail);
  return { body, top };
}

function makeRigs() {
  for (const r of rigs) {
    scene.remove(r.group, r.rope, r.points);
    r.points.geometry.dispose();
    r.rope.geometry.dispose();
  }
  rigs.length = 0;
  const capacity = light ? 1600 : 2600;
  pivots(settings.cans).forEach((pivot, index) => {
    const p = new Pendulum(pivot, capacity);
    p.vessel = VESSELS[settings.vessel];
    p.rest();
    const group = new THREE.Group();
    const topMaterial = new THREE.MeshStandardMaterial({ roughness: 0.15, color: "#ffffff" });
    const { body, top } = buildCan(group, settings.vessel, topMaterial);
    const rope = new THREE.Line(new THREE.BufferGeometry().setFromPoints([pivot, p.end]), ropeMaterial);
    const positions = new Float32Array(capacity * 3);
    const colours = new Float32Array(capacity * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute("color", new THREE.BufferAttribute(colours, 3).setUsage(THREE.DynamicDrawUsage));
    const points = new THREE.Points(geo, pointMaterial);
    points.frustumCulled = false;
    scene.add(group, rope, points);
    const rig: Rig = { p, index, group, body, top, topMaterial, rope, points, positions, colours, idle: 0.6 + index * 0.9 };
    p.colourAt = (_p, out) => colourFor(rig, out);
    rigs.push(rig);
  });
}

// ---------- the stacked, colour-shifting pour ----------
// Each can is filled with a stack of `layers` colours from the palette, one on another, each can starting further round
// the palette. As it pours, the paint leaving the hole runs down through the stack, a layer every `layerSeconds` of
// pouring, the last fifth of each layer blending into the next as a real stacked cup does, and round again. The whole
// palette also drifts round the colour wheel at `shift` turns a minute, so no pass of the swing repeats a colour.
let hue = 0;
const stackColour = new THREE.Color();
const nextColour = new THREE.Color();
function layerColour(rig: Rig, k: number, out: THREE.Color) {
  const colours = PALETTES[settings.palette].colours;
  const offset = Math.round((rig.index * colours.length) / Math.max(1, settings.cans));
  const idx = (((k % settings.layers) + settings.layers) % settings.layers + offset) % colours.length;
  out.set(colours[idx]);
  if (hue !== 0) out.offsetHSL(hue, 0, 0);
  return out;
}
function colourFor(rig: Rig, out: THREE.Color) {
  const pos = rig.p.poured / Math.max(0.2, settings.layerSeconds);
  const k = Math.floor(pos);
  const f = pos - k;
  layerColour(rig, k, stackColour);
  const blend = THREE.MathUtils.smoothstep(f, 0.8, 1);
  if (blend > 0) stackColour.lerp(layerColour(rig, k + 1, nextColour), blend);
  return out.copy(stackColour).convertSRGBToLinear();
}

// ---------- picking up and throwing a can ----------
const raycaster = new THREE.Raycaster();
raycaster.params.Line = { threshold: 0.01 };
const pointer = new THREE.Vector2();
const dragPlane = new THREE.Plane();
const hit = new THREE.Vector3();
let dragging: Rig | null = null;
function setPointer(e: PointerEvent) {
  pointer.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
}
renderer.domElement.addEventListener("pointerdown", (e) => {
  if (backgroundMode) return;
  setPointer(e);
  const hits = raycaster.intersectObjects(rigs.map((r) => r.group), true);
  if (!hits.length) return;
  const rig = rigs.find((r) => hits[0].object.parent === r.group);
  if (!rig) return;
  dragging = rig;
  controls.enabled = false;
  rig.p.grab();
  dragPlane.set(new THREE.Vector3(0, 1, 0), -rig.p.end.y);
  renderer.domElement.setPointerCapture(e.pointerId);
});
renderer.domElement.addEventListener("pointermove", (e) => {
  if (!dragging) return;
  setPointer(e);
  if (raycaster.ray.intersectPlane(dragPlane, hit)) dragging.p.hold(hit);
});
const letGo = () => {
  if (!dragging) return;
  dragging.p.release();
  dragging.idle = 0;
  dragging = null;
  controls.enabled = !backgroundMode;
};
renderer.domElement.addEventListener("pointerup", letGo);
renderer.domElement.addEventListener("pointercancel", letGo);

function toss(rig: Rig) {
  rig.p.toss(9 + random() * 10, 0.25 + random() * 0.6, random() * Math.PI * 2, random() < 0.5 ? -1 : 1);
  rig.idle = 0;
}

// ---------- simulation step ----------
let paused = params.get("paused") === "1";
let simTime = 0;
const drops: Drop[] = [];
const down = new THREE.Vector3(0, -1, 0);
const dir = new THREE.Vector3();
const DRYING = 0.13;

function simulate(delta: number) {
  const d = delta * settings.speed;
  simTime += d;
  hue = (hue + (settings.shift / 60) * d) % 1;
  drops.length = 0;
  for (const rig of rigs) {
    const p = rig.p;
    p.vessel = VESSELS[settings.vessel];
    const spinTo = settings.vessel === "can" ? 0 : -0.35 * Math.PI * 2;
    p.spin += (spinTo - p.spin) * (1 - Math.exp(-d * 6));
    if (settings.auto && !p.held) {
      const done = p.waiting || p.finished || p.level <= 0.01;
      if (done) {
        rig.idle += d;
        if (rig.idle > 1.4) toss(rig);
      } else rig.idle = 0;
    }
    p.update(d);
    for (const l of p.landings) {
      drops.push({ x: l.x, z: l.z, volume: l.volume, r: Math.sqrt(l.volume / (Math.PI * 0.012)), vx: l.vx, vz: l.vz, ax: l.ax, az: l.az, cr: l.r, cg: l.g, cb: l.b });
    }
  }
  const flows = Math.min(9, Math.max(1, Math.round((light ? 2 : 3) * settings.speed)));
  paint.u.drying.value = (DRYING * d) / flows;
  paint.step(drops, flows);
  canvas.sync();
}

function draw() {
  for (const rig of rigs) {
    const p = rig.p;
    dir.subVectors(p.end, p.pivot).normalize();
    rig.group.position.copy(p.end);
    rig.group.quaternion.setFromUnitVectors(down, dir);
    rig.group.rotateY(p.turn);
    const ropeAttr = rig.rope.geometry.getAttribute("position") as THREE.BufferAttribute;
    ropeAttr.setXYZ(0, p.pivot.x, p.pivot.y, p.pivot.z);
    ropeAttr.setXYZ(1, p.end.x, p.end.y, p.end.z);
    ropeAttr.needsUpdate = true;
    colourFor(rig, rig.topMaterial.color);
    rig.top.position.y = -(p.vessel.bail + p.vessel.height * (1 - 0.85 * Math.max(p.level, 0.05)));
    let n = 0;
    for (const parcel of p.parcels) {
      if (!parcel.alive) continue;
      rig.positions[n * 3] = parcel.p.x;
      rig.positions[n * 3 + 1] = parcel.p.y;
      rig.positions[n * 3 + 2] = parcel.p.z;
      rig.colours[n * 3] = parcel.colour.r;
      rig.colours[n * 3 + 1] = parcel.colour.g;
      rig.colours[n * 3 + 2] = parcel.colour.b;
      n++;
    }
    const geo = rig.points.geometry;
    geo.setDrawRange(0, n);
    (geo.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
    (geo.getAttribute("color") as THREE.BufferAttribute).needsUpdate = true;
  }
}

// ---------- background: live, and saved as a picture ----------
let backgroundMode = false;
const topCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 6);
topCamera.position.set(0, 3, 0);
topCamera.up.set(0, 0, -1);
topCamera.lookAt(0, 0, 0);
const hideForBackground = () => [floor, beam, ...scene.children.filter((o) => o !== canvas.group && !(o instanceof THREE.Light))];

// The camera square over the canvas, cropped to fill a w by h picture ("cover"), just inside the canvas's edge.
function frameTop(cam: THREE.OrthographicCamera, w: number, h: number) {
  const half = (CANVAS / 2) * 0.975;
  let hw = half, hh = half;
  if (w >= h) hh = (half * h) / w;
  else hw = (half * w) / h;
  cam.left = -hw;
  cam.right = hw;
  cam.top = hh;
  cam.bottom = -hh;
  cam.updateProjectionMatrix();
}

function withCanvasOnly<T>(fn: () => T): T {
  const hidden = hideForBackground();
  const shown = hidden.map((o) => o.visible);
  hidden.forEach((o) => (o.visible = false));
  canvas.group.children.forEach((o, k) => k > 0 && (o.visible = false));
  const bg = scene.background;
  const fog = scene.fog;
  scene.fog = null;
  try {
    return fn();
  } finally {
    hidden.forEach((o, k) => (o.visible = shown[k]));
    canvas.group.children.forEach((o) => (o.visible = true));
    scene.background = bg;
    scene.fog = fog;
  }
}

export const SIZES: { id: string; label: string; w: number; h: number }[] = [
  { id: "phone", label: "Phone (1170 × 2532)", w: 1170, h: 2532 },
  { id: "desktop4k", label: "Desktop 4K (3840 × 2160)", w: 3840, h: 2160 },
  { id: "desktop", label: "Desktop HD (1920 × 1080)", w: 1920, h: 1080 },
  { id: "square", label: "Square (2048 × 2048)", w: 2048, h: 2048 },
  { id: "window", label: "This window", w: 0, h: 0 }
];

// Render the canvas straight down, evenly lit, at w by h, and return it as a 2D canvas.
function renderBackground(w: number, h: number) {
  const max = Math.min(renderer.capabilities.maxTextureSize, 4096);
  const scale = Math.min(1, max / Math.max(w, h));
  w = Math.round(w * scale);
  h = Math.round(h * scale);
  const target = new THREE.WebGLRenderTarget(w, h, { type: THREE.UnsignedByteType, samples: 0, depthBuffer: true });
  target.texture.colorSpace = THREE.SRGBColorSpace;
  const cam = topCamera.clone();
  frameTop(cam, w, h);
  canvas.uniforms.snapshot.value = 1;
  const pixels = new Uint8Array(w * h * 4);
  withCanvasOnly(() => {
    const before = renderer.getRenderTarget();
    renderer.setRenderTarget(target);
    renderer.setClearColor(0x000000, 1);
    renderer.clear();
    renderer.render(scene, cam);
    renderer.readRenderTargetPixels(target, 0, 0, w, h, pixels);
    renderer.setRenderTarget(before);
  });
  canvas.uniforms.snapshot.value = 0;
  target.dispose();
  const out = document.createElement("canvas");
  out.width = w;
  out.height = h;
  const g = out.getContext("2d")!;
  const image = g.createImageData(w, h);
  // Rows come back bottom first.
  const row = w * 4;
  for (let y = 0; y < h; y++) image.data.set(pixels.subarray((h - 1 - y) * row, (h - y) * row), y * row);
  for (let i = 3; i < image.data.length; i += 4) image.data[i] = 255;
  g.putImageData(image, 0, 0);
  return out;
}

async function saveBackground(id: string) {
  const size = SIZES.find((s) => s.id === id) ?? SIZES[0];
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = size.w || Math.round(window.innerWidth * dpr);
  const h = size.h || Math.round(window.innerHeight * dpr);
  status("Saving background…");
  await new Promise((r) => requestAnimationFrame(r));
  const out = renderBackground(w, h);
  const blob = await new Promise<Blob | null>((resolve) => out.toBlob(resolve, "image/png"));
  if (!blob) {
    status("Could not save the picture");
    return null;
  }
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `pendulum-pour-${out.width}x${out.height}-${Date.now()}.png`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 8000);
  status(`Saved ${out.width} × ${out.height} PNG`);
  return { width: out.width, height: out.height, bytes: blob.size };
}

function setBackgroundMode(on: boolean) {
  backgroundMode = on;
  document.body.classList.toggle("bg-mode", on);
  controls.enabled = !on;
  if (on && !settings.auto) {
    settings.auto = true;
    syncUi();
  }
}

// ---------- UI ----------
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
let statusTimer = 0;
function status(text: string) {
  const el = $("status");
  el.textContent = text;
  el.classList.add("show");
  window.clearTimeout(statusTimer);
  statusTimer = window.setTimeout(() => el.classList.remove("show"), 2600);
}

function syncUi() {
  ($("layers") as HTMLInputElement).value = String(settings.layers);
  $("layersOut").textContent = String(settings.layers);
  ($("palette") as HTMLSelectElement).value = settings.palette;
  ($("layerSeconds") as HTMLInputElement).value = String(settings.layerSeconds);
  $("layerSecondsOut").textContent = `${settings.layerSeconds.toFixed(1)} s`;
  ($("shift") as HTMLInputElement).value = String(settings.shift);
  $("shiftOut").textContent = settings.shift === 0 ? "off" : `${settings.shift.toFixed(2)} turns/min`;
  ($("cans") as HTMLSelectElement).value = String(settings.cans);
  ($("vessel") as HTMLSelectElement).value = settings.vessel;
  ($("ground") as HTMLSelectElement).value = settings.ground;
  ($("speed") as HTMLInputElement).value = String(settings.speed);
  $("speedOut").textContent = `${settings.speed.toFixed(2)}×`;
  ($("auto") as HTMLInputElement).checked = settings.auto;
  $("pause").textContent = paused ? "Play" : "Pause";
}

function buildUi() {
  const pal = $("palette") as HTMLSelectElement;
  for (const [id, p] of Object.entries(PALETTES)) pal.add(new Option(p.label, id));
  const sizes = $("sizes");
  for (const s of SIZES) {
    const b = document.createElement("button");
    b.textContent = s.label;
    b.dataset.size = s.id;
    b.onclick = () => {
      sizes.classList.remove("open");
      void saveBackground(s.id);
    };
    sizes.appendChild(b);
  }
  const range = (id: keyof Settings, parse = Number) =>
    ($(id) as HTMLInputElement).addEventListener("input", (e) => {
      (settings as Record<string, unknown>)[id] = parse((e.target as HTMLInputElement).value);
      save();
      syncUi();
    });
  range("layers");
  range("layerSeconds");
  range("shift");
  range("speed");
  pal.addEventListener("change", () => {
    settings.palette = pal.value;
    save();
  });
  ($("cans") as HTMLSelectElement).addEventListener("change", (e) => {
    settings.cans = Number((e.target as HTMLSelectElement).value);
    save();
    makeRigs();
  });
  ($("vessel") as HTMLSelectElement).addEventListener("change", (e) => {
    settings.vessel = (e.target as HTMLSelectElement).value as VesselName;
    save();
    makeRigs();
  });
  ($("ground") as HTMLSelectElement).addEventListener("change", (e) => {
    settings.ground = (e.target as HTMLSelectElement).value;
    canvas.setGround(settings.ground);
    save();
  });
  ($("auto") as HTMLInputElement).addEventListener("change", (e) => {
    settings.auto = (e.target as HTMLInputElement).checked;
    save();
  });
  $("pause").onclick = () => {
    paused = !paused;
    syncUi();
  };
  $("reset").onclick = () => reset();
  $("throw").onclick = () => rigs.forEach((r) => toss(r));
  $("save").onclick = () => sizes.classList.toggle("open");
  $("live").onclick = () => setBackgroundMode(true);
  $("exitBg").onclick = () => setBackgroundMode(false);
  $("toggle").onclick = () => document.body.classList.toggle("panel-closed");
  $("defaults").onclick = () => {
    Object.assign(settings, DEFAULTS);
    save();
    canvas.setGround(settings.ground);
    makeRigs();
    syncUi();
  };
  window.addEventListener("keydown", (e) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
    if (e.key === "Escape" && backgroundMode) setBackgroundMode(false);
    else if (e.key === " ") {
      paused = !paused;
      syncUi();
      e.preventDefault();
    } else if (e.key === "b" || e.key === "B") setBackgroundMode(!backgroundMode);
    else if (e.key === "t" || e.key === "T") rigs.forEach((r) => toss(r));
    else if (e.key === "r" || e.key === "R") reset();
  });
  syncUi();
}

function reset() {
  paint.clear();
  canvas.sync();
  hue = 0;
  simTime = 0;
  for (const r of rigs) {
    r.p.rest();
    r.p.poured = 0;
    r.idle = 0.6 + r.index * 0.9;
  }
  renderer.setClearColor(BG, 1);
}

// The stack strip: each can's colours, the one pouring now marked.
function drawStack() {
  const el = $("stack");
  let html = "";
  const c = new THREE.Color();
  for (const rig of rigs) {
    const now = Math.floor(rig.p.poured / Math.max(0.2, settings.layerSeconds)) % settings.layers;
    html += `<div class="can-stack"><span>Can ${rig.index + 1}</span>`;
    for (let k = 0; k < settings.layers; k++) {
      layerColour(rig, k, c);
      html += `<i style="background:#${c.getHexString()}" class="${k === now ? "now" : ""}"></i>`;
    }
    html += "</div>";
  }
  el.innerHTML = html;
}

// ---------- loop ----------
function resize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}
window.addEventListener("resize", resize);

const timer = new THREE.Timer();
timer.connect(document);
let stackTimer = 0;
function frame() {
  timer.update();
  const raw = Math.min(timer.getDelta(), 1 / 20);
  if (!paused) simulate(raw);
  draw();
  controls.update();
  stackTimer += raw;
  if (stackTimer > 0.25) {
    stackTimer = 0;
    drawStack();
  }
  if (backgroundMode) {
    frameTop(topCamera, window.innerWidth, window.innerHeight);
    withCanvasOnly(() => renderer.render(scene, topCamera));
  } else renderer.render(scene, camera);
}

buildUi();
makeRigs();
renderer.setClearColor(BG, 1);
if (params.get("background") === "1") setBackgroundMode(true);
renderer.setAnimationLoop(frame);

// For tests: run the simulation ahead without waiting for frames, and save a background without a download.
Object.assign(window as unknown as Record<string, unknown>, {
  __pour: {
    settings,
    rigs,
    paint,
    advance(seconds: number, dt = 1 / 60) {
      for (let t = 0; t < seconds; t += dt) simulate(dt);
      draw();
      return simTime;
    },
    get time() {
      return simTime;
    },
    get hue() {
      return hue;
    },
    exportDataUrl(w: number, h: number) {
      return renderBackground(w, h).toDataURL("image/png");
    },
    saveBackground,
    setBackgroundMode,
    setPaused(v: boolean) {
      paused = v;
      syncUi();
    },
    reset
  }
});
