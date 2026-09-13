"use client";

import { Hud } from "@/components/Hud";
import { RightRail } from "@/components/RightRail";
import { TopBar } from "@/components/TopBar";
import { SceneNoSSR } from "@/components/Scene/SceneNoSSR";
import { useEarshot } from "@/lib/earshot/useEarshot";

export function EarshotApp() {
  const { vm, actions } = useEarshot();

  return (
    <div className="flex min-h-dvh flex-col lg:h-dvh lg:overflow-hidden">
      <TopBar vm={vm} actions={actions} />

      <main className="flex min-h-0 flex-1 flex-col gap-3 p-3 lg:grid lg:grid-cols-[66fr_34fr]">
        <section className="relative min-h-[52vh] overflow-hidden rounded-lg border border-line bg-panel lg:min-h-0">
          <div className="absolute inset-0">
            <SceneNoSSR className="h-full w-full" />
          </div>
          <Hud vm={vm} />
        </section>

        <RightRail vm={vm} actions={actions} />
      </main>
    </div>
  );
}
