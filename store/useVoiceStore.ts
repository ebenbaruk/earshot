/**
 * EARSHOT — voice store.
 *
 * Thin zustand wrapper over `createStreamingClient`. The store keeps its own
 * event sinks registered with the client for the whole session and forwards to
 * whatever consumer events are currently installed, so the integrator can swap
 * in the sim callbacks at any time via `setEvents()` without tearing the socket
 * down.
 */

"use client";

import { create } from "zustand";
import type { VoiceEvents, VoiceStatus } from "@/lib/types";
import {
  createStreamingClient,
  type StreamingClient,
} from "@/lib/voice/streaming-client";

export interface VoiceFinal {
  transcript: string;
  raw: string;
  at: number;
  hadStop: boolean;
}

export interface VoiceStore {
  status: VoiceStatus;
  /** Latest partial transcript for the turn in flight ("" between turns). */
  partial: string;
  lastFinal: VoiceFinal | null;
  /**
   * Time from the start of the utterance (SpeechStarted, or the first partial
   * of the turn as a fallback) to the moment the stop word was detected.
   */
  lastStopLatencyMs: number | null;
  error: string | null;
  /**
   * Mic loudness, 0..1, updated at the 20 Hz frame rate. Read it imperatively
   * (`useVoiceStore.getState().level`) from an animation frame — subscribing a
   * React component to it would re-render the app twenty times a second.
   */
  level: number;
  /** True while outgoing audio frames are being dropped (the robot is talking). */
  muted: boolean;
  start(events?: VoiceEvents): Promise<void>;
  stop(): Promise<void>;
  /** Swap the consumer callbacks at any time, including while listening. */
  setEvents(events: VoiceEvents | null): void;
  /**
   * Drop / resume outgoing audio frames. Used by lib/voice/tts.ts so the
   * robot's own voice is never transcribed as a correction.
   */
  muteInput(muted: boolean): void;
}

/** Module-level: one mic session per tab, mirrored by the store. */
let client: StreamingClient | null = null;
let consumer: VoiceEvents | null = null;

export const useVoiceStore = create<VoiceStore>()((set) => {
  /**
   * Permanently installed on the client. Updates the store, then forwards to
   * whichever consumer is currently bound.
   */
  const sinks: VoiceEvents = {
    onStop: (info) => {
      consumer?.onStop(info);
    },
    onFinal: (info) => {
      set({ partial: "", lastFinal: info });
      consumer?.onFinal(info);
    },
    onPartial: (partial) => {
      set({ partial });
      consumer?.onPartial?.(partial);
    },
    onStatus: (status, detail) => {
      set({
        status,
        error: status === "error" ? (detail ?? "Voice error.") : null,
        ...(status === "off" || status === "error" ? { partial: "" } : {}),
      });
      consumer?.onStatus?.(status, detail);
    },
  };

  function ensureClient(): StreamingClient {
    if (client) return client;
    client = createStreamingClient(sinks, {
      onStopMetrics: (metrics) => {
        set({
          lastStopLatencyMs:
            metrics.sinceSpeechStartedMs ?? metrics.sinceFirstPartialMs ?? null,
        });
      },
      onLevel: (level) => {
        set({ level });
      },
    });
    return client;
  }

  return {
    status: "off",
    partial: "",
    lastFinal: null,
    lastStopLatencyMs: null,
    error: null,
    level: 0,
    muted: false,

    async start(events) {
      if (events !== undefined) consumer = events;
      const c = ensureClient();
      set({ error: null, partial: "", lastStopLatencyMs: null, level: 0 });
      try {
        await c.start();
      } catch (cause) {
        // onStatus already recorded the error; swallow so callers need no catch.
        set({
          error:
            cause instanceof Error ? cause.message : String(cause ?? "Voice error."),
        });
      }
    },

    async stop() {
      await client?.stop();
      set({ status: "off", partial: "", level: 0, muted: false });
    },

    setEvents(events) {
      consumer = events;
    },

    muteInput(muted) {
      client?.setMuted(muted);
      set(muted ? { muted: true, level: 0 } : { muted: false });
    },
  };
});

/** Test/HMR escape hatch: drop the module-level client. */
export function __resetVoiceClient() {
  client = null;
  consumer = null;
}
