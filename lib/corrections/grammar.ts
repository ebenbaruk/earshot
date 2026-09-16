/**
 * Fast, zero-latency correction grammar.
 *
 * A keyword/regex grammar that maps most operator utterances straight to a
 * SkillCommand without a round trip to the LLM. English plus the handful of
 * French phrasings we demo with. Returns null when it is not confident —
 * `parseCorrection` then escalates to the LLM.
 */
import type { ObjectId, SkillCommand } from "@/lib/types";

/** "a bit" / "a little" / "slightly" */
export const SMALL_STEP_CM = 1.5;
/** default when no magnitude is given */
export const DEFAULT_STEP_CM = 2;
/** "a lot" / "more" / "much" */
export const BIG_STEP_CM = 3;

/** "wider" / "open the gripper" — we do not know the current width server-side. */
export const WIDE_GRIPPER_CM = 9;
/** "narrower" */
export const NARROW_GRIPPER_CM = 4;

/** Lowercase, strip diacritics and punctuation, collapse whitespace. */
export function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}.\s-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const WORD_NUMBERS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  half: 0.5,
  un: 1, une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5,
  sept: 7, huit: 8, neuf: 9, dix: 10,
};

/** How far to move, in cm. */
export function extractAmount(t: string): number {
  const digits = /\b(\d+(?:[.,]\d+)?)\s*(?:cm|centimeters?|centimetres?)?\b/.exec(t);
  if (digits) {
    const v = Number(digits[1].replace(",", "."));
    if (Number.isFinite(v) && v > 0 && v <= 40) return v;
  }
  const words = new RegExp(
    `\\b(${Object.keys(WORD_NUMBERS).join("|")})\\b\\s*(?:cm|centimeters?|centimetres?)`,
  ).exec(t);
  if (words) return WORD_NUMBERS[words[1]];

  if (/\b(a bit|a little|a touch|slightly|un peu|legerement|un petit peu)\b/.test(t)) {
    return SMALL_STEP_CM;
  }
  if (/\b(a lot|much more|way more|more|further|beaucoup|bien plus|plus loin)\b/.test(t)) {
    return BIG_STEP_CM;
  }
  return DEFAULT_STEP_CM;
}

const OBJECT_PATTERNS: Array<[ObjectId, RegExp]> = [
  ["tape_holder", /\b(tape|tapes|tape holder|tape_holder|scotch|derouleur|devidoir|ruban|dispenser|roll)\b/],
  ["marker", /\b(marker|markers|market|marca|mark her|felt tip|felt-tip|sharpie|marqueur|marquer|feutre|stylo|pen|pens)\b/],
  ["sponge", /\b(sponge|sponges|spunge|eponge)\b/],
  ["egg", /\b(egg|eggs|oeuf|uf)\b/],
];

export function extractObject(t: string): ObjectId | null {
  for (const [id, re] of OBJECT_PATTERNS) if (re.test(t)) return id;
  return null;
}

const MENTIONS_BAG = /\b(bag|sac|pouch)\b/;

export interface OrderHint {
  object: ObjectId;
  position: "first" | "last";
}

/**
 * Ordering preferences ("put the marker last", "pack the tape first").
 * Exposed separately so the integrator can log it as a rule hint even when the
 * grammar itself declines to produce a command.
 */
export function extractOrderHint(text: string): OrderHint | null {
  const t = normalize(text);
  const object = extractObject(t);
  if (!object) return null;

  const last =
    /\b(last|lastly|at the end|final|finally|end)\b/.test(t) ||
    /\b(en dernier|a la fin|en derniere)\b/.test(t);
  const first =
    /\b(first|firstly|before|start with|begin with)\b/.test(t) ||
    /\b(en premier|d abord|dabord|commence par)\b/.test(t);

  if (last && !first) return { object, position: "last" };
  if (first && !last) return { object, position: "first" };
  return null;
}

/** Direction words -> unit vector in the table frame. */
function extractDirection(t: string): { dx: number; dy: number } | null {
  let dx = 0;
  let dy = 0;
  if (/\b(left|leftwards|gauche)\b/.test(t)) dx -= 1;
  if (/\b(right|rightwards|droite)\b/.test(t)) dx += 1;
  if (/\b(forward|forwards|further|farther|away|ahead|avant|devant|plus loin|loin)\b/.test(t)) {
    dy += 1;
  }
  if (
    /\b(back|backward|backwards|closer|nearer|toward me|towards me|to me|arriere|recule|vers moi|plus pres|pres de moi)\b/.test(
      t,
    )
  ) {
    dy -= 1;
  }
  if (dx === 0 && dy === 0) return null;
  return { dx, dy };
}

const STOP_ALONE =
  /^(stop|stop it|wait|hold on|hold|no no|no|freeze|halt|pause|arrete|arretes|arrete toi|attends|stoppe|halte)\b[\s.!]*$/;

const RESUME =
  /\b(continue|go on|carry on|carry-on|resume|keep going|go ahead|okay go|ok go|as you were|proceed|vas y|vas-y|continuez|allez y|reprends)\b/;

/**
 * Map an operator utterance to a skill command. Returns null when unsure
 * (including for "X last" ordering hints, which need the LLM to turn into
 * "go work on another object now").
 */
export function parseCorrectionFast(text: string): SkillCommand | null {
  const t = normalize(text);
  if (!t) return null;

  // 1. Ordering preferences. "first" is directly actionable; "last" is not.
  const hint = extractOrderHint(text);
  if (hint) {
    if (hint.position === "first") return { skill: "move_to", target: hint.object };
    return null; // escalate: the LLM must pick a different object to do now
  }

  // 2. A bare stop word halts the run.
  if (STOP_ALONE.test(t)) return { skill: "stop" };

  // 3. Resume — modelled as a zero-length wait so the loop simply continues.
  if (RESUME.test(t)) return { skill: "wait", ms: 0 };

  // 4. Compress the held object.
  if (
    !/\bserre la pince\b/.test(t) &&
    /\b(squeeze|squish|squash|compress|crush|pinch|serre|presse|comprime|ecrase)\b/.test(t)
  ) {
    return { skill: "squeeze" };
  }

  // 5. The bag. Checked before the gripper so "open the bag" is unambiguous.
  if (MENTIONS_BAG.test(t) && /\b(widen|wider|open|opens|narrow|narrower|bigger|elargis|elargir|ouvre|ouvrir|agrandis|etroit)\b/.test(t)) {
    return { skill: "widen_bag" };
  }

  // 6. Gripper opening.
  if (/\b(wider|too narrow|open the gripper|open the fingers|open wider|open it wider|open up the gripper|plus large|ouvre la pince|ecarte)\b/.test(t)) {
    return { skill: "set_gripper", width: WIDE_GRIPPER_CM };
  }
  if (/\b(narrower|tighter|too wide|less wide|tighten|resserre|plus etroit|moins large)\b/.test(t)) {
    return { skill: "set_gripper", width: NARROW_GRIPPER_CM };
  }

  // 7. Let go.
  if (/\b(release|let go|let it go|drop it|put it down|lache|relache|laisse tomber)\b/.test(t) || /\bdrop\b(?! down)/.test(t)) {
    return { skill: "release" };
  }

  // 8. Raise. "back up" must not read as "up".
  if (/\b(lift|lift it|raise|pick it up|pick up|go up|higher|leve|souleve|monte|en haut)\b/.test(t) || /(?<!back )\bup\b/.test(t)) {
    return { skill: "lift" };
  }

  // 9. Lower.
  if (/\b(down|lower|descend|go down|lower it|gently|gentle|careful|carefully|slowly|closer to the bag|doucement|baisse|descends|en bas|plus bas)\b/.test(t)) {
    return { skill: "descend" };
  }

  // 10. Close the fingers.
  if (/\b(grab|grab it|grasp|close|close it|take it|catch it|hold it|clamp|attrape|prends|saisis|ferme|serre la pince)\b/.test(t)) {
    return { skill: "grasp" };
  }

  // 11. Explicit navigation. Requires a named destination.
  if (/\b(go to|move to|head to|go over to|move over to|go towards|go toward|move towards|put it in|place it in|into|va vers|va au|va a la|dirige|amene|deplace vers)\b/.test(t)) {
    if (MENTIONS_BAG.test(t)) return { skill: "move_to", target: "bag" };
    const obj = extractObject(t);
    if (obj) return { skill: "move_to", target: obj };
  }

  // 12. Relative xy adjustment.
  const dir = extractDirection(t);
  if (dir) {
    const amount = extractAmount(t);
    return { skill: "nudge", dx: dir.dx * amount, dy: dir.dy * amount };
  }

  return null;
}
