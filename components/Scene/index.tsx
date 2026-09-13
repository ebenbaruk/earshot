"use client";

import { Suspense, useLayoutEffect } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { ContactShadows, OrbitControls } from "@react-three/drei";
import clsx from "clsx";
import { useSimStore } from "@/store/useSimStore";
import { Lights } from "./Lights";
import { Table } from "./Table";
import { Bag } from "./Bag";
import { SimObjects } from "./SimObjects";
import { Gripper } from "./Gripper";

const LOOK_AT: [number, number, number] = [0, 5, 0];

/** Styles for the drei <Html> labels. Scoped here so the Scene owns its own CSS. */
const LABEL_CSS = `
.scene-label{display:flex;align-items:center;gap:6px;white-space:nowrap;font:600 12px/1.1 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;color:#e8eefc;background:rgba(14,17,24,.72);border:1px solid rgba(148,175,255,.28);border-radius:999px;padding:4px 10px;letter-spacing:.01em;backdrop-filter:blur(6px);box-shadow:0 2px 10px rgba(0,0,0,.45);user-select:none;pointer-events:none}
.scene-label-dim{font-weight:500;color:#9fb0d0}
.scene-label-alert{color:#fff;background:rgba(190,32,32,.88);border-color:rgba(255,140,140,.6)}
`;

function CameraRig() {
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  useLayoutEffect(() => {
    // Widen the field of view on squarer viewports so the whole table stays in frame.
    const aspect = size.width / Math.max(1, size.height);
    const fov = aspect >= 1.7 ? 30 : aspect >= 1.3 ? 34 : aspect >= 1.0 ? 38 : 48;
    if ("fov" in camera) {
      (camera as { fov: number }).fov = fov;
    }
    camera.lookAt(...LOOK_AT);
    camera.updateProjectionMatrix();
  }, [camera, size.width, size.height]);
  return null;
}

export interface SceneProps {
  className?: string;
  /** Enable OrbitControls (off by default — the demo uses a fixed three-quarter view). */
  orbit?: boolean;
}

/** The Earshot world: table, bag, objects and gantry gripper, driven by `useSimStore`. */
export function Scene({ className, orbit = false }: SceneProps) {
  const paused = useSimStore((s) => s.world.status === "paused");

  return (
    <div className={clsx("relative h-full w-full min-h-[360px] overflow-hidden", className)}>
      <style>{LABEL_CSS}</style>
      <Canvas
        shadows
        dpr={[1, 2]}
        gl={{ antialias: true }}
        camera={{ position: [-30, 52, 96], fov: 30, near: 0.5, far: 500 }}
      >
        <color attach="background" args={["#080a10"]} />
        <fog attach="fog" args={["#080a10", 150, 330]} />
        <CameraRig />
        <Lights />
        <Suspense fallback={null}>
          <Table />
          <Bag />
          <SimObjects />
          <Gripper />
          <ContactShadows
            position={[0, 0.02, 0]}
            scale={[68, 48]}
            blur={2.4}
            opacity={0.55}
            far={9}
            resolution={1024}
            color="#000000"
          />
        </Suspense>
        {orbit ? <OrbitControls target={LOOK_AT} makeDefault /> : null}
      </Canvas>

      {/* vignette; turns red while the run is paused */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 transition-[box-shadow] duration-500"
        style={{
          boxShadow: paused
            ? "inset 0 0 120px 24px rgba(220,38,38,.42), inset 0 0 320px 90px rgba(0,0,0,.55)"
            : "inset 0 0 160px 40px rgba(0,0,0,.55)",
        }}
      />
    </div>
  );
}

export default Scene;
