/**
 * EARSHOT — keyterms prompt for AssemblyAI streaming.
 *
 * Verified against https://www.assemblyai.com/docs/streaming/prompting-and-keyterms
 * ("Keyterms prompting > Limits"): max 100 terms per session, each term < 50 chars.
 * Terms outside those limits are ignored or fail the request, so we assert both.
 *
 * The list is biased to the Earshot vocabulary: the supervision words the operator
 * yells at the robot plus the object/geometry nouns the corrections parser needs.
 */

export const DEFAULT_KEYTERMS: readonly string[] = [
  // supervision / interrupts
  "stop",
  "wait",
  "hold on",
  // hardware & objects
  "gripper",
  "sponge",
  "tape",
  "tape holder",
  "marker",
  "bag",
  // directions
  "left",
  "right",
  "forward",
  "back",
  "closer",
  "wider",
  "narrower",
  // actions
  "squeeze",
  "widen",
  "open the bag",
  "release",
  "continue",
  "go on",
  // ordinals & magnitudes
  "first",
  "last",
  "a bit",
  "a little",
  "a lot",
] as const;

/** Documented AssemblyAI streaming limits for `keyterms_prompt`. */
export const KEYTERMS_MAX_COUNT = 100;
export const KEYTERMS_MAX_LENGTH = 50;

/** Drop anything the API would reject, and cap the list at the documented maximum. */
export function sanitizeKeyterms(
  terms: readonly string[] = DEFAULT_KEYTERMS,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of terms) {
    const term = raw.trim();
    if (!term || term.length > KEYTERMS_MAX_LENGTH) continue;
    const key = term.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(term);
    if (out.length >= KEYTERMS_MAX_COUNT) break;
  }
  return out;
}
