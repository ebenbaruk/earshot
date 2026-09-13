import type { PolicyVersion } from "@/lib/types";

/**
 * Version 0 — the un-corrected high-level policy.
 *
 * It deliberately knows nothing about the world's hidden quirks (the
 * tape holder's off-centre grasp point, the sponge needing compression, the
 * marker rolling out if anything is packed after it). Those have to be
 * supplied by the operator's voice corrections and recovered by `distill()`.
 *
 * `createdAt` is 0 rather than Date.now() so the base policy is value-stable
 * across reloads, persisted store hydration and snapshot tests.
 */
export const BASE_POLICY: PolicyVersion = {
  version: 0,
  createdAt: 0,
  parentVersion: null,
  rules: [],
  fewShots: [],
  changelog: "Base policy",
  distilledFrom: [],
};

export function isBasePolicy(p: PolicyVersion): boolean {
  return p.version === 0;
}
