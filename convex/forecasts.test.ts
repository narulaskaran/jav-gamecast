import { describe, expect, it, beforeEach } from 'vitest'
import { convexTest } from 'convex-test'
import { api } from './_generated/api'
import schema from './schema'

const modules = (import.meta as ImportMeta & { glob: (pattern: string) => Record<string, () => Promise<unknown>> }).glob('./**/*.ts')
const writeSecret = 'convex-test-write-secret'
const stateHash = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
const limits = {
  cadenceMs: 90_000,
  rateWindowMs: 60_000,
  maxRequestsPerWindow: 2,
  maxRequests: 2,
  maxSpendCents: 2,
  estimatedCostCentsPerRequest: 1,
}
const record = {
  idempotencyKey: `4:game|5:event|4:play|64:${stateHash}`, gameId: 'game', providerEventId: 'event', providerPlayId: 'play', stateHash,
  rawNormalizedState: { id: 'game', homeScore: 0, sourceStatus: 'LIVE' }, model: 'jev-latest', status: 'success' as const, source: 'live' as const,
  requestedAt: '2026-09-17T03:00:00Z', completedAt: '2026-09-17T03:00:01Z', latencyMs: 100,
  choice: 'home' as const, probabilities: { home: 0.6, away: 0.3, tie: 0.1 }, confidence: 0.6,
}

beforeEach(() => {
  process.env.FEATURED_GAME_ID = 'game'
  process.env.CONVEX_WRITE_SECRET = writeSecret
})

describe('real Convex functions', () => {
  it('makes authenticated forecast writes idempotent and immutable while rejecting unauthenticated writes', async () => {
    const t = convexTest(schema, modules)
    await expect(t.action(api.forecasts.authorizedPutForecastIfAbsent, { authToken: 'wrong', record })).rejects.toThrow(/unauthorized/i)
    const first = await t.action(api.forecasts.authorizedPutForecastIfAbsent, { authToken: writeSecret, record })
    const second = await t.action(api.forecasts.authorizedPutForecastIfAbsent, { authToken: writeSecret, record: { ...record, confidence: 0.99 } })
    expect(second).toEqual(first)
    await expect(t.query(api.forecasts.getForecastByIdempotencyKey, { idempotencyKey: record.idempotencyKey })).resolves.toEqual(first)
    await expect(t.query(api.forecasts.listForecastsByGame, { gameId: 'other' })).resolves.toEqual([])
    await expect(t.action(api.runtime.latestForecastHealth, { gameId: 'game' })).resolves.toEqual({
      gameId: 'game', available: true, status: 'success', source: 'live', updatedAt: record.completedAt,
    })
  })

  it('keeps claims and budgets atomic across independent authenticated callers', async () => {
    const t = convexTest(schema, modules)
    const key = '4:game|3:evt|4:play|64:' + stateHash
    const firstClaim = await t.action(api.forecasts.authorizedClaimForecast, { authToken: writeSecret, idempotencyKey: key, ownerToken: 'owner-a', nowMs: 1_000, leaseMs: 120_000 })
    const secondClaim = await t.action(api.forecasts.authorizedClaimForecast, { authToken: writeSecret, idempotencyKey: key, ownerToken: 'owner-b', nowMs: 1_000, leaseMs: 120_000 })
    expect(firstClaim.status).toBe('claimed')
    expect(secondClaim).toEqual({ status: 'busy' })
    await expect(t.action(api.forecasts.authorizedReserveForecastBudget, { authToken: writeSecret, budgetScope: 'featured:game', reservationId: 'r1', ownerToken: 'owner-a', nowMs: 1_000, ...limits })).resolves.toMatchObject({ status: 'reserved' })
    await expect(t.action(api.forecasts.authorizedReserveForecastBudget, { authToken: writeSecret, budgetScope: 'featured:game', reservationId: 'r2', ownerToken: 'owner-b', nowMs: 1_001, ...limits })).resolves.toEqual({ status: 'limited', code: 'CADENCE_LIMIT' })
    await expect(t.action(api.forecasts.authorizedReserveForecastBudget, { authToken: writeSecret, budgetScope: 'other-game', reservationId: 'r3', ownerToken: 'owner-c', nowMs: 1_001, ...limits })).rejects.toThrow(/invalid forecast budget/i)
  })
})
