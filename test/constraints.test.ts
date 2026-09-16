import { describe, expect, it } from "vitest";
import { createEngine } from "@/lib/sim/engine";
import { applyConstraints, deriveConstraints, emptyConstraints, mergeConstraints } from "@/lib/earshot/constraints";
import { extractOrderHint } from "@/lib/corrections/grammar";
import type { CorrectionEvent } from "@/lib/types";

function obsWith(seed = 42) {
  const e = createEngine(seed);
  e.start();
  return { e, obs: e.getObservation() };
}

describe("order hints survive ASR slips", () => {
  it.each(["put the marker in last", "put the market last", "marquer en dernier", "the pen goes last", "do the egg first"])(
    "%s",
    (t) => {
      const h = extractOrderHint(t);
      expect(h).not.toBeNull();
    },
  );
});

describe("defer-last redirects every way of going for the deferred object", () => {
  it("named target, coordinates, and a grasp right over it", () => {
    const { obs } = obsWith();
    const c = { ...emptyConstraints(), deferLast: "marker" as const };
    const marker = obs.objects.find((o) => o.id === "marker")!;

    const byName = applyConstraints(c, { skill: "move_to", target: "marker" }, obs);
    expect(byName.command.skill).toBe("move_to");
    expect(byName.command.skill === "move_to" && byName.command.target).not.toBe("marker");
    expect(byName.note).toContain("marker last");

    const byCoords = applyConstraints(c, { skill: "move_to", target: { ...marker.estimatedPos } }, obs);
    expect(byCoords.command.skill === "move_to" && byCoords.command.target).not.toEqual(marker.estimatedPos);

    const parked = { ...obs, gripper: { ...obs.gripper, pos: { ...marker.estimatedPos }, z: 1 } };
    const byGrasp = applyConstraints(c, { skill: "grasp" }, parked);
    expect(byGrasp.command.skill).toBe("move_to");
  });

  it("lets the deferred object through once it is the only one left", () => {
    const { obs } = obsWith();
    const c = { ...emptyConstraints(), deferLast: "marker" as const };
    const only = { ...obs, objects: obs.objects.map((o) => (o.id === "marker" ? o : { ...o, state: "in_bag" as const })) };
    const r = applyConstraints(c, { skill: "move_to", target: "marker" }, only);
    expect(r.command).toEqual({ skill: "move_to", target: "marker" });
  });
});

describe("facts are derived from corrections and merged across versions", () => {
  it("nudge → grasp offset, descend → release low, squeeze → squeeze before, 'last' → defer", () => {
    const { e } = obsWith();
    const w0 = e.world;
    const tape = w0.objects.find((o) => o.id === "tape_holder")!;
    const atTape = { ...w0, gripper: { ...w0.gripper, pos: { ...tape.pos }, z: 1 } };
    const holdingEgg = { ...w0, gripper: { ...w0.gripper, holding: "egg" as const } };
    const holdingSponge = { ...w0, gripper: { ...w0.gripper, holding: "sponge" as const } };
    const base = (id: string, transcript: string, parsedCommand: CorrectionEvent["parsedCommand"], stateBefore: CorrectionEvent["stateBefore"], outcome: CorrectionEvent["outcome"] = "ok"): CorrectionEvent => ({
      id, runId: "run-1", ts: 0, tStop: 0, transcript, parsedCommand, parseSource: "grammar", rejectedPolicyAction: null,
      stateBefore, outcome, latency: { stopMs: null, parseMs: 1 }, preventive: false,
    });
    const facts = deriveConstraints(
      [
        base("c1", "stop, put the marker in last", { skill: "move_to", target: "egg" }, [w0]),
        base("c2", "stop, a bit to the left", { skill: "nudge", dx: -1.5, dy: 0 }, [atTape], "slipped"), // retry grasp slipped: still teaches
        base("c3", "stop, lower it first", { skill: "descend" }, [holdingEgg]),
        base("c4", "stop, squeeze it first", { skill: "squeeze" }, [holdingSponge]),
      ],
      undefined,
    );
    expect(facts.deferLast).toBe("marker");
    expect(facts.graspOffset.tape_holder).toEqual({ x: -1.5, y: 0 });
    expect(facts.releaseLow.egg).toBe(true);
    expect(facts.squeezeBefore.sponge).toBe(true);

    const merged = mergeConstraints(facts, { ...emptyConstraints(), graspOffset: { sponge: { x: 0, y: 1 } } });
    expect(merged.deferLast).toBe("marker");
    expect(merged.graspOffset.sponge).toEqual({ x: 0, y: 1 });
    expect(merged.graspOffset.tape_holder).toEqual({ x: -1.5, y: 0 });
  });
});
