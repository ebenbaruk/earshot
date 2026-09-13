/**
 * Zustand store wrapping the simulation engine.
 *
 * The engine is a module-level singleton so non-React code (the policy loop,
 * the correction pipeline, tests) can reach it through `getSimEngine()`.
 * A 20 Hz interval drives `engine.step(TICK_MS)`; it is created lazily on the
 * first `start()` and kept alive while the run is running *or* paused, so the
 * scene keeps rendering (and corrections can still animate) while `t` is frozen.
 */

import { create } from "zustand";
import type { Observation, SkillCommand, SkillOutcome, WorldState } from "@/lib/types";
import { createEngine, type Engine } from "@/lib/sim/engine";
import { TICK_MS } from "@/lib/sim/constants";

export const DEFAULT_SEED = 42;

let engine: Engine | null = null;

/** The simulation engine singleton. Safe to call from non-React code. */
export function getSimEngine(): Engine {
  if (!engine) engine = createEngine(DEFAULT_SEED);
  return engine;
}

export interface SimStore {
  world: WorldState;
  reset(seed: number): void;
  start(): void;
  pause(): void;
  resume(): void;
  execute(cmd: SkillCommand): Promise<SkillOutcome>;
  isBusy(): boolean;
  getObservation(): Observation;
  getRecentStates(ms: number): WorldState[];
}

let ticker: ReturnType<typeof setInterval> | null = null;

function ensureTicker(): void {
  if (ticker !== null) return;
  if (typeof window === "undefined") return; // never tick during SSR
  ticker = setInterval(() => {
    getSimEngine().step(TICK_MS);
  }, TICK_MS);
}

/** Stops the 20 Hz interval. Exported for tests / teardown; normally unnecessary. */
export function stopSimTicker(): void {
  if (ticker !== null) {
    clearInterval(ticker);
    ticker = null;
  }
}

export const useSimStore = create<SimStore>((set) => {
  const e = getSimEngine();
  e.subscribe((w) => set({ world: w }));

  return {
    world: e.world,
    reset(seed: number) {
      getSimEngine().reset(seed);
    },
    start() {
      ensureTicker();
      getSimEngine().start();
    },
    pause() {
      getSimEngine().pause();
    },
    resume() {
      ensureTicker();
      getSimEngine().resume();
    },
    execute(cmd: SkillCommand) {
      ensureTicker();
      return getSimEngine().execute(cmd);
    },
    isBusy() {
      return getSimEngine().isBusy();
    },
    getObservation() {
      return getSimEngine().getObservation();
    },
    getRecentStates(ms: number) {
      return getSimEngine().getRecentStates(ms);
    },
  };
});
