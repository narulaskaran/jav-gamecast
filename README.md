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
