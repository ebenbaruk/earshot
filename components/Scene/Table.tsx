"use client";

import { TABLE } from "@/lib/sim/constants";

const THICKNESS = 1.6;

/** Light wooden / matte 60 x 40 cm table plus a dark studio floor. */
export function Table() {
  return (
    <group>
      <mesh position={[0, -THICKNESS / 2, 0]} receiveShadow castShadow>
        <boxGeometry args={[TABLE.w, THICKNESS, TABLE.d]} />
        <meshStandardMaterial color="#c8a173" roughness={0.85} metalness={0.02} />
      </mesh>
      {/* table edge trim */}
      <mesh position={[0, -THICKNESS - 0.15, 0]}>
        <boxGeometry args={[TABLE.w + 0.8, 0.4, TABLE.d + 0.8]} />
        <meshStandardMaterial color="#7d5f3d" roughness={0.9} />
      </mesh>
      {/* studio floor */}
      <mesh position={[0, -14, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[420, 420]} />
        <meshStandardMaterial color="#0c0e14" roughness={1} metalness={0} />
      </mesh>
    </group>
  );
}
