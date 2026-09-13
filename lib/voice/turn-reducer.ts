/**
 * EARSHOT — pure reducer for the AssemblyAI streaming message sequence.
 *
 * The whole protocol state machine lives here as `reduceTurn(state, msg, now)`
 * so it can be unit-tested with a scripted message sequence and zero I/O.
 * `streaming-client.ts` is a thin shell that owns the socket, the mic and the
 * timers, and does nothing but feed messages in and perform the effects out.
 *
 * Server message sequence (verified against
 * https://www.assemblyai.com/docs/streaming/message-sequence):
 *   Begin -> (SpeechStarted, Turn*)* -> Termination
 *
 * Each `Turn` supersedes the previous one for the same `turn_order`.
 * Universal-3.5 Pro always returns formatted transcripts (see
 * https://www.assemblyai.com/docs/voice-agents/pipecat-universal-3-5-pro
 * "Legacy Parameters"), so `turn_is_formatted` is usually absent. We still
 * handle the older two-stage delivery: an `end_of_turn` turn with
 * `turn_is_formatted === false` is held back for `formattedTimeoutMs` waiting
 * for its formatted twin, and delivered anyway if none arrives. `onFinal` is
 * therefore emitted exactly once per turn_order.
 */

import { STOP_WORDS, type VoiceStatus } from "@/lib/types";
import { findStopWord, isExactlyStopWord, normalizeCorrection } from "./stopwords";

/** Fallback delay before delivering an unformatted final on its own. */
export const DEFAULT_FORMATTED_TIMEOUT_MS = 250;

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

export interface TurnWord {
  text: string;
  word_is_final?: boolean;
  start?: number;
  end?: number;
  confidence?: number;
}

export interface ServerTurnMessage {
  type: "Turn";
  turn_order: number;
  transcript?: string;
  end_of_turn?: boolean;
  turn_is_formatted?: boolean;
  end_of_turn_confidence?: number;
  words?: TurnWord[];
  utterance?: string;
}

export type ServerMessage =
  | { type: "Begin"; id?: string; expires_at?: number }
  | { type: "SpeechStarted" }
  | ServerTurnMessage
  | {
      type: "Termination";
      audio_duration_seconds?: number;
      session_duration_seconds?: number;
    }
  | { type: "Error"; error?: string }
  /** Synthetic, produced by the client's own timer — never sent by the server. */
  | { type: "FormattedTimeout"; turn_order: number };

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export interface TurnState {
  sessionId: string | null;
  /** turn_order of the turn currently being accumulated */
  turnOrder: number | null;
  /** latest partial transcript for the current turn */
  partial: string;
  /** performance.now() of the first message of the current turn */
  firstPartialAt: number | null;
  /** performance.now() of the most recent SpeechStarted (null once consumed) */
  speechStartedAt: number | null;
  /** onStop already fired for this turn */
  stopFired: boolean;
  stopWord: string | null;
  stopAt: number | null;
  /** onFinal already fired for this turn */
  finalized: boolean;
  /** unformatted end-of-turn held back waiting for its formatted twin */
  pending: { raw: string; at: number } | null;
}

export function initialTurnState(): TurnState {
  return {
    sessionId: null,
    turnOrder: null,
    partial: "",
    firstPartialAt: null,
    speechStartedAt: null,
    stopFired: false,
    stopWord: null,
    stopAt: null,
    finalized: false,
    pending: null,
  };
}

// ---------------------------------------------------------------------------
// Effects
// ---------------------------------------------------------------------------

/** Timing detail that does not fit the frozen `VoiceEvents` contract. */
export interface StopMetrics {
  turnOrder: number;
  word: string;
  at: number;
  speechStartedAt: number | null;
  firstPartialAt: number | null;
  /** at - SpeechStarted; the headline "speech to halt" number for the HUD */
  sinceSpeechStartedMs: number | null;
  /** at - first partial of the turn; fallback when SpeechStarted is missing */
  sinceFirstPartialMs: number | null;
}

export type TurnEffect =
  | { type: "partial"; text: string }
  | {
      type: "stop";
      partial: string;
      at: number;
      word: string;
      metrics: StopMetrics;
    }
  | {
      type: "final";
      transcript: string;
      raw: string;
      at: number;
      hadStop: boolean;
      turnOrder: number;
      /** performance.now() at which onStop fired for this turn, if it did */
      stopAt: number | null;
    }
  | { type: "forceEndpoint" }
  | { type: "awaitFormatted"; turnOrder: number; ms: number }
  | { type: "status"; status: VoiceStatus; detail?: string }
  | { type: "sessionBegin"; id: string | null };

export interface ReduceConfig {
  stopWords?: readonly string[];
  formattedTimeoutMs?: number;
}

export interface ReduceResult {
  state: TurnState;
  effects: TurnEffect[];
}

function emitFinal(
  state: TurnState,
  raw: string,
  at: number,
  effects: TurnEffect[],
  stopWords: readonly string[],
): ReduceResult {
  effects.push({
    type: "final",
    transcript: normalizeCorrection(raw, stopWords),
    raw,
    at,
    hadStop: state.stopFired,
    turnOrder: state.turnOrder ?? -1,
    stopAt: state.stopAt,
  });
  return {
    state: {
      ...state,
      finalized: true,
      pending: null,
      partial: "",
      // consumed: the next turn gets its own SpeechStarted
      speechStartedAt: null,
    },
    effects,
  };
}

/**
 * Pure transition. `now` is injected (performance.now() in the browser) so the
 * tests can drive a deterministic clock.
 */
export function reduceTurn(
  state: TurnState,
  msg: ServerMessage,
  now: number,
  config: ReduceConfig = {},
): ReduceResult {
  const stopWords = config.stopWords ?? STOP_WORDS;
  const formattedTimeoutMs =
    config.formattedTimeoutMs ?? DEFAULT_FORMATTED_TIMEOUT_MS;
  const effects: TurnEffect[] = [];
  let s = state;

  switch (msg.type) {
    case "Begin": {
      s = { ...initialTurnState(), sessionId: msg.id ?? null };
      effects.push({ type: "sessionBegin", id: s.sessionId });
      effects.push({ type: "status", status: "listening" });
      return { state: s, effects };
    }

    case "SpeechStarted": {
      return { state: { ...s, speechStartedAt: now }, effects };
    }

    case "Termination": {
      effects.push({ type: "status", status: "off" });
      return { state: s, effects };
    }

    case "Error": {
      effects.push({ type: "status", status: "error", detail: msg.error });
      return { state: s, effects };
    }

    case "FormattedTimeout": {
      if (s.turnOrder !== msg.turn_order || s.finalized || !s.pending) {
        return { state: s, effects };
      }
      return emitFinal(s, s.pending.raw, s.pending.at, effects, stopWords);
    }

    case "Turn": {
      const order = msg.turn_order;
      if (s.turnOrder !== order) {
        // New turn. SpeechStarted arrives before the first Turn of a turn, so
        // it is carried over rather than reset.
        s = {
          ...initialTurnState(),
          sessionId: s.sessionId,
          speechStartedAt: s.speechStartedAt,
          turnOrder: order,
          firstPartialAt: now,
        };
      }

      const raw = msg.transcript ?? "";
      const endOfTurn = msg.end_of_turn === true;

      if (!endOfTurn) {
        s = { ...s, partial: raw };
        effects.push({ type: "partial", text: raw });
      }

      // Stop detection runs on partials AND on the end-of-turn transcript: a
      // very short utterance can arrive as a single end_of_turn Turn with no
      // partial before it, and we still owe the sim an onStop in that case.
      if (!s.finalized && !s.stopFired && raw) {
        const match = findStopWord(raw, stopWords);
        if (match) {
          s = { ...s, stopFired: true, stopWord: match.word, stopAt: now };
          effects.push({
            type: "stop",
            partial: raw,
            at: now,
            word: match.word,
            metrics: {
              turnOrder: order,
              word: match.word,
              at: now,
              speechStartedAt: s.speechStartedAt,
              firstPartialAt: s.firstPartialAt,
              sinceSpeechStartedMs:
                s.speechStartedAt === null ? null : now - s.speechStartedAt,
              sinceFirstPartialMs:
                s.firstPartialAt === null ? null : now - s.firstPartialAt,
            },
          });
          // Only force the endpoint when the utterance is nothing but the stop
          // word, so a lone "stop" finalizes fast. If more words follow, the
          // natural end of turn delivers the correction.
          if (!endOfTurn && isExactlyStopWord(raw, stopWords)) {
            effects.push({ type: "forceEndpoint" });
          }
        }
      }

      if (!endOfTurn) return { state: s, effects };

      // onFinal fires exactly once per turn_order.
      if (s.finalized) return { state: s, effects };

      // `turn_is_formatted` is absent on Universal-3.5 Pro (always formatted),
      // so only an explicit `false` makes us wait.
      if (msg.turn_is_formatted === false) {
        s = { ...s, pending: { raw, at: now } };
        effects.push({ type: "awaitFormatted", turnOrder: order, ms: formattedTimeoutMs });
        return { state: s, effects };
      }

      return emitFinal(s, raw, now, effects, stopWords);
    }

    default:
      return { state: s, effects };
  }
}
