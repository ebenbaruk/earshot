/**
 * Headless end-to-end run with the REAL LLM policy and a scripted operator.
 *
 *   pnpm dry-run                 # seed 42, v0 with operator → distill → v1 alone
 *   pnpm dry-run 42 7 99         # several seeds
 *   EARSHOT_DRY_VERBOSE=1        # print every decision
 *
 * The scripted operator behaves like the demo presenter: it says "put the
 * marker in last" when the policy goes for the marker first, "a bit to the
 * left" when a grasp on the tape slips, and "squeeze it first" when the sponge
 * is blocked at the bag. Each correction goes through the same grammar /
 * order-hint / constraints code as the browser.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { OBJECT_COUNT, type CorrectionEvent, type Observation, type PolicyDecision, type PolicyVersion, type RunRecord, type SkillCommand, type SkillOutcome } from "../lib/types";
import { createEngine } from "../lib/sim/engine";
import { runSkill } from "../lib/sim/driver";
import { BASE_POLICY } from "../lib/policy/base-policy";
import { decideWithMeta } from "../lib/policy/decide";
import { fallbackDecision } from "../lib/policy/fallback";
import { distill } from "../lib/policy/distill";
import { extractOrderHint, parseCorrectionFast } from "../lib/corrections/grammar";
import { resolveOrderHint } from "../lib/corrections/order";
import { applyConstraints, cloneConstraints, deriveConstraints, learnFromCorrection, retryAfterNudge } from "../lib/earshot/constraints";
import { isDithering } from "../lib/earshot/watchdog";
import { describeCommand } from "../lib/policy/command-codec";

for (const file of [".env.local", ".env"]) {
  try {
    for (const line of readFileSync(resolve(process.cwd(), file), "utf8").split("\n")) {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
    }
  } catch { /* optional */ }
}

const VERBOSE = process.env.EARSHOT_DRY_VERBOSE === "1";
const MAX_STEPS = 60;

interface Operator {
  enabled: boolean;
  /** Returns a spoken correction for the situation, or null. */
  say(obs: Observation, last: { command: SkillCommand; outcome: SkillOutcome } | null, saidBefore: Set<string>): string | null;
}

const demoOperator: Operator = {
  enabled: true,
  say(obs, last, saidBefore) {
    if (!last) return null;
    const remaining = obs.objects.filter((o) => o.state === "on_table" || o.state === "rolled_out");
    // Going for the marker while other objects remain → "marker last".
    if (
      last.command.skill === "move_to" && last.command.target === "marker" && remaining.length > 1 &&
      !saidBefore.has("marker-last")
    ) { saidBefore.add("marker-last"); return "stop, put the marker in last"; }
    // Slip on the tape → nudge left.
    const nearTape = obs.objects.find((o) => o.id === "tape_holder");
    if (
      last.command.skill === "grasp" && last.outcome === "slipped" && nearTape &&
      Math.hypot(nearTape.estimatedPos.x - obs.gripper.pos.x, nearTape.estimatedPos.y - obs.gripper.pos.y) < 4 &&
      !saidBefore.has("tape-left")
    ) { saidBefore.add("tape-left"); return "stop, a bit to the left"; }
    // Holding the egg over the bag → preventive "lower it first" (an irreversible mistake otherwise).
    if (last.command.skill === "move_to" && last.command.target === "bag" && obs.gripper.holding === "egg" && !saidBefore.has("egg-low")) {
      saidBefore.add("egg-low"); return "stop, lower it first";
    }
    // Sponge blocked at the bag → squeeze.
    if (last.command.skill === "release" && last.outcome === "blocked" && obs.gripper.holding === "sponge" && !saidBefore.has("squeeze")) {
      saidBefore.add("squeeze"); return "stop, squeeze it first";
    }
    return null;
  },
};

async function runOnce(seed: number, policy: PolicyVersion, operator: Operator, runId: string) {
  const e = createEngine(seed);
  e.start();
  const constraints = cloneConstraints(policy.constraints);
  const corrections: CorrectionEvent[] = [];
  const said = new Set<string>();
  let recent: string[] = [];
  let steps = 0; let llmMs = 0; let fallbacks = 0;
  let last: { command: SkillCommand; outcome: SkillOutcome } | null = null;
  let inFlight: PolicyDecision | null = null;

  while (steps < MAX_STEPS && e.world.status === "running") {
    // Operator reacts to what just happened.
    const utter = operator.enabled ? operator.say(e.getObservation(), last, said) : null;
    if (utter) {
      const text = utter.replace(/^stop,?\s*/i, "");
      const obs = e.getObservation();
      const hint = extractOrderHint(text);
      let cmd = parseCorrectionFast(text);
      if (!cmd && hint) cmd = resolveOrderHint(hint, obs);
      if (cmd) {
        let r = await runSkill(e, cmd);
        if (r.outcome === "ok") learnFromCorrection(constraints, cmd, obs, hint);
        const retry = r.outcome === "ok" ? retryAfterNudge(cmd, obs) : null;
        if (retry) r = await runSkill(e, retry);
        corrections.push({
          id: `c${corrections.length + 1}`, runId, ts: e.world.t, tStop: e.world.t, transcript: utter,
          parsedCommand: cmd, parseSource: "grammar", rejectedPolicyAction: inFlight,
          stateBefore: [e.world], outcome: r.outcome, latency: { stopMs: 200, parseMs: 1 }, preventive: false,
        });
        if (VERBOSE) console.log(`   🗣  "${utter}" → ${describeCommand(cmd)} → ${r.outcome}`);
        last = { command: cmd, outcome: r.outcome };
        continue;
      }
    }

    const obs = e.getObservation();
    const meta = await decideWithMeta(obs, policy);
    llmMs += meta.latencyMs; if (meta.fallback) fallbacks++;
    let decision = meta.decision;
    if (decision.command.skill === "stop" && e.world.stagesDone < OBJECT_COUNT) {
      decision = { ...fallbackDecision(obs), reasoning: "[override: early stop]" };
    }
    recent.push(JSON.stringify(decision.command)); if (recent.length > 4) recent.shift();
    if (isDithering(recent)) { decision = { ...fallbackDecision(obs), reasoning: "[override: looping]" }; recent = []; }
    const shaped = applyConstraints(constraints, decision.command, obs);
    inFlight = decision;
    for (const pre of shaped.preSteps) await runSkill(e, pre);
    const r = await runSkill(e, shaped.command);
    let outcome = r.outcome;
    if (shaped.followUp && outcome === "ok" && e.world.status === "running") outcome = (await runSkill(e, shaped.followUp)).outcome;
    if (VERBOSE) console.log(`${String(++steps).padStart(2)}  ${describeCommand(shaped.command).padEnd(24)} ${outcome.padEnd(10)} stages=${e.world.stagesDone} t=${e.world.t}  ${decision.reasoning}${shaped.note ? ` [${shaped.note}]` : ""}`);
    else steps++;
    last = { command: shaped.command, outcome };
  }
  const w = e.world;
  const record: RunRecord = {
    id: runId, seed, policyVersion: policy.version, correctionsEnabled: operator.enabled, startedAt: 0, endedAt: 1,
    durationMs: w.t, stagesDone: w.stagesDone, success: w.status === "succeeded", interventions: corrections.length,
    correctionIds: corrections.map((c) => c.id),
  };
  return { record, corrections, steps, llmMs, fallbacks, status: w.status };
}

async function main() {
  const seeds = process.argv.slice(2).map(Number).filter((n) => Number.isFinite(n));
  if (seeds.length === 0) seeds.push(42);
  const rows: string[] = [];
  for (const seed of seeds) {
    console.log(`\n=== seed ${seed} — run A: v0 + operator ===`);
    const a = await runOnce(seed, BASE_POLICY, demoOperator, `run-${seed}-a`);
    console.log(`   ${a.status} stages=${a.record.stagesDone} interventions=${a.record.interventions} steps=${a.steps} llm=${Math.round(a.llmMs / Math.max(1, a.steps))}ms/step fallbacks=${a.fallbacks}`);
    console.log(`=== seed ${seed} — distill ===`);
    const t0 = Date.now();
    let v1: PolicyVersion;
    try {
      v1 = await distill({ policy: BASE_POLICY, corrections: a.corrections, runs: [a.record] });
      v1.constraints = deriveConstraints(a.corrections, BASE_POLICY.constraints);
      console.log(`   skill-layer facts: ${JSON.stringify(v1.constraints)}`);
    } catch (err) {
      console.log(`   distill FAILED: ${(err as Error).message}`);
      rows.push(`seed ${String(seed).padEnd(4)} | v0+operator: ${a.status} ${a.record.stagesDone}/${OBJECT_COUNT}, ${a.record.interventions} corrections | distill failed`);
      continue;
    }
    console.log(`   v${v1.version} in ${Date.now() - t0} ms: ${v1.rules.length} rules`);
    for (const r of v1.rules) console.log(`   - WHEN ${r.when}\n     DO ${r.do}`);
    console.log(`=== seed ${seed} — run B: v1 alone ===`);
    const b = await runOnce(seed, v1, { ...demoOperator, enabled: false }, `run-${seed}-b`);
    console.log(`   ${b.status} stages=${b.record.stagesDone} steps=${b.steps} fallbacks=${b.fallbacks}`);
    rows.push(`seed ${String(seed).padEnd(4)} | v0+operator: ${a.status.padEnd(9)} ${a.record.stagesDone}/${OBJECT_COUNT}, ${a.record.interventions} corrections | v1 alone: ${b.status.padEnd(9)} ${b.record.stagesDone}/${OBJECT_COUNT}`);
  }
  console.log("\n" + rows.join("\n"));
}

main().catch((err) => { console.error(err); process.exit(1); });
