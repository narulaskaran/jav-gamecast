import { describe, expect, it, vi } from 'vitest'
import { APIError, APITimeoutError } from '@typesafe-ai/sdk'
import {
  DeterministicMockForecastProvider,
  InMemoryForecastStore,
  ReplayForecastProvider,
  ForecastWorker,
  createIdempotencyKey,
  normalizeForecastState,
  type ForecastJob,
  type JevProvider,
} from './forecastWorker'
import type { ForecastRecord } from '../shared/forecastRecords'

const state = {
  id: 'game-1',
  eventId: 'event-1',
  playId: 'play-1',
  sequenceNumber: 1,
  homeTeam: 'Harbor Hawks',
  awayTeam: 'Cedar Foxes',
  homeScore: 17,
  awayScore: 14,
  quarter: 'Q2',
  clock: '04:12',
  status: 'quarter' as const,
  possession: 'home' as const,
  down: 2,
  distance: 7,
  fieldPosition: 'FOX 34',
  lastPlay: 'Pass complete to the Harbor Hawks 34 yard line',
  timestamp: '2026-09-17T03:40:00Z',
  feedTimestamp: '2026-09-17T03:40:00Z',
  sourceStatus: 'LIVE' as const,
}

const job: ForecastJob = {
  gameId: 'game-1',
  providerEventId: 'event-1',
  providerPlayId: 'play-1',
  sourceStatus: 'LIVE',
  state,
}

const successProvider = (calls: { keys: string[] }): JevProvider => ({
  forecast: async ({ idempotencyKey }) => {
    calls.keys.push(idempotencyKey)
    return {
      model: 'jev-latest',
      answer: {
        type: 'choice',
        choice: 'away',
        probabilities: { home: 0.3, away: 0.6, tie: 0.1 },
        confidence: 0.6,
      },
    }
  },
})

describe('forecast identity and persistence boundary', () => {
  it('normalizes object key order and includes game, provider identity, and state hash', () => {
    const first = createIdempotencyKey({ ...job, state })
    const second = createIdempotencyKey({ ...job, state: Object.fromEntries(Object.entries(state).reverse()) })
    const different = createIdempotencyKey({ ...job, state: { ...state, clock: '04:11' } })
    expect(first).toBe(second)
    expect(first).toMatch(/^6:game-1\|7:event-1\|6:play-1\|64:[a-f0-9]{64}$/)
    expect(different).not.toBe(first)
    expect(normalizeForecastState(state)).toEqual(state)
    expect(() => normalizeForecastState({ ...state, outcome: 'home' })).toThrow(/unsupported/i)

    const colonSeparated = createIdempotencyKey({ ...job, gameId: 'a', providerEventId: 'b:c', providerPlayId: 'd' })
    const ambiguousWithoutEncoding = createIdempotencyKey({ ...job, gameId: 'a:b', providerEventId: 'c', providerPlayId: 'd' })
    expect(colonSeparated).not.toBe(ambiguousWithoutEncoding)
  })

  it('makes exactly one provider call and returns an exact cached replay for duplicates', async () => {
    const calls = { keys: [] as string[] }
    const worker = new ForecastWorker({ provider: successProvider(calls), now: () => 1_000 })

    const first = await worker.forecast(job)
    const duplicate = await worker.forecast({ ...job, state: { ...state, clock: '04:12' } })

    expect(calls.keys).toHaveLength(1)
    expect(duplicate.cacheHit).toBe(true)
    expect(duplicate.record).toEqual(first.record)
    expect(JSON.stringify(duplicate.record)).toBe(JSON.stringify(first.record))
    expect(first.record).toEqual(expect.objectContaining({
      gameId: 'game-1',
      providerEventId: 'event-1',
      providerPlayId: 'play-1',
      model: 'jev-latest',
      rawNormalizedState: normalizeForecastState(state),
      choice: 'away',
      probabilities: { home: 0.3, away: 0.6, tie: 0.1 },
      confidence: 0.6,
      status: 'success',
      source: 'live',
      latencyMs: 0,
    }))
  })

  it('coalesces concurrent duplicate jobs before the first result is persisted', async () => {
    const calls = { keys: [] as string[] }
    let release: (() => void) | undefined
    let started!: () => void
    const provider: JevProvider = {
      forecast: async ({ idempotencyKey }) => {
        calls.keys.push(idempotencyKey)
        started()
        await new Promise<void>((resolve) => { release = resolve })
        return {
          model: 'jev-latest',
          answer: { type: 'choice', choice: 'home', probabilities: { home: 0.6, away: 0.3, tie: 0.1 }, confidence: 0.6 },
        }
      },
    }
    const worker = new ForecastWorker({ provider, now: () => 1_000 })
    const providerStarted = new Promise<void>((resolve) => { started = resolve })
    const firstPromise = worker.forecast(job)
    const duplicatePromise = worker.forecast(job)
    await providerStarted
    release?.()
    const [first, duplicate] = await Promise.all([firstPromise, duplicatePromise])

    expect(calls.keys).toHaveLength(1)
    expect(first.record).toEqual(duplicate.record)
    expect(duplicate.cacheHit).toBe(true)
  })

  it('atomically claims a key across distinct workers sharing persistence', async () => {
    const calls = { keys: [] as string[] }
    let release: (() => void) | undefined
    let started!: () => void
    const provider: JevProvider = {
      forecast: async ({ idempotencyKey }) => {
        calls.keys.push(idempotencyKey)
        started()
        await new Promise<void>((resolve) => { release = resolve })
        return {
          model: 'jev-latest',
          answer: { type: 'choice', choice: 'home', probabilities: { home: 0.6, away: 0.3, tie: 0.1 }, confidence: 0.6 },
        }
      },
    }
    const store = new InMemoryForecastStore()
    const workerA = new ForecastWorker({ provider, store, now: () => 1_000 })
    const workerB = new ForecastWorker({ provider, store, now: () => 1_000 })
    const providerStarted = new Promise<void>((resolve) => { started = resolve })
    const firstPromise = workerA.forecast(job)
    await providerStarted
    await expect(workerB.forecast(job)).rejects.toThrow(/already claimed/i)
    expect(calls.keys).toHaveLength(1)
    release?.()
    const first = await firstPromise

    expect(first.record.status).toBe('success')
  })

  it('enforces a rolling request window across distinct workers and keys', async () => {
    const calls = { keys: [] as string[] }
    let now = 0
    const store = new InMemoryForecastStore()
    const limits = { cadenceMs: 0, rateWindowMs: 10_000, maxRequestsPerWindow: 1, maxRequests: 100, maxSpendCents: 100, estimatedCostCentsPerRequest: 1 }
    const workerA = new ForecastWorker({ provider: successProvider(calls), store, now: () => now, limits })
    const workerB = new ForecastWorker({ provider: successProvider(calls), store, now: () => now, limits })

    await workerA.forecast(job)
    now = 1_000
    const limited = await workerB.forecast({ ...job, providerPlayId: 'play-2', state: { ...state, playId: 'play-2' } })

    expect(limited.record.status).toBe('limited')
    expect(limited.record.error?.code).toBe('RATE_LIMIT')
    expect(calls.keys).toHaveLength(1)
  })

  it('keeps a lifetime request and spend budget across fresh workers after the window expires', async () => {
    const calls = { keys: [] as string[] }
    let now = 0
    const store = new InMemoryForecastStore()
    const limits = { cadenceMs: 0, rateWindowMs: 1_000, maxRequestsPerWindow: 10, maxRequests: 1, maxSpendCents: 1, estimatedCostCentsPerRequest: 1 }
    const workerA = new ForecastWorker({ provider: successProvider(calls), store, now: () => now, limits })

    await workerA.forecast(job)
    now = 2_000
    const workerB = new ForecastWorker({
      provider: successProvider(calls),
      store,
      now: () => now,
      limits: { cadenceMs: 0, rateWindowMs: 1_000, maxRequestsPerWindow: 10, maxRequests: 100, maxSpendCents: 100, estimatedCostCentsPerRequest: 1 },
    })
    const limited = await workerB.forecast({ ...job, providerPlayId: 'play-2', state: { ...state, playId: 'play-2' } })

    expect(limited.record.status).toBe('limited')
    expect(limited.record.error?.code).toBe('REQUEST_LIMIT')
    expect(calls.keys).toHaveLength(1)
  })

  it('fails closed when a claim is old and another worker still owns the in-flight request', async () => {
    const calls = { keys: [] as string[] }
    let release: (() => void) | undefined
    let started!: () => void
    const provider: JevProvider = {
      forecast: async ({ idempotencyKey }) => {
        calls.keys.push(idempotencyKey)
        started()
        await new Promise<void>((resolve) => { release = resolve })
        return {
          model: 'jev-latest',
          answer: { type: 'choice', choice: 'home', probabilities: { home: 0.6, away: 0.3, tie: 0.1 }, confidence: 0.6 },
        }
      },
    }
    let clockA = 0
    let clockB = 10_000_000
    const store = new InMemoryForecastStore()
    const workerA = new ForecastWorker({ provider, store, now: () => clockA, limits: { claimLeaseMs: 1_000, cadenceMs: 0 } })
    const workerB = new ForecastWorker({ provider, store, now: () => clockB, limits: { claimLeaseMs: 1_000, cadenceMs: 0 } })
    const providerStarted = new Promise<void>((resolve) => { started = resolve })
    const firstPromise = workerA.forecast(job)
    await providerStarted
    clockA = 20_000_000

    await expect(workerB.forecast(job)).rejects.toThrow(/already claimed/i)
    expect(calls.keys).toHaveLength(1)
    release?.()
    await firstPromise
  })

  it('keeps ownership when record persistence fails after a provider call', async () => {
    const calls: string[] = []
    class FailingStore extends InMemoryForecastStore {
      private failures = 2

      override putIfAbsent(record: ForecastRecord): ForecastRecord {
        if (this.failures > 0) {
          this.failures -= 1
          throw new Error('persistence unavailable')
        }
        return super.putIfAbsent(record)
      }
    }
    const store = new FailingStore()
    const provider = successProvider({ keys: calls })
    const workerA = new ForecastWorker({ provider, store, now: () => 1_000, limits: { cadenceMs: 0 } })
    const workerB = new ForecastWorker({ provider, store, now: () => 1_000, limits: { cadenceMs: 0 } })

    await expect(workerA.forecast(job)).rejects.toThrow(/persistence unavailable/i)
    await expect(workerB.forecast(job)).rejects.toThrow(/already claimed/i)
    expect(calls).toHaveLength(1)
  })
})

describe('cadence and finite live limits', () => {
  it('blocks a second live request inside the 90-second cadence', async () => {
    const calls = { keys: [] as string[] }
    let now = 100_000
    const worker = new ForecastWorker({
      provider: successProvider(calls),
      now: () => now,
      limits: { cadenceMs: 90_000, maxRequestsPerWindow: 5, rateWindowMs: 300_000 },
    })

    const first = await worker.forecast(job)
    now += 89_999
    const limited = await worker.forecast({ ...job, providerPlayId: 'play-2', state: { ...state, playId: 'play-2' } })

    expect(first.record.status).toBe('success')
    expect(limited.record.status).toBe('limited')
    expect(limited.record.error?.code).toBe('CADENCE_LIMIT')
    expect(calls.keys).toHaveLength(1)
  })

  it('enforces request, rolling-rate, and spend ceilings', async () => {
    const calls = { keys: [] as string[] }
    let now = 0
    const worker = new ForecastWorker({
      provider: successProvider(calls),
      now: () => now,
      limits: {
        cadenceMs: 0,
        rateWindowMs: 10_000,
        maxRequestsPerWindow: 1,
        maxRequests: 2,
        maxSpendCents: 1,
        estimatedCostCentsPerRequest: 1,
      },
    })

    await expect(worker.forecast(job)).resolves.toMatchObject({ record: { status: 'success' } })
    now = 10_001
    const spendLimited = await worker.forecast({ ...job, providerPlayId: 'play-2', state: { ...state, playId: 'play-2' } })
    expect(spendLimited.record.status).toBe('limited')
    expect(spendLimited.record.error?.code).toBe('SPEND_LIMIT')
    expect(calls.keys).toHaveLength(1)
  })
})

describe('provider errors and explicit deterministic fallback modes', () => {
  it('does not invoke any provider for a STALE snapshot and records explicit stale state', async () => {
    const calls: string[] = []
    const worker = new ForecastWorker({ provider: successProvider({ keys: calls }), now: () => 0 })
    const result = await worker.forecast({ ...job, sourceStatus: 'STALE' })

    expect(calls).toHaveLength(0)
    expect(result.record).toEqual(expect.objectContaining({ status: 'error', source: 'stale', error: { code: 'STALE_SOURCE', retryable: true } }))
  })

  it('records timeout and provider status without persisting provider error text or secrets', async () => {
    const timeoutWorker = new ForecastWorker({
      provider: { forecast: async () => { throw new APITimeoutError(2_000) } },
      now: () => 0,
    })
    const timeout = await timeoutWorker.forecast(job)
    expect(timeout.record).toEqual(expect.objectContaining({ status: 'error', source: 'live' }))
    expect(timeout.record.error).toEqual(expect.objectContaining({ code: 'TIMEOUT', retryable: true }))
    expect(JSON.stringify(timeout.record)).not.toContain('JEV_API_KEY')

    const providerWorker = new ForecastWorker({
      provider: { forecast: async () => { throw APIError.fromResponse(529, { secret: 'do-not-store' }, new Headers()) } },
      now: () => 0,
    })
    const providerError = await providerWorker.forecast(job)
    expect(providerError.record.error).toEqual(expect.objectContaining({ code: 'PROVIDER_529', providerStatus: 529, retryable: true }))
    expect(JSON.stringify(providerError.record)).not.toContain('do-not-store')

    const rateWorker = new ForecastWorker({
      provider: { forecast: async () => { throw APIError.fromResponse(429, { secret: 'do-not-store' }, new Headers()) } },
      now: () => 0,
    })
    const rateError = await rateWorker.forecast(job)
    expect(rateError.record.error).toEqual(expect.objectContaining({ code: 'PROVIDER_429', providerStatus: 429, retryable: true }))
  })

  it('uses mock and replay only when explicitly selected, never as an implicit live fallback', async () => {
    const mock = new ForecastWorker({ mode: 'mock', now: () => 0 })
    const mockResult = await mock.forecast(job)
    expect(mockResult.record).toEqual(expect.objectContaining({ source: 'mock', status: 'success', model: 'jev-latest' }))

    const replayProvider = new ReplayForecastProvider([mockResult.record])
    const replay = new ForecastWorker({ mode: 'replay', replayProvider, now: () => 0 })
    const replayResult = await replay.forecast(job)
    expect(replayResult.record).toEqual(expect.objectContaining({
      idempotencyKey: mockResult.record.idempotencyKey,
      rawNormalizedState: mockResult.record.rawNormalizedState,
      choice: mockResult.record.choice,
      probabilities: mockResult.record.probabilities,
      confidence: mockResult.record.confidence,
      source: 'replay',
    }))

    vi.stubEnv('JEV_API_KEY', '')
    try {
      const liveWithoutCredentials = new ForecastWorker({ now: () => 0 })
      const liveResult = await liveWithoutCredentials.forecast(job)
      expect(liveResult.record.status).toBe('error')
      expect(liveResult.record.error?.code).toBe('CONFIGURATION')
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('keeps deterministic mock answers stable for the same normalized state', async () => {
    const provider = new DeterministicMockForecastProvider()
    const first = await provider.forecast({ state: normalizeForecastState(state) })
    const second = await provider.forecast({ state: normalizeForecastState({ ...state }) })
    expect(second.answer).toEqual(first.answer)
  })
})
