"use client";

/**
 * Temporary preview page for the simulation worker (owned by `sim`).
 * Not part of the final UI — `app/page.tsx` is owned by the ui worker.
 */

import { useRef, useState } from "react";
import { SceneNoSSR } from "@/components/Scene/SceneNoSSR";
import { DEFAULT_SEED, getSimEngine, useSimStore } from "@/store/useSimStore";
import type { ObjectId, SkillCommand, SkillOutcome } from "@/lib/types";

const QUICK: Array<[string, SkillCommand]> = [
  ["→ marker", { skill: "move_to", target: "marker" }],
  ["→ sponge", { skill: "move_to", target: "sponge" }],
  ["→ tape", { skill: "move_to", target: "tape_holder" }],
  ["→ egg", { skill: "move_to", target: "egg" }],
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

const pick = (id: ObjectId): SkillCommand[] => [
  { skill: "move_to", target: id },
  { skill: "descend" },
  { skill: "grasp" },
  { skill: "lift" },
];

/** Lower the item to the rim before letting go — the only way the egg survives. */
const packGently = (id: ObjectId): SkillCommand[] => [
  ...pick(id),
  { skill: "move_to", target: "bag" },
  { skill: "descend" },
  { skill: "release" },
];

/**
 * The full story, same beats as `scripts/sim-headless.ts`:
 * naive marker-first pack, a blocked sponge, a squeeze, the marker rolling out,
 * two slipped grasps on the tape holder, then a clean finish.
 */
const DEMO: SkillCommand[] = [
  ...pick("marker"),
  { skill: "move_to", target: "bag" },
  { skill: "release" },

  ...pick("sponge"),
  { skill: "move_to", target: "bag" },
  { skill: "release" }, // blocked: too fat
  { skill: "squeeze" },
  { skill: "release" }, // lands on the marker -> roll-out

  { skill: "move_to", target: "tape_holder" },
  { skill: "descend" },
  { skill: "grasp" }, // slipped: off the ring
  { skill: "nudge", dx: -2, dy: 0 },
  { skill: "grasp" }, // slipped: gripper too narrow
  { skill: "set_gripper", width: 7.5 },
  { skill: "grasp" },
  { skill: "lift" },
  { skill: "move_to", target: "bag" },
  { skill: "release" },

  ...pick("marker"),
  { skill: "move_to", target: "bag" },
  { skill: "release" },
];

/** Set pieces for screenshots / eyeballing one behaviour at a time. */
const SCENES: Array<[string, SkillCommand[]]> = [
  [
    "pose: over tape",
    [
      { skill: "move_to", target: "tape_holder" },
      { skill: "descend" },
    ],
  ],
  [
    "slip x2",
    [
      { skill: "move_to", target: "tape_holder" },
      { skill: "descend" },
      { skill: "grasp" },
      { skill: "wait", ms: 600 },
      { skill: "grasp" },
    ],
  ],
  [
    "squeeze sponge",
    [
      ...pick("sponge"),
      { skill: "move_to", target: "bag" },
      { skill: "squeeze" },
    ],
  ],
  [
    // Leaves the squeezed sponge hanging over the bag with the marker already
    // inside: one click on `release` then plays the roll-out on demand.
    "arm roll-out",
    [
      ...pick("marker"),
      { skill: "move_to", target: "bag" },
      { skill: "release" },
      ...pick("sponge"),
      { skill: "squeeze" },
      { skill: "move_to", target: "bag" },
    ],
  ],
  [
    "roll-out",
    [
      ...pick("marker"),
      { skill: "move_to", target: "bag" },
      { skill: "release" },
      ...pick("sponge"),
      { skill: "squeeze" },
      { skill: "move_to", target: "bag" },
      { skill: "release" },
    ],
  ],
  [
    // Drops the egg from carry height over the bag: it cracks, the mess fades,
    // a fresh one is put back on the table.
    "crack the egg",
    [
      ...pick("egg"),
      { skill: "move_to", target: "bag" },
      { skill: "release" },
    ],
  ],
  [
    // The same beat done right: descend to the rim first, then let go.
    "pack the egg properly",
    packGently("egg"),
  ],
  [
    "fill the bag",
    [
      ...pick("sponge"),
      { skill: "squeeze" },
      { skill: "move_to", target: "bag" },
      { skill: "descend" },
      { skill: "release" },
      { skill: "move_to", target: "tape_holder" },
      { skill: "descend" },
      { skill: "nudge", dx: -2, dy: 0 },
      { skill: "set_gripper", width: 7.5 },
      { skill: "grasp" },
      { skill: "lift" },
      { skill: "move_to", target: "bag" },
      { skill: "descend" },
      { skill: "release" },
      ...packGently("egg"),
      ...packGently("marker"),
    ],
  ],
];

// Handy for poking the sim from the browser console on this preview page.
if (typeof window !== "undefined") {
  (window as unknown as Record<string, unknown>).__sim = { store: useSimStore, engine: getSimEngine() };
}

export default function SimPreviewPage() {
  const world = useSimStore((s) => s.world);
  const store = useSimStore.getState();
  const [log, setLog] = useState<string[]>([]);
  const [hud, setHud] = useState(true);
  const [debug, setDebug] = useState(false);
  const running = useRef(false);

  const push = (line: string) => setLog((l) => [line, ...l].slice(0, 14));

  const run = async (cmd: SkillCommand) => {
    const outcome: SkillOutcome = await store.execute(cmd);
    push(`${cmd.skill} → ${outcome}`);
  };

  /** Set pieces always start from a fresh seed, so they can be replayed at will. */
  const runScript = async (script: SkillCommand[]) => {
    if (running.current) return;
    running.current = true;
    store.reset(DEFAULT_SEED);
    setLog([]);
    store.start();
    try {
      for (const cmd of script) {
        // The scene renders whatever the world contains; a script that names an
        // object this engine build does not have is skipped instead of throwing.
        if (cmd.skill === "move_to" && typeof cmd.target === "string" && cmd.target !== "bag") {
          const known = useSimStore.getState().world.objects.some((o) => o.id === cmd.target);
          if (!known) {
            push(`move_to ${cmd.target} → skipped (not in this world)`);
            break;
          }
        }
        const outcome = await store.execute(cmd);
        push(`${cmd.skill} → ${outcome}`);
        if (useSimStore.getState().world.status === "failed") break;
      }
    } finally {
      running.current = false;
    }
  };

  /** Kick off a long traverse and hit stop half way: the pause flash set piece. */
  const stopMidMove = () => {
    store.reset(DEFAULT_SEED);
    store.start();
    void store.execute({ skill: "move_to", target: "tape_holder" });
    window.setTimeout(() => store.pause(), 420);
  };

  const btn =
    "rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-200 hover:bg-zinc-800 active:bg-zinc-700";
  const btnHot =
    "rounded border border-orange-700/70 bg-orange-950/50 px-2 py-1 text-xs text-orange-200 hover:bg-orange-900/50";

  return (
    <div className="flex h-screen w-full flex-col bg-black text-zinc-200">
      <div className="flex flex-wrap items-center gap-1.5 border-b border-zinc-800 p-2">
        <button className={btn} onClick={() => store.start()}>start</button>
        <button className={btn} onClick={() => store.pause()}>pause</button>
        <button className={btn} onClick={() => store.resume()}>resume</button>
        <button className={btn} onClick={() => { store.reset(DEFAULT_SEED); setLog([]); }}>reset 42</button>
        <button className={btnHot} onClick={() => void runScript(DEMO)}>run demo</button>
        <button className={btn} onClick={stopMidMove}>stop mid-move</button>
        <span className="mx-1 h-4 w-px bg-zinc-700" />
        {SCENES.map(([label, script]) => (
          <button key={label} className={btnHot} onClick={() => void runScript(script)}>
            {label}
          </button>
        ))}
        <span className="mx-1 h-4 w-px bg-zinc-700" />
        {QUICK.map(([label, cmd]) => (
          <button key={label} className={btn} onClick={() => void run(cmd)}>
            {label}
          </button>
        ))}
        <span className="mx-1 h-4 w-px bg-zinc-700" />
        <button className={btn} onClick={() => setHud((h) => !h)}>{hud ? "hide hud" : "show hud"}</button>
        <button className={btn} onClick={() => setDebug((d) => !d)}>
          {debug ? "hide plumb lines" : "plumb lines"}
        </button>
      </div>

      <div className="relative flex-1">
        <SceneNoSSR debug={debug} />
        {hud ? (
          <>
            <div className="pointer-events-none absolute left-3 top-3 rounded bg-black/60 p-2 font-mono text-[11px] leading-5 text-zinc-300">
              <div>
                status <b>{world.status}</b> · t {Math.round(world.t)}ms · stages {world.stagesDone}/{world.objects.length}
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
          </>
        ) : null}
      </div>
    </div>
  );
}
