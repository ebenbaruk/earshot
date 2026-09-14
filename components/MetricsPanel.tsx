"use client";

import { useMemo } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { OBJECT_COUNT, type CorrectionEvent, type RunRecord } from "@/lib/types";
import { EmptyState } from "./primitives";

/** A run counts as supervised only if a human actually intervened. */
function isSupervised(r: RunRecord): boolean {
  return r.correctionsEnabled && r.interventions > 0;
}

/**
 * Operator attention consumed by one correction: from the stop to the final
 * transcript, plus a fixed allowance for watching the correction execute.
 * Clamped so a stray value cannot dominate the total.
 */
function attentionMs(c: CorrectionEvent): number {
  const listening = c.tStop != null ? Math.max(0, c.ts - c.tStop) : 0;
  return Math.min(30_000, Math.max(3_000, listening + 2_500));
}

interface Load {
  attentionMs: number;
  /** share of the run the robot ran with nobody attending to it, 0..1 */
  autonomy: number | null;
  /** how many robots one operator could watch at this intervention rate */
  robotsPerOperator: number | null;
}

function loadOf(r: RunRecord, byId: Map<string, CorrectionEvent>): Load {
  const total = r.correctionIds.reduce((sum, id) => {
    const c = byId.get(id);
    return sum + (c ? attentionMs(c) : 0);
  }, 0);
  if (!r.durationMs || r.durationMs <= 0) return { attentionMs: total, autonomy: null, robotsPerOperator: null };
  const share = Math.min(1, total / r.durationMs);
  return {
    attentionMs: total,
    autonomy: 1 - share,
    robotsPerOperator: share <= 0 ? Infinity : 1 / share,
  };
}

const fmtSeconds = (ms: number) => `${Math.round(ms / 1000)} s`;
const fmtPct = (v: number | null) => (v == null ? "—" : `${Math.round(v * 100)} %`);
const fmtRobots = (v: number | null) =>
  v == null ? "—" : v === Infinity || v >= 20 ? "20+" : v.toFixed(1);

/**
 * Series colours. Two categorical hues, validated against the panel surface
 * (#110f0e) for the OKLCH lightness band, chroma floor, CVD separation
 * (ΔE 8.0 protan) and 3:1 contrast. Identity is never colour-alone: every
 * series carries a legend swatch AND its text label.
 */
const SUPERVISED = "#db7724"; // amber — runs with voice corrections enabled
const AUTONOMOUS = "#30a268"; // green — ablation runs, no human in the loop
const GRID = "rgba(255,255,255,0.07)";
const AXIS = "#6a645d";

const STAGE_TICKS = Array.from({ length: OBJECT_COUNT + 1 }, (_, i) => i);

interface Point {
  run: number;
  supervised: number | null;
  autonomous: number | null;
  interventions: number;
  policyVersion: number;
  id: string;
}

/* -------------------------------------------------------------------------- */

function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="min-w-0 rounded-md border border-line bg-white/[0.02] px-3 py-2.5">
      <div className="label mb-1.5 leading-[1.35]">{label}</div>
      <div className="tnum font-mono text-[15px] leading-5 text-ink">{value}</div>
      {hint ? (
        <div className="mt-1 truncate text-[11px] text-faint">{hint}</div>
      ) : null}
    </div>
  );
}

function Swatch({ color, label, value }: { color: string; label: string; value: string }) {
  return (
    <span className="flex items-center gap-1.5 text-[11.5px] text-muted">
      <span
        aria-hidden
        className="h-0.5 w-3.5 rounded-full"
        style={{ backgroundColor: color }}
      />
      {label}
      <span className="tnum font-mono text-ink">{value}</span>
    </span>
  );
}

interface TipPayload {
  dataKey?: string | number;
  value?: number | string;
  color?: string;
  name?: string;
}

function ChartTip({
  active,
  payload,
  label,
  unit,
}: {
  active?: boolean;
  payload?: TipPayload[];
  label?: string | number;
  unit: string;
}) {
  if (!active || !payload?.length) return null;
  const rows = payload.filter((p) => p.value != null);
  if (!rows.length) return null;
  return (
    <div className="rounded-md border border-line bg-raised px-2.5 py-2 shadow-xl shadow-black/60">
      <div className="label mb-1.5">run {label}</div>
      {rows.map((p) => (
        <div
          key={String(p.dataKey)}
          className="flex items-center gap-2 text-[11.5px] whitespace-nowrap text-muted"
        >
          <span
            aria-hidden
            className="h-0.5 w-3 rounded-full"
            style={{ backgroundColor: p.color }}
          />
          {p.name}
          <span className="tnum ml-auto font-mono text-ink">
            {p.value} {unit}
          </span>
        </div>
      ))}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

export function MetricsPanel({
  runs,
  corrections,
}: {
  runs: RunRecord[];
  corrections: CorrectionEvent[];
}) {
  const data = useMemo<Point[]>(
    () =>
      runs.map((r, i) => ({
        run: i + 1,
        id: r.id,
        policyVersion: r.policyVersion,
        supervised: isSupervised(r) ? r.stagesDone : null,
        autonomous: isSupervised(r) ? null : r.stagesDone,
        interventions: r.interventions,
      })),
    [runs],
  );

  /** Where the policy version changed — the "we distilled here" markers. */
  const bumps = useMemo(
    () =>
      data.filter(
        (p, i) => i > 0 && p.policyVersion !== data[i - 1].policyVersion,
      ),
    [data],
  );

  const summary = useMemo(() => {
    const supervised = runs.filter(isSupervised);
    const autonomous = runs.filter((r) => !isSupervised(r));
    const interventions = supervised.map((r) => r.interventions);

    const first = autonomous[0];
    const last = autonomous[autonomous.length - 1];

    const stops = corrections
      .map((c) => c.latency.stopMs)
      .filter((v): v is number => v != null);
    const avgStop = stops.length
      ? Math.round(stops.reduce((a, b) => a + b, 0) / stops.length)
      : null;

    const latestSupervised = supervised[supervised.length - 1];
    const latestAutonomous = last;

    // Supervision cost: first supervised run vs the latest run of any kind.
    const byId = new Map(corrections.map((c) => [c.id, c]));
    const firstSupervised = supervised[0];
    const latestRun = runs[runs.length - 1];
    const loadFirst = firstSupervised ? loadOf(firstSupervised, byId) : null;
    const loadLast = latestRun ? loadOf(latestRun, byId) : null;
    const arrow = (a: string, b: string) => (a === b ? a : `${a} → ${b}`);

    return {
      attention: loadFirst && loadLast ? arrow(fmtSeconds(loadFirst.attentionMs), fmtSeconds(loadLast.attentionMs)) : "—",
      attentionHint: loadFirst && loadLast ? `per run, v${firstSupervised.policyVersion} → v${latestRun.policyVersion}` : "needs a supervised run",
      autonomy: loadFirst && loadLast ? arrow(fmtPct(loadFirst.autonomy), fmtPct(loadLast.autonomy)) : "—",
      autonomyHint: "share of the run with nobody attending",
      robots: loadFirst && loadLast ? arrow(fmtRobots(loadFirst.robotsPerOperator), fmtRobots(loadLast.robotsPerOperator)) : "—",
      robotsHint: "robots one operator can watch at this rate",
      interventionTrail: interventions.length ? interventions.join(" → ") : "—",
      stagesDelta:
        first && last
          ? `${first.stagesDone} → ${last.stagesDone} / ${OBJECT_COUNT}`
          : "—",
      stagesHint:
        first && last
          ? `autonomous, v${first.policyVersion} vs v${last.policyVersion}`
          : "run an ablation to compare",
      avgStop: avgStop != null ? `${avgStop} ms` : "—",
      avgStopHint: `${stops.length} measured stop${stops.length === 1 ? "" : "s"}`,
      latestSupervised: latestSupervised
        ? `${latestSupervised.stagesDone} / ${OBJECT_COUNT}`
        : "—",
      latestAutonomous: latestAutonomous
        ? `${latestAutonomous.stagesDone} / ${OBJECT_COUNT}`
        : "—",
    };
  }, [runs, corrections]);

  if (runs.length === 0) {
    return (
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <EmptyState title="No runs recorded yet">
          Finish a run and it lands here. The chart plots stages packed per run,
          split between supervised runs and the autonomous ablation — the gap
          between the two lines closing is the whole point.
        </EmptyState>
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
      {/* summary strip */}
      <div className="mb-5 grid grid-cols-2 gap-2 xl:grid-cols-3">
        <Stat
          label="interventions"
          value={summary.interventionTrail}
          hint="per supervised run"
        />
        <Stat
          label="stage success"
          value={summary.stagesDelta}
          hint={summary.stagesHint}
        />
        <Stat
          label="avg stop latency"
          value={summary.avgStop}
          hint={summary.avgStopHint}
        />
      </div>

      {/* supervision cost — the business reading of the same numbers */}
      <div className="mb-1.5 label">supervision cost</div>
      <div className="mb-2 grid grid-cols-2 gap-2 xl:grid-cols-3">
        <Stat label="operator attention" value={summary.attention} hint={summary.attentionHint} />
        <Stat label="autonomy" value={summary.autonomy} hint={summary.autonomyHint} />
        <Stat label="robots per operator" value={summary.robots} hint={summary.robotsHint} />
      </div>
      <p className="mb-5 max-w-[52ch] text-[12px] leading-relaxed text-muted">
        Every autonomous fleet keeps humans on standby for the moments the policy
        can&apos;t handle. Attention is what they cost; autonomy is what the
        distilled policy gives back. When attention reaches zero, the same
        operator is free to watch the next robot.
      </p>

      {/* improvement across iterations */}
      <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-2">
        <div className="label">stages packed per run</div>
        <div className="flex flex-wrap items-center gap-3">
          <Swatch
            color={SUPERVISED}
            label="with corrections"
            value={summary.latestSupervised}
          />
          <Swatch
            color={AUTONOMOUS}
            label="autonomous"
            value={summary.latestAutonomous}
          />
        </div>
      </div>

      <div className="h-[210px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 12, right: 10, bottom: 4, left: -22 }}>
            <CartesianGrid stroke={GRID} vertical={false} />
            <XAxis
              dataKey="run"
              tick={{ fill: AXIS, fontSize: 11 }}
              tickLine={false}
              axisLine={{ stroke: GRID }}
            />
            <YAxis
              domain={[0, OBJECT_COUNT]}
              ticks={STAGE_TICKS}
              tick={{ fill: AXIS, fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              width={40}
            />
            {bumps.map((b) => (
              <ReferenceLine
                key={b.id}
                x={b.run}
                stroke="rgba(255,255,255,0.22)"
                strokeDasharray="3 3"
                label={{
                  value: `v${b.policyVersion}`,
                  position: "top",
                  fill: AXIS,
                  fontSize: 10,
                }}
              />
            ))}
            <Tooltip
              cursor={{ stroke: "rgba(255,255,255,0.18)" }}
              content={<ChartTip unit={`/ ${OBJECT_COUNT}`} />}
            />
            <Line
              type="monotone"
              dataKey="supervised"
              name="with corrections"
              stroke={SUPERVISED}
              strokeWidth={2}
              dot={{ r: 4, fill: SUPERVISED, stroke: "#110f0e", strokeWidth: 2 }}
              activeDot={{ r: 5 }}
              connectNulls
              isAnimationActive={false}
            />
            <Line
              type="monotone"
              dataKey="autonomous"
              name="autonomous"
              stroke={AUTONOMOUS}
              strokeWidth={2}
              dot={{ r: 4, fill: AUTONOMOUS, stroke: "#110f0e", strokeWidth: 2 }}
              activeDot={{ r: 5 }}
              connectNulls
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* interventions per run */}
      <div className="mt-5 mb-1.5 label">interventions per run</div>
      <div className="h-[110px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 6, right: 10, bottom: 4, left: -22 }}>
            <CartesianGrid stroke={GRID} vertical={false} />
            <XAxis
              dataKey="run"
              tick={{ fill: AXIS, fontSize: 11 }}
              tickLine={false}
              axisLine={{ stroke: GRID }}
            />
            <YAxis
              allowDecimals={false}
              tick={{ fill: AXIS, fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              width={40}
            />
            <Tooltip
              cursor={{ fill: "rgba(255,255,255,0.04)" }}
              content={<ChartTip unit="" />}
            />
            <Bar
              dataKey="interventions"
              name="interventions"
              fill={SUPERVISED}
              radius={[4, 4, 0, 0]}
              maxBarSize={22}
              isAnimationActive={false}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <p className="mt-4 max-w-[52ch] text-[12px] leading-relaxed text-muted">
        Each distillation is marked on the x axis. The green line is the agent
        running with no human in the loop — when it reaches {OBJECT_COUNT} /{" "}
        {OBJECT_COUNT} and the bars
        reach zero, the corrections have been absorbed into the policy.
      </p>
    </div>
  );
}
