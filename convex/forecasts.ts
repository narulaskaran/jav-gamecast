import { action, internalMutation, query } from './_generated/server'
import { internal } from './_generated/api'
import { v } from 'convex/values'

const recordArgs = {
  idempotencyKey: v.string(),
  gameId: v.string(),
  providerEventId: v.string(),
  providerPlayId: v.optional(v.string()),
  stateHash: v.string(),
  // Convex has no recursive JSON validator; validate this value at the
  // authenticated action boundary before forwarding it to this mutation.
  rawNormalizedState: v.any(),
  model: v.string(),
  status: v.union(v.literal('success'), v.literal('error'), v.literal('limited')),
  source: v.union(v.literal('live'), v.literal('mock'), v.literal('replay'), v.literal('stale')),
  requestedAt: v.string(),
  completedAt: v.string(),
  latencyMs: v.number(),
  choice: v.optional(v.union(v.literal('home'), v.literal('away'), v.literal('tie'))),
  probabilities: v.optional(v.object({ home: v.number(), away: v.number(), tie: v.number() })),
  confidence: v.optional(v.number()),
  error: v.optional(v.object({ code: v.string(), retryable: v.boolean(), providerStatus: v.optional(v.number()) })),
}

const limitArgs = {
  cadenceMs: v.number(),
  rateWindowMs: v.number(),
  maxRequestsPerWindow: v.number(),
  maxRequests: v.number(),
  maxSpendCents: v.number(),
  estimatedCostCentsPerRequest: v.number(),
}

const configuredFeaturedGameId = (): string | undefined => {
  const value = process.env.FEATURED_GAME_ID?.trim()
  return value || undefined
}

const requireFeaturedGame = (gameId: string): boolean => {
  const configured = configuredFeaturedGameId()
  return configured !== undefined && gameId === configured
}

const keyBelongsToFeaturedGame = (idempotencyKey: string): boolean => {
  const featuredGameId = configuredFeaturedGameId()
  return featuredGameId !== undefined && idempotencyKey.startsWith(`${featuredGameId.length}:${featuredGameId}|`)
}

const publicRecord = (record: Record<string, unknown>) => {
  const { _id: _ignoredId, _creationTime: _ignoredCreationTime, ...safe } = record
  return safe
}

const isJsonObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const validateRecord = (record: Record<string, unknown>): void => {
  if (!requireFeaturedGame(String(record.gameId ?? '')) || !keyBelongsToFeaturedGame(String(record.idempotencyKey ?? ''))) {
    throw new Error('Forecast record is outside the configured featured game')
  }
  if (!/^[a-f0-9]{64}$/.test(String(record.stateHash ?? ''))) throw new Error('Forecast record has an invalid state hash')
  if (!isJsonObject(record.rawNormalizedState) || JSON.stringify(record.rawNormalizedState).length > 64_000) {
    throw new Error('Forecast record state must be a bounded JSON object')
  }
  if (typeof record.model !== 'string' || record.model.length === 0 || record.model.length > 256) throw new Error('Forecast record has an invalid model')
  if (typeof record.latencyMs !== 'number' || !Number.isFinite(record.latencyMs) || record.latencyMs < 0) throw new Error('Forecast record has invalid latency')
  if (typeof record.requestedAt !== 'string' || Number.isNaN(Date.parse(record.requestedAt)) || typeof record.completedAt !== 'string' || Number.isNaN(Date.parse(record.completedAt))) {
    throw new Error('Forecast record has invalid timestamps')
  }
  const sourceStatus = record.rawNormalizedState.sourceStatus
  if (record.source === 'live' && sourceStatus !== 'LIVE') throw new Error('Live records require a LIVE source snapshot')
  if (record.source === 'stale' && sourceStatus !== 'STALE') throw new Error('Stale records require a STALE source snapshot')
  if (record.status === 'success') {
    const probabilities = record.probabilities
    const values = isJsonObject(probabilities) ? [probabilities.home, probabilities.away, probabilities.tie] : []
    if (record.choice !== 'home' && record.choice !== 'away' && record.choice !== 'tie') throw new Error('Successful records require a choice')
    if (values.length !== 3 || !values.every((value) => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1) || Math.abs((values as number[]).reduce((sum, value) => sum + value, 0) - 1) > 1e-9) {
      throw new Error('Successful records require a unit probability distribution')
    }
    if (typeof record.confidence !== 'number' || !Number.isFinite(record.confidence) || record.confidence < 0 || record.confidence > 1) throw new Error('Successful records require unit confidence')
  }
}

const validateLimits = (limits: Record<string, unknown>): void => {
  const names = ['cadenceMs', 'rateWindowMs', 'maxRequestsPerWindow', 'maxRequests', 'maxSpendCents', 'estimatedCostCentsPerRequest']
  for (const name of names) {
    const value = limits[name]
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1_000_000) throw new Error(`Invalid budget limit: ${name}`)
  }
  const maxRequestsPerWindow = limits.maxRequestsPerWindow as number
  const maxRequests = limits.maxRequests as number
  if (limits.rateWindowMs === 0 || maxRequestsPerWindow < 1 || maxRequests < 1 || !Number.isInteger(maxRequestsPerWindow) || !Number.isInteger(maxRequests)) {
    throw new Error('Budget limits are outside the supported range')
  }
}

const authorizeWrite = (authToken: string): void => {
  const expected = process.env.CONVEX_WRITE_SECRET?.trim()
  if (!expected || authToken !== expected) throw new Error('Unauthorized forecast mutation')
}

export const getForecastByIdempotencyKey = query({
  args: { idempotencyKey: v.string() },
  handler: async (ctx, { idempotencyKey }) => {
    // Public reads are deliberately restricted to the one operator-configured
    // game. A key from another game is indistinguishable from a missing key.
    if (!keyBelongsToFeaturedGame(idempotencyKey)) return null
    const record = await ctx.db.query('forecastRecords').withIndex('by_idempotency_key', (q) => q.eq('idempotencyKey', idempotencyKey)).unique()
    return record && requireFeaturedGame(record.gameId) ? publicRecord(record) : null
  },
})

export const listForecastsByGame = query({
  args: { gameId: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, { gameId, limit }) => {
    if (!requireFeaturedGame(gameId)) return []
    const boundedLimit = Math.max(1, Math.min(Number.isFinite(limit) ? limit ?? 64 : 64, 128))
    const records = await ctx.db.query('forecastRecords').withIndex('by_game_requested_at', (q) => q.eq('gameId', gameId)).order('asc').take(boundedLimit)
    return records.map(publicRecord)
  },
})

export const putForecastIfAbsentInternal = internalMutation({
  args: recordArgs,
  handler: async (ctx, args) => {
    validateRecord(args as unknown as Record<string, unknown>)
    const existing = await ctx.db.query('forecastRecords').withIndex('by_idempotency_key', (q) => q.eq('idempotencyKey', args.idempotencyKey)).unique()
    if (existing) return publicRecord(existing)
    const id = await ctx.db.insert('forecastRecords', args)
    const inserted = await ctx.db.get(id)
    if (!inserted) throw new Error('Forecast insert did not produce a document')
    return publicRecord(inserted)
  },
})

export const claimForecastInternal = internalMutation({
  args: { idempotencyKey: v.string(), ownerToken: v.string(), nowMs: v.number(), leaseMs: v.number() },
  handler: async (ctx, args) => {
    if (!keyBelongsToFeaturedGame(args.idempotencyKey) || !args.ownerToken.trim() || !Number.isFinite(args.nowMs) || !Number.isFinite(args.leaseMs) || args.leaseMs < 1_000 || args.leaseMs > 86_400_000) throw new Error('Invalid forecast claim')
    const existingRecord = await ctx.db.query('forecastRecords').withIndex('by_idempotency_key', (q) => q.eq('idempotencyKey', args.idempotencyKey)).unique()
    if (existingRecord) return { status: 'existing' as const, record: publicRecord(existingRecord) }
    const existingClaim = await ctx.db.query('forecastClaims').withIndex('by_idempotency_key', (q) => q.eq('idempotencyKey', args.idempotencyKey)).unique()
    if (existingClaim) return { status: 'busy' as const }
    await ctx.db.insert('forecastClaims', { idempotencyKey: args.idempotencyKey, ownerToken: args.ownerToken, leaseExpiresAt: args.nowMs + args.leaseMs })
    return { status: 'claimed' as const, claim: { ownerToken: args.ownerToken, leaseExpiresAt: args.nowMs + args.leaseMs } }
  },
})

export const releaseForecastClaimInternal = internalMutation({
  args: { idempotencyKey: v.string(), ownerToken: v.string() },
  handler: async (ctx, { idempotencyKey, ownerToken }) => {
    if (!keyBelongsToFeaturedGame(idempotencyKey) || !ownerToken.trim()) throw new Error('Invalid forecast claim')
    const claim = await ctx.db.query('forecastClaims').withIndex('by_idempotency_key', (q) => q.eq('idempotencyKey', idempotencyKey)).unique()
    if (claim && claim.ownerToken === ownerToken) await ctx.db.delete(claim._id)
    return null
  },
})

type BudgetLimits = {
  cadenceMs: number
  rateWindowMs: number
  maxRequestsPerWindow: number
  maxRequests: number
  maxSpendCents: number
  estimatedCostCentsPerRequest: number
}

const stricterLimits = (current: BudgetLimits, next: BudgetLimits): BudgetLimits => ({
  cadenceMs: Math.max(current.cadenceMs, next.cadenceMs),
  rateWindowMs: Math.max(current.rateWindowMs, next.rateWindowMs),
  maxRequestsPerWindow: Math.min(current.maxRequestsPerWindow, next.maxRequestsPerWindow),
  maxRequests: Math.min(current.maxRequests, next.maxRequests),
  maxSpendCents: Math.min(current.maxSpendCents, next.maxSpendCents),
  estimatedCostCentsPerRequest: Math.max(current.estimatedCostCentsPerRequest, next.estimatedCostCentsPerRequest),
})

export const reserveForecastBudgetInternal = internalMutation({
  args: { budgetScope: v.string(), reservationId: v.string(), ownerToken: v.string(), nowMs: v.number(), ...limitArgs },
  handler: async (ctx, args) => {
    if (args.budgetScope !== `featured:${configuredFeaturedGameId() ?? ''}` || !args.reservationId.trim() || !args.ownerToken.trim() || !Number.isFinite(args.nowMs)) throw new Error('Invalid forecast budget reservation')
    validateLimits(args as unknown as Record<string, unknown>)
    const existingReservation = await ctx.db.query('forecastBudgetReservations').withIndex('by_reservation_id', (q) => q.eq('reservationId', args.reservationId)).unique()
    if (existingReservation) {
      if (existingReservation.budgetScope === args.budgetScope && existingReservation.ownerToken === args.ownerToken && existingReservation.outcome === 'pending') return { status: 'reserved' as const, reservation: existingReservation }
      return { status: 'limited' as const, code: 'REQUEST_LIMIT' as const }
    }
    const existingBudget = await ctx.db.query('forecastBudgets').withIndex('by_scope', (q) => q.eq('budgetScope', args.budgetScope)).unique()
    const limits = existingBudget ? stricterLimits(existingBudget.limits, args) : {
      cadenceMs: args.cadenceMs, rateWindowMs: args.rateWindowMs, maxRequestsPerWindow: args.maxRequestsPerWindow,
      maxRequests: args.maxRequests, maxSpendCents: args.maxSpendCents, estimatedCostCentsPerRequest: args.estimatedCostCentsPerRequest,
    }
    const recentAttempts = (existingBudget?.recentAttempts ?? []).filter((attempt) => attempt.atMs >= args.nowMs - limits.rateWindowMs)
    const lastAttemptAt = existingBudget?.lastAttemptAtMs
    if (lastAttemptAt !== undefined && args.nowMs - lastAttemptAt < limits.cadenceMs) return { status: 'limited' as const, code: 'CADENCE_LIMIT' as const }
    if ((existingBudget?.totalRequests ?? 0) + (existingBudget?.activeReservationCount ?? 0) >= limits.maxRequests) return { status: 'limited' as const, code: 'REQUEST_LIMIT' as const }
    if (recentAttempts.length + (existingBudget?.activeReservationCount ?? 0) >= limits.maxRequestsPerWindow) return { status: 'limited' as const, code: 'RATE_LIMIT' as const }
    if ((existingBudget?.totalSpendCents ?? 0) + (existingBudget?.activeReservedCents ?? 0) + limits.estimatedCostCentsPerRequest > limits.maxSpendCents) return { status: 'limited' as const, code: 'SPEND_LIMIT' as const }
    const reservation = { budgetScope: args.budgetScope, reservationId: args.reservationId, ownerToken: args.ownerToken, reservedAtMs: args.nowMs, estimatedCostCents: limits.estimatedCostCentsPerRequest, outcome: 'pending' as const }
    if (existingBudget) {
      await ctx.db.patch(existingBudget._id, { limits, lastAttemptAtMs: args.nowMs, activeReservationCount: existingBudget.activeReservationCount + 1, activeReservedCents: existingBudget.activeReservedCents + reservation.estimatedCostCents, recentAttempts, updatedAtMs: args.nowMs })
    } else {
      await ctx.db.insert('forecastBudgets', { budgetScope: args.budgetScope, limits, totalRequests: 0, totalSpendCents: 0, lastAttemptAtMs: args.nowMs, activeReservationCount: 1, activeReservedCents: reservation.estimatedCostCents, recentAttempts: [], updatedAtMs: args.nowMs })
    }
    await ctx.db.insert('forecastBudgetReservations', reservation)
    return { status: 'reserved' as const, reservation }
  },
})

export const settleForecastBudgetInternal = internalMutation({
  args: { budgetScope: v.string(), reservationId: v.string(), ownerToken: v.string(), outcome: v.union(v.literal('consumed'), v.literal('released')) },
  handler: async (ctx, args) => {
    if (args.budgetScope !== `featured:${configuredFeaturedGameId() ?? ''}` || !args.reservationId.trim() || !args.ownerToken.trim()) throw new Error('Invalid forecast budget settlement')
    const reservation = await ctx.db.query('forecastBudgetReservations').withIndex('by_reservation_id', (q) => q.eq('reservationId', args.reservationId)).unique()
    if (!reservation || reservation.budgetScope !== args.budgetScope || reservation.ownerToken !== args.ownerToken || reservation.outcome !== 'pending') return null
    const budget = await ctx.db.query('forecastBudgets').withIndex('by_scope', (q) => q.eq('budgetScope', args.budgetScope)).unique()
    if (!budget) return null
    const consumed = args.outcome === 'consumed'
    await ctx.db.patch(reservation._id, { outcome: args.outcome })
    await ctx.db.patch(budget._id, {
      activeReservationCount: Math.max(0, budget.activeReservationCount - 1),
      activeReservedCents: Math.max(0, budget.activeReservedCents - reservation.estimatedCostCents),
      totalRequests: budget.totalRequests + (consumed ? 1 : 0),
      totalSpendCents: budget.totalSpendCents + (consumed ? reservation.estimatedCostCents : 0),
      recentAttempts: consumed ? [...budget.recentAttempts, { atMs: reservation.reservedAtMs, costCents: reservation.estimatedCostCents }].filter((attempt) => attempt.atMs >= reservation.reservedAtMs - budget.limits.rateWindowMs) : budget.recentAttempts,
      updatedAtMs: reservation.reservedAtMs,
    })
    return null
  },
})

export const authorizedPutForecastIfAbsent = action({
  args: { authToken: v.string(), record: v.object(recordArgs) },
  handler: async (ctx, { authToken, record }) => {
    authorizeWrite(authToken)
    validateRecord(record as unknown as Record<string, unknown>)
    return await ctx.runMutation(internal.forecasts.putForecastIfAbsentInternal, record)
  },
})

export const authorizedClaimForecast = action({
  args: { authToken: v.string(), idempotencyKey: v.string(), ownerToken: v.string(), nowMs: v.number(), leaseMs: v.number() },
  handler: async (ctx, { authToken, ...args }) => {
    authorizeWrite(authToken)
    return await ctx.runMutation(internal.forecasts.claimForecastInternal, args)
  },
})

export const authorizedReleaseForecastClaim = action({
  args: { authToken: v.string(), idempotencyKey: v.string(), ownerToken: v.string() },
  handler: async (ctx, { authToken, ...args }) => {
    authorizeWrite(authToken)
    return await ctx.runMutation(internal.forecasts.releaseForecastClaimInternal, args)
  },
})

export const authorizedReserveForecastBudget = action({
  args: { authToken: v.string(), budgetScope: v.string(), reservationId: v.string(), ownerToken: v.string(), nowMs: v.number(), ...limitArgs },
  handler: async (ctx, { authToken, ...args }) => {
    authorizeWrite(authToken)
    return await ctx.runMutation(internal.forecasts.reserveForecastBudgetInternal, args)
  },
})

export const authorizedSettleForecastBudget = action({
  args: { authToken: v.string(), budgetScope: v.string(), reservationId: v.string(), ownerToken: v.string(), outcome: v.union(v.literal('consumed'), v.literal('released')) },
  handler: async (ctx, { authToken, ...args }) => {
    authorizeWrite(authToken)
    return await ctx.runMutation(internal.forecasts.settleForecastBudgetInternal, args)
  },
})
