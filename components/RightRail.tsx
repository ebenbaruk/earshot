"use client";

import { useState } from "react";
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

  const tabs: TabDef<TabKey>[] = [
    { key: "corrections", label: "Corrections", badge: vm.corrections.length },
    { key: "policy", label: "Policy", badge: `v${vm.currentVersion}` },
    { key: "metrics", label: "Metrics", badge: vm.runs.length },
  ];

  return (
    <aside className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-line bg-panel">
      <Tabs tabs={tabs} value={tab} onChange={setTab} />

      {tab === "corrections" ? (
        <CorrectionLog
          corrections={vm.corrections}
          onSendText={actions.sendTextCorrection}
        />
      ) : null}

      {tab === "policy" ? (
        <PolicyPanel
          policies={vm.policies}
          currentVersion={vm.currentVersion}
          selectedVersion={vm.selectedVersion}
          corrections={vm.corrections}
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
