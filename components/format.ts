/** Pure formatting helpers shared by the HUD and the panels. */

import type { SkillCommand, SkillOutcome } from "@/lib/types";

const round = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

/** `move_to(tape_holder)`, `nudge(-2, 0)`, `set_gripper(4)` — monospace-ready. */
export function formatSkill(cmd: SkillCommand | null | undefined): string {
  if (!cmd) return "—";
  switch (cmd.skill) {
    case "move_to": {
      const t = cmd.target;
      const target =
        typeof t === "string" ? t : `${round(t.x)}, ${round(t.y)}`;
      return `move_to(${target})`;
    }
    case "nudge":
      return `nudge(${round(cmd.dx)}, ${round(cmd.dy)})`;
    case "set_gripper":
      return `set_gripper(${round(cmd.width)})`;
    case "wait":
      return cmd.ms != null ? `wait(${cmd.ms})` : "wait()";
    default:
      return `${cmd.skill}()`;
  }
}

/** `12.4s` / `840ms` — for elapsed run time in the HUD. */
export function formatElapsed(ms: number): string {
  const s = Math.max(0, ms) / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
}

/** `+6.2s` — time within a run, for the correction timeline. */
export function formatRunTime(ms: number): string {
  return `+${(Math.max(0, ms) / 1000).toFixed(1)}s`;
}

export function formatLatency(ms: number | null | undefined): string {
  return ms == null ? "—" : `${Math.round(ms)} ms`;
}

export const OUTCOME_LABEL: Record<SkillOutcome, string> = {
  ok: "ok",
  slipped: "slipped",
  missed: "missed",
  rolled_out: "rolled out",
  blocked: "blocked",
  interrupted: "interrupted",
};

export type Tone = "neutral" | "ok" | "warn" | "danger" | "accent";

export function outcomeTone(outcome: SkillOutcome | null | undefined): Tone {
  if (!outcome) return "neutral";
  if (outcome === "ok") return "ok";
  if (outcome === "interrupted") return "accent";
  return "danger";
}

/**
 * Split a transcript around the first stop word so the HUD can highlight it.
 * Returns null when the word isn't present.
 */
export function splitOnWord(
  text: string,
  word: string | null | undefined,
): { before: string; match: string; after: string } | null {
  if (!word) return null;
  const i = text.toLowerCase().lastIndexOf(word.toLowerCase());
  if (i < 0) return null;
  return {
    before: text.slice(0, i),
    match: text.slice(i, i + word.length),
    after: text.slice(i + word.length),
  };
}
