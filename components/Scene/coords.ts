/**
 * Sim frame  -> three.js frame, plus the smoothing primitives the scene uses.
 * Sim: x right, y away from the viewer, z up (cm).
 * three: x right, y up, z toward the viewer.
 *
 * Everything in here is allocation-free once constructed: `Spring` instances are
 * created in refs and mutated in place, so `useFrame` never allocates.
 */
import type { Vec2 } from "@/lib/types";

export function toThree(p: Vec2, z = 0): [number, number, number] {
  return [p.x, z, -p.y];
}

/** Frame-rate independent exponential smoothing factor. */
export function damp(dt: number, rate = 12): number {
  return 1 - Math.exp(-dt * rate);
}

export function approach(current: number, target: number, k: number): number {
  return current + (target - current) * k;
}

export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

// --- easings ---------------------------------------------------------------

export function easeInQuad(t: number): number {
  return t * t;
}

export function easeOutCubic(t: number): number {
  const u = 1 - t;
  return 1 - u * u * u;
}

export function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

// --- damped spring ---------------------------------------------------------

/** Longest integration step; anything bigger is sub-stepped so the spring stays stable. */
const MAX_STEP = 1 / 120;
/** Never integrate more than this much wall time in one frame. */
const MAX_FRAME = 1 / 12;
/**
 * A frame longer than this means rendering actually stalled (hidden tab, a long
 * task, a hot reload) while the 20 Hz sim kept running. Chasing the backlog at
 * MAX_FRAME per frame would visibly crawl for seconds, so snap instead.
 */
const STALL = 0.25;

/**
 * Scalar damped spring.
 * `zeta === 1` is critically damped (no overshoot), `zeta < 1` overshoots and settles —
 * which is what gives the gantry its little arrival wobble.
 */
export class Spring {
  value: number;
  velocity = 0;
  omega: number;
  zeta: number;

  constructor(value = 0, omega = 18, zeta = 1) {
    this.value = value;
    this.omega = omega;
    this.zeta = zeta;
  }

  /** Jump straight to a value (used on mount / reset) without any motion. */
  reset(value: number): void {
    this.value = value;
    this.velocity = 0;
  }

  step(target: number, dt: number): number {
    if (dt > STALL) {
      this.reset(target);
      return this.value;
    }
    let remaining = dt > MAX_FRAME ? MAX_FRAME : dt;
    const w = this.omega;
    const z = this.zeta;
    while (remaining > 0) {
      const h = remaining > MAX_STEP ? MAX_STEP : remaining;
      remaining -= h;
      const accel = w * w * (target - this.value) - 2 * z * w * this.velocity;
      this.velocity += accel * h;
      this.value += this.velocity * h;
    }
    return this.value;
  }

  /** Tune the response in place (no allocation). */
  tune(omega: number, zeta: number): this {
    this.omega = omega;
    this.zeta = zeta;
    return this;
  }
}

/** Three springs that share a response, for a position. */
export class Spring3 {
  readonly x: Spring;
  readonly y: Spring;
  readonly z: Spring;

  constructor(x = 0, y = 0, z = 0, omega = 18, zeta = 1) {
    this.x = new Spring(x, omega, zeta);
    this.y = new Spring(y, omega, zeta);
    this.z = new Spring(z, omega, zeta);
  }

  reset(x: number, y: number, z: number): void {
    this.x.reset(x);
    this.y.reset(y);
    this.z.reset(z);
  }

  tune(omega: number, zeta: number): this {
    this.x.tune(omega, zeta);
    this.y.tune(omega, zeta);
    this.z.tune(omega, zeta);
    return this;
  }

  step(tx: number, ty: number, tz: number, dt: number): void {
    this.x.step(tx, dt);
    this.y.step(ty, dt);
    this.z.step(tz, dt);
  }
}
