/**
 * The physical layout the scene agrees on: how tall the gripper's fingers are,
 * where the inside of the bag is, and how an object rests on a surface.
 *
 * Both `Gripper` and `SimObjects` import from here so the two can never disagree
 * about where a held object hangs or how deep the bag is.
 */

import type { ObjectId, SimObject, Vec2 } from "@/lib/types";
import { BAG_DEPTH, BAG_HEIGHT, BAG_OPENING_MAX, effectiveSize } from "@/lib/sim/constants";

// --- gripper ---------------------------------------------------------------

/** Height of a finger block. The finger TIPS sit at `gripper.z`. */
export const FINGER_H = 5;
/** Finger thickness (x) and depth (z). */
export const FINGER_T = 1.2;
export const FINGER_D = 3.2;
/** Wrist block sitting directly on top of the fingers. */
export const HEAD_H = 1.8;
/** Height of the gantry rails above the table top. */
export const RAIL_Y = 25.5;

/** Top of the wrist block for a given finger-tip height. */
export function headTop(z: number): number {
  return z + FINGER_H + HEAD_H;
}

// --- bag -------------------------------------------------------------------

/** Wall thickness of the pouch. */
export const BAG_WALL = 0.55;
/** Clear opening (the sim keeps `bag.opening` at 12). */
export const BAG_INNER_W = BAG_OPENING_MAX; // 12
export const BAG_INNER_D = BAG_DEPTH - 2 * BAG_WALL;
export const BAG_OUTER_W = BAG_INNER_W + 2 * BAG_WALL;
export const BAG_OUTER_D = BAG_DEPTH;
/** Inside floor of the bag, measured from the table top. */
export const BAG_FLOOR = 0.6;
export { BAG_HEIGHT };

// --- objects ---------------------------------------------------------------

/**
 * Distance from an object's resting surface to the origin of its mesh group.
 * (The marker and the tape holder are round, so it is not simply h / 2.)
 */
export function restOffset(obj: Pick<SimObject, "id" | "size" | "compressed">): number {
  switch (obj.id) {
    case "marker":
      return 0.8; // barrel radius + cap lip
    case "tape_holder":
      return 1.3; // torus tube radius + foot
    default:
      return effectiveSize(obj).h / 2;
  }
}

/** Full visual height, used to stack items in the bag. */
export function visualHeight(obj: Pick<SimObject, "id" | "size" | "compressed">): number {
  return restOffset(obj) * 2;
}

/**
 * Nothing rests (or reaches down) closer than this to the bag centre in x.
 * The engine parks a rolled-out marker exactly 6 cm out, which is where the
 * pouch wall is; both the marker and the hand that comes back for it are
 * shifted out by the same amount so the grasp still looks centred.
 */
export const BAG_KEEPOUT = BAG_OUTER_W / 2 + 0.95;

/** How far this object has to sit from the bag centre to stay clear of it. */
export function bagKeepout(halfWidth: number): number {
  return Math.max(BAG_KEEPOUT, BAG_OUTER_W / 2 + halfWidth + 0.2);
}

/**
 * The single rule for "this would be inside the pouch, step around it".
 *
 * The engine has no idea the bag has walls, so anything the engine parks on top
 * of the bag footprint — a rolled-out marker, an item dropped next to the bag,
 * the hand reaching down for either — is pushed out to the same clear line.
 * Hand and object MUST call this with the same half-size, or the grasp stops
 * looking centred (that was the mis-positioned gripper the founder saw).
 */
export function bagDodgeX(
  x: number,
  y: number,
  halfW: number,
  halfD: number,
  bag: Vec2,
): number {
  if (Math.abs(y - bag.y) >= BAG_OUTER_D / 2 + halfD) return x;
  const clear = bagKeepout(halfW);
  const dx = x - bag.x;
  if (Math.abs(dx) >= clear) return x;
  return bag.x + (dx < 0 ? -clear : clear);
}

/** Bottom → top stacking order inside the bag, regardless of insertion order. */
export const BAG_STACK_ORDER: readonly ObjectId[] = ["marker", "tape_holder", "sponge", "egg"];

/** A small xy nudge per item so all four stay readable through the frosted wall. */
export const BAG_OFFSET: Record<ObjectId, { x: number; y: number }> = {
  marker: { x: 0, y: 0 },
  tape_holder: { x: -0.9, y: 1.1 },
  sponge: { x: 1.1, y: -1.4 },
  egg: { x: -0.5, y: -0.2 },
};

/** Slight yaw inside the bag so the stack doesn't read as a machine-perfect tower. */
export const BAG_YAW: Record<ObjectId, number> = {
  marker: 0,
  tape_holder: -0.22,
  sponge: 0.16,
  egg: 0.34,
};

/**
 * Yaw an item rests at on the table. Only the egg needs one: lying dead along
 * y it is pure foreshortening from the demo camera and reads as a white ball,
 * where a few degrees of turn shows the silhouette. The hand squares it up as
 * it grasps (a held item is always at yaw 0, so the pads meet flat sides).
 */
export const REST_YAW: Record<ObjectId, number> = {
  marker: 0,
  tape_holder: 0,
  sponge: 0,
  egg: 0.3,
};

/**
 * How far an item settles *into* the stack below it instead of balancing on top.
 * Only the egg needs it: it is the last thing packed and it nestles between the
 * sponge and the pouch wall instead of poking over the rim.
 */
export const BAG_SINK: Record<ObjectId, number> = {
  marker: 0,
  tape_holder: 0,
  sponge: 0,
  egg: 1.25,
};
