"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  Matrix4,
  Quaternion,
  Vector3,
} from "three";
import type { InstancedMesh, Points } from "three";
import { useSimStore } from "@/store/useSimStore";
import { hand, stepHand } from "./hand";
import { glowTexture } from "./textures";

// --- ghost trail -----------------------------------------------------------

/** One dot every SAMPLE_MS, TRAIL of them: a touch under two seconds of path. */
const TRAIL = 42;
const SAMPLE_MS = 45;
const DOT_R = 0.5;

const mat4 = new Matrix4();
const pos3 = new Vector3();
const scale3 = new Vector3();
const rot0 = new Quaternion();
const tint = new Color();
const TRAIL_HOT = new Color("#ff9a5c");
const TRAIL_COLD = new Color("#101826");

/**
 * Where the hand has been for the last ~2 s, as a fading string of dots at
 * finger height. It makes a move read as a path instead of a teleport, and it
 * is the fastest way for someone watching to see *why* the arm is where it is.
 * Fades out completely when nothing is running.
 */
export function GhostTrail() {
  const mesh = useRef<InstancedMesh>(null);
  const buf = useMemo(
    () => ({
      x: new Float32Array(TRAIL),
      y: new Float32Array(TRAIL),
      z: new Float32Array(TRAIL),
      head: 0,
      count: 0,
      last: -1e9,
      alpha: 0,
    }),
    [],
  );

  useEffect(
    () =>
      useSimStore.subscribe((st) => {
        if (st.world.t === 0 && st.world.status === "idle") {
          buf.count = 0;
          buf.head = 0;
        }
      }),
    [buf],
  );

  /* eslint-disable react-hooks/immutability -- the ring buffer and the instance
     attributes are scratch memory, written in place so the frame allocates nothing. */
  useFrame((frame, dt) => {
    const m = mesh.current;
    if (!m) return;
    const w = useSimStore.getState().world;
    stepHand(w, dt, frame.clock.elapsedTime);
    const now = frame.clock.elapsedTime * 1000;

    const live = w.status === "running" || w.status === "paused";
    buf.alpha += ((live ? 1 : 0) - buf.alpha) * (1 - Math.exp(-Math.min(dt, 0.1) * 4));

    if (now - buf.last >= SAMPLE_MS) {
      buf.last = now;
      buf.x[buf.head] = hand.x;
      buf.y[buf.head] = hand.y;
      buf.z[buf.head] = hand.z;
      buf.head = (buf.head + 1) % TRAIL;
      if (buf.count < TRAIL) buf.count += 1;
    }

    m.visible = buf.alpha > 0.01;
    if (!m.visible) return;

    for (let age = 0; age < TRAIL; age += 1) {
      const i = (buf.head - 1 - age + TRAIL * 2) % TRAIL;
      const on = age < buf.count;
      const k = on ? 1 - age / TRAIL : 0;
      pos3.set(buf.x[i], on ? buf.y[i] : 0, buf.z[i]);
      const s = DOT_R * (0.3 + 0.7 * k) * k * buf.alpha;
      scale3.set(s, s, s);
      mat4.compose(pos3, rot0, scale3);
      m.setMatrixAt(age, mat4);
      tint.copy(TRAIL_COLD).lerp(TRAIL_HOT, k * buf.alpha);
      m.setColorAt(age, tint);
    }
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  });
  /* eslint-enable react-hooks/immutability */

  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, TRAIL]} frustumCulled={false}>
      <sphereGeometry args={[1, 8, 6]} />
      <meshBasicMaterial
        transparent
        opacity={0.75}
        blending={AdditiveBlending}
        depthWrite={false}
        toneMapped={false}
      />
    </instancedMesh>
  );
}

// --- dust ------------------------------------------------------------------

const MOTES = 54;
const MOTE_BOX = { x: 74, y: 30, z: 54 };

/** A few dozen motes drifting through the key light. Pure atmosphere. */
export function DustMotes() {
  const points = useRef<Points>(null);
  const { geometry, drift } = useMemo(() => {
    const arr = new Float32Array(MOTES * 3);
    const speed = new Float32Array(MOTES * 2);
    for (let i = 0; i < MOTES; i += 1) {
      // Deterministic scatter so the shot is identical on every reload.
      const a = Math.sin(i * 12.9898) * 43758.5453;
      const b = Math.sin(i * 78.233) * 12345.6789;
      const c = Math.sin(i * 39.425) * 24634.6345;
      const rx = a - Math.floor(a);
      const ry = b - Math.floor(b);
      const rz = c - Math.floor(c);
      arr[i * 3] = (rx - 0.5) * MOTE_BOX.x - 4;
      arr[i * 3 + 1] = ry * MOTE_BOX.y + 1.5;
      arr[i * 3 + 2] = (rz - 0.5) * MOTE_BOX.z;
      speed[i * 2] = 0.25 + rx * 0.7; // rise
      speed[i * 2 + 1] = rz * Math.PI * 2; // sway phase
    }
    const g = new BufferGeometry();
    g.setAttribute("position", new BufferAttribute(arr, 3));
    return { geometry: g, drift: speed };
  }, []);

  useEffect(() => () => geometry.dispose(), [geometry]);

  useFrame((frame, dt) => {
    const p = points.current;
    if (!p) return;
    const attr = geometry.getAttribute("position") as BufferAttribute;
    const arr = attr.array as Float32Array;
    const step = Math.min(dt, 0.1);
    const t = frame.clock.elapsedTime;
    for (let i = 0; i < MOTES; i += 1) {
      let y = arr[i * 3 + 1] + drift[i * 2] * step;
      if (y > MOTE_BOX.y) y -= MOTE_BOX.y - 1.5;
      arr[i * 3 + 1] = y;
      arr[i * 3] += Math.sin(t * 0.35 + drift[i * 2 + 1]) * step * 0.9;
    }
    attr.needsUpdate = true;
  });

  return (
    <points ref={points} geometry={geometry} frustumCulled={false}>
      <pointsMaterial
        map={glowTexture()}
        color="#ffdcb0"
        size={0.62}
        sizeAttenuation
        transparent
        opacity={0.3}
        blending={AdditiveBlending}
        depthWrite={false}
        toneMapped={false}
      />
    </points>
  );
}
