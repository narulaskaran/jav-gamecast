# Jev Data Analysis

This repository is the **Jev Data Analysis** workbench. It was originally Jev Gamecast. Live ESPN gamecast is historical implementation material only.

## Read first

- `PLAN.md` — product pivot, MVP scope, contracts, stages, and remaining gates
- `docs/analysis-api.md` — current fixture-first analysis API
- `README.md` — install, test, Convex/Vercel operator notes (still contains leftover Gamecast live-runbook copy)

## Product

Bring a dataset. Ask a question. See Jev classify every row.

The first vertical slice uses one checked-in, sanitized football time-series fixture. Football is a sample domain, not a live sports product. CSV upload and public CSV URLs are Stage 5, not a prerequisite for continuing the fixture demo.

## Current slice

- Browser workbench: fixture preview, natural-language task, editable Jev query, explicit run confirmation, progress, results, share/replay.
- Server routes under `api/analysis/*` and `api/share/*`. Drafting uses OpenRouter; only run may call Jev.
- Durable snapshots in Convex (`convex/analyses.ts`). Production fails closed without `CONVEX_URL` and `CONVEX_WRITE_SECRET`.
- Historical Gamecast forecast/ESPN cron code still exists. Do not treat it as the active product surface.

## Boundaries

The browser must never import or call Jev, OpenRouter, ESPN, TypeSafe SDK internals, or privileged Convex writes. Secrets stay in server runtime env (`JEV_API_KEY`, `OPENROUTER_KEY`, `CONVEX_WRITE_SECRET`, `CRON_SECRET`). Tests and replay must not make paid provider calls. Visiting or sharing a page must never start a Jev run.

## How to continue

Implement against `PLAN.md` from the existing workbench. Next useful work is hardening (pause/cancel, browse/share completeness, abuse/cost controls, provider-contract confirmation), then Stage 5 BYOD intake. Do not restart from the old live-ESPN plan.
