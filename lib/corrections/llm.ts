/**
 * LLM fallback for corrections the grammar could not map. Server-only.
 */
import type {
  CorrectionParseResponse,
  Observation,
} from "@/lib/types";
import { chatJSON, fastModel } from "@/lib/llm/gateway";
import { tryToSkillCommand, type FlatCommand } from "@/lib/policy/command-codec";
import { buildPolicyUserPrompt } from "@/lib/policy/prompt";
import {
  CORRECTION_PARSE_SCHEMA,
  CORRECTION_PARSE_SCHEMA_NAME,
} from "@/lib/policy/schema";
import { extractOrderHint } from "./grammar";

const SYSTEM_PROMPT = `You translate a human supervisor's spoken correction into exactly ONE skill command for a table-top packing robot to execute right now.

Skill library:
- move_to(target): target is "sponge" | "tape_holder" | "marker" | "bag", or an x/y point.
- nudge(dx, dy): small xy adjustment in cm. Table frame: x grows right, y grows away from the operator. "left" is negative dx, "toward me" is negative dy.
- set_gripper(width): finger opening in cm (2..14).
- descend / grasp / lift / release / squeeze / widen_bag / wait / stop.

Rules:
- Output exactly one command, the one that should run immediately. Never a plan.
- Spoken distances: "a bit" / "a little" ~= 1.5 cm, an unqualified direction ~= 2 cm, "a lot" ~= 4 cm.
- If the utterance is an ORDERING PREFERENCE (e.g. "put the marker last", "the marker goes last"), do not try to encode the ordering. Instead return the move_to for the best OTHER object: the nearest object that is still on the table and is not the one the operator wants to defer.
- The utterance may be in English or French.
- If nothing executable is implied, set understood = false (the command is then ignored).
- Fields that do not apply to the chosen skill must be null.
- confidence is 0..1.`;

export interface LLMParseOptions {
  model?: string;
  timeoutMs?: number;
  apiKey?: string;
}

export async function llmParseCorrection(
  transcript: string,
  observation: Observation,
  opts: LLMParseOptions = {},
): Promise<CorrectionParseResponse> {
  const hint = extractOrderHint(transcript);
  const hintLine = hint
    ? `\nDetected ordering preference: the operator wants "${hint.object}" ${hint.position}. Act on it by choosing what to do NOW.`
    : "";

  const { data } = await chatJSON<{
    understood: boolean;
    command: FlatCommand;
    confidence: number;
  }>({
    model: opts.model ?? fastModel(),
    system: SYSTEM_PROMPT,
    user: `Current observation:\n${buildPolicyUserPrompt(observation)}\n\nThe operator said: "${transcript}"${hintLine}\n\nWhich single skill should the robot execute now?`,
    schema: CORRECTION_PARSE_SCHEMA,
    schemaName: CORRECTION_PARSE_SCHEMA_NAME,
    temperature: 0,
    maxTokens: 200,
    timeoutMs: opts.timeoutMs ?? 5_000,
    apiKey: opts.apiKey,
  });

  if (!data.understood) return { command: null, confidence: 0 };
  const command = tryToSkillCommand(data.command);
  if (!command) return { command: null, confidence: 0 };

  const confidence =
    typeof data.confidence === "number" && Number.isFinite(data.confidence)
      ? Math.min(1, Math.max(0, data.confidence))
      : 0.6;
  return { command, confidence };
}
