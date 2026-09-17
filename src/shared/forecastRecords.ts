export type ForecastChoice = 'home' | 'away' | 'tie'
export type ForecastRecordStatus = 'success' | 'error' | 'limited'
export type ForecastRecordSource = 'live' | 'mock' | 'replay' | 'stale'
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }

export interface ForecastProbabilities {
  /** Canonical persisted unit is 0..1; browser display converts once to 0..100. */
  home: number
  away: number
  tie: number
}

export interface ForecastErrorMetadata {
  code: string
  retryable: boolean
  providerStatus?: number
}

export interface ForecastRecord {
  idempotencyKey: string
  gameId: string
  providerEventId: string
  providerPlayId?: string
  stateHash: string
  rawNormalizedState: Exclude<JsonValue, null>
  model: string
  status: ForecastRecordStatus
  source: ForecastRecordSource
  requestedAt: string
  completedAt: string
  latencyMs: number
  choice?: ForecastChoice
  probabilities?: ForecastProbabilities
  /** Canonical persisted confidence is the provider's 0..1 unit value. */
  confidence?: number
  error?: ForecastErrorMetadata
}

export type MaybePromise<T> = T | Promise<T>

export type ForecastLimitCode = 'CADENCE_LIMIT' | 'RATE_LIMIT' | 'REQUEST_LIMIT' | 'SPEND_LIMIT'

export interface ForecastBudgetLimits {
  cadenceMs: number
  rateWindowMs: number
  maxRequestsPerWindow: number
  maxRequests: number
  maxSpendCents: number
  estimatedCostCentsPerRequest: number
}

export interface ForecastBudgetReservationRequest extends ForecastBudgetLimits {
  budgetScope: string
  reservationId: string
  ownerToken: string
  nowMs: number
}

export interface ForecastBudgetReservation {
  budgetScope: string
  reservationId: string
  ownerToken: string
  reservedAtMs: number
  estimatedCostCents: number
}

export type ForecastBudgetReservationResult =
  | { status: 'reserved'; reservation: ForecastBudgetReservation }
  | { status: 'limited'; code: ForecastLimitCode }

export interface ForecastBudgetSettlementRequest {
  budgetScope: string
  reservationId: string
  ownerToken: string
  outcome: 'consumed' | 'released'
}

export interface ForecastClaim {
  ownerToken: string
  /** Informational compatibility field; stores must not reclaim an unfinalized claim by time. */
  leaseExpiresAt: number
}

export type ForecastClaimResult =
  | { status: 'claimed'; claim: ForecastClaim }
  | { status: 'busy' }
  | { status: 'existing'; record: ForecastRecord }

export interface ForecastRecordReadBoundary {
  getForecastByIdempotencyKey(idempotencyKey: string): MaybePromise<ForecastRecord | undefined>
  listForecastsByGame(gameId: string): MaybePromise<readonly ForecastRecord[]>
}

export interface ForecastRecordStore {
  get(idempotencyKey: string): MaybePromise<ForecastRecord | undefined>
  put(record: ForecastRecord): MaybePromise<void>
  putIfAbsent(record: ForecastRecord): MaybePromise<ForecastRecord>
  /** Atomically claim a key before any provider invocation. */
  claimForecast(idempotencyKey: string, ownerToken: string, nowMs: number, leaseMs: number): MaybePromise<ForecastClaimResult>
  releaseForecastClaim(idempotencyKey: string, ownerToken: string): MaybePromise<void>
  /** Atomically reserve the durable live request/rate/spend budget before provider invocation. */
  reserveForecastBudget(request: ForecastBudgetReservationRequest): MaybePromise<ForecastBudgetReservationResult>
  /** Consume a provider reservation, or release it only when no provider call was made. */
  settleForecastBudget(request: ForecastBudgetSettlementRequest): MaybePromise<void>
}
