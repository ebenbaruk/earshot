/**
 * Ordering corrections ("put the marker in last", "do the tape first") need
 * the observation to become an executable skill. Kept out of the grammar so
 * the grammar stays pure text → command.
 */
import type { Observation, ObjectId, SkillCommand } from "@/lib/types";
import type { OrderHint } from "./grammar";

function remaining(obs: Observation) {
  return obs.objects.filter((o) => o.state === "on_table" || o.state === "rolled_out");
}

function nearestTo(obs: Observation, ids: ObjectId[]): ObjectId | null {
  const g = obs.gripper.pos;
  let best: ObjectId | null = null;
  let bestD = Infinity;
  for (const o of obs.objects) {
    if (!ids.includes(o.id)) continue;
    const d = Math.hypot(o.estimatedPos.x - g.x, o.estimatedPos.y - g.y);
    if (d < bestD) {
      bestD = d;
      best = o.id;
    }
  }
  return best;
}

/** "X first" → go to X now. "X last" → go to the nearest *other* remaining object. */
export function resolveOrderHint(hint: OrderHint, obs: Observation): SkillCommand | null {
  const left = remaining(obs).map((o) => o.id);
  if (hint.position === "first") {
    return left.includes(hint.object) ? { skill: "move_to", target: hint.object } : null;
  }
  const others = left.filter((id) => id !== hint.object);
  const next = nearestTo(obs, others);
  return next ? { skill: "move_to", target: next } : null;
}
