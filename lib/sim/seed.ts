/**
 * Deterministic seeded RNG for the Earshot simulation.
 * mulberry32 — tiny, fast, good enough statistically, identical in node and browsers.
 */

export type Rng = () => number;

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return function next(): number {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Uniform float in [min, max). */
export function randRange(rng: Rng, min: number, max: number): number {
  return min + rng() * (max - min);
}

/** Uniform float in [-amount, amount]. */
export function randSigned(rng: Rng, amount: number): number {
  return (rng() * 2 - 1) * amount;
}

/** Derive a second, independent stream from a seed (so layout draws never shift runtime draws). */
export function deriveSeed(seed: number, salt: number): number {
  return (Math.imul(seed ^ salt, 0x9e3779b1) ^ (seed >>> 3)) >>> 0;
}
