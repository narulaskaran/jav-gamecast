# Jev Data Analysis API contract

The playground accepts three dataset sources: the checked-in sample fixture, a CSV file upload, and a public HTTPS CSV URL. All three use the same draft → edit Jev query JSON → run worker. Chart type follows the drafted query: Noul/Score render a live series; Choice renders class-distribution bars. The sample default task is win likelihood per play (Jev Noul). The browser never calls Jev, OpenRouter, UploadThing, or privileged Convex writes.

The checked-in football fixture is `seahawks-super-bowl-2026-jev-v1` (71 Seattle run/pass/sack plays, ordered by `play_id`). The sample win-likelihood / Noul path sends the full game, including in-progress `posteam_score`, `defteam_score`, `score_differential`, and clock/situation. H1→H2 yards evaluation still uses 39 first-half rows without absolute scores; identity, final scores, and postgame fields never enter either path. Super Bowl copy is illustrative sample data only.

## Dataset intake

`GET /api/datasets/status` returns `{ convex, uploadThing, sampleAvailable }` with no secrets. `uploadThing: true` means the same token reader the upload path uses found a usable `UPLOADTHING_TOKEN` / `UPLOADTHING_SECRET` (raw `sk_…` or an UploadThing dashboard v7 token). Empty or invalid-format values are `false`. Upload and public URL fail closed (`UPLOADTHING_NOT_CONFIGURED` or `ANALYSIS_STORAGE_NOT_CONFIGURED`) when those flags are false. When storage is configured but the credential cannot upload (retired `/v6/uploadFiles`, missing app id/region, or an ingest rejection), the routes return `UPLOADTHING_FAILED` — never a false “not configured”. Responses include a secret-free `failure` discriminator:

- `TOKEN_MISSING_APP_REGION` — token is present (`uploadThing: true`) but is a raw `sk_…` without dashboard `appId`/`regions`
- `INGEST_HTTP` — UploadThing ingest rejected the signed PUT
- `INGEST_RUNTIME` — upload threw before a shaped DatasetError (sqids/HMAC/Blob/fetch)
- `CONVEX_PUT_FAILED` — UploadThing ingest succeeded, then Convex `datasets.put` failed. Includes a secret-free `message`. A Convex HTTP `[Request ID] Server Error` (no Uncaught Error) means production did not run `npx convex deploy` with `CONVEX_DEPLOY_KEY`. Never forwards the Convex dump (it can contain `authToken`).
- `UNCAUGHT` — handler catch-all; also logs `[datasets] intake failed` to Vercel runtime logs

Do not treat HTTP 500 `{ "error": "DATASET_UNAVAILABLE" }` as “not configured”. That used to mean an unlogged throw; it should now include `failure`.

BYOD upload uses the v7 server-side ingest path (`UTApi.uploadFiles`): the adapter HMAC-signs `https://<region>.ingest.uploadthing.com/<fileKey>` and PUTs the CSV. It does not call `POST /v6/uploadFiles` (UploadThing returns HTTP 400 `Unsupported operation` for that). A raw `sk_…` key is enough for `uploadThing: true`, but a successful upload needs the dashboard **API Keys → V7** token: base64 JSON `{ apiKey, appId, regions }`.

`POST /api/datasets/from-csv`

```json
{"csvText":"label,count\nurgent,1\n","filename":"tickets.csv"}
```

`POST /api/datasets/from-url`

```json
{"url":"https://example.com/data.csv"}
```

Public URLs must be HTTPS, have no credentials, return CSV directly, and must not target localhost/private/metadata addresses. Caps: 5 MB, 5,000 rows, 100 columns. Stable error codes include `CSV_TOO_LARGE`, `NOT_CSV`, `CSV_PARSE_FAILED`, `URL_NOT_PUBLIC`, `URL_NOT_HTTPS`, `URL_TIMEOUT`, `URL_NOT_FOUND`, `URL_FETCH_FAILED`, and `URL_UNSAFE`. The fetch path streams the body and stops at the byte cap; slow or oversized URLs fail with a clear timeout/size error rather than hanging. After validation the server stores the original blob in UploadThing and dataset metadata plus immutable row refs in Convex.

`GET /api/datasets/<datasetId>` returns the sanitized table (all accepted rows and columns) for the playground preview. Durable Convex metadata still stores a short `previewRows` cap; row bodies live in `datasetRows`. `GET /api/browse` lists public dataset metadata only.

## Draft a classifier query

`POST /api/analysis/draft`

Request JSON (sample or BYOD):

```json
{"datasetId":"seahawks-super-bowl-2026-jev-v1","task":"Win likelihood of the game per play."}
```

`fixtureId` remains accepted for the sample dataset. The route calls the server-only OpenRouter adapter using `OPENROUTER_KEY`. It returns an editable **Jev query JSON** object (Noul / Choice / Score) and safe metadata. Draft honors the user task. The cached sample Noul (`Will SEA win given this play state?`) is used only for the exact default sample task (`Win likelihood of the game per play.`) on the fixture. Any other prompt calls OpenRouter. Choice drafts recover class labels from the task text (for example fruit/vehicle) and from label-like columns when the model returns fewer than two classes. Content-hash run reuse still keys only on identical `datasetId` + canonical query.

OpenRouter errors are returned as stable error codes with 4xx/5xx status. Provider response bodies and credentials are not returned. The UI must not surface internal codes such as `INVALID_CLASSES` verbatim.

```json
{
  "fixtureId":"seahawks-super-bowl-2026-jev-v1",
  "datasetId":"seahawks-super-bowl-2026-jev-v1",
  "sourceType":"fixture",
  "query":"{\n  \"type\": \"noul\",\n  \"instructions\": \"Will SEA win given this play state?\"\n}",
  "metadata":{
    "provider":"openrouter",
    "model":"openai/gpt-4o-mini",
    "rowCount":71,
    "questionKind":"noul",
    "classes":[],
    "columns":["play_id","qtr","game_seconds_remaining","posteam_score","defteam_score","score_differential"],
    "displayName":"2026 Super Bowl Demo"
  }
}
```


`POST /api/analysis/run`

Request JSON:

```json
{"datasetId":"seahawks-super-bowl-2026-jev-v1","query":"Will SEA win given this play state?","questionKind":"noul"}
```

`analysisId` is optional. Supplying it again with the same fixture/dataset and query is idempotent; it does not create another run.

**Product rule (sample and BYOD):** if the same Jev query is run against the same dataset, return the saved complete snapshot. Do not recompute.

Before minting a new `analysisId`, `start()` looks up an existing **complete** snapshot by content key: SHA-256 of `{ v: 1, datasetId, query, questionKind, classes }`. `datasetId` is the fixture id for the sample dataset. `query` is the canonical Jev query JSON (plain-text instructions and pretty-printed JSON with the same type/instructions/classes hash equal). Lookup uses Convex `analyses:authorizedGetCompleteAnalysisByContentKey` (`by_content_key_status` on `contentKey` + `status`). A hit returns that snapshot with HTTP `200` and does **not** call Jev or write another analysis document. Existing `/share/{analysisId}` links keep working. Queued, running, and error snapshots are not reused; those still create a new run. `forceNew: true` skips the content-key lookup (same `analysisId` remains idempotent). Default is reuse for every source.

The sample default draft (`Win likelihood of the game per play.` on the fixture) returns the cached Noul query without calling OpenRouter. Other sample prompts are drafted from the task text.

A newly queued run still returns `202` and starts execution through the server-only Jev adapter. This is the only route that can start Jev execution. Drafting, editing the query, page load, status reads, and share reads do not call Jev.

Every run is bounded by `5,000` calls and `5,000` rows. The current fixture is below both bounds. Query and task sizes are bounded and NUL-containing values are rejected.

## Read progress

`GET /api/analysis/<analysisId>`

A bounded snapshot has this shape:

```json
{
  "analysisId":"analysis-1",
  "fixtureId":"seahawks-super-bowl-2026-jev-v1",
  "datasetId":"seahawks-super-bowl-2026-jev-v1",
  "sourceType":"fixture",
  "query":"Will SEA win given this play state?",
  "status":"queued",
  "createdAt":"...",
  "updatedAt":"...",
  "progress":{"completedRows":0,"totalRows":71,"completedCalls":0,"totalCalls":71},
  "questionKind":"noul",
  "classes":[],
  "columns":["play_id","qtr","game_seconds_remaining","posteam_score","defteam_score","score_differential"],
  "currentFixtureRow":{"rowIndex":0,"input":{"play_id":57,"qtr":1,"posteam_score":0,"defteam_score":0,"score_differential":0}},
  "resultRows":[]
}
```

`status` is one of `queued`, `running`, `complete`, or `error`. Result rows are sorted by `rowIndex` on every read. Each completed row contains the row sent to Jev plus the Jev model and the typed answer: Noul/Score store `value` (P(win) or normalized score); Choice stores selected class, per-class probabilities, and optional confidence. Sample win-likelihood rows include in-progress scores and later-game plays. CSV columns such as `wpa` are inputs, not Jev outputs. Errors expose only a stable code and retryability flag; partial result rows remain bounded and readable.

## Public share read

`GET /api/share/<analysisId>` reconstructs the same bounded, deterministic snapshot from the storage interface. It performs no OpenRouter or Jev provider call and supports no write method. Completed runs can also download a formula-escaped results CSV in the browser (`row_id,probability` or class columns). That export does not call Jev or hit this route.

## Storage boundary

`AnalysisStorage` is intentionally small and is implemented in production by the server-only `ConvexAnalysisStore` (`src/server/analysisStore.ts`). Stores must implement `findCompleteByContentKey`: complete snapshot reuse by dataset + query is the primary run behavior for every source. The adapter uses generated Convex functions for authorized snapshot writes/claims, complete-by-content-key lookup, and the public share query for read-only share pages, so queued, incremental, completed, and partial-error snapshots survive process restarts and can be read across instances. `InMemoryAnalysisStore` remains available only for deterministic local tests; it is process-local and is not a production fallback. Snapshot cloning and row sorting keep reads and share serialization deterministic. Writes store `contentKey` on the analysis document; public share snapshots omit it.

The production runtime requires a valid `CONVEX_URL` (or Convex Vite alias `VITE_CONVEX_URL`) and `CONVEX_WRITE_SECRET` before constructing the Convex adapter. Set the same `CONVEX_WRITE_SECRET` on the Convex deployment and the Vercel server runtime. BYOD CSV intake additionally requires `UPLOADTHING_TOKEN` (or `UPLOADTHING_SECRET`). Prefer the UploadThing dashboard **V7** token (base64 JSON with `apiKey`, `appId`, and `regions`). A standalone `sk_…` secret reports configured but cannot sign ingest URLs. If those are absent, API reads/writes and upload/URL intake fail closed rather than silently using process-local storage or faking a run. The sample fixture on-ramp does not need UploadThing. Provisioning is an operator step.

`ConvexDatasetStore.put` sends only schema fields (no `publicDataWarning`, no `undefined` optional keys). The Convex action `datasets:authorizedPutDataset` authorizes with `CONVEX_WRITE_SECRET`, upserts metadata, then writes row documents in batches of 200.

Vercel Production build command is `node scripts/vercel-build.mjs` (`vercel.json`). That runs `npx convex deploy --cmd 'npm run build'` when `VERCEL_ENV=production` and `CONVEX_DEPLOY_KEY` is set, then attempts to copy `CONVEX_WRITE_SECRET` onto the Convex deployment. A deploy key without `deployment:env:write` logs a warning and does not fail the Vercel build; Convex function deploy failures still fail the build. A frontend-only `npm run build` does not update Convex; `POST /api/datasets/from-url` then fails with `CONVEX_PUT_FAILED` / Convex HTTP `Server Error`. Preview builds skip Convex deploy so they cannot push to prod.

## Server boundary

`OPENROUTER_KEY`, `JEV_API_KEY`, `CONVEX_WRITE_SECRET`, `CONVEX_DEPLOY_KEY`, and `UPLOADTHING_TOKEN` are read only in `src/server` or the production Vercel build. The browser does not import provider adapters, the TypeSafe SDK, UploadThing, or runtime configuration. The Vite build guard scans browser chunks for credential markers and provider endpoints.
