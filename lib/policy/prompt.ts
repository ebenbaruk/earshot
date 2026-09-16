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
- squeeze            clamp the fingers hard on whatever is held.
- wait               do nothing for a moment.
- stop               end the run.

Table frame: origin at the table centre, x grows to the right, y grows away from the operator. Units are centimetres.`;

const DEFAULTS = `## How to pack an object (canonical sequence)
1. move_to(object)
2. descend   (the fingers open by themselves to fit the object underneath)
3. grasp
4. lift
5. move_to("bag")
6. release

set_gripper exists but is rarely needed: descend already opens the gripper to the right width.

## Default heuristics
- Pack the object nearest to the gripper first, then the next nearest, and so on.
- Only one object can be held at a time; after release, start the next object from step 1.
- Never repeat a skill that just returned ok with identical parameters (e.g. set_gripper twice): move on to the next step.
- Emit stop ONLY when every object listed in the observation is in_bag (count them: the observation lists all of them). If any object is still on_table, rolled_out, cracked or held, you are not done.

## Reacting to the last outcome
- ok: continue with the next step of the sequence.
- slipped or missed: retry the same approach at most ONCE; if it fails again, lift and re-approach, or move on to a different object. Never set the gripper narrower than the object width + 0.5 — a narrower gripper always slips.
- blocked on release: the release did not go through. Do not repeat the exact same release; lift, re-approach, or move on to another object and come back.
- rolled_out: an item left the bag; re-plan rather than repeating what you just did.
- cracked: the item broke on release and a fresh one was put back on the table; do not repeat the exact same release.
- interrupted: the operator stopped you; follow whatever they asked.
- A nudge, set_gripper, squeeze or descend in the recent history that you did not plan was the human operator correcting you. Keep its effect: continue from the gripper's CURRENT position and width (descend / grasp next) and never move back to the estimated centre to undo it.

Emit exactly one skill. Keep "reasoning" to one short sentence.`;

export function buildPolicySystemPrompt(policy: PolicyVersion): string {
  const parts: string[] = [
    `You are the high-level policy of a table-top packing robot. Each step you receive an observation and choose the single next skill for the frozen low-level controller to execute. Goal: get every object listed in the observation (sponge, tape holder, marker, egg) into the bag and keep them there, intact.`,
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

  const facts = describeConstraintsForPrompt(policy.constraints);
  if (facts.length > 0) {
    parts.push(
      `## Standing operator instructions\nThe human supervisor established these facts about THIS table. They are enforced by the low-level controller and you must plan with them:\n${facts.map((f) => `- ${f}`).join("\n")}`,
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

function describeConstraintsForPrompt(c: PolicyVersion["constraints"]): string[] {
  if (!c) return [];
  const out: string[] = [];
  if (c.deferLast) out.push(`${c.deferLast}: pack it LAST — never move_to(${c.deferLast}) while any other object is still on the table.`);
  for (const [id, off] of Object.entries(c.graspOffset ?? {})) {
    if (off && (off.x !== 0 || off.y !== 0)) out.push(`${id}: after move_to(${id}), the controller nudges by (${off.x}, ${off.y}) before you descend; do not undo it.`);
  }
  for (const id of Object.keys(c.releaseLow ?? {})) out.push(`${id}: descend before release over the bag.`);
  for (const id of Object.keys(c.squeezeBefore ?? {})) out.push(`${id}: squeeze before release over the bag.`);
  return out;
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
    )}, contents = [${obs.bag.contents.join(", ")}]`,
  );
  const remaining = obs.objects.filter((o) => o.state !== "in_bag").map((o) => o.id);
  lines.push(`Packed and still in the bag: ${obs.stagesDone}/${obs.objects.length}`);
  lines.push(
    remaining.length > 0
      ? `Still to pack: ${remaining.join(", ")} — the run is NOT finished.`
      : "Every object is in the bag: the run is finished, emit stop.",
  );

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
