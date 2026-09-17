# Jev Gamecast — Scope Plan

**Status:** Scoping; no application code yet
**Last updated:** 2026-09-17 01:13:40 UTC

## Product idea

A public, live gamecast that feeds one selected NFL game’s changing state to Jev and displays Jev’s forecast as an animated probability chart. The experience should feel like a live market chart, while clearly presenting itself as a model forecast rather than betting advice or an odds product.

The demo proves:

```text
live external state → typed Jev judgment → probability history → visible real-time animation
```

## Locked MVP scope

- American football/NFL only.
- One featured live game at a time.
- One shared Jev prediction stream per game.
- No visitor voting.
- No user-triggered arbitrary Jev calls.
- No MPP/payment integration for the first version.
- No fantasy-roster recommendations in the first version.
- No live trading, betting, wagering, or external side effects.
- No API key in browser code.
- Synthetic/replay mode must work when no live game is available.

## Forecast contract

Use one TypeSafe `Choice` judgment over the current game state:

> Who is most likely to win this game from the current state?

Options:

- home team;
- away team;
- tie.

Include the tie option so the distribution represents all possible final outcomes. The UI may emphasize the two team lines while still exposing the tie probability.

The state should be structured and include only information available at the forecast timestamp:

- game/event ID;
- teams and home/away designation;
- score;
- quarter and clock;
- possession;
- down and distance;
- field position;
- timeouts;
- recent play/event summary;
- game status and feed timestamp;
- optional pregame context, if sourced and frozen consistently.

Do not include future scores, final outcomes, or post-event fields in the request state.

## Feed and serving architecture

```text
ESPN public read-only feed
  ↓
server-side poller
  ↓
normalize and validate game state
  ↓
dedupe by game ID + event/play ID
  ↓
ignore unchanged or insignificant states
  ↓
one Jev request per accepted state
  ↓
append forecast result
  ↓
broadcast cached result to all browsers
```

Initial ESPN source: the public site scoreboard and game summary/play-by-play endpoints described by `pseudo-r/Public-ESPN-API`. This is an undocumented upstream, so treat it as replaceable:

- keep all ESPN access server-side;
- add timeout, retry, and backoff;
- cache the most recent valid state;
- detect stale or out-of-order events;
- provide replay fallback;
- do not assume the endpoint is stable or accepted from every deployment origin.

## Jev call budget

Only the server-side game worker may call Jev. Every accepted event must have a stable idempotency key such as `game_id + play_id + state_hash`.

Initial controls:

- one featured game;
- one forecast call per new meaningful play/state change;
- no repeated call for an unchanged state;
- bounded polling interval;
- daily/monthly spend ceiling;
- request and response logging without credentials or private data;
- a visible “replay mode” fallback when the live budget or feed is unavailable.

Meaningful update candidates:

- score change;
- turnover;
- possession change;
- fourth-down attempt or conversion;
- red-zone entry/exit;
- end of drive;
- quarter transition;
- substantial clock milestone;
- other material play-by-play state changes.

Start conservatively. Measure the event rate before increasing update frequency.

## Frontend experience

The primary view should show:

- selected game and live status;
- score, quarter, clock, possession, and last play;
- animated home/away forecast lines;
- tie probability;
- event markers on the chart;
- latest forecast and change from the prior point;
- Jev latency and feed age;
- “forecast flipped” callouts;
- explicit `LIVE`, `REPLAY`, and `STALE` states.

Example callout:

```text
FORECAST FLIP
Away 68% → 24%
After: red-zone interception
Jev latency: 182 ms
```

The UI must distinguish:

- live feed time;
- Jev request time;
- chart update time;
- replay time.

## Forecast disclosure

Until historical validation is complete, label the output:

> Jev’s live forecast distribution — experimental, not betting odds.

Do not claim calibrated win probability, predictive edge, or superiority to sportsbooks without a backtest. Preserve the raw Jev distribution and the exact input state for later evaluation.

Future validation should compare Jev against:

- a score/time baseline;
- a conventional historical win-probability model;
- market-implied probabilities where a lawful, reliable source is available.

## Social launch mechanics

The site itself remains passive: visitors watch the same forecast stream. Engagement comes from the live event and shareable moments.

Tweetable moments:

- forecast flips after major plays;
- highest-confidence forecast;
- biggest crowd-independent swing;
- Jev prediction versus the final result;
- replay of a famous game’s changing forecast.

Example launch copy:

> I connected Jev to a live football feed.
>
> After every meaningful play, it gets the current game state and updates its forecast in real time.
>
> No generated commentary. Just a typed prediction, probabilities, and a live chart.
>
> [demo]

## Delivery stages

### Stage 0 — Contract and feed probe

- Confirm Jev request/response shape with one harmless synthetic game state.
- Confirm Choice output fields and probability semantics.
- Probe ESPN scoreboard and summary/play-by-play access from the intended server environment.
- Record feed fields, event IDs, timestamps, and failure behavior.
- Estimate event frequency and Jev usage before building the live loop.

**Gate:** exact schemas and cost controls are known; no secrets committed.

### Stage 1 — Replay-first vertical slice

- Create a small sanitized historical/replay fixture.
- Build the normalized state and forecast-result schemas.
- Implement the animated chart against prerecorded Jev-shaped results or a tightly bounded test adapter.
- Make live/replay/stale status visible.

**Gate:** a visitor can open the page and see a complete animated game without a live feed or Jev call.

### Stage 2 — Live feed ingestion

- Add server-side ESPN polling.
- Normalize scoreboard and play-by-play updates.
- Deduplicate, reject stale/out-of-order events, and persist the latest valid state.
- Add retries and replay fallback.

**Gate:** feed failures do not crash the page or produce false forecast updates.

### Stage 3 — Jev forecast worker

- Add one server-side Jev call for each accepted meaningful state.
- Cache by idempotency key.
- Persist raw state, forecast, model, latency, and timestamps.
- Enforce hard request-rate and spend limits.

**Gate:** one event creates at most one Jev call and all browsers receive the same cached result.

### Stage 4 — Public demo and QA

- Deploy with server-side secrets.
- Test live, replay, stale-feed, Jev-error, timeout, and no-game states.
- Verify mobile layout and chart readability.
- Verify no credentials or private request state reach browser payloads.
- Capture a replayable forecast-flip clip.

**Gate:** a fresh browser can load the demo, see a forecast history, and understand its experimental status without explanation.

### Stage 5 — Launch

- Choose one live game or replay with clear forecast movement.
- Publish the demo link with a short screen recording.
- Tweet the system behavior, not unsupported accuracy claims.
- Save the exact launch run and forecast data for later review.

## Open questions

- Exact Jev API endpoint, authentication method, and current pricing.
- Whether Jev accepts the full structured game state size within the desired latency budget.
- Which ESPN endpoint combination is reliable from the production host.
- Whether play-by-play updates contain stable IDs and sufficient current-state fields.
- Hosting/runtime choice for the long-lived polling worker and client broadcast channel.
- Historical data source and licensing for replay mode.
- Whether the initial chart should show tie as a third series or as a secondary metric.

## Non-goals and risks

- This is not a betting product.
- This is not financial or gambling advice.
- The demo must not execute wagers or trades.
- ESPN’s undocumented API may change or block requests.
- Jev output probabilities may not be calibrated for sports forecasting.
- A fast, visually impressive line can create false confidence; disclosures must remain visible.
- Do not use private game data, user-uploaded personal information, or credentials in the public demo.

## Validated feed findings (2026-09-17 01:29:14 UTC)

Read-only tests confirm ESPN access is User-Agent dependent in the current environment:

- default `curl`: HTTP 200, JSON;
- `curl/8.5.0`: HTTP 200, JSON;
- `Python-urllib/3.13`: HTTP 200, JSON;
- `Mozilla/5.0`: HTTP 403, HTML;
- `Origin` header changes did not affect the result for the tested User-Agents.

The browser path also returned the scoreboard JSON, but browser success is not evidence that a production server runtime will succeed. Use a server-side request with an honest descriptive User-Agent such as `jev-gamecast/0.1 (+project URL)`; do not impersonate a search crawler or browser.

Validated endpoints and fields:

- site scoreboard: `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard`;
- dated scoreboard: same endpoint with `?dates=YYYYMMDD`;
- site summary: `/apis/site/v2/sports/football/nfl/summary?event=<event_id>`;
- core play-by-play: `https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/events/<event_id>/competitions/<event_id>/plays?limit=300`;
- stable identifiers: `event.id`, `event.uid`, `play.id`, and `play.sequenceNumber`;
- useful play fields: scores, period, clock, text, scoring flag, turnover flag, penalty flag, timestamps, and team.

Bounded repeat tests returned HTTP 200 without `Retry-After` or observed rate limiting. This is not an availability guarantee. The guessed site `/plays` endpoint returned HTTP 404; use the core play-by-play endpoint instead.

## Architecture decision update

Proceed with server-side ESPN polling behind a replaceable provider adapter. Do not wait for a webhook vendor for MVP. Poll scoreboard/summary for game state, poll core play-by-play for new event IDs, deduplicate by game plus play identifier/state hash, and trigger at most one Jev forecast per accepted meaningful update.

Keep Convex as the durable event store and browser sync layer. Use one small server worker for ESPN ingestion and Jev calls. Skip Redis until measured load requires distributed locks, high-volume rate limiting, or a separate ephemeral queue.

Provider acceptance still requires production-runtime testing, reconnect/catch-up handling, stale/out-of-order rejection, and public-display/derived-forecast rights review.

## Expanded scoping questions (2026-09-17 01:30:26 UTC)

### P0 — answer before implementation

#### Product and forecast meaning

- Is MVP a visual Jev systems demo or a sports-forecasting product? This determines how much historical accuracy validation and disclosure are required.
- Do we show `Jev forecast` or `win probability`? Use `Jev forecast` until calibration/backtesting supports the stronger label.
- Is one featured game enough, or must visitors choose among live games?
- What counts as a meaningful update: every play, scoring/turnover plays only, drive boundaries, or a fixed maximum cadence?
- Do we display tie as a third chart series, a small secondary value, or only in the raw result?
- Should pregame context be included, and can we guarantee it was available before kickoff without future leakage?

#### Jev contract

- Exact current API endpoint, authentication mechanism, model identifier, request limits, and pricing.
- Does Jev accept structured JSON state of the intended size within the required latency?
- Can one request contain multiple independent judgments, or should MVP make one `Choice` question per state?
- How should confidence and probabilities be displayed without implying calibrated betting odds?
- What timeout, retry, and stale-result behavior should apply when Jev is slow or unavailable?

#### Data and rights

- Is ESPN’s undocumented data permitted for public display and derived forecast visualization under its current terms?
- Which ESPN fields are present during a live game, not only in completed-game responses?
- Which source is authoritative when scoreboard, summary, and play-by-play disagree?
- How are corrections, duplicate plays, postponed games, and out-of-order events handled?
- Do we need a licensed provider or written permission before public launch?

#### Runtime and cost

- Can the intended Vercel/Convex deployment reach ESPN with a non-browser User-Agent?
- Where does the long-lived ingestion worker run, and how does it survive sleep/restarts?
- Are Convex scheduled functions sufficient, or do we need an external worker?
- What is the hard Jev budget per game and per day?
- What happens when the budget is exhausted: freeze, replay, fall back to baseline, or disable live mode?

### P1 — answer before public launch

#### Forecast quality

- What historical replay set will validate Jev?
- What simple baseline will it beat or at least match?
- Are Jev probabilities calibrated at game-state buckets such as score differential, quarter, and time remaining?
- How often does Jev flip, and are flips directionally useful or merely noisy?
- Can we compare Jev against ESPN’s own `winprobability` field without confusing provider output with ground truth?

#### Frontend and social presentation

- What is primary: chart, latest forecast card, last play, or forecast-flip animation?
- How much history should load initially on mobile?
- Do we show raw input state and model metadata for technical credibility?
- What shareable artifact matters most: static card, animated GIF, or replay URL?
- How do we make live, replay, stale, and unavailable states impossible to confuse?

#### Reliability and operations

- What reconnect/catch-up protocol restores a browser after disconnect?
- How do we prevent two workers from forecasting the same event?
- What monitoring detects stale ESPN data, Jev failures, forecast backlog, or runaway spend?
- How long do raw states and forecasts remain stored?
- What is the manual kill switch for live mode?

### P2 — defer until after first live demo

- Multi-game support.
- Fantasy roster/player recommendations.
- Crowd voting or interactive overrides.
- Market-odds comparison.
- Alternate sports.
- User-submitted games or custom questions.
- Redis, queues, or higher-scale fanout.
- Learned calibration layer or model ensemble.

### Recommended decision sequence

1. Confirm Jev API contract and cost.
2. Test ESPN access from intended production runtime.
3. Confirm public-display and derived-output rights.
4. Choose event cadence and per-game budget.
5. Build replay-first chart with immutable event/forecast schemas.
6. Add one live worker and one featured game.
7. Backtest before using `win probability` language.

## Delivery repository (2026-09-17 01:33:26 UTC)

Push completed work to the exact user-provided public repository:

`https://github.com/narulaskaran/jav-gamecast`

The local project directory remains `repos/jev-gamecast/`; the remote repository name is `jav-gamecast` and must not be silently normalized. GitHub read-only metadata confirms the repository is public and its default branch is `main`. No branch refs were advertised during the check, consistent with a newly initialized or empty repository.

The user authorizes direct pushes to `main` for this new repository. Delivery rules:

- keep secrets and Jev credentials out of Git;
- run local tests and security/PII checks before push;
- push directly to `main` when acceptance gates in this plan pass;
- verify remote branch, commit SHA, CI, and deployed demo URL after delivery;
- never force-push or rewrite `main` without explicit approval.

## Product decisions from scope review (2026-09-17 01:39:22 UTC)

### Product

- Primary goal: demonstrate Jev as a fast structured-decision system, not launch a betting or fantasy product.
- Positioning: `Jev forecasts this football game`.
- Site style: clean, minimal, crisp, chart-first.
- No visitor voting, interactive overrides, or arbitrary user-triggered Jev calls in MVP.
- Public display of the ESPN-derived visualization is approved by the user for this project; retain provider-rights review as a launch record, not as an implementation blocker unless new evidence conflicts.

### Forecast and cadence

- MVP uses one Jev `Choice` question over the live game state.
- Forecast request cadence: one request about every 90 seconds while the game is active.
- A 90-second poll may observe several new plays; coalesce them into the latest valid state and make one forecast request for that update.
- Do not claim per-play forecasting in MVP. Upgrade to per-play requests only after measuring ESPN rate limits, Jev cost, and end-to-end latency.
- Keep home team, away team, and tie in the forecast contract unless later validation shows a clearer presentation.
- Display `Jev forecast` language until historical calibration supports `win probability`.

The TypeSafe introduction documentation confirms that `Choice` returns a selected choice, probabilities, and confidence; multiple typed questions can run independently in parallel against one state. MVP needs only one `Choice` question, with future dimensions added only when they have a clear UI or evaluation purpose.

### Runtime and persistence

- Intended deployment: Vercel serverless functions plus Convex.
- Convex stores the normalized game state, immutable event identity, forecast time series, and feed-health status.
- All visitors read the same persisted forecast history through reactive Convex queries.
- No Redis in MVP.
- ESPN runtime access, serverless execution limits, and request headers require deployment-environment testing.
- Budget concern is secondary to ESPN availability/rate limiting for this first run; enforce both with hard ceilings anyway.

### Historical chart

- Historical forecast line must render for every visitor.
- MVP stores the time series; full backtesting and model-quality claims are deferred.
- Replay mode remains required so the chart works outside live games and when ESPN or Jev is unavailable.

### Frontend hierarchy

1. Live forecast chart centered on page.
2. Compact game card above chart showing teams, score, quarter/halftime/final status, and live/replay/stale state.
3. Small event markers and latest-play context.
4. Secondary metadata: Jev forecast, update age, latency, and feed age.
5. Error/fallback state must stay visible without displacing the chart.

## Stage 1 build-agent handoff (2026-09-17 01:43:16 UTC)

This section is self-contained for an agent starting with fresh context.

### Assignment

Build the replay-first frontend vertical slice in `repos/jev-gamecast/`, following this plan. This stage ends at a reviewed local application; do not implement live ingestion or external inference yet.

### Fixed implementation choices

- Stack: React + TypeScript + Vite.
- Package manager: npm.
- Styling: local CSS; no UI kit.
- Chart: SVG or a small dependency-free React chart component; avoid adding a chart library unless needed.
- Data: checked-in synthetic fixture only. No ESPN requests, Jev credentials, Convex deployment, MPP, betting, fantasy advice, voting, authentication, or user-generated inputs.
- Deployment shape: Vercel-compatible frontend, with provider interfaces kept separate from rendering.
- Remote delivery target: `https://github.com/narulaskaran/jav-gamecast`; direct push to `main` is authorized, but never force-push.

### Required result

Create a working app with:

1. small site header containing product name and restrained `Jev forecasts this football game` positioning;
2. compact game card above chart with away/home teams, score, quarter or halftime/final status;
3. live-looking historical forecast chart front and center, with home/away/tie series and readable legend;
4. event markers or labels tied to fixture timestamps;
5. replay controls that animate through stored fixture points without network access;
6. explicit `REPLAY`, `LIVE`, and `STALE` visual states, with this fixture initially in `REPLAY`;
7. responsive mobile layout and accessible labels/keyboard controls;
8. forecast metadata kept secondary: latest Jev choice, confidence/probabilities, update age, and replay disclosure.

Use clearly fictional/sanitized teams and fixture values. Do not present fixture values as real Jev output or calibrated sportsbook odds.

### Required interfaces for later stages

Keep these boundaries in separate modules so later work can replace fixtures without rewriting UI:

- `GameStateSource`: supplies normalized game state and feed status;
- `ForecastSource`: supplies immutable forecast points;
- forecast point schema: stable point ID, game ID, provider event ID, timestamp/elapsed time, home/away/tie probabilities, selected choice, confidence, and optional event label.

### Acceptance checks

From a clean checkout, agent must run and report:

- `npm install`;
- `npm run build`;
- `npm test` (tests must cover fixture parsing, chart/forecast rendering, replay progression, and state labels);
- a secret/PII scan over tracked files;
- manual browser check at desktop and narrow mobile widths.

Before push, inspect `git diff`, verify no credentials or personal data, then push to `main`. After push, verify remote branch and commit SHA. Report exact commands, outputs, commit SHA, and known limitations. Do not claim live ESPN, Jev, Convex, or production deployment support at this stage.
