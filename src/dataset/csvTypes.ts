export const CSV_MAX_BYTES = 5 * 1024 * 1024
export const CSV_MAX_ROWS = 5_000
export const CSV_MAX_COLUMNS = 100
export const CSV_MAX_CELL_LENGTH = 8_192
export const CSV_PREVIEW_ROWS = 8
export const CSV_MAX_HEADER_LENGTH = 200

export type DatasetSourceType = 'fixture' | 'upload' | 'public_url'
export type DatasetColumnType = 'string' | 'number' | 'boolean' | 'empty'

export type AnalysisRowValue = string | number | boolean | null
export type AnalysisRowInput = Record<string, AnalysisRowValue>

export interface DatasetColumn {
  name: string
  normalizedName: string
  inferredType: DatasetColumnType
}

export interface ParsedCsv {
  delimiter: string
  encoding: 'utf-8'
  byteSize: number
  header: string[]
  rows: string[][]
}

export interface DatasetValidationError {
  code:
    | 'CSV_TOO_LARGE'
    | 'NOT_CSV'
    | 'CSV_PARSE_FAILED'
    | 'CSV_EMPTY'
    | 'CSV_TOO_MANY_ROWS'
    | 'CSV_TOO_MANY_COLUMNS'
    | 'CSV_INVALID_HEADER'
    | 'URL_NOT_PUBLIC'
    | 'URL_NOT_HTTPS'
    | 'URL_TIMEOUT'
    | 'URL_NOT_FOUND'
    | 'URL_FETCH_FAILED'
    | 'URL_UNSAFE'
    | 'UPLOADTHING_NOT_CONFIGURED'
    | 'UPLOADTHING_FAILED'
    | 'DATASET_NOT_FOUND'
    | 'DATASET_INTAKE_UNAVAILABLE'
  message: string
}

export type DatasetFailure =
  | 'TOKEN_MISSING_APP_REGION'
  | 'INGEST_HTTP'
  | 'INGEST_RUNTIME'
  | 'CONVEX_PUT_FAILED'
  | 'UNCAUGHT'

export class DatasetError extends Error {
  readonly code: DatasetValidationError['code']
  readonly statusCode: number
  readonly failure?: DatasetFailure
  readonly cause?: unknown

  constructor(code: DatasetValidationError['code'], message: string, statusCode = 400, failure?: DatasetFailure, cause?: unknown) {
    super(message)
    this.name = 'DatasetError'
    this.code = code
    this.statusCode = statusCode
    if (failure) this.failure = failure
    if (cause !== undefined) this.cause = cause
  }
}

export interface ValidatedDataset {
  delimiter: string
  encoding: 'utf-8'
  byteSize: number
  columns: DatasetColumn[]
  acceptedRowCount: number
  rows: AnalysisRowInput[]
  previewRows: AnalysisRowInput[]
  validationWarnings: string[]
  contentHash?: string
}

export const DATASET_ERROR_COPY: Record<string, string> = {
  CSV_TOO_LARGE: 'This file is too big. Maximum size is 5 MB.',
  NOT_CSV: 'That does not look like a CSV.',
  CSV_PARSE_FAILED: 'The CSV could not be parsed.',
  CSV_EMPTY: 'The CSV has no data rows.',
  CSV_TOO_MANY_ROWS: 'This CSV has too many rows. Maximum is 5,000 accepted rows.',
  CSV_TOO_MANY_COLUMNS: 'This CSV has too many columns. Maximum is 100.',
  CSV_INVALID_HEADER: 'The CSV header is missing, duplicated, or invalid.',
  URL_NOT_PUBLIC: 'The URL is not a public HTTPS CSV link.',
  URL_NOT_HTTPS: 'Use an HTTPS CSV URL.',
  URL_TIMEOUT: 'The CSV URL timed out.',
  URL_NOT_FOUND: 'That CSV URL was not found.',
  URL_FETCH_FAILED: 'Could not fetch that CSV URL.',
  URL_UNSAFE: 'That URL is not a public CSV link.',
  UPLOADTHING_NOT_CONFIGURED: 'Could not upload this CSV.',
  UPLOADTHING_FAILED: 'Could not upload this CSV.',
  DATASET_UNAVAILABLE: 'Could not use this CSV.',
  ANALYSIS_STORAGE_NOT_CONFIGURED: 'Could not use this CSV.',
  DATASET_NOT_FOUND: 'That dataset was not found.',
  INVALID_DATASET: 'Choose a sample dataset, upload a CSV, or paste a public CSV URL.',
  DATASET_INTAKE_UNAVAILABLE: 'Could not use this CSV.',
}

export const plainDatasetError = (code: string, fallback = 'Could not use this dataset'): string => {
  return DATASET_ERROR_COPY[code] ?? fallback
}

export const PUBLIC_DATA_WARNING = 'This playground publishes datasets and results. Do not upload secrets or personal data.'
