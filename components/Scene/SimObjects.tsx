"use client";

import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { useFrame } from "@react-three/fiber";
import { Html, RoundedBox } from "@react-three/drei";
import {
  AdditiveBlending,
  DoubleSide,
  Matrix4,
  MeshStandardMaterial,
  Quaternion,
  RepeatWrapping,
  Vector2,
  Vector3,
} from "three";
import type { Group, InstancedMesh, Mesh, MeshBasicMaterial } from "three";
import type { ObjectId, ObjectState, WorldState } from "@/lib/types";
import {
  BAG_HEIGHT,
  CRACK_MS,
  OBJECT_SPECS,
  ROLLOUT_MS,
  SPONGE_COMPRESSED_SIZE,
  TAPE_GRASP_OFFSET,
  TAPE_HINT_RADIUS,
  dist,
  effectiveSize,
  type ObjectSpec,
} from "@/lib/sim/constants";
import { useSimStore } from "@/store/useSimStore";
import { Spring, Spring3, clamp01, easeInQuad, easeOutCubic, lerp } from "./coords";
import { hand, stepHand } from "./hand";
import {
  BAG_FLOOR,
  BAG_OFFSET,
  BAG_SINK,
  BAG_STACK_ORDER,
  BAG_YAW,
  REST_YAW,
  bagDodgeX,
  restOffset,
  visualHeight,
} from "./layout3d";
import { eggSpeckle, glowTexture, haloTexture, spongeRoughness, splatTexture } from "./textures";

/** How long a released item takes to fall into its slot in the bag. */
const DROP_MS = 350;
/** How long an alert badge ("rolled out" / "cracked") stays up afterwards. */
const ALERT_LINGER_MS = 1500;
/** Blend from wherever the object was into a rigid hold on the fingers. */
const GRAB_MS = 220;
/** The egg falls this fast when it is dropped from carry height. */
const SMASH_MS = 170;
/** Extra label height per item already stacked under this one, in cm. */
const LABEL_STACK_GAP = 3.0;
/** Sideways label offset per object, so two labels rarely land on each other. */
const LABEL_OFFSET_X: Record<ObjectId, number> = {
  marker: 2.6,
  tape_holder: 0,
  sponge: -2.6,
  egg: 1.6,
};
/** Wobble after a slipped grasp. */
const SLIP_MS = 700;
/** Peak height of the roll-out arc, just over the rim. */
const ROLL_PEAK = BAG_HEIGHT + 2;

/**
 * Used only if the engine ships an object the constants do not describe yet
 * (the scene is built to render whatever the world hands it, in any order).
 */
const FALLBACK_SPECS: Record<ObjectId, ObjectSpec> = {
  sponge: { id: "sponge", label: "Sponge", size: { w: 8, d: 5, h: 3 } },
  tape_holder: { id: "tape_holder", label: "Tape holder", size: { w: 7, d: 7, h: 3 } },
  marker: { id: "marker", label: "Marker", size: { w: 1.5, d: 12, h: 1.5 } },
  egg: { id: "egg", label: "Egg", size: { w: 4.5, d: 6, h: 4.5 } },
};

function spec(id: ObjectId): ObjectSpec {
  return OBJECT_SPECS.find((o) => o.id === id) ?? FALLBACK_SPECS[id];
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
    target.y = Math.max(BAG_FLOOR + half, top + half - (BAG_SINK[id] ?? 0));
    target.z = -(w.bag.pos.y + off.y);
    target.yaw = BAG_YAW[id];
    target.rawX = target.x;
    return;
  }

  target.slot = 0;
  if (o.state === "held") {
    // Rigidly attached to the SAME smoothed pose the fingers are drawn at, so
    // the item can never drift off the pads while the carriage is moving.
    target.x = hand.x;
    target.y = hand.y + half;
    target.z = hand.z;
    target.yaw = 0;
    target.rawX = target.x;
    return;
  }

  if (o.state === "cracked") {
    // Broken on the floor of the bag; the shell mess is drawn by <EggMess />.
    target.x = w.bag.pos.x;
    target.y = BAG_FLOOR + half;
    target.z = -w.bag.pos.y;
    target.yaw = 0;
    target.rawX = target.x;
    return;
  }

  const size = effectiveSize(o);
  // Keep anything resting inside the bag's shell clear of it (see bagDodgeX).
  target.x = bagDodgeX(o.pos.x, o.pos.y, size.w / 2, size.d / 2, w.bag.pos);
  target.rawX = o.pos.x;
  target.y = half;
  target.z = -o.pos.y;
  target.yaw = REST_YAW[id];
}

type Phase = "rest" | "drop" | "roll" | "grab" | "smash";

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
  pop: number;
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
  // The egg turns fast enough to be square in the pads before they close on it.
  const yaw = useMemo(() => new Spring(REST_YAW[id], id === "egg" ? 26 : 14, 1), [id]);
  const labelSpring = useMemo(() => new Spring(labelY, 12, 1), [labelY]);
  const scale = useMemo(() => new Spring3(1, 1, 1, 26, 0.55), []);
  /** 0 -> 1 scale-in when a fresh object appears (the replacement egg). */
  const pop = useMemo(() => new Spring(1, 17, 0.5), []);

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
    pop: 1,
    prevFailures: 0,
    alertUntil: 0,
  });

  // Reset the visual state whenever the world is re-seeded.
  useEffect(() => {
    const unsub = useSimStore.subscribe((st) => {
      if (st.world.t !== 0 || st.world.status !== "idle") return;
      writeTarget(st.world, id);
      pos.reset(target.x, target.y, target.z);
      yaw.reset(target.yaw);
      scale.reset(1, 1, 1);
      pop.reset(1);
      m.current.phase = "rest";
      m.current.roll = 0;
      m.current.wobble = 0;
      m.current.alertUntil = 0;
      m.current.prevState = "on_table";
    });
    return unsub;
  }, [id, pos, yaw, scale, pop]);

  useFrame((frame, dt) => {
    const g = outer.current;
    const inn = inner.current;
    if (!g || !inn) return;
    const w = useSimStore.getState().world;
    const o = w.objects.find((x) => x.id === id);
    if (!o) return;
    stepHand(w, dt, frame.clock.elapsedTime);
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
      } else if (o.state === "cracked") {
        // Straight down into the bag, fast; <EggMess /> takes over on impact.
        mo.phase = "smash";
        mo.t = 0;
        mo.fromX = pos.x.value;
        mo.fromY = pos.y.value;
        mo.fromZ = pos.z.value;
        mo.alertUntil = now + CRACK_MS + ALERT_LINGER_MS;
      } else if (o.state === "held") {
        mo.phase = "grab";
        mo.t = 0;
        mo.fromX = pos.x.value;
        mo.fromY = pos.y.value;
        mo.fromZ = pos.z.value;
      } else if (mo.prevState === "cracked" && o.state === "on_table") {
        // A fresh one is put back where it started: no flight, just a pop-in.
        mo.phase = "rest";
        writeTarget(w, id);
        pos.reset(target.x, target.y, target.z);
        pop.reset(0.05);
        mo.pop = 0.05;
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
    } else if (mo.phase === "smash") {
      mo.t += ms;
      const p = clamp01(mo.t / SMASH_MS);
      const fall = easeInQuad(p);
      pos.x.reset(lerp(mo.fromX, target.x, p));
      pos.z.reset(lerp(mo.fromZ, target.z, p));
      pos.y.reset(lerp(mo.fromY, target.y, fall));
      // On impact the shell stops being a shell: <EggMess /> has the pieces.
      if (p >= 1) mo.phase = "rest";
    } else if (mo.phase === "grab") {
      mo.t += ms;
      const p = clamp01(mo.t / GRAB_MS);
      const e = easeOutCubic(p);
      pos.x.reset(lerp(mo.fromX, target.x, e));
      pos.z.reset(lerp(mo.fromZ, target.z, e));
      pos.y.reset(lerp(mo.fromY, target.y, e));
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
    } else if (o.state === "held") {
      // Welded to the fingers — no second spring, no drift.
      pos.x.reset(target.x);
      pos.y.reset(target.y);
      pos.z.reset(target.z);
    } else {
      if (o.state === "in_bag") pos.tune(16, 0.95);
      else pos.tune(20, 1);
      pos.step(target.x, target.y, target.z, dt);
    }

    g.position.set(pos.x.value, pos.y.value, pos.z.value);
    g.rotation.y = yaw.step(target.yaw, dt);
    // The shell is hidden the instant it hits the bag floor: the mess is the
    // only thing left until a fresh one is put back on the table.
    g.visible = o.state !== "cracked" || mo.phase === "smash";

    // Stagger the labels of stacked items so the badges never collide.
    if (labelGroup.current) {
      labelGroup.current.position.y = labelSpring.step(
        labelY + (o.state === "in_bag" ? target.slot * LABEL_STACK_GAP : 0),
        dt,
      );
    }

    // --- squash & stretch, wobble ----------------------------------------
    scale.step(scaleX, scaleY, scaleZ, dt);
    mo.pop = pop.step(1, dt);
    const k = mo.pop;
    inn.scale.set(scale.x.value * k, scale.y.value * k, scale.z.value * k);

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
      wrap.current.style.opacity = String(0.78 + near * 0.22);
    }
    if (badge.current) {
      const alert = now < mo.alertUntil;
      const text = alert
        ? id === "egg"
          ? "cracked"
          : "rolled out"
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
// The four props
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

/**
 * Lathe profile of an egg: a circular cross-section whose radius follows
 * sqrt(1 - u²) skewed toward the blunt end, so one end is visibly pointier.
 */
function eggProfile(halfLen: number, maxR: number): Vector2[] {
  const SKEW = 0.42;
  const shape = (u: number) => Math.sqrt(Math.max(0, 1 - u * u)) * (1 - SKEW * u);
  let peak = 0;
  for (let i = 0; i <= 128; i += 1) peak = Math.max(peak, shape(-1 + (2 * i) / 128));
  const pts: Vector2[] = [];
  const N = 30;
  for (let i = 0; i <= N; i += 1) {
    const u = -1 + (2 * i) / N;
    pts.push(new Vector2(Math.max(0.002, (shape(u) / peak) * maxR), u * halfLen));
  }
  return pts;
}

/** The fourth item: a speckled egg lying on its side, pointy end toward the viewer. */
function Egg() {
  const size = spec("egg").size;
  const profile = useMemo(() => eggProfile(size.d / 2, size.w / 2), [size.d, size.w]);
  const shell = useMemo(() => eggSpeckle(), []);
  const glow = useMemo(() => glowTexture(), []);
  const shadow = useRef<Mesh>(null);
  const shadowMat = useRef<MeshBasicMaterial>(null);

  useFrame((_, dt) => {
    if (!shadow.current || !shadowMat.current) return;
    const o = useSimStore.getState().world.objects.find((x) => x.id === "egg");
    const grounded = o?.state === "on_table";
    const k = 1 - Math.exp(-Math.min(dt, 0.1) * 10);
    shadowMat.current.opacity += ((grounded ? 0.34 : 0) - shadowMat.current.opacity) * k;
    shadow.current.visible = shadowMat.current.opacity > 0.01;
  });

  return (
    <ObjectView id="egg">
      {/* the shell: lathe about its long axis, then laid down along sim y */}
      <mesh rotation={[Math.PI / 2, 0, 0]} castShadow receiveShadow>
        <latheGeometry args={[profile, 40]} />
        <meshPhysicalMaterial
          map={shell}
          color="#e3d1ae"
          roughness={0.45}
          metalness={0}
          clearcoat={0.18}
          clearcoatRoughness={0.6}
          sheen={0.35}
          sheenColor="#ffcf94"
          sheenRoughness={0.75}
          emissive="#3a2410"
          emissiveIntensity={0.1}
          envMapIntensity={0.4}
        />
      </mesh>
      {/* the small soft shadow it sits in, so it never looks like it hovers */}
      <mesh
        ref={shadow}
        position={[0, -size.h / 2 + 0.08, 0.2]}
        rotation={[-Math.PI / 2, 0, 0]}
        renderOrder={-1}
      >
        <planeGeometry args={[size.w * 2.1, size.d * 1.7]} />
        <meshBasicMaterial
          ref={shadowMat}
          map={glow}
          color="#120b04"
          transparent
          opacity={0}
          depthWrite={false}
        />
      </mesh>
    </ObjectView>
  );
}

// ---------------------------------------------------------------------------
// The crack: shell fragments, a yolk splat and a burst of white
// ---------------------------------------------------------------------------

const FRAGMENTS = 3;
const DROPLETS = 9;
const YOLK_GROW_MS = 300;
const MESS_FADE_FROM = 0.62; // fraction of CRACK_MS where everything starts fading

const mat4 = new Matrix4();
const vec3 = new Vector3();
const size3 = new Vector3();
const quat = new Quaternion();
const axis = new Vector3();

interface Burst {
  dx: number;
  dz: number;
  speed: number;
  hop: number;
  spin: number;
  ax: number;
  ay: number;
  az: number;
  size: number;
}

function makeBursts(n: number, seed: number): Burst[] {
  const out: Burst[] = [];
  for (let i = 0; i < n; i += 1) {
    const a = ((i + 0.5) / n) * Math.PI * 2 + seed;
    const j = Math.sin((i + 1) * 12.9898 + seed) * 43758.5453;
    const r = j - Math.floor(j);
    out.push({
      dx: Math.cos(a),
      dz: Math.sin(a),
      speed: 1.8 + r * 1.8,
      hop: 1.0 + r * 1.5,
      spin: 4 + r * 9,
      ax: Math.cos(a * 1.7),
      ay: 1,
      az: Math.sin(a * 2.3),
      size: 0.16 + r * 0.2,
    });
  }
  return out;
}

/**
 * The 900 ms of mess after the egg is dropped from carry height: the shell
 * splits into three pieces, the yolk spreads on the bag floor and a short burst
 * of white flies out. Everything fades before the engine puts a fresh egg back.
 */
function EggMess() {
  const group = useRef<Group>(null);
  const frags = useRef<Array<Mesh | null>>([null, null, null]);
  const drops = useRef<InstancedMesh>(null);
  const yolk = useRef<Mesh>(null);
  const yolkMat = useRef<MeshBasicMaterial>(null);
  /** `t` counts up from -SMASH_MS (the fall) to CRACK_MS; < -SMASH_MS = dormant. */
  const state = useRef({ t: -1e6, prev: "on_table" as ObjectState });

  const splat = useMemo(() => splatTexture(), []);
  const shellBursts = useMemo(() => makeBursts(FRAGMENTS, 0.7), []);
  const dropBursts = useMemo(() => makeBursts(DROPLETS, 2.1), []);
  const shellMat = useMemo(
    () =>
      new MeshStandardMaterial({
        color: "#f1e6d2",
        roughness: 0.5,
        metalness: 0,
        side: DoubleSide,
        transparent: true,
        opacity: 1,
      }),
    [],
  );
  const dropMat = useMemo(
    () =>
      new MeshStandardMaterial({
        color: "#fff6e2",
        roughness: 0.25,
        metalness: 0,
        transparent: true,
        opacity: 0.85,
      }),
    [],
  );
  useEffect(() => {
    const a = shellMat;
    const b = dropMat;
    return () => {
      a.dispose();
      b.dispose();
    };
  }, [shellMat, dropMat]);

  /* eslint-disable react-hooks/immutability -- three.js materials are mutable
     by design; the mess fades by writing opacity in place every frame. */
  useFrame((_, dt) => {
    const g = group.current;
    if (!g) return;
    const w = useSimStore.getState().world;
    const egg = w.objects.find((o) => o.id === "egg");
    const st = state.current;

    if (egg && egg.state !== st.prev) {
      if (egg.state === "cracked") {
        // The mess is played on its own clock, one clamped frame at a time, so a
        // stalled frame never swallows it whole.
        st.t = -SMASH_MS;
        g.position.set(w.bag.pos.x, BAG_FLOOR + 0.06, -w.bag.pos.y);
      }
      st.prev = egg.state;
    }

    if (st.t < -SMASH_MS) {
      if (g.visible) g.visible = false;
      return;
    }
    st.t += Math.min(dt, 1 / 12) * 1000;
    const t = st.t;
    if (t < 0) {
      g.visible = false;
      return;
    }
    if (t > CRACK_MS) {
      st.t = -1e6;
      g.visible = false;
      return;
    }
    g.visible = true;

    const life = t / CRACK_MS;
    const fade = life < MESS_FADE_FROM ? 1 : 1 - (life - MESS_FADE_FROM) / (1 - MESS_FADE_FROM);
    const soft = fade * fade;

    // yolk: a flattened disc that spreads, then dulls as it fades
    if (yolk.current && yolkMat.current) {
      const p = clamp01(t / YOLK_GROW_MS);
      const s = 1.4 + easeOutCubic(p) * 5.4;
      yolk.current.scale.set(s, s * 0.84, 1);
      yolkMat.current.opacity = 0.96 * soft;
    }

    // shell fragments: out, up, down, tumbling
    for (let i = 0; i < FRAGMENTS; i += 1) {
      const mesh = frags.current[i];
      if (!mesh) continue;
      const b = shellBursts[i];
      const p = clamp01(t / 420);
      const d = easeOutCubic(p) * b.speed;
      mesh.position.set(b.dx * d, Math.max(0.12, b.hop * Math.sin(Math.PI * p) - p * 0.3), b.dz * d);
      // Tumble on the way out, then settle flat like a shard of shell.
      const settle = easeOutCubic(clamp01((p - 0.55) / 0.45));
      mesh.rotation.set(
        lerp(b.ax * p * b.spin * 0.5, Math.PI / 2 + b.ax * 0.4, settle),
        b.ay * p * b.spin * 0.35,
        lerp(b.az * p * b.spin * 0.5, b.az * 0.5, settle),
      );
      const k = 0.75 + 0.25 * soft;
      mesh.scale.set(k, k * 0.62, k);
    }
    shellMat.opacity = soft;

    // white: a quick burst of droplets that arc and settle
    if (drops.current) {
      for (let i = 0; i < DROPLETS; i += 1) {
        const b = dropBursts[i];
        const p = clamp01(t / 520);
        const d = easeOutCubic(p) * b.speed * 0.9;
        const y = Math.max(0.04, b.hop * 1.1 * Math.sin(Math.PI * Math.pow(p, 0.8)) - p * 0.3);
        vec3.set(b.dx * d, y, b.dz * d);
        axis.set(b.ax, b.ay, b.az).normalize();
        quat.setFromAxisAngle(axis, p * b.spin);
        mat4.compose(vec3, quat, size3.set(b.size, b.size * 0.8, b.size));
        drops.current.setMatrixAt(i, mat4);
      }
      drops.current.instanceMatrix.needsUpdate = true;
    }
    dropMat.opacity = 0.85 * soft;
  });
  /* eslint-enable react-hooks/immutability */

  return (
    <group ref={group} visible={false}>
      <mesh ref={yolk} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial
          ref={yolkMat}
          map={splat}
          color="#f5b323"
          transparent
          opacity={0}
          side={DoubleSide}
          toneMapped={false}
        />
      </mesh>
      {[0, 1, 2].map((i) => (
        <mesh
          key={i}
          ref={(el) => {
            frags.current[i] = el;
          }}
          material={shellMat}
          castShadow
        >
          <sphereGeometry args={[1.3, 16, 10, i * 2.0, 2.35, 0, 1.45]} />
        </mesh>
      ))}
      <instancedMesh ref={drops} args={[undefined, dropMat, DROPLETS]} castShadow>
        <sphereGeometry args={[1, 8, 6]} />
      </instancedMesh>
    </group>
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
    const size = effectiveSize(tape);
    const x = bagDodgeX(
      tape.pos.x + TAPE_GRASP_OFFSET.x,
      tape.pos.y,
      size.w / 2,
      size.d / 2,
      w.bag.pos,
    );
    p.current.x += (x - p.current.x) * k;
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

const VIEWS: Record<ObjectId, () => ReactNode> = {
  sponge: Sponge,
  tape_holder: TapeHolder,
  marker: Marker,
  egg: Egg,
};

export function SimObjects() {
  // Render whatever the world actually contains, so a prop the engine adds
  // (or drops) never needs a matching edit here to show up.
  const ids = useSimStore((s) => s.world.objects.map((o) => o.id).join("|"));

  return (
    <group>
      {ids
        .split("|")
        .filter((id): id is ObjectId => id in VIEWS)
        .map((id) => {
          const View = VIEWS[id];
          return <View key={id} />;
        })}
      <TapeGraspHint />
      <EggMess />
    </group>
  );
}
