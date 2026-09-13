/**
 * Earshot simulation engine — pure TypeScript, no React, headless capable.
 *
 * The engine owns the world. Skills are *animated*: `execute()` starts one skill,
 * `step(dtMs)` advances it, and the promise returned by `execute()` settles when the
 * animation finishes (or immediately with "interrupted" if it is cancelled).
 *
 * Outcomes are decided the moment a skill starts (all preconditions are known then)
 * and the world mutation is applied when the animation completes. That keeps the
 * simulation fully deterministic for a given seed and command sequence.
 */

import type {
  Observation,
  ObservedObject,
  ObjectId,
  SimObject,
  SkillCommand,
  SkillOutcome,
  Vec2,
  WorldState,
} from "@/lib/types";
import {
  BAG_NARROW_BELOW,
  BAG_OPENING_MAX,
  BAG_OPENING_STEP,
  BAG_POS,
  BAG_RELEASE_RADIUS,
  DESCEND_MS,
  DURATION,
  DEFAULT_GRIPPER_WIDTH,
  GRASP_RADIUS,
  GRIPPER_START_POS,
  GRIPPER_START_Z,
  GRIPPER_WIDTH_RANGE,
  HISTORY_CAPACITY,
  HISTORY_MS,
  LIFT_Z,
  MAX_CONSECUTIVE_FAILURES,
  MAX_RUN_MS,
  MOVE_SPEED,
  OVER_OBJECT_MARGIN,
  ROLLOUT_OFFSET_X,
  SLIP_DISPLACEMENT,
  STAGE_COUNT,
  Z_SPEED,
  clamp,
  clampToTable,
  dist,
  effectiveSize,
  effectiveWidth,
  graspPoint,
  lerp,
  requiredGripperWidth,
} from "./constants";
import { createLayout } from "./layout";
import { RingBuffer } from "./ringBuffer";
import { deriveSeed, mulberry32, type Rng } from "./seed";

export interface Engine {
  /** Immutable snapshot of the current world (new object identity on every change). */
  readonly world: WorldState;
  step(dtMs: number): void;
  execute(cmd: SkillCommand): Promise<SkillOutcome>;
  start(): void;
  pause(): void;
  resume(): void;
  reset(seed: number): void;
  isBusy(): boolean;
  getObservation(): Observation;
  getRecentStates(ms: number): WorldState[];
  subscribe(listener: (world: WorldState) => void): () => void;
}

type Activity = {
  command: SkillCommand;
  outcome: SkillOutcome;
  elapsed: number;
  duration: number;
  animate: (p: number) => void;
  apply: () => void;
  settle: (outcome: SkillOutcome) => void;
};

const FAILURE_OUTCOMES: ReadonlySet<SkillOutcome> = new Set<SkillOutcome>([
  "slipped",
  "missed",
  "blocked",
  "rolled_out",
]);

function snapshot(w: WorldState): WorldState {
  return {
    t: w.t,
    seed: w.seed,
    status: w.status,
    objects: w.objects.map((o) => ({
      id: o.id,
      label: o.label,
      pos: { x: o.pos.x, y: o.pos.y },
      size: { ...o.size },
      state: o.state,
      compressed: o.compressed,
    })),
    gripper: {
      pos: { x: w.gripper.pos.x, y: w.gripper.pos.y },
      z: w.gripper.z,
      width: w.gripper.width,
      holding: w.gripper.holding,
    },
    bag: {
      pos: { x: w.bag.pos.x, y: w.bag.pos.y },
      opening: w.bag.opening,
      contents: [...w.bag.contents],
    },
    stagesDone: w.stagesDone,
    lastSkill: w.lastSkill ? { command: w.lastSkill.command, outcome: w.lastSkill.outcome } : null,
    consecutiveFailures: w.consecutiveFailures,
  };
}

export function createEngine(seed: number): Engine {
  let world: WorldState;
  let noise: Record<ObjectId, Vec2>;
  let rng: Rng;
  let activity: Activity | null = null;
  let pending: { command: SkillCommand; settle: (o: SkillOutcome) => void } | null = null;
  let rolloutTicks = 0;
  let rolledOutId: ObjectId | null = null;
  let history: RingBuffer<WorldState> = new RingBuffer<WorldState>(HISTORY_CAPACITY);
  let recent: Array<{ command: SkillCommand; outcome: SkillOutcome }> = [];
  let current: WorldState;
  const listeners = new Set<(w: WorldState) => void>();

  // --- helpers ------------------------------------------------------------

  function obj(id: ObjectId): SimObject {
    const found = world.objects.find((o) => o.id === id);
    if (!found) throw new Error(`unknown object ${id}`);
    return found;
  }

  function held(): SimObject | null {
    return world.gripper.holding ? obj(world.gripper.holding) : null;
  }

  function commit(): void {
    current = snapshot(world);
    for (const l of listeners) l(current);
  }

  function recountStages(): void {
    world.stagesDone = world.objects.filter((o) => o.state === "in_bag").length;
  }

  function initWorld(nextSeed: number): void {
    const layout = createLayout(nextSeed);
    noise = layout.noise;
    rng = mulberry32(deriveSeed(nextSeed, 0x5eed));
    world = {
      t: 0,
      seed: nextSeed,
      status: "idle",
      objects: layout.objects,
      gripper: {
        pos: { ...GRIPPER_START_POS },
        z: GRIPPER_START_Z,
        width: DEFAULT_GRIPPER_WIDTH,
        holding: null,
      },
      bag: { pos: { ...BAG_POS }, opening: BAG_OPENING_MAX, contents: [] },
      stagesDone: 0,
      lastSkill: null,
      consecutiveFailures: 0,
    };
    history = new RingBuffer<WorldState>(HISTORY_CAPACITY);
    recent = [];
    rolloutTicks = 0;
    rolledOutId = null;
    current = snapshot(world);
  }

  function cancelActivity(outcome: SkillOutcome = "interrupted"): void {
    if (!activity) return;
    const a = activity;
    activity = null;
    world.lastSkill = { command: a.command, outcome };
    a.settle(outcome);
  }

  function cancelPending(outcome: SkillOutcome = "interrupted"): void {
    if (!pending) return;
    const p = pending;
    pending = null;
    p.settle(outcome);
  }

  function recordOutcome(command: SkillCommand, outcome: SkillOutcome): void {
    world.lastSkill = { command, outcome };
    recent.push({ command, outcome });
    if (recent.length > 6) recent.shift();
    if (outcome === "interrupted") return;
    if (FAILURE_OUTCOMES.has(outcome)) world.consecutiveFailures += 1;
    else world.consecutiveFailures = 0;
  }

  function checkTerminal(): void {
    if (world.status !== "running") return;
    recountStages();
    if (world.stagesDone >= STAGE_COUNT) {
      world.status = "succeeded";
      return;
    }
    if (world.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES || world.t > MAX_RUN_MS) {
      world.status = "failed";
    }
  }

  // --- skill construction -------------------------------------------------

  function targetPos(target: Extract<SkillCommand, { skill: "move_to" }>["target"]): Vec2 {
    if (typeof target === "string") {
      if (target === "bag") return { ...world.bag.pos };
      // NOTE: move_to aims at the *visual centroid*, not the real grasp point.
      return { ...obj(target).pos };
    }
    return clampToTable({ x: target.x, y: target.y });
  }

  /** Object the gripper is currently over (footprint + margin), nearest first. */
  function objectUnderGripper(): SimObject | null {
    const g = world.gripper.pos;
    let best: SimObject | null = null;
    let bestDist = Infinity;
    for (const o of world.objects) {
      if (o.state !== "on_table" && o.state !== "rolled_out") continue;
      const size = effectiveSize(o);
      const dx = Math.abs(g.x - o.pos.x);
      const dy = Math.abs(g.y - o.pos.y);
      if (dx > size.w / 2 + OVER_OBJECT_MARGIN) continue;
      if (dy > size.d / 2 + OVER_OBJECT_MARGIN) continue;
      const d = dist(g, o.pos);
      if (d < bestDist) {
        bestDist = d;
        best = o;
      }
    }
    return best;
  }

  function moveActivityParts(to: Vec2, keepZ: boolean) {
    const fromPos = { ...world.gripper.pos };
    const fromZ = world.gripper.z;
    const liftZ = keepZ ? fromZ : Math.max(fromZ, LIFT_Z);
    const liftMs = keepZ ? 0 : (Math.abs(liftZ - fromZ) / Z_SPEED) * 1000;
    const travelMs = (dist(fromPos, to) / MOVE_SPEED) * 1000;
    const total = Math.max(DURATION.min, liftMs + travelMs);
    return { fromPos, fromZ, liftZ, liftMs, travelMs, total, to };
  }

  function setGripperXY(p: Vec2): void {
    world.gripper.pos.x = p.x;
    world.gripper.pos.y = p.y;
    const h = held();
    if (h) {
      h.pos.x = p.x;
      h.pos.y = p.y;
    }
  }

  function buildActivity(
    command: SkillCommand,
    settle: (o: SkillOutcome) => void,
  ): Activity {
    const mk = (
      outcome: SkillOutcome,
      duration: number,
      animate: (p: number) => void,
      apply: () => void,
    ): Activity => ({
      command,
      outcome,
      elapsed: 0,
      duration: Math.max(DURATION.min, duration),
      animate,
      apply,
      settle,
    });
    const noop = () => {};

    switch (command.skill) {
      case "move_to":
      case "nudge": {
        const to =
          command.skill === "move_to"
            ? targetPos(command.target)
            : clampToTable({
                x: world.gripper.pos.x + command.dx,
                y: world.gripper.pos.y + command.dy,
              });
        const parts = moveActivityParts(to, command.skill === "nudge");
        return mk(
          "ok",
          parts.total,
          (p) => {
            const ms = p * parts.total;
            if (parts.liftMs > 0 && ms < parts.liftMs) {
              world.gripper.z = lerp(parts.fromZ, parts.liftZ, ms / parts.liftMs);
              return;
            }
            world.gripper.z = parts.liftZ;
            const tt = parts.travelMs > 0 ? clamp((ms - parts.liftMs) / parts.travelMs, 0, 1) : 1;
            setGripperXY({
              x: lerp(parts.fromPos.x, parts.to.x, tt),
              y: lerp(parts.fromPos.y, parts.to.y, tt),
            });
          },
          () => {
            world.gripper.z = parts.liftZ;
            setGripperXY(parts.to);
          },
        );
      }

      case "set_gripper": {
        const from = world.gripper.width;
        const to = clamp(command.width, GRIPPER_WIDTH_RANGE.min, GRIPPER_WIDTH_RANGE.max);
        return mk(
          "ok",
          DURATION.setGripper,
          (p) => {
            world.gripper.width = lerp(from, to, p);
          },
          () => {
            world.gripper.width = to;
          },
        );
      }

      case "descend": {
        const from = world.gripper.z;
        const duration = from <= 0 ? DURATION.min : (from / LIFT_Z) * DESCEND_MS;
        return mk(
          "ok",
          duration,
          (p) => {
            world.gripper.z = lerp(from, 0, p);
          },
          () => {
            world.gripper.z = 0;
          },
        );
      }

      case "lift": {
        const from = world.gripper.z;
        const duration = (Math.abs(LIFT_Z - from) / Z_SPEED) * 1000;
        return mk(
          "ok",
          duration,
          (p) => {
            world.gripper.z = lerp(from, LIFT_Z, p);
          },
          () => {
            world.gripper.z = LIFT_Z;
          },
        );
      }

      case "grasp": {
        if (world.gripper.holding) return mk("blocked", DURATION.min, noop, noop);
        if (world.gripper.z > 0.01) return mk("blocked", DURATION.min, noop, noop);

        const candidate = objectUnderGripper();
        if (!candidate) return mk("missed", DURATION.grasp, noop, noop);

        const gp = graspPoint(candidate);
        const offGraspPoint = dist(world.gripper.pos, gp) > GRASP_RADIUS;
        const tooNarrow = world.gripper.width < requiredGripperWidth(candidate);

        if (offGraspPoint || tooNarrow) {
          // Fingers close, the object lifts ~1 cm, then drops back slightly displaced.
          const angle = rng() * Math.PI * 2;
          const jitter = {
            x: Math.cos(angle) * SLIP_DISPLACEMENT,
            y: Math.sin(angle) * SLIP_DISPLACEMENT,
          };
          const baseZ = world.gripper.z;
          const id = candidate.id;
          return mk(
            "slipped",
            DURATION.graspSlip,
            (p) => {
              // 0 -> 1 cm -> 0
              world.gripper.z = baseZ + Math.sin(clamp(p, 0, 1) * Math.PI) * 1;
            },
            () => {
              world.gripper.z = baseZ;
              const o = obj(id);
              o.pos = clampToTable({ x: o.pos.x + jitter.x, y: o.pos.y + jitter.y });
            },
          );
        }

        const id = candidate.id;
        return mk("ok", DURATION.grasp, noop, () => {
          const o = obj(id);
          o.state = "held";
          world.gripper.holding = id;
          o.pos.x = world.gripper.pos.x;
          o.pos.y = world.gripper.pos.y;
        });
      }

      case "release": {
        const h = held();
        if (!h) return mk("blocked", DURATION.min, noop, noop);

        const overBag = dist(world.gripper.pos, world.bag.pos) <= BAG_RELEASE_RADIUS;
        const id = h.id;

        if (!overBag) {
          const drop = clampToTable({ ...world.gripper.pos });
          return mk("ok", DURATION.release, noop, () => {
            const o = obj(id);
            o.state = "on_table";
            o.pos = drop;
            world.gripper.holding = null;
          });
        }

        // Bag rules.
        const width = effectiveWidth(h);
        const spongeTooFat = h.id === "sponge" && !h.compressed && world.bag.opening < BAG_OPENING_MAX;
        if (spongeTooFat || width > world.bag.opening) {
          return mk("blocked", DURATION.release, noop, noop);
        }

        // The marker rolls out if something else lands on top of it.
        const markerRolls =
          id !== "marker" && world.objects.some((o) => o.id === "marker" && o.state === "in_bag");

        return mk(markerRolls ? "rolled_out" : "ok", DURATION.release, noop, () => {
          const o = obj(id);
          o.state = "in_bag";
          o.pos = { ...world.bag.pos };
          world.gripper.holding = null;
          world.bag.contents.push(id);
          world.bag.opening = Math.max(0, world.bag.opening - BAG_OPENING_STEP);
          if (markerRolls) {
            const marker = obj("marker");
            marker.state = "rolled_out";
            marker.pos = clampToTable({
              x: world.bag.pos.x + ROLLOUT_OFFSET_X,
              y: world.bag.pos.y,
            });
            world.bag.contents = world.bag.contents.filter((c) => c !== "marker");
            rolledOutId = "marker";
            rolloutTicks = 1;
          }
        });
      }

      case "squeeze": {
        const h = held();
        if (h && h.id === "sponge") {
          return mk("ok", DURATION.squeeze, noop, () => {
            obj("sponge").compressed = true;
          });
        }
        return mk("ok", DURATION.squeeze, noop, noop);
      }

      case "widen_bag": {
        const from = world.bag.opening;
        return mk(
          "ok",
          DURATION.widenBag,
          (p) => {
            world.bag.opening = lerp(from, BAG_OPENING_MAX, p);
          },
          () => {
            world.bag.opening = BAG_OPENING_MAX;
          },
        );
      }

      case "wait":
        return mk("ok", command.ms ?? DURATION.wait, noop, noop);

      case "stop":
        // handled eagerly in execute(); included for completeness.
        return mk("ok", DURATION.min, noop, noop);
    }
  }

  function startActivity(command: SkillCommand, settle: (o: SkillOutcome) => void): void {
    activity = buildActivity(command, settle);
    activity.animate(0);
  }

  function finishActivity(): void {
    if (!activity) return;
    const a = activity;
    activity = null;
    a.animate(1);
    a.apply();
    recordOutcome(a.command, a.outcome);
    recountStages();
    a.settle(a.outcome);
    if (pending) {
      const p = pending;
      pending = null;
      startActivity(p.command, p.settle);
    }
  }

  // --- public API ---------------------------------------------------------

  initWorld(seed);

  const engine: Engine = {
    get world() {
      return current;
    },

    step(dtMs: number) {
      if (world.status !== "running" && world.status !== "paused") return;

      // A rolled-out object stays in the "rolled_out" state for exactly one tick
      // (so the UI can flash it) and is then back on the table.
      if (rolloutTicks > 0) {
        rolloutTicks -= 1;
        if (rolloutTicks === 0 && rolledOutId) {
          const o = obj(rolledOutId);
          if (o.state === "rolled_out") o.state = "on_table";
          rolledOutId = null;
        }
      }

      if (world.status === "running") world.t += dtMs;

      if (activity) {
        activity.elapsed += dtMs;
        const p = clamp(activity.elapsed / activity.duration, 0, 1);
        activity.animate(p);
        if (activity.elapsed >= activity.duration) finishActivity();
      }

      if (world.status === "running") {
        checkTerminal();
        history.push(snapshot(world));
      }
      commit();
    },

    execute(cmd: SkillCommand) {
      if (cmd.skill === "stop") {
        cancelPending();
        cancelActivity("interrupted");
        recordOutcome(cmd, "ok");
        commit();
        return Promise.resolve<SkillOutcome>("ok");
      }

      if (world.status === "succeeded" || world.status === "failed") {
        return Promise.resolve<SkillOutcome>("blocked");
      }

      // Convenience: executing a skill on an idle sim starts the run.
      if (world.status === "idle") {
        world.status = "running";
      }

      return new Promise<SkillOutcome>((resolve) => {
        let done = false;
        const settle = (o: SkillOutcome) => {
          if (done) return;
          done = true;
          resolve(o);
        };
        if (activity) {
          cancelPending();
          pending = { command: cmd, settle };
        } else {
          startActivity(cmd, settle);
        }
        commit();
      });
    },

    start() {
      if (world.status === "idle" || world.status === "paused") {
        world.status = "running";
        commit();
      }
    },

    pause() {
      if (world.status !== "running") return;
      cancelPending();
      cancelActivity("interrupted");
      world.status = "paused";
      commit();
    },

    resume() {
      if (world.status !== "paused") return;
      world.status = "running";
      commit();
    },

    reset(nextSeed: number) {
      cancelPending();
      cancelActivity("interrupted");
      initWorld(nextSeed);
      commit();
    },

    isBusy() {
      return activity !== null || pending !== null;
    },

    getObservation(): Observation {
      const objects: ObservedObject[] = world.objects.map((o) => ({
        id: o.id,
        label: o.label,
        estimatedPos: {
          x: Math.round((o.pos.x + noise[o.id].x) * 100) / 100,
          y: Math.round((o.pos.y + noise[o.id].y) * 100) / 100,
        },
        // Nominal size only: the policy never learns that the sponge is squeezed.
        size: { ...o.size },
        state: o.state,
      }));
      return {
        t: world.t,
        objects,
        gripper: {
          pos: { ...world.gripper.pos },
          z: world.gripper.z,
          width: world.gripper.width,
          holding: world.gripper.holding,
        },
        bag: {
          pos: { ...world.bag.pos },
          contents: [...world.bag.contents],
          openingLooksNarrow: world.bag.opening < BAG_NARROW_BELOW,
        },
        stagesDone: world.stagesDone,
        lastSkill: world.lastSkill
          ? { command: world.lastSkill.command, outcome: world.lastSkill.outcome }
          : null,
        recentHistory: recent.map((r) => ({ command: r.command, outcome: r.outcome })),
      };
    },

    getRecentStates(ms: number): WorldState[] {
      const all = history.toArray();
      if (all.length === 0) return [];
      const cutoff = all[all.length - 1].t - Math.min(ms, HISTORY_MS);
      return all.filter((s) => s.t >= cutoff);
    },

    subscribe(listener: (w: WorldState) => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };

  return engine;
}
