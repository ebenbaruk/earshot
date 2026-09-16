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
import type {
  CorrectionEvent,
  ObjectId,
  Observation,
  PolicyConstraints,
  SkillCommand,
  Vec2,
  WorldState,
} from "@/lib/types";
import { resolveOrderHint } from "@/lib/corrections/order";
import { extractOrderHint } from "@/lib/corrections/grammar";

export type RunConstraints = PolicyConstraints;

export function emptyConstraints(): RunConstraints {
  return { graspOffset: {}, deferLast: null, releaseLow: {}, squeezeBefore: {} };
}

export function cloneConstraints(c: PolicyConstraints | undefined): RunConstraints {
  if (!c) return emptyConstraints();
  return {
    graspOffset: Object.fromEntries(
      Object.entries(c.graspOffset ?? {}).map(([k, v]) => [k, v ? { ...v } : v]),
    ) as RunConstraints["graspOffset"],
    deferLast: c.deferLast ?? null,
    releaseLow: { ...(c.releaseLow ?? {}) },
    squeezeBefore: { ...(c.squeezeBefore ?? {}) },
  };
}

/** Human-readable lines for the Policy panel. */
export function describeConstraints(c: PolicyConstraints | undefined): string[] {
  if (!c) return [];
  const out: string[] = [];
  for (const [id, off] of Object.entries(c.graspOffset ?? {})) {
    if (!off || (off.x === 0 && off.y === 0)) continue;
    const parts: string[] = [];
    if (off.x !== 0) parts.push(`${Math.abs(off.x)} cm to the ${off.x < 0 ? "left" : "right"}`);
    if (off.y !== 0) parts.push(`${Math.abs(off.y)} cm ${off.y > 0 ? "away" : "closer"}`);
    out.push(`${id}: grasp ${parts.join(", ")} of the estimated centre`);
  }
  if (c.deferLast) out.push(`${c.deferLast}: packed last`);
  for (const id of Object.keys(c.releaseLow ?? {})) out.push(`${id}: lowered to the rim before release`);
  for (const id of Object.keys(c.squeezeBefore ?? {})) out.push(`${id}: squeezed before release`);
  return out;
}

/** Nearest resting object to the gripper in a raw world snapshot (true positions). */
function objectNearWorld(w: WorldState, radius = 6): ObjectId | null {
  const g = w.gripper.pos;
  let best: ObjectId | null = null;
  let bestD = radius;
  for (const o of w.objects) {
    if (o.state !== "on_table" && o.state !== "rolled_out") continue;
    const d = Math.hypot(o.pos.x - g.x, o.pos.y - g.y);
    if (d <= bestD) {
      bestD = d;
      best = o.id;
    }
  }
  return best;
}

/**
 * Distil operator facts from a batch of corrections (the deterministic half of
 * "learning"): what the operator said, in which situation, becomes a standing
 * fact for every future run under the new policy version.
 */
export function deriveConstraints(
  corrections: CorrectionEvent[],
  base: PolicyConstraints | undefined,
): PolicyConstraints {
  const c = cloneConstraints(base);
  for (const ev of corrections) {
    const cmd = ev.parsedCommand;
    // The logged outcome may be that of the automatic retry (e.g. the grasp
    // after a nudge); only an interrupted correction teaches nothing.
    if (!cmd || ev.outcome === "interrupted") continue;
    const w = ev.stateBefore[ev.stateBefore.length - 1];
    const hint = extractOrderHint(ev.transcript);
    if (hint?.position === "last") c.deferLast = hint.object;
    if (!w) continue;
    const holding = w.gripper.holding;
    if (cmd.skill === "nudge" && !holding) {
      const id = objectNearWorld(w);
      if (id) {
        const prev = c.graspOffset[id] ?? { x: 0, y: 0 };
        c.graspOffset[id] = { x: prev.x + cmd.dx, y: prev.y + cmd.dy };
      }
    }
    if (cmd.skill === "descend" && holding) c.releaseLow[holding] = true;
    if (cmd.skill === "squeeze" && holding) c.squeezeBefore[holding] = true;
  }
  return c;
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
  if (command.skill === "squeeze" && obsBefore.gripper.holding) c.squeezeBefore[obsBefore.gripper.holding] = true;
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
): { command: SkillCommand; preSteps: SkillCommand[]; followUp: SkillCommand | null; note: string | null } {
  // "squeeze it first" / "lower it first": prepare the held object before releasing it.
  if (command.skill === "release" && obs.gripper.holding) {
    const held = obs.gripper.holding;
    const preSteps: SkillCommand[] = [];
    const notes: string[] = [];
    if (c.squeezeBefore[held]) {
      preSteps.push({ skill: "squeeze" });
      notes.push(`squeeze the ${held} first`);
    }
    if (c.releaseLow[held] && obs.gripper.z > 13) {
      preSteps.push({ skill: "descend" });
      notes.push(`lower the ${held} first`);
    }
    if (preSteps.length) return { command, preSteps, followUp: null, note: `operator said: ${notes.join(", ")}` };
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
        preSteps: [],
        followUp: { skill: "nudge", dx: off.x, dy: off.y },
        note: `operator offset for ${target}: (${off.x}, ${off.y})`,
      };
    }
  }
  return { command, preSteps: [], followUp: null, note: null };
}
