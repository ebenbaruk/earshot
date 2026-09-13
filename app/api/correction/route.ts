import type {
  CorrectionParseRequest,
  CorrectionParseResponse,
} from "@/lib/types";
import { parseCorrectionFast } from "@/lib/corrections/grammar";
import { llmParseCorrection } from "@/lib/corrections/llm";
import { isObservation } from "@/lib/policy/validate";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: Partial<CorrectionParseRequest>;
  try {
    body = (await request.json()) as Partial<CorrectionParseRequest>;
  } catch {
    return Response.json({ error: "Body must be JSON" }, { status: 400 });
  }

  const transcript = typeof body?.transcript === "string" ? body.transcript : "";
  if (!transcript.trim()) {
    return Response.json({ error: "Missing `transcript`" }, { status: 400 });
  }
  if (!isObservation(body?.observation)) {
    return Response.json(
      { error: "Missing or malformed `observation`" },
      { status: 400 },
    );
  }

  // The grammar runs client-side too, but re-running it here keeps the route
  // usable on its own and costs nothing.
  const fast = parseCorrectionFast(transcript);
  if (fast) {
    const payload: CorrectionParseResponse = { command: fast, confidence: 1 };
    return Response.json(payload, {
      headers: { "x-earshot-source": "grammar", "Cache-Control": "no-store" },
    });
  }

  try {
    const payload = await llmParseCorrection(transcript, body.observation);
    return Response.json(payload, {
      headers: { "x-earshot-source": "llm", "Cache-Control": "no-store" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    return Response.json({ error: message }, { status: 502 });
  }
}
