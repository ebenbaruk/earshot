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
  /** Spoken acknowledgements ("Robot voice" in the top-bar overflow menu). */
  voiceReplies: boolean;
  /** True while the robot's own voice is playing; mic input is muted meanwhile. */
  speaking: boolean;
  /**
   * epoch ms when the newest policy version landed. The Policy panel uses it to
   * tell a fresh distillation (type the rules in) from one being browsed.
   */
  lastDistilledAt: number | null;
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
  voiceReplies: true,
  speaking: false,
  lastDistilledAt: null,
  set: (patch) => set(patch),
}));
