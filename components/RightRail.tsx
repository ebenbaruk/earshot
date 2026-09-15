"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { EarshotActions, EarshotViewModel } from "./view-model";
import { Tabs, type TabDef } from "./Tabs";
import { CorrectionLog } from "./CorrectionLog";
import { PolicyPanel } from "./PolicyPanel";
import { MetricsPanel } from "./MetricsPanel";

type TabKey = "corrections" | "policy" | "metrics";

export function RightRail({
  vm,
  actions,
}: {
  vm: EarshotViewModel;
  actions: EarshotActions;
}) {
  const [tab, setTab] = useState<TabKey>("corrections");

  /**
   * Corrections that no policy version has consumed yet — the ones the next
   * distillation will eat. The log glows them while it runs.
   */
  const pendingIds = useMemo(() => {
    const consumed = new Set(vm.policies.flatMap((p) => p.distilledFrom));
    return new Set(
      vm.corrections
        .filter((c) => !consumed.has(c.id) && c.parsedCommand !== null)
        .map((c) => c.id),
    );
  }, [vm.policies, vm.corrections]);

  /**
   * The distillation moment: when a new version lands, the rail brings the
   * operator to it rather than waiting to be clicked.
   */
  const seenDistill = useRef(vm.lastDistilledAt);
  useEffect(() => {
    if (vm.lastDistilledAt == null) return;
    if (vm.lastDistilledAt === seenDistill.current) return;
    seenDistill.current = vm.lastDistilledAt;
    setTab("policy");
  }, [vm.lastDistilledAt]);

  const tabs: TabDef<TabKey>[] = [
    { key: "corrections", label: "Corrections", badge: vm.corrections.length },
    { key: "policy", label: "Policy", badge: `v${vm.currentVersion}` },
    { key: "metrics", label: "Metrics", badge: vm.runs.length },
  ];

  return (
    <aside className="learning-panel flex min-h-0 flex-col overflow-hidden">
      <div className="learning-heading"><span className="section-kicker">THE HUMAN PART</span><h3>Your instinct. <br />Its next lesson.</h3></div>
      <Tabs tabs={tabs} value={tab} onChange={setTab} />

      {tab === "corrections" ? (
        <CorrectionLog
          corrections={vm.corrections}
          canSend={vm.status === "running" || vm.status === "paused"}
          onSendText={actions.sendTextCorrection}
          distilling={vm.distilling}
          pendingIds={pendingIds}
        />
      ) : null}

      {tab === "policy" ? (
        <PolicyPanel
          policies={vm.policies}
          currentVersion={vm.currentVersion}
          selectedVersion={vm.selectedVersion}
          corrections={vm.corrections}
          lastDistilledAt={vm.lastDistilledAt}
          onSelectVersion={actions.selectVersion}
          onActivateVersion={actions.activateVersion}
        />
      ) : null}

      {tab === "metrics" ? (
        <MetricsPanel runs={vm.runs} corrections={vm.corrections} />
      ) : null}
    </aside>
  );
}
