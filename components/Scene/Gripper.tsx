"use client";

import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import type { Group, Mesh } from "three";
import { TABLE, effectiveSize } from "@/lib/sim/constants";
import { useSimStore } from "@/store/useSimStore";
import { approach, damp } from "./coords";

const RAIL_Y = 20;
const RAIL_Z = TABLE.d / 2 - 1;
const FINGER_H = 3.2;

/** Gantry: two rails + a carriage + two finger blocks whose gap is `gripper.width`. */
export function Gripper() {
  const carriage = useRef<Group>(null);
  const trolley = useRef<Group>(null);
  const post = useRef<Mesh>(null);
  const head = useRef<Group>(null);
  const fingerL = useRef<Mesh>(null);
  const fingerR = useRef<Mesh>(null);
  const spotlight = useRef<Mesh>(null);

  useFrame((_, dt) => {
    const w = useSimStore.getState().world;
    const k = damp(dt, 14);

    if (carriage.current) carriage.current.position.x = approach(carriage.current.position.x, w.gripper.pos.x, k);
    if (trolley.current) trolley.current.position.z = approach(trolley.current.position.z, -w.gripper.pos.y, k);

    const headY = w.gripper.z + FINGER_H / 2;
    if (head.current) head.current.position.y = approach(head.current.position.y, headY, k);

    if (post.current) {
      const top = RAIL_Y - 1;
      const bottom = head.current ? head.current.position.y + FINGER_H / 2 : headY;
      const len = Math.max(0.5, top - bottom);
      post.current.scale.y = len;
      post.current.position.y = (top + bottom) / 2;
    }

    const holding = w.gripper.holding
      ? w.objects.find((o) => o.id === w.gripper.holding)
      : null;
    const gap = holding ? effectiveSize(holding).w : w.gripper.width;
    if (fingerL.current) fingerL.current.position.x = approach(fingerL.current.position.x, -gap / 2 - 0.4, k);
    if (fingerR.current) fingerR.current.position.x = approach(fingerR.current.position.x, gap / 2 + 0.4, k);

    if (spotlight.current) {
      const s = approach(spotlight.current.scale.x, 1 + w.gripper.z * 0.06, k);
      spotlight.current.scale.set(s, s, s);
    }
  });

  return (
    <group>
      {/* rails */}
      {[RAIL_Z, -RAIL_Z].map((z) => (
        <mesh key={z} position={[0, RAIL_Y, z]} castShadow>
          <boxGeometry args={[TABLE.w + 6, 1.1, 1.1]} />
          <meshStandardMaterial color="#8d97a8" roughness={0.35} metalness={0.75} />
        </mesh>
      ))}
      {/* rail legs */}
      {[
        [-(TABLE.w / 2 + 2), RAIL_Z],
        [TABLE.w / 2 + 2, RAIL_Z],
        [-(TABLE.w / 2 + 2), -RAIL_Z],
        [TABLE.w / 2 + 2, -RAIL_Z],
      ].map(([x, z]) => (
        <mesh key={`${x}:${z}`} position={[x, RAIL_Y / 2 - 7, z]}>
          <boxGeometry args={[1.2, RAIL_Y + 14, 1.2]} />
          <meshStandardMaterial color="#5b6474" roughness={0.5} metalness={0.6} />
        </mesh>
      ))}

      {/* carriage rides along x */}
      <group ref={carriage}>
        <mesh position={[0, RAIL_Y, 0]} castShadow>
          <boxGeometry args={[2.2, 1.6, TABLE.d]} />
          <meshStandardMaterial color="#aab4c6" roughness={0.3} metalness={0.8} />
        </mesh>

        {/* trolley rides along y */}
        <group ref={trolley}>
          <mesh position={[0, RAIL_Y, 0]} castShadow>
            <boxGeometry args={[3.4, 2.6, 3.4]} />
            <meshStandardMaterial color="#e2e8f2" roughness={0.25} metalness={0.7} />
          </mesh>

          <mesh ref={post} position={[0, RAIL_Y / 2, 0]} castShadow>
            <boxGeometry args={[1.1, 1, 1.1]} />
            <meshStandardMaterial color="#cbd5e1" roughness={0.3} metalness={0.7} />
          </mesh>

          {/* the hand */}
          <group ref={head} position={[0, 8, 0]}>
            <mesh castShadow>
              <boxGeometry args={[4.5, 1.4, 3]} />
              <meshStandardMaterial color="#f1f5f9" roughness={0.3} metalness={0.5} />
            </mesh>
            <mesh ref={fingerL} position={[-3.4, -FINGER_H / 2, 0]} castShadow>
              <boxGeometry args={[0.8, FINGER_H, 2.6]} />
              <meshStandardMaterial color="#ff8a4c" roughness={0.4} metalness={0.2} />
            </mesh>
            <mesh ref={fingerR} position={[3.4, -FINGER_H / 2, 0]} castShadow>
              <boxGeometry args={[0.8, FINGER_H, 2.6]} />
              <meshStandardMaterial color="#ff8a4c" roughness={0.4} metalness={0.2} />
            </mesh>
          </group>

          {/* target marker on the table */}
          <mesh ref={spotlight} position={[0, 0.06, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <ringGeometry args={[1.4, 1.9, 40]} />
            <meshBasicMaterial color="#ff8a4c" transparent opacity={0.45} depthWrite={false} />
          </mesh>
        </group>
      </group>
    </group>
  );
}
