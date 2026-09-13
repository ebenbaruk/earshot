/**
 * EARSHOT — stop-word detection on streaming partial transcripts.
 *
 * This is the latency-critical path: every partial transcript runs through
 * `findStopWord` and the first hit halts the robot. It must therefore be pure,
 * allocation-light and free of any async work.
 *
 * Matching rules:
 *  - case-insensitive
 *  - word-boundary (Unicode aware, so "arrête" and "stoppe" work and "stopping"
 *    does NOT match "stop")
 *  - multi-word stop phrases ("hold on", "no no") are matched as token runs, and
 *    the longest phrase wins at a given position ("hold on" beats "hold")
 *  - a stop word that is the LAST token so far counts as a match. Partial
 *    transcripts are streamed word by word, so waiting for a following token
 *    would cost us the entire latency budget. The trade-off is that a partial
 *    ending in "stop" which later grows into "stopping" fires a false stop; in
 *    this application a spurious halt is cheap and a late halt is not.
 */

import { STOP_WORDS } from "@/lib/types";

/** Letters/digits plus intra-word apostrophes. Unicode-aware on purpose. */
const TOKEN_RE = /[\p{L}\p{N}][\p{L}\p{N}'’]*/gu;
const LEADING_NON_WORD_RE = /^[^\p{L}\p{N}]+/u;

export interface Token {
  /** lower-cased token text */
  word: string;
  /** char offset of the first character in the source string */
  start: number;
  /** char offset one past the last character in the source string */
  end: number;
}

export function tokenize(text: string): Token[] {
  const out: Token[] = [];
  TOKEN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TOKEN_RE.exec(text)) !== null) {
    out.push({
      word: m[0].toLowerCase(),
      start: m.index,
      end: m.index + m[0].length,
    });
  }
  return out;
}

export interface StopMatch {
  /** the canonical stop word, exactly as spelled in the stop-word list */
  word: string;
  /** index of the first matching token */
  tokenIndex: number;
  /** how many tokens the phrase spans */
  tokenCount: number;
  /** char offset of the match in the source string */
  start: number;
  /** char offset one past the match in the source string */
  end: number;
}

interface Phrase {
  word: string;
  tokens: string[];
}

const phraseCache = new Map<string, Phrase[]>();

/** Tokenized stop-word phrases, longest first so "hold on" beats "hold". */
function phrasesFor(stopWords: readonly string[]): Phrase[] {
  const key = stopWords.join("||");
  const cached = phraseCache.get(key);
  if (cached) return cached;
  const phrases = stopWords
    .map((word) => ({ word, tokens: tokenize(word).map((t) => t.word) }))
    .filter((p) => p.tokens.length > 0)
    .sort((a, b) => b.tokens.length - a.tokens.length);
  phraseCache.set(key, phrases);
  return phrases;
}

/** Earliest stop-word occurrence in `text`, or null. */
export function findStopWord(
  text: string,
  stopWords: readonly string[] = STOP_WORDS,
): StopMatch | null {
  if (!text) return null;
  const tokens = tokenize(text);
  if (tokens.length === 0) return null;
  const phrases = phrasesFor(stopWords);
  for (let i = 0; i < tokens.length; i++) {
    for (const phrase of phrases) {
      const n = phrase.tokens.length;
      if (i + n > tokens.length) continue;
      let ok = true;
      for (let j = 0; j < n; j++) {
        if (tokens[i + j].word !== phrase.tokens[j]) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;
      return {
        word: phrase.word,
        tokenIndex: i,
        tokenCount: n,
        start: tokens[i].start,
        end: tokens[i + n - 1].end,
      };
    }
  }
  return null;
}

/** Convenience wrapper: the matched stop word, or null. */
export function detectStopWord(
  text: string,
  stopWords: readonly string[] = STOP_WORDS,
): string | null {
  return findStopWord(text, stopWords)?.word ?? null;
}

/**
 * True when the whole utterance so far is nothing but a stop word
 * ("stop", "Stop!", "hold on"). The client sends ForceEndpoint in exactly this
 * case so a lone "stop" finalizes immediately; if more words follow the stop
 * word we let natural end-of-turn deliver the correction instead.
 */
export function isExactlyStopWord(
  text: string,
  stopWords: readonly string[] = STOP_WORDS,
): boolean {
  const tokens = tokenize(text);
  if (tokens.length === 0) return false;
  const match = findStopWord(text, stopWords);
  return (
    match !== null &&
    match.tokenIndex === 0 &&
    match.tokenCount === tokens.length
  );
}

/** Remove every stop-word occurrence from the text (leaves whitespace debris). */
export function stripStopWords(
  text: string,
  stopWords: readonly string[] = STOP_WORDS,
): string {
  let out = text;
  // Bounded loop: each iteration removes at least one token.
  for (let guard = 0; guard < 32; guard++) {
    const match = findStopWord(out, stopWords);
    if (!match) break;
    out = `${out.slice(0, match.start)} ${out.slice(match.end)}`;
  }
  return out;
}

/** Disfluencies and vocatives that carry no instruction. */
export const LEADING_FILLER: readonly string[] = [
  "uh",
  "uhh",
  "um",
  "umm",
  "er",
  "erm",
  "ah",
  "oh",
  "hmm",
  "hey",
  "ok",
  "okay",
  "so",
  "please",
  "robot",
  "earshot",
  "yo",
  "hi",
];

function stripLeadingFiller(text: string): string {
  let out = text;
  for (let guard = 0; guard < 16; guard++) {
    out = out.replace(LEADING_NON_WORD_RE, "");
    const tokens = tokenize(out);
    if (tokens.length === 0) return "";
    if (!LEADING_FILLER.includes(tokens[0].word)) return out;
    // Nothing but filler left — the utterance carries no correction.
    if (tokens.length === 1) return "";
    out = out.slice(tokens[0].end);
  }
  return out;
}

/**
 * Turn a raw final transcript into the correction text the parser consumes:
 * stop words removed, leading filler removed, whitespace/punctuation tidied.
 * May legitimately return "" (the operator only said "stop").
 */
export function normalizeCorrection(
  raw: string,
  stopWords: readonly string[] = STOP_WORDS,
): string {
  let out = stripStopWords(raw, stopWords);
  out = out.replace(/\s+/g, " ");
  out = stripLeadingFiller(out);
  out = out.replace(/\s+([,.!?;:])/g, "$1");
  out = out.replace(/\s+/g, " ").trim();
  out = out.replace(LEADING_NON_WORD_RE, "").trim();
  return out;
}
