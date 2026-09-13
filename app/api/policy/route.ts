import type { PolicyRequest } from "@/lib/types";
import { decideWithMeta } from "@/lib/policy/decide";
import { fallbackDecision } from "@/lib/policy/fallback";
import { isObservation, isPolicyVersion } from "@/lib/policy/validate";

// Node runtime (the default in Next 16 — the Edge runtime is deprecated) and
// never cached: every decision depends on the live observation.
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: Partial<PolicyRequest>;
  try {
    body = (await request.json()) as Partial<PolicyRequest>;
  } catch {
    return Response.json({ error: "Body must be JSON" }, { status: 400 });
  }

  if (!isObservation(body?.observation)) {
    return Response.json(
      { error: "Missing or malformed `observation`" },
      { status: 400 },
    );
  }
  if (!isPolicyVersion(body?.policy)) {
    return Response.json(
      { error: "Missing or malformed `policy`" },
      { status: 400 },
    );
  }

  try {
    const meta = await decideWithMeta(body.observation, body.policy);
    const headers = new Headers({ "Cache-Control": "no-store" });
    if (meta.fallback) {
      headers.set("x-earshot-fallback", "1");
      if (meta.error) headers.set("x-earshot-error", meta.error.slice(0, 200));
    }
    headers.set("x-earshot-latency", String(meta.latencyMs));
    return Response.json(meta.decision, { headers });
  } catch (err) {
    // decideWithMeta already swallows gateway errors; this is belt and braces
    // so the sim loop can never be starved of a command.
    return Response.json(fallbackDecision(body.observation), {
      headers: {
        "x-earshot-fallback": "1",
        "x-earshot-error": (err instanceof Error ? err.message : "unknown").slice(0, 200),
        "Cache-Control": "no-store",
      },
    });
  }
}
