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
    <div className="flex h-full w-full min-h-[360px] items-center justify-center rounded-lg bg-[#080a10] text-sm text-zinc-500">
      loading scene…
    </div>
  ),
});

export default SceneNoSSR;
