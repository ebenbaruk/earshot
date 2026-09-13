"use client";

import clsx from "clsx";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { OBJECT_COUNT, type SimStatus } from "@/lib/types";
import type { EarshotActions, EarshotViewModel } from "./view-model";
import { Chip, ThinkingDots } from "./primitives";
import { formatElapsed, formatSkill, markHalt } from "./format";

/** The legend under "What can I say?" — the validated demo phrases. */
export const EXAMPLE_PHRASES: readonly { text: string; hint?: string }[] = [
  { text: "Stop, put the marker in last." },
  { text: "Stop, a bit to the left." },
  { text: "Stop, squeeze it first." },
  { text: "Stop, lower it first.", hint: "egg" },
  { text: "Continue." },
  { text: "A little more to the left." },
];

const STATUS_LABEL: Record<SimStatus, string> = {
  idle: "idle",
  running: "running",
  paused: "paused",
  succeeded: "succeeded",
  failed: "failed",
};

function statusTone(s: SimStatus) {
  if (s === "running") return "text-ok";
  if (s === "paused") return "text-accent";
  if (s === "failed") return "text-danger";
  if (s === "succeeded") return "text-ok";
  return "text-muted";
}

const STAGE_PIPS = Array.from({ length: OBJECT_COUNT }, (_, i) => i);

/* -------------------------------------------------------------------------- */
/* Level meter                                                                 */
/* -------------------------------------------------------------------------- */

const METER_W = 40;
const METER_H = 16;
const METER_BARS = 10;
const BAR_W = 3;
const BAR_GAP = (METER_W - METER_BARS * BAR_W) / (METER_BARS - 1);
const METER_FPS = 30;

/**
 * A live mic meter: ten bars scrolling right to left, the newest on the right.
 *
 * The level is *polled* from an animation frame rather than subscribed to, so a
 * 20 Hz audio signal never re-renders React. Fast attack / slow release, so it
 * reads as a voice and not as noise.
 */
function LevelMeter({
  active,
  getLevel,
  className,
}: {
  active: boolean;
  getLevel: () => number;
  className?: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(METER_W * dpr);
    canvas.height = Math.round(METER_H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const history = new Array<number>(METER_BARS).fill(0);
    let smoothed = 0;
    let last = 0;
    let frame = requestAnimationFrame(function draw(now: number) {
      frame = requestAnimationFrame(draw);
      if (now - last < 1000 / METER_FPS) return;
      last = now;

      const target = active ? Math.max(0, Math.min(1, getLevel())) : 0;
      smoothed = target > smoothed ? target : smoothed * 0.78 + target * 0.22;
      history.push(smoothed);
      history.shift();

      ctx.clearRect(0, 0, METER_W, METER_H);
      for (let i = 0; i < METER_BARS; i += 1) {
        const v = history[i];
        const h = Math.max(2, v * (METER_H - 2));
        const x = i * (BAR_W + BAR_GAP);
        const y = (METER_H - h) / 2;
        ctx.fillStyle = `rgba(255, 158, 69, ${(0.18 + 0.82 * v).toFixed(3)})`;
        if (typeof ctx.roundRect === "function") {
          ctx.beginPath();
          ctx.roundRect(x, y, BAR_W, h, BAR_W / 2);
          ctx.fill();
        } else {
          ctx.fillRect(x, y, BAR_W, h);
        }
      }
    });

    return () => cancelAnimationFrame(frame);
  }, [active, getLevel]);

  return (
    <canvas
      ref={ref}
      aria-hidden
      style={{ width: METER_W, height: METER_H }}
      className={clsx("shrink-0", className)}
    />
  );
}

/* -------------------------------------------------------------------------- */

function RunStatus({ vm }: { vm: EarshotViewModel }) {
  return (
    <div className="pointer-events-auto flex flex-col items-start gap-1.5">
      <div className="flex items-center gap-2 rounded-md border border-line bg-bg/75 px-2.5 py-1.5 backdrop-blur">
        <span
          className={clsx(
            "h-1.5 w-1.5 rounded-full bg-current",
            statusTone(vm.status),
            vm.status === "running" && "blink",
          )}
        />
        <span className={clsx("text-[12px] font-medium", statusTone(vm.status))}>
          {STATUS_LABEL[vm.status]}
        </span>
        <span className="h-3 w-px bg-line" />
        <span className="font-mono text-[12px] text-muted">
          run {vm.runIndex}
        </span>
        <span className="h-3 w-px bg-line" />
        <span className="tnum font-mono text-[12px] text-muted">
          {formatElapsed(vm.elapsedMs)}
        </span>
      </div>

      <div className="flex items-center gap-2 rounded-md border border-line bg-bg/75 px-2.5 py-1.5 backdrop-blur">
        <span className="tnum font-mono text-[12px] text-ink">
          {vm.world.stagesDone} / {OBJECT_COUNT}
        </span>
        <span className="text-[11px] tracking-wider text-faint uppercase">
          packed
        </span>
        <span className="ml-1 flex items-center gap-1" aria-hidden>
          {STAGE_PIPS.map((i) => (
            <span
              key={i}
              className={clsx(
                "h-1 w-4 rounded-full transition-colors duration-200 ease-out",
                i < vm.world.stagesDone ? "bg-ok" : "bg-white/12",
              )}
            />
          ))}
        </span>
      </div>

      {!vm.correctionsEnabled ? (
        <Chip tone="neutral">ablation · corrections off</Chip>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function PolicyLine({ vm }: { vm: EarshotViewModel }) {
  return (
    <div className="pointer-events-auto w-[min(30rem,100%)] rounded-md border border-line bg-bg/80 px-3 py-2.5 backdrop-blur">
      <div className="mb-1.5 flex items-center gap-2">
        <span className="label">policy</span>
        <span className="font-mono text-[10px] text-faint">
          v{vm.currentVersion}
        </span>
        {vm.policyThinking ? (
          <span className="flex items-center gap-1.5 text-[11px] text-accent">
            <ThinkingDots />
            thinking
          </span>
        ) : null}
      </div>
      <div className="font-mono text-[14px] leading-5 break-words text-ink">
        {formatSkill(vm.decision?.command)}
      </div>
      <p className="mt-1 text-[12.5px] leading-relaxed text-muted">
        {vm.decision?.reasoning ?? "Waiting for the first decision."}
      </p>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * The partial transcript, word by word.
 *
 * The fade-in is mount-driven, not state-driven: words are keyed by position,
 * so a word that was already on screen keeps its DOM node (and its finished
 * animation) while an appended word mounts fresh and fades in. Nothing here
 * remembers anything — the whole component is a function of the current
 * partial.
 *
 * When the stop word lands the line *locks*: the class comes off, so every
 * word that arrives after the halt appears instantly and the red highlight is
 * the last thing that moves. The lock is derived from the text itself (any
 * known stop word still in the line), so it holds for the rest of the turn,
 * long after the 1.4 s stop flash expires, and clears on its own at the next
 * turn when the partial resets to "".
 */
function PartialLine({
  partial,
  stopWord,
}: {
  partial: string;
  stopWord: string | null | undefined;
}) {
  const words = useMemo(() => partial.split(/\s+/).filter(Boolean), [partial]);
  const marks = useMemo(() => markHalt(words, stopWord), [words, stopWord]);
  const locked = marks.some(Boolean);

  return (
    <p className="font-mono text-[clamp(15px,1.9vw,22px)] leading-tight break-words text-ink">
      {words.map((word, i) => (
        <Fragment key={i}>
          <span className={clsx("inline-block", !locked && "word-in")}>
            {marks[i] ? (
              <mark className="rounded bg-danger/30 px-1 text-danger">
                {word}
              </mark>
            ) : (
              word
            )}
          </span>
          {i < words.length - 1 ? " " : null}
        </Fragment>
      ))}
      {locked ? null : <span className="blink ml-0.5 text-accent">▌</span>}
    </p>
  );
}

/* -------------------------------------------------------------------------- */

/** Mic state + live level + the robot's own voice, in one strip. */
function VoiceBar({
  vm,
  actions,
}: {
  vm: EarshotViewModel;
  actions: EarshotActions;
}) {
  if (vm.speaking) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-info/45 bg-info/10 px-3 py-1.5 backdrop-blur">
        <span className="flex items-end gap-[2px]" aria-hidden>
          <span className="dot-1 h-2 w-[3px] rounded-full bg-info" />
          <span className="dot-2 h-3 w-[3px] rounded-full bg-info" />
          <span className="dot-3 h-1.5 w-[3px] rounded-full bg-info" />
        </span>
        <span className="text-[12px] text-info">
          robot speaking — mic muted
        </span>
      </div>
    );
  }

  if (vm.voice === "off") {
    return (
      <div className="rounded-md border border-line bg-bg/70 px-3 py-1.5 text-[12px] text-faint backdrop-blur">
        mic off — turn it on to correct the agent
      </div>
    );
  }

  const listening = vm.voice === "listening";
  return (
    <div
      className={clsx(
        "flex items-center gap-2.5 rounded-md border bg-bg/75 px-3 py-1.5 backdrop-blur",
        vm.voice === "error" ? "border-danger/50" : "border-line",
      )}
    >
      <span
        className={clsx(
          "relative h-1.5 w-1.5 shrink-0 rounded-full",
          listening ? "mic-ring bg-accent" : vm.voice === "error" ? "bg-danger" : "blink bg-accent",
        )}
      />
      <LevelMeter active={listening} getLevel={actions.getLevel} />
      <span
        className={clsx(
          "text-[12px]",
          vm.voice === "error" ? "text-danger" : "text-muted",
        )}
      >
        {listening
          ? vm.partial
            ? "listening"
            : "listening — say something"
          : vm.voice === "connecting"
            ? "connecting…"
            : (vm.voiceError ?? "mic error")}
      </span>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function Transcript({
  vm,
  actions,
}: {
  vm: EarshotViewModel;
  actions: EarshotActions;
}) {
  const stopped = vm.stopFlash != null;
  const last = vm.lastCorrection;
  // Only for a correction from the run in progress, and only for a few seconds.
  const sinceCorrection = last ? vm.elapsedMs - last.ts : Infinity;
  const showNudge =
    last != null &&
    last.parsedCommand != null &&
    sinceCorrection >= 0 &&
    sinceCorrection < 4000;
  const showUnparsed =
    last != null && last.parsedCommand == null && sinceCorrection >= 0 && sinceCorrection < 6000;

  return (
    <div className="pointer-events-auto flex w-full max-w-[46rem] flex-col items-center gap-2">
      {stopped ? (
        <div className="rise flex items-center gap-2 rounded-md border border-danger/60 bg-danger-soft px-3 py-1.5">
          <span className="blink h-2 w-2 rounded-full bg-danger" />
          <span className="text-[13px] font-semibold tracking-wide text-danger">
            STOPPED · listening
          </span>
          {vm.stopFlash?.latencyMs != null ? (
            <span className="tnum font-mono text-[12px] text-danger/80">
              stop → halt {Math.round(vm.stopFlash.latencyMs)} ms
            </span>
          ) : null}
        </div>
      ) : null}

      {vm.partial ? (
        <div
          className={clsx(
            "w-full rounded-md border px-4 py-2.5 text-center backdrop-blur transition-colors duration-150 ease-out",
            stopped
              ? "border-danger/50 bg-danger-soft"
              : "border-line bg-bg/85",
          )}
        >
          <PartialLine partial={vm.partial} stopWord={vm.stopFlash?.word} />
        </div>
      ) : null}

      {showNudge && last ? (
        <div className="rise flex flex-wrap items-center justify-center gap-2">
          <Chip tone="accent" mono>
            ↳ {formatSkill(last.parsedCommand)}
          </Chip>
          <span className="text-[11.5px] text-faint">
            from “{last.transcript}” · {last.parseSource}
          </span>
        </div>
      ) : null}

      {showUnparsed && last ? (
        <div className="rise flex flex-wrap items-center justify-center gap-2">
          <Chip tone="danger" mono>
            ? didn’t understand
          </Chip>
          <span className="text-[11.5px] text-faint">
            “{last.transcript}” — say it again, or press Run to continue
          </span>
        </div>
      ) : null}

      <VoiceBar vm={vm} actions={actions} />
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function PhraseLegend() {
  const [open, setOpen] = useState(false);
  return (
    <div className="pointer-events-auto flex flex-col items-end gap-1.5">
      {open ? (
        <div className="rise max-w-[17rem] rounded-md border border-line bg-bg/85 p-2.5 backdrop-blur">
          <div className="label mb-2">try saying</div>
          <ul className="flex flex-col gap-1">
            {EXAMPLE_PHRASES.map((p) => (
              <li
                key={p.text}
                className="font-mono text-[11.5px] leading-4 text-muted"
              >
                “{p.text}”
                {p.hint ? (
                  <span className="ml-1 text-faint">· {p.hint}</span>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="rounded-md border border-line bg-bg/75 px-2.5 py-1.5 text-[12px] text-muted backdrop-blur transition-colors duration-150 ease-out hover:border-line-strong hover:text-ink"
      >
        {open ? "Hide phrases" : "What can I say?"}
      </button>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

export function Hud({
  vm,
  actions,
}: {
  vm: EarshotViewModel;
  actions: EarshotActions;
}) {
  return (
    <>
      {/* the one dramatic animation: a red flash around the whole scene */}
      {vm.stopFlash ? (
        <div
          key={vm.stopFlash.at}
          aria-hidden
          className="stop-flash pointer-events-none absolute inset-0 z-10 rounded-[inherit]"
        />
      ) : null}

      <div className="pointer-events-none absolute inset-0 z-10 flex flex-col justify-between p-3 pb-5 sm:p-4 sm:pb-7">
        <div className="flex items-start justify-between gap-3">
          <RunStatus vm={vm} />
          <PhraseLegend />
        </div>

        <div className="flex flex-col items-center gap-3">
          <Transcript vm={vm} actions={actions} />
          <div className="flex w-full items-end justify-start">
            <PolicyLine vm={vm} />
          </div>
        </div>
      </div>
    </>
  );
}
