/**
 * Distillation — the "post-training" step.
 *
 * The operator's spoken corrections are the supervision signal. This turns a
 * correction log into a small set of general, reusable rules (plus a few
 * worked examples) for the high-level policy, and merges them into a new
 * PolicyVersion. Server-only (reads ASSEMBLYAI_API_KEY).
 */
import type {
  CorrectionEvent,
  DistillRequest,
  FewShot,
  PolicyRule,
  PolicyVersion,
  RunRecord,
  WorldState,
} from "@/lib/types";
import { chatJSON, smartModel } from "@/lib/llm/gateway";
import { describeCommand, toSkillCommand } from "./command-codec";
import { r05 } from "./prompt";
import {
  DISTILL_SCHEMA,
  DISTILL_SCHEMA_NAME,
  type DistillLLMOutput,
} from "./schema";

export const MAX_RULES = 8;
export const MAX_FEW_SHOTS = 6;

const SYSTEM_PROMPT = `You are performing the post-training step of a hierarchical robot policy.

A high-level policy (an LLM) picks one skill at a time for a frozen low-level controller that packs three objects (sponge, tape_holder, marker) into a bag. When the policy was about to do something wrong, a human operator shouted a correction; the correction was executed instead. Those corrections are your only supervision signal — your job is to compile them into durable rules so the next run needs fewer interventions.

Write rules that are:
- GENERAL: they must fire from the observation alone. Phrase conditions over things the policy can actually see — object ids, object states, gripper state (holding / opening / height), bag contents, bag.openingLooksNarrow, the last skill and its outcome, how many items are packed.
- CONCRETE: the action must name a skill from the library and its parameters, e.g. "nudge(-2, 0) after move_to(tape_holder) and before descend".
- CAUSAL, not anecdotal: one rule per failure mode, not one rule per correction. Merge corrections that teach the same lesson and cite all of their ids in \`evidence\`.
- FREE OF HIDDEN FACTS: never justify a rule with mechanics the policy cannot observe (internal shapes, hidden centres of mass, unseen features). Encode the fix as a parameter instead: say "grasp about 2 cm to the left of the estimated centre", not "because of the ring inside it".
- ORDERING RULES ARE ALLOWED and should be phrased as preconditions, e.g. "WHEN the marker is not yet packed and another object is still on the table DO pack the other object first".

Skill library: move_to(target), nudge(dx, dy), set_gripper(width), descend, grasp, lift, release, squeeze, widen_bag, wait, stop.

Also review the existing rules. Put the ids of any that are now wrong, redundant or superseded into droppedRuleIds. Keep the total number of rules at or below ${MAX_RULES}. Emit at most 4 fewShots, each a distinct failure mode. The changelog is one or two sentences a human will read in a diff view.`;

function summarizeWorldState(ws: WorldState | undefined): string {
  if (!ws) return "(no state snapshot captured)";
  const g = ws.gripper;
  const objs = ws.objects
    .map(
      (o) =>
        `${o.id}@(${r05(o.pos.x)},${r05(o.pos.y)}) ${o.state}${
          o.compressed ? " compressed" : ""
        }`,
    )
    .join("; ");
  return [
    `t=${Math.round(ws.t)}ms`,
    `gripper@(${r05(g.pos.x)},${r05(g.pos.y)}) z=${r05(g.z)} opening=${r05(
      g.width,
    )} holding=${g.holding ?? "nothing"}`,
    `objects: ${objs}`,
    `bag opening=${r05(ws.bag.opening)} contents=[${ws.bag.contents.join(", ")}]`,
    `packed=${ws.stagesDone}/3`,
    `lastSkill=${
      ws.lastSkill
        ? `${describeCommand(ws.lastSkill.command)} -> ${ws.lastSkill.outcome}`
        : "none"
    }`,
  ].join(", ");
}

/**
 * Did the run make progress after this correction? Compares the packed count
 * at the correction against the packed count at the next correction in the
 * same run, falling back to the run's final stagesDone.
 */
export function progressedAfter(
  correction: CorrectionEvent,
  all: CorrectionEvent[],
  runs: RunRecord[],
): string {
  const before =
    correction.stateBefore[correction.stateBefore.length - 1]?.stagesDone ?? 0;
  const sameRun = all
    .filter((c) => c.runId === correction.runId)
    .sort((a, b) => a.ts - b.ts);
  const idx = sameRun.findIndex((c) => c.id === correction.id);
  const next = idx >= 0 ? sameRun[idx + 1] : undefined;
  const after =
    next?.stateBefore[next.stateBefore.length - 1]?.stagesDone ??
    runs.find((r) => r.id === correction.runId)?.stagesDone;
  if (after === undefined) return "unknown";
  if (after > before) return `yes (packed ${before} -> ${after})`;
  return `no (packed stayed at ${before})`;
}

export function renderCorrection(
  c: CorrectionEvent,
  all: CorrectionEvent[],
  runs: RunRecord[],
): string {
  const snapshot = c.stateBefore[c.stateBefore.length - 1];
  return [
    `### Correction ${c.id} (run ${c.runId}, ${c.preventive ? "preventive" : "after a stop"})`,
    `Observation at the moment of the correction: ${summarizeWorldState(snapshot)}`,
    `Action the policy wanted to take (rejected): ${
      c.rejectedPolicyAction
        ? `${describeCommand(c.rejectedPolicyAction.command)} — "${c.rejectedPolicyAction.reasoning}"`
        : "unknown"
    }`,
    `Operator said: "${c.transcript}"`,
    `Executed instead: ${
      c.parsedCommand ? describeCommand(c.parsedCommand) : "nothing (could not parse)"
    } (parsed by ${c.parseSource})`,
    `Outcome of that command: ${c.outcome ?? "unknown"}`,
    `Run progressed afterwards: ${progressedAfter(c, all, runs)}`,
  ].join("\n");
}

export function buildDistillUserPrompt(req: DistillRequest): string {
  const existing =
    req.policy.rules.length > 0
      ? req.policy.rules
          .map((r) => `- [${r.id}] WHEN ${r.when} DO ${r.do}`)
          .join("\n")
      : "(none — this is the base policy)";

  const runs =
    req.runs.length > 0
      ? req.runs
          .map(
            (r) =>
              `- ${r.id}: seed ${r.seed}, policy v${r.policyVersion}, packed ${r.stagesDone}/3, ${
                r.success ? "succeeded" : "failed"
              }, ${r.interventions} operator interventions`,
          )
          .join("\n")
      : "(no run records)";

  return [
    `## Current policy (v${req.policy.version}) rules`,
    existing,
    "",
    `## Runs in this window`,
    runs,
    "",
    `## Corrections to distill (${req.corrections.length})`,
    req.corrections
      .map((c) => renderCorrection(c, req.corrections, req.runs))
      .join("\n\n"),
    "",
    `Produce the rules, few-shot examples, changelog and droppedRuleIds for policy v${
      req.policy.version + 1
    }.`,
  ].join("\n");
}

function nextIndex(ids: string[], prefix: string): number {
  let max = 0;
  for (const id of ids) {
    const m = new RegExp(`^${prefix}(\\d+)$`).exec(id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return max + 1;
}

export interface DistillOptions {
  model?: string;
  timeoutMs?: number;
  maxTokens?: number;
  apiKey?: string;
  now?: number;
}

/** Merge an LLM distillation output into a new PolicyVersion. */
export function mergeDistillation(
  req: DistillRequest,
  out: DistillLLMOutput,
  now: number = Date.now(),
): PolicyVersion {
  const parent = req.policy;
  const version = parent.version + 1;
  const dropped = new Set(out.droppedRuleIds ?? []);

  const keptRules = parent.rules.filter((r) => !dropped.has(r.id));
  let ruleIdx = nextIndex(
    parent.rules.map((r) => r.id),
    "r",
  );
  const newRules: PolicyRule[] = (out.rules ?? [])
    .filter((r) => r && typeof r.when === "string" && typeof r.do === "string")
    .map((r) => ({
      id: `r${ruleIdx++}`,
      when: r.when.trim().replace(/^when\s+/i, ""),
      do: r.do.trim().replace(/^do\s+/i, ""),
      evidence: Array.isArray(r.evidence) ? r.evidence : [],
      addedInVersion: version,
    }));

  // Cap at MAX_RULES, evicting the oldest surviving rules first.
  let rules = [...keptRules, ...newRules];
  if (rules.length > MAX_RULES) {
    const overflow = rules.length - MAX_RULES;
    rules = [...keptRules.slice(overflow), ...newRules].slice(-MAX_RULES);
  }

  let shotIdx = nextIndex(
    parent.fewShots.map((f) => f.id),
    "f",
  );
  const newShots: FewShot[] = [];
  for (const fs of out.fewShots ?? []) {
    if (!fs || typeof fs.observationSummary !== "string") continue;
    try {
      newShots.push({
        id: `f${shotIdx++}`,
        observationSummary: fs.observationSummary.trim(),
        command: toSkillCommand(fs.command as never),
        source: typeof fs.source === "string" ? fs.source : "",
        addedInVersion: version,
      });
    } catch {
      // An undecodable example is dropped rather than poisoning the prompt.
    }
  }
  const fewShots = [...parent.fewShots, ...newShots].slice(-MAX_FEW_SHOTS);

  return {
    version,
    createdAt: now,
    parentVersion: parent.version,
    rules,
    fewShots,
    changelog:
      (out.changelog ?? "").trim() ||
      `Distilled ${newRules.length} rule(s) from ${req.corrections.length} correction(s).`,
    distilledFrom: req.corrections.map((c) => c.id),
  };
}

/** Distill a correction log into policy v(n+1). Throws GatewayError on failure. */
export async function distill(
  req: DistillRequest,
  opts: DistillOptions = {},
): Promise<PolicyVersion> {
  const call = (extra: string) =>
    chatJSON<DistillLLMOutput>({
      model: opts.model ?? smartModel(),
      system: SYSTEM_PROMPT + extra,
      user: buildDistillUserPrompt(req),
      schema: DISTILL_SCHEMA,
      schemaName: DISTILL_SCHEMA_NAME,
      temperature: 0,
      maxTokens: opts.maxTokens ?? 6000,
      timeoutMs: opts.timeoutMs ?? 55_000,
      apiKey: opts.apiKey,
    });
  let { data } = await call("");
  let next = mergeDistillation(req, data, opts.now);
  // A model occasionally answers with an empty rule list even though there
  // are corrections to learn from. One firmer retry before giving up.
  if (next.rules.length === req.policy.rules.length && req.corrections.some((c) => c.parsedCommand)) {
    ({ data } = await call(
      "\n\nIMPORTANT: the previous attempt returned no new rules. Every distinct correction below MUST yield at least one rule in `rules` (non-empty `when` and `do` strings).",
    ));
    next = mergeDistillation(req, data, opts.now);
  }
  return next;
}
