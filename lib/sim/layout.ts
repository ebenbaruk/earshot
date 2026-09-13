/**
 * Seeded object placement.
 *
 * Objects are scattered on the left two thirds of the table (the bag owns the right).
 * Rejection sampling enforces the properties the demo depends on:
 *  - objects never overlap and are all reachable,
 *  - the marker is the object nearest to the gripper start pose, so a naive
 *    "grab the closest thing first" policy packs the marker first and it later
 *    rolls out when a second item lands on top of it.
 */

import type { ObjectId, SimObject, Vec2 } from "@/lib/types";
import {
  BAG_POS,
  GRIPPER_START_POS,
  OBJECT_SPECS,
  TABLE_X,
  TABLE_Y,
  dist,
} from "./constants";
import { mulberry32, randRange, randSigned, type Rng } from "./seed";
import { PERCEPTION_NOISE } from "./constants";

/** Objects stay this far apart (center to center). */
const MIN_SEPARATION = 11;
/** Objects stay clear of the bag. */
const MIN_BAG_CLEARANCE = 14;
/** The marker must win "nearest to the gripper" by this margin. */
const NEAREST_MARGIN = 2;
/** Keep everything in the left part of the table so the bag stays free. */
const MAX_X = 4;
const EDGE_PADDING = 1.5;

function spawnRange(size: { w: number; d: number }) {
  return {
    xMin: TABLE_X.min + size.w / 2 + EDGE_PADDING,
    xMax: Math.min(MAX_X, TABLE_X.max - size.w / 2 - EDGE_PADDING),
    yMin: TABLE_Y.min + size.d / 2 + EDGE_PADDING,
    yMax: TABLE_Y.max - size.d / 2 - EDGE_PADDING,
  };
}

/** Deterministic fallback used if rejection sampling somehow fails (it does not for sane seeds). */
const FALLBACK: Record<ObjectId, Vec2> = {
  marker: { x: -18, y: 10 },
  sponge: { x: -4, y: -8 },
  tape_holder: { x: -20, y: -9 },
};

function acceptable(positions: Map<ObjectId, Vec2>): boolean {
  const entries = [...positions.entries()];
  for (let i = 0; i < entries.length; i += 1) {
    const [, a] = entries[i];
    if (dist(a, BAG_POS) < MIN_BAG_CLEARANCE) return false;
    for (let j = i + 1; j < entries.length; j += 1) {
      if (dist(a, entries[j][1]) < MIN_SEPARATION) return false;
    }
  }
  const marker = positions.get("marker");
  if (!marker) return false;
  const markerDist = dist(marker, GRIPPER_START_POS);
  for (const [id, p] of entries) {
    if (id === "marker") continue;
    if (dist(p, GRIPPER_START_POS) < markerDist + NEAREST_MARGIN) return false;
  }
  return true;
}

function drawLayout(rng: Rng): Map<ObjectId, Vec2> {
  const out = new Map<ObjectId, Vec2>();
  for (const spec of OBJECT_SPECS) {
    const r = spawnRange(spec.size);
    out.set(spec.id, {
      x: round2(randRange(rng, r.xMin, r.xMax)),
      y: round2(randRange(rng, r.yMin, r.yMax)),
    });
  }
  return out;
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

export interface Layout {
  objects: SimObject[];
  /** Per-object perception noise, stable for the whole run. */
  noise: Record<ObjectId, Vec2>;
}

/** Build the deterministic starting layout for a seed. */
export function createLayout(seed: number): Layout {
  const rng = mulberry32(seed);
  let positions: Map<ObjectId, Vec2> | null = null;
  for (let attempt = 0; attempt < 400; attempt += 1) {
    const candidate = drawLayout(rng);
    if (acceptable(candidate)) {
      positions = candidate;
      break;
    }
  }
  const resolved = positions ?? new Map<ObjectId, Vec2>(Object.entries(FALLBACK) as [ObjectId, Vec2][]);

  const objects: SimObject[] = OBJECT_SPECS.map((spec) => ({
    id: spec.id,
    label: spec.label,
    pos: { ...(resolved.get(spec.id) as Vec2) },
    size: { ...spec.size },
    state: "on_table",
    compressed: false,
  }));

  const noise = {} as Record<ObjectId, Vec2>;
  for (const spec of OBJECT_SPECS) {
    noise[spec.id] = {
      x: round2(randSigned(rng, PERCEPTION_NOISE)),
      y: round2(randSigned(rng, PERCEPTION_NOISE)),
    };
  }

  return { objects, noise };
}
