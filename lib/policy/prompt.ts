/**
 * Prompt construction for the high-level policy.
 *
 * Layout matters: the fixed skill library and default heuristics come first,
 * then the learned rules with an explicit override instruction, then the
 * few-shots. The model therefore reads the defaults as a baseline and the
 * distilled rules as the thing that supersedes them.
 */
import type { Observation, PolicyVersion, SkillCommand } from "@/lib/types";
import { describeCommand } from "./command-codec";

/** Round to the nearest 0.5 cm — matches the perception noise in the sim. */
export function r05(n: number): string {
  const v = Math.round(n * 2) / 2;
  return v.toFixed(1);
}

const SKILL_LIBRARY = `## Skill library (the only actions that exist)
- move_to(target)    move the gripper over "sponge" | "tape_holder" | "marker" | "bag", or over an x/y point on the table.
- set_gripper(width) set the finger opening, in cm (2..14).
- descend            lower the gripper onto whatever is below it.
- grasp              close the fingers.
- lift               raise the gripper back up.
- release            open the fingers and let go of what is held.
- nudge(dx, dy)      small xy adjustment of the gripper, in cm.
- squeeze            compress the held object.
- widen_bag          re-open the mouth of the bag.
- wait               do nothing for a moment.
- stop               end the run.

Table frame: origin at the table centre, x grows to the right, y grows away from the operator. Units are centimetres.`;

const DEFAULTS = `## How to pack an object (canonical sequence)
1. set_gripper(object width + 0.5)
2. move_to(object)
3. descend
4. grasp
5. lift
6. move_to("bag")
7. release

## Default heuristics
- Pack the object nearest to the gripper first, then the next nearest, and so on.
- Only one object can be held at a time; after release, start the next object from step 1.
- If bag.openingLooksNarrow is true, widen_bag before releasing into the bag.
- When all three objects are in the bag, emit stop.

## Reacting to the last outcome
- ok: continue with the next step of the sequence.
- slipped or missed: retry the same approach at most ONCE; if it fails again, change something (re-position, change the gripper width, or move on to a different object).
- blocked on release: the bag mouth is too small — widen_bag, then release again.
- rolled_out: an item left the bag; re-plan rather than repeating what you just did.
- interrupted: the operator stopped you; follow whatever they asked.

Emit exactly one skill. Keep "reasoning" to one short sentence.`;

export function buildPolicySystemPrompt(policy: PolicyVersion): string {
  const parts: string[] = [
    `You are the high-level policy of a table-top packing robot. Each step you receive an observation and choose the single next skill for the frozen low-level controller to execute. Goal: get all three objects (sponge, tape holder, marker) into the bag and keep them there.`,
    SKILL_LIBRARY,
    DEFAULTS,
  ];

  if (policy.rules.length > 0) {
    const lines = policy.rules
      .map((rule) => `- [${rule.id}] WHEN ${rule.when} DO ${rule.do}`)
      .join("\n");
    parts.push(
      `## Learned rules (v${policy.version})\nThese were distilled from live operator corrections on earlier runs. **Learned rules override the defaults above.** If a rule applies to the current observation, follow it even when the canonical sequence or a heuristic says otherwise.\n${lines}`,
    );
  }

  if (policy.fewShots.length > 0) {
    const lines = policy.fewShots
      .map(
        (fs) =>
          `- Observation: ${fs.observationSummary}\n  Correct action: ${describeCommand(
            fs.command,
          )}`,
      )
      .join("\n");
    parts.push(`## Examples\n${lines}`);
  }

  return parts.join("\n\n");
}

function describeOutcomeEntry(entry: {
  command: SkillCommand;
  outcome: string;
}): string {
  return `${describeCommand(entry.command)} -> ${entry.outcome}`;
}

export function buildPolicyUserPrompt(obs: Observation): string {
  const g = obs.gripper;
  const lines: string[] = [];

  lines.push(`t = ${Math.round(obs.t)} ms`);
  lines.push(
    `Gripper: at (${r05(g.pos.x)}, ${r05(g.pos.y)}), z = ${r05(g.z)}, opening = ${r05(
      g.width,
    )}, holding = ${g.holding ?? "nothing"}`,
  );

  lines.push("Objects:");
  for (const o of obs.objects) {
    const dist = Math.hypot(o.estimatedPos.x - g.pos.x, o.estimatedPos.y - g.pos.y);
    lines.push(
      `- ${o.id} at (${r05(o.estimatedPos.x)}, ${r05(o.estimatedPos.y)}), size ${r05(
        o.size.w,
      )}x${r05(o.size.d)}x${r05(o.size.h)}, state = ${o.state}, distance from gripper = ${r05(
        dist,
      )}`,
    );
  }

  const bagDist = Math.hypot(obs.bag.pos.x - g.pos.x, obs.bag.pos.y - g.pos.y);
  lines.push(
    `Bag: at (${r05(obs.bag.pos.x)}, ${r05(obs.bag.pos.y)}), distance from gripper = ${r05(
      bagDist,
    )}, contents = [${obs.bag.contents.join(", ")}], openingLooksNarrow = ${
      obs.bag.openingLooksNarrow
    }`,
  );
  lines.push(`Packed and still in the bag: ${obs.stagesDone}/3`);

  lines.push(
    `Last skill: ${obs.lastSkill ? describeOutcomeEntry(obs.lastSkill) : "none (start of run)"}`,
  );
  if (obs.recentHistory.length > 0) {
    lines.push(
      `Recent skills (oldest first): ${obs.recentHistory
        .map(describeOutcomeEntry)
        .join(" | ")}`,
    );
  }

  lines.push("");
  lines.push("Choose the single next skill.");
  return lines.join("\n");
}
