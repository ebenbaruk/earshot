/**
 * The gripper's *rendered* transform, shared by the whole scene.
 *
 * The engine publishes a 20 Hz pose; the scene smooths it with springs. Anything
 * that has to look attached to the hand (the object it is holding, the ghost
 * trail, the landing pool) must read the SAME smoothed numbers — a second set of
 * springs, however well tuned, drifts out of phase while the carriage is moving
 * and the held object visibly floats out of the fingers.
 *
 * `stepHand` is idempotent within a frame: every consumer calls it with the
 * frame's clock time and only the first call integrates. That removes the
 * ordering problem between `SimObjects` and `Gripper` without touching
 * `useFrame` priorities (a non-zero priority would disable r3f's auto render).
 */

import type { SimObject, WorldState } from "@/lib/types";
import {
  GRIPPER_START_POS,
  GRIPPER_START_Z,
  OVER_OBJECT_MARGIN,
  effectiveSize,
} from "@/lib/sim/constants";
import { Spring } from "./coords";
import { BAG_HEIGHT, FINGER_T, bagDodgeX } from "./layout3d";

/** Half-size the bare hand presents to the bag when it is not over an object. */
const HAND_HALF_D = 6;

export interface Hand {
  /** three.js x of the finger-gap centre */
  x: number;
  /** finger-tip height above the table */
  y: number;
  /** three.js z of the finger-gap centre */
  z: number;
  /** distance from the gap centre to each finger's centre */
  half: number;
  /** clear opening between the finger pads */
  gap: number;
}

export const hand: Hand = {
  x: GRIPPER_START_POS.x,
  y: GRIPPER_START_Z,
  z: -GRIPPER_START_POS.y,
  half: 4 + FINGER_T / 2,
  gap: 8,
};

// a touch under-damped: the carriage overshoots ~1 % and settles
const sx = new Spring(hand.x, 15, 0.78);
const sz = new Spring(hand.z, 15, 0.78);
const sy = new Spring(hand.y, 19, 0.88);
const sgap = new Spring(hand.gap, 24, 1);

let lastTick = -1;

/** Object the gripper is currently over — the same test the engine uses. */
function objectUnder(w: WorldState): SimObject | null {
  const g = w.gripper.pos;
  let best: SimObject | null = null;
  let bestDist = Infinity;
  for (const o of w.objects) {
    if (o.state !== "on_table" && o.state !== "rolled_out") continue;
    const size = effectiveSize(o);
    const dx = Math.abs(g.x - o.pos.x);
    const dy = Math.abs(g.y - o.pos.y);
    if (dx > size.w / 2 + OVER_OBJECT_MARGIN) continue;
    if (dy > size.d / 2 + OVER_OBJECT_MARGIN) continue;
    const d = Math.hypot(dx, dy);
    if (d < bestDist) {
      bestDist = d;
      best = o;
    }
  }
  return best;
}

/** Where the hand's gap centre belongs in x, with the bag stepped around. */
export function handAimX(w: WorldState): number {
  const g = w.gripper;
  if (g.z >= BAG_HEIGHT) return g.pos.x;
  // Below the rim the hand walks around the pouch. When it is reaching for an
  // object that has itself been pushed clear of the pouch, it borrows that
  // object's half-size so both land on exactly the same line.
  const under = objectUnder(w);
  const size = under ? effectiveSize(under) : null;
  return bagDodgeX(
    g.pos.x,
    g.pos.y,
    size ? size.w / 2 : 0,
    size ? size.d / 2 : HAND_HALF_D,
    w.bag.pos,
  );
}

/** Integrate the hand springs once per rendered frame. Returns the shared rig. */
export function stepHand(w: WorldState, dt: number, tick: number): Hand {
  if (tick === lastTick) return hand;
  lastTick = tick;

  const g = w.gripper;
  // Fingers pinch to the object's footprint the moment it is held.
  const holding = g.holding ? w.objects.find((o) => o.id === g.holding) : undefined;
  sgap.tune(g.holding ? 34 : 24, 1);

  hand.x = sx.step(handAimX(w), dt);
  hand.z = sz.step(-g.pos.y, dt);
  hand.y = sy.step(g.z, dt);
  hand.gap = sgap.step(holding ? effectiveSize(holding).w : g.width, dt);
  hand.half = hand.gap / 2 + FINGER_T / 2;
  return hand;
}

/** Snap the hand to the world pose with no motion (mount / re-seed). */
export function resetHand(w: WorldState): void {
  const g = w.gripper;
  sx.reset(handAimX(w));
  sz.reset(-g.pos.y);
  sy.reset(g.z);
  sgap.reset(g.width);
  hand.x = sx.value;
  hand.z = sz.value;
  hand.y = sy.value;
  hand.gap = sgap.value;
  hand.half = hand.gap / 2 + FINGER_T / 2;
  lastTick = -1;
}
