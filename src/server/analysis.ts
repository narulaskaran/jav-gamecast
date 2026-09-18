import { randomUUID } from 'node:crypto'
import {
  ANALYSIS_MAX_CALLS,
  ANALYSIS_MAX_CLASSES,
  ANALYSIS_MAX_CLASS_LENGTH,
  ANALYSIS_MAX_QUERY_LENGTH,
  ANALYSIS_MAX_ROWS,
  ANALYSIS_MAX_TASK_LENGTH,
  ANALYSIS_RUN_LEASE_MS,
  ANALYSIS_STALE_AFTER_MS,
  cloneAnalysisSnapshot,
  normalizeSnapshot,
  type AnalysisClassification,
  type AnalysisDraftInput,
  type AnalysisDraftResult,
  type AnalysisRowInput,
  type AnalysisResultRow,
  type AnalysisSnapshot,
  type AnalysisStartInput,
  type AnalysisStorage,
  type DatasetSourceType,
  type JevQuestionKind,
} from '../shared/analysis.js'
import {
  fixtureAnalysisSliceFor,
  inferQuestionKind,
  isFixturePlayerClassList,
  isSampleDefaultWinTask,
  classesFromLabelColumns,
  mergeClassLists,
  resolveDraftedQuery,
  SAMPLE_WIN_NOUL_QUERY,
  userAskedForFixturePlayers,
  type FixtureAnalysisSlice,
} from '../shared/questionKind.js'
import { analysisContentKey, analysisContentKeyFromSnapshot } from './analysisContentKey.js'
import {
  buildJevQuery,
  classesFromJevQuery,
  parseJevQueryJson,
  stringifyJevQuery,
} from '../shared/jevQuery.js'
import { asAnalysisRow } from '../shared/dataset.js'
import { SAMPLE_DATASET_NAME } from '../shared/sampleDatasetName.js'
import {
  FOOTBALL_FIXTURE_ID,
  footballFixture,
  footballFixtureModelInputFields,
  footballFixtureWinLikelihoodInputFields,
  getHalftimeModelInput,
  getWinLikelihoodModelInput,
} from '../fixtures/footballTimeline.js'

export type { AnalysisClassification, AnalysisDraftInput, AnalysisDraftResult, AnalysisResultRow, AnalysisSnapshot, AnalysisStartInput, AnalysisStorage } from '../shared/analysis.js'
export { ANALYSIS_CLASS_NAMES, ANALYSIS_MAX_CALLS, ANALYSIS_MAX_QUERY_LENGTH, ANALYSIS_MAX_ROWS, ANALYSIS_MAX_TASK_LENGTH } from '../shared/analysis.js'

/** Bounded Jev pool size. Large BYOD runs overlap classify with Convex puts. */
export const ANALYSIS_CLASSIFY_CONCURRENCY = 6

export interface ResolvedAnalysisDataset {
  datasetId: string
  fixtureId: string
  sourceType: DatasetSourceType
  displayName: string
  columns: readonly string[]
  rows: readonly AnalysisRowInput[]
  classes?: readonly string[]
}

export interface AnalysisDatasetSource {
  get(datasetId: string): Promise<ResolvedAnalysisDataset | undefined> | ResolvedAnalysisDataset | undefined
}

export interface AnalysisDraftProvider {
  draft(input: {
    fixtureId: string
    datasetId: string
    task: string
    classes?: readonly string[]
    columns?: readonly string[]
    sampleRows?: AnalysisRowInput[]
    sourceType?: DatasetSourceType
    questionKindHint?: JevQuestionKind
  }): Promise<{ query: string; model: string; classes?: readonly string[]; questionKind?: JevQuestionKind }>
}

export interface AnalysisClassifier {
  assertConfigured?: () => void
  classify(input: {
    analysisId: string
    fixtureId: string
    datasetId: string
    query: string
    rowIndex: number
    row: AnalysisRowInput
    classes: readonly string[]
    questionKind?: JevQuestionKind
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
    return snapshot ? cloneAnalysisSnapshot(normalizeSnapshot(snapshot)) : undefined
  }

  put(snapshot: AnalysisSnapshot): void {
    this.snapshots.set(snapshot.analysisId, cloneAnalysisSnapshot(normalizeSnapshot(snapshot)))
  }

  findCompleteByContentKey(contentKey: string): AnalysisSnapshot | undefined {
    let latest: AnalysisSnapshot | undefined
    for (const snapshot of this.snapshots.values()) {
      if (snapshot.status !== 'complete') continue
      if (analysisContentKeyFromSnapshot(snapshot) !== contentKey) continue
      if (!latest || snapshot.updatedAt > latest.updatedAt) latest = snapshot
    }
    return latest ? cloneAnalysisSnapshot(normalizeSnapshot(latest)) : undefined
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

export const fixtureAnalysisDataset = (slice: FixtureAnalysisSlice = 'win-likelihood'): ResolvedAnalysisDataset => {
  const winLikelihood = slice === 'win-likelihood'
  const rows = (winLikelihood ? getWinLikelihoodModelInput(footballFixture) : getHalftimeModelInput(footballFixture))
    .map((row) => asAnalysisRow(row))
  return {
    datasetId: FOOTBALL_FIXTURE_ID,
    fixtureId: FOOTBALL_FIXTURE_ID,
    sourceType: 'fixture',
    displayName: SAMPLE_DATASET_NAME,
    columns: [...(winLikelihood ? footballFixtureWinLikelihoodInputFields : footballFixtureModelInputFields)],
    rows,
  }
}

export class InMemoryDatasetSource implements AnalysisDatasetSource {
  private readonly datasets = new Map<string, ResolvedAnalysisDataset>()

  constructor(seed: readonly ResolvedAnalysisDataset[] = []) {
    for (const dataset of seed) this.datasets.set(dataset.datasetId, dataset)
  }

  put(dataset: ResolvedAnalysisDataset): void {
    this.datasets.set(dataset.datasetId, dataset)
  }

  get(datasetId: string): ResolvedAnalysisDataset | undefined {
    if (datasetId === FOOTBALL_FIXTURE_ID) return fixtureAnalysisDataset(fixtureAnalysisSliceFor())
    return this.datasets.get(datasetId)
  }
}

export interface AnalysisServiceOptions {
  store: AnalysisStorage
  classifier: AnalysisClassifier
  draftProvider: AnalysisDraftProvider
  datasets?: AnalysisDatasetSource
  now?: () => number
  idFactory?: () => string
  /** Override Jev pool size (clamped 1–8). Default `ANALYSIS_CLASSIFY_CONCURRENCY`. */
  classifyConcurrency?: number
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

export const normalizeClasses = (value: unknown, fallback: readonly string[] = []): string[] => {
  const source = Array.isArray(value) ? value : fallback
  const classes = [...new Set(source.map((item) => typeof item === 'string' ? item.trim() : '').filter((item) => item.length > 0 && item.length <= ANALYSIS_MAX_CLASS_LENGTH && !item.includes('\u0000')))]
  if (classes.length === 0) return []
  if (classes.length < 2 || classes.length > ANALYSIS_MAX_CLASSES) throw new AnalysisError('INVALID_CLASSES', 'Query classes must contain between 2 and 32 labels')
  return classes
}

const finiteUnit = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1

const normalizeChoiceClassification = (value: AnalysisClassification, classes: readonly string[]): AnalysisClassification => {
  if (typeof value.selectedClass !== 'string' || !value.selectedClass.trim()) {
    throw new AnalysisError('MALFORMED_PROVIDER_RESPONSE', 'Provider returned an invalid classification', 502)
  }
  if (!isRecord(value.probabilities)) throw new AnalysisError('MALFORMED_PROVIDER_RESPONSE', 'Provider returned no class probabilities', 502)
  const entries = Object.entries(value.probabilities)
  if (entries.length < 2 || entries.length > ANALYSIS_MAX_CLASSES || entries.some(([key, probability]) => !key || typeof probability !== 'number' || !Number.isFinite(probability) || probability < 0 || probability > 1)) {
    throw new AnalysisError('MALFORMED_PROVIDER_RESPONSE', 'Provider returned invalid class probabilities', 502)
  }
  const total = entries.reduce((sum, [, probability]) => sum + probability, 0)
  if (Math.abs(total - 1) > 1e-6 || !Object.prototype.hasOwnProperty.call(value.probabilities, value.selectedClass)) {
    throw new AnalysisError('MALFORMED_PROVIDER_RESPONSE', 'Provider class probabilities are inconsistent', 502)
  }
  if (classes.length >= 2 && !classes.includes(value.selectedClass)) {
    throw new AnalysisError('MALFORMED_PROVIDER_RESPONSE', 'Provider returned a class outside the query', 502)
  }
  if (value.confidence !== undefined && !finiteUnit(value.confidence)) {
    throw new AnalysisError('MALFORMED_PROVIDER_RESPONSE', 'Provider returned invalid confidence', 502)
  }
  return {
    model: value.model.trim().slice(0, 200),
    questionKind: 'choice',
    selectedClass: value.selectedClass.trim().slice(0, ANALYSIS_MAX_CLASS_LENGTH),
    probabilities: Object.fromEntries(entries.map(([key, probability]) => [key.slice(0, ANALYSIS_MAX_CLASS_LENGTH), probability])),
    ...(value.confidence === undefined ? {} : { confidence: value.confidence }),
  }
}

const normalizeClassification = (value: AnalysisClassification, classes: readonly string[], questionKind: JevQuestionKind): AnalysisClassification => {
  if (!isRecord(value) || typeof value.model !== 'string' || !value.model.trim()) {
    throw new AnalysisError('MALFORMED_PROVIDER_RESPONSE', 'Provider returned an invalid classification', 502)
  }
  if (questionKind === 'noul') {
    const noul = typeof value.value === 'number' ? value.value : undefined
    if (!finiteUnit(noul)) throw new AnalysisError('MALFORMED_PROVIDER_RESPONSE', 'Provider returned an invalid noul', 502)
    return { model: value.model.trim().slice(0, 200), questionKind: 'noul', value: noul }
  }
  if (questionKind === 'score') {
    const score = typeof value.value === 'number' ? value.value : undefined
    if (typeof score !== 'number' || !Number.isFinite(score)) throw new AnalysisError('MALFORMED_PROVIDER_RESPONSE', 'Provider returned an invalid score', 502)
    if (value.confidence !== undefined && !finiteUnit(value.confidence)) {
      throw new AnalysisError('MALFORMED_PROVIDER_RESPONSE', 'Provider returned invalid confidence', 502)
    }
    return {
      model: value.model.trim().slice(0, 200),
      questionKind: 'score',
      value: finiteUnit(score) ? score : Math.min(1, Math.max(0, score)),
      ...(value.confidence === undefined ? {} : { confidence: value.confidence }),
      ...(isRecord(value.probabilities) ? { probabilities: value.probabilities } : {}),
    }
  }
  return normalizeChoiceClassification(value, classes)
}

const resultFromClassification = (rowIndex: number, row: AnalysisRowInput, classification: AnalysisClassification): AnalysisResultRow => ({
  rowIndex,
  input: row,
  model: classification.model,
  ...(classification.questionKind ? { questionKind: classification.questionKind } : {}),
  ...(classification.selectedClass ? { selectedClass: classification.selectedClass } : {}),
  ...(classification.probabilities ? { probabilities: { ...classification.probabilities } } : {}),
  ...(classification.confidence === undefined ? {} : { confidence: classification.confidence }),
  ...(classification.value === undefined ? {} : { value: classification.value }),
})

export const consecutiveCompletedRows = (resultRows: readonly Pick<AnalysisResultRow, 'rowIndex'>[]): number => {
  const done = new Set(resultRows.map((row) => row.rowIndex))
  let count = 0
  while (done.has(count)) count += 1
  return count
}

export const pendingRowIndexes = (totalRows: number, resultRows: readonly Pick<AnalysisResultRow, 'rowIndex'>[]): number[] => {
  const done = new Set(resultRows.map((row) => row.rowIndex))
  const pending: number[] = []
  for (let rowIndex = 0; rowIndex < totalRows; rowIndex += 1) {
    if (!done.has(rowIndex)) pending.push(rowIndex)
  }
  return pending
}

const mergeResultRow = (resultRows: readonly AnalysisResultRow[], resultRow: AnalysisResultRow): AnalysisResultRow[] => (
  [...resultRows.filter((item) => item.rowIndex !== resultRow.rowIndex), resultRow].sort((left, right) => left.rowIndex - right.rowIndex)
)

const runningProgress = (resultRows: readonly AnalysisResultRow[], totalRows: number) => ({
  completedRows: resultRows.length,
  totalRows,
  completedCalls: resultRows.length,
  totalCalls: totalRows,
})

const clampClassifyConcurrency = (value: number | undefined): number => {
  const candidate = value ?? ANALYSIS_CLASSIFY_CONCURRENCY
  if (!Number.isFinite(candidate)) return ANALYSIS_CLASSIFY_CONCURRENCY
  return Math.max(1, Math.min(8, Math.trunc(candidate)))
}

const persistError = (error: unknown): AnalysisError => {
  if (error instanceof AnalysisError) return error
  return new AnalysisError('ANALYSIS_STORAGE_ERROR', 'Could not save analysis progress', 503, true)
}

/** One in-flight snapshot put; later enqueues coalesce to the latest snapshot. Classify does not await. */
export const createSnapshotWritePipeline = (put: (snapshot: AnalysisSnapshot) => Promise<void> | void) => {
  let latest: AnalysisSnapshot | undefined
  let loop: Promise<void> | undefined
  let failed: unknown

  const runLoop = async (): Promise<void> => {
    try {
      while (latest !== undefined && failed === undefined) {
        const snapshot = latest
        latest = undefined
        await put(snapshot)
      }
    } catch (error) {
      failed = persistError(error)
    }
  }

  return {
    enqueue(snapshot: AnalysisSnapshot): void {
      if (failed !== undefined) return
      latest = snapshot
      loop = (loop ?? Promise.resolve()).then(runLoop)
    },
    async flush(): Promise<void> {
      await loop
      if (latest !== undefined && failed === undefined) {
        loop = runLoop()
        await loop
      }
      if (failed !== undefined) throw failed
    },
  }
}

const datasetDraftClasses = (dataset: ResolvedAnalysisDataset): string[] => {
  const classes = dataset.classes && dataset.classes.length >= 2 ? [...dataset.classes] : []
  return isFixturePlayerClassList(classes) ? [] : classes
}

export class AnalysisService {
  private readonly now: () => number
  private readonly idFactory: () => string
  private readonly datasets: AnalysisDatasetSource
  private readonly inFlight = new Map<string, Promise<AnalysisSnapshot>>()

  constructor(private readonly options: AnalysisServiceOptions) {
    this.now = options.now ?? Date.now
    this.idFactory = options.idFactory ?? randomUUID
    this.datasets = options.datasets ?? new InMemoryDatasetSource()
  }

  async draft(input: AnalysisDraftInput): Promise<AnalysisDraftResult> {
    const dataset = await this.requireDataset(input)
    if (!validText(input.task, ANALYSIS_MAX_TASK_LENGTH)) throw new AnalysisError('INVALID_TASK', 'Task must be non-empty and within the size limit')
    const task = input.task.trim()
    const datasetClasses = datasetDraftClasses(dataset)
    const questionKindHint = inferQuestionKind(task, datasetClasses)
    if (dataset.sourceType === 'fixture' && isSampleDefaultWinTask(task) && !userAskedForFixturePlayers(task)) {
      return {
        fixtureId: dataset.fixtureId,
        datasetId: dataset.datasetId,
        sourceType: dataset.sourceType,
        query: stringifyJevQuery(buildJevQuery({ type: 'noul', instructions: SAMPLE_WIN_NOUL_QUERY })),
        metadata: {
          provider: 'openrouter',
          model: 'cached-sample-noul',
          rowCount: dataset.rows.length,
          classes: [],
          columns: [...dataset.columns],
          displayName: dataset.displayName,
          questionKind: 'noul',
        },
      }
    }
    const draft = await this.options.draftProvider.draft({
      fixtureId: dataset.fixtureId,
      datasetId: dataset.datasetId,
      task,
      classes: datasetClasses,
      columns: [...dataset.columns],
      sampleRows: dataset.rows.slice(0, 5).map((row) => ({ ...row })),
      sourceType: dataset.sourceType,
      questionKindHint,
    })
    if (!validText(draft.query, ANALYSIS_MAX_QUERY_LENGTH) || typeof draft.model !== 'string' || !draft.model.trim()) {
      throw new AnalysisError('MALFORMED_DRAFT', 'OpenRouter returned an invalid classifier query', 502)
    }
    const parsedDraft = parseJevQueryJson(draft.query)
    const resolved = resolveDraftedQuery({
      task,
      query: parsedDraft?.instructions ?? draft.query,
      questionKind: parsedDraft?.type ?? draft.questionKind ?? questionKindHint,
      classes: parsedDraft && parsedDraft.type !== 'noul' ? classesFromJevQuery(parsedDraft) : draft.classes,
    })
    const recovered = mergeClassLists(
      resolved.classes,
      datasetClasses,
      classesFromLabelColumns(dataset.columns, dataset.rows),
    )
    const questionKind = resolved.questionKind
    let classes: string[] = []
    if (questionKind === 'score') {
      classes = recovered.length >= 2 ? normalizeClasses(recovered) : ['Low', 'Medium', 'High']
    } else if (questionKind === 'choice') {
      if (recovered.length === 1) {
        throw new AnalysisError('INVALID_CLASSES', 'Query classes must contain between 2 and 32 labels')
      }
      if (recovered.length >= 2) classes = normalizeClasses(recovered)
    }
    const parsedCriteriaUsable = parsedDraft?.type === questionKind && (
      parsedDraft.type === 'noul' || classesFromJevQuery(parsedDraft).length >= 2
    )
    return {
      fixtureId: dataset.fixtureId,
      datasetId: dataset.datasetId,
      sourceType: dataset.sourceType,
      query: stringifyJevQuery(buildJevQuery({
        type: questionKind,
        instructions: resolved.query,
        classes,
        criteria: parsedCriteriaUsable ? parsedDraft : undefined,
      })),
      metadata: {
        provider: 'openrouter',
        model: draft.model.trim().slice(0, 200),
        rowCount: dataset.rows.length,
        classes,
        columns: [...dataset.columns],
        displayName: dataset.displayName,
        questionKind,
        ...(dataset.sourceType === 'fixture' && fixtureAnalysisSliceFor({
          task,
          query: resolved.query,
          questionKind,
          classes,
        }) === 'halftime-eval' ? { inputHalf: 'H1' as const, labelHalf: 'H2' as const } : {}),
      },
    }
  }

  async start(input: AnalysisStartInput): Promise<AnalysisSnapshot> {
    const query = this.requireQuery(input.query)
    const parsedQuery = parseJevQueryJson(query)
    const dataset = await this.requireDataset({
      ...input,
      query,
      questionKind: parsedQuery?.type ?? input.questionKind,
    })
    const requestedAnalysisId = input.analysisId === undefined ? undefined : typeof input.analysisId === 'string' ? input.analysisId.trim() : undefined
    if (input.analysisId !== undefined && requestedAnalysisId === undefined) throw new AnalysisError('INVALID_ANALYSIS_ID', 'Analysis ID is invalid')
    const questionKind = parsedQuery?.type ?? inferQuestionKind(query, input.classes ?? dataset.classes ?? [], input.questionKind)
    const lookupClasses = questionKind === 'noul'
      ? []
      : [...(parsedQuery ? classesFromJevQuery(parsedQuery) : input.classes ?? dataset.classes ?? [])]
        .map((item) => typeof item === 'string' ? item.trim() : '')
        .filter(Boolean)
    if (requestedAnalysisId) {
      if (!validText(requestedAnalysisId, 200)) throw new AnalysisError('INVALID_ANALYSIS_ID', 'Analysis ID is invalid')
      const existing = await this.options.store.get(requestedAnalysisId)
      if (existing) return this.resumeExisting(existing, dataset.datasetId, query, input.resume === true)
    }
    if (input.forceNew !== true && (questionKind !== 'choice' || lookupClasses.length >= 2)) {
      // Same datasetId + canonical query is reused for every source (fixture and BYOD).
      const cached = await this.options.store.findCompleteByContentKey(analysisContentKey({
        datasetId: dataset.datasetId,
        query,
        questionKind,
        classes: lookupClasses,
      }))
      if (cached?.status === 'complete') return cloneAnalysisSnapshot(normalizeSnapshot(cached))
    }
    const analysisId = requestedAnalysisId || this.idFactory()
    if (!validText(analysisId, 200)) throw new AnalysisError('INVALID_ANALYSIS_ID', 'Analysis ID is invalid')
    const existing = await this.options.store.get(analysisId)
    if (existing) return this.resumeExisting(existing, dataset.datasetId, query, input.resume === true)
    const classes = questionKind === 'noul' ? [] : normalizeClasses(parsedQuery ? classesFromJevQuery(parsedQuery) : input.classes, dataset.classes ?? [])
    if (questionKind === 'choice' && classes.length < 2) throw new AnalysisError('INVALID_CLASSES', 'Query classes must contain between 2 and 32 labels')
    if (dataset.rows.length > ANALYSIS_MAX_ROWS || dataset.rows.length > ANALYSIS_MAX_CALLS) throw new AnalysisError('ANALYSIS_BOUNDS_EXCEEDED', 'Dataset exceeds analysis bounds', 413)
    this.options.classifier.assertConfigured?.()
    const timestamp = nowIso(this.now)
    const snapshot: AnalysisSnapshot = {
      analysisId,
      fixtureId: dataset.fixtureId,
      datasetId: dataset.datasetId,
      sourceType: dataset.sourceType,
      query,
      status: 'queued',
      createdAt: timestamp,
      updatedAt: timestamp,
      progress: { completedRows: 0, totalRows: dataset.rows.length, completedCalls: 0, totalCalls: dataset.rows.length },
      questionKind,
      classes,
      columns: [...dataset.columns],
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
    return cloneAnalysisSnapshot(normalizeSnapshot(snapshot))
  }

  async share(analysisId: string): Promise<AnalysisSnapshot> {
    const snapshot = await (this.options.store.getPublic?.(analysisId) ?? this.options.store.get(analysisId))
    if (!snapshot) throw new AnalysisError('ANALYSIS_NOT_FOUND', 'Analysis was not found', 404)
    return cloneAnalysisSnapshot(normalizeSnapshot(snapshot))
  }

  private async execute(analysisId: string): Promise<AnalysisSnapshot> {
    const ownerToken = `${analysisId}:${this.idFactory()}`
    const claimed = await this.options.store.claim?.(analysisId, ownerToken, this.now(), ANALYSIS_RUN_LEASE_MS)
    if (claimed === 'missing') throw new AnalysisError('ANALYSIS_NOT_FOUND', 'Analysis was not found', 404)
    if (claimed === 'complete' || claimed === 'busy') return this.get(analysisId)
    const initial = await this.options.store.get(analysisId)
    if (!initial) throw new AnalysisError('ANALYSIS_NOT_FOUND', 'Analysis was not found', 404)
    const snapshot0 = normalizeSnapshot(initial)
    if (snapshot0.status === 'complete' || snapshot0.status === 'error') return cloneAnalysisSnapshot(snapshot0)
    const dataset = await this.requireDataset({
      fixtureId: snapshot0.fixtureId,
      datasetId: snapshot0.datasetId,
      query: snapshot0.query,
      questionKind: snapshot0.questionKind,
      classes: snapshot0.classes,
    })
    const rows = dataset.rows
    const classes = snapshot0.classes
    const questionKind = inferQuestionKind(snapshot0.query, classes, snapshot0.questionKind)
    let snapshot: AnalysisSnapshot = { ...snapshot0, status: 'running', questionKind, updatedAt: nowIso(this.now), resultRows: [...snapshot0.resultRows] }
    await this.options.store.put(snapshot)
    const pipeline = createSnapshotWritePipeline((next) => this.options.store.put(next))
    const persistFinal = async (next: AnalysisSnapshot): Promise<AnalysisSnapshot> => {
      try {
        await pipeline.flush()
      } catch (error) {
        if (next.status !== 'error') throw error
      }
      try {
        await this.options.store.put(next)
      } catch (error) {
        if (next.status === 'error') return cloneAnalysisSnapshot(next)
        throw persistError(error)
      }
      return cloneAnalysisSnapshot(next)
    }
    try {
      const pending = pendingRowIndexes(rows.length, snapshot.resultRows)
      if (pending.length === 0) {
        snapshot = {
          ...snapshot,
          status: 'complete',
          currentFixtureRow: undefined,
          updatedAt: nowIso(this.now),
          progress: { completedRows: rows.length, totalRows: rows.length, completedCalls: rows.length, totalCalls: rows.length },
          error: undefined,
        }
        return await persistFinal(snapshot)
      }
      let resultRows = [...snapshot.resultRows]
      let firstError: unknown
      let stopped = false
      let cursor = 0
      let lastLeaseAt = this.now()
      const concurrency = Math.min(clampClassifyConcurrency(this.options.classifyConcurrency), pending.length)
      const refreshLease = () => {
        const now = this.now()
        if (now - lastLeaseAt < ANALYSIS_RUN_LEASE_MS / 4) return
        lastLeaseAt = now
        void Promise.resolve(this.options.store.claim?.(analysisId, ownerToken, now, ANALYSIS_RUN_LEASE_MS)).catch(() => undefined)
      }
      const applyResult = (resultRow: AnalysisResultRow) => {
        resultRows = mergeResultRow(resultRows, resultRow)
        snapshot = {
          ...snapshot,
          status: 'running',
          currentFixtureRow: undefined,
          updatedAt: nowIso(this.now),
          progress: runningProgress(resultRows, rows.length),
          resultRows,
          error: undefined,
        }
        pipeline.enqueue(snapshot)
        refreshLease()
      }
      const worker = async () => {
        while (!stopped) {
          const next = cursor
          cursor += 1
          if (next >= pending.length) return
          const rowIndex = pending[next]
          if (typeof rowIndex !== 'number') return
          const row = rows[rowIndex]
          if (!row) continue
          try {
            const classification = normalizeClassification(await this.options.classifier.classify({
              analysisId,
              fixtureId: snapshot.fixtureId,
              datasetId: snapshot.datasetId,
              query: snapshot.query,
              rowIndex,
              row,
              classes,
              questionKind,
            }), classes, questionKind)
            applyResult(resultFromClassification(rowIndex, row, classification))
          } catch (error) {
            stopped = true
            if (firstError === undefined) firstError = error
          }
        }
      }
      await Promise.all(Array.from({ length: concurrency }, () => worker()))
      try {
        await pipeline.flush()
      } catch (error) {
        firstError = firstError ?? error
      }
      if (firstError !== undefined) {
        snapshot = {
          ...snapshot,
          status: 'error',
          currentFixtureRow: undefined,
          updatedAt: nowIso(this.now),
          progress: {
            completedRows: consecutiveCompletedRows(resultRows),
            totalRows: rows.length,
            completedCalls: resultRows.length,
            totalCalls: rows.length,
          },
          resultRows,
          error: safeProviderError(firstError),
        }
        return await persistFinal(snapshot)
      }
      snapshot = {
        ...snapshot,
        status: 'complete',
        currentFixtureRow: undefined,
        updatedAt: nowIso(this.now),
        progress: { completedRows: rows.length, totalRows: rows.length, completedCalls: rows.length, totalCalls: rows.length },
        resultRows,
        error: undefined,
      }
      return await persistFinal(snapshot)
    } finally {
      await this.options.store.release?.(analysisId, ownerToken)
    }
  }

  private async resumeExisting(existing: AnalysisSnapshot, datasetId: string, query: string, resume = false): Promise<AnalysisSnapshot> {
    const normalized = normalizeSnapshot(existing)
    if (normalized.datasetId !== datasetId || normalized.query !== query) throw new AnalysisError('ANALYSIS_ID_CONFLICT', 'Analysis ID is already used for another analysis', 409)
    const stale = normalized.status === 'running' && this.now() - Date.parse(normalized.updatedAt) > ANALYSIS_STALE_AFTER_MS
    const retryableFailure = normalized.status === 'error' && (normalized.error?.retryable === true || resume)
    if (stale || retryableFailure) {
      const recovered: AnalysisSnapshot = {
        ...normalized,
        status: 'queued',
        currentFixtureRow: undefined,
        updatedAt: nowIso(this.now),
        error: undefined,
      }
      await this.options.store.put(recovered)
      return cloneAnalysisSnapshot(recovered)
    }
    return cloneAnalysisSnapshot(normalized)
  }

  private async requireDataset(input: {
    fixtureId?: string
    datasetId?: string
    task?: string
    query?: string
    questionKind?: JevQuestionKind
    classes?: readonly string[]
  }): Promise<ResolvedAnalysisDataset> {
    const datasetId = typeof input.datasetId === 'string' && input.datasetId.trim() ? input.datasetId.trim() : typeof input.fixtureId === 'string' && input.fixtureId.trim() ? input.fixtureId.trim() : ''
    if (!datasetId) throw new AnalysisError('INVALID_DATASET', 'Choose a sample dataset, upload a CSV, or paste a public CSV URL')
    if (datasetId === FOOTBALL_FIXTURE_ID || input.fixtureId === FOOTBALL_FIXTURE_ID) {
      return fixtureAnalysisDataset(fixtureAnalysisSliceFor({
        task: input.task,
        query: input.query,
        questionKind: input.questionKind,
        classes: input.classes,
      }))
    }
    const dataset = await this.datasets.get(datasetId)
    if (!dataset) throw new AnalysisError('DATASET_NOT_FOUND', 'Dataset was not found', 404)
    if (dataset.rows.length < 1) throw new AnalysisError('CSV_EMPTY', 'The CSV has no data rows')
    return dataset
  }

  private requireQuery(query: string): string {
    if (!validText(query, ANALYSIS_MAX_QUERY_LENGTH)) throw new AnalysisError('INVALID_QUERY', 'Query must be non-empty and within the size limit')
    return query.trim()
  }
}
