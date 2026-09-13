/**
 * MOCK DATA — delete `components/mock/` at integration time.
 *
 * Pre-seeded history so every panel is populated on first paint: four completed
 * runs (two supervised, two autonomous ablations), the corrections that drove
 * them, and policy v0 → v1. Timestamps are fixed constants, never `Date.now()`,
 * so server and client render identically.
 */

import type {
  BagState,
  CorrectionEvent,
  GripperState,
  PolicyVersion,
  RunRecord,
  SimObject,
  WorldState,
} from "@/lib/types";

export const MOCK_SEED = 4217;

/** Fixed epoch base (2026-09-13T12:00:00Z) — keeps SSR and CSR in lockstep. */
const T0 = 1_789_646_400_000;
const MINUTE = 60_000;

export const HOME: GripperState = {
  pos: { x: 0, y: -2 },
  z: 9,
  width: 6,
  holding: null,
};

export const BAG: BagState = {
  pos: { x: 0, y: -9 },
  opening: 12,
  contents: [],
};

export function baseObjects(): SimObject[] {
  return [
    {
      id: "sponge",
      label: "Sponge",
      pos: { x: -9, y: 5 },
      size: { w: 9, d: 6, h: 3.5 },
      state: "on_table",
      compressed: false,
    },
    {
      id: "tape_holder",
      label: "Tape holder",
      pos: { x: 1, y: 10 },
      size: { w: 8.5, d: 8.5, h: 4 },
      state: "on_table",
      compressed: false,
    },
    {
      id: "marker",
      label: "Marker",
      pos: { x: 11, y: 3 },
      size: { w: 13, d: 1.8, h: 1.8 },
      state: "on_table",
      compressed: false,
    },
  ];
}

export function makeWorld(patch: Partial<WorldState> = {}): WorldState {
  return {
    t: 0,
    seed: MOCK_SEED,
    status: "idle",
    objects: baseObjects(),
    gripper: { ...HOME, pos: { ...HOME.pos } },
    bag: { ...BAG, contents: [] },
    stagesDone: 0,
    lastSkill: null,
    consecutiveFailures: 0,
    ...patch,
  };
}

/** Three snapshots ~2 s apart, for the "context (2 s before)" expander. */
function contextBefore(
  t: number,
  g: Partial<GripperState>,
  stagesDone: number,
): WorldState[] {
  const at = (dt: number, dx: number) =>
    makeWorld({
      t: t + dt,
      status: "running",
      stagesDone,
      gripper: {
        ...HOME,
        ...g,
        pos: {
          x: (g.pos?.x ?? HOME.pos.x) + dx,
          y: g.pos?.y ?? HOME.pos.y,
        },
      },
    });
  return [at(-1600, -1.8), at(-800, -0.9), at(0, 0)];
}

/* -------------------------------------------------------------------------- */
/* Policy versions                                                             */
/* -------------------------------------------------------------------------- */

export const POLICY_V0: PolicyVersion = {
  version: 0,
  createdAt: T0,
  parentVersion: null,
  rules: [],
  fewShots: [],
  changelog: "Base policy — no learned rules yet.",
  distilledFrom: [],
};

export const POLICY_V1: PolicyVersion = {
  version: 1,
  createdAt: T0 + 11 * MINUTE,
  parentVersion: 0,
  rules: [
    {
      id: "r1",
      when: "the held object is the sponge and it has not been compressed",
      do: "squeeze() before move_to(bag)",
      evidence: ["c1", "c4"],
      addedInVersion: 1,
    },
    {
      id: "r2",
      when: "the bag opening looks narrow and the held object is wider than it",
      do: "widen_bag() before descending over the bag",
      evidence: ["c2"],
      addedInVersion: 1,
    },
    {
      id: "r3",
      when: "grasping the tape holder",
      do: "set_gripper(9) — the default 6 cm jaw slips off the rim",
      evidence: ["c3"],
      addedInVersion: 1,
    },
  ],
  fewShots: [
    {
      id: "f1",
      observationSummary:
        "holding sponge, over bag, bag.contents = [], sponge not compressed",
      command: { skill: "squeeze" },
      source: "c1",
      addedInVersion: 1,
    },
    {
      id: "f2",
      observationSummary:
        "gripper over tape_holder at (1.4, 9.6), width 6, last grasp slipped",
      command: { skill: "set_gripper", width: 9 },
      source: "c3",
      addedInVersion: 1,
    },
  ],
  changelog:
    "Three rules distilled from 4 corrections across runs 1–2. The operator stopped the arm twice for the same reason — a hard object driven into a narrow bag — so widening the bag is now a precondition, not a recovery.",
  distilledFrom: ["c1", "c2", "c3", "c4"],
};

export const MOCK_POLICIES: PolicyVersion[] = [POLICY_V0, POLICY_V1];

/* -------------------------------------------------------------------------- */
/* Corrections                                                                 */
/* -------------------------------------------------------------------------- */

export const MOCK_CORRECTIONS: CorrectionEvent[] = [
  {
    id: "c1",
    runId: "run-1",
    ts: 6200,
    tStop: null,
    transcript: "squeeze it first",
    parsedCommand: { skill: "squeeze" },
    parseSource: "grammar",
    rejectedPolicyAction: {
      command: { skill: "move_to", target: "bag" },
      reasoning: "Sponge is held; carry it over the bag and release.",
    },
    stateBefore: contextBefore(6200, { holding: "sponge", z: 7, width: 4.5, pos: { x: -6, y: 2 } }, 0),
    outcome: "ok",
    latency: { stopMs: null, parseMs: 141 },
    preventive: true,
  },
  {
    id: "c2",
    runId: "run-1",
    ts: 13400,
    tStop: 13188,
    transcript: "stop — widen the bag first",
    parsedCommand: { skill: "widen_bag" },
    parseSource: "grammar",
    rejectedPolicyAction: {
      command: { skill: "descend" },
      reasoning: "Tape holder is over the bag; lower it in.",
    },
    stateBefore: contextBefore(13400, { holding: "tape_holder", z: 6, width: 9, pos: { x: 0.4, y: -8 } }, 1),
    outcome: "ok",
    latency: { stopMs: 212, parseMs: 168 },
    preventive: false,
  },
  {
    id: "c3",
    runId: "run-1",
    ts: 19850,
    tStop: null,
    transcript: "open the gripper wider before you grab that",
    parsedCommand: { skill: "set_gripper", width: 9 },
    parseSource: "llm",
    rejectedPolicyAction: {
      command: { skill: "grasp" },
      reasoning: "Centred on the tape holder; close the jaw.",
    },
    stateBefore: contextBefore(19850, { z: 1.5, width: 6, pos: { x: 1.1, y: 9.6 } }, 1),
    outcome: "ok",
    latency: { stopMs: null, parseMs: 402 },
    preventive: true,
  },
  {
    id: "c4",
    runId: "run-1",
    ts: 26100,
    tStop: 25902,
    transcript: "no no — squeeze the sponge",
    parsedCommand: { skill: "squeeze" },
    parseSource: "grammar",
    rejectedPolicyAction: {
      command: { skill: "release" },
      reasoning: "Sponge is above the bag opening; drop it.",
    },
    stateBefore: contextBefore(26100, { holding: "sponge", z: 5, width: 5, pos: { x: 0.2, y: -8.6 } }, 1),
    outcome: "ok",
    latency: { stopMs: 244, parseMs: 129 },
    preventive: false,
  },
  {
    id: "c5",
    runId: "run-3",
    ts: 9400,
    tStop: null,
    transcript: "a bit to the left",
    parsedCommand: { skill: "nudge", dx: -2, dy: 0 },
    parseSource: "grammar",
    rejectedPolicyAction: {
      command: { skill: "descend" },
      reasoning: "Gripper looks centred over the marker; go down.",
    },
    stateBefore: contextBefore(9400, { z: 4, width: 6, pos: { x: 12.4, y: 3.1 } }, 1),
    outcome: "ok",
    latency: { stopMs: null, parseMs: 118 },
    preventive: true,
  },
];

/* -------------------------------------------------------------------------- */
/* Completed runs                                                              */
/* -------------------------------------------------------------------------- */

export const MOCK_RUNS: RunRecord[] = [
  {
    id: "run-1",
    seed: MOCK_SEED,
    policyVersion: 0,
    correctionsEnabled: true,
    startedAt: T0,
    endedAt: T0 + 31_000,
    durationMs: 31_000,
    stagesDone: 2,
    success: false,
    interventions: 4,
    correctionIds: ["c1", "c2", "c3", "c4"],
  },
  {
    id: "run-2",
    seed: MOCK_SEED,
    policyVersion: 0,
    correctionsEnabled: false,
    startedAt: T0 + 4 * MINUTE,
    endedAt: T0 + 4 * MINUTE + 24_000,
    durationMs: 24_000,
    stagesDone: 1,
    success: false,
    interventions: 0,
    correctionIds: [],
  },
  {
    id: "run-3",
    seed: MOCK_SEED,
    policyVersion: 1,
    correctionsEnabled: true,
    startedAt: T0 + 13 * MINUTE,
    endedAt: T0 + 13 * MINUTE + 28_500,
    durationMs: 28_500,
    stagesDone: 3,
    success: true,
    interventions: 1,
    correctionIds: ["c5"],
  },
  {
    id: "run-4",
    seed: MOCK_SEED,
    policyVersion: 1,
    correctionsEnabled: false,
    startedAt: T0 + 17 * MINUTE,
    endedAt: T0 + 17 * MINUTE + 26_200,
    durationMs: 26_200,
    stagesDone: 3,
    success: true,
    interventions: 0,
    correctionIds: [],
  },
];

/** What the Distill button produces in the mock. */
export function makePolicyV2(
  parent: PolicyVersion,
  distilledFrom: string[],
  createdAt: number,
): PolicyVersion {
  return {
    version: parent.version + 1,
    createdAt,
    parentVersion: parent.version,
    rules: [
      // r1 survives, r3 is superseded by a tighter rule.
      ...parent.rules.filter((r) => r.id !== "r3"),
      {
        id: "r4",
        when: "approaching the marker, which is long and thin",
        do: "nudge(-2, 0) to grasp left of centre, then set_gripper(4)",
        evidence: distilledFrom.slice(0, 1),
        addedInVersion: parent.version + 1,
      },
      {
        id: "r5",
        when: "the bag already holds one item and the next item is rigid",
        do: "widen_bag() and release from no more than 4 cm above the opening",
        evidence: distilledFrom.slice(1, 2),
        addedInVersion: parent.version + 1,
      },
    ],
    fewShots: [
      ...parent.fewShots,
      {
        id: "f3",
        observationSummary:
          "gripper at (12.4, 3.1) over marker, width 6, marker 13 cm long",
        command: { skill: "nudge", dx: -2, dy: 0 },
        source: distilledFrom[0] ?? "c5",
        addedInVersion: parent.version + 1,
      },
    ],
    changelog:
      "Distilled from the corrections given since v" +
      parent.version +
      ". The centre-of-mass grasp on the marker was the remaining failure mode; r3 is replaced by a rule that sets the jaw from the object's own geometry.",
    distilledFrom,
  };
}
