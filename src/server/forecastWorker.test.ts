import { describe, expect, it } from 'vitest'
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

const state = {
  game_id: 'game-1',
  event_id: 'event-1',
  play_id: 'play-1',
  score: { home: 17, away: 14 },
  clock: '04:12',
}

const job: ForecastJob = {
  gameId: 'game-1',
  providerEventId: 'event-1',
  providerPlayId: 'play-1',
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
    const first = createIdempotencyKey({
      gameId: 'game-1', providerEventId: 'event-1', providerPlayId: 'play-1',
      state: { b: 2, a: 1 },
    })
    const second = createIdempotencyKey({
      gameId: 'game-1', providerEventId: 'event-1', providerPlayId: 'play-1',
      state: { a: 1, b: 2 },
    })
    const different = createIdempotencyKey({ ...job, state: { ...state, clock: '04:11' } })
    expect(first).toBe(second)
    expect(first).toMatch(/^game-1:event-1:play-1:[a-f0-9]{64}$/)
    expect(different).not.toBe(first)
    expect(normalizeForecastState({ undefinedValue: undefined, nested: { z: 1, a: 2 } })).toEqual({ nested: { a: 2, z: 1 } })
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
    const provider: JevProvider = {
      forecast: async ({ idempotencyKey }) => {
        calls.keys.push(idempotencyKey)
        await new Promise<void>((resolve) => { release = resolve })
        return {
          model: 'jev-latest',
          answer: { type: 'choice', choice: 'home', probabilities: { home: 0.6, away: 0.3, tie: 0.1 }, confidence: 0.6 },
        }
      },
    }
    const worker = new ForecastWorker({ provider, now: () => 1_000 })
    const firstPromise = worker.forecast(job)
    const duplicatePromise = worker.forecast(job)
    await Promise.resolve()
    release?.()
    const [first, duplicate] = await Promise.all([firstPromise, duplicatePromise])

    expect(calls.keys).toHaveLength(1)
    expect(first.record).toEqual(duplicate.record)
    expect(duplicate.cacheHit).toBe(true)
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
    const limited = await worker.forecast({ ...job, providerPlayId: 'play-2', state: { ...state, play_id: 'play-2' } })

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
    const spendLimited = await worker.forecast({ ...job, providerPlayId: 'play-2', state: { ...state, play_id: 'play-2' } })
    expect(spendLimited.record.status).toBe('limited')
    expect(spendLimited.record.error?.code).toBe('SPEND_LIMIT')
    expect(calls.keys).toHaveLength(1)
  })
})

describe('provider errors and explicit deterministic fallback modes', () => {
  it('records timeout and provider status without persisting provider error text or secrets', async () => {
    const timeoutWorker = new ForecastWorker({
      provider: { forecast: async () => { throw new APITimeoutError(2_000) } },
      now: () => 0,
    })
    const timeout = await timeoutWorker.forecast(job)
    expect(timeout.record).toEqual(expect.objectContaining({ status: 'error', source: 'live' }))
    expect(timeout.record.error).toEqual(expect.objectContaining({ code: 'TIMEOUT', retryable: true }))
    expect(JSON.stringify(timeout.record)).not.toContain('TYPESAFE_API_KEY')

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

    const savedKey = process.env.TYPESAFE_API_KEY
    delete process.env.TYPESAFE_API_KEY
    try {
      const liveWithoutCredentials = new ForecastWorker({ now: () => 0 })
      const liveResult = await liveWithoutCredentials.forecast(job)
      expect(liveResult.record.status).toBe('error')
      expect(liveResult.record.error?.code).toBe('CONFIGURATION')
    } finally {
      if (savedKey === undefined) delete process.env.TYPESAFE_API_KEY
      else process.env.TYPESAFE_API_KEY = savedKey
    }
  })

  it('keeps deterministic mock answers stable for the same normalized state', async () => {
    const provider = new DeterministicMockForecastProvider()
    const first = await provider.forecast({ state: normalizeForecastState(state) })
    const second = await provider.forecast({ state: normalizeForecastState({ ...state, unused: undefined }) })
    expect(second.answer).toEqual(first.answer)
  })
})
