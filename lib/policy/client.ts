/**
 * Browser-side helpers. These never import the gateway (and therefore never
 * touch ASSEMBLYAI_API_KEY) — they go through the route handlers.
 */
import type {
  DistillRequest,
  Observation,
  PolicyDecision,
  PolicyVersion,
} from "@/lib/types";
import { fallbackDecision } from "./fallback";

/** Decision budget before we give up and use the local state machine. */
export const DECISION_TIMEOUT_MS = 6_000;
/** Distillation runs on the smart model over the whole log. */
export const DISTILL_TIMEOUT_MS = 60_000;

export interface RequestDecisionResult {
  decision: PolicyDecision;
  /** True when the server fell back, or when we fell back locally. */
  fallback: boolean;
  latencyMs: number;
}

export async function requestDecisionWithMeta(
  observation: Observation,
  policy: PolicyVersion,
  opts: { baseUrl?: string; timeoutMs?: number; fetchImpl?: typeof fetch } = {},
): Promise<RequestDecisionResult> {
  const startedAt = Date.now();
  const doFetch = opts.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    opts.timeoutMs ?? DECISION_TIMEOUT_MS,
  );
  try {
    const res = await doFetch(`${opts.baseUrl ?? ""}/api/policy`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ observation, policy }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`/api/policy returned ${res.status}`);
    const decision = (await res.json()) as PolicyDecision;
    return {
      decision,
      fallback: res.headers.get("x-earshot-fallback") === "1",
      latencyMs: Date.now() - startedAt,
    };
  } catch {
    // Local deterministic fallback: the demo must never stall.
    return {
      decision: fallbackDecision(observation),
      fallback: true,
      latencyMs: Date.now() - startedAt,
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function requestDecision(
  observation: Observation,
  policy: PolicyVersion,
  opts: { baseUrl?: string; timeoutMs?: number; fetchImpl?: typeof fetch } = {},
): Promise<PolicyDecision> {
  return (await requestDecisionWithMeta(observation, policy, opts)).decision;
}

/** Runs the post-training step. Rejects on failure (the UI should surface it). */
export async function requestDistill(
  req: DistillRequest,
  opts: { baseUrl?: string; timeoutMs?: number; fetchImpl?: typeof fetch } = {},
): Promise<PolicyVersion> {
  const doFetch = opts.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    opts.timeoutMs ?? DISTILL_TIMEOUT_MS,
  );
  try {
    const res = await doFetch(`${opts.baseUrl ?? ""}/api/distill`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req),
      signal: controller.signal,
    });
    const body = (await res.json()) as PolicyVersion | { error: string };
    if (!res.ok || "error" in body) {
      throw new Error(
        "error" in body ? body.error : `/api/distill returned ${res.status}`,
      );
    }
    return body;
  } finally {
    clearTimeout(timer);
  }
}
