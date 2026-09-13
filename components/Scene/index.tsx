"use client";

import { Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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
import { DustMotes, GhostTrail } from "./Effects";
import { AlignmentGizmo } from "./Debug";

/** Fixed three-quarter framing. Distance/height tuned to hold the table, bag and gantry. */
const CAM_POS: [number, number, number] = [-33, 51, 92];
const LOOK_AT: [number, number, number] = [-1, 4.5, 0];
/** Peak yaw of the idle drift, in radians (≈ 1°), over DRIFT_PERIOD seconds. */
const DRIFT = 0.0175;
const DRIFT_PERIOD = 20;
/** How far the camera creeps in when the run is won, and how fast it gets there. */
const WIN_PUSH = 0.92;
const PUSH_RATE = 1.05;

/** Styles for the drei <Html> labels. Scoped here so the Scene owns its own CSS. */
const LABEL_CSS = `
.scene-label{display:flex;align-items:center;gap:5px;white-space:nowrap;font:600 11px/1.15 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;color:#e9eefb;background:rgba(10,13,19,.66);border:1px solid rgba(150,175,255,.22);border-radius:999px;padding:3px 9px;letter-spacing:.012em;backdrop-filter:blur(7px);box-shadow:0 2px 12px rgba(0,0,0,.5);user-select:none;pointer-events:none;transition:opacity .18s ease}
.scene-label-dim{font-weight:500;color:#9fb0d0}
.scene-badge{font:600 9.5px/1.25 ui-sans-serif,system-ui,sans-serif;text-transform:uppercase;letter-spacing:.06em;color:#bcd0ff;background:rgba(96,132,255,.2);border:1px solid rgba(130,164,255,.4);border-radius:999px;padding:1px 6px}
.scene-badge-alert{color:#fff;background:rgba(214,42,42,.92);border-color:rgba(255,150,150,.65);box-shadow:0 0 12px rgba(255,60,60,.5)}
@keyframes scene-stop-flash{0%{opacity:.7}22%{opacity:.45}100%{opacity:0}}
.scene-stopflash{position:absolute;inset:0;background:radial-gradient(120% 90% at 50% 42%,#fff 0%,#ffd9a8 38%,rgba(255,190,120,0) 72%);mix-blend-mode:screen;opacity:0;animation:scene-stop-flash .42s ease-out forwards;pointer-events:none}
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
  /** 1 = framing as designed, WIN_PUSH = pushed in on a win. */
  const push = useRef(1);

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
    // A slow ~8 % push-in on a win, easing back out when the run is reset.
    const want = useSimStore.getState().world.status === "succeeded" ? WIN_PUSH : 1;
    push.current += (want - push.current) * (1 - Math.exp(-Math.min(dt, 0.1) * PUSH_RATE));
    const k = push.current;
    const cam = frame.camera;
    cam.position.set(
      LOOK_AT[0] + (Math.sin(a) * radius - LOOK_AT[0]) * k,
      LOOK_AT[1] + (base.y + Math.sin(phase + 1.2) * 0.7 - LOOK_AT[1]) * k,
      LOOK_AT[2] + (Math.cos(a) * radius - LOOK_AT[2]) * k,
    );
    cam.lookAt(LOOK_AT[0], LOOK_AT[1], LOOK_AT[2]);
  });

  return null;
}

export interface SceneProps {
  className?: string;
  /** Enable OrbitControls (off by default — the demo uses a fixed three-quarter view). */
  orbit?: boolean;
  /** Preview only: plumb lines through the finger gap and every object origin. */
  debug?: boolean;
}

/** The Earshot world: table, bag, objects and gantry gripper, driven by `useSimStore`. */
export function Scene({ className, orbit = false, debug = false }: SceneProps) {
  const status = useSimStore((s) => s.world.status);
  const paused = status === "paused";
  const won = status === "succeeded";
  // Re-mounting the flash div is what replays its keyframes on every stop, so
  // count the transitions into `paused` straight off the store.
  const [stops, setStops] = useState(0);
  const prevStatus = useRef(status);
  useEffect(
    () =>
      useSimStore.subscribe((st) => {
        const next = st.world.status;
        if (next === prevStatus.current) return;
        prevStatus.current = next;
        if (next === "paused") setStops((n) => n + 1);
      }),
    [],
  );

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
          <GhostTrail />
          <DustMotes />
          {debug ? <AlignmentGizmo /> : null}
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

      {/* the world drains of colour the moment the operator says stop */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 transition-[backdrop-filter] duration-[450ms]"
        style={{
          backdropFilter: paused ? "saturate(.42) brightness(.94) contrast(1.04)" : "none",
        }}
      />

      {/* vignette; turns red while the run is paused, green once it is won */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 transition-[box-shadow] duration-500"
        style={{
          boxShadow: paused
            ? "inset 0 0 120px 24px rgba(220,38,38,.42), inset 0 0 320px 90px rgba(0,0,0,.55)"
            : won
              ? "inset 0 0 130px 30px rgba(46,240,160,.2), inset 0 0 320px 90px rgba(0,0,0,.5)"
              : "inset 0 0 170px 46px rgba(0,0,0,.58)",
        }}
      />

      {/* one-frame-feel white flash on every stop */}
      {stops > 0 ? <div key={stops} aria-hidden className="scene-stopflash" /> : null}
    </div>
  );
}

export default Scene;
