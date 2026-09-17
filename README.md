# Jev Gamecast

Jev Gamecast is a replay-first React + TypeScript + Vite product. Replay is the safe default: a checked-in synthetic fixture renders without network access, credentials, Convex, ESPN, or a paid Jev call. Live mode is explicit and fail-closed.

## Local replay

```bash
npm install
npm run dev
```

Open the Vite URL and use `PLAY REPLAY`, the event pins, or the range slider. With no `VITE_GAMECAST_MODE=live`, the browser only uses the static fixture.

## Verification

```bash
npm test
npm run test:convex
npm run typecheck
npm run typecheck:server
npm run typecheck:convex
npm run build
npm run audit
```

`test:convex` uses the official `convex-test` mock runtime. It exercises the real checked-in Convex schema/functions for immutable idempotent writes, claims, durable budget reservations, access-control rejection, and the read-only action. It is not evidence of a deployed Convex environment or a Convex-backed browser end-to-end run. All tests use deterministic inputs and never make a paid Jev request.

## Pinned football analysis fixture

`src/fixtures/footballTimeline.ts` exports the deterministic Seahawks Super Bowl fixture used by Jev Data Analysis. It is generated from the hash-pinned nflverse `play_by_play_2025` release (with the checked-in CSV.gz fallback), filtered to 71 Seattle run/pass/sack rows in `play_id` order and split into 39 H1 input rows and 32 H2 evaluation rows. `games.csv` is used only for identity and integrity assertions.

The halftime contract exposes H1-only model inputs and evaluates the highest H2 Seattle scrimmage-yard contributor using stable player IDs. H2 rows, final scores, full-game totals, postgame data, and result metadata never enter the model input. The fixture is a demo contract test, not evidence of model quality or generalization, and its label is an MVP proxy rather than an official award. Attribution and CC BY 4.0 source links are stored in the fixture manifest.

Regenerate from verified local source assets with `node scripts/generate-football-fixture.mjs --pbp <play_by_play_2025.csv.gz> --games <games.csv> --out src/fixtures/data/seahawks-super-bowl-2026.json`, or validate the checked-in representation with `npm run fixture:validate`.

## Runtime layout

- `convex/schema.ts` defines the durable `forecastRecords`, `forecastClaims`, `forecastBudgets`, and `forecastBudgetReservations` tables and indexes.
- `convex/forecasts.ts` defines featured-game-only public queries. Writes, claims, and budget reservations are internal mutations reachable only through server-authorized actions requiring `CONVEX_WRITE_SECRET`; inputs are validated at that boundary.
- `convex/runtime.ts` defines a read-only operator health action; it never calls a provider.
- `src/server/convexStore.ts` is the server-only `ConvexHttpClient` adapter implementing the shared `ForecastRecordStore` boundary.
- `api/cron/forecast.ts` is a Vercel-compatible POST entrypoint. It authenticates the cron request, polls ESPN once, invokes the server-only Jev provider, and persists through Convex. It never starts a long-lived loop. Convex claims and budgets protect against overlapping workers and process restarts; the local `running` flag is only an optimization.
- `api/gamecast.ts` is the public, browser-safe read route. It exposes only the featured game, strips Convex system fields, applies CORS/read-rate controls, and returns `503` rather than inventing live data when provisioning is missing or the durable read fails.
- `src/browser/forecastHttp.ts` and `src/browser/forecastRead.ts` consume the public read response. They do not import ESPN, TypeSafe, Convex server code, or credentials. `VITE_GAMECAST_MODE=live` opts into this source; failed live reads retain the replay points instead of silently labeling them live.
- `vercel.json` schedules the bounded cron route every two minutes. This is compatible with the 90-second worker cadence and leaves scheduler ownership outside application code.

## Convex provisioning (operator step)

A real Convex deployment and its URL are required for live operation. This repository does not claim that an external deployment has been provisioned.

1. Install the dependencies and authenticate with Convex using the official CLI:

   ```bash
   npx convex dev
   ```

   Choose or create the project when prompted. This creates/updates the deployment configuration and regenerates `convex/_generated/` from the checked-in schema/functions. Keep generated output in the deployment branch and re-run `npm run typecheck:convex`.

2. Set the server environment variables in the Convex/Vercel operator environments as appropriate. Set the same high-entropy `CONVEX_WRITE_SECRET` in Convex and the server runtime. Never put `JEV_API_KEY` or `CONVEX_WRITE_SECRET` in a `VITE_*` variable:

   ```text
   CONVEX_URL=https://<deployment>.convex.cloud
   JEV_API_KEY=<operator-provisioned-secret>
   CRON_SECRET=<operator-provisioned-secret>
   CONVEX_WRITE_SECRET=<operator-provisioned-secret>
   FEATURED_GAME_ID=<one ESPN NFL event id>
   LIVE_PUBLIC_ORIGIN=https://<public-site-origin>
   ```

3. Deploy the Convex functions with the official command (`npx convex deploy`) and verify the generated API/function metadata in the deployment dashboard. The `npx convex dev`/`deploy` steps require an operator login and are intentionally not run in CI without credentials.

## Vercel deployment and live runbook (operator step)

1. Import the repository into Vercel as a Vite project and configure Node 20+ serverless functions.
2. Add `CONVEX_URL`, `JEV_API_KEY`, `CRON_SECRET`, `CONVEX_WRITE_SECRET`, `FEATURED_GAME_ID`, and `LIVE_PUBLIC_ORIGIN` as server-side environment variables. Add `VITE_GAMECAST_MODE=live` and `VITE_FEATURED_GAME_ID=<same featured id>` only when the Convex deployment and cron route have been verified.
3. Deploy. Vercel reads `vercel.json` and schedules `/api/cron/forecast` every two minutes. The route accepts `POST` only and requires `Authorization: Bearer $CRON_SECRET` (or the equivalent `x-cron-secret` header for a controlled smoke test).
4. Verify the public path with `GET /api/gamecast?gameId=<featured id>` and inspect the returned `mode`, `status`, and persisted record identity. Verify one cron cycle through the protected route. Never use a browser call to ESPN or TypeSafe as a smoke test.
5. Keep live mode off until provider rights, TypeSafe spend limits, Convex deployment, and Vercel cron provisioning are approved. If any required live variable is absent, the cron route returns `503` and the browser remains on replay.

The route-level read throttle and cron overlap flag are process-local optimizations only; Vercel can run multiple instances. Durable request, rate, spend, and claim limits must remain enforced by the Convex boundary, not by those process-local flags.

The public route intentionally serves one featured game and at most 128 persisted records. It does not expose provider response bodies, credentials, personal data, betting/trading/voting/fantasy semantics, or future/post-event fields. Forecast probabilities are canonical unit values in storage and are converted to display percentages once in the browser; they are fictional experimental forecasts, not sportsbook odds.

## Safety boundaries

- Server-only modules contain the ESPN adapter, TypeSafe SDK, `JEV_API_KEY`, and the Convex HTTP client.
- The Vite build fails if server markers (`@typesafe-ai/sdk`, `JEV_API_KEY`, TypeSafe endpoint, `convex/browser`, or `CONVEX_URL`) enter a browser chunk.
- Missing keys, invalid Convex URLs, unauthorized cron requests, unsupported game IDs, provider errors, stale ESPN data, and durable read failures fail closed. They do not silently become live success.
- Convex records are keyed by `gameId + providerEventId + stateHash` through the worker idempotency key. Forecast documents are immutable; claims are not reclaimed by nominal lease expiry; budget settlement is idempotent.
- Replay behavior and controls remain deterministic and credential-free.
