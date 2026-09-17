# Jev Data Analysis API contract

The analysis API is fixture-first and server-only. The checked-in football fixture is `seahawks-super-bowl-2026-jev-v1`; it has 39 H1 input rows and 32 H2 evaluation rows. H2 rows, labels, final scores, and postgame fields are never sent to Jev.

## Draft a classifier query

`POST /api/analysis/draft`

Request JSON:

```json
{"fixtureId":"seahawks-super-bowl-2026-jev-v1","task":"Find a useful first-half classification."}
```

The route calls the server-only OpenRouter adapter using `OPENROUTER_KEY`. It returns an editable query and safe metadata:

```json
{
  "fixtureId":"seahawks-super-bowl-2026-jev-v1",
  "query":"Classify the likely H2 leader using only the supplied H1 row.",
  "metadata":{
    "provider":"openrouter",
    "model":"openai/gpt-4o-mini",
    "rowCount":39,
    "inputHalf":"H1",
    "labelHalf":"H2",
    "classes":["K.Walker","C.Kupp","J.Smith-Njigba","Other/Tie"]
  }
}
```

OpenRouter errors are returned as stable error codes with 4xx/5xx status. Provider response bodies and credentials are not returned.

## Start a Jev run

`POST /api/analysis/run`

Request JSON:

```json
{"fixtureId":"seahawks-super-bowl-2026-jev-v1","query":"Classify the likely H2 leader using only the supplied H1 row."}
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
  "query":"...",
  "status":"queued",
  "createdAt":"...",
  "updatedAt":"...",
  "progress":{"completedRows":0,"totalRows":39,"completedCalls":0,"totalCalls":39},
  "currentFixtureRow":{"rowIndex":0,"input":{"play_id":57,"qtr":1}},
  "resultRows":[]
}
```

`status` is one of `queued`, `running`, `complete`, or `error`. Result rows are sorted by `rowIndex` on every read. Each completed row contains the H1 input plus the Jev model, selected class, per-class probabilities, and optional confidence. Errors expose only a stable code and retryability flag; partial result rows remain bounded and readable.

## Public share read

`GET /api/share/<analysisId>`

This reconstructs the same bounded, deterministic snapshot from the storage interface. It performs no OpenRouter or Jev provider call and supports no write method.

## Storage boundary

`AnalysisStorage` is intentionally small (`get` and `put`). `InMemoryAnalysisStore` is a temporary non-production implementation used for this lane and local tests; it is process-local and non-durable. A later Convex adapter can replace it without changing the API/domain or UI contract. Snapshot cloning and row sorting keep local reads and share serialization deterministic.

## Server boundary

`OPENROUTER_KEY` and `JEV_API_KEY` are read only in `src/server`. The browser does not import provider adapters, the TypeSafe SDK, or runtime configuration. The Vite build guard scans browser chunks for both credential markers and provider endpoints.
