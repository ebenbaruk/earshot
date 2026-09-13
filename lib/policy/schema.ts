/**
 * JSON Schemas for the LLM Gateway's `response_format: { type: "json_schema" }`.
 *
 * Strict-mode rules that bit us (verified against the docs + the API):
 *  - every object needs `additionalProperties: false`
 *  - EVERY property must be listed in `required` — "optional" is expressed as a
 *    nullable type (`["number","null"]`), never by omission
 *  - unions / anyOf are unreliable, hence the flat command representation
 *  - `strict: true` lives on `json_schema`, next to `name` and `schema`
 */
import { SKILL_NAMES } from "@/lib/types";
import type { JSONSchema } from "@/lib/llm/gateway";
import { OBJECT_IDS } from "./command-codec";

const nullableNumber = (description: string) => ({
  type: ["number", "null"] as const,
  description,
});

/** Flat representation of `SkillCommand`. */
export const FLAT_COMMAND_SCHEMA: JSONSchema = {
  type: "object",
  description: "Exactly one robot skill invocation.",
  properties: {
    skill: {
      type: "string",
      enum: [...SKILL_NAMES],
      description: "Which skill to execute.",
    },
    target: {
      // NOTE: no `enum` here on purpose — an enum that must also admit `null`
      // is rejected by some strict-mode validators (null would fail the enum).
      // `normalizeTargetId` in command-codec.ts absorbs spelling variants.
      type: ["string", "null"],
      description: `move_to only: one of ${OBJECT_IDS.join(", ")}, "bag", or "xy" when using the x/y fields. null for every other skill.`,
    },
    x: nullableNumber("move_to with target=\"xy\": table x in cm."),
    y: nullableNumber("move_to with target=\"xy\": table y in cm."),
    dx: nullableNumber("nudge only: x offset in cm (negative = left)."),
    dy: nullableNumber("nudge only: y offset in cm (negative = toward the operator)."),
    width: nullableNumber("set_gripper only: finger opening in cm, 2..14."),
    ms: nullableNumber("wait only: milliseconds to wait."),
  },
  required: ["skill", "target", "x", "y", "dx", "dy", "width", "ms"],
  additionalProperties: false,
};

/** `PolicyDecision` */
export const POLICY_DECISION_SCHEMA: JSONSchema = {
  type: "object",
  properties: {
    reasoning: {
      type: "string",
      description: "One short sentence (max ~15 words) explaining the choice.",
    },
    command: FLAT_COMMAND_SCHEMA,
  },
  required: ["reasoning", "command"],
  additionalProperties: false,
};
export const POLICY_DECISION_SCHEMA_NAME = "policy_decision";

/**
 * `CorrectionParseResponse`. A nullable object is awkward under strict mode, so
 * an `understood` flag gates the (always-present) command.
 */
export const CORRECTION_PARSE_SCHEMA: JSONSchema = {
  type: "object",
  properties: {
    understood: {
      type: "boolean",
      description:
        "false when the utterance maps to no executable skill; the command is then ignored.",
    },
    command: FLAT_COMMAND_SCHEMA,
    confidence: {
      type: "number",
      description: "0..1 confidence in the mapping.",
    },
  },
  required: ["understood", "command", "confidence"],
  additionalProperties: false,
};
export const CORRECTION_PARSE_SCHEMA_NAME = "correction_command";

/** Distillation output (merged into a new `PolicyVersion` by `distill()`). */
export const DISTILL_SCHEMA: JSONSchema = {
  type: "object",
  properties: {
    rules: {
      type: "array",
      description:
        "General, reusable rules for the high-level policy. At most 8.",
      items: {
        type: "object",
        properties: {
          when: {
            type: "string",
            description:
              "Condition phrased over observable state (object ids, gripper state, outcomes, bag contents).",
          },
          do: {
            type: "string",
            description:
              "Instruction naming a skill and concrete parameters, e.g. 'nudge(-2, 0) before descend'.",
          },
          evidence: {
            type: "array",
            items: { type: "string" },
            description: "Correction event ids that justify this rule.",
          },
        },
        required: ["when", "do", "evidence"],
        additionalProperties: false,
      },
    },
    fewShots: {
      type: "array",
      description: "At most 4 worked examples, one per distinct failure mode.",
      items: {
        type: "object",
        properties: {
          observationSummary: {
            type: "string",
            description: "Compact one-line description of the situation.",
          },
          command: FLAT_COMMAND_SCHEMA,
          source: {
            type: "string",
            description: "Correction event id this example came from.",
          },
        },
        required: ["observationSummary", "command", "source"],
        additionalProperties: false,
      },
    },
    changelog: {
      type: "string",
      description: "One or two sentences describing what changed and why.",
    },
    droppedRuleIds: {
      type: "array",
      items: { type: "string" },
      description:
        "Ids of existing rules that are now redundant, wrong or superseded.",
    },
  },
  required: ["rules", "fewShots", "changelog", "droppedRuleIds"],
  additionalProperties: false,
};
export const DISTILL_SCHEMA_NAME = "policy_distillation";

export interface DistillLLMOutput {
  rules: Array<{ when: string; do: string; evidence: string[] }>;
  fewShots: Array<{
    observationSummary: string;
    command: Record<string, unknown>;
    source: string;
  }>;
  changelog: string;
  droppedRuleIds: string[];
}
