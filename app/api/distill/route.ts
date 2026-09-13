import type { DistillRequest } from "@/lib/types";
import { distill } from "@/lib/policy/distill";
import { isPolicyVersion } from "@/lib/policy/validate";

export const dynamic = "force-dynamic";
// Distillation uses the smart model over the whole correction log.
export const maxDuration = 60;

export async function POST(request: Request) {
  let body: Partial<DistillRequest>;
  try {
    body = (await request.json()) as Partial<DistillRequest>;
  } catch {
    return Response.json({ error: "Body must be JSON" }, { status: 400 });
  }

  if (!isPolicyVersion(body?.policy)) {
    return Response.json(
      { error: "Missing or malformed `policy`" },
      { status: 400 },
    );
  }
  if (!Array.isArray(body?.corrections) || body.corrections.length === 0) {
    return Response.json(
      { error: "`corrections` must be a non-empty array" },
      { status: 400 },
    );
  }

  try {
    const next = await distill({
      policy: body.policy,
      corrections: body.corrections,
      runs: Array.isArray(body.runs) ? body.runs : [],
    });
    return Response.json(next, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    return Response.json({ error: message }, { status: 502 });
  }
}
