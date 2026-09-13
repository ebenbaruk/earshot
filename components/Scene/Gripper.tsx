"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { AdditiveBlending, Color, DoubleSide } from "three";
import type { Group, Mesh, MeshBasicMaterial, MeshStandardMaterial } from "three";
import { TABLE, effectiveSize } from "@/lib/sim/constants";
import { useSimStore } from "@/store/useSimStore";
import { Spring } from "./coords";
import {
  BAG_HEIGHT,
  BAG_KEEPOUT,
  BAG_OUTER_D,
  FINGER_D,
  FINGER_H,
  FINGER_T,
  HEAD_H,
  RAIL_Y,
} from "./layout3d";
import { glowTexture } from "./textures";

/** Rails run front-to-back just outside the table; the bridge spans them. */
const RAIL_X = TABLE.w / 2 + 5;
const RAIL_LEN = TABLE.d + 12;
const LEG_Z = TABLE.d / 2 + 3;
const FLOOR_Y = -16;
const COLUMN_TOP = RAIL_Y - 1.3;

const LED_RUN = new Color("#37e08a");
const LED_PAUSE = new Color("#ffb02e");
const LED_IDLE = new Color("#2c3b4a");

/**
 * Gantry gripper: two side rails, a bridge that rides front-to-back (z), a trolley
 * that rides along the bridge (x), a telescoping column and a two-finger hand.
 *
 * Contract: the finger TIPS are at `gripper.z` above the table. Everything else
 * (finger blocks, wrist, column) stacks upward from there, so nothing can ever
 * reach the table top or dip below the bag rim at any legal z.
 */
export function Gripper() {
  const bridge = useRef<Group>(null);
  const trolley = useRef<Group>(null);
  const column = useRef<Mesh>(null);
  const head = useRef<Group>(null);
  const fingerL = useRef<Group>(null);
  const fingerR = useRef<Group>(null);
  const pool = useRef<Mesh>(null);
  const poolMat = useRef<MeshBasicMaterial>(null);
  const led = useRef<MeshStandardMaterial>(null);

  const glow = useMemo(() => glowTexture(), []);
  const springs = useMemo(
    () => ({
      // a touch under-damped: the carriage overshoots ~1 % and settles
      x: new Spring(useSimStore.getState().world.gripper.pos.x, 15, 0.78),
      y: new Spring(-useSimStore.getState().world.gripper.pos.y, 15, 0.78),
      z: new Spring(useSimStore.getState().world.gripper.z, 19, 0.88),
      gap: new Spring(useSimStore.getState().world.gripper.width, 24, 1),
    }),
    [],
  );

  useFrame((state, dt) => {
    const w = useSimStore.getState().world;
    const g = w.gripper;

    // Below the rim the hand steps around the pouch instead of through it —
    // the same shift the rolled-out marker gets, so the grasp stays centred.
    let aimX = g.pos.x;
    const dxBag = g.pos.x - w.bag.pos.x;
    if (
      g.z < BAG_HEIGHT &&
      Math.abs(dxBag) < BAG_KEEPOUT &&
      Math.abs(g.pos.y - w.bag.pos.y) < BAG_OUTER_D / 2 + 6
    ) {
      aimX = w.bag.pos.x + (dxBag < 0 ? -BAG_KEEPOUT : BAG_KEEPOUT);
    }

    const x = springs.x.step(aimX, dt);
    const z3 = springs.y.step(-g.pos.y, dt);
    const tipY = springs.z.step(g.z, dt);

    // Fingers pinch to the object's footprint the moment it is held.
    const holdingObj = g.holding ? w.objects.find((o) => o.id === g.holding) : undefined;
    const gap = holdingObj ? effectiveSize(holdingObj).w : g.width;
    springs.gap.tune(g.holding ? 34 : 24, 1);
    const half = springs.gap.step(gap, dt) / 2 + FINGER_T / 2;

    // bridge travels in z, trolley travels in x along the bridge
    if (bridge.current) bridge.current.position.z = z3;
    if (trolley.current) trolley.current.position.x = x;
    if (head.current) head.current.position.y = tipY;
    if (fingerL.current) fingerL.current.position.x = -half;
    if (fingerR.current) fingerR.current.position.x = half;

    if (column.current) {
      const bottom = tipY + FINGER_H + HEAD_H;
      const len = Math.max(0.6, COLUMN_TOP - bottom);
      column.current.scale.y = len;
      column.current.position.y = bottom + len / 2;
    }

    // Soft pool of light on the table marking where the hand will land.
    if (pool.current && poolMat.current) {
      pool.current.position.x = x;
      pool.current.position.z = z3;
      const spread = 5 + tipY * 0.42;
      pool.current.scale.set(spread, spread, 1);
      poolMat.current.opacity = 0.34 - Math.min(0.2, tipY * 0.011);
    }

    if (led.current) {
      const target =
        w.status === "paused" ? LED_PAUSE : w.status === "running" ? LED_RUN : LED_IDLE;
      led.current.color.lerp(target, 0.14);
      led.current.emissive.lerp(target, 0.14);
      led.current.emissiveIntensity =
        w.status === "paused" ? 1.6 + Math.sin(state.clock.elapsedTime * 6) * 0.5 : 1.4;
    }
  });

  return (
    <group>
      {/* rails run along z, outside the table on either side */}
      {[RAIL_X, -RAIL_X].map((x) => (
        <mesh key={x} position={[x, RAIL_Y, 0]} castShadow>
          <boxGeometry args={[1.3, 1.3, RAIL_LEN]} />
          <meshStandardMaterial color="#7a8496" roughness={0.34} metalness={0.85} />
        </mesh>
      ))}
      {/* rail legs */}
      {[
        [-RAIL_X, LEG_Z],
        [RAIL_X, LEG_Z],
        [-RAIL_X, -LEG_Z],
        [RAIL_X, -LEG_Z],
      ].map(([x, z]) => (
        <group key={`${x}:${z}`}>
          <mesh position={[x, (RAIL_Y + FLOOR_Y) / 2, z]} castShadow>
            <boxGeometry args={[1.3, RAIL_Y - FLOOR_Y, 1.3]} />
            <meshStandardMaterial color="#333b47" roughness={0.5} metalness={0.7} />
          </mesh>
          <mesh position={[x, FLOOR_Y + 0.5, z]} receiveShadow>
            <boxGeometry args={[3.2, 0.8, 3.2]} />
            <meshStandardMaterial color="#2a313b" roughness={0.6} metalness={0.5} />
          </mesh>
        </group>
      ))}

      {/* the bridge spans x and rides along z, so it always sits above the hand
          instead of cutting across it from the camera's three-quarter view */}
      <group ref={bridge}>
        <mesh position={[0, RAIL_Y, 0]} castShadow>
          <boxGeometry args={[RAIL_X * 2 + 1.4, 1.5, 2.0]} />
          <meshStandardMaterial color="#9aa4b6" roughness={0.3} metalness={0.85} />
        </mesh>

        {/* trolley rides along x */}
        <group ref={trolley}>
          <mesh position={[0, RAIL_Y, 0]} castShadow>
            <boxGeometry args={[4.4, 3.0, 4.4]} />
            <meshStandardMaterial color="#c3ccdb" roughness={0.24} metalness={0.8} />
          </mesh>
          <mesh position={[0, RAIL_Y - 1.65, 0]} castShadow>
            <boxGeometry args={[3.2, 0.45, 3.2]} />
            <meshStandardMaterial color="#39414f" roughness={0.5} metalness={0.6} />
          </mesh>

          {/* telescoping column — scaled between the trolley and the wrist */}
          <mesh ref={column} position={[0, RAIL_Y / 2, 0]} castShadow>
            <boxGeometry args={[1.4, 1, 1.4]} />
            <meshStandardMaterial color="#aeb8c8" roughness={0.22} metalness={0.9} />
          </mesh>

          {/* the hand — origin sits at the finger TIPS */}
          <group ref={head} position={[0, 16, 0]}>
            {/* wrist block, directly above the fingers */}
            <mesh position={[0, FINGER_H + HEAD_H / 2, 0]} castShadow>
              <boxGeometry args={[6.0, HEAD_H, 4.0]} />
              <meshStandardMaterial color="#525c6d" roughness={0.3} metalness={0.85} />
            </mesh>
            <mesh position={[0, FINGER_H + HEAD_H + 0.35, 0]} castShadow>
              <boxGeometry args={[4.4, 0.7, 3.0]} />
              <meshStandardMaterial color="#3a4351" roughness={0.4} metalness={0.7} />
            </mesh>
            {/* status LED on the wrist */}
            <mesh position={[0, FINGER_H + HEAD_H / 2, 2.2]}>
              <sphereGeometry args={[0.42, 14, 12]} />
              <meshStandardMaterial
                ref={led}
                color="#2c3b4a"
                emissive="#2c3b4a"
                emissiveIntensity={1.2}
                roughness={0.25}
                toneMapped={false}
              />
            </mesh>

            <group ref={fingerL} position={[-3, 0, 0]}>
              <Finger />
            </group>
            <group ref={fingerR} position={[3, 0, 0]}>
              <Finger flip />
            </group>
          </group>
        </group>
      </group>

      {/* landing pool on the table */}
      <mesh ref={pool} position={[0, 0.05, 0]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={1}>
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial
          ref={poolMat}
          map={glow}
          color="#ff9a5c"
          transparent
          opacity={0.3}
          blending={AdditiveBlending}
          depthWrite={false}
          side={DoubleSide}
        />
      </mesh>
    </group>
  );
}

/** One finger: dark metal carrier with an orange grip pad on the inside face. */
function Finger({ flip = false }: { flip?: boolean }) {
  const sign = flip ? -1 : 1;
  return (
    <group>
      <mesh position={[0, FINGER_H / 2, 0]} castShadow>
        <boxGeometry args={[FINGER_T, FINGER_H, FINGER_D]} />
        <meshStandardMaterial
          color="#ff8a4c"
          emissive="#5e2409"
          emissiveIntensity={0.25}
          roughness={0.42}
          metalness={0.35}
        />
      </mesh>
      {/* rubber grip pad facing inwards */}
      <mesh position={[(sign * FINGER_T) / 2, FINGER_H / 2 - 0.3, 0]} castShadow>
        <boxGeometry args={[0.26, FINGER_H - 1.0, FINGER_D - 0.6]} />
        <meshStandardMaterial color="#23272e" roughness={0.85} metalness={0.05} />
      </mesh>
      {/* knuckle where the finger bolts to the wrist */}
      <mesh position={[0, FINGER_H + 0.2, 0]} castShadow>
        <boxGeometry args={[FINGER_T + 0.5, 0.5, FINGER_D + 0.3]} />
        <meshStandardMaterial color="#4a5462" roughness={0.35} metalness={0.8} />
      </mesh>
    </group>
  );
}
