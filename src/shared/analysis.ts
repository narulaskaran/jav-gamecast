import type { FootballModelInput } from '../fixtures/footballTimeline'
import type { AnalysisRowInput, DatasetSourceType } from './dataset'

export const ANALYSIS_MAX_CALLS = 5_000
export const ANALYSIS_MAX_ROWS = 5_000
export const ANALYSIS_MAX_CLASSES = 32
export const ANALYSIS_MAX_CLASS_LENGTH = 80
export const ANALYSIS_MAX_QUERY_LENGTH = 20_000
export const ANALYSIS_MAX_TASK_LENGTH = 2_000
export const ANALYSIS_RUN_LEASE_MS = 5 * 60_000
export const ANALYSIS_STALE_AFTER_MS = 15 * 60_000
export const ANALYSIS_CLASS_NAMES = ['K.Walker', 'C.Kupp', 'J.Smith-Njigba', 'Other/Tie'] as const

export type AnalysisClassName = typeof ANALYSIS_CLASS_NAMES[number]
export type AnalysisStatus = 'queued' | 'running' | 'complete' | 'error'
export type { AnalysisRowInput, DatasetSourceType }

export interface AnalysisProgress {
  completedRows: number
  totalRows: number
  completedCalls: number
  totalCalls: number
}

export interface AnalysisClassification {
  model: string
  selectedClass: string
  probabilities: Record<string, number>
  confidence?: number
}

export interface AnalysisResultRow {
  rowIndex: number
  input: AnalysisRowInput
  model: string
  selectedClass?: string
  probabilities?: Record<string, number>
  confidence?: number
  error?: { code: string; retryable: boolean }
}

export interface AnalysisSnapshot {
  analysisId: string
  fixtureId: string
  datasetId: string
  sourceType: DatasetSourceType
  query: string
  status: AnalysisStatus
  createdAt: string
  updatedAt: string
  progress: AnalysisProgress
  classes: readonly string[]
  columns: readonly string[]
  currentFixtureRow?: { rowIndex: number; input: AnalysisRowInput }
  resultRows: readonly AnalysisResultRow[]
  error?: { code: string; retryable: boolean }
}

export interface AnalysisDraftInput {
  fixtureId?: string
  datasetId?: string
  task: string
}

export interface AnalysisDraftResult {
  fixtureId: string
  datasetId: string
  sourceType: DatasetSourceType
  query: string
  metadata: {
    provider: string
    model: string
    rowCount: number
    classes: readonly string[]
    columns: readonly string[]
    displayName: string
    inputHalf?: 'H1'
    labelHalf?: 'H2'
  }
}

export interface AnalysisStartInput {
  fixtureId?: string
  datasetId?: string
  query: string
  analysisId?: string
  classes?: readonly string[]
}

export interface AnalysisStorage {
  get(analysisId: string): Promise<AnalysisSnapshot | undefined> | AnalysisSnapshot | undefined
  put(snapshot: AnalysisSnapshot): Promise<void> | void
  getPublic?(analysisId: string): Promise<AnalysisSnapshot | undefined> | AnalysisSnapshot | undefined
  claim?(analysisId: string, ownerToken: string, nowMs: number, leaseMs: number): Promise<'claimed' | 'busy' | 'complete' | 'missing'> | 'claimed' | 'busy' | 'complete' | 'missing'
  release?(analysisId: string, ownerToken: string): Promise<void> | void
}

export const cloneAnalysisSnapshot = (snapshot: AnalysisSnapshot): AnalysisSnapshot => JSON.parse(JSON.stringify({
  ...snapshot,
  resultRows: [...snapshot.resultRows].sort((left, right) => left.rowIndex - right.rowIndex),
})) as AnalysisSnapshot

export const serializeAnalysisSnapshot = (snapshot: AnalysisSnapshot): string => JSON.stringify(cloneAnalysisSnapshot(snapshot))

export const normalizeSnapshot = (snapshot: AnalysisSnapshot): AnalysisSnapshot => {
  const datasetId = snapshot.datasetId || snapshot.fixtureId
  return {
    ...snapshot,
    datasetId,
    fixtureId: snapshot.fixtureId || datasetId,
    sourceType: snapshot.sourceType ?? 'fixture',
    classes: snapshot.classes && snapshot.classes.length > 0 ? snapshot.classes : [...ANALYSIS_CLASS_NAMES],
    columns: snapshot.columns ?? [],
  }
}

export type { FootballModelInput }
