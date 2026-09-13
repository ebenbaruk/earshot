"use client";

import { Hud } from "@/components/Hud";
import { RightRail } from "@/components/RightRail";
import { ScenePlaceholder } from "@/components/ScenePlaceholder";
import { TopBar } from "@/components/TopBar";
// --- MOCK: replace this import (and the call below) with the real stores. ----
import { useMockEarshot } from "@/components/mock/useMockEarshot";
// ----------------------------------------------------------------------------

export default function Home() {
  // Everything on this page reads from one `EarshotViewModel` + `EarshotActions`
  // pair (see `components/view-model.ts`). Swapping the mock for the real stores
  // is a one-line change here; no panel below is aware of where the data came from.
  const { vm, actions } = useMockEarshot();

  return (
    <div className="flex min-h-dvh flex-col lg:h-dvh lg:overflow-hidden">
      <TopBar vm={vm} actions={actions} />

      <main className="flex min-h-0 flex-1 flex-col gap-3 p-3 lg:grid lg:grid-cols-[66fr_34fr]">
        {/* scene + HUD */}
        <section className="relative min-h-[52vh] overflow-hidden rounded-lg border border-line bg-panel lg:min-h-0">
          {/* MOCK: the integrator swaps this for <SceneNoSSR /> from components/Scene */}
          <ScenePlaceholder />
          <Hud vm={vm} />
        </section>

        <RightRail vm={vm} actions={actions} />
      </main>
    </div>
  );
}
