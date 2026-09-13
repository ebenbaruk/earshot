/**
 * The high-level policy step. Server-only (reads ASSEMBLYAI_API_KEY).
 */
import type { Observation, PolicyDecision, PolicyVersion } from "@/lib/types";
import { chatJSON, fastModel, GatewayError } from "@/lib/llm/gateway";
import { toSkillCommand, type FlatCommand } from "./command-codec";
import { buildPolicySystemPrompt, buildPolicyUserPrompt } from "./prompt";
import { fallbackDecision } from "./fallback";
import {
  POLICY_DECISION_SCHEMA,
  POLICY_DECISION_SCHEMA_NAME,
} from "./schema";

export interface DecideMeta {
  decision: PolicyDecision;
  fallback: boolean;
  latencyMs: number;
  model: string;
  error?: string;
}

export interface DecideOptions {
  model?: string;
  timeoutMs?: number;
  maxTokens?: number;
  apiKey?: string;
}

/** Same as `decide`, but tells you whether the fallback kicked in. */
export async function decideWithMeta(
  observation: Observation,
  policy: PolicyVersion,
  opts: DecideOptions = {},
): Promise<DecideMeta> {
  const model = opts.model ?? fastModel();
  const startedAt = Date.now();
  try {
    const { data, latencyMs } = await chatJSON<{
      reasoning: string;
      command: FlatCommand;
    }>({
      model,
      system: buildPolicySystemPrompt(policy),
      user: buildPolicyUserPrompt(observation),
      schema: POLICY_DECISION_SCHEMA,
      schemaName: POLICY_DECISION_SCHEMA_NAME,
      temperature: 0,
      maxTokens: opts.maxTokens ?? 200,
      timeoutMs: opts.timeoutMs ?? 6_000,
      apiKey: opts.apiKey,
    });

    return {
      decision: {
        command: toSkillCommand(data.command),
        reasoning: (data.reasoning ?? "").trim() || "no reasoning given",
      },
      fallback: false,
      latencyMs,
      model,
    };
  } catch (err) {
    const message =
      err instanceof GatewayError
        ? `${err.message}`
        : err instanceof Error
          ? err.message
          : String(err);
    return {
      decision: fallbackDecision(observation),
      fallback: true,
      latencyMs: Date.now() - startedAt,
      model,
      error: message,
    };
  }
}

/** One high-level policy step. Never rejects: falls back deterministically. */
export async function decide(
  observation: Observation,
  policy: PolicyVersion,
  opts: DecideOptions = {},
): Promise<PolicyDecision> {
  return (await decideWithMeta(observation, policy, opts)).decision;
}
