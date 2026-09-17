import {
  APIConnectionError,
  APIError,
  APITimeoutError,
  TypeSafeError,
} from '@typesafe-ai/sdk'
import { randomUUID } from 'node:crypto'
import {
  JEV_MODEL,
  TypeSafeConfigurationError,
  TypeSafeJevProvider,
  type ChoiceAnswer,
  type JevProvider,
  type JevProviderResult,
  sha256Hex,
} from './jev'
import { normalizeCurrentForecastState, type CurrentForecastState } from './forecastState'
import type {
  ForecastErrorMetadata,
  ForecastRecord,
  ForecastRecordSource,
  ForecastRecordStatus,
  ForecastRecordStore,
  ForecastBudgetLimits,
  ForecastBudgetReservation,
  JsonValue,
} from '../shared/forecastRecords'
import { InMemoryForecastStore } from '../persistence/forecastStore'

export type { JevProvider } from './jev'
export type {
  ForecastBudgetLimits,
  ForecastBudgetReservation,
  ForecastBudgetReservationRequest,
  ForecastBudgetReservationResult,
  ForecastBudgetSettlementRequest,
  ForecastErrorMetadata,
  ForecastRecord,
  ForecastRecordSource,
  ForecastRecordStatus,
  ForecastRecordStore,
} from '../shared/forecastRecords'
export { InMemoryForecastStore } from '../persistence/forecastStore'

export type ForecastMode = 'live' | 'mock' | 'replay'
export type ForecastStore = ForecastRecordStore

export interface ForecastJob {
  gameId: string
  providerEventId: string
  providerPlayId?: string
  state: unknown
}

export interface NormalizedForecastJob extends Omit<ForecastJob, 'state'> {
  state: CurrentForecastState
  stateHash: string
  idempotencyKey: string
}

export interface ForecastLimits extends ForecastBudgetLimits {
  estimatedCostCentsPerRequest: number
  claimLeaseMs: number
}

export const DEFAULT_FORECAST_LIMITS: ForecastLimits = {
  cadenceMs: 90_000,
  rateWindowMs: 90_000,
  maxRequestsPerWindow: 1,
  maxRequests: 100,
  maxSpendCents: 100,
  estimatedCostCentsPerRequest: 1,
  claimLeaseMs: 120_000,
}

const bounded = (name: string, value: number, minimum: number, maximum: number, integer = false): number => {
  if (!Number.isFinite(value) || value < minimum || value > maximum || (integer && !Number.isInteger(value))) {
    throw new RangeError(`${name} must be finite and between ${minimum} and ${maximum}`)
  }
  return value
}

export const normalizeForecastState = normalizeCurrentForecastState

const canonicalJson = (value: CurrentForecastState): string => JSON.stringify(value)
const recordState = (state: CurrentForecastState): Exclude<JsonValue, null> => state as unknown as Exclude<JsonValue, null>

export const stateHash = (state: unknown): string => sha256Hex(canonicalJson(normalizeForecastState(state)))

export const createIdempotencyKey = (job: ForecastJob): string => {
  const gameId = job.gameId.trim()
  const eventId = job.providerEventId.trim()
  const playId = job.providerPlayId?.trim() || 'event'
  if (!gameId || !eventId) throw new Error('Forecast identity requires game and provider event IDs')
  const encode = (value: string): string => `${value.length}:${value}`
  return `${encode(gameId)}|${encode(eventId)}|${encode(playId)}|${encode(stateHash(job.state))}`
}

export const normalizeForecastJob = (job: ForecastJob): NormalizedForecastJob => {
  const state = normalizeForecastState(job.state)
  const normalized = { ...job, gameId: job.gameId.trim(), providerEventId: job.providerEventId.trim(), state }
  return {
    ...normalized,
    stateHash: stateHash(state),
    idempotencyKey: createIdempotencyKey(normalized),
  }
}

const errorMetadata = (error: unknown): ForecastErrorMetadata => {
  if (error instanceof APITimeoutError) return { code: 'TIMEOUT', retryable: true }
  if (error instanceof APIError) {
    if (error.status === 429) return { code: 'PROVIDER_429', providerStatus: 429, retryable: true }
    if (error.status === 529) return { code: 'PROVIDER_529', providerStatus: 529, retryable: true }
    return { code: `PROVIDER_${error.status}`, providerStatus: error.status, retryable: error.status >= 500 }
  }
  if (error instanceof APIConnectionError) return { code: 'CONNECTION', retryable: true }
  if (error instanceof TypeSafeError || error instanceof TypeSafeConfigurationError) return { code: 'CONFIGURATION', retryable: false }
  if (error instanceof Error && error.message.includes('Choice')) return { code: 'MALFORMED_RESPONSE', retryable: false }
  return { code: 'PROVIDER_ERROR', retryable: false }
}

const nowIso = (nowMs: number): string => new Date(nowMs).toISOString()

const answerRecordFields = (answer: ChoiceAnswer): Pick<ForecastRecord, 'choice' | 'probabilities' | 'confidence'> => ({
  choice: answer.choice,
  probabilities: { ...answer.probabilities },
  confidence: answer.confidence,
})

const asProviderRequest = (job: NormalizedForecastJob) => ({
  state: job.state,
  idempotencyKey: job.idempotencyKey,
})

export class ReplayMissError extends Error {
  constructor() {
    super('No replay forecast exists for this idempotency key')
    this.name = 'ReplayMissError'
  }
}

export class BusyForecastClaimError extends Error {
  constructor() {
    super('Forecast key is already claimed by another worker')
    this.name = 'BusyForecastClaimError'
  }
}

export class ReplayForecastProvider implements JevProvider {
  private readonly records: ReadonlyMap<string, ForecastRecord>

  constructor(records: readonly ForecastRecord[]) {
    this.records = new Map(records.map((record) => [record.idempotencyKey, record]))
  }

  async forecast(request: { idempotencyKey: string }): Promise<JevProviderResult> {
    const record = this.records.get(request.idempotencyKey)
    if (!record?.choice || !record.probabilities || record.confidence === undefined) throw new ReplayMissError()
    return {
      model: record.model,
      answer: {
        type: 'choice',
        choice: record.choice,
        probabilities: { ...record.probabilities },
        confidence: record.confidence,
      },
    }
  }
}

export class DeterministicMockForecastProvider implements JevProvider {
  async forecast(request: { state: CurrentForecastState }): Promise<JevProviderResult> {
    const firstByte = Number.parseInt(sha256Hex(canonicalJson(request.state)).slice(0, 2), 16)
    const home = 0.4 + (firstByte % 20) / 100
    const away = 0.5 - (firstByte % 20) / 100
    const tie = 0.1
    const choice = home >= away ? 'home' : 'away'
    const confidence = Math.max(home, away)
    return {
      model: JEV_MODEL,
      answer: { type: 'choice', choice, probabilities: { home, away, tie }, confidence },
    }
  }
}

export interface ForecastWorkerOptions {
  mode?: ForecastMode
  provider?: JevProvider
  mockProvider?: JevProvider
  replayProvider?: JevProvider
  store?: ForecastStore
  now?: () => number
  limits?: Partial<ForecastLimits>
  /** Defaults to the normalized job gameId; all workers must share this scope/store. */
  budgetScope?: string
}

export interface ForecastResult {
  record: ForecastRecord
  cacheHit: boolean
}

export class ForecastWorker {
  private readonly mode: ForecastMode
  private readonly provider?: JevProvider
  private readonly mockProvider: JevProvider
  private readonly replayProvider?: JevProvider
  private readonly store: ForecastStore
  private readonly now: () => number
  private readonly limits: ForecastLimits
  private readonly budgetScope?: string
  private lastAttemptAt?: number
  private readonly inFlight = new Map<string, Promise<ForecastResult>>()
  private readonly claimOwnerToken = randomUUID()

  constructor(options: ForecastWorkerOptions = {}) {
    this.mode = options.mode ?? 'live'
    this.provider = options.provider
    this.mockProvider = options.mockProvider ?? new DeterministicMockForecastProvider()
    this.replayProvider = options.replayProvider
    this.store = options.store ?? new InMemoryForecastStore()
    this.now = options.now ?? Date.now
    this.budgetScope = options.budgetScope?.trim() || undefined
    const candidate = { ...DEFAULT_FORECAST_LIMITS, ...options.limits }
    this.limits = {
      cadenceMs: bounded('cadenceMs', candidate.cadenceMs, 0, 86_400_000),
      rateWindowMs: bounded('rateWindowMs', candidate.rateWindowMs, 1, 86_400_000),
      maxRequestsPerWindow: bounded('maxRequestsPerWindow', candidate.maxRequestsPerWindow, 1, 10_000, true),
      maxRequests: bounded('maxRequests', candidate.maxRequests, 1, 100_000, true),
      maxSpendCents: bounded('maxSpendCents', candidate.maxSpendCents, 0, 1_000_000),
      estimatedCostCentsPerRequest: bounded('estimatedCostCentsPerRequest', candidate.estimatedCostCentsPerRequest, 0, 1_000_000),
      claimLeaseMs: bounded('claimLeaseMs', candidate.claimLeaseMs, 1_000, 86_400_000),
    }
  }

  async forecast(input: ForecastJob): Promise<ForecastResult> {
    const job = normalizeForecastJob(input)
    const cached = await this.store.get(job.idempotencyKey)
    if (cached) return { record: cached, cacheHit: true }

    const pending = this.inFlight.get(job.idempotencyKey)
    if (pending) {
      const result = await pending
      return { record: result.record, cacheHit: true }
    }

    // Register before the first asynchronous claim boundary so same-process
    // duplicate callers still coalesce while cross-worker callers fail closed.
    const execution = this.runClaimedForecast(job)
    this.inFlight.set(job.idempotencyKey, execution)
    try {
      return await execution
    } finally {
      if (this.inFlight.get(job.idempotencyKey) === execution) this.inFlight.delete(job.idempotencyKey)
    }
  }

  private async runClaimedForecast(job: NormalizedForecastJob): Promise<ForecastResult> {
    const claim = await this.store.claimForecast(job.idempotencyKey, this.claimOwnerToken, this.now(), this.limits.claimLeaseMs)
    if (claim.status === 'existing') return { record: claim.record, cacheHit: true }
    if (claim.status === 'busy') throw new BusyForecastClaimError()

    let claimFinalized = false
    try {
      const result = await this.executeForecast(job)
      claimFinalized = true
      return result
    } finally {
      // Never release ownership after a provider call if the record was not
      // durably finalized. Releasing here would permit a duplicate paid retry.
      if (claimFinalized) await this.store.releaseForecastClaim(job.idempotencyKey, this.claimOwnerToken)
    }
  }

  private async executeForecast(job: NormalizedForecastJob): Promise<ForecastResult> {
    const currentTime = this.now()
    const requestedAt = nowIso(currentTime)
    if (this.mode !== 'live') {
      const limited = this.limitNonLiveRecord(job, currentTime)
      if (limited) return { record: await this.persistRecord(limited), cacheHit: false }
      this.lastAttemptAt = currentTime
    }
    const reservation = this.mode === 'live' ? await this.reserveBudget(job, currentTime) : undefined
    if (reservation && reservation.status === 'limited') {
      return { record: await this.persistRecord(this.limitedRecord(job, currentTime, reservation.code)), cacheHit: false }
    }
    const budgetReservation = reservation?.status === 'reserved' ? reservation.reservation : undefined
    let providerInvoked = false
    let budgetSettled = false
    const settleBudget = async (outcome: 'consumed' | 'released'): Promise<void> => {
      if (!budgetReservation || budgetSettled) return
      budgetSettled = true
      await this.store.settleForecastBudget({
        budgetScope: budgetReservation.budgetScope,
        reservationId: budgetReservation.reservationId,
        ownerToken: budgetReservation.ownerToken,
        outcome,
      })
    }
    const startedAt = currentTime
    try {
      const provider = this.resolveProvider()
      providerInvoked = true
      const result = await provider.forecast(asProviderRequest(job))
      await settleBudget('consumed')
      const completedAtMs = this.now()
      const record: ForecastRecord = {
        idempotencyKey: job.idempotencyKey,
        gameId: job.gameId,
        providerEventId: job.providerEventId,
        ...(job.providerPlayId ? { providerPlayId: job.providerPlayId } : {}),
        stateHash: job.stateHash,
        rawNormalizedState: recordState(job.state),
        model: result.model || JEV_MODEL,
        status: 'success',
        source: this.mode,
        requestedAt,
        completedAt: nowIso(completedAtMs),
        latencyMs: Math.max(0, completedAtMs - startedAt),
        ...answerRecordFields(result.answer),
      }
      const persisted = await this.persistRecord(record)
      return { record: persisted, cacheHit: persisted !== record }
    } catch (error) {
      try {
        await settleBudget(providerInvoked ? 'consumed' : 'released')
      } catch {
        // Keep an unsettled reservation fail-closed if the durable boundary is unavailable.
      }
      const completedAtMs = this.now()
      const record: ForecastRecord = {
          idempotencyKey: job.idempotencyKey,
          gameId: job.gameId,
          providerEventId: job.providerEventId,
          ...(job.providerPlayId ? { providerPlayId: job.providerPlayId } : {}),
          stateHash: job.stateHash,
          rawNormalizedState: recordState(job.state),
          model: JEV_MODEL,
          status: 'error',
          source: this.mode,
          requestedAt,
          completedAt: nowIso(completedAtMs),
          latencyMs: Math.max(0, completedAtMs - startedAt),
          error: errorMetadata(error),
      }
      const persisted = await this.persistRecord(record)
      return {
        record: persisted,
        cacheHit: persisted !== record,
      }
    }
  }

  private resolveProvider(): JevProvider {
    if (this.mode === 'mock') return this.mockProvider
    if (this.mode === 'replay') {
      if (!this.replayProvider) throw new ReplayMissError()
      return this.replayProvider
    }
    return this.provider ?? new TypeSafeJevProvider()
  }

  private async persistRecord(record: ForecastRecord): Promise<ForecastRecord> {
    return await this.store.putIfAbsent(record)
  }

  private async reserveBudget(job: NormalizedForecastJob, currentTime: number) {
    return await this.store.reserveForecastBudget({
      budgetScope: this.budgetScope ?? job.gameId,
      reservationId: randomUUID(),
      ownerToken: this.claimOwnerToken,
      nowMs: currentTime,
      cadenceMs: this.limits.cadenceMs,
      rateWindowMs: this.limits.rateWindowMs,
      maxRequestsPerWindow: this.limits.maxRequestsPerWindow,
      maxRequests: this.limits.maxRequests,
      maxSpendCents: this.limits.maxSpendCents,
      estimatedCostCentsPerRequest: this.limits.estimatedCostCentsPerRequest,
    })
  }

  private limitNonLiveRecord(job: NormalizedForecastJob, currentTime: number): ForecastRecord | undefined {
    if (this.lastAttemptAt !== undefined && currentTime - this.lastAttemptAt < this.limits.cadenceMs) {
      return this.limitedRecord(job, currentTime, 'CADENCE_LIMIT')
    }
    return undefined
  }

  private limitedRecord(job: NormalizedForecastJob, currentTime: number, code: string): ForecastRecord {
    return {
      idempotencyKey: job.idempotencyKey,
      gameId: job.gameId,
      providerEventId: job.providerEventId,
      ...(job.providerPlayId ? { providerPlayId: job.providerPlayId } : {}),
      stateHash: job.stateHash,
      rawNormalizedState: recordState(job.state),
      model: JEV_MODEL,
      status: 'limited',
      source: this.mode,
      requestedAt: nowIso(currentTime),
      completedAt: nowIso(currentTime),
      latencyMs: 0,
      error: { code, retryable: false },
    }
  }
}
