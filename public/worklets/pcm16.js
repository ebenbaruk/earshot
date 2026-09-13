/**
 * EARSHOT — mic capture worklet.
 *
 * Takes the mono float32 input at the AudioContext's native rate (usually
 * 44.1 or 48 kHz), resamples it to 16 kHz with linear interpolation, converts
 * to signed 16-bit little-endian, and posts fixed-size ArrayBuffers to the main
 * thread. 800 samples = 50 ms = 1600 bytes, the frame size AssemblyAI's
 * streaming API expects (50-1000 ms of PCM16 mono per message).
 *
 * Interpolation state (`prev`, `pos`) is carried across process() blocks so the
 * resampler never drifts and never clicks at block boundaries.
 *
 * Loaded by lib/voice/streaming-client.ts as `/worklets/pcm16.js`. Plain JS on
 * purpose: it is served as a static asset, not bundled.
 */

const DEFAULT_TARGET_RATE = 16000;
const DEFAULT_FRAME_SAMPLES = 800; // 50 ms at 16 kHz

class PCM16Processor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const opts = (options && options.processorOptions) || {};
    this.targetRate = opts.targetSampleRate || DEFAULT_TARGET_RATE;
    this.frameSamples = opts.frameSamples || DEFAULT_FRAME_SAMPLES;
    // `sampleRate` is a global inside AudioWorkletGlobalScope.
    this.ratio = sampleRate / this.targetRate;
    this.frame = new Int16Array(this.frameSamples);
    this.filled = 0;
    // Read position of the next output sample, relative to the start of the
    // current input block. Can be slightly negative, meaning "interpolate
    // between the last sample of the previous block and the first of this one".
    this.pos = 0;
    this.prev = 0;
    this.stopped = false;
    this.port.onmessage = (event) => {
      if (event.data && event.data.type === "stop") this.stopped = true;
    };
  }

  pushSample(value) {
    // Clamp then scale asymmetrically so -1.0 maps to -32768 and +1.0 to 32767.
    const clamped = value > 1 ? 1 : value < -1 ? -1 : value;
    this.frame[this.filled++] =
      clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
    if (this.filled === this.frameSamples) {
      const buffer = this.frame.buffer;
      this.port.postMessage(buffer, [buffer]);
      this.frame = new Int16Array(this.frameSamples);
      this.filled = 0;
    }
  }

  process(inputs) {
    if (this.stopped) return false;
    const input = inputs[0];
    if (!input || input.length === 0) return true;
    const channel = input[0];
    if (!channel || channel.length === 0) return true;

    const n = channel.length;
    let pos = this.pos;
    // Stop one sample short of the end: the last output sample of this block
    // needs channel[i0 + 1] to interpolate against.
    while (pos <= n - 1) {
      const i0 = Math.floor(pos);
      const frac = pos - i0;
      const s0 = i0 < 0 ? this.prev : channel[i0];
      const s1 = i0 + 1 < 0 ? this.prev : channel[i0 + 1];
      this.pushSample(s0 + (s1 - s0) * frac);
      pos += this.ratio;
    }

    this.prev = channel[n - 1];
    this.pos = pos - n; // > -1 by construction
    return true;
  }
}

registerProcessor("pcm16", PCM16Processor);
