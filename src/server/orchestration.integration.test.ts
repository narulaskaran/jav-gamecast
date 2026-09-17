import { describe, expect, it } from 'vitest'
import { createBrowserForecastReadPath, forecastRecordsToPoints } from '../browser/forecastRead'
import { InMemoryForecastStore } from '../persistence/forecastStore'
import { ForecastWorker, type JevProvider } from './forecastWorker'
import { createForecastCycleHandler, runForecastCycle, SCHEDULER_RESPONSIBILITY, type ForecastCycleSource } from './orchestrator'
import { EspnGameStateSource, ESPN_ENDPOINTS, type EspnFetch } from './espn'
import type { GameStateSnapshot } from '../types'

const snapshot: GameStateSnapshot = {
  status: 'LIVE',
  state: {
    id: 'game-1',
    eventId: 'event-1',
    playId: 'play-1',
    sequenceNumber: 22,
    homeTeam: 'Harbor Hawks',
    awayTeam: 'Cedar Foxes',
    homeScore: 21,
    awayScore: 17,
    quarter: 'Q3',
    clock: '04:12',
    status: 'quarter',
    possession: 'away',
    down: 2,
    distance: 7,
    fieldPosition: 'FOX 34',
    lastPlay: 'Pass complete to the Harbor Hawks 34 yard line',
    timestamp: '2026-09-17T03:40:00Z',
    feedTimestamp: '2026-09-17T03:40:00Z',
    sourceStatus: 'LIVE',
  },
}

const source: ForecastCycleSource = {
  poll: async () => snapshot,
  getCachedSnapshot: () => snapshot,
}

const provider = (calls: string[]): JevProvider => ({
  forecast: async ({ idempotencyKey }) => {
    calls.push(idempotencyKey)
    return {
      model: 'jev-latest',
      answer: {
        type: 'choice',
        choice: 'home',
        probabilities: { home: 0.62, away: 0.28, tie: 0.1 },
        confidence: 0.62,
      },
    }
  },
})

const espnScoreboard = {
  events: [{
    id: '401999001',
    date: '2026-09-17T03:00:00Z',
    competitions: [{
      competitors: [
        { id: '10', homeAway: 'home', score: '21', team: { displayName: 'Harbor Hawks' } },
        { id: '20', homeAway: 'away', score: '17', team: { displayName: 'Cedar Foxes' } },
      ],
      situation: { possession: '20', down: 2, distance: 7, possessionText: 'FOX 34' },
      status: { type: { state: 'in' }, period: 3, displayClock: '04:12' },
    }],
    status: { type: { state: 'in' } },
  }],
}

const espnSummary = {
  header: {
    competitions: [{
      competitors: [
        { id: '10', homeAway: 'home', score: '21', team: { displayName: 'Harbor Hawks' } },
        { id: '20', homeAway: 'away', score: '17', team: { displayName: 'Cedar Foxes' } },
      ],
      situation: { possession: '20', down: 2, distance: 7, possessionText: 'FOX 34' },
      status: { type: { state: 'in' }, period: 3, displayClock: '04:12' },
    }],
  },
  plays: [],
}

const espnPlays = {
  items: [{
    id: '9002',
    sequenceNumber: 22,
    text: 'Pass complete to the Harbor Hawks 34 yard line',
    date: '2026-09-17T03:40:00Z',
  }],
}

const jsonResponse = (body: unknown): Response => new Response(JSON.stringify(body), { status: 200 })

describe('bounded ESPN → forecast → persistence → browser read orchestration', () => {
  it('runs mocked ESPN normalization through ForecastWorker into the shared read boundary', async () => {
    const responses = new Map<string, Response>([
      [ESPN_ENDPOINTS.scoreboard, jsonResponse(espnScoreboard)],
      [ESPN_ENDPOINTS.summary('401999001'), jsonResponse(espnSummary)],
      [ESPN_ENDPOINTS.plays('401999001'), jsonResponse(espnPlays)],
    ])
    const fetch: EspnFetch = async (url) => responses.get(url) ?? new Response('{}', { status: 404 })
    const espn = new EspnGameStateSource({
      fetch,
      now: () => Date.parse('2026-09-17T03:41:00Z'),
      sleep: async () => undefined,
      backoffMs: 0,
    })
    const store = new InMemoryForecastStore()
    const result = await runForecastCycle({ source: espn, worker: new ForecastWorker({ mode: 'mock', store, now: () => 1_000 }) })
    const reader = createBrowserForecastReadPath(store)

    expect(result.snapshot.status).toBe('LIVE')
    expect(result.snapshot.state.playId).toBe('9002')
    expect(result.forecast.record.rawNormalizedState).toEqual(expect.objectContaining({
      homeTeam: 'Harbor Hawks',
      awayTeam: 'Cedar Foxes',
      homeScore: 21,
      awayScore: 17,
    }))
    await expect(reader.getCachedForecast(result.forecast.record.idempotencyKey)).resolves.toBe(result.forecast.record)
  })

  it('uses the in-memory deterministic provider for no-config replay', async () => {
    const result = await runForecastCycle({ mode: 'replay', store: new InMemoryForecastStore(), now: () => 1_000 })
    expect(result.snapshot.status).toBe('REPLAY')
    expect(result.forecast.record).toEqual(expect.objectContaining({ source: 'replay', status: 'success' }))
  })

  it('does not invoke a live provider or label a replay fallback as live', async () => {
    const calls: string[] = []
    const failingFetch: EspnFetch = async () => new Response('{}', { status: 503 })
    const store = new InMemoryForecastStore()

    const result = await runForecastCycle({
      espn: { fetch: failingFetch, maxRetries: 0, backoffMs: 0, sleep: async () => undefined },
      store,
      provider: provider(calls),
      now: () => 1_000,
    })

    expect(result.snapshot.status).toBe('REPLAY')
    expect(calls).toHaveLength(0)
    expect(result.forecast.record).toEqual(expect.objectContaining({ source: 'replay', status: 'success', rawNormalizedState: expect.objectContaining({ sourceStatus: 'REPLAY' }) }))
    expect(result.forecast.record.source).not.toBe('live')
  })

  it('exposes one bounded handler invocation and leaves cadence to the scheduler', async () => {
    let polls = 0
    const store = new InMemoryForecastStore()
    const handler = createForecastCycleHandler({
      mode: 'mock',
      source: {
        poll: async () => { polls += 1; return snapshot },
        getCachedSnapshot: () => snapshot,
      },
      store,
      now: () => 1_000,
    })

    await handler()
    expect(polls).toBe(1)
    expect(SCHEDULER_RESPONSIBILITY).toMatch(/scheduler/i)
  })

  it('normalizes one accepted state into one shared cached record for all readers', async () => {
    const calls: string[] = []
    const store = new InMemoryForecastStore()
    const worker = new ForecastWorker({ provider: provider(calls), store, now: () => 1_000 })

    const result = await runForecastCycle({ source, worker })
    const browser = createBrowserForecastReadPath(store)
    const cached = await browser.getCachedForecast(result.forecast.record.idempotencyKey)
    const replay = await browser.getReplayForecasts('game-1')

    expect(calls).toHaveLength(1)
    expect(store.size()).toBe(1)
    expect(cached).toBe(result.forecast.record)
    expect(replay).toEqual([result.forecast.record])
    expect(forecastRecordsToPoints(replay)).toEqual([
      expect.objectContaining({
        id: result.forecast.record.idempotencyKey,
        gameId: 'game-1',
        eventId: 'event-1',
        choice: 'home',
        homeProbability: 62,
        awayProbability: 28,
        tieProbability: 10,
      }),
    ])
  })

  it('coalesces concurrent orchestration reads and persists one canonical record', async () => {
    const calls: string[] = []
    const store = new InMemoryForecastStore()
    const worker = new ForecastWorker({ provider: provider(calls), store, now: () => 1_000 })

    const results: Awaited<ReturnType<typeof runForecastCycle>>[] = await Promise.all([
      runForecastCycle({ source, worker }),
      runForecastCycle({ source, worker }),
      runForecastCycle({ source, worker }),
    ])

    expect(calls).toHaveLength(1)
    expect(store.size()).toBe(1)
    expect(new Set(results.map((result) => result.forecast.record)).size).toBe(1)
    expect(results.slice(1).every((result) => result.forecast.cacheHit)).toBe(true)
  })

  it('enforces the durable budget across fresh orchestrator workers and different keys', async () => {
    const calls: string[] = []
    let now = 0
    let pollCount = 0
    const store = new InMemoryForecastStore()
    const limits = { cadenceMs: 0, rateWindowMs: 1_000, maxRequestsPerWindow: 10, maxRequests: 1, maxSpendCents: 1, estimatedCostCentsPerRequest: 1 }
    const cycleSource: ForecastCycleSource = {
      poll: async () => {
        pollCount += 1
        return pollCount === 1 ? snapshot : { ...snapshot, state: { ...snapshot.state, playId: 'play-2', sequenceNumber: 23 } }
      },
      getCachedSnapshot: () => snapshot,
    }
    const first = await runForecastCycle({ source: cycleSource, store, provider: provider(calls), now: () => now, limits })
    now = 2_000
    const second = await runForecastCycle({
      source: cycleSource,
      store,
      provider: provider(calls),
      now: () => now,
      limits: { cadenceMs: 0, rateWindowMs: 1_000, maxRequestsPerWindow: 10, maxRequests: 100, maxSpendCents: 100, estimatedCostCentsPerRequest: 1 },
    })

    expect(first.forecast.record.status).toBe('success')
    expect(second.forecast.record.status).toBe('limited')
    expect(second.forecast.record.error?.code).toBe('REQUEST_LIMIT')
    expect(calls).toHaveLength(1)
  })

  it('keeps stale feed status visible while returning persisted error and limited fallback records', async () => {
    const staleSource: ForecastCycleSource = {
      poll: async () => ({ ...snapshot, status: 'STALE', state: { ...snapshot.state, sourceStatus: 'STALE' } }),
      getCachedSnapshot: () => snapshot,
    }
    const errorStore = new InMemoryForecastStore()
    const errorWorker = new ForecastWorker({
      store: errorStore,
      provider: { forecast: async () => { throw new Error('provider unavailable') } },
      now: () => 1_000,
    })
    const errorResult = await runForecastCycle({ source: staleSource, worker: errorWorker })
    expect(errorResult.snapshot.status).toBe('STALE')
    expect(errorResult.forecast.record.status).toBe('error')
    expect(await createBrowserForecastReadPath(errorStore).getCachedForecast(errorResult.forecast.record.idempotencyKey)).toEqual(errorResult.forecast.record)

    const limitedStore = new InMemoryForecastStore()
    const limitedWorker = new ForecastWorker({
      store: limitedStore,
      provider: provider([]),
      now: () => 1_000,
      limits: { cadenceMs: 0, maxRequests: 1, maxRequestsPerWindow: 1, rateWindowMs: 100_000 },
    })
    await runForecastCycle({ source, worker: limitedWorker })
    const limited = await runForecastCycle({ source: { ...source, poll: async () => ({ ...snapshot, state: { ...snapshot.state, playId: 'play-2', sequenceNumber: 23 } }) }, worker: limitedWorker })
    expect(limited.forecast.record.status).toBe('limited')
    expect(await createBrowserForecastReadPath(limitedStore).getCachedForecast(limited.forecast.record.idempotencyKey)).toEqual(limited.forecast.record)
  })
})
