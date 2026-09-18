# Jev Data Analysis

This repository is the **Jev playground** (Jev Data Analysis). It was originally Jev Gamecast. Live ESPN gamecast is historical implementation material only.

## Read first

- `PLAN.md` — product pivot, MVP scope, contracts, stages, and remaining gates
- `docs/analysis-api.md` — analysis + BYOD dataset API contract
- `README.md` — install, test, Convex/Vercel operator notes (still contains leftover Gamecast live-runbook copy)

## Product

Bring a dataset. Ask a question. See Jev classify every row.

Audience: engineers playing with Jev. This is a technical demo / playground, not production analytics or a sports product.

## Current slice

- Landing: two equal cards — Try sample (Seahawks fixture stays) and Bring your own (CSV upload + public HTTPS CSV URL). Same draft → edit query → run flow and live per-row class chart for every source. Football is the sample, not the product.
- Live class-distribution chart is the run-view hero: it ticks on every persisted row (sample and BYOD share the same shell), is scrubbable, and is paired with a `Row X of Y` rail rather than a CSV inspector.
- Server routes under `api/analysis/*`, `api/datasets/*`, `api/share/*`, and `api/browse`. Drafting uses OpenRouter; only run may call Jev.
- UploadThing stores original CSV blobs; Convex stores dataset metadata, immutable row refs, run progress, and incremental predictions.
- Production fails closed without `CONVEX_URL` (or the Convex Vite alias `VITE_CONVEX_URL`) + `CONVEX_WRITE_SECRET`. BYOD upload/URL also fails closed without `UPLOADTHING_TOKEN` (or `UPLOADTHING_SECRET`). Sample on-ramp does not need UploadThing.
- Historical Gamecast forecast/ESPN cron code still exists under `historical/api` and `src/server` forecast/ESPN modules. Those routes are not shipped as Vercel functions. Do not treat them as the active product surface.

## Boundaries

The browser must never import or call Jev, OpenRouter, ESPN, TypeSafe SDK internals, UploadThing server tokens, or privileged Convex writes. Secrets stay in server runtime env (`JEV_API_KEY`, `OPENROUTER_KEY`, `CONVEX_WRITE_SECRET`, `UPLOADTHING_TOKEN`, `CRON_SECRET`). Tests and replay must not make paid provider calls. Visiting or sharing a page must never start a Jev run.

## How to continue

Implement against `PLAN.md` from the existing workbench. Remaining work is pause/cancel, browse/share completeness, abuse/cost controls, provider-contract confirmation, and Stage 6 operator provisioning. Do not restart from the old live-ESPN plan.
