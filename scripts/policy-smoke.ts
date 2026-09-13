/**
 * pnpm tsx scripts/policy-smoke.ts
 *
 * Exercises the real AssemblyAI LLM Gateway end to end:
 *   (a) decide() on a fixture observation with the BASE policy
 *   (b) the same observation with one learned rule -> the decision should change
 *   (c) distill() over three fixture corrections -> prints the new rules
 *
 * Reads .env.local itself (tsx does not load it the way `next dev` does).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import type {
  CorrectionEvent,
  Observation,
  ObservedObject,
  PolicyVersion,
  WorldState,
} from "../lib/types";
import { FAST_MODEL, SMART_MODEL, chatJSON, listModels } from "../lib/llm/gateway";
import { BASE_POLICY } from "../lib/policy/base-policy";
import { decideWithMeta } from "../lib/policy/decide";
import { distill } from "../lib/policy/distill";
import { diffPolicies } from "../lib/policy/diff";
import { describeCommand } from "../lib/policy/command-codec";

// ---------------------------------------------------------------------------
// env
// ---------------------------------------------------------------------------

function loadEnvLocal(): void {
  for (const file of [".env.local", ".env"]) {
    let raw: string;
    try {
      raw = readFileSync(resolve(process.cwd(), file), "utf8");
    } catch {
      continue;
    }
    for (const line of raw.split("\n")) {
      const m = /^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (!m) continue;
      const value = m[2].replace(/^["']|["']$/g, "");
      if (!process.env[m[1]]) process.env[m[1]] = value;
    }
  }
}
loadEnvLocal();

// ---------------------------------------------------------------------------
// fixtures — demo seed: the marker is nearest to the gripper
// ---------------------------------------------------------------------------

const OBJECTS: ObservedObject[] = [
  { id: "marker", label: "Marker", estimatedPos: { x: 3, y: -2 }, size: { w: 1.5, d: 1.5, h: 14 }, state: "on_table" },
  { id: "sponge", label: "Sponge", estimatedPos: { x: -12, y: 6 }, size: { w: 8, d: 6, h: 3 }, state: "on_table" },
  { id: "tape_holder", label: "Tape holder", estimatedPos: { x: 10, y: 8 }, size: { w: 7, d: 7, h: 3 }, state: "on_table" },
];

const BAG_POS = { x: 18, y: 0 };

/**
 * The gripper has just arrived over the tape holder and has not descended yet.
 * Base policy -> descend. With the learned rule -> nudge(-2, 0) first.
 */
const OVER_TAPE: Observation = {
  t: 6400,
  objects: OBJECTS,
  gripper: { pos: { x: 10, y: 8 }, z: 8, width: 7.5, holding: null },
  bag: { pos: BAG_POS, contents: ["marker"], openingLooksNarrow: false },
  stagesDone: 1,
  lastSkill: { command: { skill: "move_to", target: "tape_holder" }, outcome: "ok" },
  recentHistory: [
    { command: { skill: "release" }, outcome: "ok" },
    { command: { skill: "set_gripper", width: 7.5 }, outcome: "ok" },
    { command: { skill: "move_to", target: "tape_holder" }, outcome: "ok" },
  ],
};

const TAPE_RULE_POLICY: PolicyVersion = {
  version: 1,
  createdAt: Date.now(),
  parentVersion: 0,
  rules: [
    {
      id: "r1",
      when: "about to grasp the tape_holder",
      do: "nudge(-2, 0) after move_to(tape_holder) and before descend/grasp — the reliable grasp point is 2 cm left of the estimated centre",
      evidence: ["c1"],
      addedInVersion: 1,
    },
  ],
  fewShots: [],
  changelog: "Hand-written rule for the smoke test.",
  distilledFrom: ["c1"],
};

function worldState(over: Partial<WorldState>): WorldState {
  return {
    t: 6000,
    seed: 7,
    status: "running",
    objects: OBJECTS.map((o) => ({
      id: o.id, label: o.label, pos: o.estimatedPos, size: o.size,
      state: o.state, compressed: false,
    })),
    gripper: { pos: { x: 10, y: 8 }, z: 0, width: 7.5, holding: null },
    bag: { pos: BAG_POS, opening: 9, contents: [] },
    stagesDone: 0,
    lastSkill: null,
    consecutiveFailures: 0,
    ...over,
  };
}

const CORRECTIONS: CorrectionEvent[] = [
  {
    id: "c1",
    runId: "run-1",
    ts: 6600,
    tStop: 6400,
    transcript: "a bit to the left",
    parsedCommand: { skill: "nudge", dx: -1.5, dy: 0 },
    parseSource: "grammar",
    rejectedPolicyAction: { command: { skill: "grasp" }, reasoning: "Grasp the tape holder." },
    stateBefore: [
      worldState({
        stagesDone: 1,
        bag: { pos: BAG_POS, opening: 9, contents: ["marker"] },
        lastSkill: { command: { skill: "grasp" }, outcome: "slipped" },
        consecutiveFailures: 1,
      }),
    ],
    outcome: "ok",
    latency: { stopMs: 290, parseMs: 1 },
    preventive: false,
  },
  {
    id: "c2",
    runId: "run-1",
    ts: 15400,
    tStop: 15100,
    transcript: "squeeze it first",
    parsedCommand: { skill: "squeeze" },
    parseSource: "grammar",
    rejectedPolicyAction: { command: { skill: "release" }, reasoning: "Drop the sponge into the bag." },
    stateBefore: [
      worldState({
        t: 15100,
        stagesDone: 2,
        gripper: { pos: BAG_POS, z: 6, width: 6, holding: "sponge" },
        objects: OBJECTS.map((o) => ({
          id: o.id, label: o.label, pos: o.estimatedPos, size: o.size,
          state: o.id === "sponge" ? "held" : o.id === "marker" ? "in_bag" : "in_bag",
          compressed: false,
        })),
        bag: { pos: BAG_POS, opening: 7, contents: ["marker", "tape_holder"] },
        lastSkill: { command: { skill: "release" }, outcome: "blocked" },
        consecutiveFailures: 1,
      }),
    ],
    outcome: "ok",
    latency: { stopMs: 340, parseMs: 1 },
    preventive: false,
  },
  {
    id: "c3",
    runId: "run-2",
    ts: 4200,
    tStop: 4000,
    transcript: "put the marker last",
    parsedCommand: { skill: "move_to", target: "tape_holder" },
    parseSource: "llm",
    rejectedPolicyAction: { command: { skill: "move_to", target: "marker" }, reasoning: "The marker is nearest." },
    stateBefore: [
      worldState({
        t: 4000,
        seed: 7,
        stagesDone: 0,
        gripper: { pos: { x: 0, y: 0 }, z: 8, width: 6, holding: null },
        bag: { pos: BAG_POS, opening: 10, contents: [] },
        lastSkill: { command: { skill: "release" }, outcome: "rolled_out" },
      }),
    ],
    outcome: "ok",
    latency: { stopMs: 305, parseMs: 820 },
    preventive: true,
  },
];

// ---------------------------------------------------------------------------

const line = (s = "") => console.log(s);

/** 1-token probe: does this key have access to this model? */
async function canUse(model: string): Promise<boolean> {
  try {
    await chatJSON({
      model,
      system: "Reply with JSON.",
      user: "ok",
      schema: {
        type: "object",
        properties: { ok: { type: "boolean" } },
        required: ["ok"],
        additionalProperties: false,
      },
      schemaName: "probe",
      maxTokens: 16,
      timeoutMs: 15_000,
    });
    return true;
  } catch (err) {
    const msg = (err as Error).message;
    if (/does not have access|not entitled|unauthorized/i.test(msg)) return false;
    // Rate limits / transient failures are not an entitlement answer.
    return !/HTTP 40[03]/.test(msg);
  }
}

async function firstEntitled(ids: string[]): Promise<string | null> {
  for (const id of ids) {
    if (await canUse(id)) return id;
  }
  return null;
}
/** Free-tier gateway keys are rate limited; space the calls out. */
const pace = () => new Promise((r) => setTimeout(r, Number(process.env.EARSHOT_SMOKE_PACE_MS ?? 3000)));
const rule = () => line("-".repeat(72));

async function main() {
  if (!process.env.ASSEMBLYAI_API_KEY) {
    line("ASSEMBLYAI_API_KEY is not set (looked in .env.local and .env).");
    process.exit(1);
  }

  line(`configured fast model : ${FAST_MODEL}`);
  line(`configured smart model: ${SMART_MODEL}`);

  let fast = FAST_MODEL;
  let smart = SMART_MODEL;
  try {
    const models = await listModels();
    const withRF = models.filter((m) => m.supported_parameters.includes("response_format"));
    line(`gateway catalogue: ${models.length} models, ${withRF.length} advertise response_format`);

    // The catalogue lists every model; entitlement is per key. Probe.
    if (!(await canUse(FAST_MODEL))) {
      line(`  !! this API key is not entitled to ${FAST_MODEL}`);
      const found = await firstEntitled(models.map((m) => m.id));
      if (!found) {
        line("  !! this API key is not entitled to ANY LLM Gateway model.");
        line("     Enable the LLM Gateway / add billing on the AssemblyAI dashboard,");
        line("     or set EARSHOT_FAST_MODEL / EARSHOT_SMART_MODEL to an entitled model.");
      } else {
        line(`  -> falling back to "${found}" for this smoke run`);
        fast = found;
        smart = found;
      }
    }
  } catch (err) {
    line(`could not list models: ${(err as Error).message}`);
  }
  line(`using fast=${fast} smart=${smart}`);

  // (a) base policy ---------------------------------------------------------
  await pace();
  rule();
  line("(a) decide() — BASE_POLICY, gripper just arrived over the tape holder");
  const a = await decideWithMeta(OVER_TAPE, BASE_POLICY, { model: fast, timeoutMs: 20_000 });
  line(`    command  : ${describeCommand(a.decision.command)}`);
  line(`    reasoning: ${a.decision.reasoning}`);
  line(`    latency  : ${a.latencyMs} ms${a.fallback ? "  (FALLBACK — gateway unavailable)" : ""}`);
  if (a.error) line(`    error    : ${a.error}`);

  // (b) with a learned rule -------------------------------------------------
  await pace();
  rule();
  line("(b) decide() — same observation, policy v1 with the tape-holder rule");
  const b = await decideWithMeta(OVER_TAPE, TAPE_RULE_POLICY, { model: fast, timeoutMs: 20_000 });
  line(`    command  : ${describeCommand(b.decision.command)}`);
  line(`    reasoning: ${b.decision.reasoning}`);
  line(`    latency  : ${b.latencyMs} ms${b.fallback ? "  (FALLBACK — gateway unavailable)" : ""}`);
  if (b.error) line(`    error    : ${b.error}`);
  line(
    `    => decision ${
      describeCommand(a.decision.command) === describeCommand(b.decision.command)
        ? "DID NOT CHANGE"
        : "CHANGED"
    } when the rule was added`,
  );

  // (c) distillation --------------------------------------------------------
  await pace();
  rule();
  line(`(c) distill() — ${CORRECTIONS.length} corrections -> policy v1`);
  const startedAt = Date.now();
  try {
    const next = await distill({
      policy: BASE_POLICY,
      corrections: CORRECTIONS,
      runs: [
        { id: "run-1", seed: 7, policyVersion: 0, correctionsEnabled: true, startedAt: 0, endedAt: 30_000, durationMs: 30_000, stagesDone: 3, success: true, interventions: 2, correctionIds: ["c1", "c2"] },
        { id: "run-2", seed: 7, policyVersion: 0, correctionsEnabled: true, startedAt: 0, endedAt: 22_000, durationMs: 22_000, stagesDone: 3, success: true, interventions: 1, correctionIds: ["c3"] },
      ],
    }, { model: smart, timeoutMs: 90_000 });
    line(`    latency  : ${Date.now() - startedAt} ms`);
    line(`    version  : v${next.version} (parent v${next.parentVersion})`);
    line(`    changelog: ${next.changelog}`);
    line("    rules:");
    for (const r of next.rules) {
      line(`      [${r.id}] WHEN ${r.when}`);
      line(`             DO   ${r.do}   (evidence: ${r.evidence.join(", ") || "none"})`);
    }
    line("    few-shots:");
    for (const f of next.fewShots) {
      line(`      [${f.id}] ${f.observationSummary} -> ${describeCommand(f.command)}`);
    }
    const d = diffPolicies(BASE_POLICY, next);
    line(`    diff: +${d.added.length} rules, -${d.removed.length} rules, +${d.addedFewShots.length} few-shots`);
  } catch (err) {
    line(`    FAILED after ${Date.now() - startedAt} ms: ${(err as Error).message}`);
  }

  rule();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
