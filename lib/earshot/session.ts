/**
 * EARSHOT — per-tab session state that is neither the world, nor the policy
 * versions, nor the persisted history. Everything the HUD needs "right now".
 */
import { create } from "zustand";
import type { CorrectionEvent, PolicyDecision } from "@/lib/types";
import type { StopFlash } from "@/components/view-model";
import { DEFAULT_SEED } from "@/store/useSimStore";

export interface SessionState {
  seed: number;
  correctionsEnabled: boolean;
  selectedVersion: number;
  decision: PolicyDecision | null;
  policyThinking: boolean;
  distilling: boolean;
  distillError: string | null;
  stopFlash: StopFlash | null;
  lastCorrection: CorrectionEvent | null;
  /** id of the run in progress, null between runs */
  activeRunId: string | null;
  set: (patch: Partial<SessionState>) => void;
}

export const useSessionStore = create<SessionState>((set) => ({
  seed: DEFAULT_SEED,
  correctionsEnabled: true,
  selectedVersion: 0,
  decision: null,
  policyThinking: false,
  distilling: false,
  distillError: null,
  stopFlash: null,
  lastCorrection: null,
  activeRunId: null,
  set: (patch) => set(patch),
}));
