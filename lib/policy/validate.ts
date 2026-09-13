/**
 * Minimal structural validation for route bodies. Deliberately shallow: the
 * clients are our own modules, so this guards against obvious integration
 * mistakes and malformed JSON, not against hostile input.
 */
import type { Observation, PolicyVersion } from "@/lib/types";

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isVec2(v: unknown): boolean {
  return isRecord(v) && typeof v.x === "number" && typeof v.y === "number";
}

export function isObservation(v: unknown): v is Observation {
  if (!isRecord(v)) return false;
  if (typeof v.t !== "number") return false;
  if (!Array.isArray(v.objects)) return false;
  if (!isRecord(v.gripper) || !isVec2(v.gripper.pos)) return false;
  if (typeof v.gripper.width !== "number" || typeof v.gripper.z !== "number") {
    return false;
  }
  if (!isRecord(v.bag) || !isVec2(v.bag.pos) || !Array.isArray(v.bag.contents)) {
    return false;
  }
  if (typeof v.stagesDone !== "number") return false;
  if (!Array.isArray(v.recentHistory)) return false;
  return true;
}

export function isPolicyVersion(v: unknown): v is PolicyVersion {
  return (
    isRecord(v) &&
    typeof v.version === "number" &&
    Array.isArray(v.rules) &&
    Array.isArray(v.fewShots)
  );
}
