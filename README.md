# Jev Gamecast

Replay-first React + TypeScript + Vite vertical slice for the Jev Gamecast systems demo.

The app is intentionally offline: it renders a checked-in synthetic fixture through separate `GameStateSource` and `ForecastSource` adapters. It does not call ESPN, Jev, Convex, MPP, or any betting/fantasy service.

## Run locally

```bash
npm install
npm run dev
```

Open the local Vite URL, then use `PLAY REPLAY`, step buttons, event pins, or the range slider to move through the eight stored checkpoints.

## Checks

```bash
npm test
npm run build
```

The output is Vercel-compatible as a static Vite build. Forecast values are fictional and experimental, not calibrated sportsbook odds.

## Stage 3 server forecast worker

`src/server/jev.ts` is a server-only TypeSafe boundary for Node 20+ using `@typesafe-ai/sdk`. It sends one typed `Choice` question to `POST https://api.typesafe.ai/v1/systemone` with model `jev-latest`; the SDK reads `TYPESAFE_API_KEY` only in the server runtime. `src/server/forecastWorker.ts` normalizes state, hashes it into an idempotency key, returns exact cached records for duplicate jobs, and produces persistence-ready success/error/limit records without provider bodies or credentials.

Live mode is fail-closed when the key or provider is unavailable. The worker applies a default 90-second cadence, finite request/rate/spend ceilings, and explicit timeout/429/529 retry configuration. `mock` and `replay` modes are deterministic and opt-in; tests inject fake clients/providers and never make a paid or credentialed Jev call. The Vite build fails if server-only SDK, endpoint, or credential markers enter a browser chunk.

## Stage 2 feed boundary

`src/server/espn.ts` is a replaceable, server-side-only ESPN adapter. It reads the current publicly observed scoreboard, summary, and core play-by-play endpoints from ESPN's undocumented upstream, then normalizes provider data into the shared `GameState` contract. The adapter does not start a polling loop or call Jev; its caller controls cadence and can inject a `featuredEventId` for the one selected game.

The adapter sends `jev-gamecast/0.1 (+project URL)`, applies a bounded timeout and retry budget, and never calls ESPN from the React bundle. It rejects duplicate and out-of-order play updates, marks old or failed cached data `STALE`, and uses the deterministic fixture source as `REPLAY` fallback when configured. ESPN is undocumented and fields such as possession, down/distance, clock, and play timestamps may be absent; missing values remain empty or null rather than being invented.

Production use still requires an external server/worker runtime, provider-rights review, and deployment-runtime testing. The checked-in app remains offline and continues to render the replay fixture.

## Stage 3/4 integration boundary

`src/server/orchestrator.ts` exposes a single bounded `runForecastCycle` invocation and `createForecastCycleHandler`. One invocation polls ESPN once, creates one normalized forecast job, runs `ForecastWorker`, and writes one idempotent `ForecastRecord`. It never starts a long-lived loop; an external scheduler owns cadence, process lifetime, retries across invocations, and overlap policy. Live invocations share a process-local boundary by default; deployments must inject the same durable `ForecastRecordStore` across processes/restarts (and may set `budgetScope`, defaulting to `gameId`). Its atomic budget reservation enforces cadence, rolling rate, lifetime request, and spend limits across workers. Reservations are consumed after a provider call, released only when no provider call was made, and remain fail-closed if settlement is unavailable.`

`src/shared/forecastRecords.ts` defines the server/browser-safe record contract. `src/persistence/convexBoundary.ts` describes the typed Convex query/mutation/schema boundary without importing Convex, including atomic budget reservation/settlement. `src/persistence/forecastStore.ts` provides an atomic in-memory `putIfAbsent`, claim, and budget store for tests and no-config local replay. Claims are deliberately non-reclaimable: `claimLeaseMs` is retained for wire compatibility but expiry never permits another provider invocation while the original claim is unfinalized. Actual Convex files and deployment configuration are intentionally not included because this repository has no Convex package/project binding or credentials.

`src/browser/forecastRead.ts` reads cached and replay records through the shared boundary and maps successful records to the existing `ForecastPoint` contract. It does not import `src/server/*`, the TypeSafe SDK, ESPN, or credentials. All readers can therefore consume the same persisted record instead of making provider calls.

For local no-config execution, use the explicit `mock` mode, or `replay` mode without supplied records; both use the in-memory store and deterministic local provider (the latter labels the persisted source `replay`). Live mode fails closed and persists a configuration error when `TYPESAFE_API_KEY` is absent; it never silently falls back to mock or replay. No Vercel/Convex deployment is claimed by this repository.
