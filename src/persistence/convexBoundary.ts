import type { ForecastClaimResult, ForecastRecord, ForecastRecordReadBoundary, MaybePromise } from '../shared/forecastRecords'

/**
 * Typed shape for the future Convex document and query/mutation boundary.
 * This intentionally has no Convex runtime import until a project deployment is configured.
 */
export const forecastRecordSchema = {
  idempotencyKey: 'string',
  gameId: 'string',
  providerEventId: 'string',
  providerPlayId: 'optional string',
  stateHash: 'string',
  rawNormalizedState: 'json',
  model: 'string',
  status: 'success | error | limited',
  source: 'live | mock | replay',
  requestedAt: 'ISO timestamp',
  completedAt: 'ISO timestamp',
  latencyMs: 'number',
  choice: 'optional home | away | tie',
  probabilities: 'optional unit (0..1) home/away/tie distribution; browser converts once to display percentages',
  confidence: 'optional unit 0..1 confidence; browser converts once to display percentage',
  error: 'optional error metadata',
} as const

export type ForecastRecordDocument = ForecastRecord

export interface ForecastQueryFunctions extends ForecastRecordReadBoundary {
  getForecastByIdempotencyKey(idempotencyKey: string): MaybePromise<ForecastRecord | undefined>
  listForecastsByGame(gameId: string): MaybePromise<readonly ForecastRecord[]>
}

export interface ForecastMutationFunctions {
  putForecastIfAbsent(record: ForecastRecord): MaybePromise<ForecastRecord>
  claimForecast(idempotencyKey: string, ownerToken: string, nowMs: number, leaseMs: number): MaybePromise<ForecastClaimResult>
  releaseForecastClaim(idempotencyKey: string, ownerToken: string): MaybePromise<void>
}

export type ForecastFunctionBoundary = ForecastQueryFunctions & ForecastMutationFunctions
