import type {
  AnalysisRowInput,
  DatasetColumn,
  DatasetSourceType,
} from '../dataset/csvTypes.js'

export type { AnalysisRowInput, DatasetColumn, DatasetSourceType } from '../dataset/csvTypes.js'
export {
  CSV_MAX_BYTES,
  CSV_MAX_COLUMNS,
  CSV_MAX_ROWS,
  CSV_PREVIEW_ROWS,
  DATASET_ERROR_COPY,
  PUBLIC_DATA_WARNING,
  plainDatasetError,
} from '../dataset/csvTypes.js'

export interface DatasetAttribution {
  disclosure: string
  sourceUrl: string
  licenseUrl: string
}

export interface DatasetPreview {
  datasetId: string
  sourceType: DatasetSourceType
  displayName: string
  byteSize: number
  contentHash: string
  encoding: 'utf-8'
  delimiter: string
  columns: DatasetColumn[]
  acceptedRowCount: number
  previewRows: AnalysisRowInput[]
  validationWarnings: string[]
  publicDataWarning: string
  attribution?: DatasetAttribution
}

export interface DatasetRecord extends DatasetPreview {
  blobKey?: string
  sourceUrl?: string
  fixtureKey?: string
  visibility: 'published'
  createdAt: number
  publishedAt?: number
}

export interface DatasetBrowseItem {
  datasetId: string
  displayName: string
  sourceType: DatasetSourceType
  acceptedRowCount: number
  createdAt: number
}

export interface AnalysisBrowseItem {
  analysisId: string
  datasetId: string
  title: string
  status: string
  completedRows: number
  totalRows: number
  createdAt: string
}

export interface DatasetIntakeStatus {
  convex: boolean
  uploadThing: boolean
  sampleAvailable: true
  /** Present when durable storage env is incomplete. Names only, never values. */
  missingEnv?: readonly string[]
}

export const asAnalysisRow = (row: object): AnalysisRowInput => {
  const result: AnalysisRowInput = {}
  for (const [key, value] of Object.entries(row)) {
    if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') result[key] = value
    else if (value !== undefined) result[key] = String(value)
  }
  return result
}
