"use client";

import { RoundedBox } from "@react-three/drei";
import { TABLE } from "@/lib/sim/constants";

const THICKNESS = 2.2;
const FLOOR_Y = -16;
const LEGS = [-1, 1].flatMap(x => [-1, 1].map(z => [x * (TABLE.w / 2 - 3.5), z * (TABLE.d / 2 - 3.5)]));

/** Visual workbench only. The top remains at y=0 with the simulation's dimensions. */
export function Table() {
  return <group>
    <RoundedBox args={[TABLE.w, THICKNESS, TABLE.d]} radius={0.5} smoothness={3} position={[0, -THICKNESS / 2, 0]} receiveShadow castShadow>
      <meshStandardMaterial color="#9da6b4" roughness={0.65} metalness={0.22} />
    </RoundedBox>
    <RoundedBox args={[TABLE.w + 1, 0.8, TABLE.d + 1]} radius={0.25} smoothness={2} position={[0, -THICKNESS - 0.4, 0]} receiveShadow castShadow>
      <meshStandardMaterial color="#242d3c" roughness={0.4} metalness={0.7} />
    </RoundedBox>
    {/* Etched reference grid, flush with the work surface. */}
    {Array.from({ length: 11 }, (_, i) => (i - 5) * 5).map(x => <mesh key={`x${x}`} position={[x, 0.013, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[0.025, TABLE.d - 3]} /><meshStandardMaterial color="#5c6d85" roughness={0.8} transparent opacity={0.35} />
    </mesh>)}
    {Array.from({ length: 7 }, (_, i) => (i - 3) * 5).map(z => <mesh key={`z${z}`} position={[0, 0.014, z]} rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[TABLE.w - 3, 0.025]} /><meshStandardMaterial color="#5c6d85" roughness={0.8} transparent opacity={0.35} />
    </mesh>)}
    {/* Calibration ticks along the front edge. */}
    {Array.from({ length: 29 }, (_, i) => i - 14).map(i => <mesh key={`tick${i}`} position={[i * 2, 0.025, TABLE.d / 2 - 1.2]} rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[0.07, i % 5 === 0 ? 0.7 : 0.3]} /><meshStandardMaterial color="#576880" roughness={0.7} />
    </mesh>)}
    {LEGS.map(([x, z]) => <group key={`${x}:${z}`}>
      <mesh position={[x, 0.035, z]} receiveShadow>
        <cylinderGeometry args={[0.4, 0.4, 0.12, 24]} /><meshStandardMaterial color="#d4dce8" roughness={0.24} metalness={0.95} />
      </mesh>
      <mesh position={[x, 0.1, z]}><cylinderGeometry args={[0.17, 0.17, 0.02, 6]} /><meshStandardMaterial color="#43516a" metalness={0.7} roughness={0.4} /></mesh>
      <mesh position={[x, (FLOOR_Y - THICKNESS - 0.8) / 2, z]} castShadow><boxGeometry args={[2, -FLOOR_Y - THICKNESS - 0.8, 2]} /><meshStandardMaterial color="#657489" roughness={0.36} metalness={0.75} /></mesh>
      <mesh position={[x, FLOOR_Y + 0.6, z]} castShadow><cylinderGeometry args={[1.6, 1.8, 1.2, 24]} /><meshStandardMaterial color="#151c27" roughness={0.9} /></mesh>
    </group>)}
    <mesh position={[0, FLOOR_Y, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
      <planeGeometry args={[520, 520]} /><meshStandardMaterial color="#11151e" roughness={0.85} metalness={0.12} />
    </mesh>
  </group>;
}
