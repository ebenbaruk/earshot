/**
 * Headless simulation demo — `pnpm tsx scripts/sim-headless.ts`
 *
 * Runs seed 42 through a scripted sequence that first trips every hidden quirk
 * (tape grasp point, sponge too fat for the bag, marker rolling out of the bag,
 * bag opening shrinking) and then applies the corrections that make the run succeed.
 */

import { createEngine } from "@/lib/sim/engine";
import { runSkill } from "@/lib/sim/driver";
import type { SkillCommand } from "@/lib/types";

const SEED = 42;

type Row = { skill: string; outcome: string; stagesDone: number; t: number; note: string };

function describe(cmd: SkillCommand): string {
  switch (cmd.skill) {
    case "move_to":
      return `move_to(${typeof cmd.target === "string" ? cmd.target : `${cmd.target.x},${cmd.target.y}`})`;
    case "nudge":
      return `nudge(${cmd.dx},${cmd.dy})`;
    case "set_gripper":
      return `set_gripper(${cmd.width})`;
    case "wait":
      return `wait(${cmd.ms ?? 500})`;
    default:
      return cmd.skill;
  }
}

function pad(s: string, n: number): string {
  return s.length >= n ? s.slice(0, n) : s + " ".repeat(n - s.length);
}

async function main(): Promise<void> {
  const engine = createEngine(SEED);
  engine.start();

  const rows: Row[] = [];
  const script: Array<[SkillCommand, string]> = [
    // --- naive policy: grab the nearest object first (that is the marker) ---
    [{ skill: "move_to", target: "marker" }, "nearest object first"],
    [{ skill: "descend" }, ""],
    [{ skill: "grasp" }, ""],
    [{ skill: "lift" }, ""],
    [{ skill: "move_to", target: "bag" }, ""],
    [{ skill: "release" }, "marker packed (opening 12 -> 9)"],

    // --- QUIRK 2: the sponge is too fat for the bag ---
    [{ skill: "move_to", target: "sponge" }, ""],
    [{ skill: "descend" }, ""],
    [{ skill: "grasp" }, "sponge is deformable, width 6 is enough"],
    [{ skill: "lift" }, ""],
    [{ skill: "move_to", target: "bag" }, ""],
    [{ skill: "release" }, "QUIRK 2: 8 cm sponge vs 9 cm opening -> blocked"],
    [{ skill: "squeeze" }, "correction: 'squeeze it first'"],
    [{ skill: "release" }, "QUIRK 3: sponge lands on the marker -> marker rolls out"],

    // --- QUIRK 1: the tape holder can only be grabbed by its ring ---
    [{ skill: "move_to", target: "tape_holder" }, ""],
    [{ skill: "descend" }, ""],
    [{ skill: "grasp" }, "QUIRK 1: centroid is 2 cm off the ring -> slipped"],
    [{ skill: "nudge", dx: -2, dy: 0 }, "correction: 'a bit to the left'"],
    [{ skill: "grasp" }, "still slipped: gripper only 6 cm, tape is 7 cm"],
    [{ skill: "set_gripper", width: 7.5 }, "correction: 'open wider'"],
    [{ skill: "grasp" }, ""],
    [{ skill: "lift" }, ""],
    [{ skill: "move_to", target: "bag" }, ""],
    [{ skill: "release" }, "QUIRK 4: opening is 6 cm, tape is 7 cm -> blocked"],
    [{ skill: "widen_bag" }, "correction: 'open the bag'"],
    [{ skill: "release" }, "tape packed (opening 12 -> 9)"],

    // --- re-pack the marker LAST so nothing rolls it out again ---
    [{ skill: "move_to", target: "marker" }, "the marker is back on the table"],
    [{ skill: "descend" }, ""],
    [{ skill: "grasp" }, ""],
    [{ skill: "lift" }, ""],
    [{ skill: "move_to", target: "bag" }, ""],
    [{ skill: "release" }, "marker goes in last -> it stays"],
  ];

  for (const [cmd, note] of script) {
    const r = await runSkill(engine, cmd);
    rows.push({
      skill: describe(cmd),
      outcome: r.outcome,
      stagesDone: r.stagesDone,
      t: r.t,
      note,
    });
  }

  const header = `${pad("#", 4)}${pad("SKILL", 24)}${pad("OUTCOME", 13)}${pad("STAGES", 8)}${pad("T (ms)", 9)}NOTE`;
  console.log(`EARSHOT sim — seed ${SEED}`);
  console.log(header);
  console.log("-".repeat(header.length + 20));
  rows.forEach((r, i) => {
    console.log(
      `${pad(String(i + 1), 4)}${pad(r.skill, 24)}${pad(r.outcome, 13)}${pad(String(r.stagesDone), 8)}${pad(String(r.t), 9)}${r.note}`,
    );
  });

  const w = engine.world;
  console.log("-".repeat(header.length + 20));
  console.log(
    `status=${w.status}  stagesDone=${w.stagesDone}  bag.contents=[${w.bag.contents.join(", ")}]  bag.opening=${w.bag.opening}  t=${w.t}ms`,
  );

  if (w.status !== "succeeded") {
    console.error(`FAILED: expected status "succeeded", got "${w.status}"`);
    process.exitCode = 1;
  }
}

void main();
