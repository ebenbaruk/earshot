/**
 * Correction parsing entry point (safe to import from the browser).
 *
 * Grammar first — it is free and sub-millisecond. Only if the grammar declines
 * do we pay for a round trip to /api/correction, which calls the fast model.
 */
import type {
  CorrectionParseResponse,
  Observation,
  ParseSource,
  SkillCommand,
} from "@/lib/types";
import { parseCorrectionFast } from "./grammar";

export interface ParsedCorrection {
  command: SkillCommand | null;
  source: ParseSource;
  confidence: number;
  latencyMs: number;
}

export interface ParseCorrectionOptions {
  /** Abort the LLM leg after this long (ms). */
  timeoutMs?: number;
  /** Absolute base URL; needed when calling from Node (tests, scripts). */
  baseUrl?: string;
  /** Skip the LLM leg entirely. */
  grammarOnly?: boolean;
  fetchImpl?: typeof fetch;
}

export async function parseCorrection(
  text: string,
  observation: Observation,
  opts: ParseCorrectionOptions = {},
): Promise<ParsedCorrection> {
  const startedAt = Date.now();

  const fast = parseCorrectionFast(text);
  if (fast) {
    return {
      command: fast,
      source: "grammar",
      confidence: 1,
      latencyMs: Date.now() - startedAt,
    };
  }

  if (opts.grammarOnly) {
    return { command: null, source: "grammar", confidence: 0, latencyMs: Date.now() - startedAt };
  }

  const doFetch = opts.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 5_000);
  try {
    const res = await doFetch(`${opts.baseUrl ?? ""}/api/correction`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transcript: text, observation }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`/api/correction returned ${res.status}`);
    const body = (await res.json()) as CorrectionParseResponse;
    return {
      command: body.command ?? null,
      source: "llm",
      confidence: body.confidence ?? 0,
      latencyMs: Date.now() - startedAt,
    };
  } catch {
    return {
      command: null,
      source: "llm",
      confidence: 0,
      latencyMs: Date.now() - startedAt,
    };
  } finally {
    clearTimeout(timer);
  }
}

export { parseCorrectionFast, extractOrderHint } from "./grammar";
