import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ result: undefined as any }))
vi.mock('../../src/server/liveConfig', () => ({
  readLiveRuntimeConfig: () => ({ convexUrl: 'https://demo.convex.cloud', convexWriteSecret: 'write-secret', typesafeApiKey: 'provider-key', cronSecret: 'cron-secret', featuredGameId: 'featured' }),
}))
vi.mock('../../src/server/convexStore', () => ({ ConvexForecastStore: class {} }))
vi.mock('../../src/server/orchestrator', () => ({ runForecastCycle: async () => state.result }))

import handler from './forecast'

type ResponseState = { code?: number; body?: unknown; headers: Record<string, string> }
const response = (result: ResponseState) => ({
  status(code: number) { result.code = code; return this },
  json(body: unknown) { result.body = body; return this },
  setHeader(name: string, value: string) { result.headers[name] = value; return this },
})
const cycleResult = (snapshotStatus: string, status: string, source: string) => ({
  snapshot: { status: snapshotStatus, state: {} },
  forecast: { cacheHit: false, record: { status, source, idempotencyKey: 'key' } },
})

beforeEach(() => { state.result = cycleResult('LIVE', 'success', 'live') })

describe('protected forecast cron labels', () => {
  it('requires the cron secret', async () => {
    const result: ResponseState = { headers: {} }
    await handler({ method: 'POST', headers: {} }, response(result))
    expect(result.code).toBe(401)
  })

  it.each([
    ['live', 'LIVE', cycleResult('LIVE', 'success', 'live')],
    ['replay', 'REPLAY', cycleResult('REPLAY', 'success', 'replay')],
    ['stale', 'STALE', cycleResult('STALE', 'error', 'stale')],
    ['error', 'ERROR', cycleResult('LIVE', 'error', 'live')],
    ['limited', 'LIMITED', cycleResult('LIVE', 'limited', 'live')],
  ])('labels %s without claiming live for non-live records', async (mode, status, resultValue) => {
    state.result = resultValue
    const result: ResponseState = { headers: {} }
    await handler({ method: 'POST', headers: { authorization: 'Bearer cron-secret' } }, response(result))
    expect(result.code).toBe(200)
    expect(result.body).toEqual(expect.objectContaining({ mode, status }))
  })
})
