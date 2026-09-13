import type { FewShot, PolicyRule, PolicyVersion } from "@/lib/types";

export interface PolicyDiff {
  added: PolicyRule[];
  removed: PolicyRule[];
  addedFewShots: FewShot[];
}

/** What changed going from policy `a` to policy `b`. */
export function diffPolicies(a: PolicyVersion, b: PolicyVersion): PolicyDiff {
  const aRuleIds = new Set(a.rules.map((r) => r.id));
  const bRuleIds = new Set(b.rules.map((r) => r.id));
  const aShotIds = new Set(a.fewShots.map((f) => f.id));

  return {
    added: b.rules.filter((r) => !aRuleIds.has(r.id)),
    removed: a.rules.filter((r) => !bRuleIds.has(r.id)),
    addedFewShots: b.fewShots.filter((f) => !aShotIds.has(f.id)),
  };
}
