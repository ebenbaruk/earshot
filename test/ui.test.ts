import { describe, expect, it, beforeEach } from "vitest";
import {
  formatElapsed,
  formatLatency,
  formatRunTime,
  formatSkill,
  outcomeTone,
  splitOnWord,
} from "@/components/format";
import { useRunsStore } from "@/store/useRunsStore";
import type { CorrectionEvent, RunRecord } from "@/lib/types";

describe("formatSkill", () => {
  it("renders skills the way the HUD shows them", () => {
    expect(formatSkill({ skill: "move_to", target: "tape_holder" })).toBe(
      "move_to(tape_holder)",
    );
    expect(formatSkill({ skill: "move_to", target: { x: -2.5, y: 0 } })).toBe(
      "move_to(-2.5, 0)",
    );
    expect(formatSkill({ skill: "nudge", dx: -2, dy: 0 })).toBe("nudge(-2, 0)");
    expect(formatSkill({ skill: "set_gripper", width: 9 })).toBe("set_gripper(9)");
    expect(formatSkill({ skill: "wait", ms: 300 })).toBe("wait(300)");
    expect(formatSkill({ skill: "squeeze" })).toBe("squeeze()");
    expect(formatSkill(null)).toBe("—");
  });
});

describe("time + latency formatting", () => {
  it("formats run clocks and latencies", () => {
    expect(formatElapsed(12_400)).toBe("12.4s");
    expect(formatElapsed(65_000)).toBe("1:05");
    expect(formatRunTime(9_400)).toBe("+9.4s");
    expect(formatLatency(212)).toBe("212 ms");
    expect(formatLatency(null)).toBe("—");
  });
});

describe("outcome tones", () => {
  it("reserves red for failure and amber for an interrupt", () => {
    expect(outcomeTone("ok")).toBe("ok");
    expect(outcomeTone("interrupted")).toBe("accent");
    expect(outcomeTone("slipped")).toBe("danger");
    expect(outcomeTone(null)).toBe("neutral");
  });
});

describe("splitOnWord", () => {
  it("locates the stop word for the transcript highlight", () => {
    expect(splitOnWord("stop the bag is too narrow", "stop")).toEqual({
      before: "",
      match: "stop",
      after: " the bag is too narrow",
    });
    expect(splitOnWord("a bit to the left", "stop")).toBeNull();
    expect(splitOnWord("anything", null)).toBeNull();
  });
});

const run = (id: string, patch: Partial<RunRecord> = {}): RunRecord => ({
  id,
  seed: 1,
  policyVersion: 0,
  correctionsEnabled: true,
  startedAt: 0,
  endedAt: 1000,
  durationMs: 1000,
  stagesDone: 1,
  success: false,
  interventions: 0,
  correctionIds: [],
  ...patch,
});

const correction = (id: string): CorrectionEvent => ({
  id,
  runId: "run-1",
  ts: 0,
  tStop: null,
  transcript: "stop",
  parsedCommand: { skill: "stop" },
  parseSource: "grammar",
  rejectedPolicyAction: null,
  stateBefore: [],
  outcome: "ok",
  latency: { stopMs: 200, parseMs: 10 },
  preventive: false,
});

describe("useRunsStore", () => {
  beforeEach(() => useRunsStore.getState().clear());

  it("appends, upserts and updates", () => {
    const s = useRunsStore.getState();
    s.addRun(run("run-1"));
    s.addRun(run("run-1", { stagesDone: 3 })); // same id → upsert, not duplicate
    s.addRun(run("run-2"));
    expect(useRunsStore.getState().runs).toHaveLength(2);
    expect(useRunsStore.getState().runs[0].stagesDone).toBe(3);

    s.updateRun("run-2", { success: true });
    expect(useRunsStore.getState().runs[1].success).toBe(true);

    s.addCorrection(correction("c1"));
    s.updateCorrection("c1", { outcome: "slipped" });
    expect(useRunsStore.getState().corrections[0].outcome).toBe("slipped");
  });

  it("round-trips through export/import", () => {
    const s = useRunsStore.getState();
    s.addRun(run("run-1"));
    s.addCorrection(correction("c1"));
    const json = useRunsStore.getState().exportJSON();

    useRunsStore.getState().clear();
    expect(useRunsStore.getState().runs).toHaveLength(0);

    useRunsStore.getState().importJSON(json);
    expect(useRunsStore.getState().runs).toHaveLength(1);
    expect(useRunsStore.getState().corrections[0].id).toBe("c1");
  });

  it("rejects malformed imports", () => {
    expect(() => useRunsStore.getState().importJSON("[]")).toThrow();
    expect(() => useRunsStore.getState().importJSON('{"runs":1}')).toThrow();
  });
});
