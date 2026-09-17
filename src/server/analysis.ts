import { randomUUID } from 'node:crypto'
import {
  ANALYSIS_CLASS_NAMES,
  ANALYSIS_MAX_CALLS,
  ANALYSIS_MAX_QUERY_LENGTH,
  ANALYSIS_MAX_ROWS,
  ANALYSIS_MAX_TASK_LENGTH,
  ANALYSIS_RUN_LEASE_MS,
  ANALYSIS_STALE_AFTER_MS,
  cloneAnalysisSnapshot,
  type AnalysisClassification,
  type AnalysisDraftInput,
  type AnalysisDraftResult,
  type AnalysisResultRow,
  type AnalysisSnapshot,
  type AnalysisStartInput,
  type AnalysisStorage,
} from '../shared/analysis'
import {
  FOOTBALL_FIXTURE_ID,
  footballFixture,
  getHalftimeModelInput,
  type FootballModelInput,
} from '../fixtures/footballTimeline'

export type { AnalysisClassification, AnalysisDraftInput, AnalysisDraftResult, AnalysisResultRow, AnalysisSnapshot, AnalysisStartInput, AnalysisStorage } from '../shared/analysis'
export { ANALYSIS_CLASS_NAMES, ANALYSIS_MAX_CALLS, ANALYSIS_MAX_QUERY_LENGTH, ANALYSIS_MAX_ROWS, ANALYSIS_MAX_TASK_LENGTH } from '../shared/analysis'

export interface AnalysisDraftProvider {
  draft(input: { fixtureId: string; task: string; classes: readonly string[] }): Promise<{ query: string; model: string }>
}

export interface AnalysisClassifier {
  assertConfigured?: () => void
  classify(input: {
    analysisId: string
    fixtureId: string
    query: string
    rowIndex: number
    row: FootballModelInput
  }): Promise<AnalysisClassification>
}

export class AnalysisError extends Error {
  readonly statusCode: number
  readonly code: string
  readonly retryable: boolean

  constructor(code: string, message: string, statusCode = 400, retryable = false) {
    super(message)
    this.name = 'AnalysisError'
    this.code = code
    this.statusCode = statusCode
    this.retryable = retryable
  }
}

export class InMemoryAnalysisStore implements AnalysisStorage {
  private readonly snapshots = new Map<string, AnalysisSnapshot>()
  private readonly claims = new Map<string, { ownerToken: string; leaseExpiresAt: number }>()

  get(analysisId: string): AnalysisSnapshot | undefined {
    const snapshot = this.snapshots.get(analysisId)
    return snapshot ? cloneAnalysisSnapshot(snapshot) : undefined
  }

  put(snapshot: AnalysisSnapshot): void {
    this.snapshots.set(snapshot.analysisId, cloneAnalysisSnapshot(snapshot))
  }

  getPublic(analysisId: string): AnalysisSnapshot | undefined {
    return this.get(analysisId)
  }

  claim(analysisId: string, ownerToken: string, nowMs: number, leaseMs: number): 'claimed' | 'busy' | 'complete' | 'missing' {
    const snapshot = this.snapshots.get(analysisId)
    if (!snapshot) return 'missing'
    if (snapshot.status === 'complete') return 'complete'
    const current = this.claims.get(analysisId)
    if (current && current.leaseExpiresAt > nowMs && current.ownerToken !== ownerToken) return 'busy'
    this.claims.set(analysisId, { ownerToken, leaseExpiresAt: nowMs + leaseMs })
    return 'claimed'
  }

  release(analysisId: string, ownerToken: string): void {
    if (this.claims.get(analysisId)?.ownerToken === ownerToken) this.claims.delete(analysisId)
  }
}

export interface AnalysisServiceOptions {
  store: AnalysisStorage
  classifier: AnalysisClassifier
  draftProvider: AnalysisDraftProvider
  now?: () => number
  idFactory?: () => string
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const validText = (value: unknown, maximum: number): value is string => typeof value === 'string' && value.trim().length > 0 && value.length <= maximum && !value.includes('\u0000')
const nowIso = (now: () => number): string => new Date(now()).toISOString()

const safeProviderError = (error: unknown): { code: string; retryable: boolean } => {
  if (error instanceof AnalysisError) return { code: error.code, retryable: error.retryable }
  if (isRecord(error) && typeof error.code === 'string' && /^[A-Z0-9_]+$/.test(error.code)) {
    return { code: error.code.slice(0, 64), retryable: error.retryable === true }
  }
  return { code: 'ANALYSIS_PROVIDER_ERROR', retryable: false }
}

const normalizeClassification = (value: AnalysisClassification): AnalysisClassification => {
  if (!isRecord(value) || typeof value.model !== 'string' || !value.model.trim() || typeof value.selectedClass !== 'string' || !value.selectedClass.trim()) {
    throw new AnalysisError('MALFORMED_PROVIDER_RESPONSE', 'Provider returned an invalid classification', 502)
  }
  if (!isRecord(value.probabilities)) throw new AnalysisError('MALFORMED_PROVIDER_RESPONSE', 'Provider returned no class probabilities', 502)
  const entries = Object.entries(value.probabilities)
  if (entries.length < 2 || entries.length > ANALYSIS_CLASS_NAMES.length || entries.some(([key, probability]) => !key || typeof probability !== 'number' || !Number.isFinite(probability) || probability < 0 || probability > 1)) {
    throw new AnalysisError('MALFORMED_PROVIDER_RESPONSE', 'Provider returned invalid class probabilities', 502)
  }
  const total = entries.reduce((sum, [, probability]) => sum + probability, 0)
  if (Math.abs(total - 1) > 1e-6 || !Object.prototype.hasOwnProperty.call(value.probabilities, value.selectedClass)) {
    throw new AnalysisError('MALFORMED_PROVIDER_RESPONSE', 'Provider class probabilities are inconsistent', 502)
  }
  if (value.confidence !== undefined && (typeof value.confidence !== 'number' || !Number.isFinite(value.confidence) || value.confidence < 0 || value.confidence > 1)) {
    throw new AnalysisError('MALFORMED_PROVIDER_RESPONSE', 'Provider returned invalid confidence', 502)
  }
  return {
    model: value.model.trim().slice(0, 200),
    selectedClass: value.selectedClass.trim().slice(0, 200),
    probabilities: Object.fromEntries(entries.map(([key, probability]) => [key.slice(0, 200), probability])),
    ...(value.confidence === undefined ? {} : { confidence: value.confidence }),
  }
}

export class AnalysisService {
  private readonly now: () => number
  private readonly idFactory: () => string
  private readonly inFlight = new Map<string, Promise<AnalysisSnapshot>>()

  constructor(private readonly options: AnalysisServiceOptions) {
    this.now = options.now ?? Date.now
    this.idFactory = options.idFactory ?? randomUUID
  }

  async draft(input: AnalysisDraftInput): Promise<AnalysisDraftResult> {
    this.requireFixture(input.fixtureId)
    if (!validText(input.task, ANALYSIS_MAX_TASK_LENGTH)) throw new AnalysisError('INVALID_TASK', 'Task must be non-empty and within the size limit')
    const rows = getHalftimeModelInput(footballFixture)
    const draft = await this.options.draftProvider.draft({ fixtureId: FOOTBALL_FIXTURE_ID, task: input.task.trim(), classes: ANALYSIS_CLASS_NAMES })
    if (!validText(draft.query, ANALYSIS_MAX_QUERY_LENGTH) || typeof draft.model !== 'string' || !draft.model.trim()) {
      throw new AnalysisError('MALFORMED_DRAFT', 'OpenRouter returned an invalid classifier query', 502)
    }
    return {
      fixtureId: FOOTBALL_FIXTURE_ID,
      query: draft.query.trim(),
      metadata: {
        provider: 'openrouter',
        model: draft.model.trim().slice(0, 200),
        rowCount: rows.length,
        inputHalf: 'H1',
        labelHalf: 'H2',
        classes: [...ANALYSIS_CLASS_NAMES],
      },
    }
  }

  async start(input: AnalysisStartInput): Promise<AnalysisSnapshot> {
    this.requireFixture(input.fixtureId)
    const query = this.requireQuery(input.query)
    const rows = getHalftimeModelInput(footballFixture)
    if (rows.length > ANALYSIS_MAX_ROWS || rows.length > ANALYSIS_MAX_CALLS) throw new AnalysisError('ANALYSIS_BOUNDS_EXCEEDED', 'Fixture exceeds analysis bounds', 413)
    const requestedAnalysisId = input.analysisId === undefined ? undefined : typeof input.analysisId === 'string' ? input.analysisId.trim() : undefined
    if (input.analysisId !== undefined && requestedAnalysisId === undefined) throw new AnalysisError('INVALID_ANALYSIS_ID', 'Analysis ID is invalid')
    const analysisId = requestedAnalysisId || this.idFactory()
    if (!validText(analysisId, 200)) throw new AnalysisError('INVALID_ANALYSIS_ID', 'Analysis ID is invalid')
    const existing = await this.options.store.get(analysisId)
    if (existing) {
      if (existing.fixtureId !== input.fixtureId || existing.query !== query) throw new AnalysisError('ANALYSIS_ID_CONFLICT', 'Analysis ID is already used for another analysis', 409)
      const stale = existing.status === 'running' && this.now() - Date.parse(existing.updatedAt) > ANALYSIS_STALE_AFTER_MS
      const retryableFailure = existing.status === 'error' && existing.error?.retryable === true
      if (stale || retryableFailure) {
        const recovered: AnalysisSnapshot = {
          ...existing,
          status: 'queued',
          currentFixtureRow: undefined,
          updatedAt: nowIso(this.now),
          error: undefined,
        }
        await this.options.store.put(recovered)
        return cloneAnalysisSnapshot(recovered)
      }
      return cloneAnalysisSnapshot(existing)
    }
    this.options.classifier.assertConfigured?.()
    const timestamp = nowIso(this.now)
    const snapshot: AnalysisSnapshot = {
      analysisId,
      fixtureId: FOOTBALL_FIXTURE_ID,
      query,
      status: 'queued',
      createdAt: timestamp,
      updatedAt: timestamp,
      progress: { completedRows: 0, totalRows: rows.length, completedCalls: 0, totalCalls: rows.length },
      resultRows: [],
    }
    await this.options.store.put(snapshot)
    return cloneAnalysisSnapshot(snapshot)
  }

  async run(analysisId: string): Promise<AnalysisSnapshot> {
    const existingRun = this.inFlight.get(analysisId)
    if (existingRun) return existingRun
    const execution = this.execute(analysisId)
    this.inFlight.set(analysisId, execution)
    try {
      return await execution
    } finally {
      if (this.inFlight.get(analysisId) === execution) this.inFlight.delete(analysisId)
    }
  }

  async get(analysisId: string): Promise<AnalysisSnapshot> {
    const snapshot = await this.options.store.get(analysisId)
    if (!snapshot) throw new AnalysisError('ANALYSIS_NOT_FOUND', 'Analysis was not found', 404)
    return cloneAnalysisSnapshot(snapshot)
  }

  async share(analysisId: string): Promise<AnalysisSnapshot> {
    const snapshot = await (this.options.store.getPublic?.(analysisId) ?? this.options.store.get(analysisId))
    if (!snapshot) throw new AnalysisError('ANALYSIS_NOT_FOUND', 'Analysis was not found', 404)
    return cloneAnalysisSnapshot(snapshot)
  }

  private async execute(analysisId: string): Promise<AnalysisSnapshot> {
    const ownerToken = `${analysisId}:${this.idFactory()}`
    const claimed = await this.options.store.claim?.(analysisId, ownerToken, this.now(), ANALYSIS_RUN_LEASE_MS)
    if (claimed === 'missing') throw new AnalysisError('ANALYSIS_NOT_FOUND', 'Analysis was not found', 404)
    if (claimed === 'complete' || claimed === 'busy') return this.get(analysisId)
    const initial = await this.options.store.get(analysisId)
    if (!initial) throw new AnalysisError('ANALYSIS_NOT_FOUND', 'Analysis was not found', 404)
    if (initial.status === 'complete' || initial.status === 'error') return cloneAnalysisSnapshot(initial)
    const rows = getHalftimeModelInput(footballFixture)
    let snapshot: AnalysisSnapshot = { ...initial, status: 'running', updatedAt: nowIso(this.now), resultRows: [...initial.resultRows] }
    await this.options.store.put(snapshot)
    try {
      for (let rowIndex = snapshot.progress.completedRows; rowIndex < rows.length; rowIndex += 1) {
      const row = rows[rowIndex]
      snapshot = { ...snapshot, currentFixtureRow: { rowIndex, input: row }, updatedAt: nowIso(this.now) }
      await this.options.store.put(snapshot)
      try {
        const classification = normalizeClassification(await this.options.classifier.classify({ analysisId, fixtureId: FOOTBALL_FIXTURE_ID, query: snapshot.query, rowIndex, row }))
        const resultRow: AnalysisResultRow = { rowIndex, input: row, model: classification.model, selectedClass: classification.selectedClass, probabilities: { ...classification.probabilities }, ...(classification.confidence === undefined ? {} : { confidence: classification.confidence }) }
        const resultRows = [...snapshot.resultRows.filter((item) => item.rowIndex !== rowIndex), resultRow].sort((left, right) => left.rowIndex - right.rowIndex)
        snapshot = {
          ...snapshot,
          status: 'running',
          currentFixtureRow: rowIndex + 1 < rows.length ? { rowIndex: rowIndex + 1, input: rows[rowIndex + 1] } : undefined,
          updatedAt: nowIso(this.now),
          progress: { completedRows: rowIndex + 1, totalRows: rows.length, completedCalls: rowIndex + 1, totalCalls: rows.length },
          resultRows,
          error: undefined,
        }
        await this.options.store.put(snapshot)
        } catch (error) {
        snapshot = { ...snapshot, status: 'error', currentFixtureRow: undefined, updatedAt: nowIso(this.now), error: safeProviderError(error) }
        await this.options.store.put(snapshot)
          return cloneAnalysisSnapshot(snapshot)
        }
      }
      snapshot = { ...snapshot, status: 'complete', currentFixtureRow: undefined, updatedAt: nowIso(this.now), progress: { completedRows: rows.length, totalRows: rows.length, completedCalls: rows.length, totalCalls: rows.length } }
      await this.options.store.put(snapshot)
      return cloneAnalysisSnapshot(snapshot)
    } finally {
      await this.options.store.release?.(analysisId, ownerToken)
    }
  }

  private requireFixture(fixtureId: string): void {
    if (typeof fixtureId !== 'string' || fixtureId.trim() !== FOOTBALL_FIXTURE_ID) throw new AnalysisError('INVALID_FIXTURE', 'Only the pinned analysis fixture is supported')
  }

  private requireQuery(query: string): string {
    if (!validText(query, ANALYSIS_MAX_QUERY_LENGTH)) throw new AnalysisError('INVALID_QUERY', 'Query must be non-empty and within the size limit')
    return query.trim()
  }
}
