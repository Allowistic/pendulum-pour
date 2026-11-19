import * as THREE from "three";

// Ported from Adam Chernick's Codevember 2026 Day 18 "Pendulum" (MIT), 18-pendulum/pendulum.ts:
// https://github.com/acher249/codevember-2026/tree/main/18-pendulum
// Changes here: plain three.js (WebGL) instead of three/webgpu, a pivot per pendulum so several cans can hang side by
// side, a colour carried by every parcel (for the stacked, colour-shifting pour), an automatic toss, and a refill on
// every throw.
//
// The can hangs from a rope tied to a beam overhead: a spherical pendulum, the rope's end kept on a sphere round the
// pivot each step, so a push sideways makes an ellipse that turns slowly about itself and shrinks as the air slows it, the
// way a real one draws a spirograph. Paint runs from a hole in the can's base by Torricelli's law, faster the fuller the
// can, falling as a stream of small parcels each carrying its share of the flow.

export const CANVAS = 1.4;
export const FACE = 0.124;
export const STRETCHER = 0.022;
export const STAND = FACE - STRETCHER;
export const PIVOT_Y = 2.75;
export const ROPE = 2.06;
export const CAN = { radius: 0.085, height: 0.19, bail: 0.04 };

export type VesselName = "can" | "three" | "five" | "slot";
export type Vessel = { top: number; bottom: number; height: number; bail: number; holes: number; ring: number; slot?: number; share?: number };
export const VESSELS: Record<VesselName, Vessel> = {
  can: { top: CAN.radius, bottom: CAN.radius, height: CAN.height, bail: CAN.bail, holes: 1, ring: 0 },
  three: { top: 0.15, bottom: 0.13, height: 0.24, bail: 0.08, holes: 3, ring: 0.085 },
  five: { top: 0.19, bottom: 0.165, height: 0.305, bail: 0.1, holes: 5, ring: 0.108 },
  slot: { top: 0.15, bottom: 0.13, height: 0.24, bail: 0.08, holes: 1, ring: 0, slot: 0.12, share: 4 }
};

const DONE = 0.14;
const G = 9.81;
export const STEP = 1 / 240;

export type Parcel = { p: THREE.Vector3; v: THREE.Vector3; volume: number; born: number; alive: boolean; stream: number; axis: THREE.Vector3; colour: THREE.Color };
export type Landing = { x: number; z: number; volume: number; vx: number; vz: number; ax: number; az: number; r: number; g: number; b: number };

export class Pendulum {
  pivot: THREE.Vector3;
  end: THREE.Vector3;
  velocity = new THREE.Vector3();
  held = false;
  level = 1;
  hole = 8.8e-6;
  vessel: Vessel = VESSELS.can;
  turn = 0;
  spin = 0;
  canvasTurn = 0;
  canvasSpin = 0;
  finished = false;
  waiting = true;
  paused = false;
  target = new THREE.Vector3();
  drag = 0.035;
  parcels: Parcel[] = [];
  landings: Landing[] = [];
  time = 0;
  // Seconds of paint poured since the page opened: which layer of the stack is running out of the hole.
  poured = 0;
  // The colour leaving the hole now (linear), set by the app before each update.
  colourAt: (p: Pendulum, out: THREE.Color) => THREE.Color = (_p, out) => out.setRGB(0.1, 0.3, 0.8);
  private carry = 0;
  private sinceParcel = 0;
  private trail: { t: number; p: THREE.Vector3 }[] = [];
  private pour = new THREE.Color();

  constructor(pivot: THREE.Vector3, capacity = 2600) {
    this.pivot = pivot.clone();
    this.end = new THREE.Vector3(pivot.x, pivot.y - ROPE, pivot.z);
    for (let i = 0; i < capacity; i++) this.parcels.push({ p: new THREE.Vector3(), v: new THREE.Vector3(), volume: 0, born: 0, alive: false, stream: 0, axis: new THREE.Vector3(), colour: new THREE.Color() });
  }

  get drop() {
    return this.vessel.bail + this.vessel.height;
  }

  nozzle(out: THREE.Vector3) {
    return out.subVectors(this.end, this.pivot).normalize().multiplyScalar(this.drop).add(this.end);
  }

  frame(x: THREE.Vector3, y: THREE.Vector3, z: THREE.Vector3) {
    y.subVectors(this.pivot, this.end).normalize();
    const e1 = scratch.g.crossVectors(y, Z).normalize();
    const e2 = scratch.h.crossVectors(y, e1);
    x.copy(e1).multiplyScalar(Math.cos(this.turn)).addScaledVector(e2, Math.sin(this.turn));
    z.crossVectors(x, y);
  }

  holeAt(k: number, out: THREE.Vector3) {
    const { x, y, z } = axes;
    this.frame(x, y, z);
    const a = (k / this.vessel.holes) * Math.PI * 2;
    return this.nozzle(out).addScaledVector(x, Math.cos(a) * this.vessel.ring).addScaledVector(z, Math.sin(a) * this.vessel.ring);
  }

  get reach() {
    const x = this.end.x - this.pivot.x;
    const z = this.end.z - this.pivot.z;
    const v2 = this.velocity.x * this.velocity.x + this.velocity.z * this.velocity.z;
    return Math.sqrt(x * x + z * z + (v2 * ROPE) / G);
  }

  get pouring() {
    return !this.held && !this.waiting && !this.finished && !this.paused && this.level > 0;
  }

  hold(toward: THREE.Vector3) {
    const d = scratch.a.subVectors(toward, this.pivot);
    if (d.y > -0.2) d.y = -0.2;
    d.normalize();
    const most = Math.cos(THREE.MathUtils.degToRad(55));
    if (-d.y < most) {
      const flat = Math.hypot(d.x, d.z) || 1;
      const s = Math.sqrt(1 - most * most) / flat;
      d.set(d.x * s, -most, d.z * s);
    }
    this.target.copy(this.pivot).addScaledVector(d, ROPE);
  }

  release() {
    this.held = false;
    this.finished = false;
    const first = this.trail[0];
    const last = this.trail[this.trail.length - 1];
    if (first && last && last.t > first.t) {
      this.velocity.subVectors(last.p, first.p).divideScalar(last.t - first.t);
      const radial = scratch.a.subVectors(this.end, this.pivot).normalize();
      this.velocity.addScaledVector(radial, -this.velocity.dot(radial));
      const speed = this.velocity.length();
      if (speed > 3.2) this.velocity.multiplyScalar(3.2 / speed);
    }
    this.trail.length = 0;
    this.waiting = this.reach < DONE;
    if (!this.waiting) this.level = 1;
    return !this.waiting;
  }

  // Added: a toss without a hand, for auto-pour and the Throw button. Pulled out to `angle` degrees at a random bearing
  // and let go with a sideways push, a fraction `round` of what would carry it round in a circle, so it draws an ellipse.
  toss(angle: number, round: number, bearing = Math.random() * Math.PI * 2, way = Math.random() < 0.5 ? -1 : 1) {
    const th = THREE.MathUtils.degToRad(angle);
    const dir = scratch.a.set(Math.sin(th) * Math.cos(bearing), -Math.cos(th), Math.sin(th) * Math.sin(bearing));
    this.end.copy(this.pivot).addScaledVector(dir, ROPE);
    const r = ROPE * Math.sin(th);
    const circle = Math.sqrt(G * r * Math.tan(th));
    this.velocity.set(-Math.sin(bearing), 0, Math.cos(bearing)).multiplyScalar(circle * round * way);
    const radial = scratch.b.subVectors(this.end, this.pivot).normalize();
    this.velocity.addScaledVector(radial, -this.velocity.dot(radial));
    this.held = false;
    this.waiting = false;
    this.finished = false;
    this.trail.length = 0;
    this.level = 1;
  }

  rest() {
    for (const parcel of this.parcels) parcel.alive = false;
    this.waiting = true;
    this.finished = false;
    this.held = false;
    const out = scratch.a.set(0.07, 0, 0);
    out.y = -Math.sqrt(ROPE * ROPE - out.x * out.x);
    this.end.copy(this.pivot).add(out);
    this.velocity.set(0, 0, 0.07 * Math.sqrt(G / ROPE) * 0.55);
  }

  grab() {
    this.held = true;
    this.trail.length = 0;
    this.target.copy(this.end);
  }

  private swing(dt: number, end = this.end, velocity = this.velocity) {
    velocity.y -= G * dt;
    if (!this.waiting) velocity.multiplyScalar(1 - this.drag * dt);
    end.addScaledVector(velocity, dt);
    const r = scratch.b.subVectors(end, this.pivot);
    r.multiplyScalar(ROPE / r.length());
    end.copy(this.pivot).add(r);
    r.normalize();
    velocity.addScaledVector(r, -velocity.dot(r));
  }

  predict(seconds: number, every: number, out: THREE.Vector3[]) {
    const end = scratch.c.copy(this.end);
    const velocity = scratch.d.set(0, 0, 0);
    const first = this.trail[0];
    const last = this.trail[this.trail.length - 1];
    if (first && last && last.t > first.t) velocity.subVectors(last.p, first.p).divideScalar(last.t - first.t);
    let n = 0;
    const steps = Math.round(seconds / STEP);
    for (let k = 0; k < steps && n < out.length; k++) {
      this.swing(STEP, end, velocity);
      if (k % every === 0) out[n++].subVectors(end, this.pivot).normalize().multiplyScalar(this.drop).add(end);
    }
    return n;
  }

  update(delta: number) {
    this.landings.length = 0;
    this.carry = Math.min(this.carry + delta, STEP * 40);
    const nozzle = scratch.e;
    while (this.carry >= STEP) {
      this.carry -= STEP;
      this.time += STEP;
      if (!this.held) this.swing(STEP);
      else {
        this.end.lerp(this.target, 1 - Math.exp(-STEP * 14));
        this.end.sub(this.pivot).setLength(ROPE).add(this.pivot);
        this.velocity.set(0, 0, 0);
        this.trail.push({ t: this.time, p: this.end.clone() });
        while (this.trail.length > 2 && this.time - this.trail[0].t > 0.12) this.trail.shift();
      }
      this.turn += this.spin * STEP;
      this.canvasTurn += this.canvasSpin * STEP;
      if (!this.held && !this.waiting && !this.finished && this.reach < DONE) this.finished = true;
      const vessel = this.vessel;
      const depth = this.level * vessel.height * 0.85;
      const out = Math.sqrt(2 * G * Math.max(depth, 0));
      const flow = this.pouring ? this.hole * out * (vessel.share ?? 1) : 0;
      this.sinceParcel += STEP;
      if (flow > 0 && this.sinceParcel >= STEP) {
        this.sinceParcel = 0;
        this.poured += STEP;
        const colour = this.colourAt(this, this.pour);
        const along = scratch.f.subVectors(this.pivot, this.end).normalize().negate();
        const wide = (vessel.top + vessel.bottom) / 2;
        for (let k = 0; k < vessel.holes; k++) {
          const parcel = this.free();
          if (!parcel) break;
          this.holeAt(k, nozzle);
          parcel.p.copy(nozzle);
          const off = scratch.a.copy(nozzle).sub(this.nozzle(scratch.b));
          parcel.v.copy(this.velocity).addScaledVector(along, out * 0.6).add(scratch.b.crossVectors(along, off).multiplyScalar(-this.spin));
          parcel.volume = flow * STEP;
          parcel.born = this.time;
          parcel.alive = true;
          parcel.stream = k;
          parcel.colour.copy(colour);
          parcel.axis.set(0, 0, 0);
          if (vessel.slot) {
            this.frame(parcel.axis, scratch.a, scratch.b);
            parcel.axis.multiplyScalar(vessel.slot / 2);
          }
          this.level = Math.max(0, this.level - parcel.volume / (Math.PI * wide * wide * vessel.height * 0.85));
        }
      }
      for (const parcel of this.parcels) {
        if (!parcel.alive) continue;
        parcel.v.y -= G * STEP;
        parcel.p.addScaledVector(parcel.v, STEP);
        const local = scratch.c.copy(parcel.p).applyAxisAngle(Y, -this.canvasTurn);
        const onCanvas = Math.abs(local.x) < CANVAS / 2 + 0.01 && Math.abs(local.z) < CANVAS / 2 + 0.01;
        if (parcel.p.y <= (onCanvas ? FACE : 0)) {
          parcel.alive = false;
          if (onCanvas) {
            const moving = scratch.d.set(parcel.v.x - this.canvasSpin * parcel.p.z, 0, parcel.v.z + this.canvasSpin * parcel.p.x).applyAxisAngle(Y, -this.canvasTurn);
            const axis = scratch.e.copy(parcel.axis).setY(0).applyAxisAngle(Y, -this.canvasTurn);
            const c = parcel.colour;
            this.landings.push({ x: local.x, z: local.z, volume: parcel.volume, vx: moving.x, vz: moving.z, ax: axis.x, az: axis.z, r: c.r, g: c.g, b: c.b });
          }
        }
      }
    }
  }

  private cursor = 0;
  private free() {
    const n = this.parcels.length;
    for (let i = 0; i < n; i++) {
      const parcel = this.parcels[(this.cursor + i) % n];
      if (!parcel.alive) {
        this.cursor = (this.cursor + i + 1) % n;
        return parcel;
      }
    }
    return undefined;
  }

  get speed() {
    return this.velocity.length();
  }
}

const scratch = { a: new THREE.Vector3(), b: new THREE.Vector3(), c: new THREE.Vector3(), d: new THREE.Vector3(), e: new THREE.Vector3(), f: new THREE.Vector3(), g: new THREE.Vector3(), h: new THREE.Vector3() };
const axes = { x: new THREE.Vector3(), y: new THREE.Vector3(), z: new THREE.Vector3() };
const Y = new THREE.Vector3(0, 1, 0);
const Z = new THREE.Vector3(0, 0, 1);
