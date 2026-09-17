import type { ForecastRecord, ForecastRecordReadBoundary, MaybePromise } from '../shared/forecastRecords'

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
  probabilities: 'optional home/away/tie distribution',
  confidence: 'optional number',
  error: 'optional error metadata',
} as const

export type ForecastRecordDocument = ForecastRecord

export interface ForecastQueryFunctions extends ForecastRecordReadBoundary {
  getForecastByIdempotencyKey(idempotencyKey: string): MaybePromise<ForecastRecord | undefined>
  listForecastsByGame(gameId: string): MaybePromise<readonly ForecastRecord[]>
}

export interface ForecastMutationFunctions {
  putForecastIfAbsent(record: ForecastRecord): MaybePromise<ForecastRecord>
}

export type ForecastFunctionBoundary = ForecastQueryFunctions & ForecastMutationFunctions
