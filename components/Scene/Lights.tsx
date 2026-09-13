"use client";

import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import type { PointLight } from "three";
import { useSimStore } from "@/store/useSimStore";
import { approach, damp } from "./coords";

/** Studio key/fill plus a red rim light that fades in while the run is paused. */
export function Lights() {
  const rim = useRef<PointLight>(null);

  useFrame((_, dt) => {
    if (!rim.current) return;
    const paused = useSimStore.getState().world.status === "paused";
    rim.current.intensity = approach(rim.current.intensity, paused ? 900 : 0, damp(dt, 6));
  });

  return (
    <>
      <ambientLight intensity={0.45} color="#c9d6ff" />
      <hemisphereLight args={["#8fa6ff", "#141821", 0.5]} />
      <directionalLight
        position={[24, 46, 26]}
        intensity={2.1}
        color="#fff4e2"
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-bias={-0.0008}
        shadow-camera-near={1}
        shadow-camera-far={140}
        shadow-camera-left={-45}
        shadow-camera-right={45}
        shadow-camera-top={45}
        shadow-camera-bottom={-45}
      />
      <spotLight
        position={[-34, 40, 34]}
        angle={0.7}
        penumbra={1}
        intensity={900}
        color="#9fc4ff"
        distance={140}
      />
      {/* pause rim light */}
      <pointLight ref={rim} position={[0, 14, 34]} intensity={0} color="#ff3b30" distance={130} />
    </>
  );
}
