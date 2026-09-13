import { describe, it, expect } from "vitest";
import { createEngine, type Engine } from "@/lib/sim/engine";
import { runSkill, runSequence, idleTicks } from "@/lib/sim/driver";
import { RingBuffer } from "@/lib/sim/ringBuffer";
import { createLayout } from "@/lib/sim/layout";
import {
  BAG_OPENING_MAX,
  GRIPPER_START_POS,
  PERCEPTION_NOISE,
  TAPE_GRASP_OFFSET,
  TICK_MS,
  dist,
} from "@/lib/sim/constants";
import type { ObjectId, SkillCommand, WorldState } from "@/lib/types";

const SEED = 42;

function obj(w: WorldState, id: ObjectId) {
  const o = w.objects.find((x) => x.id === id);
  if (!o) throw new Error(`missing ${id}`);
  return o;
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

/** move_to -> descend -> (set_gripper) -> grasp -> lift -> move_to bag -> release */
async function pack(engine: Engine, id: ObjectId, width?: number) {
  const cmds: SkillCommand[] = [{ skill: "move_to", target: id }, { skill: "descend" }];
  if (width !== undefined) cmds.push({ skill: "set_gripper", width });
  if (id === "tape_holder") cmds.push({ skill: "nudge", dx: TAPE_GRASP_OFFSET.x, dy: TAPE_GRASP_OFFSET.y });
  cmds.push({ skill: "grasp" }, { skill: "lift" }, { skill: "move_to", target: "bag" });
  await runSequence(engine, cmds);
  return runSkill(engine, { skill: "release" });
}

describe("layout", () => {
  it("is deterministic per seed", () => {
    expect(JSON.stringify(createLayout(SEED))).toBe(JSON.stringify(createLayout(SEED)));
    expect(JSON.stringify(createLayout(SEED))).not.toBe(JSON.stringify(createLayout(7)));
  });

  it("puts the marker nearest to the gripper start pose on seed 42", () => {
    const { objects } = createLayout(SEED);
    const byDist = [...objects].sort(
      (a, b) => dist(a.pos, GRIPPER_START_POS) - dist(b.pos, GRIPPER_START_POS),
    );
    expect(byDist[0].id).toBe("marker");
  });

  it("keeps every object on the table and clear of the bag", () => {
    for (const seed of [42, 1, 7, 99, 2024]) {
      for (const o of createLayout(seed).objects) {
        expect(Math.abs(o.pos.x) + o.size.w / 2).toBeLessThanOrEqual(30);
        expect(Math.abs(o.pos.y) + o.size.d / 2).toBeLessThanOrEqual(20);
        expect(dist(o.pos, { x: 20, y: 0 })).toBeGreaterThan(10);
      }
    }
  });
});

describe("determinism", () => {
  it("produces identical worlds for the same seed and command sequence", async () => {
    const script: SkillCommand[] = [
      { skill: "move_to", target: "tape_holder" },
      { skill: "descend" },
      { skill: "grasp" }, // slips -> consumes the runtime RNG
      { skill: "nudge", dx: -2, dy: 0 },
      { skill: "grasp" }, // slips again (gripper too narrow)
      { skill: "set_gripper", width: 7.5 },
      { skill: "grasp" },
      { skill: "lift" },
      { skill: "move_to", target: "bag" },
      { skill: "release" },
    ];
    const a = createEngine(SEED);
    const b = createEngine(SEED);
    a.start();
    b.start();
    const ra = await runSequence(a, script);
    const rb = await runSequence(b, script);
    expect(ra.map((r) => r.outcome)).toEqual(rb.map((r) => r.outcome));
    expect(JSON.stringify(a.world)).toBe(JSON.stringify(b.world));
    expect(JSON.stringify(a.getObservation())).toBe(JSON.stringify(b.getObservation()));
  });
});

describe("quirk 1 — tape holder grasp point", () => {
  it("slips at the visual centroid and holds after nudging onto the ring", async () => {
    const e = createEngine(SEED);
    e.start();
    await runSequence(e, [{ skill: "move_to", target: "tape_holder" }, { skill: "descend" }]);

    const slip = await runSkill(e, { skill: "grasp" });
    expect(slip.outcome).toBe("slipped");
    expect(e.world.gripper.holding).toBeNull();

    // The slip displaces the object slightly but it stays within the grasp tolerance.
    await runSequence(e, [
      { skill: "nudge", dx: TAPE_GRASP_OFFSET.x, dy: TAPE_GRASP_OFFSET.y },
      { skill: "set_gripper", width: 7.5 },
    ]);
    const ok = await runSkill(e, { skill: "grasp" });
    expect(ok.outcome).toBe("ok");
    expect(e.world.gripper.holding).toBe("tape_holder");
    expect(obj(e.world, "tape_holder").state).toBe("held");
  });

  it("slips when the gripper is on the ring but too narrow", async () => {
    const e = createEngine(SEED);
    e.start();
    const r = await runSequence(e, [
      { skill: "move_to", target: "tape_holder" },
      { skill: "descend" },
      { skill: "nudge", dx: TAPE_GRASP_OFFSET.x, dy: TAPE_GRASP_OFFSET.y },
      { skill: "grasp" },
    ]);
    expect(r[r.length - 1].outcome).toBe("slipped");
  });

  it("misses when there is nothing under the gripper", async () => {
    const e = createEngine(SEED);
    e.start();
    const r = await runSequence(e, [
      { skill: "move_to", target: { x: 0, y: 18 } },
      { skill: "descend" },
      { skill: "grasp" },
    ]);
    expect(r[r.length - 1].outcome).toBe("missed");
  });

  it("blocks a grasp that was not preceded by descend", async () => {
    const e = createEngine(SEED);
    e.start();
    await runSkill(e, { skill: "move_to", target: "marker" });
    const r = await runSkill(e, { skill: "grasp" });
    expect(r.outcome).toBe("blocked");
  });
});

describe("quirk 2 — sponge must be squeezed", () => {
  it("is blocked uncompressed once the opening has shrunk, and goes in after squeeze", async () => {
    const e = createEngine(SEED);
    e.start();
    // Pack the marker first so the opening drops from 12 to 9.
    await pack(e, "marker");
    expect(e.world.bag.opening).toBe(9);

    await runSequence(e, [
      { skill: "move_to", target: "sponge" },
      { skill: "descend" },
      { skill: "grasp" },
      { skill: "lift" },
      { skill: "move_to", target: "bag" },
    ]);
    expect(e.world.gripper.holding).toBe("sponge");

    const blocked = await runSkill(e, { skill: "release" });
    expect(blocked.outcome).toBe("blocked");
    expect(e.world.gripper.holding).toBe("sponge");

    await runSkill(e, { skill: "squeeze" });
    expect(obj(e.world, "sponge").compressed).toBe(true);

    const ok = await runSkill(e, { skill: "release" });
    // The sponge goes in; the marker underneath rolls out, which is reported instead of "ok".
    expect(ok.outcome).toBe("rolled_out");
    expect(obj(e.world, "sponge").state).toBe("in_bag");
  });

  it("squeeze is a harmless no-op on other objects", async () => {
    const e = createEngine(SEED);
    e.start();
    const r = await runSkill(e, { skill: "squeeze" });
    expect(r.outcome).toBe("ok");
    expect(e.world.objects.every((o) => !o.compressed)).toBe(true);
  });
});

describe("quirk 3 — the marker rolls out", () => {
  it("rolls out when it is packed first and something lands on it", async () => {
    const e = createEngine(SEED);
    e.start();
    await pack(e, "marker");
    expect(obj(e.world, "marker").state).toBe("in_bag");
    expect(e.world.stagesDone).toBe(1);

    const r = await pack(e, "tape_holder", 7.5);
    expect(r.outcome).toBe("rolled_out");
    expect(e.world.lastSkill?.outcome).toBe("rolled_out");
    expect(obj(e.world, "marker").state).toBe("rolled_out");
    expect(e.world.bag.contents).not.toContain("marker");
    expect(e.world.stagesDone).toBe(1); // tape in, marker out

    // rolled_out lasts one tick for the UI, then the marker is back on the table.
    await idleTicks(e, 2);
    expect(obj(e.world, "marker").state).toBe("on_table");
    expect(obj(e.world, "marker").pos.x).toBeCloseTo(e.world.bag.pos.x + 6, 5);
  });

  it("stays in the bag when it is packed last", async () => {
    const e = createEngine(SEED);
    e.start();
    await pack(e, "sponge"); // opening is still 12, so it goes in uncompressed
    expect(obj(e.world, "sponge").state).toBe("in_bag");
    await pack(e, "tape_holder", 7.5);
    const last = await pack(e, "marker");
    expect(last.outcome).toBe("ok");
    expect(obj(e.world, "marker").state).toBe("in_bag");
    expect(e.world.stagesDone).toBe(3);
    expect(e.world.status).toBe("succeeded");
  });
});

describe("quirk 4 — bag opening", () => {
  it("shrinks by 3 per placement and is restored by widen_bag", async () => {
    const e = createEngine(SEED);
    e.start();
    expect(e.world.bag.opening).toBe(BAG_OPENING_MAX);
    await pack(e, "sponge");
    expect(e.world.bag.opening).toBe(9);
    await pack(e, "tape_holder", 7.5);
    expect(e.world.bag.opening).toBe(6);

    await runSkill(e, { skill: "widen_bag" });
    expect(e.world.bag.opening).toBe(BAG_OPENING_MAX);
  });

  it("blocks an item wider than the opening", async () => {
    const e = createEngine(SEED);
    e.start();
    await pack(e, "marker"); // 12 -> 9
    await pack(e, "sponge", 8.5); // uncompressed sponge is blocked at 9
    expect(obj(e.world, "sponge").state).toBe("held");
    expect(e.world.lastSkill?.outcome).toBe("blocked");
  });

  it("reports openingLooksNarrow only below 7", async () => {
    const e = createEngine(SEED);
    e.start();
    expect(e.getObservation().bag.openingLooksNarrow).toBe(false);
    await pack(e, "sponge");
    await pack(e, "tape_holder", 7.5); // opening 6
    expect(e.getObservation().bag.openingLooksNarrow).toBe(true);
  });
});

describe("pause / resume / stop", () => {
  it("interrupts a move mid-flight and freezes the gripper", async () => {
    const e = createEngine(SEED);
    e.start();
    let outcome: string | null = null;
    void e.execute({ skill: "move_to", target: "sponge" }).then((o) => {
      outcome = o;
    });
    await flush();
    for (let i = 0; i < 5; i += 1) {
      e.step(TICK_MS);
      await flush();
    }
    const midway = { ...e.world.gripper.pos, z: e.world.gripper.z };
    expect(e.isBusy()).toBe(true);

    e.pause();
    await flush();
    expect(outcome).toBe("interrupted");
    expect(e.world.status).toBe("paused");
    expect(e.isBusy()).toBe(false);
    expect(e.world.lastSkill?.outcome).toBe("interrupted");

    const frozenT = e.world.t;
    for (let i = 0; i < 10; i += 1) {
      e.step(TICK_MS);
      await flush();
    }
    expect(e.world.gripper.pos.x).toBeCloseTo(midway.x, 6);
    expect(e.world.gripper.pos.y).toBeCloseTo(midway.y, 6);
    expect(e.world.gripper.z).toBeCloseTo(midway.z, 6);
    expect(e.world.t).toBe(frozenT); // t only advances while running

    e.resume();
    expect(e.world.status).toBe("running");
    e.step(TICK_MS);
    expect(e.world.t).toBe(frozenT + TICK_MS);
  });

  it("keeps a held object held across a pause", async () => {
    const e = createEngine(SEED);
    e.start();
    await runSequence(e, [
      { skill: "move_to", target: "marker" },
      { skill: "descend" },
      { skill: "grasp" },
      { skill: "lift" },
    ]);
    void e.execute({ skill: "move_to", target: "bag" });
    await flush();
    e.step(TICK_MS);
    await flush();
    e.pause();
    expect(e.world.gripper.holding).toBe("marker");
    expect(obj(e.world, "marker").state).toBe("held");
  });

  it("stop cancels the in-flight skill and reports ok", async () => {
    const e = createEngine(SEED);
    e.start();
    let moveOutcome: string | null = null;
    void e.execute({ skill: "move_to", target: "sponge" }).then((o) => {
      moveOutcome = o;
    });
    await flush();
    e.step(TICK_MS);
    await flush();
    const stop = await e.execute({ skill: "stop" });
    await flush();
    expect(stop).toBe("ok");
    expect(moveOutcome).toBe("interrupted");
    expect(e.isBusy()).toBe(false);
    expect(e.world.status).toBe("running"); // stop is not pause
  });

  it("executes corrections while paused without unfreezing the clock", async () => {
    const e = createEngine(SEED);
    e.start();
    await runSkill(e, { skill: "move_to", target: "marker" });
    e.pause();
    const tBefore = e.world.t;
    const r = await runSkill(e, { skill: "nudge", dx: -3, dy: 0 });
    expect(r.outcome).toBe("ok");
    expect(e.world.t).toBe(tBefore);
    expect(e.world.status).toBe("paused");
  });
});

describe("run termination", () => {
  it("fails after 3 consecutive failures", async () => {
    const e = createEngine(SEED);
    e.start();
    await runSequence(e, [
      { skill: "move_to", target: { x: 0, y: 18 } },
      { skill: "descend" },
      { skill: "grasp" },
      { skill: "grasp" },
      { skill: "grasp" },
    ]);
    expect(e.world.consecutiveFailures).toBeGreaterThanOrEqual(3);
    expect(e.world.status).toBe("failed");
  });

  it("reset restores the initial world for a seed", async () => {
    const e = createEngine(SEED);
    e.start();
    await pack(e, "marker");
    e.reset(SEED);
    expect(e.world.status).toBe("idle");
    expect(e.world.t).toBe(0);
    expect(e.world.stagesDone).toBe(0);
    expect(e.world.bag.contents).toEqual([]);
    expect(JSON.stringify(e.world)).toBe(JSON.stringify(createEngine(SEED).world));
  });
});

describe("ring buffer", () => {
  it("keeps the newest entries within capacity", () => {
    const rb = new RingBuffer<number>(4);
    for (let i = 0; i < 10; i += 1) rb.push(i);
    expect(rb.size).toBe(4);
    expect(rb.toArray()).toEqual([6, 7, 8, 9]);
    expect(rb.last()).toBe(9);
    rb.clear();
    expect(rb.size).toBe(0);
    expect(rb.toArray()).toEqual([]);
  });

  it("getRecentStates returns at most the requested window, oldest first", async () => {
    const e = createEngine(SEED);
    e.start();
    await runSkill(e, { skill: "move_to", target: "sponge" }); // several seconds of ticks
    const states = e.getRecentStates(2000);
    expect(states.length).toBeGreaterThan(0);
    expect(states.length).toBeLessThanOrEqual(2000 / TICK_MS + 1);
    const newest = states[states.length - 1].t;
    expect(newest).toBe(e.world.t);
    expect(newest - states[0].t).toBeLessThanOrEqual(2000);
    for (let i = 1; i < states.length; i += 1) {
      expect(states[i].t).toBeGreaterThanOrEqual(states[i - 1].t);
    }
    // never more than the 2.5 s window, whatever is asked for
    expect(e.getRecentStates(60_000).length).toBeLessThanOrEqual(2500 / TICK_MS + 8);
  });
});

describe("observation", () => {
  it("adds bounded, stable perception noise", async () => {
    const e = createEngine(SEED);
    e.start();
    const first = e.getObservation();
    for (const o of first.objects) {
      const truth = obj(e.world, o.id);
      expect(Math.abs(o.estimatedPos.x - truth.pos.x)).toBeLessThanOrEqual(PERCEPTION_NOISE + 1e-6);
      expect(Math.abs(o.estimatedPos.y - truth.pos.y)).toBeLessThanOrEqual(PERCEPTION_NOISE + 1e-6);
    }
    // noise is stable within a run: the offset does not change after the world moves
    const before = first.objects.map((o) => ({
      id: o.id,
      dx: o.estimatedPos.x - obj(e.world, o.id).pos.x,
    }));
    await runSkill(e, { skill: "move_to", target: "marker" });
    const after = e.getObservation();
    for (const b of before) {
      const o = after.objects.find((x) => x.id === b.id)!;
      expect(o.estimatedPos.x - obj(e.world, o.id).pos.x).toBeCloseTo(b.dx, 6);
    }
  });

  it("hides the quirks from the policy", async () => {
    const e = createEngine(SEED);
    e.start();
    await runSequence(e, [
      { skill: "move_to", target: "sponge" },
      { skill: "descend" },
      { skill: "grasp" },
      { skill: "squeeze" },
    ]);
    expect(obj(e.world, "sponge").compressed).toBe(true);

    const obs = e.getObservation();
    const sponge = obs.objects.find((o) => o.id === "sponge")!;
    expect(Object.keys(sponge).sort()).toEqual(["estimatedPos", "id", "label", "size", "state"]);
    expect(sponge.size.w).toBe(8); // nominal size, the squeeze is invisible
    expect(JSON.stringify(obs)).not.toContain("compressed");
    expect(JSON.stringify(obs)).not.toContain("graspPoint");
    expect(Object.keys(obs.bag).sort()).toEqual(["contents", "openingLooksNarrow", "pos"]);
  });

  it("keeps at most the last 6 skills in recentHistory", async () => {
    const e = createEngine(SEED);
    e.start();
    await runSequence(e, [
      { skill: "wait", ms: 50 },
      { skill: "wait", ms: 50 },
      { skill: "wait", ms: 50 },
      { skill: "wait", ms: 50 },
      { skill: "wait", ms: 50 },
      { skill: "wait", ms: 50 },
      { skill: "wait", ms: 50 },
      { skill: "wait", ms: 50 },
    ]);
    expect(e.getObservation().recentHistory.length).toBe(6);
  });
});

describe("subscribe", () => {
  it("notifies on every tick with a fresh snapshot", async () => {
    const e = createEngine(SEED);
    const seen: WorldState[] = [];
    const off = e.subscribe((w) => seen.push(w));
    e.start();
    await idleTicks(e, 3);
    expect(seen.length).toBeGreaterThanOrEqual(3);
    expect(seen[0]).not.toBe(seen[1]);
    off();
    const n = seen.length;
    await idleTicks(e, 2);
    expect(seen.length).toBe(n);
  });
});
