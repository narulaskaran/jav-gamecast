export type ForecastChoice = 'home' | 'away' | 'tie'
export type ForecastRecordStatus = 'success' | 'error' | 'limited'
export type ForecastRecordSource = 'live' | 'mock' | 'replay'
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

export interface ForecastClaim {
  ownerToken: string
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
}
