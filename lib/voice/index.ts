/** EARSHOT — voice module public surface. */

export {
  createStreamingClient,
  buildSocketUrl,
  STREAMING_PARAMS,
  STREAMING_WS_URL,
  TARGET_SAMPLE_RATE,
  FRAME_SAMPLES,
  type StreamingClient,
  type StreamingClientOptions,
  type FinalMetrics,
} from "./streaming-client";

export {
  DEFAULT_KEYTERMS,
  sanitizeKeyterms,
  KEYTERMS_MAX_COUNT,
  KEYTERMS_MAX_LENGTH,
} from "./keyterms";

export {
  detectStopWord,
  findStopWord,
  isExactlyStopWord,
  normalizeCorrection,
  stripStopWords,
  tokenize,
  LEADING_FILLER,
  type StopMatch,
  type Token,
} from "./stopwords";

export {
  reduceTurn,
  initialTurnState,
  DEFAULT_FORMATTED_TIMEOUT_MS,
  type ReduceConfig,
  type ReduceResult,
  type ServerMessage,
  type ServerTurnMessage,
  type StopMetrics,
  type TurnEffect,
  type TurnState,
} from "./turn-reducer";
