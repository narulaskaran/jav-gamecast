# Jev Data Analysis API contract

The playground accepts three dataset sources: the checked-in sample fixture, a CSV file upload, and a public HTTPS CSV URL. All three use the same draft → edit query → run worker and the same live class-distribution chart. The browser never calls Jev, OpenRouter, UploadThing, or privileged Convex writes.

The checked-in football fixture is `seahawks-super-bowl-2026-jev-v1`; it has 39 H1 input rows and 32 H2 evaluation rows. H2 rows, labels, final scores, and postgame fields are never sent to Jev. Super Bowl copy is illustrative sample data only.

## Dataset intake

`GET /api/datasets/status` returns `{ convex, uploadThing, sampleAvailable }` with no secrets. `uploadThing: true` means the same token reader the upload path uses found a usable `UPLOADTHING_TOKEN` / `UPLOADTHING_SECRET` (raw `sk_…` or an UploadThing dashboard v7 token). Empty or invalid-format values are `false`. Upload and public URL fail closed (`UPLOADTHING_NOT_CONFIGURED` or `ANALYSIS_STORAGE_NOT_CONFIGURED`) when those flags are false. When storage is configured but the credential cannot upload (retired `/v6/uploadFiles`, missing app id/region, or an ingest rejection), the routes return `UPLOADTHING_FAILED` — never a false “not configured”. Responses include a secret-free `failure` discriminator:

- `TOKEN_MISSING_APP_REGION` — token is present (`uploadThing: true`) but is a raw `sk_…` without dashboard `appId`/`regions`
- `INGEST_HTTP` — UploadThing ingest rejected the signed PUT
- `INGEST_RUNTIME` — upload threw before a shaped DatasetError (sqids/HMAC/Blob/fetch)
- `CONVEX_PUT_FAILED` — UploadThing ingest succeeded, then Convex `datasets.put` failed (undefined payload fields, write-secret mismatch, missing function, or mutation error). Includes a secret-free `message` reason. Never forwards the Convex dump (it can contain `authToken`).
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

Public URLs must be HTTPS, have no credentials, return CSV directly, and must not target localhost/private/metadata addresses. Caps: 5 MB, 5,000 rows, 100 columns. Stable error codes include `CSV_TOO_LARGE`, `NOT_CSV`, `CSV_PARSE_FAILED`, and `URL_NOT_PUBLIC`. After validation the server stores the original blob in UploadThing and dataset metadata plus immutable row refs in Convex.

`GET /api/datasets/<datasetId>` returns a sanitized preview (not all rows). `GET /api/browse` lists public dataset metadata only.

## Draft a classifier query

`POST /api/analysis/draft`

Request JSON (sample or BYOD):

```json
{"datasetId":"seahawks-super-bowl-2026-jev-v1","task":"Classify each row using the visible columns."}
```

`fixtureId` remains accepted for the sample dataset. The route calls the server-only OpenRouter adapter using `OPENROUTER_KEY`. It returns an editable query and safe metadata:

```json
{
  "fixtureId":"seahawks-super-bowl-2026-jev-v1",
  "datasetId":"seahawks-super-bowl-2026-jev-v1",
  "sourceType":"fixture",
  "query":"Classify each row using the visible columns.",
  "metadata":{
    "provider":"openrouter",
    "model":"openai/gpt-4o-mini",
    "rowCount":39,
    "inputHalf":"H1",
    "labelHalf":"H2",
    "classes":["K.Walker","C.Kupp","J.Smith-Njigba","Other/Tie"],
    "columns":["play_id"],
    "displayName":"Super Bowl Seahawks demo"
  }
}
```

OpenRouter errors are returned as stable error codes with 4xx/5xx status. Provider response bodies and credentials are not returned.

## Start a Jev run

`POST /api/analysis/run`

Request JSON:

```json
{"datasetId":"seahawks-super-bowl-2026-jev-v1","query":"Classify each row using the visible columns.","classes":["K.Walker","C.Kupp","J.Smith-Njigba","Other/Tie"]}
```

`analysisId` is optional. Supplying it again with the same fixture and query is idempotent; it does not create another run. The route returns `202` with a queued snapshot and starts execution through the server-only Jev adapter. This is the only route that can start Jev execution. Drafting, editing the query, page load, status reads, and share reads do not call Jev.

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
  "query":"...",
  "status":"queued",
  "createdAt":"...",
  "updatedAt":"...",
  "progress":{"completedRows":0,"totalRows":39,"completedCalls":0,"totalCalls":39},
  "classes":["K.Walker","C.Kupp","J.Smith-Njigba","Other/Tie"],
  "columns":["play_id"],
  "currentFixtureRow":{"rowIndex":0,"input":{"play_id":57,"qtr":1}},
  "resultRows":[]
}
```

`status` is one of `queued`, `running`, `complete`, or `error`. Result rows are sorted by `rowIndex` on every read. Each completed row contains the H1 input plus the Jev model, selected class, per-class probabilities, and optional confidence. Errors expose only a stable code and retryability flag; partial result rows remain bounded and readable.

## Public share read

`GET /api/share/<analysisId>`

This reconstructs the same bounded, deterministic snapshot from the storage interface. It performs no OpenRouter or Jev provider call and supports no write method.

## Storage boundary

`AnalysisStorage` is intentionally small and is implemented in production by the server-only `ConvexAnalysisStore` (`src/server/analysisStore.ts`). It uses the generated Convex functions for authorized snapshot writes/claims and the public share query for read-only share pages, so queued, incremental, completed, and partial-error snapshots survive process restarts and can be read across instances. `InMemoryAnalysisStore` remains available only for deterministic local tests; it is process-local and is not a production fallback. Snapshot cloning and row sorting keep reads and share serialization deterministic.

The production runtime requires a valid `CONVEX_URL` (or Convex Vite alias `VITE_CONVEX_URL`) and `CONVEX_WRITE_SECRET` before constructing the Convex adapter. Set the same `CONVEX_WRITE_SECRET` on the Convex deployment and the Vercel server runtime. BYOD CSV intake additionally requires `UPLOADTHING_TOKEN` (or `UPLOADTHING_SECRET`). Prefer the UploadThing dashboard **V7** token (base64 JSON with `apiKey`, `appId`, and `regions`). A standalone `sk_…` secret reports configured but cannot sign ingest URLs. If those are absent, API reads/writes and upload/URL intake fail closed rather than silently using process-local storage or faking a run. The sample fixture on-ramp does not need UploadThing. Provisioning is an operator step.

`ConvexDatasetStore.put` sends only schema fields (no `publicDataWarning`, no `undefined` optional keys). The Convex action `datasets:authorizedPutDataset` authorizes with `CONVEX_WRITE_SECRET`, upserts metadata, then writes row documents in batches of 200. After a Convex functions deploy, a 5,000-row CSV no longer has to fit in one mutation or one 1.5 MB JSON check of every row.

## Server boundary

`OPENROUTER_KEY`, `JEV_API_KEY`, `CONVEX_WRITE_SECRET`, and `UPLOADTHING_TOKEN` are read only in `src/server`. The browser does not import provider adapters, the TypeSafe SDK, UploadThing, or runtime configuration. The Vite build guard scans browser chunks for credential markers and provider endpoints.
