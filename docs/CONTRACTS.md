# Module ownership & contracts

All shared shapes live in `lib/types.ts`. Modules talk to each other **only** through those types and the store interfaces below.

| Module | Owner folder(s) | Exposes |
|---|---|---|
| sim | `lib/sim/**`, `components/Scene/**`, `store/useSimStore.ts` | `useSimStore` (see below), `<Scene />` (r3f canvas that renders the store) |
| voice | `lib/voice/**`, `public/worklets/**`, `app/api/token/route.ts`, `store/useVoiceStore.ts` | `useVoiceStore` (start/stop mic, status, partial), `createStreamingClient(events: VoiceEvents)` |
| corrections | `lib/corrections/**`, `app/api/correction/route.ts` | `parseCorrectionFast(text): SkillCommand | null`, `parseCorrection(text, obs): Promise<{command, source}>` |
| policy | `lib/policy/**`, `lib/llm/**`, `app/api/policy/route.ts`, `app/api/distill/route.ts`, `store/usePolicyStore.ts` | `BASE_POLICY: PolicyVersion`, `decide(obs, policy): Promise<PolicyDecision>`, `distill(req): Promise<PolicyVersion>`, `diffPolicies(a, b)`, `usePolicyStore` |
| ui | `components/**` (except Scene), `app/page.tsx`, `app/layout.tsx`, `app/globals.css`, `store/useRunsStore.ts` | page shell, panels, HUD, metrics |

## `useSimStore` (zustand)

```ts
interface SimStore {
  world: WorldState;
  reset(seed: number): void;
  start(): void;            // status -> running (does not pick actions; the policy loop does)
  pause(): void;            // immediate: freezes the current skill animation, status -> paused
  resume(): void;           // status -> running
  /** Executes one skill, animating it. Resolves with the outcome. Rejects never. If paused mid-way, resolves 'interrupted'. */
  execute(cmd: SkillCommand): Promise<SkillOutcome>;
  isBusy(): boolean;        // a skill animation is in flight
  getObservation(): Observation;
  getRecentStates(ms: number): WorldState[]; // ring buffer, oldest first, ≤ms of history
}
```

## Policy loop (integration, `lib/loop.ts`)

```
while world.status === 'running':
  if sim.isBusy() -> await
  decision = await decide(sim.getObservation(), currentPolicy)
  hud.show(decision)
  outcome = await sim.execute(decision.command)
  (stop from voice pauses the sim; correction executes through sim.execute then resume)
```

## Rules of engagement for workers
- Never edit files outside your folders; if you need a contract change, add it to `docs/CONTRACT_REQUESTS.md` and mock locally.
- `pnpm typecheck` must pass for your folders. Unit tests with vitest in `test/<module>.test.ts`.
- Next.js 16: read `node_modules/next/dist/docs/01-app/**` before using any Next API (route handlers, `use client`, fonts).
- Route handlers run on the Node runtime; never set `runtime = 'edge'`.
- The AssemblyAI key is server-side only (`process.env.ASSEMBLYAI_API_KEY`).
