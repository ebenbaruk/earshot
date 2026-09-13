/**
 * Run-scoped operator constraints held by the low-level layer.
 *
 * When a human corrects the agent, the correction is executed once by the
 * skill layer — but some corrections are facts about the world that stay true
 * for the rest of the run: "grab the tape 2 cm to the left" (a grasp offset)
 * and "the marker goes last" (an ordering constraint). The skill layer keeps
 * them for the run so the high-level policy cannot undo them a step later.
 * They are NOT carried into the next run: that is the distillation's job.
 */
import type { ObjectId, Observation, SkillCommand, Vec2 } from "@/lib/types";
import { resolveOrderHint } from "@/lib/corrections/order";

export interface RunConstraints {
  graspOffset: Partial<Record<ObjectId, Vec2>>;
  deferLast: ObjectId | null;
  /** objects the operator told us to lower before releasing ("lower it first") */
  releaseLow: Partial<Record<ObjectId, true>>;
}

export function emptyConstraints(): RunConstraints {
  return { graspOffset: {}, deferLast: null, releaseLow: {} };
}

/** Object the gripper is currently closest to (within `radius` cm), from the observation. */
export function objectNear(obs: Observation, radius = 6): ObjectId | null {
  const g = obs.gripper.pos;
  let best: ObjectId | null = null;
  let bestD = radius;
  for (const o of obs.objects) {
    if (o.state !== "on_table" && o.state !== "rolled_out") continue;
    const d = Math.hypot(o.estimatedPos.x - g.x, o.estimatedPos.y - g.y);
    if (d <= bestD) {
      bestD = d;
      best = o.id;
    }
  }
  return best;
}

/**
 * "A bit to the left" said with the fingers already down on an object means
 * "…and try again": the skill layer retries the grasp right after the nudge.
 */
export function retryAfterNudge(command: SkillCommand, obsBefore: Observation): SkillCommand | null {
  if (command.skill !== "nudge" || obsBefore.gripper.holding || obsBefore.gripper.z > 2) return null;
  return objectNear(obsBefore, 6) ? { skill: "grasp" } : null;
}

/** Record what a just-executed correction teaches the skill layer for this run. */
export function learnFromCorrection(
  c: RunConstraints,
  command: SkillCommand,
  obsBefore: Observation,
  orderHint: { object: ObjectId; position: "first" | "last" } | null,
): void {
  if (orderHint?.position === "last") c.deferLast = orderHint.object;
  if (command.skill === "descend" && obsBefore.gripper.holding) c.releaseLow[obsBefore.gripper.holding] = true;
  if (command.skill === "nudge" && !obsBefore.gripper.holding) {
    const id = objectNear(obsBefore);
    if (id) {
      const prev = c.graspOffset[id] ?? { x: 0, y: 0 };
      c.graspOffset[id] = { x: prev.x + command.dx, y: prev.y + command.dy };
    }
  }
}

/**
 * Rewrite a policy decision so it respects the run constraints.
 * Returns the command to execute and, optionally, a follow-up (the sticky nudge).
 */
export function applyConstraints(
  c: RunConstraints,
  command: SkillCommand,
  obs: Observation,
): { command: SkillCommand; preStep: SkillCommand | null; followUp: SkillCommand | null; note: string | null } {
  // "lower it first": descend before releasing this object, if not already low.
  if (command.skill === "release" && obs.gripper.holding && c.releaseLow[obs.gripper.holding] && obs.gripper.z > 13) {
    return { command, preStep: { skill: "descend" }, followUp: null, note: `operator said: lower the ${obs.gripper.holding} first` };
  }
  if (command.skill === "move_to" && typeof command.target === "string" && command.target !== "bag") {
    const target = command.target;
    // "X last": while anything else remains, redirect to the nearest other object.
    if (c.deferLast === target) {
      const redirected = resolveOrderHint({ object: target, position: "last" }, obs);
      if (redirected && redirected.skill === "move_to" && redirected.target !== target) {
        return { ...applyConstraints(c, redirected, obs), note: `operator said: ${target} last` };
      }
    }
    const off = c.graspOffset[target];
    if (off && (off.x !== 0 || off.y !== 0)) {
      return {
        command,
        preStep: null,
        followUp: { skill: "nudge", dx: off.x, dy: off.y },
        note: `operator offset for ${target}: (${off.x}, ${off.y})`,
      };
    }
  }
  return { command, preStep: null, followUp: null, note: null };
}
