import { ConvexHttpClient } from 'convex/browser'
import { api } from '../../convex/_generated/api'
import type {
  ForecastBudgetReservationRequest,
  ForecastBudgetReservationResult,
  ForecastBudgetSettlementRequest,
  ForecastClaimResult,
  ForecastRecord,
  ForecastRecordReadBoundary,
  ForecastRecordStore,
} from '../shared/forecastRecords'

/**
 * Server-only adapter for the generated Convex HTTP client. The browser uses
 * the public API route instead, so Convex credentials and function references
 * never enter the Vite graph.
 */
export class ConvexForecastStore implements ForecastRecordStore, ForecastRecordReadBoundary {
  readonly client: ConvexHttpClient
  private readonly writeSecret?: string

  constructor(convexUrl: string, writeSecret?: string, client = new ConvexHttpClient(convexUrl)) {
    this.client = client
    this.writeSecret = writeSecret?.trim() || undefined
  }

  private authToken(): string {
    if (!this.writeSecret) throw new Error('Convex write authorization is not configured')
    return this.writeSecret
  }

  async get(idempotencyKey: string): Promise<ForecastRecord | undefined> {
    return await this.getForecastByIdempotencyKey(idempotencyKey)
  }

  async put(record: ForecastRecord): Promise<void> {
    await this.putIfAbsent(record)
  }

  async putIfAbsent(record: ForecastRecord): Promise<ForecastRecord> {
    return await this.client.action(api.forecasts.authorizedPutForecastIfAbsent, { authToken: this.authToken(), record }) as ForecastRecord
  }

  async claimForecast(idempotencyKey: string, ownerToken: string, nowMs: number, leaseMs: number): Promise<ForecastClaimResult> {
    return await this.client.action(api.forecasts.authorizedClaimForecast, { authToken: this.authToken(), idempotencyKey, ownerToken, nowMs, leaseMs }) as ForecastClaimResult
  }

  async releaseForecastClaim(idempotencyKey: string, ownerToken: string): Promise<void> {
    await this.client.action(api.forecasts.authorizedReleaseForecastClaim, { authToken: this.authToken(), idempotencyKey, ownerToken })
  }

  async reserveForecastBudget(request: ForecastBudgetReservationRequest): Promise<ForecastBudgetReservationResult> {
    return await this.client.action(api.forecasts.authorizedReserveForecastBudget, { authToken: this.authToken(), ...request }) as ForecastBudgetReservationResult
  }

  async settleForecastBudget(request: ForecastBudgetSettlementRequest): Promise<void> {
    await this.client.action(api.forecasts.authorizedSettleForecastBudget, { authToken: this.authToken(), ...request })
  }

  async getForecastByIdempotencyKey(idempotencyKey: string): Promise<ForecastRecord | undefined> {
    const record = await this.client.query(api.forecasts.getForecastByIdempotencyKey, { idempotencyKey }) as ForecastRecord | null
    return record ?? undefined
  }

  async listForecastsByGame(gameId: string): Promise<readonly ForecastRecord[]> {
    return await this.client.query(api.forecasts.listForecastsByGame, { gameId, limit: 128 }) as ForecastRecord[]
  }
}
