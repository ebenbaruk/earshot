/**
 * Deterministic fallback policy.
 *
 * Used whenever the LLM Gateway is unreachable, slow or returns something we
 * cannot decode, so a demo never stalls on a network hiccup. It reproduces the
 * canonical nearest-first pick-and-place sequence from the base prompt and
 * knows none of the world's hidden quirks — exactly like the base policy.
 */
import type {
  Observation,
  ObservedObject,
  PolicyDecision,
  SkillCommand,
} from "@/lib/types";
import { clampGripperWidth } from "./command-codec";

/** Gripper is considered "over" a target within this radius (cm). */
const XY_TOLERANCE = 1.0;
/** Gripper is considered "down" at or below this height (cm). */
const Z_TOUCHING = 2; // finger tips low enough to grasp (GRASP_MAX_Z)

const dist = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  Math.hypot(a.x - b.x, a.y - b.y);

function decision(command: SkillCommand, reasoning: string): PolicyDecision {
  return { command, reasoning: `[fallback] ${reasoning}` };
}

/** Objects still waiting on the table, nearest to the gripper first. */
export function remainingTargets(obs: Observation): ObservedObject[] {
  return obs.objects
    .filter((o) => o.state === "on_table" || o.state === "rolled_out")
    .sort(
      (a, b) =>
        dist(a.estimatedPos, obs.gripper.pos) -
        dist(b.estimatedPos, obs.gripper.pos),
    );
}

/** Number of trailing history entries matching `skill` that did not succeed. */
function trailingFailures(obs: Observation, skill: SkillCommand["skill"]): number {
  let n = 0;
  for (let i = obs.recentHistory.length - 1; i >= 0; i--) {
    const e = obs.recentHistory[i];
    if (e.command.skill === skill && e.outcome !== "ok") n++;
    else break;
  }
  return n;
}

export function fallbackDecision(obs: Observation): PolicyDecision {
  const g = obs.gripper;

  // ---- holding something: carry it to the bag ---------------------------
  if (g.holding) {
    const held = obs.objects.find((o) => o.id === g.holding);
    const overBag = dist(g.pos, obs.bag.pos) <= XY_TOLERANCE;

    if (g.z <= Z_TOUCHING) {
      return decision({ skill: "lift" }, `lift the ${g.holding} off the table`);
    }
    if (!overBag) {
      return decision(
        { skill: "move_to", target: "bag" },
        `carry the ${g.holding} to the bag`,
      );
    }
    if (
      obs.bag.openingLooksNarrow ||
      (obs.lastSkill?.command.skill === "release" &&
        obs.lastSkill.outcome === "blocked")
    ) {
      return decision(
        { skill: "widen_bag" },
        "the bag opening is too narrow to accept the item",
      );
    }
    return decision(
      { skill: "release" },
      `drop the ${held?.id ?? g.holding} into the bag`,
    );
  }

  // ---- nothing held: pick the nearest remaining object -------------------
  const targets = remainingTargets(obs);
  if (targets.length === 0) {
    return decision({ skill: "stop" }, "every object is in the bag");
  }

  const target = targets[0];
  const wantedWidth = clampGripperWidth(target.size.w + 0.5);
  // A recent `nudge` is the human operator repositioning us: trust it and do
  // not move back to the estimated centre.
  const nudgedHere =
    obs.lastSkill?.command.skill === "nudge" &&
    obs.lastSkill.outcome === "ok" &&
    dist(g.pos, target.estimatedPos) <= 5;
  const overTarget = nudgedHere || dist(g.pos, target.estimatedPos) <= XY_TOLERANCE;

  // Gripper must be open enough before we come down on the object.
  if (!overTarget || g.z > Z_TOUCHING) {
    if (Math.abs(g.width - wantedWidth) > 0.25 && g.z > Z_TOUCHING) {
      return decision(
        { skill: "set_gripper", width: wantedWidth },
        `open to ${wantedWidth} cm for the ${target.id}`,
      );
    }
  }

  if (!overTarget) {
    return decision(
      { skill: "move_to", target: target.id },
      `${target.id} is the nearest object`,
    );
  }

  if (g.z > Z_TOUCHING) {
    return decision({ skill: "descend" }, `descend onto the ${target.id}`);
  }

  const failures = trailingFailures(obs, "grasp");
  if (failures >= 2) {
    // Retried once already: back off so the next cycle re-approaches cleanly.
    return decision(
      { skill: "lift" },
      `grasp failed ${failures}x, back off and re-approach`,
    );
  }
  return decision(
    { skill: "grasp" },
    failures === 1 ? `retry the grasp on the ${target.id}` : `grasp the ${target.id}`,
  );
}
