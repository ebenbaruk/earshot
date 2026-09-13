# Earshot

**Yell at your agent. It listens — and learns.**

Earshot is a voice supervision and learning layer for autonomous agents. An operator watches an agent work and corrects it out loud. The agent halts on "stop" in a few hundred milliseconds, executes the spoken correction, logs it with context, and later distills the corrections into its own policy so the next run needs fewer interventions.

Built for the [AssemblyAI Voice Agent Hackathon](https://lablab.ai/ai-hackathons/assemblyai-voice-agent-hackathon) on:

- **AssemblyAI Universal-3.5 Pro streaming** (WebSocket v3): partial transcripts for the instant stop, keyterm biasing for the robot vocabulary, low-latency turn detection.
- **AssemblyAI LLM Gateway** (Claude, structured outputs): the high-level policy that picks skills, the correction parser fallback, and the distillation step that turns corrections into policy rules.

## How it works

```
   operator voice ──▶ Universal-3.5 Pro ──partial "stop"──▶ sim.pause()   (<300 ms)
                                        └─final "a bit left"─▶ parse ──▶ sim.execute(nudge)
   high-level policy (Claude, LLM Gateway) ──skill──▶ low-level skills (frozen) ──▶ world
   correction log {2 s of state, rejected action, transcript, outcome}
        └──▶ Distill (Claude, LLM Gateway) ──▶ policy v(n+1) = rules + few-shots (+ diff)
```

The demo world is a gantry gripper packing three objects into a bag. The world has quirks the policy cannot perceive but a human can (the tape lifts only by its ring, the sponge must be squeezed to fit, the marker rolls out unless packed last). The base policy fails on all three; after one round of corrections and a distillation, it succeeds unaided.

## Run it

```bash
pnpm install
cp .env.example .env.local   # add your ASSEMBLYAI_API_KEY
pnpm dev
```

Open http://localhost:3000, allow the microphone, press **Run**, and talk.

Scripts: `pnpm test` (vitest), `pnpm typecheck`, `pnpm dry-run` (headless run of the full loop without a browser).

## Repo map

| Folder | What |
|---|---|
| `lib/sim` | deterministic kinematic world, skill library, ring buffer |
| `components/Scene` | react-three-fiber rendering of the world |
| `lib/voice`, `public/worklets` | mic capture → PCM16 → AssemblyAI streaming; stop-word detection on partials |
| `lib/corrections` | spoken correction → skill command (grammar first, LLM fallback) |
| `lib/policy`, `lib/llm` | policy prompt, decisions, distillation, versions, LLM Gateway client |
| `app/api/*` | token minting, policy, correction, distill route handlers (server-side key) |
| `docs/` | contracts, pitch copy, demo storyboard |

## Next steps

Real-robot bridge (the skill interface maps 1:1 to a ROS action server), multi-operator sessions, and swapping prompt-level distillation for actual fine-tuning of a small policy model on the same log.

MIT — see LICENSE.
