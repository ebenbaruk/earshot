import { describe, expect, it } from "vitest";
import {
  extractOrderHint,
  normalize,
  parseCorrectionFast,
  BIG_STEP_CM,
  DEFAULT_STEP_CM,
  NARROW_GRIPPER_CM,
  SMALL_STEP_CM,
  WIDE_GRIPPER_CM,
} from "@/lib/corrections/grammar";
import type { SkillCommand } from "@/lib/types";

type Case = [utterance: string, expected: SkillCommand | null];

const nudge = (dx: number, dy: number): SkillCommand => ({ skill: "nudge", dx, dy });

const CASES: Case[] = [
  // --- directions -> nudge -------------------------------------------------
  ["a bit to the left", nudge(-SMALL_STEP_CM, 0)],
  ["move it a little to the right", nudge(SMALL_STEP_CM, 0)],
  ["slightly left", nudge(-SMALL_STEP_CM, 0)],
  ["go left", nudge(-DEFAULT_STEP_CM, 0)],
  ["to the right", nudge(DEFAULT_STEP_CM, 0)],
  ["two centimeters to the left", nudge(-2, 0)],
  ["move 3 cm right", nudge(3, 0)],
  ["a lot further away", nudge(0, BIG_STEP_CM)],
  ["come closer", nudge(0, -DEFAULT_STEP_CM)],
  ["back up a bit", nudge(0, -SMALL_STEP_CM)],
  ["toward me please", nudge(0, -DEFAULT_STEP_CM)],
  ["forward a little", nudge(0, SMALL_STEP_CM)],

  // --- gripper -------------------------------------------------------------
  ["wider", { skill: "set_gripper", width: WIDE_GRIPPER_CM }],
  ["open the gripper", { skill: "set_gripper", width: WIDE_GRIPPER_CM }],
  ["narrower", { skill: "set_gripper", width: NARROW_GRIPPER_CM }],
  ["tighter", { skill: "set_gripper", width: NARROW_GRIPPER_CM }],

  // --- squeeze / bag -------------------------------------------------------
  ["squeeze it", { skill: "squeeze" }],
  ["compress the sponge", { skill: "squeeze" }],
  ["squish it first", { skill: "squeeze" }],
  ["widen the bag", { skill: "widen_bag" }],
  ["open the bag", { skill: "widen_bag" }],
  ["the bag is too narrow", { skill: "widen_bag" }],

  // --- primitive skills ----------------------------------------------------
  ["release it", { skill: "release" }],
  ["let go", { skill: "release" }],
  ["drop it", { skill: "release" }],
  ["lift it up", { skill: "lift" }],
  ["pick it up", { skill: "lift" }],
  ["lower the gripper", { skill: "descend" }],
  ["go down", { skill: "descend" }],
  ["grab it", { skill: "grasp" }],
  ["close the gripper", { skill: "grasp" }],

  // --- flow control --------------------------------------------------------
  ["continue", { skill: "wait", ms: 0 }],
  ["go on", { skill: "wait", ms: 0 }],
  ["carry on", { skill: "wait", ms: 0 }],
  ["okay go", { skill: "wait", ms: 0 }],
  ["resume", { skill: "wait", ms: 0 }],
  ["stop", { skill: "stop" }],
  ["wait", { skill: "stop" }],
  ["hold on", { skill: "stop" }],

  // --- navigation ----------------------------------------------------------
  ["go to the bag", { skill: "move_to", target: "bag" }],
  ["move to the marker", { skill: "move_to", target: "marker" }],
  ["put it in the bag", { skill: "move_to", target: "bag" }],

  // --- ordering ------------------------------------------------------------
  ["pack the tape first", { skill: "move_to", target: "tape_holder" }],
  ["do the sponge first", { skill: "move_to", target: "sponge" }],
  ["put the marker last", null],
  ["the marker goes last", null],

  // --- French --------------------------------------------------------------
  ["un peu à gauche", nudge(-SMALL_STEP_CM, 0)],
  ["à droite", nudge(DEFAULT_STEP_CM, 0)],
  ["serre", { skill: "squeeze" }],
  ["stop", { skill: "stop" }],
  ["arrête", { skill: "stop" }],
  ["attends", { skill: "stop" }],
  ["lâche", { skill: "release" }],
  ["ouvre le sac", { skill: "widen_bag" }],
  ["descends", { skill: "descend" }],
  ["vas-y", { skill: "wait", ms: 0 }],

  // --- unparseable ---------------------------------------------------------
  ["hmm interesting", null],
  ["", null],
];

describe("parseCorrectionFast", () => {
  it("covers at least 25 phrasings", () => {
    expect(CASES.length).toBeGreaterThanOrEqual(25);
  });

  for (const [utterance, expected] of CASES) {
    it(`maps ${JSON.stringify(utterance)}`, () => {
      expect(parseCorrectionFast(utterance)).toEqual(expected);
    });
  }

  it("is case insensitive and accent insensitive", () => {
    expect(parseCorrectionFast("SQUEEZE IT")).toEqual({ skill: "squeeze" });
    expect(parseCorrectionFast("Un Peu À Gauche")).toEqual(
      parseCorrectionFast("un peu a gauche"),
    );
  });
});

describe("normalize", () => {
  it("strips diacritics, punctuation and case", () => {
    expect(normalize("Arrête !")).toBe("arrete");
    expect(normalize("  un  PEU,  à gauche. ")).toBe("un peu a gauche.");
  });
});

describe("extractOrderHint", () => {
  it("finds 'last' preferences", () => {
    expect(extractOrderHint("put the marker last")).toEqual({
      object: "marker",
      position: "last",
    });
    expect(extractOrderHint("the marker goes last")).toEqual({
      object: "marker",
      position: "last",
    });
  });

  it("finds 'first' preferences", () => {
    expect(extractOrderHint("pack the tape first")).toEqual({
      object: "tape_holder",
      position: "first",
    });
    expect(extractOrderHint("commence par l'éponge")).toEqual({
      object: "sponge",
      position: "first",
    });
  });

  it("returns null without an object or a position word", () => {
    expect(extractOrderHint("do it first")).toBeNull();
    expect(extractOrderHint("grab the marker")).toBeNull();
  });

  it("'X last' yields a hint but no command", () => {
    expect(parseCorrectionFast("put the marker last")).toBeNull();
    expect(extractOrderHint("put the marker last")).not.toBeNull();
  });
});
