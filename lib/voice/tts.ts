/**
 * EARSHOT — the robot talks back.
 *
 * A thin, mic-safe wrapper over `window.speechSynthesis`. Two rules:
 *
 *  1. **Mic safety.** The operator's mic is open while the robot speaks, so
 *     without this the robot's own "Okay, a bit to the left." comes back as a
 *     partial transcript and is parsed as a correction. Every utterance mutes
 *     the streaming client's audio frames for its duration (plus a watchdog, in
 *     case `end` never fires — a known Chrome failure mode).
 *  2. **Never throw.** TTS needs a user gesture in some browsers and the
 *     resulting `not-allowed` error is not actionable; it is swallowed.
 *
 * Lines are written in the caller (lib/earshot/controller.ts) and are always
 * under six words: this is an acknowledgement, not a narration.
 */

"use client";

import { useVoiceStore } from "@/store/useVoiceStore";

export interface SpeakOptions {
  /** Default 1.05 — a touch quicker than neutral, so it never drags. */
  rate?: number;
  /** Default 1.0. */
  pitch?: number;
  /** Default 1.0. */
  volume?: number;
  /** false = drop this line if something is already being said. Default true. */
  interrupt?: boolean;
}

/**
 * In preference order. Short, natural English voices; the first one present on
 * the machine wins, and we fall back to any en-GB / en-* voice, then the
 * platform default.
 */
const PREFERRED_VOICES: readonly string[] = [
  "Google UK English Female",
  "Samantha",
  "Microsoft Aria Online (Natural) - English (United States)",
  "Google US English",
  "Karen",
  "Moira",
  "Serena",
];

/** Watchdog headroom: speech never outlives this, so the mic always reopens. */
const WATCHDOG_BASE_MS = 1500;
const WATCHDOG_PER_CHAR_MS = 90;
const WATCHDOG_MAX_MS = 9000;

let cachedVoice: SpeechSynthesisVoice | null = null;
let speaking = false;
let watchdog: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<(speaking: boolean) => void>();

/* -------------------------------------------------------------------------- */

function synth(): SpeechSynthesis | null {
  if (typeof window === "undefined") return null;
  const s = window.speechSynthesis;
  if (!s || typeof s.speak !== "function") return null;
  if (typeof window.SpeechSynthesisUtterance !== "function") return null;
  return s;
}

/** True when this browser can speak at all. */
export function ttsSupported(): boolean {
  return synth() !== null;
}

function pickVoice(s: SpeechSynthesis): SpeechSynthesisVoice | null {
  if (cachedVoice) return cachedVoice;
  let voices: SpeechSynthesisVoice[] = [];
  try {
    voices = s.getVoices?.() ?? [];
  } catch {
    return null;
  }
  // Chrome populates the list asynchronously; speak with the default until then
  // and re-pick on the next line.
  if (voices.length === 0) return null;
  for (const name of PREFERRED_VOICES) {
    const hit = voices.find((v) => v.name === name);
    if (hit) return (cachedVoice = hit);
  }
  const en =
    voices.find((v) => /^en[-_]GB/i.test(v.lang)) ??
    voices.find((v) => /^en/i.test(v.lang)) ??
    null;
  return (cachedVoice = en);
}

function clearWatchdog() {
  if (watchdog !== null) {
    clearTimeout(watchdog);
    watchdog = null;
  }
}

function armWatchdog(text: string) {
  clearWatchdog();
  const ms = Math.min(
    WATCHDOG_MAX_MS,
    WATCHDOG_BASE_MS + text.length * WATCHDOG_PER_CHAR_MS,
  );
  watchdog = setTimeout(() => {
    watchdog = null;
    setSpeaking(false);
  }, ms);
}

function setSpeaking(next: boolean) {
  if (next === speaking) return;
  speaking = next;
  if (!next) clearWatchdog();
  // The only thing that must never fail: reopening the mic.
  try {
    useVoiceStore.getState().muteInput(next);
  } catch {
    /* store not ready (SSR / tests) */
  }
  for (const listener of listeners) {
    try {
      listener(next);
    } catch {
      /* a bad listener must not break the mic */
    }
  }
}

/* -------------------------------------------------------------------------- */

/** True while an utterance is playing. */
export function isSpeaking(): boolean {
  return speaking;
}

/** Subscribe to speaking on/off. Returns the unsubscribe function. */
export function subscribeSpeaking(
  listener: (speaking: boolean) => void,
): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Stop whatever is being said and reopen the mic immediately. */
export function cancel(): void {
  try {
    synth()?.cancel();
  } catch {
    /* nothing to cancel */
  }
  setSpeaking(false);
}

/**
 * Say one short line. Fire-and-forget: never throws, never rejects, and is a
 * no-op where speech synthesis is unavailable or not permitted.
 */
export function speak(text: string, opts: SpeakOptions = {}): void {
  const line = text.trim();
  const s = synth();
  if (!s || !line) return;

  try {
    if (opts.interrupt === false) {
      if (speaking || s.speaking) return;
    } else {
      s.cancel(); // fires `end` on the previous utterance → setSpeaking(false)
    }

    const utterance = new SpeechSynthesisUtterance(line);
    const voice = pickVoice(s);
    if (voice) {
      utterance.voice = voice;
      utterance.lang = voice.lang;
    } else {
      utterance.lang = "en-US";
    }
    utterance.rate = opts.rate ?? 1.05;
    utterance.pitch = opts.pitch ?? 1;
    utterance.volume = opts.volume ?? 1;
    utterance.onend = () => setSpeaking(false);
    // `not-allowed` (no user gesture yet), `interrupted`, `canceled` — all the
    // same to us: stop showing the indicator and reopen the mic.
    utterance.onerror = () => setSpeaking(false);

    // Mute *before* the first phoneme, not on `start`: the gap is where the
    // robot's own voice would leak into the transcript.
    setSpeaking(true);
    armWatchdog(line);
    s.speak(utterance);
  } catch {
    setSpeaking(false);
  }
}

/** Test/HMR escape hatch. */
export function __resetTts() {
  cachedVoice = null;
  clearWatchdog();
  speaking = false;
  listeners.clear();
}
