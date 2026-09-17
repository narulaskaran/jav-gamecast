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

## Stage 2 feed boundary

`src/server/espn.ts` is a replaceable, server-side-only ESPN adapter. It reads the current publicly observed scoreboard, summary, and core play-by-play endpoints from ESPN's undocumented upstream, then normalizes provider data into the shared `GameState` contract. The adapter does not start a polling loop or call Jev; its caller controls cadence and can inject a `featuredEventId` for the one selected game.

The adapter sends `jev-gamecast/0.1 (+project URL)`, applies a bounded timeout and retry budget, and never calls ESPN from the React bundle. It rejects duplicate and out-of-order play updates, marks old or failed cached data `STALE`, and uses the deterministic fixture source as `REPLAY` fallback when configured. ESPN is undocumented and fields such as possession, down/distance, clock, and play timestamps may be absent; missing values remain empty or null rather than being invented.

Production use still requires an external server/worker runtime, provider-rights review, and deployment-runtime testing. The checked-in app remains offline and continues to render the replay fixture.
