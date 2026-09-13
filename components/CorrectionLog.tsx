"use client";

import clsx from "clsx";
import { Fragment, useState } from "react";
import type { CorrectionEvent, ParseSource, WorldState } from "@/lib/types";
import { Button, Chip, EmptyState } from "./primitives";
import {
  OUTCOME_LABEL,
  formatLatency,
  formatRunTime,
  formatSkill,
  outcomeTone,
  type Tone,
} from "./format";

const SOURCE_TONE: Record<ParseSource, Tone> = {
  grammar: "ok",
  llm: "accent",
  text: "neutral",
};

const SOURCE_TITLE: Record<ParseSource, string> = {
  grammar: "Matched by the local grammar — no round trip",
  llm: "Parsed by the LLM when the grammar missed",
  text: "Typed, not spoken",
};

/* -------------------------------------------------------------------------- */

function ContextTable({ states }: { states: WorldState[] }) {
  const rows = states.slice(-3);
  const n = (v: number) => v.toFixed(1);
  return (
    <div className="overflow-x-auto rounded border border-line bg-bg/60">
      <table className="w-full min-w-[22rem] border-collapse font-mono text-[11px]">
        <thead>
          <tr className="text-faint">
            {["t", "x", "y", "z", "jaw", "holding", "packed"].map((h) => (
              <th
                key={h}
                className="border-b border-line px-2 py-1.5 text-left font-normal tracking-wider uppercase"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="tnum text-muted">
          {rows.map((s, i) => (
            <tr key={i} className={i === rows.length - 1 ? "text-ink" : undefined}>
              <td className="px-2 py-1.5">{formatRunTime(s.t)}</td>
              <td className="px-2 py-1.5">{n(s.gripper.pos.x)}</td>
              <td className="px-2 py-1.5">{n(s.gripper.pos.y)}</td>
              <td className="px-2 py-1.5">{n(s.gripper.z)}</td>
              <td className="px-2 py-1.5">{n(s.gripper.width)}</td>
              <td className="px-2 py-1.5">{s.gripper.holding ?? "—"}</td>
              <td className="px-2 py-1.5">{s.stagesDone}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function CorrectionItem({ c }: { c: CorrectionEvent }) {
  const [open, setOpen] = useState(false);
  const stopped = c.tStop != null;

  return (
    <li className="relative pb-4 pl-5 last:pb-0">
      {/* timeline rail */}
      <span
        aria-hidden
        className="absolute top-1.5 bottom-0 left-[3px] w-px bg-line"
      />
      <span
        aria-hidden
        className={clsx(
          "absolute top-1.5 left-0 h-[7px] w-[7px] rounded-full",
          stopped ? "bg-danger" : "bg-accent",
        )}
      />

      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="tnum font-mono text-[11px] text-faint">
          {formatRunTime(c.ts)}
        </span>
        <span className="font-mono text-[11px] text-faint">{c.id}</span>
        {stopped ? <Chip tone="danger">stop</Chip> : null}
        {c.preventive ? <Chip tone="neutral">preventive</Chip> : null}
      </div>

      <p className="mt-1.5 text-[13.5px] leading-snug text-ink">
        “{c.transcript}”
      </p>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <Chip tone="accent" mono>
          {formatSkill(c.parsedCommand)}
        </Chip>
        <Chip tone={SOURCE_TONE[c.parseSource]}>
          <span title={SOURCE_TITLE[c.parseSource]}>{c.parseSource}</span>
        </Chip>
        {c.outcome ? (
          <Chip tone={outcomeTone(c.outcome)}>{OUTCOME_LABEL[c.outcome]}</Chip>
        ) : null}
        <span className="tnum font-mono text-[11px] text-faint">
          {c.latency.stopMs != null
            ? `stop ${formatLatency(c.latency.stopMs)} · `
            : ""}
          parse {formatLatency(c.latency.parseMs)}
        </span>
      </div>

      {c.rejectedPolicyAction ? (
        <p className="mt-2 text-[12px] leading-relaxed text-muted">
          <span className="text-faint">policy was about to </span>
          <span className="font-mono text-[11.5px] text-muted">
            {formatSkill(c.rejectedPolicyAction.command)}
          </span>
          <span className="text-faint">
            {" "}
            — “{c.rejectedPolicyAction.reasoning}”
          </span>
        </p>
      ) : null}

      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="mt-2 text-[11.5px] text-faint transition-colors duration-150 ease-out hover:text-accent"
      >
        {open ? "▾" : "▸"} context (2 s before)
      </button>
      {open ? (
        <div className="rise mt-2">
          <ContextTable states={c.stateBefore} />
        </div>
      ) : null}
    </li>
  );
}

/* -------------------------------------------------------------------------- */

export function CorrectionLog({
  corrections,
  onSendText,
}: {
  corrections: CorrectionEvent[];
  onSendText: (text: string) => void;
}) {
  const [draft, setDraft] = useState("");
  const items = [...corrections].reverse();

  const submit = () => {
    const t = draft.trim();
    if (!t) return;
    onSendText(t);
    setDraft("");
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {items.length === 0 ? (
          <EmptyState title="No corrections yet">
            Every time you interrupt the agent, Earshot records what you said,
            what the policy was about to do, and the two seconds of state before
            it. That record is the training signal — distil it into a new policy
            version when you have a few.
          </EmptyState>
        ) : (
          <ol className="flex flex-col">
            {items.map((c, i) => (
              <Fragment key={c.id}>
                {c.runId !== items[i - 1]?.runId ? (
                  <li className="mb-2 flex items-center gap-2 not-first:mt-3">
                    <span className="label">{c.runId.replace("-", " ")}</span>
                    <span className="h-px flex-1 bg-line" />
                  </li>
                ) : null}
                <CorrectionItem c={c} />
              </Fragment>
            ))}
          </ol>
        )}
      </div>

      <div className="shrink-0 border-t border-line p-2.5">
        <div className="flex items-center gap-2">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
            }}
            placeholder="Type a correction…"
            aria-label="Type a correction"
            className="h-8 min-w-0 flex-1 rounded-md border border-line bg-input px-2.5 font-mono text-[12.5px] text-ink placeholder:text-faint focus:border-accent/60 focus:outline-none"
          />
          <Button variant="primary" onClick={submit} disabled={!draft.trim()}>
            Send
          </Button>
        </div>
      </div>
    </div>
  );
}
