import { beforeEach, describe, expect, it, vi } from 'vitest'

const testState = vi.hoisted(() => ({ record: undefined as Record<string, unknown> | undefined, records: [] as Record<string, unknown>[] }))

vi.mock('../src/server/liveConfig', () => ({
  readPublicRuntimeConfig: () => ({ convexUrl: 'https://demo.convex.cloud', featuredGameId: 'featured' }),
}))
vi.mock('../src/server/convexStore', () => ({
  ConvexForecastStore: class {
    async getForecastByIdempotencyKey() { return testState.record }
    async listForecastsByGame() { return testState.records }
  },
}))

import handler from './gamecast'

type ResponseState = { code?: number; body?: unknown; headers: Record<string, string> }
const response = (state: ResponseState) => ({
  status(code: number) { state.code = code; return this },
  json(body: unknown) { state.body = body; return this },
  setHeader(name: string, value: string) { state.headers[name] = value; return this },
  end() {},
})
const record = (overrides: Partial<Record<string, unknown>> = {}) => ({
  idempotencyKey: 'key', gameId: 'featured', providerEventId: 'event', stateHash: 'hash', rawNormalizedState: { sourceStatus: 'LIVE' },
  model: 'jev-latest', status: 'success', source: 'live', requestedAt: '2026-09-17T03:00:00Z', completedAt: '2026-09-17T03:00:01Z', latencyMs: 1,
  choice: 'home', probabilities: { home: 0.6, away: 0.3, tie: 0.1 }, confidence: 0.6, ...overrides,
})

beforeEach(() => { testState.record = undefined; testState.records = [] })

describe('public Gamecast route gating', () => {
  it('returns not-found for an idempotency key belonging to another game', async () => {
    testState.record = record({ gameId: 'other' })
    const state: ResponseState = { headers: {} }
    await handler({ method: 'GET', headers: {}, query: { idempotencyKey: 'key' } }, response(state))
    expect(state.code).toBe(404)
    expect(state.body).toEqual({ error: 'FORECAST_NOT_FOUND' })
  })

  it.each([
    ['live', 'LIVE', record()],
    ['replay', 'REPLAY', record({ source: 'replay', rawNormalizedState: { sourceStatus: 'REPLAY' } })],
    ['stale', 'STALE', record({ status: 'error', source: 'stale', rawNormalizedState: { sourceStatus: 'STALE' }, choice: undefined, probabilities: undefined, confidence: undefined })],
    ['error', 'ERROR', record({ status: 'error', rawNormalizedState: { sourceStatus: 'LIVE' }, choice: undefined, probabilities: undefined, confidence: undefined })],
    ['limited', 'LIMITED', record({ status: 'limited', rawNormalizedState: { sourceStatus: 'LIVE' }, choice: undefined, probabilities: undefined, confidence: undefined })],
  ])('labels %s records without relabeling them as live', async (mode, status, fixture) => {
    testState.records = [fixture]
    const state: ResponseState = { headers: {} }
    await handler({ method: 'GET', headers: {}, query: { gameId: 'featured' } }, response(state))
    expect(state.code).toBe(200)
    expect(state.body).toEqual(expect.objectContaining({ mode, status }))
  })
})
