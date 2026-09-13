"use client";

import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import type { Group } from "three";
import {
  BAG_DEPTH,
  BAG_HEIGHT,
  BAG_OPENING_MAX,
  BAG_POS,
} from "@/lib/sim/constants";
import { useSimStore } from "@/store/useSimStore";
import { approach, damp } from "./coords";

const BODY_NOMINAL = BAG_OPENING_MAX + 3;

/** Open ziploc bag: a transparent pouch whose mouth width tracks `bag.opening`. */
export function Bag() {
  const body = useRef<Group>(null);
  const rim = useRef<Group>(null);
  const opening = useSimStore((s) => Math.round(s.world.bag.opening * 10) / 10);

  useFrame((_, dt) => {
    const w = useSimStore.getState().world;
    const k = damp(dt, 10);
    if (body.current) {
      body.current.scale.x = approach(body.current.scale.x, (w.bag.opening + 3) / BODY_NOMINAL, k);
    }
    if (rim.current) {
      rim.current.scale.x = approach(
        rim.current.scale.x,
        Math.max(0.08, w.bag.opening / BAG_OPENING_MAX),
        k,
      );
    }
  });

  return (
    <group position={[BAG_POS.x, 0, -BAG_POS.y]}>
      {/* pouch */}
      <group ref={body}>
        <mesh position={[0, BAG_HEIGHT / 2, 0]}>
          <boxGeometry args={[BODY_NOMINAL, BAG_HEIGHT, BAG_DEPTH]} />
          <meshPhysicalMaterial
            color="#bfe9ff"
            transparent
            opacity={0.1}
            roughness={0.12}
            metalness={0}
            transmission={0}
            depthWrite={false}
            side={2}
          />
        </mesh>
        {/* bottom seam */}
        <mesh position={[0, 0.25, 0]}>
          <boxGeometry args={[BODY_NOMINAL, 0.5, BAG_DEPTH]} />
          <meshStandardMaterial color="#7fd7ff" transparent opacity={0.35} roughness={0.3} />
        </mesh>
      </group>

      {/* the mouth: a bright rectangle whose width IS bag.opening */}
      <group ref={rim} position={[0, BAG_HEIGHT, 0]}>
        <mesh position={[-BAG_OPENING_MAX / 2, 0, 0]}>
          <boxGeometry args={[0.55, 0.55, BAG_DEPTH + 0.55]} />
          <meshStandardMaterial color="#43d9ff" emissive="#1b7fa8" emissiveIntensity={0.8} />
        </mesh>
        <mesh position={[BAG_OPENING_MAX / 2, 0, 0]}>
          <boxGeometry args={[0.55, 0.55, BAG_DEPTH + 0.55]} />
          <meshStandardMaterial color="#43d9ff" emissive="#1b7fa8" emissiveIntensity={0.8} />
        </mesh>
        <mesh position={[0, 0, BAG_DEPTH / 2]}>
          <boxGeometry args={[BAG_OPENING_MAX, 0.55, 0.55]} />
          <meshStandardMaterial color="#43d9ff" emissive="#1b7fa8" emissiveIntensity={0.8} />
        </mesh>
        <mesh position={[0, 0, -BAG_DEPTH / 2]}>
          <boxGeometry args={[BAG_OPENING_MAX, 0.55, 0.55]} />
          <meshStandardMaterial color="#43d9ff" emissive="#1b7fa8" emissiveIntensity={0.8} />
        </mesh>
      </group>

      <Html position={[0, BAG_HEIGHT + 4.5, 0]} center distanceFactor={55} zIndexRange={[10, 0]}>
        <div className="scene-label">
          Bag <span className="scene-label-dim">opening {opening} cm</span>
        </div>
      </Html>
    </group>
  );
}
