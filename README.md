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
