/**
 * EARSHOT — temporary streaming token.
 *
 * The AssemblyAI API key is server-side only. The browser never sees it; it
 * gets a short-lived token that is only good for opening one WebSocket.
 *
 * Verified against
 * https://www.assemblyai.com/docs/streaming/authenticate-with-a-temporary-token
 * and the OpenAPI spec at .../streaming/api-spec/generate-streaming-token:
 *   GET https://streaming.assemblyai.com/v3/token?expires_in_seconds=<1..600>
 *   header: Authorization: <API_KEY>   (raw key, no "Bearer" prefix)
 *   -> 200 { token, expires_in_seconds }
 *
 * `expires_in_seconds` is the redemption window (how long the client has to
 * open the socket), NOT the session length. Session length is capped separately
 * by `max_session_duration_seconds`.
 *
 * Route handlers run on the Node runtime by default — never set
 * `runtime = 'edge'` here.
 */

export const dynamic = "force-dynamic";

const TOKEN_ENDPOINT = "https://streaming.assemblyai.com/v3/token";
/** Redemption window. The client opens the socket immediately after fetching. */
const EXPIRES_IN_SECONDS = 60;
/** Cap a single mic session at 1 hour so a forgotten tab cannot bill forever. */
const MAX_SESSION_DURATION_SECONDS = 3600;

export async function GET() {
  const apiKey = process.env.ASSEMBLYAI_API_KEY;
  if (!apiKey) {
    return Response.json(
      {
        error:
          "ASSEMBLYAI_API_KEY is not set. Copy .env.example to .env.local and add your key from https://www.assemblyai.com/dashboard, then restart the dev server.",
      },
      { status: 500 },
    );
  }

  const url = new URL(TOKEN_ENDPOINT);
  url.searchParams.set("expires_in_seconds", String(EXPIRES_IN_SECONDS));
  url.searchParams.set(
    "max_session_duration_seconds",
    String(MAX_SESSION_DURATION_SECONDS),
  );

  let upstream: Response;
  try {
    upstream = await fetch(url, {
      headers: { Authorization: apiKey },
      cache: "no-store",
    });
  } catch (cause) {
    return Response.json(
      {
        error: `Could not reach the AssemblyAI token endpoint: ${
          cause instanceof Error ? cause.message : String(cause)
        }`,
      },
      { status: 502 },
    );
  }

  if (!upstream.ok) {
    // Body of an AssemblyAI error never contains the key; truncate anyway.
    const detail = (await upstream.text().catch(() => "")).slice(0, 300);
    return Response.json(
      {
        error: `AssemblyAI rejected the token request (HTTP ${upstream.status}). ${
          upstream.status === 401
            ? "The ASSEMBLYAI_API_KEY in .env.local looks invalid."
            : detail
        }`,
      },
      { status: 502 },
    );
  }

  const data = (await upstream.json().catch(() => null)) as {
    token?: string;
    expires_in_seconds?: number;
  } | null;

  if (!data?.token) {
    return Response.json(
      { error: "AssemblyAI returned no token." },
      { status: 502 },
    );
  }

  return Response.json(
    {
      token: data.token,
      expires_in_seconds: data.expires_in_seconds ?? EXPIRES_IN_SECONDS,
    },
    { headers: { "cache-control": "no-store" } },
  );
}
