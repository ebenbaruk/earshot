"use client";

import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { useFrame } from "@react-three/fiber";
import { Html, RoundedBox } from "@react-three/drei";
import { AdditiveBlending, DoubleSide, RepeatWrapping } from "three";
import type { Group, Mesh, MeshBasicMaterial } from "three";
import type { ObjectId, ObjectState, WorldState } from "@/lib/types";
import {
  BAG_HEIGHT,
  OBJECT_SPECS,
  ROLLOUT_MS,
  SPONGE_COMPRESSED_SIZE,
  TAPE_GRASP_OFFSET,
  TAPE_HINT_RADIUS,
  dist,
  effectiveSize,
} from "@/lib/sim/constants";
import { useSimStore } from "@/store/useSimStore";
import { Spring, Spring3, clamp01, easeInQuad, easeOutCubic, lerp } from "./coords";
import {
  BAG_FLOOR,
  BAG_OFFSET,
  BAG_KEEPOUT,
  BAG_OUTER_D,
  BAG_STACK_ORDER,
  BAG_YAW,
  bagKeepout,
  restOffset,
  visualHeight,
} from "./layout3d";
import { glowTexture, haloTexture, spongeRoughness } from "./textures";

/** How long a released item takes to fall into its slot in the bag. */
const DROP_MS = 350;
/** How long the "rolled out" badge stays up after the marker settles. */
const ALERT_LINGER_MS = 1500;
/** Extra label height per item already stacked under this one, in cm. */
const LABEL_STACK_GAP = 3.0;
/** Sideways label offset per object, so two labels rarely land on each other. */
const LABEL_OFFSET_X: Record<ObjectId, number> = {
  marker: 2.6,
  tape_holder: 0,
  sponge: -2.6,
};
/** Wobble after a slipped grasp. */
const SLIP_MS = 700;
/** Peak height of the roll-out arc, just over the rim. */
const ROLL_PEAK = BAG_HEIGHT + 2;

function spec(id: ObjectId) {
  const s = OBJECT_SPECS.find((o) => o.id === id);
  if (!s) throw new Error(`unknown object ${id}`);
  return s;
}

// Scratch target, written every frame instead of allocating.
const target = { x: 0, y: 0, z: 0, yaw: 0, slot: 0, rawX: 0 };

/** Where the object should sit right now, in three.js coordinates. */
function writeTarget(w: WorldState, id: ObjectId): void {
  const o = w.objects.find((x) => x.id === id);
  if (!o) return;
  const half = restOffset(o);

  if (o.state === "in_bag") {
    let top = BAG_FLOOR;
    let slot = 0;
    for (let i = 0; i < BAG_STACK_ORDER.length; i += 1) {
      const oid = BAG_STACK_ORDER[i];
      const other = w.objects.find((x) => x.id === oid);
      if (!other || other.state !== "in_bag") continue;
      if (oid === id) break;
      top += visualHeight(other);
      slot += 1;
    }
    target.slot = slot;
    const off = BAG_OFFSET[id];
    target.x = w.bag.pos.x + off.x;
    target.y = top + half;
    target.z = -(w.bag.pos.y + off.y);
    target.yaw = BAG_YAW[id];
    target.rawX = target.x;
    return;
  }

  target.slot = 0;
  if (o.state === "held") {
    // Mirror the hand's own bag keep-out so a held item never drifts off the pads.
    const dxHand = w.gripper.pos.x - w.bag.pos.x;
    const dodging =
      w.gripper.z < BAG_HEIGHT &&
      Math.abs(dxHand) < BAG_KEEPOUT &&
      Math.abs(w.gripper.pos.y - w.bag.pos.y) < BAG_OUTER_D / 2 + 6;
    target.x = dodging
      ? w.bag.pos.x + (dxHand < 0 ? -BAG_KEEPOUT : BAG_KEEPOUT)
      : w.gripper.pos.x;
    target.y = w.gripper.z + half;
    target.z = -w.gripper.pos.y;
    target.yaw = 0;
    target.rawX = target.x;
    return;
  }

  target.x = o.pos.x;
  target.rawX = o.pos.x;
  target.y = half;
  target.z = -o.pos.y;
  target.yaw = 0;

  // Keep anything resting inside the bag's shell clear of it (see BAG_KEEPOUT).
  const size = effectiveSize(o);
  const clear = bagKeepout(size.w / 2);
  const dx = o.pos.x - w.bag.pos.x;
  const near = Math.abs(o.pos.y - w.bag.pos.y) < BAG_OUTER_D / 2 + size.d / 2;
  if (near && Math.abs(dx) < clear) {
    target.x = w.bag.pos.x + (dx < 0 ? -clear : clear);
  }
}

type Phase = "rest" | "drop" | "roll";

interface Motion {
  phase: Phase;
  /** ms elapsed in the current phase */
  t: number;
  prevState: ObjectState;
  fromX: number;
  fromY: number;
  fromZ: number;
  arc: number;
  roll: number;
  wobble: number;
  wobbleT: number;
  prevFailures: number;
  alertUntil: number;
}

interface ObjectViewProps {
  id: ObjectId;
  children: ReactNode;
  /** target x/y/z scale, used for the sponge squeeze */
  scaleX?: number;
  scaleY?: number;
  scaleZ?: number;
}

function ObjectView({ id, children, scaleX = 1, scaleY = 1, scaleZ = 1 }: ObjectViewProps) {
  const outer = useRef<Group>(null);
  const inner = useRef<Group>(null);
  const badge = useRef<HTMLDivElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const labelGroup = useRef<Group>(null);

  const s = spec(id);

  const pos = useMemo(() => {
    const w = useSimStore.getState().world;
    writeTarget(w, id);
    return new Spring3(target.x, target.y, target.z, 20, 1);
  }, [id]);

  const labelY = Math.max(s.size.h, 2.4) + 4.4;
  const yaw = useMemo(() => new Spring(0, 14, 1), []);
  const labelSpring = useMemo(() => new Spring(labelY, 12, 1), [labelY]);
  const scale = useMemo(() => new Spring3(1, 1, 1, 26, 0.55), []);

  const m = useRef<Motion>({
    phase: "rest",
    t: 0,
    prevState: "on_table",
    fromX: 0,
    fromY: 0,
    fromZ: 0,
    arc: 0,
    roll: 0,
    wobble: 0,
    wobbleT: 0,
    prevFailures: 0,
    alertUntil: 0,
  });

  // Reset the visual state whenever the world is re-seeded.
  useEffect(() => {
    const unsub = useSimStore.subscribe((st) => {
      if (st.world.t !== 0 || st.world.status !== "idle") return;
      writeTarget(st.world, id);
      pos.reset(target.x, target.y, target.z);
      yaw.reset(0);
      scale.reset(1, 1, 1);
      m.current.phase = "rest";
      m.current.roll = 0;
      m.current.wobble = 0;
      m.current.alertUntil = 0;
      m.current.prevState = "on_table";
    });
    return unsub;
  }, [id, pos, yaw, scale]);

  useFrame((frame, dt) => {
    const g = outer.current;
    const inn = inner.current;
    if (!g || !inn) return;
    const w = useSimStore.getState().world;
    const o = w.objects.find((x) => x.id === id);
    if (!o) return;
    const mo = m.current;
    // A stalled frame (hidden tab / hot reload) fast-forwards any transition
    // instead of replaying it in slow motion once rendering resumes.
    const ms = dt > 0.25 ? DROP_MS + ROLLOUT_MS : Math.min(dt, 1 / 12) * 1000;
    const now = frame.clock.elapsedTime * 1000;

    // --- transitions ------------------------------------------------------
    if (o.state !== mo.prevState) {
      if (mo.prevState === "held" && o.state === "in_bag") {
        // The engine snaps the state; we animate the fall into the slot.
        mo.phase = "drop";
        mo.t = 0;
        mo.fromX = pos.x.value;
        mo.fromY = pos.y.value;
        mo.fromZ = pos.z.value;
      } else if (o.state === "rolled_out") {
        mo.phase = "roll";
        mo.t = 0;
        mo.roll = 0;
        mo.fromX = pos.x.value;
        mo.fromY = pos.y.value;
        mo.fromZ = pos.z.value;
        mo.arc = ROLL_PEAK - (mo.fromY + restOffset(o)) / 2;
        mo.alertUntil = now + ROLLOUT_MS + ALERT_LINGER_MS;
      } else if (mo.phase !== "roll") {
        mo.phase = "rest";
      }
      mo.prevState = o.state;
    }

    // A slipped grasp: wobble whichever object is under the hand.
    const slipped =
      w.lastSkill !== null &&
      w.lastSkill.command.skill === "grasp" &&
      w.lastSkill.outcome === "slipped";
    if (slipped && w.consecutiveFailures !== mo.prevFailures) {
      mo.prevFailures = w.consecutiveFailures;
      if (o.state === "on_table" && dist(w.gripper.pos, o.pos) < 4) {
        mo.wobble = 1;
        mo.wobbleT = 0;
      }
    } else if (!slipped) {
      mo.prevFailures = w.consecutiveFailures;
    }

    // --- position ---------------------------------------------------------
    writeTarget(w, id);

    if (mo.phase === "drop") {
      mo.t += ms;
      const p = clamp01(mo.t / DROP_MS);
      const fall = easeInQuad(p);
      const slide = easeOutCubic(p);
      pos.x.reset(lerp(mo.fromX, target.x, slide));
      pos.z.reset(lerp(mo.fromZ, target.z, slide));
      pos.y.reset(lerp(mo.fromY, target.y, fall));
      if (p >= 1) mo.phase = "rest";
    } else if (mo.phase === "roll") {
      mo.t += ms;
      const p = clamp01(mo.t / ROLLOUT_MS);
      // The engine eases the xy itself; we add the hop over the rim.
      const baseY = lerp(mo.fromY, target.y, easeOutCubic(p));
      const prevX = pos.x.value;
      // The engine eases pos.x from the bag centre outwards; the extra bag
      // clearance is ramped in over the same window so nothing teleports.
      pos.x.reset(lerp(target.rawX, target.x, p));
      pos.z.reset(target.z);
      pos.y.reset(baseY + mo.arc * Math.sin(Math.PI * Math.pow(p, 0.85)));
      // Roll about the marker's long axis: arc length / radius.
      mo.roll -= (pos.x.value - prevX) / Math.max(0.3, restOffset(o));
      if (p >= 1) {
        mo.phase = "rest";
        pos.y.reset(target.y);
      }
    } else {
      // Held items track the hand rigidly; loose items settle more softly.
      if (o.state === "held") pos.tune(30, 1);
      else if (o.state === "in_bag") pos.tune(16, 0.95);
      else pos.tune(20, 1);
      pos.step(target.x, target.y, target.z, dt);
    }

    g.position.set(pos.x.value, pos.y.value, pos.z.value);
    g.rotation.y = yaw.step(target.yaw, dt);

    // Stagger the labels of stacked items so the three badges never collide.
    if (labelGroup.current) {
      labelGroup.current.position.y = labelSpring.step(
        labelY + (o.state === "in_bag" ? target.slot * LABEL_STACK_GAP : 0),
        dt,
      );
    }

    // --- squash & stretch, wobble ----------------------------------------
    scale.step(scaleX, scaleY, scaleZ, dt);
    inn.scale.set(scale.x.value, scale.y.value, scale.z.value);

    if (mo.wobble > 0.001) {
      mo.wobbleT += ms;
      const decay = Math.max(0, 1 - mo.wobbleT / SLIP_MS);
      mo.wobble = decay * decay;
      const a = mo.wobble * 0.22;
      inn.rotation.x = Math.sin(mo.wobbleT * 0.026) * a;
      inn.rotation.z = mo.roll + Math.cos(mo.wobbleT * 0.031) * a;
    } else {
      inn.rotation.x = 0;
      inn.rotation.z = mo.roll;
    }

    // --- label ------------------------------------------------------------
    if (wrap.current) {
      const far = dist(w.gripper.pos, o.pos);
      const interesting = o.state !== "on_table" || now < mo.alertUntil;
      const near = interesting ? 1 : clamp01(1 - (far - 9) / 17);
      wrap.current.style.opacity = String(0.3 + near * 0.7);
    }
    if (badge.current) {
      const alert = now < mo.alertUntil;
      const text = alert
        ? "rolled out"
        : o.state === "held"
          ? "held"
          : o.state === "in_bag"
            ? "in bag"
            : "";
      if (badge.current.dataset.text !== text) {
        badge.current.dataset.text = text;
        badge.current.textContent = text;
        badge.current.style.display = text ? "" : "none";
        badge.current.className = alert ? "scene-badge scene-badge-alert" : "scene-badge";
      }
    }
  });

  return (
    <group ref={outer}>
      <group ref={inner}>{children}</group>
      <group ref={labelGroup} position={[LABEL_OFFSET_X[id], labelY, 0]}>
        <Html center distanceFactor={62} zIndexRange={[9, 0]}>
          <div ref={wrap} className="scene-label">
            <span>{s.label}</span>
            <span ref={badge} className="scene-badge" style={{ display: "none" }} />
          </div>
        </Html>
      </group>
    </group>
  );
}

// ---------------------------------------------------------------------------
// The three props
// ---------------------------------------------------------------------------

function Sponge() {
  const compressed = useSimStore(
    (s) => s.world.objects.find((o) => o.id === "sponge")?.compressed ?? false,
  );
  const size = spec("sponge").size;
  const rough = useMemo(() => {
    const t = spongeRoughness();
    t.wrapS = RepeatWrapping;
    t.wrapT = RepeatWrapping;
    t.repeat.set(2, 2);
    return t;
  }, []);

  return (
    <ObjectView
      id="sponge"
      scaleX={compressed ? SPONGE_COMPRESSED_SIZE.w / size.w : 1}
      scaleY={compressed ? SPONGE_COMPRESSED_SIZE.h / size.h : 1}
      scaleZ={compressed ? SPONGE_COMPRESSED_SIZE.d / size.d : 1}
    >
      <RoundedBox
        args={[size.w, size.h, size.d]}
        radius={0.55}
        smoothness={4}
        castShadow
        receiveShadow
      >
        <meshStandardMaterial
          color="#f2c119"
          roughnessMap={rough}
          roughness={1}
          metalness={0}
          envMapIntensity={0.35}
        />
      </RoundedBox>
      {/* green scouring pad on top — reads instantly as a cellulose sponge */}
      <RoundedBox
        position={[0, size.h / 2 - 0.28, 0]}
        args={[size.w - 0.5, 0.7, size.d - 0.5]}
        radius={0.25}
        smoothness={3}
        castShadow
      >
        <meshStandardMaterial
          color="#3f7d4e"
          roughnessMap={rough}
          roughness={1}
          metalness={0}
          envMapIntensity={0.25}
        />
      </RoundedBox>
    </ObjectView>
  );
}

function TapeHolder() {
  // Flat dispenser: a dark grey foot and spindle carrying a lighter tape roll.
  // The ring is deliberately the obvious thing to hook a finger through — the
  // hidden grasp point sits on it, 2 cm left of the centroid — so the hole in
  // the middle is kept clear.
  const ringR = 2.5;
  const tube = 0.72;
  return (
    <ObjectView id="tape_holder">
      {/* foot — a ring, so the hole through the roll stays open */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.92, 0]} castShadow receiveShadow>
        <torusGeometry args={[2.9, 0.38, 12, 44]} />
        <meshStandardMaterial color="#2b3038" roughness={0.5} metalness={0.3} />
      </mesh>
      {/* the tape roll */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} castShadow receiveShadow>
        <torusGeometry args={[ringR, tube, 20, 56]} />
        <meshStandardMaterial color="#cdb187" roughness={0.6} metalness={0.02} />
      </mesh>
      {/* wound edge highlight so the roll reads as layers of tape */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.4, 0]}>
        <torusGeometry args={[ringR, 0.4, 12, 48]} />
        <meshStandardMaterial color="#e6d5b4" roughness={0.68} metalness={0} />
      </mesh>
      {/* spindle — thin, so the ring stays a ring you could hook a finger through */}
      <mesh position={[0, -0.1, 0]} castShadow>
        <cylinderGeometry args={[0.38, 0.38, 2.6, 18]} />
        <meshStandardMaterial color="#3a424e" roughness={0.4} metalness={0.45} />
      </mesh>
      <mesh position={[0, 1.12, 0]} castShadow>
        <cylinderGeometry args={[0.56, 0.56, 0.28, 20]} />
        <meshStandardMaterial color="#20252b" roughness={0.45} metalness={0.5} />
      </mesh>
      {/* cutting blade arm — the dispenser silhouette */}
      <mesh position={[0, -0.7, -3.1]} rotation={[0.3, 0, 0]} castShadow>
        <boxGeometry args={[3.2, 0.4, 1.7]} />
        <meshStandardMaterial color="#2b3038" roughness={0.5} metalness={0.35} />
      </mesh>
      <mesh position={[0, -0.35, -3.8]} rotation={[0.3, 0, 0]}>
        <boxGeometry args={[3.0, 0.12, 0.5]} />
        <meshStandardMaterial color="#9aa3b0" roughness={0.28} metalness={0.9} />
      </mesh>
    </ObjectView>
  );
}

function Marker() {
  const size = spec("marker").size;
  const r = size.w / 2; // 0.75
  const len = size.d; // 12, along sim +y = three -z
  return (
    <ObjectView id="marker">
      {/* barrel */}
      <mesh rotation={[Math.PI / 2, 0, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[r, r, len - 3.2, 24]} />
        <meshStandardMaterial color="#2f6fe4" roughness={0.32} metalness={0.08} />
      </mesh>
      {/* white label band */}
      <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 0, 1.4]} castShadow>
        <cylinderGeometry args={[r + 0.04, r + 0.04, 2.2, 24]} />
        <meshStandardMaterial color="#f4f6fb" roughness={0.55} metalness={0} />
      </mesh>
      {/* cap */}
      <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 0, -(len / 2 - 1.6)]} castShadow>
        <cylinderGeometry args={[r + 0.05, r + 0.05, 3.2, 24]} />
        <meshStandardMaterial color="#12213d" roughness={0.38} metalness={0.12} />
      </mesh>
      {/* cap clip — makes the roll unmistakable */}
      <mesh position={[r + 0.22, 0, -(len / 2 - 1.4)]} castShadow>
        <boxGeometry args={[0.4, 0.34, 2.4]} />
        <meshStandardMaterial color="#0c1220" roughness={0.4} metalness={0.2} />
      </mesh>
      {/* nib */}
      <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 0, len / 2 - 1.4]} castShadow>
        <cylinderGeometry args={[0.22, r - 0.1, 1.4, 20]} />
        <meshStandardMaterial color="#101826" roughness={0.6} metalness={0} />
      </mesh>
    </ObjectView>
  );
}

/** The tape holder's *real* grasp point: a soft glowing ring on the table. */
function TapeGraspHint() {
  const group = useRef<Group>(null);
  const halo = useRef<Mesh>(null);
  const haloMat = useRef<MeshBasicMaterial>(null);
  const coreMat = useRef<MeshBasicMaterial>(null);
  const ringTex = useMemo(() => haloTexture(), []);
  const glow = useMemo(() => glowTexture(), []);
  const p = useRef({ x: 0, z: 0, a: 0 });

  useFrame((frame, dt) => {
    const g = group.current;
    if (!g) return;
    const w = useSimStore.getState().world;
    const tape = w.objects.find((o) => o.id === "tape_holder");
    if (!tape) return;
    const close = tape.state === "on_table" && dist(w.gripper.pos, tape.pos) < TAPE_HINT_RADIUS;
    const k = 1 - Math.exp(-Math.min(dt, 0.1) * 14);
    p.current.x += (tape.pos.x + TAPE_GRASP_OFFSET.x - p.current.x) * k;
    p.current.z += (-(tape.pos.y + TAPE_GRASP_OFFSET.y) - p.current.z) * k;
    p.current.a += ((close ? 1 : 0) - p.current.a) * (1 - Math.exp(-Math.min(dt, 0.1) * 9));
    g.position.set(p.current.x, 0.07, p.current.z);
    g.visible = p.current.a > 0.01;

    const pulse = 0.78 + Math.sin(frame.clock.elapsedTime * 3.4) * 0.22;
    if (haloMat.current) haloMat.current.opacity = p.current.a * pulse;
    if (coreMat.current) coreMat.current.opacity = p.current.a * pulse * 0.28;
    if (halo.current) {
      const s = 10.4 + Math.sin(frame.clock.elapsedTime * 3.4) * 0.55;
      halo.current.scale.set(s, s, 1);
    }
  });

  return (
    <group ref={group}>
      <mesh ref={halo} rotation={[-Math.PI / 2, 0, 0]} renderOrder={2}>
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial
          ref={haloMat}
          map={ringTex}
          color="#2bf299"
          transparent
          opacity={0}
          depthWrite={false}
          side={DoubleSide}
        />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} scale={[13, 13, 1]} renderOrder={2}>
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial
          ref={coreMat}
          map={glow}
          color="#2fe08a"
          transparent
          opacity={0}
          blending={AdditiveBlending}
          depthWrite={false}
          side={DoubleSide}
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
