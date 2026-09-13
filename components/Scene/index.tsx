"use client";

import { Suspense, useLayoutEffect, useMemo, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { ContactShadows, OrbitControls } from "@react-three/drei";
import { ACESFilmicToneMapping } from "three";
import clsx from "clsx";
import { useSimStore } from "@/store/useSimStore";
import { Lights } from "./Lights";
import { Table } from "./Table";
import { Bag } from "./Bag";
import { SimObjects } from "./SimObjects";
import { Gripper } from "./Gripper";

/** Fixed three-quarter framing. Distance/height tuned to hold the table, bag and gantry. */
const CAM_POS: [number, number, number] = [-33, 51, 92];
const LOOK_AT: [number, number, number] = [-1, 4.5, 0];
/** Peak yaw of the idle drift, in radians (≈ 1°), over DRIFT_PERIOD seconds. */
const DRIFT = 0.0175;
const DRIFT_PERIOD = 20;

/** Styles for the drei <Html> labels. Scoped here so the Scene owns its own CSS. */
const LABEL_CSS = `
.scene-label{display:flex;align-items:center;gap:5px;white-space:nowrap;font:600 11px/1.15 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;color:#e9eefb;background:rgba(10,13,19,.66);border:1px solid rgba(150,175,255,.22);border-radius:999px;padding:3px 9px;letter-spacing:.012em;backdrop-filter:blur(7px);box-shadow:0 2px 12px rgba(0,0,0,.5);user-select:none;pointer-events:none;transition:opacity .18s ease}
.scene-label-dim{font-weight:500;color:#9fb0d0}
.scene-badge{font:600 9.5px/1.25 ui-sans-serif,system-ui,sans-serif;text-transform:uppercase;letter-spacing:.06em;color:#bcd0ff;background:rgba(96,132,255,.2);border:1px solid rgba(130,164,255,.4);border-radius:999px;padding:1px 6px}
.scene-badge-alert{color:#fff;background:rgba(214,42,42,.92);border-color:rgba(255,150,150,.65);box-shadow:0 0 12px rgba(255,60,60,.5)}
`;

/**
 * Keeps the whole table in frame at any aspect and adds a very slow yaw drift so
 * a screen recording never looks like a still. Drift is off while orbiting.
 */
function CameraRig({ drift }: { drift: boolean }) {
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const base = useMemo(() => ({ x: CAM_POS[0], y: CAM_POS[1], z: CAM_POS[2] }), []);
  const radius = useMemo(() => Math.hypot(CAM_POS[0], CAM_POS[2]), []);
  const angle0 = useMemo(() => Math.atan2(CAM_POS[0], CAM_POS[2]), []);
  const t = useRef(0);

  useLayoutEffect(() => {
    const aspect = size.width / Math.max(1, size.height);
    // Squarer viewports need a wider lens to keep the gantry and bag in shot.
    const fov =
      aspect >= 1.7 ? 31 : aspect >= 1.4 ? 34 : aspect >= 1.15 ? 37 : aspect >= 1.0 ? 40 : 48;
    if ("fov" in camera) {
      // eslint-disable-next-line react-hooks/immutability -- three.js camera is a mutable object by design
      (camera as { fov: number }).fov = fov;
    }
    camera.position.set(base.x, base.y, base.z);
    camera.lookAt(...LOOK_AT);
    camera.updateProjectionMatrix();
  }, [camera, size.width, size.height, base]);

  useFrame((frame, dt) => {
    if (!drift) return;
    t.current += dt;
    const phase = (t.current / DRIFT_PERIOD) * Math.PI * 2;
    const a = angle0 + Math.sin(phase) * DRIFT;
    const cam = frame.camera;
    cam.position.set(
      Math.sin(a) * radius,
      base.y + Math.sin(phase + 1.2) * 0.7,
      Math.cos(a) * radius,
    );
    cam.lookAt(LOOK_AT[0], LOOK_AT[1], LOOK_AT[2]);
  });

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
        gl={{ antialias: true, toneMapping: ACESFilmicToneMapping, toneMappingExposure: 1.18 }}
        camera={{ position: CAM_POS, fov: 31, near: 0.5, far: 600 }}
      >
        <color attach="background" args={["#070910"]} />
        <fog attach="fog" args={["#070910", 165, 360]} />
        <CameraRig drift={!orbit} />
        <Lights />
        <Suspense fallback={null}>
          <Table />
          <Bag />
          <SimObjects />
          <Gripper />
          {/* Contact shadows glue everything to the table top.
              The capture camera starts at y = 0.14 so the decorative glow planes
              that sit flat on the table (light pool, landing pool, grasp halo)
              stay below it and never cast a square shadow of their own. */}
          <ContactShadows
            position={[0, 0.14, 0]}
            scale={[70, 50]}
            blur={1.9}
            opacity={0.72}
            far={11}
            resolution={1024}
            color="#1a1206"
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
            : "inset 0 0 170px 46px rgba(0,0,0,.58)",
        }}
      />
    </div>
  );
}

export default Scene;
