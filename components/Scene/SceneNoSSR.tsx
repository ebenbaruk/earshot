"use client";

import dynamic from "next/dynamic";
import type { SceneProps } from "./index";

/**
 * Client-only wrapper around <Scene />.
 * react-three-fiber needs a real canvas, so the scene must never be prerendered.
 * Import this from anywhere (server or client) — the `ssr: false` lives in this
 * "use client" module, which is where Next 16 requires it.
 */
export const SceneNoSSR = dynamic<SceneProps>(() => import("./index").then((m) => m.Scene), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full min-h-0 items-center justify-center bg-[#0c1018] font-mono text-xs tracking-widest text-[#b3c2dc]">
      Preparing the workspace…
    </div>
  ),
});

export default SceneNoSSR;
