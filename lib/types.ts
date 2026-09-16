/**
 * EARSHOT — shared contracts.
 * This file is the integration contract between modules (sim / voice / policy / ui).
 * Do NOT change shapes without updating every consumer. Additive changes only.
 *
 * Units: centimeters for positions/sizes, milliseconds for time.
 * Table coordinate system: origin at table center, x → right, y → away from the viewer, z → up.
 */

// ---------------------------------------------------------------------------
// World
// ---------------------------------------------------------------------------

export type ObjectId = "sponge" | "tape_holder" | "marker" | "egg";

/** Number of objects to pack = number of stages in a run. */
export const OBJECT_COUNT = 4;

export interface Vec2 {
  x: number;
  y: number;
}

export type ObjectState = "on_table" | "held" | "in_bag" | "rolled_out" | "cracked";

export interface SimObject {
  id: ObjectId;
  label: string; // "Sponge", "Tape holder", "Marker", "Egg"
  pos: Vec2; // true center on the table (cm)
  size: { w: number; d: number; h: number }; // cm
  state: ObjectState;
  compressed: boolean; // sponge only; false otherwise
  /** egg only: how many eggs were broken and replaced so far (visual + metrics) */
  cracks?: number;
}

export interface GripperState {
  pos: Vec2; // cm, xy over the table
  z: number; // cm above table (0 = touching)
  width: number; // cm, opening between fingers
  holding: ObjectId | null;
}

export interface BagState {
  pos: Vec2; // center of the bag opening
  opening: number; // cm, effective width of the opening
  contents: ObjectId[]; // in insertion order
}

export type SimStatus =
  | "idle"
  | "running"
  | "paused"
  | "succeeded"
  | "failed";

export interface WorldState {
  t: number; // ms since run start
  seed: number;
  status: SimStatus;
  objects: SimObject[];
  gripper: GripperState;
  bag: BagState;
  stagesDone: number; // 0..OBJECT_COUNT = number of items packed, intact, AND still in the bag
  lastSkill: { command: SkillCommand; outcome: SkillOutcome } | null;
  consecutiveFailures: number;
}

// ---------------------------------------------------------------------------
// Skills (low-level policy — frozen, deterministic)
// ---------------------------------------------------------------------------

export type MoveTarget = ObjectId | "bag" | Vec2;

export type SkillCommand =
  | { skill: "move_to"; target: MoveTarget }
  | { skill: "nudge"; dx: number; dy: number } // cm
  | { skill: "set_gripper"; width: number } // cm, clamped to [2, 14]
  | { skill: "descend" }
  | { skill: "grasp" }
  | { skill: "lift" }
  | { skill: "release" }
  | { skill: "squeeze" } // compress a held deformable object
  | { skill: "widen_bag" }
  | { skill: "wait"; ms?: number }
  | { skill: "stop" };

export type SkillName = SkillCommand["skill"];

export const SKILL_NAMES: readonly SkillName[] = [
  "move_to",
  "nudge",
  "set_gripper",
  "descend",
  "grasp",
  "lift",
  "release",
  "squeeze",
  "widen_bag",
  "wait",
  "stop",
] as const;

export type SkillOutcome =
  | "ok"
  | "slipped" // grasp closed but object slipped out (bad grasp point / width)
  | "missed" // gripper not over any object when grasping
  | "rolled_out" // item left the bag after a later placement
  | "cracked" // fragile item released from too high: irreversible, a fresh one is put back on the table
  | "blocked" // bag opening too narrow for the item / invalid precondition
  | "interrupted"; // skill was cancelled by a stop

export const DEFAULT_GRIPPER_WIDTH = 8; // cm — wide enough for every object; descend auto-opens if needed

// ---------------------------------------------------------------------------
// Observation (what the high-level policy sees — NO hidden quirks)
// ---------------------------------------------------------------------------

export interface ObservedObject {
  id: ObjectId;
  label: string;
  estimatedPos: Vec2; // true pos + seeded perception noise (±0.5 cm)
  size: { w: number; d: number; h: number };
  state: ObjectState;
}

export interface Observation {
  t: number;
  objects: ObservedObject[];
  gripper: GripperState;
  bag: { pos: Vec2; contents: ObjectId[]; openingLooksNarrow: boolean };
  stagesDone: number;
  lastSkill: { command: SkillCommand; outcome: SkillOutcome } | null;
  recentHistory: Array<{ command: SkillCommand; outcome: SkillOutcome }>; // last ≤6 skills
}

// ---------------------------------------------------------------------------
// High-level policy (LLM via AssemblyAI LLM Gateway)
// ---------------------------------------------------------------------------

export interface PolicyDecision {
  command: SkillCommand;
  reasoning: string; // one short sentence, shown in the HUD
}

export interface PolicyRule {
  id: string; // "r1", "r2", ...
  when: string; // natural-language condition over the observation
  do: string; // natural-language instruction (skill + params)
  evidence: string[]; // CorrectionEvent ids that justify the rule
  addedInVersion: number;
}

export interface FewShot {
  id: string;
  observationSummary: string; // compact text of the observation
  command: SkillCommand;
  source: string; // CorrectionEvent id
  addedInVersion: number;
}

/**
 * Operator facts the skill layer keeps: learned from corrections, carried
 * from one policy version to the next, applied deterministically at run time
 * (the LLM rules explain them; these enforce them).
 */
export interface PolicyConstraints {
  graspOffset: Partial<Record<ObjectId, Vec2>>; // "a bit to the left" while over X
  deferLast: ObjectId | null; // "put X in last"
  releaseLow: Partial<Record<ObjectId, true>>; // "lower it first" while holding X
  squeezeBefore: Partial<Record<ObjectId, true>>; // "squeeze it first" while holding X
}

export interface PolicyVersion {
  version: number; // 0 = base policy
  createdAt: number; // epoch ms
  parentVersion: number | null;
  rules: PolicyRule[];
  fewShots: FewShot[];
  changelog: string; // human readable, shown in the diff view
  distilledFrom: string[]; // CorrectionEvent ids consumed
  /** operator facts kept by the skill layer (absent on v0 and on older saved versions) */
  constraints?: PolicyConstraints;
}

// ---------------------------------------------------------------------------
// Corrections (the human signal)
// ---------------------------------------------------------------------------

export type ParseSource = "grammar" | "llm" | "text";

export interface CorrectionEvent {
  id: string; // "c1", "c2", ...
  runId: string;
  ts: number; // ms since run start (when the final transcript arrived)
  tStop: number | null; // ms since run start when "stop" was detected on a partial, else null
  transcript: string; // final formatted transcript from AssemblyAI
  parsedCommand: SkillCommand | null; // null = could not parse
  parseSource: ParseSource;
  rejectedPolicyAction: PolicyDecision | null; // what the policy was doing / about to do
  stateBefore: WorldState[]; // ring-buffer snapshot: ≤2 s of states before tStop (or ts)
  outcome: SkillOutcome | null; // outcome of executing parsedCommand
  latency: { stopMs: number | null; parseMs: number | null }; // measured, for the HUD
  preventive: boolean; // true if given without a stop, while the policy was running
}

// ---------------------------------------------------------------------------
// Runs & metrics
// ---------------------------------------------------------------------------

export interface RunRecord {
  id: string; // "run-<n>"
  seed: number;
  policyVersion: number;
  correctionsEnabled: boolean; // false = ablation / pure autonomous
  startedAt: number; // epoch ms
  endedAt: number | null;
  durationMs: number | null;
  stagesDone: number; // 0..3
  success: boolean;
  interventions: number; // corrections count during the run
  correctionIds: string[];
}

// ---------------------------------------------------------------------------
// Voice (AssemblyAI Universal-3.5 Pro streaming)
// ---------------------------------------------------------------------------

export type VoiceStatus =
  | "off"
  | "connecting"
  | "listening"
  | "error";

export interface VoiceEvents {
  /** Fired as soon as a partial transcript contains a stop word. Fire once per turn. */
  onStop: (info: { partial: string; at: number }) => void;
  /** Fired on end_of_turn with the formatted transcript (stop words stripped, may be ""). */
  onFinal: (info: { transcript: string; raw: string; at: number; hadStop: boolean }) => void;
  onPartial?: (partial: string) => void;
  onStatus?: (status: VoiceStatus, detail?: string) => void;
}

export const STOP_WORDS: readonly string[] = [
  "stop",
  "wait",
  "hold on",
  "hold",
  "no no",
  "freeze",
  "halt",
  "arrête",
  "attends",
  "stoppe",
];

// ---------------------------------------------------------------------------
// Server API payloads (Next.js route handlers)
// ---------------------------------------------------------------------------

export interface PolicyRequest {
  observation: Observation;
  policy: PolicyVersion;
}
export type PolicyResponse = PolicyDecision;

export interface CorrectionParseRequest {
  transcript: string;
  observation: Observation;
}
export interface CorrectionParseResponse {
  command: SkillCommand | null;
  confidence: number; // 0..1
  /** ordering preference understood from the utterance ("marker last"), if any */
  orderHint?: { object: ObjectId; position: "first" | "last" } | null;
}

export interface DistillRequest {
  policy: PolicyVersion;
  corrections: CorrectionEvent[]; // since `policy` was created
  runs: RunRecord[]; // same window
}
export type DistillResponse = PolicyVersion; // version = policy.version + 1
