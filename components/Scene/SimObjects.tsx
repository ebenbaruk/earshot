"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useFrame } from "@react-three/fiber";
import { Html, RoundedBox } from "@react-three/drei";
import type { Group, Mesh, MeshStandardMaterial } from "three";
import type { ObjectId, WorldState } from "@/lib/types";
import {
  OBJECT_SPECS,
  SPONGE_COMPRESSED_SIZE,
  TAPE_GRASP_OFFSET,
  TAPE_HINT_RADIUS,
  dist,
  effectiveSize,
} from "@/lib/sim/constants";
import { useSimStore } from "@/store/useSimStore";
import { approach, damp } from "./coords";

function spec(id: ObjectId) {
  const s = OBJECT_SPECS.find((o) => o.id === id);
  if (!s) throw new Error(`unknown object ${id}`);
  return s;
}

/** Where the object should sit right now, in three.js coordinates. */
function targetPosition(w: WorldState, id: ObjectId): [number, number, number] {
  const o = w.objects.find((x) => x.id === id);
  if (!o) return [0, 0, 0];
  const size = effectiveSize(o);
  if (o.state === "in_bag") {
    const idx = Math.max(0, w.bag.contents.indexOf(id));
    return [w.bag.pos.x, 1.2 + idx * 2.4, -w.bag.pos.y];
  }
  if (o.state === "held") {
    return [w.gripper.pos.x, w.gripper.z + size.h / 2, -w.gripper.pos.y];
  }
  return [o.pos.x, size.h / 2, -o.pos.y];
}

interface ObjectViewProps {
  id: ObjectId;
  children: ReactNode;
  /** target x/y/z scale, used for the sponge squeeze */
  scale?: [number, number, number];
}

function ObjectView({ id, children, scale = [1, 1, 1] }: ObjectViewProps) {
  const group = useRef<Group>(null);
  const state = useSimStore((s) => s.world.objects.find((o) => o.id === id)?.state ?? "on_table");
  // `rolled_out` only lasts one sim tick; hold the alert styling long enough to be seen.
  const [alert, setAlert] = useState(false);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = useSimStore.subscribe((s) => {
      const next = s.world.objects.find((o) => o.id === id)?.state;
      if (next !== "rolled_out") return;
      setAlert(true);
      clearTimeout(timer);
      timer = setTimeout(() => setAlert(false), 1800);
    });
    return () => {
      unsubscribe();
      clearTimeout(timer);
    };
  }, [id]);

  useFrame((_, dt) => {
    const g = group.current;
    if (!g) return;
    const w = useSimStore.getState().world;
    const [x, y, z] = targetPosition(w, id);
    const k = damp(dt, 14);
    g.position.x = approach(g.position.x, x, k);
    g.position.y = approach(g.position.y, y, k);
    g.position.z = approach(g.position.z, z, k);
    g.scale.x = approach(g.scale.x, scale[0], k);
    g.scale.y = approach(g.scale.y, scale[1], k);
    g.scale.z = approach(g.scale.z, scale[2], k);
  });

  const s = spec(id);
  const labelY = Math.max(s.size.h, 2) + 3.5;

  return (
    <group ref={group}>
      {children}
      <Html position={[0, labelY, 0]} center distanceFactor={55} zIndexRange={[9, 0]}>
        <div className={`scene-label${alert ? " scene-label-alert" : ""}`}>
          {s.label}
          {state !== "on_table" ? <span className="scene-label-dim">{state.replace("_", " ")}</span> : null}
        </div>
      </Html>
    </group>
  );
}

function Sponge() {
  const compressed = useSimStore(
    (s) => s.world.objects.find((o) => o.id === "sponge")?.compressed ?? false,
  );
  const size = spec("sponge").size;
  const scale: [number, number, number] = compressed
    ? [
        SPONGE_COMPRESSED_SIZE.w / size.w,
        SPONGE_COMPRESSED_SIZE.h / size.h,
        SPONGE_COMPRESSED_SIZE.d / size.d,
      ]
    : [1, 1, 1];

  return (
    <ObjectView id="sponge" scale={scale}>
      <RoundedBox args={[size.w, size.h, size.d]} radius={0.35} smoothness={3} castShadow receiveShadow>
        <meshStandardMaterial color="#f5c518" roughness={0.95} metalness={0} />
      </RoundedBox>
    </ObjectView>
  );
}

function TapeHolder() {
  const size = spec("tape_holder").size;
  return (
    <ObjectView id="tape_holder">
      {/* a ring dispenser: the hole is what you can actually hook */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} castShadow receiveShadow>
        <torusGeometry args={[size.w / 2 - 1.2, 1.2, 18, 48]} />
        <meshStandardMaterial color="#3b4049" roughness={0.45} metalness={0.35} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.9, 0]}>
        <torusGeometry args={[size.w / 2 - 1.2, 0.35, 10, 48]} />
        <meshStandardMaterial color="#22262c" roughness={0.7} />
      </mesh>
    </ObjectView>
  );
}

function Marker() {
  const size = spec("marker").size;
  return (
    <ObjectView id="marker">
      {/* long thin cylinder lying along sim +y (three -z) */}
      <mesh rotation={[Math.PI / 2, 0, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[size.w / 2, size.w / 2, size.d, 20]} />
        <meshStandardMaterial color="#3b82f6" roughness={0.4} metalness={0.1} />
      </mesh>
      <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 0, -size.d / 2 + 1]} castShadow>
        <cylinderGeometry args={[size.w / 2 + 0.12, size.w / 2 + 0.12, 2, 20]} />
        <meshStandardMaterial color="#0f1b33" roughness={0.6} />
      </mesh>
    </ObjectView>
  );
}

/** Shows the tape holder's *real* grasp point once the gripper is close enough. */
function TapeGraspHint() {
  const group = useRef<Group>(null);
  const mat = useRef<MeshStandardMaterial>(null);
  const mesh = useRef<Mesh>(null);

  useFrame((state, dt) => {
    const g = group.current;
    if (!g) return;
    const w = useSimStore.getState().world;
    const tape = w.objects.find((o) => o.id === "tape_holder");
    if (!tape) return;
    const close =
      tape.state === "on_table" && dist(w.gripper.pos, tape.pos) < TAPE_HINT_RADIUS;
    const gp = { x: tape.pos.x + TAPE_GRASP_OFFSET.x, y: tape.pos.y + TAPE_GRASP_OFFSET.y };
    const k = damp(dt, 14);
    g.position.x = approach(g.position.x, gp.x, k);
    g.position.z = approach(g.position.z, -gp.y, k);
    g.position.y = 3.8;
    if (mat.current) {
      const pulse = 0.55 + Math.sin(state.clock.elapsedTime * 4) * 0.25;
      mat.current.opacity = approach(mat.current.opacity, close ? pulse : 0, damp(dt, 8));
      mat.current.emissiveIntensity = close ? 1.6 : 0;
    }
    if (mesh.current) mesh.current.visible = (mat.current?.opacity ?? 0) > 0.02;
  });

  return (
    <group ref={group}>
      <mesh ref={mesh} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[1.15, 1.85, 36]} />
        <meshStandardMaterial
          ref={mat}
          color="#7CFFB2"
          emissive="#2fe08a"
          emissiveIntensity={0}
          transparent
          opacity={0}
          depthWrite={false}
          side={2}
        />
      </mesh>
    </group>
  );
}

export function SimObjects() {
  return (
    <group>
      <Sponge />
      <TapeHolder />
      <Marker />
      <TapeGraspHint />
    </group>
  );
}
