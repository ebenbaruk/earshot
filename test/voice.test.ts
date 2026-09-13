import { describe, expect, it } from "vitest";
import { STOP_WORDS } from "@/lib/types";
import {
  detectStopWord,
  findStopWord,
  isExactlyStopWord,
  normalizeCorrection,
  stripStopWords,
  tokenize,
} from "@/lib/voice/stopwords";
import {
  DEFAULT_KEYTERMS,
  KEYTERMS_MAX_COUNT,
  KEYTERMS_MAX_LENGTH,
  sanitizeKeyterms,
} from "@/lib/voice/keyterms";
import {
  initialTurnState,
  reduceTurn,
  type ServerMessage,
  type TurnEffect,
  type TurnState,
} from "@/lib/voice/turn-reducer";
import { buildSocketUrl, STREAMING_PARAMS } from "@/lib/voice/streaming-client";

// ---------------------------------------------------------------------------
// Stop-word detection
// ---------------------------------------------------------------------------

describe("detectStopWord", () => {
  it("does not fire on a truncated word", () => {
    expect(detectStopWord("sto")).toBeNull();
    expect(detectStopWord("st")).toBeNull();
    expect(detectStopWord("")).toBeNull();
  });

  it("fires on a bare stop word", () => {
    expect(detectStopWord("stop")).toBe("stop");
    expect(detectStopWord("Stop")).toBe("stop");
    expect(detectStopWord("STOP!")).toBe("stop");
    expect(detectStopWord("  stop.  ")).toBe("stop");
  });

  it("fires when the stop word is the last token so far", () => {
    expect(detectStopWord("please stop")).toBe("stop");
    expect(detectStopWord("no wait")).toBe("wait");
  });

  it("fires when the stop word leads a longer utterance", () => {
    expect(detectStopWord("stop a bit to the left")).toBe("stop");
    expect(detectStopWord("Stop, a bit to the left.")).toBe("stop");
  });

  it("respects word boundaries", () => {
    expect(detectStopWord("stopping the marker")).toBeNull();
    expect(detectStopWord("nonstop")).toBeNull();
    expect(detectStopWord("waiting for the bag")).toBeNull();
    expect(detectStopWord("holder")).toBeNull();
    expect(detectStopWord("the tape holder")).toBeNull();
  });

  it("prefers the longest phrase at a position", () => {
    expect(detectStopWord("hold on")).toBe("hold on");
    expect(detectStopWord("hold the sponge")).toBe("hold");
    expect(detectStopWord("no no not that one")).toBe("no no");
  });

  it("handles non-ASCII stop words", () => {
    expect(detectStopWord("arrête")).toBe("arrête");
    expect(detectStopWord("Arrête, un peu à gauche")).toBe("arrête");
    expect(detectStopWord("attends")).toBe("attends");
    // word boundary must hold across the accented character too
    expect(detectStopWord("arrêter")).toBeNull();
  });

  it("reports where the match is", () => {
    const match = findStopWord("please stop now");
    expect(match).toMatchObject({ word: "stop", tokenIndex: 1, tokenCount: 1 });
    expect("please stop now".slice(match!.start, match!.end)).toBe("stop");
  });

  it("accepts a custom stop-word list", () => {
    expect(detectStopWord("abort", ["abort"])).toBe("abort");
    expect(detectStopWord("stop", ["abort"])).toBeNull();
  });

  it("tokenizes unicode text without splitting accented words", () => {
    expect(tokenize("Arrête, un peu!").map((t) => t.word)).toEqual([
      "arrête",
      "un",
      "peu",
    ]);
  });
});

describe("isExactlyStopWord", () => {
  it("is true only when nothing but the stop word has been said", () => {
    expect(isExactlyStopWord("stop")).toBe(true);
    expect(isExactlyStopWord(" Stop! ")).toBe(true);
    expect(isExactlyStopWord("hold on")).toBe(true);
    expect(isExactlyStopWord("stop a bit")).toBe(false);
    expect(isExactlyStopWord("please stop")).toBe(false);
    expect(isExactlyStopWord("")).toBe(false);
    expect(isExactlyStopWord("hello")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Stripping
// ---------------------------------------------------------------------------

describe("normalizeCorrection", () => {
  it("strips the stop word and leaves the correction", () => {
    expect(normalizeCorrection("Stop, a bit to the left.")).toBe(
      "a bit to the left.",
    );
    expect(normalizeCorrection("Hold on, open the bag")).toBe("open the bag");
    expect(normalizeCorrection("Wait — squeeze the sponge first")).toBe(
      "squeeze the sponge first",
    );
  });

  it("returns empty when the utterance was only a stop word", () => {
    expect(normalizeCorrection("stop")).toBe("");
    expect(normalizeCorrection("Stop!")).toBe("");
    expect(normalizeCorrection("hold on")).toBe("");
  });

  it("strips leading filler and vocatives", () => {
    expect(normalizeCorrection("uh, hey robot, move left")).toBe("move left");
    expect(normalizeCorrection("Okay so widen the bag")).toBe("widen the bag");
    expect(normalizeCorrection("please go on")).toBe("go on");
  });

  it("strips filler and stop words together", () => {
    expect(normalizeCorrection("Uh, stop! A little to the right.")).toBe(
      "A little to the right.",
    );
  });

  it("removes stop words that are not at the start", () => {
    expect(stripStopWords("move left stop").trim()).toBe("move left");
  });

  it("leaves clean corrections untouched", () => {
    expect(normalizeCorrection("grab the tape holder first")).toBe(
      "grab the tape holder first",
    );
  });
});

// ---------------------------------------------------------------------------
// Keyterms
// ---------------------------------------------------------------------------

describe("keyterms", () => {
  it("stays inside the documented AssemblyAI limits", () => {
    expect(DEFAULT_KEYTERMS.length).toBeLessThanOrEqual(KEYTERMS_MAX_COUNT);
    for (const term of DEFAULT_KEYTERMS) {
      expect(term.length).toBeLessThanOrEqual(KEYTERMS_MAX_LENGTH);
      expect(term.trim()).toBe(term);
    }
  });

  it("covers the supervision vocabulary", () => {
    for (const term of ["stop", "gripper", "sponge", "tape holder", "bag"]) {
      expect(DEFAULT_KEYTERMS).toContain(term);
    }
  });

  it("drops over-long, empty and duplicate terms and caps the count", () => {
    const terms = sanitizeKeyterms([
      "bag",
      "BAG",
      "  ",
      "x".repeat(KEYTERMS_MAX_LENGTH + 1),
      "marker",
    ]);
    expect(terms).toEqual(["bag", "marker"]);
    expect(sanitizeKeyterms(Array(150).fill(0).map((_, i) => `t${i}`))).toHaveLength(
      KEYTERMS_MAX_COUNT,
    );
  });
});

// ---------------------------------------------------------------------------
// Socket URL
// ---------------------------------------------------------------------------

describe("buildSocketUrl", () => {
  it("carries the verified Universal-3.5 Pro streaming parameters", () => {
    const url = new URL(buildSocketUrl("tok_123"));
    expect(url.protocol).toBe("wss:");
    expect(url.host).toBe("streaming.assemblyai.com");
    expect(url.pathname).toBe("/v3/ws");
    expect(url.searchParams.get("speech_model")).toBe("universal-3-5-pro");
    expect(url.searchParams.get("sample_rate")).toBe("16000");
    expect(url.searchParams.get("encoding")).toBe("pcm_s16le");
    expect(url.searchParams.get("mode")).toBe("min_latency");
    expect(url.searchParams.get("min_turn_silence")).toBe("100");
    expect(url.searchParams.get("max_turn_silence")).toBe("800");
    expect(url.searchParams.get("token")).toBe("tok_123");
  });

  it("does not send parameters that are legacy for this model", () => {
    expect(STREAMING_PARAMS).not.toHaveProperty("format_turns");
    expect(STREAMING_PARAMS).not.toHaveProperty("end_of_turn_confidence_threshold");
    expect(STREAMING_PARAMS).not.toHaveProperty(
      "min_end_of_turn_silence_when_confident",
    );
  });

  it("URL-encodes keyterms_prompt as a JSON array", () => {
    const url = new URL(buildSocketUrl("tok", ["tape holder", "sponge"]));
    expect(JSON.parse(url.searchParams.get("keyterms_prompt")!)).toEqual([
      "tape holder",
      "sponge",
    ]);
    // the raw query string must be percent-encoded
    expect(url.search).toContain("keyterms_prompt=%5B");
  });
});

// ---------------------------------------------------------------------------
// Turn state machine
// ---------------------------------------------------------------------------

/** Drives the reducer over a scripted sequence, returning the flattened effects. */
function run(
  script: Array<[ServerMessage, number]>,
  start: TurnState = initialTurnState(),
): { state: TurnState; effects: TurnEffect[] } {
  let state = start;
  const effects: TurnEffect[] = [];
  for (const [msg, now] of script) {
    const result = reduceTurn(state, msg, now, { formattedTimeoutMs: 250 });
    state = result.state;
    effects.push(...result.effects);
  }
  return { state, effects };
}

const of = <T extends TurnEffect["type"]>(effects: TurnEffect[], type: T) =>
  effects.filter((e) => e.type === type) as Extract<TurnEffect, { type: T }>[];

describe("reduceTurn", () => {
  it("reports the session on Begin", () => {
    const { state, effects } = run([[{ type: "Begin", id: "sess-1" }, 0]]);
    expect(state.sessionId).toBe("sess-1");
    expect(of(effects, "status")[0]).toMatchObject({ status: "listening" });
  });

  it("emits a partial for every partial turn", () => {
    const { effects } = run([
      [{ type: "Begin" }, 0],
      [{ type: "Turn", turn_order: 0, transcript: "move" }, 10],
      [{ type: "Turn", turn_order: 0, transcript: "move a" }, 20],
      [{ type: "Turn", turn_order: 0, transcript: "move a bit" }, 30],
    ]);
    expect(of(effects, "partial").map((e) => e.text)).toEqual([
      "move",
      "move a",
      "move a bit",
    ]);
    expect(of(effects, "stop")).toHaveLength(0);
  });

  it("fires stop once per turn and force-endpoints a lone stop", () => {
    const { effects } = run([
      [{ type: "Begin" }, 0],
      [{ type: "SpeechStarted" }, 100],
      [{ type: "Turn", turn_order: 0, transcript: "stop" }, 240],
      [{ type: "Turn", turn_order: 0, transcript: "stop a" }, 320],
      [{ type: "Turn", turn_order: 0, transcript: "stop a bit" }, 400],
    ]);
    const stops = of(effects, "stop");
    expect(stops).toHaveLength(1);
    expect(stops[0]).toMatchObject({ word: "stop", at: 240, partial: "stop" });
    expect(stops[0].metrics.sinceSpeechStartedMs).toBe(140);
    expect(stops[0].metrics.sinceFirstPartialMs).toBe(0);
    expect(of(effects, "forceEndpoint")).toHaveLength(1);
  });

  it("does not force-endpoint when words follow the stop word", () => {
    const { effects } = run([
      [{ type: "Begin" }, 0],
      [{ type: "Turn", turn_order: 0, transcript: "stop a bit" }, 100],
    ]);
    expect(of(effects, "stop")).toHaveLength(1);
    expect(of(effects, "forceEndpoint")).toHaveLength(0);
  });

  it("delivers a stripped final exactly once, with hadStop", () => {
    const { effects } = run([
      [{ type: "Begin" }, 0],
      [{ type: "SpeechStarted" }, 100],
      [{ type: "Turn", turn_order: 0, transcript: "stop" }, 240],
      [{ type: "Turn", turn_order: 0, transcript: "stop a bit to the left" }, 400],
      [
        {
          type: "Turn",
          turn_order: 0,
          transcript: "Stop, a bit to the left.",
          end_of_turn: true,
          turn_is_formatted: true,
        },
        900,
      ],
    ]);
    const finals = of(effects, "final");
    expect(finals).toHaveLength(1);
    expect(finals[0]).toMatchObject({
      transcript: "a bit to the left.",
      raw: "Stop, a bit to the left.",
      at: 900,
      hadStop: true,
      turnOrder: 0,
      stopAt: 240,
    });
  });

  it("ignores repeated end-of-turn messages for the same turn", () => {
    const { effects } = run([
      [{ type: "Begin" }, 0],
      [
        { type: "Turn", turn_order: 0, transcript: "move left.", end_of_turn: true },
        100,
      ],
      [
        { type: "Turn", turn_order: 0, transcript: "Move left.", end_of_turn: true },
        140,
      ],
    ]);
    expect(of(effects, "final")).toHaveLength(1);
  });

  it("holds an explicitly unformatted final and prefers the formatted twin", () => {
    const { effects } = run([
      [{ type: "Begin" }, 0],
      [
        {
          type: "Turn",
          turn_order: 0,
          transcript: "stop a bit to the left",
          end_of_turn: true,
          turn_is_formatted: false,
        },
        500,
      ],
      [
        {
          type: "Turn",
          turn_order: 0,
          transcript: "Stop, a bit to the left.",
          end_of_turn: true,
          turn_is_formatted: true,
        },
        560,
      ],
      [{ type: "FormattedTimeout", turn_order: 0 }, 750],
    ]);
    const finals = of(effects, "final");
    expect(of(effects, "awaitFormatted")[0]).toMatchObject({
      turnOrder: 0,
      ms: 250,
    });
    expect(finals).toHaveLength(1);
    expect(finals[0].raw).toBe("Stop, a bit to the left.");
    expect(finals[0].at).toBe(560);
  });

  it("falls back to the unformatted final when no formatted twin arrives", () => {
    const { effects } = run([
      [{ type: "Begin" }, 0],
      [
        {
          type: "Turn",
          turn_order: 0,
          transcript: "move a bit left",
          end_of_turn: true,
          turn_is_formatted: false,
        },
        500,
      ],
      [{ type: "FormattedTimeout", turn_order: 0 }, 750],
      // a late formatted twin must not produce a second final
      [
        {
          type: "Turn",
          turn_order: 0,
          transcript: "Move a bit left.",
          end_of_turn: true,
          turn_is_formatted: true,
        },
        800,
      ],
    ]);
    const finals = of(effects, "final");
    expect(finals).toHaveLength(1);
    expect(finals[0]).toMatchObject({ raw: "move a bit left", at: 500 });
  });

  it("ignores a stale FormattedTimeout for another turn", () => {
    const { effects } = run([
      [{ type: "Begin" }, 0],
      [{ type: "Turn", turn_order: 3, transcript: "left" }, 100],
      [{ type: "FormattedTimeout", turn_order: 2 }, 200],
    ]);
    expect(of(effects, "final")).toHaveLength(0);
  });

  it("fires stop even when the whole utterance arrives as one final turn", () => {
    const { effects } = run([
      [{ type: "Begin" }, 0],
      [{ type: "SpeechStarted" }, 50],
      [{ type: "Turn", turn_order: 0, transcript: "Stop.", end_of_turn: true }, 300],
    ]);
    expect(of(effects, "stop")).toHaveLength(1);
    const finals = of(effects, "final");
    expect(finals[0]).toMatchObject({ transcript: "", hadStop: true });
    // no ForceEndpoint: the turn has already ended
    expect(of(effects, "forceEndpoint")).toHaveLength(0);
  });

  it("resets stop/final bookkeeping on a new turn_order", () => {
    const { state, effects } = run([
      [{ type: "Begin" }, 0],
      [{ type: "SpeechStarted" }, 50],
      [{ type: "Turn", turn_order: 0, transcript: "stop" }, 200],
      [{ type: "Turn", turn_order: 0, transcript: "Stop.", end_of_turn: true }, 600],
      [{ type: "SpeechStarted" }, 2000],
      [{ type: "Turn", turn_order: 1, transcript: "wait" }, 2100],
      [
        { type: "Turn", turn_order: 1, transcript: "Wait, go on.", end_of_turn: true },
        2500,
      ],
    ]);
    const stops = of(effects, "stop");
    expect(stops.map((s) => s.word)).toEqual(["stop", "wait"]);
    expect(stops[1].metrics.sinceSpeechStartedMs).toBe(100);
    const finals = of(effects, "final");
    expect(finals).toHaveLength(2);
    expect(finals[1]).toMatchObject({
      transcript: "go on.",
      hadStop: true,
      turnOrder: 1,
    });
    expect(state.turnOrder).toBe(1);
    expect(state.finalized).toBe(true);
  });

  it("delivers a correction with no stop word as hadStop=false", () => {
    const { effects } = run([
      [{ type: "Begin" }, 0],
      [{ type: "Turn", turn_order: 0, transcript: "grab the sponge" }, 100],
      [
        {
          type: "Turn",
          turn_order: 0,
          transcript: "Grab the sponge first.",
          end_of_turn: true,
        },
        600,
      ],
    ]);
    expect(of(effects, "stop")).toHaveLength(0);
    expect(of(effects, "final")[0]).toMatchObject({
      transcript: "Grab the sponge first.",
      hadStop: false,
      stopAt: null,
    });
  });

  it("uses the shared STOP_WORDS list by default", () => {
    for (const word of STOP_WORDS) {
      expect(detectStopWord(word)).not.toBeNull();
    }
  });

  it("surfaces errors and termination as status effects", () => {
    const { effects } = run([
      [{ type: "Error", error: "bad token" }, 0],
      [{ type: "Termination", session_duration_seconds: 4 }, 10],
    ]);
    expect(of(effects, "status")).toEqual([
      { type: "status", status: "error", detail: "bad token" },
      { type: "status", status: "off" },
    ]);
  });
});
