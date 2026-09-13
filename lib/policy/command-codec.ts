/**
 * Flat <-> SkillCommand codec.
 *
 * JSON-schema strict mode dislikes discriminated unions (and requires every
 * property to appear in `required`), so over the wire a skill command is a
 * single flat object with nullable optional fields.
 */
import {
  DEFAULT_GRIPPER_WIDTH,
  SKILL_NAMES,
  type ObjectId,
  type SkillCommand,
  type SkillName,
  type Vec2,
} from "@/lib/types";

export interface FlatCommand {
  skill: SkillName | string;
  target?: string | null;
  x?: number | null;
  y?: number | null;
  dx?: number | null;
  dy?: number | null;
  width?: number | null;
  ms?: number | null;
}

export const OBJECT_IDS: readonly ObjectId[] = [
  "sponge",
  "tape_holder",
  "marker",
] as const;

export const GRIPPER_MIN_WIDTH = 2;
export const GRIPPER_MAX_WIDTH = 14;

export class CommandDecodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CommandDecodeError";
  }
}

function num(v: unknown, field: string, skill: string): number {
  if (typeof v !== "number" || !Number.isFinite(v)) {
    throw new CommandDecodeError(
      `${skill}: field "${field}" must be a finite number, got ${JSON.stringify(v)}`,
    );
  }
  return v;
}

function numOr(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

export function clampGripperWidth(w: number): number {
  return Math.min(GRIPPER_MAX_WIDTH, Math.max(GRIPPER_MIN_WIDTH, w));
}

export function isObjectId(v: unknown): v is ObjectId {
  return typeof v === "string" && (OBJECT_IDS as readonly string[]).includes(v);
}

/** Accept a handful of spellings the LLM might emit for an object id. */
export function normalizeTargetId(raw: string): ObjectId | "bag" | null {
  const s = raw
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_")
    .replace(/^(the|a|le|la|l)_/, "");
  if (isObjectId(s)) return s;
  if (s === "bag") return "bag";
  if (/tape|scotch|dispenser|derouleur/.test(s)) return "tape_holder";
  if (/marker|pen|felt|marqueur|feutre|stylo/.test(s)) return "marker";
  if (/sponge|eponge/.test(s)) return "sponge";
  if (/bag|sac/.test(s)) return "bag";
  return null;
}

/** Flat object (LLM / wire shape) -> SkillCommand. Throws on anything invalid. */
export function toSkillCommand(flat: FlatCommand): SkillCommand {
  if (!flat || typeof flat !== "object") {
    throw new CommandDecodeError("command must be an object");
  }
  const skill = String(flat.skill ?? "").trim();
  if (!(SKILL_NAMES as readonly string[]).includes(skill)) {
    throw new CommandDecodeError(`unknown skill "${flat.skill}"`);
  }

  switch (skill as SkillName) {
    case "move_to": {
      if (typeof flat.target === "string" && flat.target.trim() !== "") {
        const id = normalizeTargetId(flat.target);
        if (id) return { skill: "move_to", target: id };
        // A target string that is not an id is only OK if x/y were supplied.
      }
      if (
        typeof flat.x === "number" &&
        Number.isFinite(flat.x) &&
        typeof flat.y === "number" &&
        Number.isFinite(flat.y)
      ) {
        const point: Vec2 = { x: flat.x, y: flat.y };
        return { skill: "move_to", target: point };
      }
      throw new CommandDecodeError(
        `move_to: target must be an object id, "bag", or an x/y pair (got target=${JSON.stringify(
          flat.target,
        )}, x=${JSON.stringify(flat.x)}, y=${JSON.stringify(flat.y)})`,
      );
    }
    case "nudge": {
      const dx = numOr(flat.dx, 0);
      const dy = numOr(flat.dy, 0);
      if (
        (flat.dx === null || flat.dx === undefined) &&
        (flat.dy === null || flat.dy === undefined)
      ) {
        throw new CommandDecodeError("nudge: needs at least one of dx / dy");
      }
      return { skill: "nudge", dx, dy };
    }
    case "set_gripper":
      return {
        skill: "set_gripper",
        width: clampGripperWidth(num(flat.width, "width", "set_gripper")),
      };
    case "wait": {
      const ms = flat.ms;
      if (ms === null || ms === undefined) return { skill: "wait" };
      return { skill: "wait", ms: Math.max(0, num(ms, "ms", "wait")) };
    }
    case "descend":
      return { skill: "descend" };
    case "grasp":
      return { skill: "grasp" };
    case "lift":
      return { skill: "lift" };
    case "release":
      return { skill: "release" };
    case "squeeze":
      return { skill: "squeeze" };
    case "widen_bag":
      return { skill: "widen_bag" };
    case "stop":
      return { skill: "stop" };
  }
  /* c8 ignore next */
  throw new CommandDecodeError(`unhandled skill "${skill}"`);
}

/** SkillCommand -> flat object, with every field present (strict-mode friendly). */
export function toFlatCommand(cmd: SkillCommand): Required<FlatCommand> {
  const base: Required<FlatCommand> = {
    skill: cmd.skill,
    target: null,
    x: null,
    y: null,
    dx: null,
    dy: null,
    width: null,
    ms: null,
  };
  switch (cmd.skill) {
    case "move_to":
      if (typeof cmd.target === "string") {
        base.target = cmd.target;
      } else {
        base.target = "xy";
        base.x = cmd.target.x;
        base.y = cmd.target.y;
      }
      return base;
    case "nudge":
      base.dx = cmd.dx;
      base.dy = cmd.dy;
      return base;
    case "set_gripper":
      base.width = cmd.width;
      return base;
    case "wait":
      base.ms = cmd.ms ?? null;
      return base;
    default:
      return base;
  }
}

/** Safe variant: returns null instead of throwing. */
export function tryToSkillCommand(flat: unknown): SkillCommand | null {
  try {
    return toSkillCommand(flat as FlatCommand);
  } catch {
    return null;
  }
}

const round = (n: number) => (Math.round(n * 100) / 100).toString();

/** Human/LLM readable one-liner, used in prompts, logs and the HUD. */
export function describeCommand(cmd: SkillCommand): string {
  switch (cmd.skill) {
    case "move_to":
      return typeof cmd.target === "string"
        ? `move_to(${cmd.target})`
        : `move_to(${round(cmd.target.x)}, ${round(cmd.target.y)})`;
    case "nudge":
      return `nudge(${round(cmd.dx)}, ${round(cmd.dy)})`;
    case "set_gripper":
      return `set_gripper(${round(cmd.width)})`;
    case "wait":
      return cmd.ms === undefined ? "wait()" : `wait(${round(cmd.ms)})`;
    default:
      return `${cmd.skill}()`;
  }
}

export { DEFAULT_GRIPPER_WIDTH };
