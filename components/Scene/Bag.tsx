"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Html, RoundedBox } from "@react-three/drei";
import { AdditiveBlending, Color, DoubleSide, MeshStandardMaterial } from "three";
import type { Mesh, MeshBasicMaterial } from "three";
import { BAG_POS } from "@/lib/sim/constants";
import { useSimStore } from "@/store/useSimStore";
import { glowTexture } from "./textures";
import {
  BAG_FLOOR,
  BAG_HEIGHT,
  BAG_INNER_D,
  BAG_INNER_W,
  BAG_OUTER_D,
  BAG_OUTER_W,
  BAG_WALL,
} from "./layout3d";

const RIM_T = 0.34;
const RIM_IDLE = new Color("#4ec2f0");
const RIM_WIN = new Color("#2ef0a0");
const scratch = new Color();

interface WallProps {
  position: [number, number, number];
  args: [number, number, number];
}

/** One frosted polyethylene panel. */
function Wall({ position, args }: WallProps) {
  return (
    <RoundedBox position={position} args={args} radius={0.22} smoothness={2} castShadow>
      <meshPhysicalMaterial
        color="#dff1ff"
        transparent
        opacity={0.17}
        roughness={0.42}
        metalness={0}
        clearcoat={0.7}
        clearcoatRoughness={0.35}
        transmission={0.25}
        thickness={0.6}
        ior={1.45}
        side={DoubleSide}
        depthWrite={false}
        envMapIntensity={0.9}
      />
    </RoundedBox>
  );
}

/**
 * The packing pouch: a translucent, slightly frosted PE box with soft edges,
 * an open top and a thin bright rim. The opening is a constant 12 cm, so there
 * is nothing to animate here — the bag is set dressing that items must clear.
 */
export function Bag() {
  const halfW = BAG_INNER_W / 2 + BAG_WALL / 2;
  const halfD = BAG_INNER_D / 2 + BAG_WALL / 2;
  const wallH = BAG_HEIGHT;

  const halo = useRef<Mesh>(null);
  const haloMat = useRef<MeshBasicMaterial>(null);
  const glow = useMemo(() => glowTexture(), []);
  const rim = useMemo(
    () =>
      new MeshStandardMaterial({
        color: "#bfe9ff",
        emissive: RIM_IDLE.clone(),
        emissiveIntensity: 0.85,
        roughness: 0.3,
        metalness: 0.1,
        toneMapped: false,
      }),
    [],
  );
  useEffect(() => () => rim.dispose(), [rim]);

  /* eslint-disable react-hooks/immutability -- three.js materials are mutable by
     design; the rim is animated in place on the success pulse. */
  useFrame((frame, dt) => {
    const won = useSimStore.getState().world.status === "succeeded";
    const pulse = 0.5 + Math.sin(frame.clock.elapsedTime * 2.6) * 0.5;
    rim.emissive.lerp(won ? RIM_WIN : RIM_IDLE, Math.min(1, dt * 4));
    const wantI = won ? 0.9 + pulse * 1.6 : 0.85;
    rim.emissiveIntensity += (wantI - rim.emissiveIntensity) * Math.min(1, dt * 5);
    rim.color.lerp(scratch.set(won ? "#d6fff0" : "#bfe9ff"), Math.min(1, dt * 4));
    if (haloMat.current) {
      const want = won ? 0.1 + pulse * 0.22 : 0;
      haloMat.current.opacity += (want - haloMat.current.opacity) * Math.min(1, dt * 5);
    }
    if (halo.current) halo.current.visible = (haloMat.current?.opacity ?? 0) > 0.005;
  });
  /* eslint-enable react-hooks/immutability */

  return (
    <group position={[BAG_POS.x, 0, -BAG_POS.y]}>
      {/* floor */}
      <mesh position={[0, BAG_FLOOR / 2, 0]} receiveShadow>
        <boxGeometry args={[BAG_OUTER_W, BAG_FLOOR, BAG_OUTER_D]} />
        <meshPhysicalMaterial
          color="#cfe6f5"
          transparent
          opacity={0.38}
          roughness={0.55}
          metalness={0}
          clearcoat={0.4}
        />
      </mesh>

      {/* four walls */}
      <Wall position={[-halfW, wallH / 2, 0]} args={[BAG_WALL, wallH, BAG_OUTER_D]} />
      <Wall position={[halfW, wallH / 2, 0]} args={[BAG_WALL, wallH, BAG_OUTER_D]} />
      <Wall position={[0, wallH / 2, -halfD]} args={[BAG_INNER_W, wallH, BAG_WALL]} />
      <Wall position={[0, wallH / 2, halfD]} args={[BAG_INNER_W, wallH, BAG_WALL]} />

      {/* the open rim: a thin brighter line all the way round.
          One shared material, so the success pulse is a single write. */}
      <group position={[0, wallH, 0]}>
        {([
          [-halfW, 0, 0, RIM_T, RIM_T, BAG_OUTER_D + RIM_T],
          [halfW, 0, 0, RIM_T, RIM_T, BAG_OUTER_D + RIM_T],
          [0, 0, -halfD, BAG_OUTER_W + RIM_T, RIM_T, RIM_T],
          [0, 0, halfD, BAG_OUTER_W + RIM_T, RIM_T, RIM_T],
        ] as const).map(([x, y, z, w, h, d]) => (
          <mesh key={`${x}:${z}`} position={[x, y, z]} material={rim}>
            <boxGeometry args={[w, h, d]} />
          </mesh>
        ))}
        {/* the pouch breathes green over the mouth once the run is won */}
        <mesh ref={halo} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.4, 0]} renderOrder={2}>
          <planeGeometry args={[BAG_OUTER_W * 2.4, BAG_OUTER_D * 2.2]} />
          <meshBasicMaterial
            ref={haloMat}
            map={glow}
            color="#2ef0a0"
            transparent
            opacity={0}
            blending={AdditiveBlending}
            depthWrite={false}
            side={DoubleSide}
            toneMapped={false}
          />
        </mesh>
      </group>

      {/* a faint seam near the base, so the pouch reads as a folded sheet */}
      <mesh position={[0, BAG_FLOOR + 0.9, 0]}>
        <boxGeometry args={[BAG_OUTER_W + 0.06, 0.12, BAG_OUTER_D + 0.06]} />
        <meshStandardMaterial color="#9fd9f5" transparent opacity={0.3} roughness={0.4} />
      </mesh>

      {/* label parked off to the front-left so the stacked item badges stay clear */}
      <Html
        position={[-(BAG_OUTER_W / 2 + 4.5), 2.2, BAG_OUTER_D / 2 + 2]}
        center
        distanceFactor={62}
        zIndexRange={[8, 0]}
      >
        <div className="scene-label">Bag</div>
      </Html>
    </group>
  );
}
