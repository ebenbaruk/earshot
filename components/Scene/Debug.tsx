"use client";

import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import type { Group, Mesh } from "three";
import { effectiveSize } from "@/lib/sim/constants";
import { useSimStore } from "@/store/useSimStore";
import { hand, stepHand } from "./hand";
import { bagDodgeX } from "./layout3d";

const MAX_OBJECTS = 6;

/**
 * Alignment check (preview only): a magenta plumb line through the centre of the
 * finger gap and a cyan one through every resting object's rendered origin. When
 * the engine says the hand is over an object, the two must be the same line.
 */
export function AlignmentGizmo() {
  const hnd = useRef<Group>(null);
  const rods = useRef<Array<Mesh | null>>(Array.from({ length: MAX_OBJECTS }, () => null));

  useFrame((frame, dt) => {
    const w = useSimStore.getState().world;
    stepHand(w, dt, frame.clock.elapsedTime);
    if (hnd.current) hnd.current.position.set(hand.x, 0, hand.z);
    for (let i = 0; i < MAX_OBJECTS; i += 1) {
      const rod = rods.current[i];
      if (!rod) continue;
      const o = w.objects[i];
      const show = !!o && (o.state === "on_table" || o.state === "rolled_out");
      rod.visible = show;
      if (!o || !show) continue;
      const size = effectiveSize(o);
      rod.position.set(
        bagDodgeX(o.pos.x, o.pos.y, size.w / 2, size.d / 2, w.bag.pos),
        6,
        -o.pos.y,
      );
    }
  });

  return (
    <group>
      <group ref={hnd}>
        <mesh position={[0, 11, 0]}>
          <boxGeometry args={[0.09, 22, 0.09]} />
          <meshBasicMaterial color="#ff2fd0" toneMapped={false} />
        </mesh>
      </group>
      {Array.from({ length: MAX_OBJECTS }, (_, i) => (
        <mesh
          key={i}
          ref={(el) => {
            rods.current[i] = el;
          }}
          visible={false}
        >
          <boxGeometry args={[0.05, 12, 0.05]} />
          <meshBasicMaterial color="#2fe8ff" toneMapped={false} />
        </mesh>
      ))}
    </group>
  );
}
