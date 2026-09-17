import type { FootballModelInput } from '../fixtures/footballTimeline'

export const ANALYSIS_MAX_CALLS = 5_000
export const ANALYSIS_MAX_ROWS = 5_000
export const ANALYSIS_MAX_QUERY_LENGTH = 20_000
export const ANALYSIS_MAX_TASK_LENGTH = 2_000
export const ANALYSIS_CLASS_NAMES = ['K.Walker', 'C.Kupp', 'J.Smith-Njigba', 'Other/Tie'] as const

export type AnalysisClassName = typeof ANALYSIS_CLASS_NAMES[number]
export type AnalysisStatus = 'queued' | 'running' | 'complete' | 'error'

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
  input: FootballModelInput
  model: string
  selectedClass?: string
  probabilities?: Record<string, number>
  confidence?: number
  error?: { code: string; retryable: boolean }
}

export interface AnalysisSnapshot {
  analysisId: string
  fixtureId: string
  query: string
  status: AnalysisStatus
  createdAt: string
  updatedAt: string
  progress: AnalysisProgress
  currentFixtureRow?: { rowIndex: number; input: FootballModelInput }
  resultRows: readonly AnalysisResultRow[]
  error?: { code: string; retryable: boolean }
}

export interface AnalysisDraftInput {
  fixtureId: string
  task: string
}

export interface AnalysisDraftResult {
  fixtureId: string
  query: string
  metadata: {
    provider: string
    model: string
    rowCount: number
    inputHalf: 'H1'
    labelHalf: 'H2'
    classes: readonly string[]
  }
}

export interface AnalysisStartInput {
  fixtureId: string
  query: string
  analysisId?: string
}

export interface AnalysisStorage {
  get(analysisId: string): Promise<AnalysisSnapshot | undefined> | AnalysisSnapshot | undefined
  put(snapshot: AnalysisSnapshot): Promise<void> | void
}

export const cloneAnalysisSnapshot = (snapshot: AnalysisSnapshot): AnalysisSnapshot => JSON.parse(JSON.stringify({
  ...snapshot,
  resultRows: [...snapshot.resultRows].sort((left, right) => left.rowIndex - right.rowIndex),
})) as AnalysisSnapshot

export const serializeAnalysisSnapshot = (snapshot: AnalysisSnapshot): string => JSON.stringify(cloneAnalysisSnapshot(snapshot))
