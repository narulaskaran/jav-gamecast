import type {
  ForecastBudgetReservation,
  ForecastBudgetLimits,
  ForecastBudgetReservationRequest,
  ForecastBudgetReservationResult,
  ForecastBudgetSettlementRequest,
  ForecastClaim,
  ForecastClaimResult,
  ForecastRecord,
  ForecastRecordStore,
} from '../shared/forecastRecords'
import type { ForecastFunctionBoundary } from './convexBoundary'

/** Local deterministic persistence for replay, tests, and no-config development. */
export class InMemoryForecastStore implements ForecastRecordStore, ForecastFunctionBoundary {
  private readonly records = new Map<string, ForecastRecord>()
  private readonly claims = new Map<string, ForecastClaim>()
  private readonly budgets = new Map<string, { limits: ForecastBudgetLimits; attempts: Array<{ atMs: number; costCents: number }>; reservations: Map<string, ForecastBudgetReservation> }>()
  private readonly reservations = new Map<string, ForecastBudgetReservation>()

  get(idempotencyKey: string): ForecastRecord | undefined {
    return this.records.get(idempotencyKey)
  }

  put(record: ForecastRecord): void {
    this.records.set(record.idempotencyKey, record)
  }

  putIfAbsent(record: ForecastRecord): ForecastRecord {
    const existing = this.records.get(record.idempotencyKey)
    if (existing) return existing
    this.records.set(record.idempotencyKey, record)
    return record
  }

  claimForecast(idempotencyKey: string, ownerToken: string, nowMs: number, leaseMs: number): ForecastClaimResult {
    const existingRecord = this.records.get(idempotencyKey)
    if (existingRecord) return { status: 'existing', record: existingRecord }
    const existingClaim = this.claims.get(idempotencyKey)
    // A provider call can outlive any local clock or nominal lease. Reclaiming
    // this key would permit a second paid request, so claims are fail-closed.
    if (existingClaim) return { status: 'busy' }
    const claim = { ownerToken, leaseExpiresAt: nowMs + leaseMs }
    this.claims.set(idempotencyKey, claim)
    return { status: 'claimed', claim }
  }

  releaseForecastClaim(idempotencyKey: string, ownerToken: string): void {
    if (this.claims.get(idempotencyKey)?.ownerToken === ownerToken) this.claims.delete(idempotencyKey)
  }

  reserveForecastBudget(request: ForecastBudgetReservationRequest): ForecastBudgetReservationResult {
    const existing = this.reservations.get(request.reservationId)
    if (existing) {
      if (existing.budgetScope === request.budgetScope && existing.ownerToken === request.ownerToken) return { status: 'reserved', reservation: existing }
      return { status: 'limited', code: 'REQUEST_LIMIT' }
    }
    const existingBudget = this.budgets.get(request.budgetScope)
    // A durable scope cannot be weakened by a fresh worker using a different
    // configuration. Keep the stricter value for every budget dimension.
    const limits: ForecastBudgetLimits = existingBudget ? {
      cadenceMs: Math.max(existingBudget.limits.cadenceMs, request.cadenceMs),
      rateWindowMs: Math.max(existingBudget.limits.rateWindowMs, request.rateWindowMs),
      maxRequestsPerWindow: Math.min(existingBudget.limits.maxRequestsPerWindow, request.maxRequestsPerWindow),
      maxRequests: Math.min(existingBudget.limits.maxRequests, request.maxRequests),
      maxSpendCents: Math.min(existingBudget.limits.maxSpendCents, request.maxSpendCents),
      estimatedCostCentsPerRequest: Math.max(existingBudget.limits.estimatedCostCentsPerRequest, request.estimatedCostCentsPerRequest),
    } : request
    const budget = existingBudget ?? { limits, attempts: [], reservations: new Map<string, ForecastBudgetReservation>() }
    budget.limits = limits
    const windowStart = request.nowMs - limits.rateWindowMs
    const activeReservations = [...budget.reservations.values()]
    const lastAttemptAt = Math.max(
      ...budget.attempts.map((attempt) => attempt.atMs),
      ...activeReservations.map((reservation) => reservation.reservedAtMs),
      Number.NEGATIVE_INFINITY,
    )
    if (lastAttemptAt !== Number.NEGATIVE_INFINITY && request.nowMs - lastAttemptAt < limits.cadenceMs) return { status: 'limited', code: 'CADENCE_LIMIT' }
    if (budget.attempts.length + activeReservations.length >= limits.maxRequests) return { status: 'limited', code: 'REQUEST_LIMIT' }
    const requestsInWindow = budget.attempts.filter((attempt) => attempt.atMs >= windowStart).length
      + activeReservations.filter((reservation) => reservation.reservedAtMs >= windowStart).length
    if (requestsInWindow >= limits.maxRequestsPerWindow) return { status: 'limited', code: 'RATE_LIMIT' }
    const spendCents = budget.attempts.reduce((total, attempt) => total + attempt.costCents, 0)
      + activeReservations.reduce((total, reservation) => total + reservation.estimatedCostCents, 0)
    if (spendCents + limits.estimatedCostCentsPerRequest > limits.maxSpendCents) return { status: 'limited', code: 'SPEND_LIMIT' }

    const reservation: ForecastBudgetReservation = {
      budgetScope: request.budgetScope,
      reservationId: request.reservationId,
      ownerToken: request.ownerToken,
      reservedAtMs: request.nowMs,
      estimatedCostCents: limits.estimatedCostCentsPerRequest,
    }
    budget.reservations.set(reservation.reservationId, reservation)
    this.budgets.set(request.budgetScope, budget)
    this.reservations.set(reservation.reservationId, reservation)
    return { status: 'reserved', reservation }
  }

  settleForecastBudget(request: ForecastBudgetSettlementRequest): void {
    const reservation = this.reservations.get(request.reservationId)
    if (!reservation || reservation.budgetScope !== request.budgetScope || reservation.ownerToken !== request.ownerToken) return
    const budget = this.budgets.get(request.budgetScope)
    budget?.reservations.delete(request.reservationId)
    this.reservations.delete(request.reservationId)
    if (request.outcome === 'consumed') budget?.attempts.push({ atMs: reservation.reservedAtMs, costCents: reservation.estimatedCostCents })
  }

  putForecastIfAbsent(record: ForecastRecord): ForecastRecord {
    return this.putIfAbsent(record)
  }

  getForecastByIdempotencyKey(idempotencyKey: string): ForecastRecord | undefined {
    return this.get(idempotencyKey)
  }

  listForecastsByGame(gameId: string): readonly ForecastRecord[] {
    return [...this.records.values()]
      .filter((record) => record.gameId === gameId)
      .sort((left, right) => left.requestedAt.localeCompare(right.requestedAt) || left.idempotencyKey.localeCompare(right.idempotencyKey))
  }

  size(): number {
    return this.records.size
  }
}
