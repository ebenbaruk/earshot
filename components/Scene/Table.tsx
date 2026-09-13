"use client";

import { useMemo } from "react";
import { AdditiveBlending, DoubleSide, RepeatWrapping } from "three";
import { TABLE } from "@/lib/sim/constants";
import { glowTexture, woodTextures } from "./textures";

const THICKNESS = 2.2;
const FLOOR_Y = -16;
const LEG_INSET = 3.5;
const LEGS: ReadonlyArray<readonly [number, number]> = [
  [-(TABLE.w / 2 - LEG_INSET), -(TABLE.d / 2 - LEG_INSET)],
  [TABLE.w / 2 - LEG_INSET, -(TABLE.d / 2 - LEG_INSET)],
  [-(TABLE.w / 2 - LEG_INSET), TABLE.d / 2 - LEG_INSET],
  [TABLE.w / 2 - LEG_INSET, TABLE.d / 2 - LEG_INSET],
];

/** Warm matte work surface (60 x 40 cm) on a dark studio floor, lit by a soft pool. */
export function Table() {
  const wood = useMemo(() => {
    const { map, roughnessMap } = woodTextures();
    map.repeat.set(1, 0.8);
    map.wrapS = RepeatWrapping;
    map.wrapT = RepeatWrapping;
    roughnessMap.repeat.copy(map.repeat);
    return { map, roughnessMap };
  }, []);

  const glow = useMemo(() => glowTexture(), []);

  return (
    <group>
      {/* work surface */}
      <mesh position={[0, -THICKNESS / 2, 0]} receiveShadow castShadow>
        <boxGeometry args={[TABLE.w, THICKNESS, TABLE.d]} />
        <meshStandardMaterial
          map={wood.map}
          roughnessMap={wood.roughnessMap}
          color="#e8d6bd"
          roughness={0.78}
          metalness={0.02}
          envMapIntensity={0.35}
        />
      </mesh>

      {/* dark edge band so the top reads as a slab, not a decal */}
      <mesh position={[0, -THICKNESS - 0.35, 0]} receiveShadow>
        <boxGeometry args={[TABLE.w + 1.0, 0.7, TABLE.d + 1.0]} />
        <meshStandardMaterial color="#4b392a" roughness={0.9} metalness={0.05} />
      </mesh>

      {/* light pool on the surface: keeps the shot from going flat */}
      <mesh position={[-2, 0.035, 1]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={-1}>
        <planeGeometry args={[74, 54]} />
        <meshBasicMaterial
          map={glow}
          color="#ffe2b8"
          transparent
          opacity={0.2}
          blending={AdditiveBlending}
          depthWrite={false}
          side={DoubleSide}
        />
      </mesh>

      {/* countersunk screws at the corners of the work surface */}
      {LEGS.map(([x, z]) => (
        <group key={`screw:${x}:${z}`} position={[x * 0.92, 0.01, z * 0.86]}>
          <mesh castShadow>
            <cylinderGeometry args={[0.46, 0.5, 0.16, 16]} />
            <meshStandardMaterial color="#8c8577" roughness={0.34} metalness={0.85} />
          </mesh>
          <mesh position={[0, 0.09, 0]} rotation={[0, 0.6, 0]}>
            <boxGeometry args={[0.72, 0.06, 0.14]} />
            <meshStandardMaterial color="#4a4438" roughness={0.5} metalness={0.6} />
          </mesh>
        </group>
      ))}

      {/* legs */}
      {LEGS.map(([x, z]) => (
        <mesh key={`${x}:${z}`} position={[x, (FLOOR_Y - THICKNESS - 0.7) / 2, z]} castShadow>
          <boxGeometry args={[2, FLOOR_Y * -1 - THICKNESS - 0.7, 2]} />
          <meshStandardMaterial color="#3a2c20" roughness={0.85} metalness={0.05} />
        </mesh>
      ))}

      {/* studio floor */}
      <mesh position={[0, FLOOR_Y, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[520, 520]} />
        <meshStandardMaterial color="#0a0c12" roughness={0.95} metalness={0.05} />
      </mesh>

      {/* floor bounce under the table, so the slab doesn't float in a void */}
      <mesh position={[0, FLOOR_Y + 0.05, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[190, 150]} />
        <meshBasicMaterial
          map={glow}
          color="#2b3450"
          transparent
          opacity={0.5}
          blending={AdditiveBlending}
          depthWrite={false}
        />
      </mesh>
    </group>
  );
}
