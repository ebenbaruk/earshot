"use client";

/**
 * EARSHOT — voice layer bench.
 *
 * Temporary page for testing the mic path by hand. Not part of the demo UI.
 * Open http://localhost:3000/voice-preview, hit "Start mic", and say
 * "stop, a bit to the left".
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { VoiceEvents } from "@/lib/types";
import { STOP_WORDS } from "@/lib/types";
import { useVoiceStore } from "@/store/useVoiceStore";
import { DEFAULT_KEYTERMS } from "@/lib/voice/keyterms";
import { STREAMING_PARAMS } from "@/lib/voice/streaming-client";

interface FinalRow {
  id: number;
  transcript: string;
  raw: string;
  hadStop: boolean;
  /** ms between the onStop for this turn and this final */
  stopToFinalMs: number | null;
  /** ms from the start of the utterance to the stop detection */
  stopLatencyMs: number | null;
}

const STATUS_STYLE: Record<string, string> = {
  off: "bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  connecting: "bg-amber-200 text-amber-900 dark:bg-amber-900 dark:text-amber-100",
  listening: "bg-emerald-200 text-emerald-900 dark:bg-emerald-900 dark:text-emerald-100",
  error: "bg-red-200 text-red-900 dark:bg-red-900 dark:text-red-100",
};

export default function VoicePreviewPage() {
  const status = useVoiceStore((s) => s.status);
  const partial = useVoiceStore((s) => s.partial);
  const error = useVoiceStore((s) => s.error);
  const lastStopLatencyMs = useVoiceStore((s) => s.lastStopLatencyMs);
  const start = useVoiceStore((s) => s.start);
  const stop = useVoiceStore((s) => s.stop);

  const [finals, setFinals] = useState<FinalRow[]>([]);
  const [stopFlash, setStopFlash] = useState<number | null>(null);
  const nextId = useRef(0);
  const lastStopAt = useRef<number | null>(null);
  const lastStopLatency = useRef<number | null>(null);

  const events = useMemo<VoiceEvents>(
    () => ({
      onStop: ({ at }) => {
        lastStopAt.current = at;
        // The client reports stop metrics to the store before it calls onStop.
        lastStopLatency.current = useVoiceStore.getState().lastStopLatencyMs;
        setStopFlash(at);
      },
      onFinal: ({ transcript, raw, at, hadStop }) => {
        const stopAt = hadStop ? lastStopAt.current : null;
        const latency = hadStop ? lastStopLatency.current : null;
        lastStopAt.current = null;
        lastStopLatency.current = null;
        setFinals((rows) =>
          [
            {
              id: nextId.current++,
              transcript,
              raw,
              hadStop,
              stopToFinalMs: stopAt === null ? null : Math.round(at - stopAt),
              stopLatencyMs: latency === null ? null : Math.round(latency),
            },
            ...rows,
          ].slice(0, 40),
        );
        setStopFlash(null);
      },
    }),
    [],
  );

  const listening = status === "listening" || status === "connecting";

  const onToggle = useCallback(() => {
    if (listening) void stop();
    else void start(events);
  }, [listening, start, stop, events]);

  // Demonstrates the swap-after-start path the integrator will use.
  useEffect(() => {
    useVoiceStore.getState().setEvents(events);
  }, [events]);

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-10">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Earshot voice bench
          </h1>
          <p className="text-sm text-zinc-500">
            AssemblyAI {STREAMING_PARAMS.speech_model} · {STREAMING_PARAMS.mode} ·
            turn silence {STREAMING_PARAMS.min_turn_silence}/
            {STREAMING_PARAMS.max_turn_silence} ms
          </p>
        </div>
        <button
          type="button"
          onClick={onToggle}
          className={`rounded-xl px-6 py-4 text-lg font-semibold text-white transition ${
            listening
              ? "bg-red-600 hover:bg-red-700"
              : "bg-emerald-600 hover:bg-emerald-700"
          }`}
        >
          {listening ? "Stop mic" : "Start mic"}
        </button>
      </header>

      <section className="flex flex-wrap items-center gap-3 text-sm">
        <span
          className={`rounded-full px-3 py-1 font-medium ${
            STATUS_STYLE[status] ?? STATUS_STYLE.off
          }`}
        >
          {status}
        </span>
        <span className="font-mono text-zinc-500">
          stop latency:{" "}
          {lastStopLatencyMs === null ? "—" : `${Math.round(lastStopLatencyMs)} ms`}
        </span>
        {stopFlash !== null && (
          <span className="rounded-full bg-red-600 px-3 py-1 font-semibold text-white">
            STOP
          </span>
        )}
        {error && <span className="text-red-600">{error}</span>}
      </section>

      <section>
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">
          Partial
        </h2>
        <div className="min-h-24 rounded-xl border border-zinc-200 bg-zinc-50 p-4 font-mono text-2xl leading-snug break-words dark:border-zinc-800 dark:bg-zinc-900">
          {partial || (
            <span className="text-zinc-400">
              {listening ? "listening…" : "not listening"}
            </span>
          )}
        </div>
      </section>

      <section className="flex-1">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">
          Finals ({finals.length})
        </h2>
        <ul className="flex flex-col gap-2">
          {finals.length === 0 && (
            <li className="text-sm text-zinc-400">
              Nothing yet. Try “stop”, then “stop, a bit to the left”.
            </li>
          )}
          {finals.map((row) => (
            <li
              key={row.id}
              className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800"
            >
              <div className="mb-1 flex flex-wrap items-center gap-2 text-xs">
                {row.hadStop ? (
                  <span className="rounded bg-red-600 px-2 py-0.5 font-semibold text-white">
                    hadStop
                  </span>
                ) : (
                  <span className="rounded bg-zinc-300 px-2 py-0.5 font-semibold text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200">
                    no stop
                  </span>
                )}
                {row.stopLatencyMs !== null && (
                  <span className="font-mono text-zinc-500">
                    speech → stop {row.stopLatencyMs} ms
                  </span>
                )}
                {row.stopToFinalMs !== null && (
                  <span className="font-mono text-zinc-500">
                    stop → final {row.stopToFinalMs} ms
                  </span>
                )}
              </div>
              <div className="font-mono text-base break-words">
                {row.transcript || (
                  <span className="text-zinc-400">(stop only — no correction)</span>
                )}
              </div>
              {row.raw !== row.transcript && (
                <div className="mt-1 font-mono text-xs text-zinc-500 break-words">
                  raw: {row.raw}
                </div>
              )}
            </li>
          ))}
        </ul>
      </section>

      <footer className="border-t border-zinc-200 pt-4 text-xs text-zinc-500 dark:border-zinc-800">
        <p>
          <strong>Stop words:</strong> {STOP_WORDS.join(", ")}
        </p>
        <p className="mt-1">
          <strong>Keyterms ({DEFAULT_KEYTERMS.length}):</strong>{" "}
          {DEFAULT_KEYTERMS.join(", ")}
        </p>
      </footer>
    </main>
  );
}
