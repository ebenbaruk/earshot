/**
 * EARSHOT — AssemblyAI LLM Gateway wrapper (server-only).
 *
 * Verified against the live API on 2026-09-13:
 *   POST https://llm-gateway.assemblyai.com/v1/chat/completions
 *   Authorization: <API_KEY>        (raw key — "Bearer <key>" also accepted)
 *   Content-Type: application/json
 *   { model, messages:[{role,content}], max_tokens, temperature,
 *     response_format: { type:"json_schema",
 *                        json_schema: { name, strict:true, schema } } }
 *   -> 200 { request_id, choices:[{ message:{ role, content }, finish_reason }],
 *            usage:{ input_tokens, output_tokens, total_tokens } }
 *   -> 400 { code:400, message:"invalid request body", metadata:{ errors:[...] } }
 *   -> 401 { error:"Authentication error, API token missing/invalid", status:"error" }
 *
 * GET https://llm-gateway.assemblyai.com/v1/models lists the catalogue
 * (`supported_parameters` tells you whether a model accepts `response_format`).
 */

export const GATEWAY_URL =
  "https://llm-gateway.assemblyai.com/v1/chat/completions";
export const GATEWAY_MODELS_URL =
  "https://llm-gateway.assemblyai.com/v1/models";

/**
 * Model ids verified present in GET /v1/models. Overridable via env so the
 * integrator can swap models without touching code (e.g. if the key's plan
 * only entitles a subset of the catalogue).
 * NOTE: only models whose `supported_parameters` include `response_format`
 * can be used here — claude-opus-5 / claude-sonnet-5 currently cannot.
 */
export const FAST_MODEL =
  process.env.EARSHOT_FAST_MODEL ?? "claude-haiku-4-5-20251001";
export const SMART_MODEL =
  process.env.EARSHOT_SMART_MODEL ?? "claude-sonnet-4-6";

export type JSONSchema = Record<string, unknown>;

export class GatewayError extends Error {
  readonly status: number;
  readonly detail: string;
  readonly retriable: boolean;
  constructor(
    message: string,
    opts: { status: number; detail?: string; retriable?: boolean },
  ) {
    super(message);
    this.name = "GatewayError";
    this.status = opts.status;
    this.detail = opts.detail ?? "";
    this.retriable = opts.retriable ?? false;
  }
}

export type SchemaMode = "auto" | "response_format" | "prompt";

/**
 * Models that answered "does not support response_format". We remember them so
 * the prompted-JSON path is taken directly on subsequent calls (saves a 400).
 */
const NO_RESPONSE_FORMAT = new Set<string>();

export function supportsResponseFormat(model: string): boolean {
  return !NO_RESPONSE_FORMAT.has(model);
}

export interface ChatJSONArgs {
  model: string;
  system: string;
  user: string;
  schema: JSONSchema;
  schemaName: string;
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
  /** Overrides process.env.ASSEMBLYAI_API_KEY (used by the smoke script). */
  apiKey?: string;
  /**
   * "auto" (default) uses native structured outputs and transparently falls
   * back to prompted JSON if the model rejects `response_format`.
   */
  schemaMode?: SchemaMode;
}

export interface ChatJSONResult<T> {
  data: T;
  latencyMs: number;
  raw: string;
  /** How the JSON was constrained for this call. */
  mode: "response_format" | "prompt";
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function apiKeyOrThrow(explicit?: string): string {
  const key = explicit ?? process.env.ASSEMBLYAI_API_KEY;
  if (!key) {
    throw new GatewayError("ASSEMBLYAI_API_KEY is not set", { status: 0 });
  }
  return key;
}

/** Strip markdown fences / prose and parse the first JSON object in `text`. */
export function parseJSONLoose<T>(text: string): T {
  const trimmed = text.trim();
  const candidates: string[] = [trimmed];

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced) candidates.push(fenced[1]);

  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    candidates.push(trimmed.slice(firstBrace, lastBrace + 1));
  }
  const firstBracket = trimmed.indexOf("[");
  const lastBracket = trimmed.lastIndexOf("]");
  if (firstBracket !== -1 && lastBracket > firstBracket) {
    candidates.push(trimmed.slice(firstBracket, lastBracket + 1));
  }

  for (const c of candidates) {
    if (!c) continue;
    try {
      return JSON.parse(c) as T;
    } catch {
      /* try the next candidate */
    }
  }
  throw new GatewayError("Gateway returned non-JSON content", {
    status: 502,
    detail: trimmed.slice(0, 400),
  });
}

/** Schema-in-the-prompt instructions, for models without `response_format`. */
function promptSchemaSuffix(args: ChatJSONArgs): string {
  return `\n\nRespond with a single JSON object and nothing else — no prose, no markdown fences. It must validate against this JSON Schema (every property is required; use null for fields that do not apply):\n${JSON.stringify(
    args.schema,
  )}`;
}

async function once<T>(
  args: ChatJSONArgs,
  key: string,
  mode: "response_format" | "prompt",
): Promise<ChatJSONResult<T>> {
  const timeoutMs = args.timeoutMs ?? 15_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();

  let res: Response;
  try {
    res = await fetch(GATEWAY_URL, {
      method: "POST",
      headers: {
        Authorization: key,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: args.model,
        messages: [
          {
            role: "system",
            content:
              mode === "prompt"
                ? args.system + promptSchemaSuffix(args)
                : args.system,
          },
          { role: "user", content: args.user },
        ],
        max_tokens: args.maxTokens ?? 400,
        temperature: args.temperature ?? 0,
        ...(mode === "response_format"
          ? {
              response_format: {
                type: "json_schema",
                json_schema: {
                  name: args.schemaName,
                  strict: true,
                  schema: args.schema,
                },
              },
            }
          : {}),
      }),
      signal: controller.signal,
      cache: "no-store",
    });
  } catch (err) {
    const aborted = err instanceof Error && err.name === "AbortError";
    throw new GatewayError(
      aborted ? `Gateway timed out after ${timeoutMs}ms` : "Gateway fetch failed",
      {
        status: aborted ? 408 : 0,
        detail: err instanceof Error ? err.message : String(err),
        retriable: true,
      },
    );
  } finally {
    clearTimeout(timer);
  }

  const bodyText = await res.text();

  if (!res.ok) {
    let detail = bodyText.slice(0, 400);
    try {
      const parsed = JSON.parse(bodyText) as {
        error?: string;
        message?: string;
        metadata?: { errors?: string[] };
      };
      detail =
        parsed.metadata?.errors?.join("; ") ??
        parsed.error ??
        parsed.message ??
        detail;
    } catch {
      /* keep the raw slice */
    }
    const retryAfter = Number(res.headers.get("retry-after"));
    const err = new GatewayError(`Gateway HTTP ${res.status}: ${detail}`, {
      status: res.status,
      detail,
      retriable: res.status >= 500 || res.status === 429,
    });
    if (res.status === 429) {
      // Free-tier gateway keys are rate limited per few seconds.
      (err as GatewayError & { retryAfterMs?: number }).retryAfterMs =
        Number.isFinite(retryAfter) && retryAfter > 0
          ? Math.min(retryAfter * 1000, 10_000)
          : 2_500;
    }
    throw err;
  }

  const envelope = parseJSONLoose<{
    choices?: Array<{ message?: { content?: string } }>;
  }>(bodyText);
  const content = envelope.choices?.[0]?.message?.content;
  if (typeof content !== "string" || content.length === 0) {
    throw new GatewayError("Gateway response had no message content", {
      status: 502,
      detail: bodyText.slice(0, 400),
    });
  }

  return {
    data: parseJSONLoose<T>(content),
    latencyMs: Date.now() - startedAt,
    raw: content,
    mode,
  };
}

/**
 * One structured-output chat completion. Retries exactly once on timeout,
 * network failure, 429 or 5xx. Throws `GatewayError` otherwise.
 */
export async function chatJSON<T>(
  args: ChatJSONArgs,
): Promise<ChatJSONResult<T>> {
  const key = apiKeyOrThrow(args.apiKey);
  const requested = args.schemaMode ?? "auto";
  let mode: "response_format" | "prompt" =
    requested === "prompt" || NO_RESPONSE_FORMAT.has(args.model)
      ? "prompt"
      : "response_format";

  try {
    return await once<T>(args, key, mode);
  } catch (err) {
    if (err instanceof GatewayError) {
      // Some models (and some plans) reject structured outputs outright.
      if (
        requested === "auto" &&
        mode === "response_format" &&
        /does not support response_format/i.test(err.detail || err.message)
      ) {
        NO_RESPONSE_FORMAT.add(args.model);
        mode = "prompt";
        return await once<T>(args, key, mode);
      }
      if (err.retriable) {
        const wait = (err as GatewayError & { retryAfterMs?: number }).retryAfterMs;
        if (wait) await sleep(wait);
        return await once<T>(args, key, mode);
      }
    }
    throw err;
  }
}

/** Diagnostic helper used by the smoke script. */
export async function listModels(apiKey?: string): Promise<
  Array<{ id: string; supported_parameters: string[] }>
> {
  const key = apiKeyOrThrow(apiKey);
  const res = await fetch(GATEWAY_MODELS_URL, {
    headers: { Authorization: key },
    cache: "no-store",
  });
  if (!res.ok) {
    throw new GatewayError(`Gateway HTTP ${res.status} listing models`, {
      status: res.status,
    });
  }
  const body = (await res.json()) as {
    data?: Array<{ id: string; supported_parameters?: string[] }>;
  };
  return (body.data ?? []).map((m) => ({
    id: m.id,
    supported_parameters: m.supported_parameters ?? [],
  }));
}
