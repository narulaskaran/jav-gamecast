import { DatasetError } from '../dataset/csvTypes.js'
import type { AnalysisRowInput } from '../shared/analysis.js'
import type { DatasetRecord } from '../shared/dataset.js'
import { hashRow } from './datasetStore.js'

/**
 * Build a Convex-safe dataset document: schema fields only, no `undefined`
 * keys, no client-only `publicDataWarning`. ConvexHttpClient skips nested
 * `undefined`, but extra keys and optional empties still need to match the
 * `datasets` table (strict schema) and action return values.
 */
export const omitUndefinedDeep = (value: unknown): unknown => {
  if (value === undefined) return undefined
  if (value === null) return null
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value !== 'object') return value
  if (Array.isArray(value)) {
    return value.map((entry) => {
      const next = omitUndefinedDeep(entry)
      return next === undefined ? null : next
    })
  }
  const result: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(value)) {
    if (entry === undefined) continue
    result[key] = omitUndefinedDeep(entry)
  }
  return result
}

/** Schema fields only — never `publicDataWarning` or other client-only keys. */
export const toConvexDatasetDocument = (dataset: DatasetRecord): Record<string, unknown> => omitUndefinedDeep({
  datasetId: dataset.datasetId,
  sourceType: dataset.sourceType,
  displayName: dataset.displayName,
  fixtureKey: dataset.fixtureKey,
  blobKey: dataset.blobKey,
  sourceUrl: dataset.sourceUrl,
  byteSize: dataset.byteSize,
  contentHash: dataset.contentHash,
  encoding: dataset.encoding,
  delimiter: dataset.delimiter,
  columns: dataset.columns,
  acceptedRowCount: dataset.acceptedRowCount,
  previewRows: dataset.previewRows,
  validationWarnings: dataset.validationWarnings,
  visibility: dataset.visibility,
  createdAt: dataset.createdAt,
  publishedAt: dataset.publishedAt,
}) as Record<string, unknown>

export const toConvexDatasetRows = (rows: readonly AnalysisRowInput[]): Array<{ rowIndex: number; rowHash: string; values: unknown }> => (
  rows.map((values, rowIndex) => ({
    rowIndex,
    rowHash: hashRow(values),
    values: omitUndefinedDeep(values),
  }))
)

export const toConvexDatasetPutArgs = (dataset: DatasetRecord, rows: readonly AnalysisRowInput[]) => ({
  dataset: toConvexDatasetDocument(dataset),
  rows: toConvexDatasetRows(rows),
})

const safeRuntimeName = (error: unknown): string => {
  if (error instanceof Error && /^[A-Za-z][A-Za-z0-9]{0,40}$/.test(error.name)) return error.name
  return 'Error'
}

const convexDetail = (message: string): string => {
  const match = message.match(/Uncaught Error: ([^\n]+)/)
    ?? message.match(/ArgumentValidationError: ([^\n]+)/)
    ?? message.match(/Server Error\s+([^\n]+)/)
  return (match?.[1] ?? message).trim()
}

/** Secret-free reason for CONVEX_PUT_FAILED. Never forwards the raw Convex dump (it can include authToken). */
export const convexPutFailureReason = (error: unknown): string => {
  const message = error instanceof Error ? error.message : ''
  const detail = convexDetail(message)
  if (/unauthorized/i.test(message)) return 'Convex write authorization failed.'
  if (/not configured/i.test(message)) return 'Convex write authorization is not configured.'
  if (/undefined is not a valid Convex value/i.test(message)) return 'Convex rejected undefined fields in the dataset payload.'
  if (/Could not find (public )?function|not found public function/i.test(message)) return 'Convex dataset put function is not deployed.'
  if (/table .* not found|does not exist/i.test(message) && /datasets/i.test(message)) return 'Convex datasets table is not deployed.'
  if (/extra field/i.test(message)) return 'Convex rejected extra fields in the dataset payload.'
  if (/Field name/i.test(message)) return 'Convex rejected a dataset field name.'
  if (/Invalid dataset/i.test(message) || /Invalid dataset/i.test(detail)) return 'Convex rejected the dataset document.'
  if (/too large/i.test(message) || /too large/i.test(detail)) return 'Dataset is too large for Convex persist.'
  if (/too many writes|too many documents|write size|bytes written/i.test(message)) return 'Convex dataset put exceeded the mutation write limit.'
  if (/timed out|timeout/i.test(message)) return 'Convex dataset put timed out.'
  if (/ArgumentValidationError/i.test(message)) return 'Convex rejected the dataset argument shape.'
  if (/^[A-Za-z][A-Za-z0-9 .,'()/_-]{0,120}$/.test(detail) && !/authToken|secret|sk_/i.test(detail)) {
    return `Convex dataset put failed: ${detail}`
  }
  return `Convex dataset put failed (${safeRuntimeName(error)}).`
}

export const wrapConvexPutError = (error: unknown): never => {
  if (error instanceof DatasetError) throw error
  throw new DatasetError('DATASET_INTAKE_UNAVAILABLE', convexPutFailureReason(error), 503, 'CONVEX_PUT_FAILED', error)
}
