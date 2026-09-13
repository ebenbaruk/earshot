import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  CorrectionEvent,
  Observation,
  ObservedObject,
  PolicyVersion,
  SkillCommand,
  WorldState,
} from "@/lib/types";
import { DEFAULT_GRIPPER_WIDTH } from "@/lib/types";
import {
  CommandDecodeError,
  describeCommand,
  normalizeTargetId,
  toFlatCommand,
  toSkillCommand,
  tryToSkillCommand,
} from "@/lib/policy/command-codec";
import { BASE_POLICY } from "@/lib/policy/base-policy";
import {
  buildPolicySystemPrompt,
  buildPolicyUserPrompt,
} from "@/lib/policy/prompt";
import { fallbackDecision } from "@/lib/policy/fallback";
import { diffPolicies } from "@/lib/policy/diff";
import {
  MAX_RULES,
  buildDistillUserPrompt,
  mergeDistillation,
} from "@/lib/policy/distill";
import {
  FLAT_COMMAND_SCHEMA,
  POLICY_DECISION_SCHEMA,
  DISTILL_SCHEMA,
} from "@/lib/policy/schema";

// ---------------------------------------------------------------------------
// Fixtures — the demo seed: the marker is nearest to the gripper.
// ---------------------------------------------------------------------------

const OBJECTS: ObservedObject[] = [
  {
    id: "marker",
    label: "Marker",
    estimatedPos: { x: 3, y: -2 },
    size: { w: 1.5, d: 1.5, h: 14 },
    state: "on_table",
  },
  {
    id: "sponge",
    label: "Sponge",
    estimatedPos: { x: -12, y: 6 },
    size: { w: 8, d: 6, h: 3 },
    state: "on_table",
  },
  {
    id: "tape_holder",
    label: "Tape holder",
    estimatedPos: { x: 10, y: 8 },
    size: { w: 7, d: 7, h: 3 },
    state: "on_table",
  },
];

const BAG_POS = { x: 18, y: 0 };

function fixtureObservation(over: Partial<Observation> = {}): Observation {
  return {
    t: 0,
    objects: OBJECTS.map((o) => ({ ...o, estimatedPos: { ...o.estimatedPos } })),
    gripper: {
      pos: { x: 0, y: 0 },
      z: 8,
      width: DEFAULT_GRIPPER_WIDTH,
      holding: null,
    },
    bag: { pos: { ...BAG_POS }, contents: [], openingLooksNarrow: false },
    stagesDone: 0,
    lastSkill: null,
    recentHistory: [],
    ...over,
  };
}

/** A toy reducer — NOT the real sim, just enough to drive the fallback. */
function applyToObservation(obs: Observation, cmd: SkillCommand): Observation {
  const next: Observation = structuredClone(obs);
  next.t += 500;
  switch (cmd.skill) {
    case "set_gripper":
      next.gripper.width = cmd.width;
      break;
    case "move_to": {
      const target =
        typeof cmd.target === "string"
          ? cmd.target === "bag"
            ? BAG_POS
            : next.objects.find((o) => o.id === cmd.target)!.estimatedPos
          : cmd.target;
      next.gripper.pos = { ...target };
      break;
    }
    case "descend":
      next.gripper.z = 0;
      break;
    case "grasp": {
      const under = next.objects.find(
        (o) =>
          o.state === "on_table" &&
          Math.hypot(
            o.estimatedPos.x - next.gripper.pos.x,
            o.estimatedPos.y - next.gripper.pos.y,
          ) <= 1,
      );
      if (under) {
        under.state = "held";
        next.gripper.holding = under.id;
      }
      break;
    }
    case "lift":
      next.gripper.z = 8;
      break;
    case "release": {
      const held = next.objects.find((o) => o.id === next.gripper.holding);
      if (held) {
        held.state = "in_bag";
        next.bag.contents.push(held.id);
        next.stagesDone += 1;
        next.gripper.holding = null;
      }
      break;
    }
    default:
      break;
  }
  next.lastSkill = { command: cmd, outcome: "ok" };
  next.recentHistory = [...next.recentHistory, next.lastSkill].slice(-6);
  return next;
}

// ---------------------------------------------------------------------------
// Codec
// ---------------------------------------------------------------------------

describe("command codec", () => {
  const ROUND_TRIP: SkillCommand[] = [
    { skill: "move_to", target: "sponge" },
    { skill: "move_to", target: "tape_holder" },
    { skill: "move_to", target: "marker" },
    { skill: "move_to", target: "bag" },
    { skill: "move_to", target: { x: -3.5, y: 12 } },
    { skill: "nudge", dx: -2, dy: 0 },
    { skill: "nudge", dx: 0, dy: 1.5 },
    { skill: "set_gripper", width: 7.5 },
    { skill: "descend" },
    { skill: "grasp" },
    { skill: "lift" },
    { skill: "release" },
    { skill: "squeeze" },
    { skill: "widen_bag" },
    { skill: "wait", ms: 0 },
    { skill: "stop" },
  ];

  for (const cmd of ROUND_TRIP) {
    it(`round-trips ${describeCommand(cmd)}`, () => {
      expect(toSkillCommand(toFlatCommand(cmd))).toEqual(cmd);
    });
  }

  it("round-trips through JSON (the wire shape)", () => {
    for (const cmd of ROUND_TRIP) {
      const wire = JSON.parse(JSON.stringify(toFlatCommand(cmd)));
      expect(toSkillCommand(wire)).toEqual(cmd);
    }
  });

  it("emits every field so strict mode is satisfied", () => {
    const flat = toFlatCommand({ skill: "grasp" });
    expect(Object.keys(flat).sort()).toEqual(
      ["dx", "dy", "ms", "skill", "target", "width", "x", "y"].sort(),
    );
    expect(Object.keys(flat).sort()).toEqual(
      [...(FLAT_COMMAND_SCHEMA.required as string[])].sort(),
    );
  });

  it("throws on an unknown skill", () => {
    expect(() => toSkillCommand({ skill: "teleport" })).toThrow(CommandDecodeError);
    expect(tryToSkillCommand({ skill: "teleport" })).toBeNull();
  });

  it("throws when move_to has no usable target", () => {
    expect(() => toSkillCommand({ skill: "move_to", target: null })).toThrow();
    expect(() =>
      toSkillCommand({ skill: "move_to", target: "kitchen sink" }),
    ).toThrow();
  });

  it("accepts an x/y target", () => {
    expect(toSkillCommand({ skill: "move_to", target: "xy", x: 1, y: 2 })).toEqual({
      skill: "move_to",
      target: { x: 1, y: 2 },
    });
  });

  it("normalises loose target spellings", () => {
    expect(normalizeTargetId("Tape Holder")).toBe("tape_holder");
    expect(normalizeTargetId("the marker")).toBe("marker");
    expect(normalizeTargetId("the bag")).toBe("bag");
    expect(normalizeTargetId("nowhere")).toBeNull();
  });

  it("clamps the gripper width", () => {
    expect(toSkillCommand({ skill: "set_gripper", width: 99 })).toEqual({
      skill: "set_gripper",
      width: 14,
    });
    expect(toSkillCommand({ skill: "set_gripper", width: -1 })).toEqual({
      skill: "set_gripper",
      width: 2,
    });
  });
});

// ---------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------

describe("prompt", () => {
  it("has no learned-rules section on the base policy", () => {
    const sys = buildPolicySystemPrompt(BASE_POLICY);
    expect(sys).not.toContain("Learned rules");
    expect(sys).not.toContain("## Examples");
  });

  it("includes the nearest-first heuristic and the canonical sequence", () => {
    const sys = buildPolicySystemPrompt(BASE_POLICY);
    expect(sys).toContain("nearest to the gripper first");
    expect(sys).toContain("set_gripper(object width + 0.5)");
  });

  it("keeps the hidden quirks out of the base prompt", () => {
    const sys = buildPolicySystemPrompt(BASE_POLICY).toLowerCase();
    // squeeze / nudge are described tersely, with no hint of WHEN to use them
    expect(sys).toContain("compress the held object");
    expect(sys).toContain("small xy adjustment");
    expect(sys).not.toContain("2 cm to the left");
    expect(sys).not.toContain("marker last");
    expect(sys).not.toContain("deformable");
  });

  it("renders rules and few-shots when present, marked as overriding", () => {
    const policy: PolicyVersion = {
      ...BASE_POLICY,
      version: 1,
      rules: [
        {
          id: "r1",
          when: "about to grasp the tape_holder",
          do: "nudge(-2, 0) after move_to and before descend",
          evidence: ["c1"],
          addedInVersion: 1,
        },
      ],
      fewShots: [
        {
          id: "f1",
          observationSummary: "holding the sponge over the bag",
          command: { skill: "squeeze" },
          source: "c2",
          addedInVersion: 1,
        },
      ],
    };
    const sys = buildPolicySystemPrompt(policy);
    expect(sys).toContain("## Learned rules (v1)");
    expect(sys).toContain("Learned rules override the defaults above");
    expect(sys).toContain("[r1] WHEN about to grasp the tape_holder DO nudge(-2, 0)");
    expect(sys).toContain("## Examples");
    expect(sys).toContain("holding the sponge over the bag");
    expect(sys).toContain("squeeze()");
    // rules must come after the defaults so they read as an override
    expect(sys.indexOf("Default heuristics")).toBeLessThan(
      sys.indexOf("## Learned rules"),
    );
  });

  it("renders the observation compactly, rounded to 0.5 cm", () => {
    const user = buildPolicyUserPrompt(
      fixtureObservation({
        gripper: { pos: { x: 0.37, y: 0 }, z: 8, width: 6, holding: null },
        bag: { pos: BAG_POS, contents: ["marker"], openingLooksNarrow: true },
        stagesDone: 1,
        lastSkill: { command: { skill: "grasp" }, outcome: "slipped" },
      }),
    );
    expect(user).toContain("Gripper: at (0.5, 0.0)");
    expect(user).toContain("distance from gripper");
    expect(user).toContain("contents = [marker]");
    expect(user).toContain("openingLooksNarrow = true");
    expect(user).toContain("Last skill: grasp() -> slipped");
    expect(user).toContain("Packed and still in the bag: 1/3");
  });
});

// ---------------------------------------------------------------------------
// Fallback state machine
// ---------------------------------------------------------------------------

describe("fallback policy", () => {
  it("produces the canonical pick-and-place sequence, nearest object first", () => {
    let obs = fixtureObservation();
    const emitted: string[] = [];
    for (let i = 0; i < 8; i++) {
      const cmd = fallbackDecision(obs).command;
      emitted.push(describeCommand(cmd));
      obs = applyToObservation(obs, cmd);
    }
    expect(emitted).toEqual([
      "set_gripper(2)", // marker is 1.5 wide -> clamped to the 2 cm minimum
      "move_to(marker)",
      "descend()",
      "grasp()",
      "lift()",
      "move_to(bag)",
      "release()",
      "set_gripper(7.5)", // nearest object to the bag is now the tape holder
    ]);
    expect(obs.bag.contents).toEqual(["marker"]);
  });

  it("packs all three objects and then stops", () => {
    let obs = fixtureObservation();
    let last = "";
    for (let i = 0; i < 40; i++) {
      const cmd = fallbackDecision(obs).command;
      last = cmd.skill;
      if (cmd.skill === "stop") break;
      obs = applyToObservation(obs, cmd);
    }
    expect(last).toBe("stop");
    expect(obs.bag.contents.sort()).toEqual(["marker", "sponge", "tape_holder"]);
  });

  it("widens the bag before releasing when the opening looks narrow", () => {
    const obs = fixtureObservation({
      gripper: { pos: { ...BAG_POS }, z: 8, width: 7.5, holding: "tape_holder" },
      bag: { pos: BAG_POS, contents: ["marker"], openingLooksNarrow: true },
      stagesDone: 1,
    });
    expect(fallbackDecision(obs).command).toEqual({ skill: "widen_bag" });
  });

  it("widens the bag after a blocked release", () => {
    const obs = fixtureObservation({
      gripper: { pos: { ...BAG_POS }, z: 8, width: 7.5, holding: "sponge" },
      bag: { pos: BAG_POS, contents: ["marker"], openingLooksNarrow: false },
      lastSkill: { command: { skill: "release" }, outcome: "blocked" },
    });
    expect(fallbackDecision(obs).command).toEqual({ skill: "widen_bag" });
  });

  it("retries a failed grasp once, then backs off", () => {
    const base = fixtureObservation({
      gripper: { pos: { x: 3, y: -2 }, z: 0, width: 2, holding: null },
    });
    const fail = { command: { skill: "grasp" } as SkillCommand, outcome: "missed" as const };
    expect(
      fallbackDecision({ ...base, recentHistory: [fail], lastSkill: fail }).command,
    ).toEqual({ skill: "grasp" });
    expect(
      fallbackDecision({ ...base, recentHistory: [fail, fail], lastSkill: fail })
        .command,
    ).toEqual({ skill: "lift" });
  });

  it("stops when everything is packed", () => {
    const obs = fixtureObservation({
      objects: OBJECTS.map((o) => ({ ...o, state: "in_bag" as const })),
      bag: { pos: BAG_POS, contents: ["marker", "sponge", "tape_holder"], openingLooksNarrow: false },
      stagesDone: 3,
    });
    expect(fallbackDecision(obs).command).toEqual({ skill: "stop" });
  });

  it("labels its reasoning so the HUD can show it degraded", () => {
    expect(fallbackDecision(fixtureObservation()).reasoning).toContain("[fallback]");
  });
});

// ---------------------------------------------------------------------------
// Distillation
// ---------------------------------------------------------------------------

function worldState(over: Partial<WorldState> = {}): WorldState {
  return {
    t: 3000,
    seed: 7,
    status: "running",
    objects: OBJECTS.map((o) => ({
      id: o.id,
      label: o.label,
      pos: { ...o.estimatedPos },
      size: o.size,
      state: o.state,
      compressed: false,
    })),
    gripper: { pos: { x: 10, y: 8 }, z: 0, width: 7.5, holding: null },
    bag: { pos: { ...BAG_POS }, opening: 9, contents: [] },
    stagesDone: 0,
    lastSkill: { command: { skill: "grasp" }, outcome: "slipped" },
    consecutiveFailures: 1,
    ...over,
  };
}

function correction(over: Partial<CorrectionEvent> = {}): CorrectionEvent {
  return {
    id: "c1",
    runId: "run-1",
    ts: 3200,
    tStop: 3000,
    transcript: "a bit to the left",
    parsedCommand: { skill: "nudge", dx: -1.5, dy: 0 },
    parseSource: "grammar",
    rejectedPolicyAction: { command: { skill: "grasp" }, reasoning: "grab the tape" },
    stateBefore: [worldState()],
    outcome: "ok",
    latency: { stopMs: 310, parseMs: 1 },
    preventive: false,
    ...over,
  };
}

const LLM_OUTPUT = {
  rules: [
    {
      when: "the tape_holder is the next object to pick",
      do: "after move_to(tape_holder), nudge(-2, 0) before descend",
      evidence: ["c1"],
    },
    {
      when: "holding the sponge over the bag",
      do: "squeeze before release",
      evidence: ["c2"],
    },
  ],
  fewShots: [
    {
      observationSummary: "over the tape holder, about to descend",
      command: { skill: "nudge", dx: -2, dy: 0 },
      source: "c1",
    },
    {
      observationSummary: "bogus example",
      command: { skill: "teleport" },
      source: "c9",
    },
  ],
  changelog: "Learned the tape grasp offset and the sponge compression step.",
  droppedRuleIds: [] as string[],
};

describe("distill merge / versioning", () => {
  it("bumps the version, assigns ids and records provenance", () => {
    const corrections = [correction(), correction({ id: "c2" })];
    const next = mergeDistillation(
      { policy: BASE_POLICY, corrections, runs: [] },
      LLM_OUTPUT,
      1_700_000_000_000,
    );

    expect(next.version).toBe(1);
    expect(next.parentVersion).toBe(0);
    expect(next.createdAt).toBe(1_700_000_000_000);
    expect(next.rules.map((r) => r.id)).toEqual(["r1", "r2"]);
    expect(next.rules.every((r) => r.addedInVersion === 1)).toBe(true);
    expect(next.rules[0].evidence).toEqual(["c1"]);
    expect(next.distilledFrom).toEqual(["c1", "c2"]);
    expect(next.changelog).toContain("tape grasp offset");
  });

  it("continues rule ids from the parent and drops what the model retired", () => {
    const parent: PolicyVersion = {
      ...BASE_POLICY,
      version: 1,
      rules: [
        { id: "r1", when: "a", do: "b", evidence: [], addedInVersion: 1 },
        { id: "r2", when: "c", do: "d", evidence: [], addedInVersion: 1 },
      ],
    };
    const next = mergeDistillation(
      { policy: parent, corrections: [correction()], runs: [] },
      { ...LLM_OUTPUT, droppedRuleIds: ["r1"] },
    );
    expect(next.version).toBe(2);
    expect(next.rules.map((r) => r.id)).toEqual(["r2", "r3", "r4"]);
  });

  it("keeps at most 8 rules, evicting the oldest", () => {
    const parent: PolicyVersion = {
      ...BASE_POLICY,
      version: 1,
      rules: Array.from({ length: 8 }, (_, i) => ({
        id: `r${i + 1}`,
        when: `w${i}`,
        do: `d${i}`,
        evidence: [],
        addedInVersion: 1,
      })),
    };
    const next = mergeDistillation(
      { policy: parent, corrections: [correction()], runs: [] },
      LLM_OUTPUT,
    );
    expect(next.rules).toHaveLength(MAX_RULES);
    expect(next.rules.map((r) => r.id)).toEqual([
      "r3", "r4", "r5", "r6", "r7", "r8", "r9", "r10",
    ]);
  });

  it("skips few-shots whose command cannot be decoded", () => {
    const next = mergeDistillation(
      { policy: BASE_POLICY, corrections: [correction()], runs: [] },
      LLM_OUTPUT,
    );
    expect(next.fewShots).toHaveLength(1);
    expect(next.fewShots[0].id).toBe("f1");
    expect(next.fewShots[0].command).toEqual({ skill: "nudge", dx: -2, dy: 0 });
  });

  it("falls back to a generated changelog when the model returns none", () => {
    const next = mergeDistillation(
      { policy: BASE_POLICY, corrections: [correction()], runs: [] },
      { ...LLM_OUTPUT, changelog: "  " },
    );
    expect(next.changelog).toContain("correction");
  });

  it("renders each correction with its context", () => {
    const user = buildDistillUserPrompt({
      policy: BASE_POLICY,
      corrections: [correction()],
      runs: [
        {
          id: "run-1",
          seed: 7,
          policyVersion: 0,
          correctionsEnabled: true,
          startedAt: 0,
          endedAt: 1,
          durationMs: 1,
          stagesDone: 3,
          success: true,
          interventions: 1,
          correctionIds: ["c1"],
        },
      ],
    });
    expect(user).toContain("### Correction c1");
    expect(user).toContain('Operator said: "a bit to the left"');
    expect(user).toContain("Action the policy wanted to take (rejected): grasp()");
    expect(user).toContain("Executed instead: nudge(-1.5, 0)");
    expect(user).toContain("Outcome of that command: ok");
    expect(user).toContain("Run progressed afterwards: yes (packed 0 -> 3)");
    expect(user).toContain("(none — this is the base policy)");
  });
});

describe("distill() over a mocked gateway", () => {
  beforeEach(() => vi.resetModules());

  it("calls the smart model with the strict schema and merges the result", async () => {
    const chatJSON = vi.fn().mockResolvedValue({
      data: LLM_OUTPUT,
      latencyMs: 1234,
      raw: JSON.stringify(LLM_OUTPUT),
    });
    vi.doMock("@/lib/llm/gateway", () => ({
      chatJSON,
      smartModel: () => "test-smart-model",
      fastModel: () => "test-fast-model",
      GatewayError: class extends Error {},
    }));

    const { distill } = await import("@/lib/policy/distill");
    const next = await distill({
      policy: BASE_POLICY,
      corrections: [correction(), correction({ id: "c2" })],
      runs: [],
    });

    expect(chatJSON).toHaveBeenCalledTimes(1);
    const args = chatJSON.mock.calls[0][0];
    expect(args.model).toBe("test-smart-model");
    expect(args.temperature).toBe(0);
    expect(args.schema).toEqual(DISTILL_SCHEMA);
    expect(args.system).toContain("post-training step");
    expect(args.system).toContain("never justify a rule with mechanics the policy cannot observe");
    expect(args.user).toContain("### Correction c1");

    expect(next.version).toBe(1);
    expect(next.rules).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Diff
// ---------------------------------------------------------------------------

describe("diffPolicies", () => {
  it("reports added / removed rules and added few-shots", () => {
    const a: PolicyVersion = {
      ...BASE_POLICY,
      version: 1,
      rules: [
        { id: "r1", when: "a", do: "b", evidence: [], addedInVersion: 1 },
        { id: "r2", when: "c", do: "d", evidence: [], addedInVersion: 1 },
      ],
      fewShots: [
        {
          id: "f1",
          observationSummary: "s",
          command: { skill: "grasp" },
          source: "c1",
          addedInVersion: 1,
        },
      ],
    };
    const b: PolicyVersion = {
      ...a,
      version: 2,
      rules: [
        a.rules[1],
        { id: "r3", when: "e", do: "f", evidence: ["c3"], addedInVersion: 2 },
      ],
      fewShots: [
        a.fewShots[0],
        {
          id: "f2",
          observationSummary: "t",
          command: { skill: "squeeze" },
          source: "c3",
          addedInVersion: 2,
        },
      ],
    };

    const d = diffPolicies(a, b);
    expect(d.added.map((r) => r.id)).toEqual(["r3"]);
    expect(d.removed.map((r) => r.id)).toEqual(["r1"]);
    expect(d.addedFewShots.map((f) => f.id)).toEqual(["f2"]);
  });

  it("is empty for identical policies", () => {
    const d = diffPolicies(BASE_POLICY, BASE_POLICY);
    expect(d).toEqual({ added: [], removed: [], addedFewShots: [] });
  });
});

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

describe("json schemas", () => {
  const walk = (node: unknown, visit: (o: Record<string, unknown>) => void) => {
    if (Array.isArray(node)) return node.forEach((n) => walk(n, visit));
    if (!node || typeof node !== "object") return;
    const o = node as Record<string, unknown>;
    if (o.type === "object") visit(o);
    Object.values(o).forEach((v) => walk(v, visit));
  };

  it("sets additionalProperties:false and lists every property in required", () => {
    for (const schema of [POLICY_DECISION_SCHEMA, DISTILL_SCHEMA, FLAT_COMMAND_SCHEMA]) {
      walk(schema, (o) => {
        expect(o.additionalProperties).toBe(false);
        const props = Object.keys((o.properties ?? {}) as object).sort();
        expect([...((o.required ?? []) as string[])].sort()).toEqual(props);
      });
    }
  });

  it("does not put null inside an enum (strict mode rejects it)", () => {
    walk(FLAT_COMMAND_SCHEMA, (o) => {
      for (const prop of Object.values((o.properties ?? {}) as Record<string, unknown>)) {
        const p = prop as Record<string, unknown>;
        if (Array.isArray(p.enum)) expect(p.enum).not.toContain(null);
      }
    });
  });
});
