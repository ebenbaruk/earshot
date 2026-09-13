"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { AdditiveBlending, Color, DoubleSide, MeshStandardMaterial } from "three";
import type { Group, Mesh, MeshBasicMaterial } from "three";
import { TABLE } from "@/lib/sim/constants";
import { useSimStore } from "@/store/useSimStore";
import { hand, resetHand, stepHand } from "./hand";
import { FINGER_D, FINGER_H, FINGER_T, HEAD_H, RAIL_Y } from "./layout3d";
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
const LED_WIN = new Color("#42f0a0");
const WHITE = new Color("#ffffff");
const PAD_EMBER = new Color("#5e2409");
const PAD_HOLD = new Color("#7a4a06");

/** Links in the cable chain that trails the carriage along the bridge. */
const CHAIN = 9;
const CHAIN_FROM = -RAIL_X + 2.2;

/** How fast the stop flash decays (1 -> 0), and the success pulse window. */
const FLASH_RATE = 5.5;
const WIN_MS = 3200;

const scratch = new Color();

/**
 * Gantry gripper: two side rails, a bridge that rides front-to-back (z), a trolley
 * that rides along the bridge (x), a telescoping column and a two-finger hand.
 *
 * Contract: the finger TIPS are at `gripper.z` above the table. Everything else
 * (finger blocks, wrist, column) stacks upward from there, so nothing can ever
 * reach the table top or dip below the bag rim at any legal z. The smoothed pose
 * itself lives in `hand.ts`, shared with whatever the gripper is holding.
 */
export function Gripper() {
  const bridge = useRef<Group>(null);
  const trolley = useRef<Group>(null);
  const column = useRef<Mesh>(null);
  const head = useRef<Group>(null);
  const fingerL = useRef<Group>(null);
  const fingerR = useRef<Group>(null);
  const chain = useRef<Array<Mesh | null>>(Array.from({ length: CHAIN }, () => null));
  const pool = useRef<Mesh>(null);
  const poolMat = useRef<MeshBasicMaterial>(null);
  const led = useRef<MeshStandardMaterial>(null);

  const glow = useMemo(() => glowTexture(), []);
  /** One material for both fingers so the stop flash is a single write. */
  const padMat = useMemo(
    () =>
      new MeshStandardMaterial({
        color: "#ff8a4c",
        emissive: new Color("#5e2409"),
        emissiveIntensity: 0.25,
        roughness: 0.42,
        metalness: 0.35,
      }),
    [],
  );
  useEffect(() => () => padMat.dispose(), [padMat]);

  const fx = useRef({ flash: 0, prevStatus: "idle" as string, winT: 0 });

  // Snap the hand to the start pose whenever the world is re-seeded.
  useEffect(() => {
    resetHand(useSimStore.getState().world);
    return useSimStore.subscribe((st) => {
      if (st.world.t === 0 && st.world.status === "idle") resetHand(st.world);
    });
  }, []);

  /* eslint-disable react-hooks/immutability -- three.js materials are mutable
     by design; the finger pads and the LED are animated in place every frame. */
  useFrame((state, dt) => {
    const w = useSimStore.getState().world;
    stepHand(w, dt, state.clock.elapsedTime);

    const f = fx.current;
    if (w.status !== f.prevStatus) {
      if (w.status === "paused") f.flash = 1;
      if (w.status === "succeeded") f.winT = 0;
      f.prevStatus = w.status;
    }
    f.flash = Math.max(0, f.flash - dt * FLASH_RATE);
    const winning = w.status === "succeeded";
    f.winT = winning ? Math.min(WIN_MS, f.winT + dt * 1000) : 0;

    // bridge travels in z, trolley travels in x along the bridge
    if (bridge.current) bridge.current.position.z = hand.z;
    if (trolley.current) trolley.current.position.x = hand.x;
    if (head.current) head.current.position.y = hand.y;
    if (fingerL.current) fingerL.current.position.x = -hand.half;
    if (fingerR.current) fingerR.current.position.x = hand.half;

    if (column.current) {
      const bottom = hand.y + FINGER_H + HEAD_H;
      const len = Math.max(0.6, COLUMN_TOP - bottom);
      column.current.scale.y = len;
      column.current.position.y = bottom + len / 2;
    }

    // Cable chain: drapes from the rail end to wherever the carriage is.
    for (let i = 0; i < CHAIN; i += 1) {
      const link = chain.current[i];
      if (!link) continue;
      const t = i / (CHAIN - 1);
      link.position.x = CHAIN_FROM + (hand.x - CHAIN_FROM) * t;
      link.position.y = RAIL_Y + 2.4 - Math.sin(Math.PI * t) * 0.85;
      link.rotation.z = Math.cos(Math.PI * t) * 0.16;
    }

    // Soft pool of light on the table marking where the hand will land.
    if (pool.current && poolMat.current) {
      pool.current.position.x = hand.x;
      pool.current.position.z = hand.z;
      const spread = 5 + hand.y * 0.42;
      pool.current.scale.set(spread, spread, 1);
      poolMat.current.opacity = 0.34 - Math.min(0.2, hand.y * 0.011);
    }

    // Fingers: a dull ember normally, bleached white for an instant on a stop,
    // then held at a warm amber for as long as the run stays paused.
    const held = w.status === "paused" ? PAD_HOLD : PAD_EMBER;
    padMat.emissive.lerp(scratch.copy(held).lerp(WHITE, f.flash), 0.45);
    padMat.emissiveIntensity = 0.25 + f.flash * 3.6 + (w.status === "paused" ? 0.4 : 0);

    if (led.current) {
      const base =
        w.status === "paused"
          ? LED_PAUSE
          : winning
            ? LED_WIN
            : w.status === "running"
              ? LED_RUN
              : LED_IDLE;
      scratch.copy(base).lerp(WHITE, f.flash);
      led.current.color.lerp(scratch, 0.3);
      led.current.emissive.lerp(scratch, 0.3);
      const clock = state.clock.elapsedTime;
      led.current.emissiveIntensity =
        f.flash * 9 +
        (w.status === "paused"
          ? 1.6 + Math.sin(clock * 6) * 0.5
          : winning
            ? 2.2 + Math.sin(clock * 3.2) * 1.1
            : 1.4);
    }
  });
  /* eslint-enable react-hooks/immutability */

  return (
    <group>
      {/* rails run along z, outside the table on either side */}
      {[RAIL_X, -RAIL_X].map((x) => (
        <group key={x}>
          <mesh position={[x, RAIL_Y, 0]} castShadow>
            <boxGeometry args={[1.3, 1.3, RAIL_LEN]} />
            <meshStandardMaterial color="#7a8496" roughness={0.34} metalness={0.85} />
          </mesh>
          {/* end caps, so the rails read as machined stock and not as cut lines */}
          {[RAIL_LEN / 2, -RAIL_LEN / 2].map((z) => (
            <mesh key={z} position={[x, RAIL_Y, z]} castShadow>
              <boxGeometry args={[1.9, 1.9, 0.5]} />
              <meshStandardMaterial color="#39414f" roughness={0.42} metalness={0.75} />
            </mesh>
          ))}
        </group>
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
          {/* safety stripe round the foot */}
          <mesh position={[x, FLOOR_Y + 1.05, z]}>
            <boxGeometry args={[3.26, 0.26, 3.26]} />
            <meshStandardMaterial
              color="#d8a319"
              emissive="#3a2a02"
              emissiveIntensity={0.4}
              roughness={0.55}
              metalness={0.2}
            />
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

        {/* cable chain: follows the carriage along the bridge */}
        {Array.from({ length: CHAIN }, (_, i) => (
          <mesh
            key={i}
            ref={(el) => {
              chain.current[i] = el;
            }}
            position={[CHAIN_FROM, RAIL_Y + 2.4, 0]}
            castShadow
          >
            <boxGeometry args={[1.35, 0.62, 1.1]} />
            <meshStandardMaterial
              color={i % 2 ? "#2b313c" : "#3a4250"}
              roughness={0.62}
              metalness={0.25}
            />
          </mesh>
        ))}

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
          {/* air hose stub off the back of the carriage */}
          <mesh position={[0, RAIL_Y + 1.1, -2.4]} rotation={[0.9, 0, 0]} castShadow>
            <cylinderGeometry args={[0.26, 0.26, 2.6, 10]} />
            <meshStandardMaterial color="#1d222b" roughness={0.8} metalness={0.1} />
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
              <Finger material={padMat} />
            </group>
            <group ref={fingerR} position={[3, 0, 0]}>
              <Finger material={padMat} flip />
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
function Finger({ material, flip = false }: { material: MeshStandardMaterial; flip?: boolean }) {
  const sign = flip ? -1 : 1;
  return (
    <group>
      <mesh position={[0, FINGER_H / 2, 0]} material={material} castShadow>
        <boxGeometry args={[FINGER_T, FINGER_H, FINGER_D]} />
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
