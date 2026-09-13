"use client";

import dynamic from "next/dynamic";

// The whole app is client-only: it owns a WebGL canvas, a microphone session,
// a 20 Hz simulation and localStorage-backed stores. Nothing here benefits
// from server rendering, and skipping it avoids hydration mismatches.
const EarshotApp = dynamic(
  () => import("@/components/EarshotApp").then((m) => m.EarshotApp),
  {
    ssr: false,
    loading: () => (
      <div className="flex min-h-dvh items-center justify-center font-mono text-sm text-zinc-500">
        loading earshot…
      </div>
    ),
  },
);

export default function Home() {
  return <EarshotApp />;
}
