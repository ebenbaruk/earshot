/**
 * EARSHOT — UI view model.
 *
 * Every panel in `components/**` is presentational: data in (`EarshotViewModel`),
 * callbacks out (`EarshotActions`). No panel imports a store. `app/page.tsx`
 * builds one `{ vm, actions }` pair and threads it down.
 *
 * Today that pair comes from `components/mock/useMockEarshot.ts`. At integration
 * time the only change is to build the same two objects from the real stores
 * (`useSimStore` / `useVoiceStore` / `usePolicyStore` / `useRunsStore`) — the
 * panels do not change.
 */

import type {
  CorrectionEvent,
  PolicyDecision,
  PolicyVersion,
  RunRecord,
  SimStatus,
  VoiceStatus,
  WorldState,
} from "@/lib/types";

/** Set while a stop word was detected on a partial; drives the red scene flash. */
export interface StopFlash {
  /** ms since run start when the stop word landed on a partial transcript. */
  at: number;
  /** measured stop → halt latency in ms; null while still being measured. */
  latencyMs: number | null;
  /** the word we matched, for the transcript highlight ("stop", "wait", …). */
  word: string;
}

export interface EarshotViewModel {
  // ---- simulation ---------------------------------------------------------
  /** Authoritative world; the HUD reads stagesDone / gripper / objects from it. */
  world: WorldState;
  status: SimStatus;
  /** ms since run start (mirrors world.t; separate so the HUD can tick smoothly). */
  elapsedMs: number;
  seed: number;
  /** 1-based index of the run in progress — the x axis of the metrics chart. */
  runIndex: number;
  /** Ablation switch. false = pure autonomous, voice corrections are ignored. */
  correctionsEnabled: boolean;

  // ---- policy -------------------------------------------------------------
  /** Ascending, v0 first. */
  policies: PolicyVersion[];
  /** Version actually driving the agent. */
  currentVersion: number;
  /** Version the Policy panel is displaying (may differ while browsing). */
  selectedVersion: number;
  /** What the policy just decided; null before the first decision. */
  decision: PolicyDecision | null;
  /** True while waiting on the LLM for the next decision ("thinking…"). */
  policyThinking: boolean;
  /** True while /api/distill is in flight. */
  distilling: boolean;
  distillError: string | null;
  /** Corrections recorded since `currentVersion` was created. 0 disables Distill. */
  pendingCorrectionCount: number;

  // ---- voice --------------------------------------------------------------
  voice: VoiceStatus;
  voiceError: string | null;
  /** Live partial transcript from AssemblyAI; "" when nothing is being said. */
  partial: string;
  /** Non-null for ~1 s after a stop word is caught on a partial. */
  stopFlash: StopFlash | null;
  /** Most recent correction, for the "↳ nudge(-2, 0)" chip under the transcript. */
  lastCorrection: CorrectionEvent | null;

  // ---- logs ---------------------------------------------------------------
  /** Ascending by ts. Panels reverse as needed. */
  corrections: CorrectionEvent[];
  /** Ascending by startedAt. Completed runs only. */
  runs: RunRecord[];
}

export interface EarshotActions {
  /** Start or resume the run loop. */
  run(): void;
  pause(): void;
  /** Reset the world; pass a seed to reseed, otherwise reuse the current one. */
  reset(seed?: number): void;
  setSeed(seed: number): void;
  setCorrectionsEnabled(enabled: boolean): void;

  /** Switch the version the Policy panel shows. */
  selectVersion(version: number): void;
  /** Make the selected version the one that drives the agent. */
  activateVersion(version: number): void;
  /** Distil every pending correction into version N+1. */
  distill(): void;

  /** Mic on / off. */
  startVoice(): void;
  stopVoice(): void;

  /** Typed correction — same path as a spoken one, parseSource "text". */
  sendTextCorrection(text: string): void;

  /** Runs + corrections as JSON, for the top-bar Export item. */
  exportJSON(): string;
  importJSON(json: string): void;
}

export interface EarshotProps {
  vm: EarshotViewModel;
  actions: EarshotActions;
}
