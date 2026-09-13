/**
 * Headless driver helpers: run a skill to completion by stepping the engine.
 * Used by the headless demo script and the unit tests. Not needed in the browser
 * (the store's 20 Hz interval drives `step` there).
 */

import type { SkillCommand, SkillOutcome } from "@/lib/types";
import type { Engine } from "./engine";
import { TICK_MS } from "./constants";

/** Flush pending microtasks so promise callbacks run between ticks. */
async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

export interface StepResult {
  command: SkillCommand;
  outcome: SkillOutcome;
  stagesDone: number;
  t: number;
}

/** Execute one skill, stepping the engine at TICK_MS until it settles. */
export async function runSkill(
  engine: Engine,
  command: SkillCommand,
  maxTicks = 4000,
): Promise<StepResult> {
  let settled = false;
  let outcome: SkillOutcome = "interrupted";
  void engine.execute(command).then((o) => {
    settled = true;
    outcome = o;
  });
  await flush();
  for (let i = 0; i < maxTicks && !settled; i += 1) {
    engine.step(TICK_MS);
    await flush();
  }
  return {
    command,
    outcome,
    stagesDone: engine.world.stagesDone,
    t: engine.world.t,
  };
}

/** Execute a list of skills in order. */
export async function runSequence(
  engine: Engine,
  commands: SkillCommand[],
  onResult?: (r: StepResult) => void,
): Promise<StepResult[]> {
  const out: StepResult[] = [];
  for (const c of commands) {
    const r = await runSkill(engine, c);
    out.push(r);
    onResult?.(r);
  }
  return out;
}

/** Advance the engine by n ticks without executing anything. */
export async function idleTicks(engine: Engine, n: number): Promise<void> {
  for (let i = 0; i < n; i += 1) {
    engine.step(TICK_MS);
    await flush();
  }
}
