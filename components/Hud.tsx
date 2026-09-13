"use client";

import clsx from "clsx";
import { useState } from "react";
import type { SimStatus } from "@/lib/types";
import type { EarshotViewModel } from "./view-model";
import { Chip, ThinkingDots } from "./primitives";
import { formatElapsed, formatSkill, splitOnWord } from "./format";

/** The legend under "What can I say?" — real product copy, not mock data. */
export const EXAMPLE_PHRASES: readonly string[] = [
  "stop",
  "a bit to the left",
  "squeeze it first",
  "open the gripper wider",
  "widen the bag",
  "not that one — the marker",
  "lift it up",
  "let go",
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
          {vm.world.stagesDone} / 3
        </span>
        <span className="text-[11px] tracking-wider text-faint uppercase">
          packed
        </span>
        <span className="ml-1 flex items-center gap-1" aria-hidden>
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className={clsx(
                "h-1 w-5 rounded-full transition-colors duration-200 ease-out",
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

function Transcript({ vm }: { vm: EarshotViewModel }) {
  const stopped = vm.stopFlash != null;
  const parts = splitOnWord(vm.partial, vm.stopFlash?.word);
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

  const hasSomething = vm.partial.length > 0 || stopped || showNudge || showUnparsed;

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
          <p className="font-mono text-[clamp(15px,1.9vw,22px)] leading-tight break-words text-ink">
            {parts ? (
              <>
                {parts.before}
                <mark className="rounded bg-danger/30 px-1 text-danger">
                  {parts.match}
                </mark>
                {parts.after}
              </>
            ) : (
              vm.partial
            )}
            <span className="blink ml-0.5 text-accent">▌</span>
          </p>
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

      {!hasSomething && vm.voice === "listening" ? (
        <div className="flex items-center gap-2 rounded-md border border-line bg-bg/70 px-3 py-1.5 backdrop-blur">
          <span className="mic-ring relative h-1.5 w-1.5 rounded-full bg-accent" />
          <span className="text-[12px] text-muted">listening — say something</span>
        </div>
      ) : null}

      {vm.voice === "off" ? (
        <div className="rounded-md border border-line bg-bg/70 px-3 py-1.5 text-[12px] text-faint backdrop-blur">
          mic off — turn it on to correct the agent
        </div>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function PhraseLegend() {
  const [open, setOpen] = useState(false);
  return (
    <div className="pointer-events-auto flex flex-col items-end gap-1.5">
      {open ? (
        <div className="rise max-w-[15rem] rounded-md border border-line bg-bg/85 p-2.5 backdrop-blur">
          <div className="label mb-2">try saying</div>
          <ul className="flex flex-col gap-1">
            {EXAMPLE_PHRASES.map((p) => (
              <li
                key={p}
                className="font-mono text-[11.5px] leading-4 text-muted"
              >
                “{p}”
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

export function Hud({ vm }: { vm: EarshotViewModel }) {
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
          <Transcript vm={vm} />
          <div className="flex w-full items-end justify-start">
            <PolicyLine vm={vm} />
          </div>
        </div>
      </div>
    </>
  );
}
