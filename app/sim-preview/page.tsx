"use client";

/**
 * Temporary preview page for the simulation worker (owned by `sim`).
 * Not part of the final UI — `app/page.tsx` is owned by the ui worker.
 */

import { useState } from "react";
import { SceneNoSSR } from "@/components/Scene/SceneNoSSR";
import { getSimEngine, useSimStore } from "@/store/useSimStore";
import type { SkillCommand, SkillOutcome } from "@/lib/types";

const QUICK: Array<[string, SkillCommand]> = [
  ["→ marker", { skill: "move_to", target: "marker" }],
  ["→ sponge", { skill: "move_to", target: "sponge" }],
  ["→ tape", { skill: "move_to", target: "tape_holder" }],
  ["→ bag", { skill: "move_to", target: "bag" }],
  ["descend", { skill: "descend" }],
  ["grasp", { skill: "grasp" }],
  ["lift", { skill: "lift" }],
  ["release", { skill: "release" }],
  ["squeeze", { skill: "squeeze" }],
  ["widen bag", { skill: "widen_bag" }],
  ["nudge ←2", { skill: "nudge", dx: -2, dy: 0 }],
  ["grip 7.5", { skill: "set_gripper", width: 7.5 }],
  ["stop", { skill: "stop" }],
];

const DEMO: SkillCommand[] = [
  { skill: "move_to", target: "marker" },
  { skill: "descend" },
  { skill: "grasp" },
  { skill: "lift" },
  { skill: "move_to", target: "bag" },
  { skill: "release" },
  { skill: "move_to", target: "sponge" },
  { skill: "descend" },
  { skill: "grasp" },
  { skill: "lift" },
  { skill: "move_to", target: "bag" },
  { skill: "release" },
  { skill: "squeeze" },
  { skill: "release" },
  { skill: "move_to", target: "tape_holder" },
  { skill: "descend" },
  { skill: "grasp" },
  { skill: "nudge", dx: -2, dy: 0 },
  { skill: "set_gripper", width: 7.5 },
  { skill: "grasp" },
  { skill: "lift" },
  { skill: "move_to", target: "bag" },
  { skill: "release" },
  { skill: "widen_bag" },
  { skill: "release" },
  { skill: "move_to", target: "marker" },
  { skill: "descend" },
  { skill: "grasp" },
  { skill: "lift" },
  { skill: "move_to", target: "bag" },
  { skill: "release" },
];

// Handy for poking the sim from the browser console on this preview page.
if (typeof window !== "undefined") {
  (window as unknown as Record<string, unknown>).__sim = { store: useSimStore, engine: getSimEngine() };
}

export default function SimPreviewPage() {
  const world = useSimStore((s) => s.world);
  const store = useSimStore.getState();
  const [log, setLog] = useState<string[]>([]);

  const push = (line: string) => setLog((l) => [line, ...l].slice(0, 14));

  const run = async (cmd: SkillCommand) => {
    const outcome: SkillOutcome = await store.execute(cmd);
    push(`${cmd.skill} → ${outcome}`);
  };

  const runDemo = async () => {
    store.start();
    for (const cmd of DEMO) {
      const outcome = await store.execute(cmd);
      push(`${cmd.skill} → ${outcome}`);
      if (useSimStore.getState().world.status === "failed") break;
    }
  };

  const btn =
    "rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-200 hover:bg-zinc-800 active:bg-zinc-700";

  return (
    <div className="flex h-screen w-full flex-col bg-black text-zinc-200">
      <div className="flex flex-wrap items-center gap-1.5 border-b border-zinc-800 p-2">
        <button className={btn} onClick={() => store.start()}>start</button>
        <button className={btn} onClick={() => store.pause()}>pause</button>
        <button className={btn} onClick={() => store.resume()}>resume</button>
        <button className={btn} onClick={() => { store.reset(42); setLog([]); }}>reset 42</button>
        <button className={btn} onClick={runDemo}>run demo</button>
        <span className="mx-2 h-4 w-px bg-zinc-700" />
        {QUICK.map(([label, cmd]) => (
          <button key={label} className={btn} onClick={() => void run(cmd)}>
            {label}
          </button>
        ))}
      </div>

      <div className="relative flex-1">
        <SceneNoSSR />
        <div className="pointer-events-none absolute left-3 top-3 rounded bg-black/60 p-2 font-mono text-[11px] leading-5 text-zinc-300">
          <div>
            status <b>{world.status}</b> · t {Math.round(world.t)}ms · stages {world.stagesDone}/3
          </div>
          <div>
            gripper ({world.gripper.pos.x.toFixed(1)}, {world.gripper.pos.y.toFixed(1)}) z
            {world.gripper.z.toFixed(1)} w{world.gripper.width.toFixed(1)} holding{" "}
            {world.gripper.holding ?? "—"}
          </div>
          <div>
            bag opening {world.bag.opening.toFixed(1)} · [{world.bag.contents.join(", ")}] · fails{" "}
            {world.consecutiveFailures}
          </div>
          <div>last {world.lastSkill ? `${world.lastSkill.command.skill} → ${world.lastSkill.outcome}` : "—"}</div>
        </div>
        <div className="pointer-events-none absolute right-3 top-3 w-56 rounded bg-black/60 p-2 font-mono text-[11px] leading-5 text-zinc-400">
          {log.map((l, i) => (
            <div key={`${l}-${i}`}>{l}</div>
          ))}
        </div>
      </div>
    </div>
  );
}
