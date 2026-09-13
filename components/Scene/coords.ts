/**
 * Sim frame  -> three.js frame.
 * Sim: x right, y away from the viewer, z up (cm).
 * three: x right, y up, z toward the viewer.
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
