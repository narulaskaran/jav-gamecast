# Jev Data Analysis

This repository is the **Jev playground** (Jev Data Analysis). It was originally Jev Gamecast. Live ESPN gamecast is historical implementation material only.

## Read first

- `PLAN.md` — product pivot, MVP scope, contracts, stages, and remaining gates
- `docs/analysis-api.md` — analysis + BYOD dataset API contract
- `README.md` — install, test, and Convex/Vercel/UploadThing notes for the playground

## Product

Bring a dataset. Ask a question. See Jev classify every row.

Audience: engineers playing with Jev. This is a technical demo / playground, not production analytics or a sports product.

## Current slice

- Landing keeps useful structure: title, the two CTA cards (Try sample / BYOD), then later stages fold in beneath them (~300ms ease-out; reduced-motion snaps). Idle does not show the JSON editor or chart. Title and CTAs stay; do not collapse into a blank poster. Still no limits/about essays.
- After Draft, the primary editor is pretty-printed Jev query JSON (Noul / Choice / Score), editable, with Copy. Run Jev is enabled when that JSON is valid (no extra edit gate). Invalid JSON disables Run. Sample default task is win likelihood per play (Jev Noul, live P(win) line) over **full-game** SEA plays with absolute score state (`posteam_score`, `defteam_score`, `score_differential`, clock). Choice classifiers keep class-distribution bars and, on this fixture, the H1-only yards-evaluation slice — the UI says so (`Classifying 39 of 71 rows (H1 plays).` while running; `Classified 39 of 71 rows (H1 plays).` when complete). Football is the sample, not the product.
- UI: Tailwind CSS + shadcn-style primitives (zinc neutrals; indigo only for Run Jev and the live chart accent). Motion guides the flow; keep the chrome quiet. Production injects `@vercel/analytics` from the Vite entry so Vercel Web Analytics tracks jev-gamecast.vercel.app.
- Live chart is the run-view hero: Noul/Score draw a scrubbable P(win) (or score) series over play index; Choice draws class bars. Sample win-likelihood uses the full 71-play domain (denser index, same line/area, `Row X of 71`). Paired with a `Row X of Y` rail rather than a CSV inspector. Completed runs can download a formula-escaped results CSV. Share remains a header button that copies the public URL. Mid-run failures use plain-language copy plus resume from the last good row — never raw internal codes. Never plot CSV `wpa` as if Jev produced it.
- Dataset preview shows the full accepted table (sample 71×26; BYOD all accepted rows × all columns) in a max-height ~280px scroll box with overflow-x and overflow-y. Large tables virtualize visible rows so the main thread stays responsive; scrolling still reaches every accepted row and column. No first-N truncation caption. At 390px, table scroll stays inside the card; page width stays ≤ viewport.
- Server routes under `api/analysis/*`, `api/datasets/*`, `api/share/*`, and `api/browse`. Drafting uses OpenRouter except the exact sample default win-likelihood task, which is cached. Only run may call Jev. **Same dataset + same Jev query always reuses a complete snapshot** (sample fixture and BYOD). Lookup key is `datasetId` (fixture id when that is the dataset) + canonical query + question kind + classes. A second run does not call Jev or mint another analysis. `forceNew: true` is the only escape hatch.
- UploadThing stores original CSV blobs; Convex stores dataset metadata, immutable row refs, run progress, and incremental predictions.
- Production fails closed without `CONVEX_URL` (or the Convex Vite alias `VITE_CONVEX_URL`) + `CONVEX_WRITE_SECRET`. BYOD upload/URL also fails closed without `UPLOADTHING_TOKEN` (or `UPLOADTHING_SECRET`). Use the UploadThing dashboard **API Keys → V7** token (base64 JSON `{ apiKey, appId, regions }`). A raw `sk_…` key is not enough to upload: v6 `uploadFiles` is retired (`Unsupported operation`). Missing app id/region returns `UPLOADTHING_FAILED` with `failure: "TOKEN_MISSING_APP_REGION"`. Convex dataset persist (`datasets.put`) omits undefined optional fields and client-only keys before `authorizedPutDataset`; Convex failures return `DATASET_INTAKE_UNAVAILABLE` with `failure: "CONVEX_PUT_FAILED"` and a secret-free reason — not `UNCAUGHT`. **Vercel Production builds must run `npx convex deploy`** (`node scripts/vercel-build.mjs` via `vercel.json` `buildCommand`) with `CONVEX_DEPLOY_KEY`. A frontend-only `npm run build` leaves Convex on stale functions and BYOD fails with Convex HTTP `Server Error`. Sample on-ramp does not need UploadThing.
- Historical Gamecast forecast/ESPN cron code still exists under `historical/api` and `src/server` forecast/ESPN modules. Those routes are not shipped as Vercel functions. Do not treat them as the active product surface.

## Boundaries

The browser must never import or call Jev, OpenRouter, ESPN, TypeSafe SDK internals, UploadThing server tokens, or privileged Convex writes. Secrets stay in server runtime env (`JEV_API_KEY`, `OPENROUTER_KEY`, `CONVEX_WRITE_SECRET`, `CONVEX_DEPLOY_KEY`, `UPLOADTHING_TOKEN`, `CRON_SECRET`). Tests and replay must not make paid provider calls. Visiting or sharing a page must never start a Jev run.

## How to continue

Implement against `PLAN.md` from the existing workbench. Remaining work is pause/cancel, browse/share completeness, abuse/cost controls, provider-contract confirmation, and Stage 6 operator provisioning. Do not restart from the old live-ESPN plan.
