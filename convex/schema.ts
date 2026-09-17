import { defineSchema, defineTable } from 'convex/server'
import { v } from 'convex/values'

const probabilityValidator = v.object({
  home: v.number(),
  away: v.number(),
  tie: v.number(),
})

const errorValidator = v.object({
  code: v.string(),
  retryable: v.boolean(),
  providerStatus: v.optional(v.number()),
})

const limitsValidator = v.object({
  cadenceMs: v.number(),
  rateWindowMs: v.number(),
  maxRequestsPerWindow: v.number(),
  maxRequests: v.number(),
  maxSpendCents: v.number(),
  estimatedCostCentsPerRequest: v.number(),
})

export default defineSchema({
  forecastRecords: defineTable({
    idempotencyKey: v.string(),
    gameId: v.string(),
    providerEventId: v.string(),
    providerPlayId: v.optional(v.string()),
    stateHash: v.string(),
    rawNormalizedState: v.any(),
    model: v.string(),
    status: v.union(v.literal('success'), v.literal('error'), v.literal('limited')),
    source: v.union(v.literal('live'), v.literal('mock'), v.literal('replay'), v.literal('stale')),
    requestedAt: v.string(),
    completedAt: v.string(),
    latencyMs: v.number(),
    choice: v.optional(v.union(v.literal('home'), v.literal('away'), v.literal('tie'))),
    probabilities: v.optional(probabilityValidator),
    confidence: v.optional(v.number()),
    error: v.optional(errorValidator),
  })
    .index('by_idempotency_key', ['idempotencyKey'])
    .index('by_game_requested_at', ['gameId', 'requestedAt']),
  forecastClaims: defineTable({
    idempotencyKey: v.string(),
    ownerToken: v.string(),
    leaseExpiresAt: v.number(),
  }).index('by_idempotency_key', ['idempotencyKey']),
  forecastBudgets: defineTable({
    budgetScope: v.string(),
    limits: limitsValidator,
    totalRequests: v.number(),
    totalSpendCents: v.number(),
    lastAttemptAtMs: v.optional(v.number()),
    activeReservationCount: v.number(),
    activeReservedCents: v.number(),
    recentAttempts: v.array(v.object({ atMs: v.number(), costCents: v.number() })),
    updatedAtMs: v.number(),
  }).index('by_scope', ['budgetScope']),
  forecastBudgetReservations: defineTable({
    budgetScope: v.string(),
    reservationId: v.string(),
    ownerToken: v.string(),
    reservedAtMs: v.number(),
    estimatedCostCents: v.number(),
    outcome: v.union(v.literal('pending'), v.literal('consumed'), v.literal('released')),
  })
    .index('by_reservation_id', ['reservationId'])
    .index('by_scope', ['budgetScope']),
})
