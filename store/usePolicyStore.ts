"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { PolicyVersion } from "@/lib/types";
import { BASE_POLICY } from "@/lib/policy/base-policy";

export interface PolicyStore {
  versions: PolicyVersion[];
  currentVersion: number;
  /** Convenience selector: the PolicyVersion for `currentVersion`. */
  current(): PolicyVersion;
  setCurrent(v: number): void;
  addVersion(pv: PolicyVersion): void;
  reset(): void;
}

const seed = (): Pick<PolicyStore, "versions" | "currentVersion"> => ({
  versions: [BASE_POLICY],
  currentVersion: 0,
});

export const usePolicyStore = create<PolicyStore>()(
  persist(
    (set, get) => ({
      ...seed(),

      current() {
        const { versions, currentVersion } = get();
        return (
          versions.find((v) => v.version === currentVersion) ??
          versions[versions.length - 1] ??
          BASE_POLICY
        );
      },

      setCurrent(v) {
        if (get().versions.some((pv) => pv.version === v)) {
          set({ currentVersion: v });
        }
      },

      /** Adds (or replaces) a version and switches to it. */
      addVersion(pv) {
        set((state) => {
          const versions = [
            ...state.versions.filter((v) => v.version !== pv.version),
            pv,
          ].sort((a, b) => a.version - b.version);
          return { versions, currentVersion: pv.version };
        });
      },

      reset() {
        set(seed());
      },
    }),
    {
      name: "earshot.policy",
      storage: createJSONStorage(() => localStorage),
      version: 1,
      partialize: (s) => ({
        versions: s.versions,
        currentVersion: s.currentVersion,
      }),
      merge: (persisted, currentState) => {
        const p = (persisted ?? {}) as Partial<PolicyStore>;
        const versions =
          Array.isArray(p.versions) && p.versions.length > 0
            ? p.versions
            : [BASE_POLICY];
        // The base policy must always be selectable, even if storage is stale.
        if (!versions.some((v) => v.version === 0)) versions.unshift(BASE_POLICY);
        const currentVersion =
          typeof p.currentVersion === "number" &&
          versions.some((v) => v.version === p.currentVersion)
            ? p.currentVersion
            : 0;
        return { ...currentState, versions, currentVersion };
      },
    },
  ),
);
