"use client";

import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { PMREMGenerator } from "three";
import type { PointLight, SpotLight } from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { useSimStore } from "@/store/useSimStore";
import { approach, damp } from "./coords";

/**
 * Image-based lighting from three's bundled RoomEnvironment.
 * Deliberately NOT drei's <Environment preset>, which downloads an HDR — the
 * demo has to look identical with the network unplugged.
 */
function StudioEnvironment() {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);

  useEffect(() => {
    const pmrem = new PMREMGenerator(gl);
    const room = new RoomEnvironment();
    const rt = pmrem.fromScene(room, 0.04);
    /* eslint-disable react-hooks/immutability -- three.js Scene is a mutable object by design */
    scene.environment = rt.texture;
    scene.environmentIntensity = 0.7;
    return () => {
      scene.environment = null;
      rt.dispose();
      room.dispose();
      pmrem.dispose();
    };
    /* eslint-enable react-hooks/immutability */
  }, [gl, scene]);

  return null;
}

/** Soft key + fill studio rig, a warm pool over the table, and a pause rim light. */
export function Lights() {
  const rim = useRef<PointLight>(null);
  const pool = useRef<SpotLight>(null);

  useFrame((_, dt) => {
    const paused = useSimStore.getState().world.status === "paused";
    if (rim.current) {
      rim.current.intensity = approach(rim.current.intensity, paused ? 700 : 0, damp(dt, 6));
    }
    if (pool.current) {
      pool.current.intensity = approach(pool.current.intensity, paused ? 1100 : 1900, damp(dt, 5));
    }
  });

  return (
    <>
      <StudioEnvironment />
      <ambientLight intensity={0.5} color="#e1eaff" />
      <hemisphereLight args={["#d8e4ff", "#101724", 0.9]} />

      {/* key */}
      <directionalLight
        position={[26, 48, 30]}
        intensity={2.2}
        color="#f3f5ff"
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-bias={-0.0006}
        shadow-normalBias={0.06}
        shadow-radius={3}
        shadow-camera-near={1}
        shadow-camera-far={160}
        shadow-camera-left={-50}
        shadow-camera-right={50}
        shadow-camera-top={50}
        shadow-camera-bottom={-50}
      />
      {/* cool fill from the opposite side — shapes the metal without a second shadow */}
      <directionalLight position={[-40, 26, -18]} intensity={0.8} color="#9dbdff" />
      {/* low back light, separates the gantry from the black background */}
      <directionalLight position={[-6, 12, -46]} intensity={1.0} color="#699eff" />

      {/* warm pool centred on the work area */}
      <spotLight
        ref={pool}
        position={[-6, 58, 20]}
        angle={0.62}
        penumbra={0.95}
        intensity={1900}
        distance={150}
        decay={1.6}
        color="#d7e3ff"
      />

      {/* pause rim light */}
      <pointLight ref={rim} position={[0, 16, 36]} intensity={0} color="#ff3b30" distance={140} />
    </>
  );
}
