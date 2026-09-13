/**
 * EARSHOT — the integration layer.
 *
 * Owns the policy loop (high-level policy → low-level skills), the correction
 * pipeline (voice/text → skill → log), run recording and distillation.
 * Pure orchestration over the module stores; no React.
 *
 *   loop:   observe → decide (LLM via LLM Gateway, 6 s budget, local fallback)
 *           → execute → repeat, until succeeded / failed.
 *   stop:   partial transcript contains a stop word → engine.pause() at once.
 *   final:  transcript → grammar (sub-ms) or /api/correction → engine.execute()
 *           while paused → resume → the loop re-observes and continues.
 */
import type {
  CorrectionEvent,
  ParseSource,
  PolicyDecision,
  PolicyVersion,
  RunRecord,
  SkillCommand,
  SkillOutcome,
  VoiceEvents,
  WorldState,
} from "@/lib/types";
import { getSimEngine, useSimStore } from "@/store/useSimStore";
import { useVoiceStore } from "@/store/useVoiceStore";
import { usePolicyStore } from "@/store/usePolicyStore";
import { useRunsStore } from "@/store/useRunsStore";
import { useSessionStore } from "./session";
import { requestDecisionWithMeta, requestDistill } from "@/lib/policy/client";
import { fallbackDecision } from "@/lib/policy/fallback";
import { parseCorrectionFast } from "@/lib/corrections/grammar";
import { parseCorrection } from "@/lib/corrections/parse";
import { findStopWord } from "@/lib/voice/stopwords";

const CONTEXT_WINDOW_MS = 2000;
const CONTEXT_KEEP_EVERY = 4; // 20 Hz ring buffer → 5 snapshots/s in the log
const STOP_FLASH_MS = 1400;

let loopEpoch = 0; // bumped on reset / pause / correction so stale decisions are dropped
let loopRunning = false;
let stopFlashTimer: ReturnType<typeof setTimeout> | null = null;
let frozenContext: WorldState[] | null = null;
let lastStopT: number | null = null; // world.t when the last stop landed; consumed by the next correction
let correctionQueue: Promise<void> = Promise.resolve();

const session = () => useSessionStore.getState();
const engine = () => getSimEngine();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

async function waitUntil(pred: () => boolean, pollMs = 40): Promise<void> {
  while (!pred()) await sleep(pollMs);
}

function isTerminal(status: WorldState["status"]) {
  return status === "succeeded" || status === "failed";
}

function sampleContext(states: WorldState[]): WorldState[] {
  if (states.length <= 12) return states;
  const out: WorldState[] = [];
  for (let i = states.length - 1; i >= 0; i -= CONTEXT_KEEP_EVERY) out.unshift(states[i]);
  return out;
}

function nextId(prefix: "c" | "run"): string {
  const { corrections, runs } = useRunsStore.getState();
  const n = prefix === "c" ? corrections.length + 1 : runs.length + 1;
  return `${prefix === "c" ? "c" : "run-"}${n}`;
}

// ---------------------------------------------------------------------------
// Runs
// ---------------------------------------------------------------------------

function beginRun(): string {
  const id = nextId("run");
  const s = session();
  const run: RunRecord = {
    id,
    seed: s.seed,
    policyVersion: usePolicyStore.getState().currentVersion,
    correctionsEnabled: s.correctionsEnabled,
    startedAt: Date.now(),
    endedAt: null,
    durationMs: null,
    stagesDone: 0,
    success: false,
    interventions: 0,
    correctionIds: [],
  };
  useRunsStore.getState().addRun(run);
  s.set({ activeRunId: id });
  return id;
}

function finishRun(): void {
  const id = session().activeRunId;
  if (!id) return;
  const w = engine().world;
  useRunsStore.getState().updateRun(id, {
    endedAt: Date.now(),
    durationMs: w.t,
    stagesDone: w.stagesDone,
    success: w.status === "succeeded",
  });
  session().set({ activeRunId: null });
}

function discardRun(): void {
  const id = session().activeRunId;
  if (!id) return;
  const store = useRunsStore.getState();
  // A run that never produced anything is dropped; otherwise keep it as failed.
  const run = store.runs.find((r) => r.id === id);
  if (run && run.correctionIds.length === 0 && engine().world.stagesDone === 0) {
    useRunsStore.setState((s) => ({ runs: s.runs.filter((r) => r.id !== id) }));
  } else {
    finishRun();
  }
  session().set({ activeRunId: null });
}

// ---------------------------------------------------------------------------
// Policy loop
// ---------------------------------------------------------------------------

/**
 * When the LLM Gateway is unavailable (no model entitlement, rate limit,
 * network), don't pay the round trip on every skill: use the local planner
 * for GATEWAY_COOLDOWN_MS, then probe the Gateway again.
 */
const GATEWAY_COOLDOWN_MS = 20_000;
let gatewayCooldownUntil = 0;

async function decideWithBackoff(policy: PolicyVersion): Promise<PolicyDecision> {
  const obs = engine().getObservation();
  if (Date.now() < gatewayCooldownUntil) {
    return fallbackDecision(obs); // reasoning is already tagged "[fallback]"
  }
  const { decision, fallback } = await requestDecisionWithMeta(obs, policy);
  if (fallback) gatewayCooldownUntil = Date.now() + GATEWAY_COOLDOWN_MS;
  else gatewayCooldownUntil = 0;
  return decision;
}

async function policyLoop(): Promise<void> {
  if (loopRunning) return;
  loopRunning = true;
  try {
    for (;;) {
      const w = engine().world;
      if (isTerminal(w.status)) break;
      if (w.status !== "running") {
        await waitUntil(() => engine().world.status !== "paused");
        continue;
      }
      if (engine().isBusy()) {
        await sleep(40);
        continue;
      }

      const epoch = loopEpoch;
      const policy = usePolicyStore.getState().current();
      session().set({ policyThinking: true });
      const decision = await decideWithBackoff(policy);
      session().set({ policyThinking: false });

      // The world moved on (stop, correction, reset) while we were thinking.
      if (epoch !== loopEpoch || engine().world.status !== "running") continue;

      session().set({ decision });
      if (decision.command.skill === "stop") {
        engine().pause();
        continue;
      }
      await engine().execute(decision.command);
    }
  } finally {
    loopRunning = false;
    if (isTerminal(engine().world.status)) finishRun();
  }
}

// ---------------------------------------------------------------------------
// Corrections
// ---------------------------------------------------------------------------

function flashStop(word: string) {
  const latency = useVoiceStore.getState().lastStopLatencyMs;
  session().set({ stopFlash: { at: engine().world.t, latencyMs: latency, word } });
  if (stopFlashTimer) clearTimeout(stopFlashTimer);
  stopFlashTimer = setTimeout(() => session().set({ stopFlash: null }), STOP_FLASH_MS);
}

/** Hard-real-time path: called from a partial transcript. Nothing async here. */
function handleStop(partial: string): void {
  const s = session();
  if (!s.correctionsEnabled) return;
  const w = engine().world;
  if (isTerminal(w.status) || w.status === "idle") return;
  frozenContext = sampleContext(engine().getRecentStates(CONTEXT_WINDOW_MS));
  lastStopT = w.t;
  loopEpoch++;
  engine().pause();
  flashStop(findStopWord(partial)?.word ?? "stop");
}

interface CorrectionInput {
  text: string;
  raw: string;
  hadStop: boolean;
  source: "voice" | "text";
}

async function applyCorrection(input: CorrectionInput): Promise<void> {
  const s = session();
  if (!s.correctionsEnabled) return;
  const e = engine();
  const w = e.world;
  if (isTerminal(w.status) || w.status === "idle") return;

  const text = input.text.trim();

  // "stop" alone: stay paused and wait for the actual correction.
  if (!text) return;

  const wasRunning = w.status === "running";
  // A correction that lands while the sim is paused by a stop (this turn or a
  // previous one) is a stop-correction; one that lands while running is preventive.
  const tStop = wasRunning ? null : (lastStopT ?? w.t);
  lastStopT = null;
  const rejected = s.decision;
  const stateBefore = frozenContext ?? sampleContext(e.getRecentStates(CONTEXT_WINDOW_MS));
  frozenContext = null;

  // Parse: grammar first (sub-ms), LLM fallback through /api/correction.
  const t0 = performance.now();
  let command: SkillCommand | null = parseCorrectionFast(text);
  let parseSource: ParseSource = input.source === "text" ? "text" : "grammar";
  if (!command) {
    const parsed = await parseCorrection(text, e.getObservation());
    command = parsed.command;
    if (input.source !== "text") parseSource = parsed.source;
  }
  const parseMs = performance.now() - t0;

  const id = nextId("c");
  const event: CorrectionEvent = {
    id,
    runId: s.activeRunId ?? "run-0",
    ts: w.t,
    tStop,
    transcript: input.raw || text,
    parsedCommand: command,
    parseSource,
    rejectedPolicyAction: rejected,
    stateBefore,
    outcome: null,
    latency: { stopMs: tStop !== null ? useVoiceStore.getState().lastStopLatencyMs : null, parseMs },
    preventive: wasRunning,
  };
  const runs = useRunsStore.getState();
  runs.addCorrection(event);
  if (s.activeRunId) {
    const run = runs.runs.find((r) => r.id === s.activeRunId);
    runs.updateRun(s.activeRunId, {
      interventions: (run?.interventions ?? 0) + 1,
      correctionIds: [...(run?.correctionIds ?? []), id],
    });
  }
  session().set({ lastCorrection: event });

  if (!command) return; // logged, but nothing executable — stays paused if it was

  // "continue" → resume; "stop" → pause.
  if (command.skill === "wait" && (command.ms ?? 0) === 0) {
    runs.updateCorrection(id, { outcome: "ok" });
    e.resume();
    return;
  }
  if (command.skill === "stop") {
    loopEpoch++;
    e.pause();
    runs.updateCorrection(id, { outcome: "ok" });
    return;
  }

  // Preventive correction while running: interrupt the current skill first.
  loopEpoch++;
  if (wasRunning) e.pause();
  const outcome: SkillOutcome = await e.execute(command);
  runs.updateCorrection(id, { outcome });
  session().set({ lastCorrection: { ...event, outcome } });
  if (!isTerminal(e.world.status)) e.resume();
}

function enqueueCorrection(input: CorrectionInput) {
  correctionQueue = correctionQueue.then(() => applyCorrection(input)).catch(() => undefined);
}

export const voiceEvents: VoiceEvents = {
  onStop: ({ partial }) => handleStop(partial),
  onFinal: ({ transcript, raw, hadStop }) =>
    enqueueCorrection({ text: transcript, raw, hadStop, source: "voice" }),
};

// ---------------------------------------------------------------------------
// Public actions
// ---------------------------------------------------------------------------

export const controller = {
  run(): void {
    const e = engine();
    const w = e.world;
    if (isTerminal(w.status)) {
      e.reset(session().seed);
    }
    if (e.world.status === "idle") {
      beginRun();
      useSimStore.getState().start();
    } else if (e.world.status === "paused") {
      useSimStore.getState().resume();
    }
    void policyLoop();
  },

  pause(): void {
    loopEpoch++;
    engine().pause();
  },

  reset(seed?: number): void {
    const s = session();
    const next = seed ?? s.seed;
    discardRun();
    loopEpoch++;
    engine().reset(next);
    frozenContext = null;
    lastStopT = null;
    s.set({ seed: next, decision: null, policyThinking: false, stopFlash: null, lastCorrection: null });
  },

  setSeed(seed: number): void {
    session().set({ seed });
    if (engine().world.status === "idle" || isTerminal(engine().world.status)) {
      controller.reset(seed);
    }
  },

  setCorrectionsEnabled(enabled: boolean): void {
    session().set({ correctionsEnabled: enabled });
  },

  selectVersion(v: number): void {
    session().set({ selectedVersion: v });
  },

  activateVersion(v: number): void {
    usePolicyStore.getState().setCurrent(v);
    session().set({ selectedVersion: v });
  },

  pendingCorrections(): CorrectionEvent[] {
    const { versions } = usePolicyStore.getState();
    const consumed = new Set(versions.flatMap((v) => v.distilledFrom));
    return useRunsStore
      .getState()
      .corrections.filter((c) => !consumed.has(c.id) && c.parsedCommand !== null);
  },

  async distill(): Promise<void> {
    const s = session();
    if (s.distilling) return;
    const pending = controller.pendingCorrections();
    if (pending.length === 0) return;
    const policyStore = usePolicyStore.getState();
    const policy = policyStore.current();
    const runIds = new Set(pending.map((c) => c.runId));
    const runs = useRunsStore.getState().runs.filter((r) => runIds.has(r.id));
    s.set({ distilling: true, distillError: null });
    try {
      const next = await requestDistill({ policy, corrections: pending, runs });
      policyStore.addVersion(next);
      session().set({ selectedVersion: next.version });
    } catch (err) {
      session().set({ distillError: err instanceof Error ? err.message : String(err) });
    } finally {
      session().set({ distilling: false });
    }
  },

  startVoice(): void {
    void useVoiceStore.getState().start(voiceEvents);
  },

  stopVoice(): void {
    void useVoiceStore.getState().stop();
  },

  sendTextCorrection(text: string): void {
    const trimmed = text.trim();
    if (!trimmed) return;
    const stop = findStopWord(trimmed);
    if (stop && engine().world.status === "running") handleStop(trimmed);
    // Strip the stop word so "stop, a bit left" parses like the spoken path.
    const rest = stop ? trimmed.replace(new RegExp(stop.word, "i"), "").replace(/^[\s,.]+/, "") : trimmed;
    enqueueCorrection({ text: rest, raw: trimmed, hadStop: Boolean(stop), source: "text" });
  },

  exportJSON(): string {
    return useRunsStore.getState().exportJSON();
  },

  importJSON(json: string): void {
    useRunsStore.getState().importJSON(json);
  },

  clearAll(): void {
    controller.reset();
    useRunsStore.getState().clear();
    usePolicyStore.getState().reset();
    session().set({ selectedVersion: 0 });
  },
};
