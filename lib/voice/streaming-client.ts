/**
 * EARSHOT — AssemblyAI Universal-3.5 Pro streaming client (browser).
 *
 * Shell around the pure reducer in ./turn-reducer.ts. It owns:
 *   - the temporary token fetch (/api/token)
 *   - the mic + AudioWorklet graph that produces 50 ms PCM16 @ 16 kHz frames
 *   - the WebSocket, and one automatic reconnect on an unexpected close
 *   - the timers the reducer asks for
 * All transcript logic lives in the reducer, which is unit-tested.
 *
 * Docs verified via Context7 (/websites/assemblyai):
 *   - streaming/api-spec/streaming-websocket (query params)
 *   - streaming/message-sequence (Begin / SpeechStarted / Turn / Termination)
 *   - voice-agents/best-practices (turn-detection presets, keyterms limits)
 *   - streaming/authenticate-with-a-temporary-token
 */

import type { VoiceEvents, VoiceStatus } from "@/lib/types";
import { STOP_WORDS } from "@/lib/types";
import { DEFAULT_KEYTERMS, sanitizeKeyterms } from "./keyterms";
import {
  DEFAULT_FORMATTED_TIMEOUT_MS,
  initialTurnState,
  reduceTurn,
  type ServerMessage,
  type StopMetrics,
  type TurnEffect,
  type TurnState,
} from "./turn-reducer";

export const STREAMING_WS_URL = "wss://streaming.assemblyai.com/v3/ws";
export const TARGET_SAMPLE_RATE = 16000;
/** 800 samples = 50 ms at 16 kHz. */
export const FRAME_SAMPLES = 800;

/**
 * Connection query parameters.
 *
 * `speech_model=universal-3-5-pro` — the model the hackathon targets.
 * `encoding=pcm_s16le`, `sample_rate=16000` — what the worklet produces.
 * `mode=min_latency` — the documented latency/accuracy dial
 *   (min_latency | balanced | max_accuracy). Our critical path is stop-word
 *   detection on *partials*, so we buy the fastest partials available.
 * `min_turn_silence=100`, `max_turn_silence=800` — the documented "Fast" preset
 *   ("quick confirmations, IVR, yes/no questions"), which matches our short
 *   command utterances. Universal-3.5 Pro uses punctuation-based turn
 *   detection with this silence family; the older
 *   `end_of_turn_confidence_threshold` / `min_end_of_turn_silence_when_confident`
 *   family and `format_turns` are legacy and do NOT apply to this model
 *   (it always returns formatted transcripts).
 */
export const STREAMING_PARAMS: Readonly<Record<string, string>> = {
  encoding: "pcm_s16le",
  sample_rate: String(TARGET_SAMPLE_RATE),
  speech_model: "universal-3-5-pro",
  mode: "min_latency",
  min_turn_silence: "100",
  max_turn_silence: "800",
};

/** Build the socket URL. Exported so tests can assert the query string. */
export function buildSocketUrl(
  token: string,
  keyterms: readonly string[] = DEFAULT_KEYTERMS,
): string {
  const url = new URL(STREAMING_WS_URL);
  for (const [key, value] of Object.entries(STREAMING_PARAMS)) {
    url.searchParams.set(key, value);
  }
  const terms = sanitizeKeyterms(keyterms);
  if (terms.length > 0) {
    // JSON array, URL-encoded by URLSearchParams.
    url.searchParams.set("keyterms_prompt", JSON.stringify(terms));
  }
  url.searchParams.set("token", token);
  return url.toString();
}

// ---------------------------------------------------------------------------

export interface FinalMetrics {
  turnOrder: number;
  at: number;
  hadStop: boolean;
  stopAt: number | null;
  /** onFinal time minus onStop time — how long the correction trailed the halt */
  stopToFinalMs: number | null;
}

export interface StreamingClientOptions {
  /** Keyterms prompt. Defaults to DEFAULT_KEYTERMS. */
  keyterms?: readonly string[];
  /** Stop words. Defaults to STOP_WORDS from lib/types.ts. */
  stopWords?: readonly string[];
  /** Token endpoint. Defaults to "/api/token". */
  tokenUrl?: string;
  /** Worklet module URL. Defaults to "/worklets/pcm16.js". */
  workletUrl?: string;
  /** How long to hold an explicitly unformatted final waiting for its twin. */
  formattedTimeoutMs?: number;
  /**
   * Timing detail that does not fit the frozen `VoiceEvents` contract
   * (lib/types.ts). Used by the store for the latency HUD.
   */
  onStopMetrics?: (metrics: StopMetrics) => void;
  onFinalMetrics?: (metrics: FinalMetrics) => void;
}

export interface StreamingClient {
  start(): Promise<void>;
  stop(): Promise<void>;
  forceEndpoint(): void;
  status(): VoiceStatus;
  /**
   * Swap the event sinks at any time, including while listening. The client
   * holds a mutable ref, so the integrator can bind sim callbacks after start().
   */
  setEvents(events: VoiceEvents): void;
}

const MAX_RECONNECTS = 1;
const RECONNECT_DELAY_MS = 200;
/** Sent only if no audio has gone out recently; the docs' idle keep-alive. */
const KEEPALIVE_INTERVAL_MS = 15000;

export function createStreamingClient(
  events: VoiceEvents,
  opts: StreamingClientOptions = {},
): StreamingClient {
  const stopWords = opts.stopWords ?? STOP_WORDS;
  const keyterms = opts.keyterms ?? DEFAULT_KEYTERMS;
  const tokenUrl = opts.tokenUrl ?? "/api/token";
  const workletUrl = opts.workletUrl ?? "/worklets/pcm16.js";
  const formattedTimeoutMs =
    opts.formattedTimeoutMs ?? DEFAULT_FORMATTED_TIMEOUT_MS;

  // Mutable ref — swapped by setEvents(), never captured by value downstream.
  let sinks: VoiceEvents = events;

  let status: VoiceStatus = "off";
  let turnState: TurnState = initialTurnState();

  let ws: WebSocket | null = null;
  let stream: MediaStream | null = null;
  let ctx: AudioContext | null = null;
  let source: MediaStreamAudioSourceNode | null = null;
  let worklet: AudioWorkletNode | null = null;
  let sink: GainNode | null = null;

  let stopping = false;
  let reconnects = 0;
  let lastAudioSentAt = 0;
  let keepaliveTimer: ReturnType<typeof setInterval> | null = null;
  const formatTimers = new Map<number, ReturnType<typeof setTimeout>>();

  const now = () =>
    typeof performance !== "undefined" ? performance.now() : Date.now();

  function setStatus(next: VoiceStatus, detail?: string) {
    if (status === next && !detail) return;
    status = next;
    sinks.onStatus?.(next, detail);
  }

  function clearFormatTimers() {
    for (const timer of formatTimers.values()) clearTimeout(timer);
    formatTimers.clear();
  }

  function send(payload: object) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(payload));
    }
  }

  function runEffects(effects: TurnEffect[]) {
    for (const effect of effects) {
      switch (effect.type) {
        case "partial":
          sinks.onPartial?.(effect.text);
          break;
        case "stop":
          opts.onStopMetrics?.(effect.metrics);
          sinks.onStop({ partial: effect.partial, at: effect.at });
          break;
        case "final": {
          const timer = formatTimers.get(effect.turnOrder);
          if (timer) {
            clearTimeout(timer);
            formatTimers.delete(effect.turnOrder);
          }
          opts.onFinalMetrics?.({
            turnOrder: effect.turnOrder,
            at: effect.at,
            hadStop: effect.hadStop,
            stopAt: effect.stopAt,
            stopToFinalMs:
              effect.stopAt === null ? null : effect.at - effect.stopAt,
          });
          sinks.onFinal({
            transcript: effect.transcript,
            raw: effect.raw,
            at: effect.at,
            hadStop: effect.hadStop,
          });
          break;
        }
        case "forceEndpoint":
          send({ type: "ForceEndpoint" });
          break;
        case "awaitFormatted": {
          const existing = formatTimers.get(effect.turnOrder);
          if (existing) clearTimeout(existing);
          formatTimers.set(
            effect.turnOrder,
            setTimeout(() => {
              formatTimers.delete(effect.turnOrder);
              dispatch({ type: "FormattedTimeout", turn_order: effect.turnOrder });
            }, effect.ms),
          );
          break;
        }
        case "status":
          // A Termination we asked for must not look like a crash.
          if (effect.status === "off" && !stopping) break;
          setStatus(effect.status, effect.detail);
          break;
        case "sessionBegin":
          reconnects = 0;
          break;
      }
    }
  }

  function dispatch(msg: ServerMessage) {
    const result = reduceTurn(turnState, msg, now(), {
      stopWords,
      formattedTimeoutMs,
    });
    turnState = result.state;
    runEffects(result.effects);
  }

  // -------------------------------------------------------------------------
  // Mic graph
  // -------------------------------------------------------------------------

  async function openMic(): Promise<void> {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      throw new Error(
        "This browser has no microphone API. Serve the app over https:// or http://localhost.",
      );
    }
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      video: false,
    });

    ctx = new AudioContext();
    if (ctx.state === "suspended") await ctx.resume();
    await ctx.audioWorklet.addModule(workletUrl);

    source = ctx.createMediaStreamSource(stream);
    worklet = new AudioWorkletNode(ctx, "pcm16", {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
      processorOptions: {
        targetSampleRate: TARGET_SAMPLE_RATE,
        frameSamples: FRAME_SAMPLES,
      },
    });
    worklet.port.onmessage = (event: MessageEvent<ArrayBuffer>) => {
      const buffer = event.data;
      if (!(buffer instanceof ArrayBuffer)) return;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(buffer);
        lastAudioSentAt = now();
      }
    };

    // Silent sink: keeps the graph pulled without echoing the mic to the speakers.
    sink = ctx.createGain();
    sink.gain.value = 0;
    source.connect(worklet);
    worklet.connect(sink);
    sink.connect(ctx.destination);
  }

  function closeMic() {
    try {
      worklet?.port.postMessage({ type: "stop" });
    } catch {
      /* worklet already gone */
    }
    if (worklet) worklet.port.onmessage = null;
    source?.disconnect();
    worklet?.disconnect();
    sink?.disconnect();
    source = null;
    worklet = null;
    sink = null;
    stream?.getTracks().forEach((track) => track.stop());
    stream = null;
    const closing = ctx;
    ctx = null;
    closing?.close().catch(() => {});
  }

  // -------------------------------------------------------------------------
  // Socket
  // -------------------------------------------------------------------------

  async function fetchToken(): Promise<string> {
    const res = await fetch(tokenUrl, { cache: "no-store" });
    const body = (await res.json().catch(() => null)) as
      | { token?: string; error?: string }
      | null;
    if (!res.ok || !body?.token) {
      throw new Error(body?.error ?? `Token request failed (HTTP ${res.status}).`);
    }
    return body.token;
  }

  function openSocket(token: string): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const socket = new WebSocket(buildSocketUrl(token, keyterms));
      socket.binaryType = "arraybuffer";
      ws = socket;

      socket.onopen = () => {
        settled = true;
        lastAudioSentAt = now();
        resolve();
      };

      socket.onmessage = (event) => {
        if (typeof event.data !== "string") return;
        let msg: ServerMessage;
        try {
          msg = JSON.parse(event.data) as ServerMessage;
        } catch {
          return;
        }
        dispatch(msg);
      };

      socket.onerror = () => {
        if (!settled) {
          settled = true;
          reject(new Error("Could not open the AssemblyAI streaming socket."));
        }
      };

      socket.onclose = (event) => {
        if (ws !== socket) return;
        ws = null;
        clearFormatTimers();
        if (!settled) {
          settled = true;
          reject(
            new Error(
              `Streaming socket closed before it opened (code ${event.code}${
                event.reason ? `: ${event.reason}` : ""
              }).`,
            ),
          );
          return;
        }
        if (stopping) return;
        void handleUnexpectedClose(event);
      };
    });
  }

  async function handleUnexpectedClose(event: CloseEvent) {
    const reason = `code ${event.code}${event.reason ? `: ${event.reason}` : ""}`;
    if (reconnects >= MAX_RECONNECTS) {
      closeMic();
      stopKeepalive();
      setStatus("error", `Streaming connection lost (${reason}).`);
      return;
    }
    reconnects += 1;
    setStatus("connecting", `Reconnecting after ${reason}…`);
    await new Promise((r) => setTimeout(r, RECONNECT_DELAY_MS));
    if (stopping) return;
    try {
      turnState = initialTurnState();
      const token = await fetchToken();
      if (stopping) return;
      await openSocket(token);
      setStatus("listening");
    } catch (cause) {
      closeMic();
      stopKeepalive();
      setStatus(
        "error",
        cause instanceof Error ? cause.message : String(cause),
      );
    }
  }

  function startKeepalive() {
    stopKeepalive();
    keepaliveTimer = setInterval(() => {
      if (now() - lastAudioSentAt > KEEPALIVE_INTERVAL_MS) {
        send({ type: "KeepAlive" });
      }
    }, KEEPALIVE_INTERVAL_MS);
  }

  function stopKeepalive() {
    if (keepaliveTimer !== null) {
      clearInterval(keepaliveTimer);
      keepaliveTimer = null;
    }
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  async function start(): Promise<void> {
    if (status === "connecting" || status === "listening") return;
    stopping = false;
    reconnects = 0;
    turnState = initialTurnState();
    setStatus("connecting");
    try {
      // Token first: a missing key should fail before we prompt for the mic.
      const token = await fetchToken();
      await openMic();
      await openSocket(token);
      startKeepalive();
      setStatus("listening");
    } catch (cause) {
      closeMic();
      stopKeepalive();
      clearFormatTimers();
      if (ws) {
        const socket = ws;
        ws = null;
        socket.close();
      }
      const message =
        cause instanceof DOMException && cause.name === "NotAllowedError"
          ? "Microphone permission was denied."
          : cause instanceof Error
            ? cause.message
            : String(cause);
      setStatus("error", message);
      throw cause instanceof Error ? cause : new Error(message);
    }
  }

  async function stop(): Promise<void> {
    stopping = true;
    stopKeepalive();
    clearFormatTimers();
    if (ws) {
      const socket = ws;
      ws = null;
      if (socket.readyState === WebSocket.OPEN) {
        try {
          socket.send(JSON.stringify({ type: "Terminate" }));
        } catch {
          /* already gone */
        }
      }
      socket.onmessage = null;
      socket.onclose = null;
      socket.onerror = null;
      socket.close();
    }
    closeMic();
    turnState = initialTurnState();
    setStatus("off");
  }

  return {
    start,
    stop,
    forceEndpoint: () => send({ type: "ForceEndpoint" }),
    status: () => status,
    setEvents: (next: VoiceEvents) => {
      sinks = next;
    },
  };
}
