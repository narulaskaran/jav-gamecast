import { ConvexHttpClient } from 'convex/browser'
import { api } from '../../convex/_generated/api'
import {
  cloneAnalysisSnapshot,
  type AnalysisSnapshot,
  type AnalysisStorage,
} from '../shared/analysis'

/**
 * Server-only durable analysis boundary. Authenticated actions are used for
 * writes and private readbacks; the share query returns the already-bounded
 * public snapshot and never starts execution.
 */
export class ConvexAnalysisStore implements AnalysisStorage {
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

  async get(analysisId: string): Promise<AnalysisSnapshot | undefined> {
    const snapshot = await this.client.action(api.analyses.authorizedGetAnalysis, { authToken: this.authToken(), analysisId }) as AnalysisSnapshot | null
    return snapshot ? cloneAnalysisSnapshot(snapshot) : undefined
  }

  async getPublic(analysisId: string): Promise<AnalysisSnapshot | undefined> {
    const snapshot = await this.client.query(api.analyses.getAnalysisShareSnapshot, { analysisId }) as AnalysisSnapshot | null
    return snapshot ? cloneAnalysisSnapshot(snapshot) : undefined
  }

  async put(snapshot: AnalysisSnapshot): Promise<void> {
    await this.client.action(api.analyses.authorizedPutAnalysisSnapshot, { authToken: this.authToken(), snapshot })
  }

  async claim(analysisId: string, ownerToken: string, nowMs: number, leaseMs: number): Promise<'claimed' | 'busy' | 'complete' | 'missing'> {
    return await this.client.action(api.analyses.authorizedClaimAnalysis, { authToken: this.authToken(), analysisId, ownerToken, nowMs, leaseMs }) as 'claimed' | 'busy' | 'complete' | 'missing'
  }

  async release(analysisId: string, ownerToken: string): Promise<void> {
    await this.client.action(api.analyses.authorizedReleaseAnalysis, { authToken: this.authToken(), analysisId, ownerToken })
  }
}
