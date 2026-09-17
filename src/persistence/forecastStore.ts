import type { ForecastClaim, ForecastClaimResult, ForecastRecord, ForecastRecordStore } from '../shared/forecastRecords'
import type { ForecastFunctionBoundary } from './convexBoundary'

/** Local deterministic persistence for replay, tests, and no-config development. */
export class InMemoryForecastStore implements ForecastRecordStore, ForecastFunctionBoundary {
  private readonly records = new Map<string, ForecastRecord>()
  private readonly claims = new Map<string, ForecastClaim>()

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
    if (existingClaim && existingClaim.leaseExpiresAt > nowMs) return { status: 'busy' }
    const claim = { ownerToken, leaseExpiresAt: nowMs + leaseMs }
    this.claims.set(idempotencyKey, claim)
    return { status: 'claimed', claim }
  }

  releaseForecastClaim(idempotencyKey: string, ownerToken: string): void {
    if (this.claims.get(idempotencyKey)?.ownerToken === ownerToken) this.claims.delete(idempotencyKey)
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
