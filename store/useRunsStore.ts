/**
 * EARSHOT — persisted run + correction history (`localStorage: earshot.runs`).
 *
 * This is the UI's long-lived record of the demo: every completed run and every
 * correction ever given. The integration layer writes into it (the policy loop
 * calls `addRun` / `updateRun`, the voice layer calls `addCorrection` /
 * `updateCorrection`); the Metrics and Corrections panels read from it via the
 * view model. Nothing here talks to the sim.
 */

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { CorrectionEvent, RunRecord } from "@/lib/types";

export interface RunsSnapshot {
  runs: RunRecord[];
  corrections: CorrectionEvent[];
}

export interface RunsStore extends RunsSnapshot {
  addRun(run: RunRecord): void;
  updateRun(id: string, patch: Partial<RunRecord>): void;
  addCorrection(correction: CorrectionEvent): void;
  updateCorrection(id: string, patch: Partial<CorrectionEvent>): void;
  clear(): void;
  /** Pretty-printed `{ version, exportedAt, runs, corrections }`. */
  exportJSON(): string;
  /** Replaces the current history. Throws on malformed input. */
  importJSON(json: string): void;
}

export const RUNS_STORAGE_KEY = "earshot.runs";
const EXPORT_VERSION = 1;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

export const useRunsStore = create<RunsStore>()(
  persist(
    (set, get) => ({
      runs: [],
      corrections: [],

      addRun: (run) =>
        set((s) =>
          s.runs.some((r) => r.id === run.id)
            ? { runs: s.runs.map((r) => (r.id === run.id ? { ...r, ...run } : r)) }
            : { runs: [...s.runs, run] },
        ),

      updateRun: (id, patch) =>
        set((s) => ({
          runs: s.runs.map((r) => (r.id === id ? { ...r, ...patch } : r)),
        })),

      addCorrection: (correction) =>
        set((s) =>
          s.corrections.some((c) => c.id === correction.id)
            ? {
                corrections: s.corrections.map((c) =>
                  c.id === correction.id ? { ...c, ...correction } : c,
                ),
              }
            : { corrections: [...s.corrections, correction] },
        ),

      updateCorrection: (id, patch) =>
        set((s) => ({
          corrections: s.corrections.map((c) =>
            c.id === id ? { ...c, ...patch } : c,
          ),
        })),

      clear: () => set({ runs: [], corrections: [] }),

      exportJSON: () => {
        const { runs, corrections } = get();
        return JSON.stringify(
          { version: EXPORT_VERSION, exportedAt: Date.now(), runs, corrections },
          null,
          2,
        );
      },

      importJSON: (json) => {
        const parsed: unknown = JSON.parse(json);
        if (!isRecord(parsed)) throw new Error("Expected a JSON object");
        const runs = parsed.runs;
        const corrections = parsed.corrections;
        if (!Array.isArray(runs) || !Array.isArray(corrections)) {
          throw new Error("Expected `runs` and `corrections` arrays");
        }
        set({
          runs: runs as RunRecord[],
          corrections: corrections as CorrectionEvent[],
        });
      },
    }),
    {
      name: RUNS_STORAGE_KEY,
      storage: createJSONStorage(() => localStorage),
      // Persist data only — never the action closures.
      partialize: (s): RunsSnapshot => ({
        runs: s.runs,
        corrections: s.corrections,
      }),
      // The page renders client-side; hydrate explicitly to avoid an SSR/CSR
      // mismatch on first paint. `useRunsHydration()` triggers it.
      skipHydration: true,
    },
  ),
);

/** Call once from a client component to pull persisted history in. */
export function hydrateRunsStore(): void {
  void useRunsStore.persist.rehydrate();
}
