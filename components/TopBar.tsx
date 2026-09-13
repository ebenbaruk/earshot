"use client";

import clsx from "clsx";
import { useEffect, useRef, useState } from "react";
import type { EarshotActions, EarshotViewModel } from "./view-model";
import { Button, Spinner, ThinkingDots, Toggle } from "./primitives";

/* -------------------------------------------------------------------------- */

function Wordmark() {
  return (
    <div className="flex shrink-0 items-center gap-2">
      <svg
        viewBox="0 0 20 20"
        aria-hidden
        className="h-[18px] w-[18px] text-accent"
      >
        <path
          d="M10 3.4a2.6 2.6 0 0 0-2.6 2.6v2.2a2.6 2.6 0 0 0 5.2 0V6A2.6 2.6 0 0 0 10 3.4Z"
          fill="currentColor"
        />
        <path
          d="M5.9 8.2v.4a4.1 4.1 0 0 0 8.2 0v-.4M10 12.7v3.1"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          fill="none"
        />
      </svg>
      <span className="text-[15px] font-semibold tracking-[-0.03em] text-ink">
        EARSHOT
      </span>
      <span className="hidden text-[12px] text-faint xl:inline">
        yell at your agent
      </span>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function MicButton({
  status,
  error,
  onStart,
  onStop,
}: {
  status: EarshotViewModel["voice"];
  error: string | null;
  onStart: () => void;
  onStop: () => void;
}) {
  const on = status === "listening";
  const label =
    status === "off"
      ? "mic off"
      : status === "connecting"
        ? "connecting"
        : status === "error"
          ? "mic error"
          : "listening";

  return (
    <button
      type="button"
      title={error ?? label}
      aria-label={label}
      onClick={on || status === "connecting" ? onStop : onStart}
      className={clsx(
        "relative inline-flex h-8 shrink-0 items-center gap-2 rounded-md border px-2.5 text-[12px] font-medium transition-colors duration-150 ease-out",
        status === "off" && "border-line bg-raised text-muted hover:border-line-strong hover:text-ink",
        status === "connecting" && "border-accent/40 bg-accent-soft text-accent",
        status === "listening" && "border-accent/60 bg-accent-soft text-accent",
        status === "error" && "border-danger/50 bg-danger-soft text-danger",
      )}
    >
      <span className="relative inline-flex h-2 w-2 items-center justify-center">
        <span
          className={clsx(
            "h-2 w-2 rounded-full",
            status === "off" && "bg-white/25",
            status === "connecting" && "blink bg-accent",
            status === "listening" && "mic-ring bg-accent",
            status === "error" && "bg-danger",
          )}
        />
      </span>
      {label}
    </button>
  );
}

/* -------------------------------------------------------------------------- */

function VersionPill({
  vm,
  actions,
}: {
  vm: EarshotViewModel;
  actions: EarshotActions;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  return (
    <div className="relative shrink-0" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="inline-flex h-8 items-center gap-1.5 rounded-md border border-line bg-raised px-2.5 font-mono text-[12px] text-ink transition-colors duration-150 ease-out hover:border-line-strong"
      >
        <span className="h-1.5 w-1.5 rounded-full bg-ok" />
        policy v{vm.currentVersion}
        <svg viewBox="0 0 10 6" className="h-1.5 w-2.5 text-faint" aria-hidden>
          <path d="M1 1l4 4 4-4" stroke="currentColor" strokeWidth="1.4" fill="none" />
        </svg>
      </button>
      {open ? (
        <div
          role="listbox"
          className="rise absolute top-9 left-0 z-30 min-w-[220px] rounded-md border border-line bg-raised p-1 shadow-2xl shadow-black/60"
        >
          {[...vm.policies].reverse().map((p) => (
            <button
              key={p.version}
              type="button"
              role="option"
              aria-selected={p.version === vm.currentVersion}
              onClick={() => {
                actions.activateVersion(p.version);
                setOpen(false);
              }}
              className="flex w-full items-center justify-between gap-4 rounded px-2 py-1.5 text-left transition-colors duration-150 ease-out hover:bg-white/[0.05]"
            >
              <span className="font-mono text-[12px] text-ink">v{p.version}</span>
              <span className="text-[11px] text-faint">
                {p.rules.length} rule{p.rules.length === 1 ? "" : "s"}
              </span>
              {p.version === vm.currentVersion ? (
                <span className="text-[11px] text-ok">active</span>
              ) : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function OverflowMenu({
  vm,
  actions,
}: {
  vm: EarshotViewModel;
  actions: EarshotActions;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const file = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const download = () => {
    const blob = new Blob([actions.exportJSON()], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `earshot-runs-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setOpen(false);
  };

  return (
    <div className="relative shrink-0" ref={ref}>
      <Button
        variant="ghost"
        aria-label="More"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="w-8 px-0"
      >
        <svg viewBox="0 0 14 4" className="h-1 w-3.5" aria-hidden>
          <circle cx="2" cy="2" r="1.4" fill="currentColor" />
          <circle cx="7" cy="2" r="1.4" fill="currentColor" />
          <circle cx="12" cy="2" r="1.4" fill="currentColor" />
        </svg>
      </Button>
      {open ? (
        <div
          role="menu"
          className="rise absolute top-9 right-0 z-30 min-w-[200px] rounded-md border border-line bg-raised p-1 shadow-2xl shadow-black/60"
        >
          <button
            type="button"
            role="menuitemcheckbox"
            aria-checked={vm.voiceReplies}
            title="The robot answers your corrections out loud. Its mic input is muted while it speaks."
            onClick={() => actions.setVoiceReplies(!vm.voiceReplies)}
            className="flex w-full items-center justify-between gap-3 rounded px-2 py-1.5 text-left text-[12.5px] text-ink transition-colors duration-150 ease-out hover:bg-white/[0.05]"
          >
            Robot voice
            <span
              className={clsx(
                "text-[11px]",
                vm.voiceReplies ? "text-accent" : "text-faint",
              )}
            >
              {vm.voiceReplies ? "on" : "off"}
            </span>
          </button>

          <div className="my-1 h-px bg-line" />

          <button
            type="button"
            role="menuitem"
            onClick={download}
            className="w-full rounded px-2 py-1.5 text-left text-[12.5px] text-ink transition-colors duration-150 ease-out hover:bg-white/[0.05]"
          >
            Export runs (JSON)
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => file.current?.click()}
            className="w-full rounded px-2 py-1.5 text-left text-[12.5px] text-ink transition-colors duration-150 ease-out hover:bg-white/[0.05]"
          >
            Import runs (JSON)…
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              actions.clearAll();
              setOpen(false);
            }}
            className="w-full rounded px-2 py-1.5 text-left text-[12.5px] text-danger transition-colors duration-150 ease-out hover:bg-white/[0.05]"
          >
            Reset data (runs, corrections, policy → v0)
          </button>
          <input
            ref={file}
            type="file"
            accept="application/json"
            className="hidden"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (f) actions.importJSON(await f.text());
              e.target.value = "";
              setOpen(false);
            }}
          />
        </div>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

export function TopBar({
  vm,
  actions,
}: {
  vm: EarshotViewModel;
  actions: EarshotActions;
}) {
  const [seedText, setSeedText] = useState(String(vm.seed));
  const running = vm.status === "running";
  const pending = vm.pendingCorrectionCount;
  const nextVersion = vm.currentVersion + 1;

  return (
    <header className="sticky top-0 z-20 shrink-0 border-b border-line bg-bg/90 backdrop-blur">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5 md:flex-nowrap">
        <Wordmark />

        <div className="hidden h-5 w-px shrink-0 bg-line md:block" />

        {/* run controls */}
        <div className="flex shrink-0 items-center gap-1.5">
          <Button
            variant="ghost"
            onClick={running ? actions.pause : actions.run}
            title={running ? "Pause the run" : "Start the run"}
          >
            {running ? (
              <>
                <svg viewBox="0 0 10 10" className="h-2.5 w-2.5" aria-hidden>
                  <rect x="1" y="1" width="3" height="8" fill="currentColor" />
                  <rect x="6" y="1" width="3" height="8" fill="currentColor" />
                </svg>
                Pause
              </>
            ) : (
              <>
                <svg viewBox="0 0 10 10" className="h-2.5 w-2.5" aria-hidden>
                  <path d="M2 1l7 4-7 4z" fill="currentColor" />
                </svg>
                Run
              </>
            )}
          </Button>
          <Button
            variant="ghost"
            onClick={() => actions.reset(Number(seedText) || vm.seed)}
            title="Reset the world"
          >
            Reset
          </Button>
          <label className="flex h-8 items-center gap-1.5 rounded-md border border-line bg-raised pr-1.5 pl-2.5">
            <span className="text-[11px] tracking-wider text-faint uppercase">
              seed
            </span>
            <input
              value={seedText}
              inputMode="numeric"
              onChange={(e) => setSeedText(e.target.value.replace(/[^0-9]/g, ""))}
              onBlur={() => actions.setSeed(Number(seedText) || vm.seed)}
              className="tnum w-[4.5rem] bg-transparent font-mono text-[12px] text-ink outline-none"
              aria-label="Random seed"
            />
          </label>
        </div>

        <div className="hidden h-5 w-px shrink-0 bg-line md:block" />

        <VersionPill vm={vm} actions={actions} />

        <Button
          variant="primary"
          disabled={pending === 0 || vm.distilling}
          onClick={actions.distill}
          title={
            pending === 0
              ? `No new corrections since v${vm.currentVersion}`
              : `Distil ${pending} correction${pending === 1 ? "" : "s"} into v${nextVersion}`
          }
        >
          {vm.distilling ? (
            <>
              <Spinner />
              Distilling
              <ThinkingDots className="ml-0.5" />
            </>
          ) : (
            <>
              Distill{pending > 0 ? ` ${pending}` : ""} correction
              {pending === 1 ? "" : "s"} → v{nextVersion}
            </>
          )}
        </Button>

        {vm.distillError ? (
          <span className="text-[12px] text-danger">{vm.distillError}</span>
        ) : null}

        <div className="ml-auto flex items-center gap-1.5">
          <Toggle
            checked={vm.correctionsEnabled}
            onChange={actions.setCorrectionsEnabled}
            label={vm.correctionsEnabled ? "corrections on" : "corrections off"}
            title="Ablation — turn voice corrections off to measure the autonomous policy"
          />
          <MicButton
            status={vm.voice}
            error={vm.voiceError}
            onStart={actions.startVoice}
            onStop={actions.stopVoice}
          />
          <OverflowMenu vm={vm} actions={actions} />
        </div>
      </div>
    </header>
  );
}
