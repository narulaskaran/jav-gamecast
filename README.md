# Jev Data Analysis

Bring a dataset. Ask a question. See Jev classify every row.

This is a Jev playground: upload a CSV, paste a public CSV URL, or try the sample dataset, then watch a live class-distribution chart. It is not a live sports product or production analytics.

Start with `CURSOR.md` and `PLAN.md`. The API contract is `docs/analysis-api.md`.

## Local demo

```bash
npm install
npm run dev
```

Open the Vite URL. The landing page has two equal cards: **Try sample** (the checked-in Seahawks fixture) and **Bring your own** (CSV upload or public HTTPS CSV URL). Draft a classifier query, edit it, then confirm **Run Jev**.

Visiting or sharing a page never starts a paid Jev run. The browser never calls Jev, OpenRouter, ESPN, UploadThing, or privileged Convex writes. Tests never make a paid provider request.

## Verify

```bash
npm test
npm run test:convex
npm run typecheck
npm run typecheck:server
npm run typecheck:functions
npm run typecheck:convex
npm run build
npm run audit
```

`test:convex` uses the official `convex-test` mock runtime. It is not evidence of a deployed Convex environment.

## Sample fixture

`src/fixtures/footballTimeline.ts` is the sample on-ramp: 39 first-half model-input rows and 32 held-out second-half evaluation rows. H2 rows, final scores, and postgame fields never enter the model. Validate with `npm run fixture:validate`.

## API

Dataset intake:

- `GET /api/datasets/status` — Convex / UploadThing / sample flags, no secrets
- `POST /api/datasets/from-csv` — upload a CSV
- `POST /api/datasets/from-url` — fetch a public HTTPS CSV
- `GET /api/datasets/<id>` — sanitized preview
- `GET /api/browse` — public dataset metadata

Analysis:

- `POST /api/analysis/draft` — server-only OpenRouter drafts an editable query
- `POST /api/analysis/run` — starts a bounded Jev run (the only path that calls Jev)
- `GET /api/analysis/<id>` — progress snapshot
- `GET /api/share/<id>` — public readback; no provider call

Payload shapes and error codes live in `docs/analysis-api.md`.

## Operator deploy

Durable analysis, share, and dataset storage needs Convex. Production fails closed with `ANALYSIS_STORAGE_NOT_CONFIGURED` until it is provisioned. In-memory stores are for local tests only.

```bash
npx convex dev
npx convex deploy
```

Set these server-side. Never put secrets in a `VITE_*` variable:

```text
CONVEX_URL=https://<deployment>.convex.cloud
CONVEX_WRITE_SECRET=<operator-provisioned-secret>
OPENROUTER_KEY=<operator-provisioned-secret>
JEV_API_KEY=<operator-provisioned-secret>
UPLOADTHING_TOKEN=<UploadThing dashboard API Keys → V7 token>
```

`VITE_CONVEX_URL` is accepted as an alias for `CONVEX_URL`. Keep the same Convex write secret in Convex and the server runtime. Import the repo into Vercel as a Vite project (Node 20+).

BYOD CSV upload and public URL intake also need `UPLOADTHING_TOKEN`: the dashboard **API Keys → V7** token (base64 JSON `{ apiKey, appId, regions }`). A raw `sk_…` key is not enough to upload. The sample on-ramp does not need UploadThing. Caps and fail-closed codes are in `docs/analysis-api.md`.

Historical Gamecast ESPN and cron code still exists under `historical/`. Those routes are not shipped as Vercel functions.

## Safety

- Server-only modules own OpenRouter, the TypeSafe/Jev SDK, UploadThing, `JEV_API_KEY`, `OPENROUTER_KEY`, `UPLOADTHING_TOKEN`, and the Convex HTTP client.
- The Vite build fails if those markers enter a browser chunk.
- Missing keys, invalid Convex URLs, and durable-read or intake failures fail closed. They do not silently become live success.
