"use client";

import clsx from "clsx";
import { useEffect, useMemo, useState } from "react";
import type { CorrectionEvent, PolicyRule, PolicyVersion } from "@/lib/types";
import { EmptyState } from "./primitives";
import { formatSkill } from "./format";

/* -------------------------------------------------------------------------- */

/** Typewriter cadence, and the ceiling that keeps the whole moment under 4 s. */
const TYPE_MS = 25;
const TYPE_MAX_TICKS = 120; // 120 × 25 ms = 3 s, whatever the rule's length
/** A distillation older than this is being browsed, not arriving. */
const FRESH_MS = 4000;

/**
 * Reveal `total` characters at ~25 ms each. Rules type in parallel, so three of
 * them land together rather than one after another.
 */
function useTypedCount(total: number, active: boolean): number {
  // Only ever written from the interval callback, so the typewriter costs no
  // cascading render and a row that is not typing needs no state at all.
  const [typed, setTyped] = useState(0);

  useEffect(() => {
    if (!active) return;
    const step = Math.max(1, Math.ceil(total / TYPE_MAX_TICKS));
    let i = 0;
    const id = setInterval(() => {
      i += step;
      setTyped(Math.min(total, i));
      if (i >= total) clearInterval(id);
    }, TYPE_MS);
    return () => clearInterval(id);
  }, [total, active]);

  return active ? Math.min(typed, total) : total;
}

function Caret() {
  return <span className="caret" aria-hidden />;
}

/* -------------------------------------------------------------------------- */

function evidenceText(
  ids: string[],
  corrections: CorrectionEvent[],
): string | null {
  if (ids.length === 0) return null;
  return ids
    .map((id) => {
      const c = corrections.find((x) => x.id === id);
      return c ? `${id} “${c.transcript}”` : id;
    })
    .join(" · ");
}

function RuleRow({
  rule,
  mode,
  corrections,
  typing = false,
}: {
  rule: PolicyRule;
  mode: "added" | "removed" | "kept";
  corrections: CorrectionEvent[];
  /** True the moment this rule arrives from a distillation: type it in. */
  typing?: boolean;
}) {
  const evidence = evidenceText(rule.evidence, corrections);
  const total = rule.when.length + rule.do.length;
  const typed = useTypedCount(total, typing);
  const shownWhen = rule.when.slice(0, typed);
  const shownDo = rule.do.slice(0, Math.max(0, typed - rule.when.length));
  const done = typed >= total;

  return (
    <li
      className={clsx(
        "rounded-md border px-3 py-2.5",
        mode === "added" && "border-ok/30 bg-ok-soft",
        mode === "removed" && "border-danger/30 bg-danger-soft",
        mode === "kept" && "border-line bg-white/[0.02]",
        typing && "sweep",
      )}
    >
      <div className="flex items-start gap-2">
        <span
          className={clsx(
            "mt-px shrink-0 font-mono text-[13px] leading-5",
            mode === "added" && "text-ok",
            mode === "removed" && "text-danger",
            mode === "kept" && "text-faint",
          )}
          aria-hidden
        >
          {mode === "added" ? "+" : mode === "removed" ? "−" : "·"}
        </span>
        <div
          className={clsx(
            "min-w-0 font-mono text-[12.5px] leading-relaxed",
            mode === "added" && "text-ok",
            mode === "removed" && "text-danger/80 line-through",
            mode === "kept" && "text-muted",
          )}
        >
          <span className="text-[11px] tracking-wider uppercase opacity-60">
            when{" "}
          </span>
          {shownWhen}
          {typed < rule.when.length ? <Caret /> : null}
          {typed >= rule.when.length ? (
            <>
              <br />
              <span className="text-[11px] tracking-wider uppercase opacity-60">
                do{" "}
              </span>
              {shownDo}
              {!done ? <Caret /> : null}
            </>
          ) : null}
        </div>
      </div>
      {evidence && mode !== "removed" && done ? (
        <p
          className={clsx(
            "mt-1.5 pl-5 text-[11.5px] leading-snug text-faint",
            typing && "fade-in",
          )}
        >
          evidence: {evidence}
        </p>
      ) : null}
    </li>
  );
}

/* -------------------------------------------------------------------------- */

export function PolicyPanel({
  policies,
  currentVersion,
  selectedVersion,
  corrections,
  lastDistilledAt = null,
  onSelectVersion,
  onActivateVersion,
}: {
  policies: PolicyVersion[];
  currentVersion: number;
  selectedVersion: number;
  corrections: CorrectionEvent[];
  /** epoch ms when the newest version landed; drives the typewriter. */
  lastDistilledAt?: number | null;
  onSelectVersion: (v: number) => void;
  onActivateVersion: (v: number) => void;
}) {
  const [showShots, setShowShots] = useState(false);

  /**
   * The distillation moment. A version that *just* arrived types itself in; one
   * the operator navigated back to simply renders. `clock` starts at mount and
   * is bumped once, by a timer, when the window closes — so the animation can
   * never replay and nothing is computed impurely during render.
   */
  const [clock, setClock] = useState(() => Date.now());
  useEffect(() => {
    if (lastDistilledAt == null) return;
    const id = setTimeout(() => setClock(Date.now()), FRESH_MS);
    return () => clearTimeout(id);
  }, [lastDistilledAt]);
  const fresh = lastDistilledAt != null && clock < lastDistilledAt + FRESH_MS;

  const selected =
    policies.find((p) => p.version === selectedVersion) ??
    policies[policies.length - 1];
  const parent = useMemo(
    () =>
      selected.parentVersion == null
        ? null
        : (policies.find((p) => p.version === selected.parentVersion) ?? null),
    [policies, selected],
  );

  const prevIds = new Set((parent?.rules ?? []).map((r) => r.id));
  const nextIds = new Set(selected.rules.map((r) => r.id));
  const added = selected.rules.filter((r) => !prevIds.has(r.id));
  const kept = selected.rules.filter((r) => prevIds.has(r.id));
  const removed = (parent?.rules ?? []).filter((r) => !nextIds.has(r.id));

  const newestVersion = policies.reduce((m, p) => Math.max(m, p.version), 0);
  const typing = fresh && selected.version === newestVersion;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
      {/* version selector */}
      <div className="mb-4 flex flex-wrap items-center gap-1.5">
        {policies.map((p) => (
          <button
            key={p.version}
            type="button"
            onClick={() => onSelectVersion(p.version)}
            aria-pressed={p.version === selectedVersion}
            className={clsx(
              "h-7 rounded-md border px-2.5 font-mono text-[12px] transition-colors duration-150 ease-out",
              p.version === selectedVersion
                ? "border-accent/60 bg-accent-soft text-accent"
                : "border-line bg-raised text-muted hover:border-line-strong hover:text-ink",
            )}
          >
            v{p.version}
            {p.version === currentVersion ? (
              <span className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-ok align-middle" />
            ) : null}
          </button>
        ))}
        {selected.version !== currentVersion ? (
          <button
            type="button"
            onClick={() => onActivateVersion(selected.version)}
            className="ml-1 h-7 rounded-md border border-line px-2.5 text-[12px] text-muted transition-colors duration-150 ease-out hover:border-accent/50 hover:text-accent"
          >
            Make active
          </button>
        ) : (
          <span className="ml-1 text-[11.5px] text-ok">active</span>
        )}
      </div>

      {/* changelog */}
      <div className="label mb-2">changelog</div>
      <p className="mb-5 max-w-[52ch] text-[12.5px] leading-relaxed text-muted">
        {selected.changelog}
      </p>

      {/* diff */}
      <div className="label mb-2">
        {parent ? `rules — diff vs v${parent.version}` : "rules"}
      </div>

      {selected.rules.length === 0 && removed.length === 0 ? (
        <EmptyState title="Base policy — no learned rules yet.">
          v0 is the raw LLM policy with nothing but the skill list. Every rule
          below it in later versions was earned by a human correction.
        </EmptyState>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {added.map((r) => (
            <RuleRow
              key={`v${selected.version}-${r.id}`}
              rule={r}
              mode="added"
              corrections={corrections}
              typing={typing}
            />
          ))}
          {removed.map((r) => (
            <RuleRow
              key={`v${selected.version}--${r.id}`}
              rule={r}
              mode="removed"
              corrections={corrections}
            />
          ))}
          {kept.map((r) => (
            <RuleRow
              key={`v${selected.version}-${r.id}`}
              rule={r}
              mode="kept"
              corrections={corrections}
            />
          ))}
        </ul>
      )}

      {/* few-shots, collapsed */}
      {selected.fewShots.length > 0 ? (
        <div className="mt-5">
          <button
            type="button"
            onClick={() => setShowShots((o) => !o)}
            aria-expanded={showShots}
            className="text-[11.5px] text-faint transition-colors duration-150 ease-out hover:text-accent"
          >
            {showShots ? "▾" : "▸"} few-shots ({selected.fewShots.length})
          </button>
          {showShots ? (
            <ul className="rise mt-2 flex flex-col gap-1.5">
              {selected.fewShots.map((f) => (
                <li
                  key={f.id}
                  className="rounded-md border border-line bg-white/[0.02] px-3 py-2"
                >
                  <p className="font-mono text-[11.5px] leading-relaxed text-faint">
                    {f.observationSummary}
                  </p>
                  <p className="mt-1 font-mono text-[12px] text-ink">
                    → {formatSkill(f.command)}
                  </p>
                  <p className="mt-1 text-[11px] text-faint">from {f.source}</p>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {selected.distilledFrom.length > 0 ? (
        <p className="mt-5 text-[11.5px] text-faint">
          distilled from {selected.distilledFrom.length} correction
          {selected.distilledFrom.length === 1 ? "" : "s"}:{" "}
          <span className="font-mono">{selected.distilledFrom.join(", ")}</span>
        </p>
      ) : null}
    </div>
  );
}
