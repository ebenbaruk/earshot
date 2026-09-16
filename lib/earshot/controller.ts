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
import {
  DEFAULT_GRIPPER_WIDTH,
  OBJECT_COUNT,
  type ObjectId,
  type CorrectionEvent,
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
import { extractOrderHint, parseCorrectionFast } from "@/lib/corrections/grammar";
import { resolveOrderHint } from "@/lib/corrections/order";
import { applyConstraints, cloneConstraints, deriveConstraints, emptyConstraints, learnFromCorrection, mergeConstraints, retryAfterNudge, type RunConstraints } from "./constraints";
import { isDithering } from "./watchdog";
import { parseCorrection } from "@/lib/corrections/parse";
import { findStopWord, normalizeCorrection } from "@/lib/voice/stopwords";
import type { OrderHint } from "@/lib/corrections/grammar";
import { cancel as cancelSpeech, speak, subscribeSpeaking } from "@/lib/voice/tts";

const CONTEXT_WINDOW_MS = 2000;
const CONTEXT_KEEP_EVERY = 4; // 20 Hz ring buffer → 5 snapshots/s in the log
const STOP_FLASH_MS = 1400;

let loopEpoch = 0; // bumped on reset / pause / correction so stale decisions are dropped
let loopRunning = false;
let stopFlashTimer: ReturnType<typeof setTimeout> | null = null;
let frozenContext: WorldState[] | null = null;
let lastStopT: number | null = null; // world.t when the last stop landed; consumed by the next correction
let inFlightDecision: PolicyDecision | null = null; // the skill the policy is executing right now
let recentKeys: string[] = []; // watchdog against a policy that repeats or dithers (A-B-A-B)
let constraints: RunConstraints = emptyConstraints(); // operator facts that hold for the run
let correctionQueue: Promise<void> = Promise.resolve();

const session = () => useSessionStore.getState();
const engine = () => getSimEngine();
/** Always execute through the store so the 20 Hz ticker is guaranteed to exist. */
const execute = (cmd: SkillCommand) => useSimStore.getState().execute(cmd);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
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
  const re = prefix === "c" ? /^c(\d+)$/ : /^run-(\d+)$/;
  const ids =
    prefix === "c"
      ? corrections.map((c) => c.id)
      : [...runs.map((r) => r.id), ...corrections.map((c) => c.runId)];
  const max = ids.reduce((m, id) => {
    const x = re.exec(id);
    return x ? Math.max(m, Number(x[1])) : m;
  }, 0);
  return `${prefix === "c" ? "c" : "run-"}${max + 1}`;
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
  // The policy prompt carries the operator facts learned so far in this run as
  // standing instructions, on top of what the version already knows.
  const withFacts: PolicyVersion = { ...policy, constraints: mergeConstraints(policy.constraints, constraints) };
  const { decision, fallback } = await requestDecisionWithMeta(obs, withFacts);
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
      if (w.status === "idle") break; // reset() dropped us back to idle: this loop is over
      if (w.status !== "running") {
        await sleep(40); // paused: yield a macrotask, never spin on microtasks
        continue;
      }
      if (engine().isBusy()) {
        await sleep(40);
        continue;
      }

      const epoch = loopEpoch;
      const policy = usePolicyStore.getState().current();
      session().set({ policyThinking: true });
      let decision = await decideWithBackoff(policy);
      session().set({ policyThinking: false });

      // The world moved on (stop, correction, reset) while we were thinking.
      if (epoch !== loopEpoch || engine().world.status !== "running") continue;

      if (decision.command.skill === "stop") {
        if (engine().world.stagesDone >= OBJECT_COUNT) {
          session().set({ decision });
          engine().pause();
          continue;
        }
        // The policy tried to end the run with objects still on the table
        // (a hallucinated "all packed"). Override with the deterministic
        // planner for this one step so the run keeps moving.
        const fb = fallbackDecision(engine().getObservation());
        decision = { command: fb.command, reasoning: `[override: policy stopped early] ${fb.reasoning.replace(/^\[fallback\] /, "")}` };
      }
      // Watchdog: the same command three times in a row, or two commands
      // alternating four times (set_gripper / move_to …), means the policy is
      // dithering without progress. Hand one step to the planner.
      recentKeys.push(JSON.stringify(decision.command));
      if (recentKeys.length > 4) recentKeys.shift();
      if (isDithering(recentKeys)) {
        const fb = fallbackDecision(engine().getObservation());
        decision = { command: fb.command, reasoning: `[override: policy looping] ${fb.reasoning.replace(/^\[fallback\] /, "")}` };
        recentKeys = [];
      }
      const shaped = applyConstraints(constraints, decision.command, engine().getObservation());
      if (shaped.note) decision = { command: shaped.command, reasoning: `${decision.reasoning} [${shaped.note}]` };
      session().set({ decision });
      inFlightDecision = decision;
      for (const pre of shaped.preSteps) await execute(pre);
      const out = await execute(decision.command);
      if (out === "rolled_out") say("The marker rolled out.");
      if (out === "cracked") say("The egg cracked.");
      if (out === "ok" && (decision.command.skill === "grasp" || decision.command.skill === "release")) recentKeys = [];
      if (shaped.followUp && out === "ok" && engine().world.status === "running") {
        await execute(shaped.followUp);
      }
      inFlightDecision = null;
    }
  } finally {
    loopRunning = false;
    inFlightDecision = null;
    if (isTerminal(engine().world.status)) {
      finishRun();
      // Learning is automatic: a run that needed corrections distils them
      // into the next policy version as soon as it ends.
      if (controller.pendingCorrections().length > 0) void controller.distill();
    }
  }
}

// ---------------------------------------------------------------------------
// The robot talks back
// ---------------------------------------------------------------------------

/**
 * Mirror the TTS engine's speaking flag into the session so the HUD can show
 * the indicator. Registered once, for the life of the tab.
 */
if (typeof window !== "undefined") {
  subscribeSpeaking((speaking) => session().set({ speaking }));
}

/**
 * Say one line, if the operator wants replies. Everything but the distillation
 * line also requires an open mic: with the mic off there is no conversation to
 * answer, only a UI.
 */
function say(line: string, opts: { requiresMic?: boolean } = {}): void {
  if (!session().voiceReplies) return;
  if (opts.requiresMic !== false && useVoiceStore.getState().status !== "listening") return;
  speak(line);
}

const OBJECT_WORD: Record<ObjectId, string> = {
  sponge: "sponge",
  tape_holder: "tape",
  marker: "marker",
  egg: "egg",
};

/** Every line is ≤ 5 words: an acknowledgement, not a narration. */
function acknowledgement(
  command: SkillCommand | null,
  orderHint: OrderHint | null,
): string {
  if (!command) return "Sorry, I didn't catch that.";
  switch (command.skill) {
    case "nudge": {
      const horizontal = Math.abs(command.dx) >= Math.abs(command.dy);
      const magnitude = horizontal ? Math.abs(command.dx) : Math.abs(command.dy);
      const size = magnitude <= 2 ? "a bit" : "more";
      const direction = horizontal
        ? command.dx < 0
          ? "to the left"
          : "to the right"
        : command.dy < 0
          ? "towards you"
          : "further away";
      return `Okay, ${size} ${direction}.`;
    }
    case "squeeze":
      return "Squeezing first.";
    case "descend":
      return "Lowering it.";
    case "lift":
      return "Lifting it.";
    case "grasp":
      return "Grabbing it.";
    case "release":
      return "Letting go.";
    case "widen_bag":
      return "Opening the bag.";
    case "set_gripper":
      return command.width >= DEFAULT_GRIPPER_WIDTH ? "Opening wider." : "Closing in.";
    case "move_to": {
      if (orderHint?.position === "last") {
        const word = OBJECT_WORD[orderHint.object];
        return `${word[0].toUpperCase()}${word.slice(1)} last, got it.`;
      }
      const target = command.target;
      if (target === "bag") return "Heading to the bag.";
      if (typeof target === "string") return `Doing the ${OBJECT_WORD[target]} first.`;
      return "Moving there.";
    }
    default:
      return "Got it.";
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
  if (w.status === "running") engine().pause();
  else if (engine().isBusy()) void execute({ skill: "stop" }); // cancel a correction mid-animation
  flashStop(findStopWord(partial)?.word ?? "stop");
  // One word, said the instant the arm halts: the operator hears the stop land.
  say("Stopped.");
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

  const epochAtUtterance = loopEpoch;
  const rejected = inFlightDecision; // null = the policy was between skills (honestly unknown)
  const stateBefore = frozenContext ?? sampleContext(e.getRecentStates(CONTEXT_WINDOW_MS));
  frozenContext = null;

  // Parse: grammar first (sub-ms), LLM fallback through /api/correction.
  const t0 = performance.now();
  let command: SkillCommand | null = parseCorrectionFast(text);
  let parseSource: ParseSource = input.source === "text" ? "text" : "grammar";
  let orderHint = extractOrderHint(text);
  const obsAtUtterance = e.getObservation();
  if (!command && orderHint) command = resolveOrderHint(orderHint, obsAtUtterance);
  if (!command) {
    const parsed = await parseCorrection(text, e.getObservation());
    command = parsed.command;
    if (parsed.orderHint && !orderHint) orderHint = parsed.orderHint;
    if (input.source !== "text") parseSource = parsed.source;
  }
  const parseMs = performance.now() - t0;

  // Re-read the world: a stop, a run or a reset may have landed while parsing.
  const now = e.world;
  if (isTerminal(now.status) || now.status === "idle") return;
  const stoppedWhileParsing = loopEpoch !== epochAtUtterance;
  const running = now.status === "running";
  // A correction that lands while the sim is paused by a stop (this turn or a
  // previous one) is a stop-correction; one that lands while running is preventive.
  const tStop = running ? null : (lastStopT ?? now.t);
  lastStopT = null;
  const activeRunId = session().activeRunId;

  const id = nextId("c");
  const event: CorrectionEvent = {
    id,
    runId: activeRunId ?? "run-0",
    ts: now.t,
    tStop,
    transcript: input.raw || text,
    parsedCommand: command,
    parseSource,
    rejectedPolicyAction: rejected,
    stateBefore,
    outcome: null,
    latency: { stopMs: tStop !== null ? useVoiceStore.getState().lastStopLatencyMs : null, parseMs },
    preventive: running,
  };
  const runs = useRunsStore.getState();
  runs.addCorrection(event);
  if (activeRunId) {
    const run = runs.runs.find((r) => r.id === activeRunId);
    runs.updateRun(activeRunId, {
      interventions: (run?.interventions ?? 0) + 1,
      correctionIds: [...(run?.correctionIds ?? []), id],
    });
  }
  session().set({ lastCorrection: event });

  // Logged but nothing executable: the HUD shows "didn't understand"; the sim
  // stays paused so the operator can say it again (or press Run).
  if (!command) {
    say(acknowledgement(null, null));
    return;
  }

  // "continue" → resume; "stop" → pause.
  if (command.skill === "wait" && (command.ms ?? 0) === 0) {
    runs.updateCorrection(id, { outcome: "ok" });
    say("Continuing.");
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
  if (running) e.pause();
  let outcome: SkillOutcome = await execute(command);
  // Said after the skill lands, so "Okay, a bit to the left." confirms a move
  // that actually happened.
  say(outcome === "ok" ? acknowledgement(command, orderHint) : "That didn't work.");
  if (outcome === "ok") learnFromCorrection(constraints, command, obsAtUtterance, orderHint);
  // "A bit to the left" with the fingers down means "…and try again".
  const retry = outcome === "ok" ? retryAfterNudge(command, obsAtUtterance) : null;
  if (retry && !isTerminal(e.world.status)) outcome = await execute(retry);
  runs.updateCorrection(id, { outcome });
  session().set({ lastCorrection: { ...event, outcome } });
  // Never resume over a stop that landed while we were parsing.
  if (!stoppedWhileParsing && !isTerminal(e.world.status)) e.resume();
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
      lastStopT = null;
      frozenContext = null;
      session().set({ decision: null, stopFlash: null, lastCorrection: null });
    }
    if (e.world.status === "idle") {
      recentKeys = [];
      // Start every run with the operator facts the current policy version carries.
      constraints = cloneConstraints(usePolicyStore.getState().current().constraints);
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
    if (controller.pendingCorrections().length > 0) void controller.distill();
    loopEpoch++;
    engine().reset(next);
    frozenContext = null;
    lastStopT = null;
    constraints = emptyConstraints();
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
    // Always extend the newest version, even if an older one is active (ablation).
    const newest = Math.max(...policyStore.versions.map((v) => v.version));
    const policy = policyStore.versions.find((v) => v.version === newest) ?? policyStore.current();
    const runIds = new Set(pending.map((c) => c.runId));
    const runs = useRunsStore.getState().runs.filter((r) => runIds.has(r.id));
    s.set({ distilling: true, distillError: null });
    try {
      const next = await requestDistill({ policy, corrections: pending, runs });
      // The deterministic half of learning: operator facts the skill layer will enforce.
      next.constraints = deriveConstraints(pending, policy.constraints);
      policyStore.addVersion(next);
      // `lastDistilledAt` is the cue the Policy panel waits on: it switches the
      // rail over and types the new rules in.
      session().set({ selectedVersion: next.version, lastDistilledAt: Date.now() });
      const learned = Math.max(1, next.rules.length - policy.rules.length);
      // The one line that is said with the mic closed — it is the punchline of
      // the demo, not an answer to something the operator just said.
      say(`I learned ${learned} rule${learned === 1 ? "" : "s"}.`, { requiresMic: false });
    } catch (err) {
      session().set({ distillError: err instanceof Error ? err.message : String(err) });
    } finally {
      session().set({ distilling: false });
    }
  },

  startVoice(): void {
    void useVoiceStore.getState().start(voiceEvents);
  },

  setVoiceReplies(enabled: boolean): void {
    session().set({ voiceReplies: enabled });
    if (!enabled) cancelSpeech();
  },

  /** Imperative on purpose: the HUD meter polls it from an animation frame. */
  getLevel(): number {
    return useVoiceStore.getState().level;
  },

  stopVoice(): void {
    void useVoiceStore.getState().stop();
  },

  sendTextCorrection(text: string): void {
    const trimmed = text.trim();
    if (!trimmed) return;
    const stop = findStopWord(trimmed);
    if (stop && engine().world.status === "running") handleStop(trimmed);
    // Same stripping as the spoken path ("stop, uh, a bit left" → "a bit left").
    const rest = normalizeCorrection(trimmed);
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
