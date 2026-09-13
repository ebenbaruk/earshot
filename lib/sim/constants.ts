/**
 * Earshot simulation constants.
 * Units: centimeters, milliseconds. Table frame: origin at table center,
 * x -> right, y -> away from the viewer, z -> up.
 */

import type { ObjectId, SimObject, Vec2 } from "@/lib/types";
import { DEFAULT_GRIPPER_WIDTH, OBJECT_COUNT } from "@/lib/types";

/** Simulation tick: 20 Hz. */
export const TICK_MS = 50;

export const TABLE = { w: 60, d: 40 } as const;
export const TABLE_X = { min: -TABLE.w / 2, max: TABLE.w / 2 } as const;
export const TABLE_Y = { min: -TABLE.d / 2, max: TABLE.d / 2 } as const;

/** Bag sits at a fixed spot on the right of the table. */
export const BAG_POS: Vec2 = { x: 20, y: 0 };
export const BAG_OPENING_MAX = 12;
/** The opening is constant: the bag is big enough for everything that is packed properly. */
export const BAG_OPENING_STEP = 0;
/** Releasing within this radius of the bag center drops the item into the bag. */
export const BAG_RELEASE_RADIUS = 3;
/** Observation.bag.openingLooksNarrow threshold. */
export const BAG_NARROW_BELOW = 7;
/** Visual/physical depth + height of the bag (rendering only). */
export const BAG_DEPTH = 14;
export const BAG_HEIGHT = 11;

export const GRIPPER_START_POS: Vec2 = { x: -25, y: 15 };
export const GRIPPER_START_Z = 16;
export const GRIPPER_WIDTH_RANGE = { min: 2, max: 14 } as const;
export { DEFAULT_GRIPPER_WIDTH };

/** Max xy distance from an object's grasp point for a grasp to hold. */
export const GRASP_RADIUS = 1.5;
/** Extra slack around an object footprint that still counts as "the gripper is over it". */
export const OVER_OBJECT_MARGIN = 1.0;
/** Non-deformable objects need width >= w + this. */
export const GRIPPER_WIDTH_CLEARANCE = 0.5;
/** The sponge is deformable: it can be grabbed with any width >= this (hidden quirk). */
export const SPONGE_MIN_GRASP_WIDTH = 6;

/** Travel speeds. */
export const MOVE_SPEED = 25; // cm/s, xy
export const Z_SPEED = 20; // cm/s, vertical
export const LIFT_Z = 16; // cm, carry height (clears the bag rim with an object in hand)
export const DESCEND_MS = 450;
/** Finger-tip height after `descend` over an object / over the bag / over bare table. */
export const DESCEND_Z_OBJECT = 1;
export const DESCEND_Z_BAG = BAG_HEIGHT + 1; // hover above the rim, never inside the bag
export const DESCEND_Z_TABLE = 1;
/** `grasp` only works with the finger tips at or below this height. */
export const GRASP_MAX_Z = 2;
/** Duration of the marker rolling out of the bag (visible in the scene). */
export const ROLLOUT_MS = 700;

/** Skill animation durations (ms). */
export const DURATION = {
  setGripper: 250,
  grasp: 400,
  graspSlip: 700,
  release: 400,
  squeeze: 450,
  widenBag: 400,
  wait: 500,
  min: TICK_MS,
} as const;

/** A slipped grasp nudges the object by this much in a seeded direction. */
export const SLIP_DISPLACEMENT = 0.3;
/** Perception noise half-range applied to Observation.estimatedPos. */
export const PERCEPTION_NOISE = 0.5;
/** A marker that rolls out of the bag lands this far to the right of the bag. */
export const ROLLOUT_OFFSET_X = 6;

/** Ring buffer window. */
export const HISTORY_MS = 2500;
export const HISTORY_CAPACITY = Math.ceil(HISTORY_MS / TICK_MS) + 8;

/** Run termination. */
export const MAX_RUN_MS = 300_000;
export const MAX_CONSECUTIVE_FAILURES = 6;
export const STAGE_COUNT = OBJECT_COUNT;

/** The tape holder can only be picked up by its ring, 2 cm left of the visual centroid. */
export const TAPE_GRASP_OFFSET: Vec2 = { x: -2, y: 0 };
/** The scene highlights the tape grasp point once the gripper is this close to the tape. */
export const TAPE_HINT_RADIUS = 4;

/** The sponge's footprint once squeezed. */
export const SPONGE_COMPRESSED_SIZE = { w: 5, d: 5, h: 2 } as const;

export interface ObjectSpec {
  id: ObjectId;
  label: string;
  size: { w: number; d: number; h: number };
}

export const OBJECT_SPECS: readonly ObjectSpec[] = [
  { id: "sponge", label: "Sponge", size: { w: 8, d: 5, h: 3 } },
  { id: "tape_holder", label: "Tape holder", size: { w: 7, d: 7, h: 3 } },
  { id: "marker", label: "Marker", size: { w: 1.5, d: 12, h: 1.5 } },
  { id: "egg", label: "Egg", size: { w: 4.5, d: 6, h: 4.5 } },
] as const;

/** The egg cracks if released over the bag with the finger tips above this height (hidden quirk). */
export const EGG_SAFE_RELEASE_Z = DESCEND_Z_BAG + 0.5;
/** How long the cracked egg (and its mess) stays visible before a fresh egg is put back on the table. */
export const CRACK_MS = 900;

/** Footprint an object actually occupies right now (the sponge shrinks when squeezed). */
export function effectiveSize(obj: Pick<SimObject, "id" | "size" | "compressed">) {
  if (obj.id === "sponge" && obj.compressed) return { ...SPONGE_COMPRESSED_SIZE };
  return { ...obj.size };
}

/** Width the object presents to the bag opening. */
export function effectiveWidth(obj: Pick<SimObject, "id" | "size" | "compressed">): number {
  return effectiveSize(obj).w;
}

/** The only point an object can actually be picked up by (hidden from the policy). */
export function graspPoint(obj: Pick<SimObject, "id" | "pos">): Vec2 {
  if (obj.id === "tape_holder") {
    return { x: obj.pos.x + TAPE_GRASP_OFFSET.x, y: obj.pos.y + TAPE_GRASP_OFFSET.y };
  }
  return { x: obj.pos.x, y: obj.pos.y };
}

/** Minimum gripper opening needed to hold this object. */
export function requiredGripperWidth(obj: Pick<SimObject, "id" | "size" | "compressed">): number {
  if (obj.id === "sponge") return SPONGE_MIN_GRASP_WIDTH;
  return obj.size.w + GRIPPER_WIDTH_CLEARANCE;
}

export function dist(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

export function clampToTable(p: Vec2): Vec2 {
  return { x: clamp(p.x, TABLE_X.min, TABLE_X.max), y: clamp(p.y, TABLE_Y.min, TABLE_Y.max) };
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
