"use client";

/**
 * Builds the `{ vm, actions }` pair the panels consume from the real stores.
 */
import { useEffect, useMemo } from "react";
import type { EarshotActions, EarshotViewModel } from "@/components/view-model";
import { useSimStore } from "@/store/useSimStore";
import { useVoiceStore } from "@/store/useVoiceStore";
import { usePolicyStore } from "@/store/usePolicyStore";
import { useRunsStore } from "@/store/useRunsStore";
import { useSessionStore } from "./session";
import { controller } from "./controller";

export function useEarshot(): { vm: EarshotViewModel; actions: EarshotActions } {
  useEffect(() => {
    // Runs left unfinished by a reload are noise: drop them once hydrated.
    void Promise.resolve(useRunsStore.persist.rehydrate()).then(() => {
      useRunsStore.setState((s) => ({ runs: s.runs.filter((r) => r.endedAt !== null) }));
    });
  }, []);

  const world = useSimStore((s) => s.world);
  const voice = useVoiceStore((s) => s.status);
  const voiceError = useVoiceStore((s) => s.error);
  const partial = useVoiceStore((s) => s.partial);
  const versions = usePolicyStore((s) => s.versions);
  const currentVersion = usePolicyStore((s) => s.currentVersion);
  const runs = useRunsStore((s) => s.runs);
  const corrections = useRunsStore((s) => s.corrections);
  const session = useSessionStore();

  const pendingCorrectionCount = useMemo(() => {
    const consumed = new Set(versions.flatMap((v) => v.distilledFrom));
    return corrections.filter((c) => !consumed.has(c.id) && c.parsedCommand !== null).length;
  }, [versions, corrections]);

  const completedRuns = useMemo(() => runs.filter((r) => r.endedAt !== null), [runs]);

  const vm: EarshotViewModel = {
    world,
    status: world.status,
    elapsedMs: world.t,
    seed: session.seed,
    runIndex: completedRuns.length + 1,
    correctionsEnabled: session.correctionsEnabled,
    policies: versions,
    currentVersion,
    selectedVersion: session.selectedVersion,
    decision: session.decision,
    policyThinking: session.policyThinking,
    distilling: session.distilling,
    distillError: session.distillError,
    pendingCorrectionCount,
    voice,
    voiceError,
    partial,
    stopFlash: session.stopFlash,
    lastCorrection: session.lastCorrection,
    corrections,
    runs: completedRuns,
  };

  const actions: EarshotActions = useMemo(
    () => ({
      run: () => controller.run(),
      pause: () => controller.pause(),
      reset: (seed) => controller.reset(seed),
      setSeed: (seed) => controller.setSeed(seed),
      setCorrectionsEnabled: (enabled) => controller.setCorrectionsEnabled(enabled),
      selectVersion: (v) => controller.selectVersion(v),
      activateVersion: (v) => controller.activateVersion(v),
      distill: () => void controller.distill(),
      startVoice: () => controller.startVoice(),
      stopVoice: () => controller.stopVoice(),
      sendTextCorrection: (text) => controller.sendTextCorrection(text),
      exportJSON: () => controller.exportJSON(),
      importJSON: (json) => controller.importJSON(json),
    }),
    [],
  );

  return { vm, actions };
}
