"use client";

/**
 * MOCK DRIVER — delete `components/mock/` at integration time.
 *
 * Plays a scripted demo run on a 100 ms timer so the page is fully alive for
 * design review: the gripper moves, the policy narrates itself, a preventive
 * nudge lands, a "stop" is caught on a partial with a measured latency, three
 * stages get packed, the run is recorded, and it loops.
 *
 * It returns exactly `{ vm, actions }` — the same pair the integrator will
 * build from the real stores. Nothing else in `components/**` imports this.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  CorrectionEvent,
  ObjectId,
  PolicyDecision,
  PolicyVersion,
  RunRecord,
  SimStatus,
  SkillCommand,
  Vec2,
  VoiceStatus,
  WorldState,
} from "@/lib/types";
import type {
  EarshotActions,
  EarshotViewModel,
  StopFlash,
} from "../view-model";
import {
  HOME,
  MOCK_CORRECTIONS,
  MOCK_POLICIES,
  MOCK_RUNS,
  MOCK_SEED,
  makePolicyV2,
  makeWorld,
} from "./fixtures";

const TICK_MS = 100;
const DISTILL_MS = 1800;
const CONNECT_MS = 700;
const FLASH_MS = 1100;
const RESTART_DELAY = 4200;

/* -------------------------------------------------------------------------- */
/* Script                                                                      */
/* -------------------------------------------------------------------------- */

type MoveTargetName = ObjectId | "bag" | "home";

interface Step {
  at: number;
  say?: PolicyDecision;
  to?: MoveTargetName;
  z?: number;
  width?: number;
  hold?: ObjectId | null;
  compress?: boolean;
  stage?: number;
  partial?: string;
  stop?: { word: string; latencyMs: number };
  correction?: {
    transcript: string;
    command: SkillCommand | null;
    source: CorrectionEvent["parseSource"];
    parseMs: number;
    preventive: boolean;
  };
  status?: SimStatus;
  end?: boolean;
}

const D = (command: SkillCommand, reasoning: string): PolicyDecision => ({
  command,
  reasoning,
});

const SCRIPT: Step[] = [
  { at: 0, status: "running", say: D({ skill: "move_to", target: "sponge" }, "Sponge is the softest item — packing it first leaves room for the rigid ones."), to: "sponge", z: 8 },
  { at: 1500, say: D({ skill: "set_gripper", width: 9 }, "Opening the jaw to the sponge's 9 cm width before descending.") , width: 9 },
  { at: 2600, say: D({ skill: "descend" }, "Lowering onto the sponge."), z: 0.5 },
  { at: 3600, say: D({ skill: "grasp" }, "Closing on the sponge."), width: 5, hold: "sponge" },
  { at: 4600, say: D({ skill: "squeeze" }, "Rule r1: compress the sponge before it goes in the bag."), width: 3.5, compress: true },
  { at: 5600, say: D({ skill: "move_to", target: "bag" }, "Carrying the compressed sponge to the bag."), to: "bag", z: 7 },
  { at: 7000, say: D({ skill: "release" }, "Dropping the sponge into the bag."), width: 9, hold: null, stage: 1 },

  { at: 7900, say: D({ skill: "move_to", target: "marker" }, "Marker next — it is thin, so it should nest along the side."), to: "marker", z: 7 },
  { at: 8700, partial: "a bit" },
  { at: 9100, partial: "a bit to the" },
  { at: 9500, partial: "a bit to the left" },
  {
    at: 10000,
    correction: {
      transcript: "a bit to the left",
      command: { skill: "nudge", dx: -2, dy: 0 },
      source: "grammar",
      parseMs: 118,
      preventive: true,
    },
  },
  { at: 10600, say: D({ skill: "descend" }, "Corrected 2 cm left of centre; lowering onto the marker."), z: 0.5 },
  { at: 11600, say: D({ skill: "grasp" }, "Closing on the marker."), width: 3, hold: "marker" },
  { at: 12500, say: D({ skill: "lift" }, "Lifting clear of the table."), z: 8 },
  { at: 13400, say: D({ skill: "move_to", target: "bag" }, "Carrying the marker to the bag."), to: "bag" },

  { at: 14600, partial: "stop", stop: { word: "stop", latencyMs: 212 }, status: "paused" },
  { at: 15200, partial: "stop the bag is too narrow" },
  {
    at: 15900,
    correction: {
      transcript: "the bag is too narrow — widen it first",
      command: { skill: "widen_bag" },
      source: "grammar",
      parseMs: 164,
      preventive: false,
    },
    status: "running",
  },
  { at: 16800, say: D({ skill: "widen_bag" }, "Operator override: opening the bag before descending.") },
  { at: 17800, say: D({ skill: "release" }, "Bag is open; releasing the marker."), width: 9, hold: null, stage: 2 },

  { at: 18800, say: D({ skill: "move_to", target: "tape_holder" }, "Tape holder last — it is the widest item."), to: "tape_holder", z: 7 },
  { at: 19900, say: D({ skill: "set_gripper", width: 9 }, "Rule r3: the default 6 cm jaw slips off the rim."), width: 9 },
  { at: 20800, say: D({ skill: "descend" }, "Lowering onto the tape holder."), z: 0.5 },
  { at: 21700, say: D({ skill: "grasp" }, "Closing on the rim."), width: 7, hold: "tape_holder" },
  { at: 22600, say: D({ skill: "lift" }, "Lifting clear."), z: 8 },
  { at: 23500, say: D({ skill: "move_to", target: "bag" }, "Final item to the bag."), to: "bag" },
  { at: 24800, say: D({ skill: "release" }, "All three items are in the bag."), width: 9, hold: null, stage: 3 },
  { at: 25600, status: "succeeded", end: true, to: "home", z: 9 },
];

const SCRIPT_END = SCRIPT[SCRIPT.length - 1].at;

/* -------------------------------------------------------------------------- */
/* Mini grammar for typed corrections                                          */
/* -------------------------------------------------------------------------- */

export function mockParse(raw: string): SkillCommand | null {
  const t = raw.toLowerCase().trim();
  if (!t) return null;
  if (/\b(stop|wait|halt|freeze|hold on)\b/.test(t)) return { skill: "stop" };
  if (/\bleft\b/.test(t)) return { skill: "nudge", dx: -2, dy: 0 };
  if (/\bright\b/.test(t)) return { skill: "nudge", dx: 2, dy: 0 };
  if (/\b(forward|further|away)\b/.test(t)) return { skill: "nudge", dx: 0, dy: 2 };
  if (/\b(back|closer|towards? me)\b/.test(t)) return { skill: "nudge", dx: 0, dy: -2 };
  if (/\b(squeeze|compress|squash)\b/.test(t)) return { skill: "squeeze" };
  if (/\bbag\b/.test(t) && /\b(wide|widen|open|narrow)\b/.test(t)) return { skill: "widen_bag" };
  if (/\b(wider|open the gripper)\b/.test(t)) return { skill: "set_gripper", width: 9 };
  if (/\b(tighter|narrower|smaller)\b/.test(t)) return { skill: "set_gripper", width: 4 };
  if (/\b(grab|grasp|pick|take)\b/.test(t)) return { skill: "grasp" };
  if (/\b(lift|raise|up)\b/.test(t)) return { skill: "lift" };
  if (/\b(drop|release|let go)\b/.test(t)) return { skill: "release" };
  if (/\b(down|descend|lower)\b/.test(t)) return { skill: "descend" };
  return null;
}

/* -------------------------------------------------------------------------- */
/* State                                                                       */
/* -------------------------------------------------------------------------- */

interface MockState {
  world: WorldState;
  status: SimStatus;
  t: number;
  seed: number;
  runIndex: number;
  correctionsEnabled: boolean;

  policies: PolicyVersion[];
  currentVersion: number;
  selectedVersion: number;
  decision: PolicyDecision | null;
  distilling: boolean;
  distillStartedAt: number | null;
  distillError: string | null;

  voice: VoiceStatus;
  voiceError: string | null;
  voiceConnectingSince: number | null;
  partial: string;
  stopFlash: StopFlash | null;

  corrections: CorrectionEvent[];
  runs: RunRecord[];

  // internals
  cursor: number;
  target: Vec2;
  targetZ: number;
  targetW: number;
  restartAt: number | null;
  nextCorrection: number;
  clock: number; // monotonic ms, independent of the run clock
}

function targetPos(name: MoveTargetName, world: WorldState): Vec2 {
  if (name === "bag") return { x: world.bag.pos.x, y: world.bag.pos.y + 1 };
  if (name === "home") return { ...HOME.pos };
  const o = world.objects.find((x) => x.id === name);
  return o ? { ...o.pos } : { ...HOME.pos };
}

function freshRun(seed: number, runIndex: number): Pick<
  MockState,
  "world" | "status" | "t" | "cursor" | "target" | "targetZ" | "targetW" | "restartAt" | "decision" | "partial" | "stopFlash" | "runIndex" | "seed"
> {
  const world = makeWorld({ seed, status: "idle" });
  return {
    world,
    status: "idle",
    t: 0,
    cursor: 0,
    target: { ...HOME.pos },
    targetZ: HOME.z,
    targetW: HOME.width,
    restartAt: null,
    decision: null,
    partial: "",
    stopFlash: null,
    runIndex,
    seed,
  };
}

function initialState(): MockState {
  return {
    ...freshRun(MOCK_SEED, MOCK_RUNS.length + 1),
    status: "running",
    correctionsEnabled: true,
    policies: MOCK_POLICIES,
    currentVersion: 1,
    selectedVersion: 1,
    distilling: false,
    distillStartedAt: null,
    distillError: null,
    voice: "listening",
    voiceError: null,
    voiceConnectingSince: null,
    corrections: MOCK_CORRECTIONS,
    runs: MOCK_RUNS,
    nextCorrection: MOCK_CORRECTIONS.length + 1,
    clock: 0,
  };
}

const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

function advance(s: MockState, dt: number): MockState {
  let n: MockState = { ...s, clock: s.clock + dt };

  // distil finishes
  if (n.distilling && n.distillStartedAt != null && n.clock - n.distillStartedAt >= DISTILL_MS) {
    const parent = n.policies[n.policies.length - 1];
    const pending = n.corrections
      .filter((c) => !consumed(n.policies).has(c.id))
      .map((c) => c.id);
    const next = makePolicyV2(parent, pending, Date.now());
    n = {
      ...n,
      distilling: false,
      distillStartedAt: null,
      policies: [...n.policies, next],
      currentVersion: next.version,
      selectedVersion: next.version,
    };
  }

  // mic connecting → listening
  if (n.voice === "connecting" && n.voiceConnectingSince != null && n.clock - n.voiceConnectingSince >= CONNECT_MS) {
    n = { ...n, voice: "listening", voiceConnectingSince: null };
  }

  // stop flash decays
  if (n.stopFlash && n.t - n.stopFlash.at > FLASH_MS) n = { ...n, stopFlash: null };

  // restart the loop
  if (n.restartAt != null && n.clock >= n.restartAt) {
    return {
      ...n,
      ...freshRun(n.seed, n.runIndex + 1),
      status: "running",
    };
  }

  if (n.status !== "running" && n.status !== "paused") return n;

  const t = n.t + dt;
  let world: WorldState = { ...n.world, t };
  let { cursor, target, targetZ, targetW, decision, partial, stopFlash, corrections, runs, nextCorrection, restartAt } = n;
  let status: SimStatus = n.status;

  while (cursor < SCRIPT.length && SCRIPT[cursor].at <= t) {
    const step = SCRIPT[cursor];
    cursor += 1;

    if (step.say) decision = step.say;
    if (step.to) target = targetPos(step.to, world);
    if (step.z != null) targetZ = step.z;
    if (step.width != null) targetW = step.width;
    if (step.partial != null) partial = step.partial;
    if (step.status) status = step.status;

    if (step.hold !== undefined) {
      world = {
        ...world,
        gripper: { ...world.gripper, holding: step.hold },
        objects: world.objects.map((o) =>
          o.id === step.hold
            ? { ...o, state: "held" }
            : o.state === "held" && step.hold === null
              ? { ...o, state: "in_bag" }
              : o,
        ),
      };
    }
    if (step.compress) {
      world = {
        ...world,
        objects: world.objects.map((o) =>
          o.state === "held" ? { ...o, compressed: true } : o,
        ),
      };
    }
    if (step.stage != null) {
      const packed = world.objects.filter((o) => o.state === "in_bag").map((o) => o.id);
      world = { ...world, stagesDone: step.stage, bag: { ...world.bag, contents: packed } };
    }
    if (step.stop && n.correctionsEnabled) {
      stopFlash = { at: t, latencyMs: step.stop.latencyMs, word: step.stop.word };
    }
    if (step.correction && n.correctionsEnabled) {
      const id = `c${nextCorrection}`;
      nextCorrection += 1;
      corrections = [
        ...corrections,
        {
          id,
          runId: `run-${n.runIndex}`,
          ts: t,
          tStop: stopFlash ? stopFlash.at : null,
          transcript: step.correction.transcript,
          parsedCommand: step.correction.command,
          parseSource: step.correction.source,
          rejectedPolicyAction: decision,
          stateBefore: historyOf(world),
          outcome: "ok",
          latency: {
            stopMs: stopFlash ? stopFlash.latencyMs : null,
            parseMs: step.correction.parseMs,
          },
          preventive: step.correction.preventive,
        },
      ];
      partial = "";
    }
    if (step.end) {
      const id = `run-${n.runIndex}`;
      const mine = corrections.filter((c) => c.runId === id);
      runs = [
        ...runs,
        {
          id,
          seed: n.seed,
          policyVersion: n.currentVersion,
          correctionsEnabled: n.correctionsEnabled,
          startedAt: Date.now() - t,
          endedAt: Date.now(),
          durationMs: t,
          stagesDone: world.stagesDone,
          success: world.stagesDone === 3,
          interventions: mine.length,
          correctionIds: mine.map((c) => c.id),
        },
      ];
      restartAt = n.clock + RESTART_DELAY;
    }
  }

  // ease the gripper toward its target
  const k = status === "paused" ? 0 : Math.min(1, (0.24 * dt) / TICK_MS);
  world = {
    ...world,
    status,
    gripper: {
      ...world.gripper,
      pos: {
        x: lerp(world.gripper.pos.x, target.x, k),
        y: lerp(world.gripper.pos.y, target.y, k),
      },
      z: lerp(world.gripper.z, targetZ, k),
      width: lerp(world.gripper.width, targetW, k),
    },
    lastSkill: decision ? { command: decision.command, outcome: "ok" } : null,
  };

  if (t > SCRIPT_END + 400 && status === "running") status = "succeeded";

  return {
    ...n,
    t,
    world,
    status,
    cursor,
    target,
    targetZ,
    targetW,
    decision,
    partial,
    stopFlash,
    corrections,
    runs,
    nextCorrection,
    restartAt,
  };
}

function historyOf(world: WorldState): WorldState[] {
  return [-1600, -800, 0].map((dt) => ({
    ...world,
    t: Math.max(0, world.t + dt),
    gripper: {
      ...world.gripper,
      pos: {
        x: world.gripper.pos.x + dt / 900,
        y: world.gripper.pos.y + dt / 2200,
      },
    },
  }));
}

function consumed(policies: PolicyVersion[]): Set<string> {
  const set = new Set<string>();
  for (const p of policies) for (const id of p.distilledFrom) set.add(id);
  return set;
}

/* -------------------------------------------------------------------------- */
/* Hook                                                                        */
/* -------------------------------------------------------------------------- */

export function useMockEarshot(): {
  vm: EarshotViewModel;
  actions: EarshotActions;
} {
  const [s, set] = useState<MockState>(initialState);

  useEffect(() => {
    // Wall-clock deltas, not tick counts: background tabs throttle timers to ~1 Hz
    // and the demo would otherwise crawl while it is not the focused tab.
    let last = performance.now();
    const id = window.setInterval(() => {
      const now = performance.now();
      const dt = Math.min(500, now - last);
      last = now;
      set((prev) => advance(prev, dt));
    }, TICK_MS);
    return () => window.clearInterval(id);
  }, []);

  const actions = useMemo<EarshotActions>(
    () => ({
      run: () =>
        set((p) =>
          p.status === "succeeded" || p.status === "failed"
            ? { ...p, ...freshRun(p.seed, p.runIndex + 1), status: "running" }
            : { ...p, status: "running", world: { ...p.world, status: "running" } },
        ),
      pause: () =>
        set((p) => ({ ...p, status: "paused", world: { ...p.world, status: "paused" } })),
      reset: (seed) =>
        set((p) => ({
          ...p,
          ...freshRun(seed ?? p.seed, p.runIndex),
          status: "idle",
        })),
      setSeed: (seed) => set((p) => ({ ...p, seed, world: { ...p.world, seed } })),
      setCorrectionsEnabled: (enabled) =>
        set((p) => ({ ...p, correctionsEnabled: enabled })),
      selectVersion: (version) => set((p) => ({ ...p, selectedVersion: version })),
      activateVersion: (version) =>
        set((p) => ({ ...p, currentVersion: version, selectedVersion: version })),
      distill: () =>
        set((p) =>
          p.distilling
            ? p
            : { ...p, distilling: true, distillStartedAt: p.clock, distillError: null },
        ),
      startVoice: () =>
        set((p) => ({
          ...p,
          voice: "connecting",
          voiceConnectingSince: p.clock,
          voiceError: null,
        })),
      stopVoice: () =>
        set((p) => ({ ...p, voice: "off", partial: "", voiceConnectingSince: null })),
      sendTextCorrection: (text) =>
        set((p) => {
          const trimmed = text.trim();
          if (!trimmed) return p;
          const id = `c${p.nextCorrection}`;
          return {
            ...p,
            nextCorrection: p.nextCorrection + 1,
            corrections: [
              ...p.corrections,
              {
                id,
                runId: `run-${p.runIndex}`,
                ts: p.t,
                tStop: null,
                transcript: trimmed,
                parsedCommand: mockParse(trimmed),
                parseSource: "text",
                rejectedPolicyAction: p.decision,
                stateBefore: historyOf(p.world),
                outcome: "ok",
                latency: { stopMs: null, parseMs: null },
                preventive: true,
              },
            ],
          };
        }),
      exportJSON: () => "{}",
      importJSON: () => {},
    }),
    [],
  );

  const exportJSON = useCallback(
    () =>
      JSON.stringify(
        { version: 1, exportedAt: Date.now(), runs: s.runs, corrections: s.corrections },
        null,
        2,
      ),
    [s.runs, s.corrections],
  );

  const vm = useMemo<EarshotViewModel>(() => {
    const used = consumed(s.policies);
    return {
      world: s.world,
      status: s.status,
      elapsedMs: s.t,
      seed: s.seed,
      runIndex: s.runIndex,
      correctionsEnabled: s.correctionsEnabled,
      policies: s.policies,
      currentVersion: s.currentVersion,
      selectedVersion: s.selectedVersion,
      decision: s.decision,
      policyThinking: nextDecisionIsClose(s),
      distilling: s.distilling,
      distillError: s.distillError,
      pendingCorrectionCount: s.corrections.filter((c) => !used.has(c.id)).length,
      voice: s.voice,
      voiceError: s.voiceError,
      partial: s.voice === "listening" ? s.partial : "",
      stopFlash: s.stopFlash,
      lastCorrection: s.corrections[s.corrections.length - 1] ?? null,
      corrections: s.corrections,
      runs: s.runs,
    };
  }, [s]);

  return useMemo(
    () => ({ vm, actions: { ...actions, exportJSON } }),
    [vm, actions, exportJSON],
  );
}

/** "thinking…" shows in the 400 ms before the policy emits its next skill. */
function nextDecisionIsClose(s: MockState): boolean {
  if (s.status !== "running") return false;
  for (let i = s.cursor; i < SCRIPT.length; i += 1) {
    if (SCRIPT[i].say) return SCRIPT[i].at - s.t <= 400;
  }
  return false;
}
